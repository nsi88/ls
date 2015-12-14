'use strict';

/**
 * Common license server methods
 * @module ls
 */

require('file-log');
var cluster    = require('cluster');
var yamlConfig = require('node-yaml-config');
var http       = require('http');
var https      = require('https');
var url        = require('url');
var fs         = require('fs');
var airbrake   = require('airbrake');
var async      = require('async');
var mysql      = require('mysql');
var qs         = require('sc-querystring');
var providers  = require('./providers');
var licenses   = require('./licenses');
var sign       = require('./sign');
var config = {};

/**
 * Custom errors
 * @type {Object}
 */
var ERRORS = {
  provider: { code: 400, message: 'Provider missing' },
  sign: { code: 401, message: 'Missing or invalid signature' },
  forbidden: { code: 403, message: 'Forbidden' }
};

exports.config = null;
exports.database = null;
exports.providers = null;

exports.init = function(callback) {
  var env = process.env.NODE_ENV;
  if (cluster.isMaster) {
    if (!env) {
      console.fatal('NODE_ENV required');
      process.exit();
    }
  }
  
  config.settings = yamlConfig.load(__dirname + '/../config/settings.yml');
  config.database = yamlConfig.load(__dirname + '/../config/database.yml');
  config.providers = yamlConfig.load(__dirname + '/../config/providers.yml');
  exports.config = config;
  
  var airbrake_client                      = airbrake.createClient(config.settings.airbrake_api_key);
  airbrake_client.serviceHost              = config.settings.airbrake_host;
  airbrake_client.env                      = env;
  airbrake_client.developmentEnvironments  = ['development', 'test'];
  console.setAirbrake(airbrake_client);
  console.setLevel(config.settings.log_level).setFile(config.settings.log_file, callback);
}

exports.start = function() {
  if (cluster.isMaster) {
    fs.writeFileSync(__dirname+'/../'+config.settings.pid_file, process.pid);

    for (var i = 0; i < config.settings.workers; i++) {
      var worker = cluster.fork();
    }

    cluster.on('exit', function(worker) {
      console.fatal('worker ' + worker.process.pid + ' died');
      cluster.fork();
    });

    process.on('SIGUSR1', function() {
      for (var id in cluster.workers) {
        cluster.workers[id].process.kill('SIGUSR1');
      }
    });

    process.on('SIGUSR2', function() {
      for (var id in cluster.workers) {
        cluster.workers[id].process.kill('SIGUSR2');
      }
    });

    console.info('Running license server on host %s and port %d (%d workers)', config.settings.host, config.settings.port, config.settings.workers);
  } else {
    mysqlConnect(function(err) {
      if (err) {
        console.error('Error connect to mysql: ', err);
        process.exit();
      } else {
        createServer().listen(config.settings.port, config.settings.host);
        createHealthcheckServer().listen(config.settings.healthcheck_port, config.settings.healthcheck_host);
      }
    });
  }
};

function mysqlConnect(callback) {
  function handleMysqlDisconnect(db) {
    exports[db].on('error', function(err) {
      if (!err.fatal) {
        return;
      }
      if (err.code !== 'PROTOCOL_CONNECTION_LOST') {
        throw err;
      }
      console.error('Lost connect to mysql: ' + err.stack);
      
      exports[db] = mysql.createConnection(config[db]);
      handleMysqlDisconnect(db);
      exports[db].connect();
    });
  }
  
  function dbConnect(db, callback) {
    exports[db] = mysql.createConnection(config[db]);
    handleMysqlDisconnect(db);
    exports[db].connect(function(err) {
      if (err) {
        callback(err);
      } else {
        callback(null);
      }
    });
  }

  async.parallel([
    function(callback) { dbConnect('database', callback) },
    function(callback) { dbConnect('providers', callback) }
  ], callback);
}
exports.mysqlConnect = mysqlConnect;

function createServer() {
  var options = {
    key: fs.readFileSync(config.settings.https_key),
    cert: fs.readFileSync(config.settings.https_cert)
  };
  var server = https.createServer(options, dispatchRequest);

  server.on('clientError', function (err) {
    console.warn('client error: ' + err);
  });

  server.on('error', function (err) {
    console.error('server error: ' + err);
  });

  return server;
}
exports.createServer = createServer;

/**
 * Parse params from JSON-body or query string
 * @param  {http.ClientRequest}   req
 * @param  {Function} callback
 * @return {Error | Object}
 */
function parseParams(req, callback) {
  if (req.method == 'GET') {
    callback(null, url.parse(req.url, true).query);
  } else if (req.method == 'POST' || req.method == 'DELETE' || req.method == 'PUT') {
    var body = '';
    req.setEncoding('utf8');
    
    req.on('data', function(chunk) {
      body += chunk;
    });
    
    req.on('end', function() {
      var data;
      try {
        data = JSON.parse(body);
        console.debug('parseBody:', data);
      } catch (err) {
        console.error('Cannot parse body:', body, err);
        return callback({ code: 400, message: err.message });
      }
      callback(null, data);
    });

    req.on('error', function(err) {
      callback({ code: 500, message: err.message });
    });
  } else {
    callback({ code: 404 });
  }
}

