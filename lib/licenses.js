'use strict';

/**
 * @apiDefine License
 *
 * @apiParam {Number} content_id External id linked with the license
 * @apiParam {Number} [sequence_id=0] Used for live
 * @apiParam {String} provider Name of provider, executing the request
 *
 * @apiError 400 A required param missing or has invalid value
 * @apiErrorExample {json} ContentID
 *     { error: { code: 400, message: "Missing or invalid content_id" } }
 * @apiErrorExample {json} SequenceID
 *     { error: { code: 400, message: "Invalid sequence_id" } }
 * @apiError 404 Not found
 * @apiErrorExample {json} Provider not found
 *     { error: { code: 404, message: 'Not found' } }
 * @apiError 500 An internal server error happened
 */

/**
 * Licenses methods
 * @module licenses
 */

var crypto = require('crypto');
var Mcache = require('mcache');
var providers = require('./providers');
var ls = require('./ls');

// Лицензия - 128-битная. Хранится в зашифрованном AES-256-CBC виде
// NOTE при выводе используется toString('hex'), так что будет 16
var LICENSE_LENGTH = 8;
var LICENSE_ENC_ALGORITHM = 'aes-256-cbc';

// Время хранения лицензии в mcache
var MCACHE_TTL = 60;
var MCACHE_GC_TIME = 60;

/**
 * @api {post} /licences.json Create a new License
 * @apiName CreateLicense
 * @apiGroup License
 *
 * @apiUse License
 *
 * @apiParam {String} sign Request signature
 *
 * @apiSuccess {Number} provider
 * @apiSuccess {Number} content_id
 * @apiSuccess {Number} sequence_id
 * @apiSuccess {String} license Hex encoded AES-128-CBC encryption key
 * @apiSuccessExample {json} License
 *     {
 *       provider_id: 123,
 *       content_id: 123124232,
 *       sequence_id: 0,
 *       license: '89b43a2250d83283'
 *     }
 */
exports.create = function(params, callback) {
  validateParams(params, function(err) {
    if (err) {
      callback(err);
    } else {
      providers.getRaw(params.provider, function(err, provider) {
        if (err) {
          callback(err);
        } else {
          var cipher = crypto.createCipheriv(LICENSE_ENC_ALGORITHM, provider.crypto_key, provider.crypto_iv);
          var unenc = crypto.randomBytes(LICENSE_LENGTH);
          var license = {
            provider_id: provider.id,
            content_id: params.content_id,
            sequence_id: params.sequence_id || 0,
            license: Buffer.concat([cipher.update(unenc), cipher.final()])
          };
          console.debug('Create license', license);
          ls.database.query('INSERT INTO licenses SET ?', license, function(err, result) {
            if (err) {
              console.error(err);
              callback({ code: 500 });
            } else {
              license.license = unenc;
              callback(null, pretty(license));
            }
          });
        }
      });
    }
  });
};

/**
 * Get license from cache or database
 * @param  {String} key       Provider name, content_id, sequence_id joined by _
 * @param  {Function} callback
 * @return {String}           Hex encoded unencrypted license
 */
var cache = new Mcache(MCACHE_TTL, MCACHE_GC_TIME, function(key, callback) {
  var args = key.split('_');
  providers.getRaw(args[0], function(err, provider) {
    if (err) {
      callback(err);
    } else {
      console.debug('Get license', key, 'from database');
      ls.database.query('SELECT license FROM licenses WHERE provider_id = ? AND content_id = ? AND sequence_id = ?', [provider.id, args[1], args[2]], function(err, result) {
        if (err) {
          console.error(err);
          callback({ code: 500 });
        } else if (!result[0]) {
          callback({ code: 404 });
        } else {
          var enc = result[0].license;
          var decipher = crypto.createDecipheriv(LICENSE_ENC_ALGORITHM, provider.crypto_key, provider.crypto_iv);
          callback(null, Buffer.concat([decipher.update(enc), decipher.final()]).toString('hex'));
        }
      });
    }
  });
});

/**
 * @api {get} /licenses/:content_id Get license
 * @apiName GetLicense
 * @apiGroup License
 * @apiDescription  Pay attention, the extension is not json. Plain text license will be returned
 *
 * @apiUse License
 *
 * @apiParam {String} sign Request signature. Optional if provider has no flag check_sign
 * @apiParam {String} token One time access token. Optional if provider has no flag check_token
 *
 * @apiSuccessExample {text} License
 *     HTTP/1.1 200 OK
 *     89b43a2250d83283
 *
 * @apiError 403 If provider has flag check_token and token missing or invalid
 * @apiErrorExample {json} Token
 *     { error: { code: 403, message: "Missing or invalid token" } }
 *
 */
exports.get = function(params, callback) {
  validateParams(params, function(err) {
    if (err) {
      callback(err);
    } else {
      cache.get([params.provider, params.content_id, params.sequence_id || 0].join('_'), function(err, license) {
        if (err) {
          callback(err);
        } else {
          callback(null, license);
        }
      });
    }
  });
};

/**
 * Validations specific for licenses
 * content_id should be present and numeric
 * sequence_id should be numeric if present
 * @param {Object} params
 * @param {Function} callback
 * @return {Error | null}
 */
function validateParams(params, callback) {
  if (!params.content_id || params.content_id != parseInt(params.content_id)) {
    return callback({ code: 400, message: 'Missing or invalid content_id' });
  }
  if (params.sequence_id && params.sequence_id != parseInt(params.sequence_id)) {
    return callback({ code: 400, message: 'Invalid sequence_id' });
  }
  callback();
}

/**
 * Prepare license for api output
 * @param  {Object} license
 * @return {Object} license
 */
function pretty(license) {
  license.license = license.license.toString('hex');
  return license;
}