## node-rproxy

A reverse proxy for RESTful services.

# Features

* Authentication via the Keystone API
* Flexible rate limiting based on the source IP address
* Supported database backends
  * Redis
  * Cassandra

# Concepts

![](http://img38.imageshack.us/img38/2060/noderproxy1.png)

## Middleware

Middleware is a node module which exposes a single method and acts on a request
or a response. There are two types of middleware:

* request middleware - This type of middleware acts on a request before it's proxied to
  the backend server. It can for example talk to a remote authentication server
  or implement rate limiting.
* response middleware - This type of middleware acts on a response returned by
  the backend before the responses is returned back to the user. It can for
  example strip or inject extra headers in the response.

Note: Currently response middleware is only limited to modifying the response
headers.

# Requirements

- Node.js
- Redis or Cassandra (for caching auth tokens and storing rate limit values)

# Configuration

Configuration is stored in a JSON format in a file. Example configuration can
be found in `example/config.json`.

## Reverse proxy configuration ("server" attribute)

* `host` - listen address for the reverse proxy server
* `port` - listen port for the reverse proxy server
* `workers` - number of workers processes to use. Defaults to the number of
  available CPUs.

## Admin API configuration ("admin_api" attribute)

* `host` - listen address for the admin API server
* `port` - listen port for the admin API server
* `key` - API key used for authentication which must be provided in the
  `x-api-key` header.

# Backend a.k.a. proxy target configuration ("target" attribute)

* `host` - listen address for the proxy target
* `port` - listen port for the proxy target
* `middleware_run_list` - an object with two keys:
  * `request` - an array of middleware to run for every request
  * `response` - an array of middleware to run for every response

# Middleware configuration options

## Identity provider

This middleware parses a user tenant id from the URL or a header called `X-Tenant-Id`
and puts it on the request object.

### Settings

* `tenant_id_regex` - regular expression which is used for parsing tenant id
  from the request URL. If not provided it defaults to `/\/(\d+)\/?/`.

## Authentication

This middleware authenticates a user against the [Keystone
API](http://docs.openstack.org/incubation/identity-dev-guide/content/Overview-Keystone-API-d1e62.html).
It expects authentication token to be provided in the header with the name
`X-Auth-Token` or in the query string with the name `x-auth-token`.

Unless `?skip-auth-cache` query string is provided, token is stored in the cache
until it expires.

### Settings

* `username` - admin username for the Keystone auth server
* `password` - admin password for the Keystone auth server
* `urls` - an array of Kesystone API URLs to hit in parallel when
authenticating a user. Authentication is be considered as successful if at
least one URL returns a success. By default this array contains URL for US and
UK Keystone server.
* `whitelist` - A list of paths which don't require authentication

### Error codes

* `NR-1000` - missing `X-Tenant-Id` header
* `NR-1001` - missing `X-Auth-Token` header
* `NR-1002` - invalid or expired auth token
* `NR-5000` - something unexpected has happened

## Rate limiting

This middleware provides flexible rate limiting based on the requested paths.

### Settings

* `bucket_size` - Size of a bucket in seconds. This value also specifies a
  minimum time period you can rate limit on.
* `limits` - An array of limit objects. Each object has the following keys:
  * `method` - HTTP method of the limited path
  * `path_regex` - Regular expression for the rate limited path
  * `limit` - Request limit for this path
  * `period` - Period in seconds. This value can't be smaller than
  `bucket_size`
* `view_path` - Special path which, when hit will sent current user limits to the
  backend using a POST request
* `view_backend_path` - Path on the backend where the users limits are sent to
  when user hits `view_path` on the proxy.

### Error codes

* `NR-2000` - rate limit has been reached

## Usage

This middleware intercepts special usage headers returned by the backend and
sends usage events to an [Atom Hopper](http://atomhopper.org/) instance.

### Settings

* `url` - Atom Hopper instance URL
* `service_name` - Name of the service
* `region` - Service region or `global`
* `datacenter` - Service datacenter or `global`

### Header remover

This middleware removes headers with the specified prefix from the response.

## Special header names

* X-RP-Error-Code
* X-RP-Error-Message

## Tracing

This middleware integrated wits Zipkin distributed tracing. It supports
submitting traces to a remote RESTkin endpoint.

For more information about tracing, please have a look at the Node tracing
client called [https://github.com/racker/node-tryfer](node-tryfer).

### Settings

* `authentication.url` - URL to the Keystone authentication endpoint which is used
 to obtain the token which is then used to authenticate against the RESTkin API.
* `authentication.username` - API username.
* `authentication.apiKey` - API key.
* `restkin.url` - URL to the RESTkin HTTP endpoint

# Running lint and tests

By default tests are automatically run on every commit on [Travis-ci](http://travis-ci.org).
You can view the build status at [http://travis-ci.org/#!/racker/node-rproxy](http://travis-ci.org/#!/racker/node-rproxy).

If you want to run them locally you need to have either Redis or Cassandra (or
both) installed.

## Running lint

`npm run-script lint`

## Running tests with Redis backend

`DB_BACKEND=redis REDIS_HOME=<path to the directory containg redis-server binary> npm run-script test`

## Running tests with Cassandra backend

`DB_BACKEND=cassandra CASSANDRA_HOME=<path to the directory containg cassandra binary> npm run-script test`

# TODO

- Performance optimizations
- Log middleware
- Integration guide
