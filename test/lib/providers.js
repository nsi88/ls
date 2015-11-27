'use strict';

var ls = require('../../lib/ls');
var providers = require('../../lib/providers');
var fs = require('fs');
var request = require('request');
var assert = require('assert');

module.exports = function() {
  function requestFields(path, body) {
    return {
      key: fs.readFileSync(ls.config.settings.https_key),
      cert: fs.readFileSync(ls.config.settings.https_cert),
      rejectUnauthorized: false,
      url: 'https://' + ls.config.settings.host + path,
      body: body,
      json: true
    }
  }

  describe('providers', function() {
    describe('create', function() {
      describe('without name', function() {
        it('should return 400', function(done) {
          request.post(requestFields('/providers', {}), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 400);
            assert.equal(JSON.stringify(body), JSON.stringify({ error: { code: 400, message: 'Name missing' } }));
            done();
          });
        });
      });

      describe('with wrong name length', function() {
        it('should return 400', function(done) {
          request.post(requestFields('/providers', { name: 'abc' }), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 400);
            assert.equal(JSON.stringify(body), JSON.stringify({ error: { code: 400, message: 'Invalid name' } }));
            done();
          });
        });
      });

      describe('if name exists', function() {
        var name = 'test409';
        before(function(done) {
          providers.create({ name: name }, function(err, provider) {
            console.debug('create', err, provider);
            done();
          });
        });

        it('should return 409', function(done) {
          request.post(requestFields('/providers', { name: name }), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 409);
            assert.equal(JSON.stringify(body), JSON.stringify({ error: { code: 409, message: 'Name exists' } }));
            done();
          });
        });

        after(function(done) {
          providers.destroy({ name: name }, done);
        });
      });

      describe('with valid params', function() {
        it('should return provider', function(done) {
          request.post(requestFields('/providers', { name: 'root_provider', flags: { check_token: true, manage_providers: true } }), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 200);
            assert.equal(body.name, 'root_provider');
            assert.equal(JSON.stringify(body.flags), JSON.stringify({ check_sign: 0, check_token: 1, manage_providers: 1 }));
            assert.equal(body.sign_iv.length, 32);
            assert.equal(body.sign_key.length, 64);
            done();
          });
        });

        after(function(done) {
          providers.destroy({ name: 'root_provider' }, done);
        });
      });
    });

    describe('destroy', function() {
      describe('without name', function() {
        it('should return 404', function(done) {
          request.del(requestFields('/providers'), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 404);
            assert.equal(JSON.stringify(body), JSON.stringify({ error: { code: 404, message: 'Not Found' } }));
            done();
          });
        });
      });

      describe('if name does not exist', function() {
        it('should return 404', function(done) {
          request.del(requestFields('/providers/doesnt_exist'), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 404);
            assert.equal(JSON.stringify(body), JSON.stringify({ error: { code: 404, message: 'Not Found' } }));
            done();
          });
        });
      });

      describe('if provider exists', function() {
        var name = 'test_del';

        function checkProvidersCount(cnt, callback) {
          ls.database.query('SELECT * FROM providers WHERE name = ?', name, function(err, result) {
            assert(!err, err);
            assert.equal(result.length, cnt);
            if (result[0]) {
              ls.providers.query('SELECT * FROM providers WHERE id = ?', result[0].encryption_key_id, function(err, result) {
                assert(!err, err);
                assert.equal(result.length, cnt);
                callback();
              });
            } else {
              callback();
            }
          });
        }

        before(function(done) {
          providers.create({ name: name }, function(err, provider) {
            console.debug('create', err, provider);
            done();
          });
        });

        it('should delete provider from both databases and return provider', function(done) {
          checkProvidersCount(1, function() {
            request.del(requestFields('/providers/' + name), function(err, httpResponse, body) {
              assert(!err, err);
              assert.equal(httpResponse.statusCode, 200);
              assert.equal(body.name, name);
              assert.equal(JSON.stringify(body.flags), JSON.stringify({ check_sign: 0, check_token: 0, manage_providers: 0 }));
              assert.equal(body.sign_iv.length, 32);
              assert.equal(body.sign_key.length, 64);
              checkProvidersCount(0, done);
            });
          });
        });
      });
    });
  });
};