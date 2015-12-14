'use strict';

var request = require('request');
var assert = require('assert');
var crypto = require('crypto');
var ls = require('../../lib/ls');
var providers = require('../../lib/providers');
var licenses = require('../../lib/licenses');
var helper = require('./helper');

module.exports = function() {
  describe('licenses', function() {
    var provider;
    var providerName = 'provider';

    before(function(done) {
      providers.get(providerName, function(err, p) {
        if (err) {
          providers.create({ name: providerName, flags: { check_sign: true } }, function(err, p) {
            if (err) {
              throw(err);
            } else {
              provider = p;
              done();
            }
          });
        } else {
          provider = p;
          done();
        }
      });
    });

    describe('create', function() {
      describe('without provider', function() {
        it('should return 400', function(done) {
          request.post(helper.requestFields('POST', '/licenses.json'), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 400);
            assert.equal(JSON.stringify(body), 
              JSON.stringify({ error: { code: 400, message: 'Provider missing' } }));
            done();
          });
        });
      });

      describe('with wrong sign', function() {
        it('should return 401', function(done) {
          request.post(helper.requestFields('POST', '/licenses.json', { provider: providerName, sign: 'test' }), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 401);
            assert.equal(JSON.stringify(body), 
              JSON.stringify({ error: { code: 401, message: 'Missing or invalid signature' } }));
            done();
          });
        });
      });

      describe('without content_id', function() {
        it('should return 400', function(done) {
          request.post(helper.requestFields('POST', '/licenses.json', { provider: providerName }, provider), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 400);
            assert.equal(JSON.stringify(body), 
              JSON.stringify({ error: { code: 400, message: 'Missing or invalid content_id' } }));
            done();
          });
        });
      });

      describe('with wrong sequence_id', function() {
        it('should return 400', function(done) {
          request.post(helper.requestFields('POST', '/licenses.json', { content_id: 123, provider: providerName, sequence_id: 'abc' }, provider), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 400);
            assert.equal(JSON.stringify(body), 
              JSON.stringify({ error: { code: 400, message: 'Invalid sequence_id' } }));
            done();
          });
        });
      });

      describe('with valid params', function() {
        var contentId = Math.floor(Math.random() * 1000000);
        var sequenceId = 0;
        
        it('should save encrypted binary license but return unencrypted hex', function(done) {
          request.post(helper.requestFields('POST', '/licenses.json', { provider: providerName, content_id: contentId }, provider), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 200);
            assert.equal(body.provider_id, provider.id);
            assert.equal(body.content_id, contentId);
            assert.equal(body.sequence_id, sequenceId);
            assert.equal(body.license.length, 16);
            assert.equal(typeof(body.license), 'string', 'should return unencrypted string');
            ls.database.query('SELECT license FROM licenses WHERE provider_id = ? AND content_id = ? AND sequence_id = ?', [body.provider_id, body.content_id, body.sequence_id], function(err, result) {
              assert(!err, err);
              assert.equal(result[0].license.length, 16);
              assert.equal(typeof(result[0].license), 'object', 'should save encrypted binary');
              done();
            });
          });
        });

        after(function(done) {
          ls.database.query('DELETE FROM licenses WHERE provider_id = ? AND content_id = ? AND sequence_id = ?', [provider.id, contentId, sequenceId], done);
        });
      });
    });

    describe('get', function() {
      var contentId = Math.floor(Math.random() * 1000000);
      var sequenceId = 0;

      before(function(done) {
        licenses.create({ provider: providerName, content_id: contentId, sequence_id: sequenceId }, done);
      });
      
      describe('without provider', function() {
        it('should return 400', function(done) {
          request.get(helper.requestFields('GET', '/licenses/' + contentId), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 400);
            assert.equal(body,  'Provider missing');
            done();
          });
        });
      });

      describe('with wrong sign', function() {
        it('should return 401', function(done) {
          request.get(helper.requestFields('GET', '/licenses/' + contentId, { provider: providerName, sign: 'qwewefeff' }), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 401);
            assert.equal(body, 'Missing or invalid signature');
            done();
          });
        });
      });

      describe('without sign', function() {
        describe('if provider has flag check_sign', function() {
          it('should return 401', function(done) {
            request.get(helper.requestFields('GET', '/licenses/' + contentId, { provider: providerName }), function(err, httpResponse, body) {
              assert(!err, err);
              assert.equal(httpResponse.statusCode, 401);
              assert.equal(body, 'Missing or invalid signature');
              done();
            });
          });
        });

        describe('if provider has no flag check_sign', function() {
          var nocheckName = 'nocheck';

          before(function(done) {
            providers.get(nocheckName, function(err, p) {
              if (err) {
                providers.create({ name: nocheckName }, function(err, p) {
                  if (err) {
                    throw(err);
                  } else {
                    licenses.create({ provider: nocheckName, content_id: contentId, sequence_id: sequenceId }, done);
                  }
                });
              } else {
                licenses.create({ provider: nocheckName, content_id: contentId, sequence_id: sequenceId }, done);
              }
            });
          });

          it('should return license', function(done) {
            request.get(helper.requestFields('GET', '/licenses/' + contentId, { provider: nocheckName }), function(err, httpResponse, body) {
              assert(!err, err);
              assert.equal(httpResponse.statusCode, 200);
              assert.equal(body.length, 16);
              assert.equal(typeof(body), 'string');
              done();
            });
          });

          after(function(done) {
            providers.destroy(nocheckName, done);
          });
        });
      });

      describe('without content_id', function() {
        it('should return 404', function(done) {
          request.get(helper.requestFields('GET', '/licenses', { provider: providerName }, provider), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 404);
            assert.equal(body, 'Not Found');
            done();
          });
        });
      });

      describe('with wrong sequence_id', function() {
        it('should return 400', function(done) {
          request.get(helper.requestFields('GET', '/licenses/' + contentId, { provider: providerName, sequence_id: 'abc' }, provider, { content_id: contentId }), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 400);
            assert.equal(body, 'Invalid sequence_id');
            done();
          });
        });
      });

      describe('with valid params', function() {
        it('should return license', function(done) {
          request.get(helper.requestFields('GET', '/licenses/' + contentId, { provider: providerName, sequence_id: sequenceId }, provider, { content_id: contentId }), function(err, httpResponse, body) {
            assert(!err, err);
            assert.equal(httpResponse.statusCode, 200);
            assert.equal(body.length, 16);
            assert.equal(typeof(body), 'string');
            providers.getRaw(providerName, function(err, providerRaw) {
              assert(!err, err);
              var cipher = crypto.createCipheriv('aes-256-cbc', providerRaw.crypto_key, providerRaw.crypto_iv);
              var enc = Buffer.concat([cipher.update(new Buffer(body, 'hex')), cipher.final()]);
              ls.database.query('SELECT license FROM licenses WHERE provider_id = ? AND content_id = ? AND sequence_id = ?', [providerRaw.id, contentId, sequenceId], function(err, result) {
                assert(!err, err);
                assert(enc.equals(result[0].license), 'Encrypted again license not equal to database original');
                done();
              });
            });

          });
        });
      });
    });

    after(function(done) {
      providers.destroy(providerName, done);
    });
  });
};