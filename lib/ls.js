'use strict';

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
var providers  = require('./providers');
var config = {};

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

function parseBody(req, callback) {
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
      return callback(err);
    }
    callback(null, data);
  });

  req.on('error', function(err) {
    callback(err);
  });
}

function sendResponse(req, res, status, obj) {
  var body = JSON.stringify(obj);
  var headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': req.headers.origin || '*',
    'access-control-allow-credentials': 'true'
  };
  res.writeHead(status, headers);
  res.end(body);
  console.info('req:', req.method, req.url, req.client.remoteAddress, req.headers['user-agent'], 'res:', status, body, Date.now() - req.time, 'ms');
}

function sendError(req, res, code, message) {
  message = message || http.STATUS_CODES[code];
  sendResponse(req, res, code, { error: { code: code, message: message }});
}

/**
 * Routing. Define action by url and method or send 404
 * @param  {http.ClientRequest} req
 * @param  {http.ServerResponse} res
 */
function dispatchRequest(req, res) {
  req.time = Date.now();
  var purl = url.parse(req.url, true);
  var matches = purl.pathname.match(/^\/(keys|providers)\/?(\w+)?\/?$/);
  if (!matches) {
    return sendError(req, res, 404);
  }
  if (matches[1] == 'providers') {
    if (req.method == 'POST' && !matches[2]) {
      parseBody(req, function(err, params) {
        if (err) {
          sendError(req, res, 500, err.message);
        } else {
          providers.create(params, function(err, provider) {
            if (err) {
              sendError(req, res, err.code, err.message);
            } else {
              sendResponse(req, res, 200, provider);
            }
          });
        }
      });
    } else if (req.method == 'DELETE' && matches[2]) {
      providers.destroy({ name: matches[2] }, function(err, provider) {
        if (err) {
          sendError(req, res, err.code, err.message);
        } else {
          sendResponse(req, res, 200, provider);
        }
      });
    } else {
      sendError(req, res, 404);
    }
  }
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