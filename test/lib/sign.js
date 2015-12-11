'use strict';

var assert = require('assert');
var sign = require('../../lib/sign');
var IV = '05722b9ae85937be4b213af04e2d43e3';
var KEY = '0b89ac4b822ced9627e6c37d331161b4a2a4cf9760fd804a6c3d01281706804d';
var params = { p3: 3, p1: { p13: 13, p11: 11, p12: 12 }, p2: 2 };

module.exports = function() {
  describe('sign verify', function() {
    describe('without sign', function() {
      it ('should return false', function() {
        delete(params.sign);
        assert(!sign.verify(params, IV, KEY));
      });
    });

    describe('with wrong sing', function() {
      it ('should return false', function() {
        params.sign = 'wrongsign';
        assert(!sign.verify(params, IV, KEY));
      });
    });

    describe('with valid sign', function() {
      it('should return true', function() {
        params.sign = 'hmkXkJjPzR8hbzExkqzJ+IqQviJFeJXOdXI4cbUKNeA=';
        assert(sign.verify(params, IV, KEY));
      });
    });
  });
};