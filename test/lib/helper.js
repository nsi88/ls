'use strict';

var fs = require('fs');
var qs = require('sc-querystring');
var ls = require('../../lib/ls');
var sign = require('../../lib/sign');

/**
 * Prepare request fields, like url, body, sign
 * @param {String} method HTTP request method in uppercase
 * @param  {String} path
 * @param  {Object} [params={}]
 * @param {Object} [provider]
 * @param  {Object} [paramsForSign] Additional params used for subscription
 * @return {Object}
 */
exports.requestFields = function(method, path, params, provider, paramsForSign) {
  params = params || {};
  if (provider) {
    if (paramsForSign) {
      for (var i in params) {
        paramsForSign[i] = params[i];
      }
    } else {
      paramsForSign = params;
    }
    params.sign = sign.sign(paramsForSign, provider.sign_iv, provider.sign_key);
  }
  var res = {
    key: fs.readFileSync(ls.config.settings.https_key),
    cert: fs.readFileSync(ls.config.settings.https_cert),
    rejectUnauthorized: false,
    json: true,
    url: 'https://' + ls.config.settings.host + path
  };
  if (method == 'GET') {
    res.url += '?' + qs.stringify(params);
  } else {
    res.body = params;
  }
  return res;
};