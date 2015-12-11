'use strict';

/**
 * Generation and verification of signature
 * @module  sign
 */

var qs = require('sc-querystring');
var crypto = require('crypto');

/**
 * Check signature
 * @param  {Object} params Params from body or query string including sign
 * @param {String(hex)} iv Initialization vector , used for aes-256-cbc signature encryption
 * @param {String(hex)} key Key, used for aes-256-cbc signature encryption
 * @return {Boolean}
 */
exports.verify = function(params, iv, key) {
  if (!params.sign) {
    return false;
  }
  var sign = params.sign;
  delete(params.sign);
  return sign == str2Sign(obj2Str(params), iv, key);
};

/**
 * Generate signature
 * @param  {Object} params Params from body or query string
 * @param {String(hex)} iv Initialization vector , used for aes-256-cbc signature encryption
 * @param {String(hex)} key Key, used for aes-256-cbc signature encryption
 * @return {String}        Base64 encdoded string
 */
exports.sign = function(params, iv, key) {
  return str2Sign(obj2Str(params), iv, key);
};

/**
 * Concat obj to string. Make querystring sorting keys
 * @param {Object} obj
 * @return {String}
 * @example
 * obj2Str({ d: 1, c: { b: 2, a: 3 } }) returns c=%7B%22b%22%3A2%2C%22a%22%3A3%7D&d=1
 */
function obj2Str(obj) {
  return qs.stringify(obj).split('&').sort().join('&');
}

/**
 * Algorithm used by widevine license server
 * TODO Описать алгоритм в документации
 */
function str2Sign(str, iv, key) {
  var shasum  = crypto.createHash('sha1');
  shasum.update(str);

  var sha1    = shasum.digest('binary');
  var ivBuf   = (new Buffer(iv, 'hex')).toString('binary')
  var keyBuf  = (new Buffer(key, 'hex')).toString('binary')
  var padding = Array(13).join((new Buffer("\x00")).toString());
  var cipher  = crypto.createCipheriv('aes-256-cbc', keyBuf, ivBuf);
  var enc     = cipher.update(sha1+padding);
  return(new Buffer(enc, 'binary').toString('base64'));
}