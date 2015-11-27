'use strict';

require('file-log');
var cluster    = require('cluster');
var yamlConfig = require('node-yaml-config');
var http       = require('http');
var https      = require('https');
var url        = require('url');
var fs         = require('fs');
var crypto     = require('crypto');
var airbrake   = require('airbrake');
var async      = require('async');
var mysql      = require('mysql');
var config = {};

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
    async.parallel([
      function(callback) { mysqlConnect('database', callback) },
      function(callback) { mysqlConnect('providers', callback) }
    ], function(err, results) {
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

function mysqlConnect(db, callback) {
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

// function determines action based on url
function dispatchRequest(req, res) {
  req.time = Date.now();
  var params = url.parse(req.url);
  
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