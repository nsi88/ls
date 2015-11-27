'use strict';

var ls = require('../lib/ls');

describe('license server', function() {
  before(function(done) {
    ls.init(function() {
      ls.mysqlConnect(function() {
        ls.createServer().listen(ls.config.settings.port, ls.config.settings.host);
        done();
      });
    });
  });

  require('./lib/providers')();
});