/**
 * Send response. Response content type depends of request url format
 * @param  {http.ClientRequest} req
 * @param  {http.ServerResponse} res
 * @param  {Number} status HTTP status code
 * @param  {Object | String} body Response body. If object, it will be json stringified
 * @todo  Add headers, b.e. Content-MD5
 */
function sendResponse(req, res, status, body) {
  var headers = {};
  headers['content-type'] = (req.format == '.json' ? 'application/json' : 'text/plain;charset=UTF-8');
  if (typeof(body) == 'object') {
    body = JSON.stringify(body);
  }
  headers['content-length'] = Buffer.byteLength(body);
  headers['access-control-allow-origin'] = req.headers.origin || '*';
  headers['access-control-allow-credentials'] = 'true';
  
  res.writeHead(status, headers);
  res.end(body);
  console.info('req:', req.method, req.url, req.client.remoteAddress, req.headers['user-agent'], 
    'res:', status, body, Date.now() - req.time, 'ms');
}

function sendError(req, res, err) {
  err.message = err.message || http.STATUS_CODES[err.code];
  sendResponse(req, res, err.code, req.format == '.json' ? { error: err } : err.message);
}

/**
 * Routing. Define action by url and method
 * @param  {http.ClientRequest} req
 * @param  {http.ServerResponse} res
 */
function dispatchRequest(req, res) {
  req.time = Date.now();
  var matches = req.url.match(/^\/(providers|licenses)(?:\/(\w+))?(\.json)?\/?(?:\?.*)?$/);
  if (!matches) {
    return sendError(req, res, { code: 404 });
  }
  req.format = matches[3];
  parseParams(req, function(err, params) {
    if (err) {
      sendError(req, res, err);
    } else {
      if (!params.provider) {
        return sendError(req, res, ERRORS.provider);
      }
      providers.get(params.provider, function(err, provider) {
        if (err) {
          sendError(req, res, err);
        } else {
          if (matches[1] == 'licenses') {
            if (req.method == 'GET' && matches[2]) {
              params.content_id = matches[2];
              if (provider.flags.check_sign && !sign.verify(params, provider.sign_iv, provider.sign_key)) {
                return sendError(req, res, ERRORS.sign);
              }
              licenses.get(params, function(err, license) {
                if (err) {
                  sendError(req, res, err);
                } else {
                  sendResponse(req, res, 200, license);
                }
              });
            } else if (req.method == 'POST' && !matches[2]) {
              if (!sign.verify(params, provider.sign_iv, provider.sign_key)) {
                return sendError(req, res, ERRORS.sign);
              }
              licenses.create(params, function(err, license) {
                if (err) {
                  sendError(req, res, err);
                } else {
                  sendResponse(req, res, 200, license);
                }
              });
            } else {
              sendError(req, res, { code: 404 });
            }
          } else if (matches[1] == 'providers') {
            if (req.method == 'POST' && !matches[2]) {
              if (!sign.verify(params, provider.sign_iv, provider.sign_key)) {
                return sendError(req, res, ERRORS.sign);
              }
              if (!provider.flags.manage_providers) {
                return sendError(req, res, ERRORS.forbidden);
              }
              providers.create(params, function(err, provider) {
                if (err) {
                  sendError(req, res, err);
                } else {
                  sendResponse(req, res, 200, provider);
                }
              });
            } else if (req.method == 'DELETE' && matches[2]) {
              params.name = matches[2];
              if (!sign.verify(params, provider.sign_iv, provider.sign_key)) {
                return sendError(req, res, ERRORS.sign);
              }
              if (!provider.flags.manage_providers) {
                return sendError(req, res, ERRORS.forbidden);
              }
              providers.destroy(matches[2], function(err, provider) {
                if (err) {
                  sendError(req, res, err);
                } else {
                  sendResponse(req, res, 200, provider);
                }
              });
            } else {
              sendError(req, res, { code: 404 });
            }
          }
        }
      });
    }
  });
}

function createHealthcheckServer() {
  var server = http.createServer(function(req, res) {
    var headers = {
      'Date': new Date().toUTCString(),
      'Last-Modified': new Date().toUTCString(),
      'Server': 'LicenseServer',
      'Access-Control-Allow-Origin': '*'
    };
    var status = 200;
    var body = 'OK';
    if (exports.database._socket.destroyed) {
      status = 500;
      body = 'Database connect error';
    } else if (exports.providers._socket.destroyed) {
      status = 500;
      body = 'Providers connect error';
    }
    headers['Content-Length'] = Buffer.byteLength(body);
    res.writeHead(status, headers);
    res.end(body);
  });

  server.on("error", function (err) {
    console.error("healthcheck server error: " + err);
  });

  return server;
}