/**
 *  Copyright 2012 Rackspace
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */

var Buffer = require('buffer').Buffer;
var querystring = require('querystring');

var sprintf = require('sprintf').sprintf;
var async = require('async');

var log = require('logmagic').local('lib.util.keystone_client');

var request = require('./request');
var misc = require('./misc');
var errors = require('./errors');

var KEYSTONE_SUCCESS_STATUS_CODES = [200, 203];

/* We trust the token is valid for at least 60 seconds */
var TRUST_TOKEN_FOR = 60;



/**
 * Create an OpenStack Keystone Identity API client.
 *
 * @param {String} keystoneUrl Base keystone server url.
 * @param {Object} options Authentication options (username, apikey, password).
 * @constructor
 */
function KeystoneClient(keystoneUrl, options) {
  this._url = keystoneUrl;
  this._username = options.username;
  this._apikey = options.apikey;
  this._password = options.password;
  this._extraArgs = options.extraArgs || {};
  this._token = null;
  this._tokenExpires = null;
  this._refreshTokenCompletions = [];
  this._tokenUpdated = 0;
  this._tenantId = null;
  this._serviceCatalog = [];
}


/**
 * @return {Object} default http request options.
 */
KeystoneClient.prototype._defaultOptions = function() {
  var options = {
    'parse_json': true,
    'expected_status_codes': KEYSTONE_SUCCESS_STATUS_CODES,
    'headers': {'Accept': 'application/json'},
    'timeout': 5000,
    'return_response': true
  };
  return options;
};


/**
 * Ensure we have a relatively fresh auth api token.
 *
 * @param {Function} callback Completion callback.
 */
KeystoneClient.prototype._freshToken = function(callback) {
  var curtime;

  curtime = new Date().getTime() / 1000;

  if (curtime < this._tokenUpdated + TRUST_TOKEN_FOR) {
    callback(null, this._token);
    return;
  }

  this._refreshTokenCompletions.push(callback);

  if (this._refreshTokenCompletions.length === 1) {
    this._updateToken();
  }
};


/**
 * Update our Service catalog and Auth Token caches.
 * Notifies this._refreshTokenCompletions on completion or error.
 */
KeystoneClient.prototype._updateToken = function() {
  var options, url, body, self = this;

  options = this._defaultOptions();
  options.headers['Content-Type'] = 'application/json';

  url = sprintf('%s/tokens', this._url);
  body = {};

  if (this._password) {
    body = {'auth': {'passwordCredentials': {'username': this._username, 'password': this._password}}};
  }
  else {
    body = {'auth': {'RAX-KSKEY:apiKeyCredentials': {'username': this._username, 'apiKey': this._apikey}}};
  }

  function complete(err, result) {
    var cpl;

    self._tokenUpdated = new Date().getTime() / 1000;
    cpl = self._refreshTokenCompletions;
    self._refreshTokenCompletions = [];
    cpl.forEach(function(func) {
      func(err, result);
    });
  }

  request.request(url, 'POST', JSON.stringify(body), options, function(err, result) {
    var cpl;

    if (err) {
      complete(err);
      return;
    }

    if (result.body.access) {
      self._token = result.body.access.token.id;
      self._tokenExpires = result.body.access.token.expires;
      self._serviceCatalog = result.body.access.serviceCatalog;
    }
    else {
      complete(new Error('malformed response: ' + JSON.stringify(result)));
      return;
    }

    complete(null, self._token);
  });
};


/**
 * Validate a tenantId and token for a user, using our admin Auth Token.
 *
 * @param {String} tenantId User's tenantId.
 * @param {String} token User's Token.
 * @param {Function} callback Callback called with (err, body).
 */
KeystoneClient.prototype.validateTokenForTenant = function(tenantId, token, callback) {
  var options, url, self = this;

  this._freshToken(function() {
    var qargs;

    options = self._defaultOptions();
    options.headers['X-Auth-Token'] = self._token;

    qargs = querystring.stringify(misc.merge(self._extraArgs, {'belongsTo': tenantId}));

    url = sprintf('%s/tokens/%s?%s', self._url, token, qargs);

    request.request(url, 'GET', null, options, function(err, result) {
      if (err) {
        if ((err instanceof errors.UnexpectedStatusCodeError) && result.body) {
          if (err.statusCode !== 404) {
            log.error('Authentication API returned an unexpected status code',
                      {'code': err.statusCode, 'body': result.body});
          }
          else {
            log.debug('Authentication API returned an unexpected status code',
                      {'code': err.statusCode, 'body': result.body});
          }
        }

        callback(err);
        return;
      }

      if (!result.body.access) {
        callback(new Error('malformed response: ' + JSON.stringify(result)));
        return;
      }

      callback(null, result.body.access);
    });
  });
};


/**
 * Validate a auth token.
 * This method doesn't require an admin token, but it doesn't return a TTL and
 * other tenant information.
 * @param {String} token User's Token.
 * @param {Function} callback Callback called with (err, body).
 */
KeystoneClient.prototype.validateToken = function(token, callback) {
  var options = this._defaultOptions(), url = sprintf('%s/tenants', this._url);

  options.headers['Content-Type'] = 'application/json';
  options.headers['X-Auth-Token'] = token;

  request.request(url, 'GET', null, options, function(err, result) {
    if (err) {
      callback(err);
      return;
    }

    callback(null, result.body);
  });
};


/**
 * Retrieve information about a TenantId, using our admin token.
 *
 * @param {String} tenantId User's tenantId.
 * @param {Function} callback Completion callback.
 */
KeystoneClient.prototype.tenantInfo = function(tenantId, callback) {
  var options, url, self = this;

  this._freshToken(function() {
    var qargs;

    options = self._defaultOptions();
    options.headers['X-Auth-Token'] = self._token;

    qargs = querystring.stringify(self._extraArgs);

    url = sprintf('%s/tenants/%s?%s', self._url, tenantId, qargs);

    request.request(url, 'GET', null, options, function(err, result) {
      if (err) {
        if ((err instanceof errors.UnexpectedStatusCodeError) && result.body) {
          log.error('tenantInfo: Authentication API returned an unexpected status code',
                    {'code': err.statusCode, 'body': result.body, 'tenantId': tenantId});
        }

        callback(err);
        return;
      }

      if (!result.body.tenant) {
        callback(new Error('tenantInfo: malformed response: ' + JSON.stringify(result)));
        return;
      }

      callback(null, result.body.tenant);
    });
  });
};


/**
 * Get the service catalog from Keystone.
 *
 * @param {Function} callback Completion callback.
 */
KeystoneClient.prototype.serviceCatalog = function(callback) {
  var self = this;

  this._freshToken(function(err) {
    if (err) {
      callback(err);
      return;
    }

    callback(null, self._serviceCatalog);
  });
};


/**
 * Get the tenant id and token from Keystone.
 *
 * @param {Function} callback Completion callback.
 */
KeystoneClient.prototype.tenantIdAndToken = function(callback) {
  var self = this,
      tenantId;

  this._freshToken(function(err) {
    if (err) {
      callback(err);
      return;
    }

    self._serviceCatalog.forEach(function(item) {
      if (item.name === 'cloudServers' || item.name === 'cloudServersLegacy') {
        if (item.endpoints.length === 0) {
          throw new Error('Endpoints should always be > 0');
        }
        tenantId = item.endpoints[0].tenantId;
      }
    });

    callback(null, { token: self._token, expires: self._tokenExpires, tenantId: tenantId });
  });
};


/** Keystone Client Class */
exports.KeystoneClient = KeystoneClient;