'use strict';

var crypto = require('crypto');
var assert = require('assert');
var tokens = require('../../lib/tokens');
var sign = require('../../lib/sign');
var ls = require('../../lib/ls');

module.exports = function() {
  var iv = crypto.randomBytes(16);
  var key = crypto.randomBytes(32);
  var payload = crypto.randomBytes(8).toString('hex');
  var exp = parseInt(Date.now() / 1000 + 3600);

  describe('tokens verify', function() {
    describe('without token', function() {
      it('should return false', function(done) {
        tokens.verify(null, iv, key, function(res) {
          assert(!res);
          done();
        });
      });
    });

    describe('wrong token length', function() {
      it('should return false', function(done) {
        tokens.verify(payload + 'shortsignature' + exp, iv, key, function(res) {
          assert(!res);
          done();
        });
      });
    });

    describe('expired token', function() {
      it('should return false', function(done) {
        var oldExp = Date.now() / 1000 - 1;
        var signature = sign.sign({ exp: oldExp, payload: payload }, iv, key);
        tokens.verify(payload + signature + oldExp, iv, key, function(res) {
          assert(!res);
          done();
        });
      });
    });

    describe('wrong signature', function() {
      it('should return false', function(done) {
        var signature = sign.sign({ exp: exp, payload: payload }, iv, key).split('').reverse().join('');
        tokens.verify(payload + signature + exp, iv, key, function(res) {
          assert(!res);
          done();
        });
      });
    });

    describe('token does not exist', function() {
      it('should return true', function(done) {
        var signature = sign.sign({ exp: exp, payload: payload }, iv, key);
        tokens.verify(payload + signature + exp, iv, key, function(res) {
          assert(res);
          done();
        });
      });
    });

    describe('retry request', function() {
      it('should return false', function(done) {
        var signature = sign.sign({ exp: exp, payload: payload }, iv, key);
        tokens.verify(payload + signature + exp, iv, key, function(res) {
          assert(!res);
          done();
        });
      });
    });
  });

  describe('deleteExpired', function() {
    var p1 = crypto.randomBytes(8).toString('hex');
    var e1 = parseInt(Date.now() / 1000) - 3600;
    var p2 = crypto.randomBytes(8).toString('hex');
    var e2 = parseInt(Date.now() / 1000) + 3600;

    before(function(done) {
      ls.database.query('DELETE FROM tokens', function(err, result) {
        if (err) {
          throw(err);
        } else {
          ls.database.query('INSERT INTO tokens (payload, exp) VALUES (?, ?), (?, ?)', [p1, e1, p2, e2], function(err, result) {
            if (err) {
              throw(err);
            } else {
              done();
            }
          });
        }
      })
    });

    it ('should delete exp tokens and return count', function(done) {
      tokens.deleteExpired(function(err, result) {
        assert(!err, err);
        assert.equal(result, 1);
        ls.database.query('SELECT * FROM tokens WHERE payload = ?', p1, function(err, result) {
          assert(!err, err);
          assert(!result[0], 'Expired payload is not deleted');
          ls.database.query('SELECT * FROM tokens WHERE payload = ?', p2, function(err, result) {
            assert(!err, err);
            assert(result[0], 'Not expired payload deleted');
            console.debug('DELETE result', result);
            done();
          });
        });
      });
    });

    after(function(done) {
      ls.database.query('DELETE FROM tokens', done);
    });
  });
};