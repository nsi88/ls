'use strict';

/**
 * @apiDefine Provider
 * 
 * @apiSuccess {String} name Name of created provider
 * @apiSuccess {Object} flags Providers flags
 * @apiSuccess {Buffer[7]} sign_iv Subscription key pair IV
 * @apiSuccess {Buffer[8]} sign_key Subscription key pair KEY
 * 
 * @apiSuccessExample {json} Provider
 *     { 
 *       name: "provider_1",
 *       flags: { check_sign: 0, check_token: 0, manage_providers: 0 },
 *       sign_iv: '05722b9ae85937be4b213af04e2d43e3',
 *       sign_key: '0b89ac4b822ced9627e6c37d331161b4a2a4cf9760fd804a6c3d01281706804d'
 *     }
 */

var crypto = require('crypto');
var ls = require('./ls');

// Flags
var FLAGS = {
  check_sign: 1,
  check_token: 2,
  manage_providers: 4
};
// Длина ключей в байтах
var IV_LENGTH = 16;
var KEY_LENGTH = 32;

/**
 * @api {post} /providers Create a new Provider
 * @apiName CreateProvider
 * @apiGroup Provider
 *
 * @apiParam {String {5..255} = [a-zA-Z0-9_]} name Providers unique name
 * @apiParam {Object} [flags="{check_sign: 0, check_token: 0, manage_providers: 0}"]
 *     * check_sign - Check signature for get key requests. For other requests signature is always checked
 *     * check_sign - Check one time token for get key requests
 *     * manage_providers - The provider can create/delete other providers
 *
 * @apiError 400 If name missing or has invalid format
 * @apiError 409 If name exists
 * @apiError 500 If an internal server error happened
 * @apiErrorExample {json} If name exists:
 *     { error: { code: 409, message: "Name exists" } }
 *
 * @apiUse Provider
 */
exports.create = function(params, callback) {
  validate(params, function(err) {
    if (err) {
      callback(err);
    } else {
      var providerP = {
        sign_iv: crypto.randomBytes(IV_LENGTH),
        sign_key: crypto.randomBytes(KEY_LENGTH),
        crypto_iv: crypto.randomBytes(IV_LENGTH),
        crypto_key: crypto.randomBytes(KEY_LENGTH)
      };
      console.debug('providers:', { sign_iv: providerP.sign_iv.toString('hex'), sign_key: providerP.sign_key.toString('hex'), crypto_iv: '[hidden]', crypto_key: '[hidden]' });
      ls.providers.query('INSERT INTO providers SET ?', providerP, function(err, result) {
        if (err) {
          console.error(err);
          callback({ code: 500 });
        } else {
          var providerD = {
            name: params.name,
            encryption_key_id: result.insertId,
            flags: sumFlags(params.flags)
          };
          console.debug('database:', providerD);
          ls.database.query('INSERT INTO providers SET ?', providerD, function(err, result) {
            if (err) {
              console.error(err);
              console.debug('delete provider from providers');
              ls.providers.query('DELETE FROM providers WHERE id = ?', providerD.encryption_key_id, function(errDel) {
                if (errDel) {
                  console.error(errDel);
                }
                callback({ code: 500 });
              });
            } else {
              for (var f in providerD) {
                providerP[f] = providerD[f];
              }
              callback(null, pretty(providerP));
            }
          });
        }
      });
    }
  });
};

/**
 * @api {delete} /providers/:name Delete a Provider
 * @apiName DeleteProvider
 * @apiGroup Provider
 *
 * @apiParam {String} name Providers name
 *
 * @apiError 404 If provider doesn't exist
 * @apiError 500 If an internal error happened
 * @apiErrorExample {json} If providers doesn't exist:
 *     { error: { code: 404, message: 'Not Found' } }
 *
 * @apiUse Provider
 */
exports.destroy = function(params, callback) {
  // This condition normally should not pass because of routes
  if (!params.name) {
    callback({ code: 404, message: 'Name missing' });
  } else {
    ls.database.query('SELECT * FROM providers WHERE name = ?', params.name, function(err, result) {
      if (err) {
        console.error(err);
        callback({ code: 500 });
      } else if (!result[0]) {
        console.debug('Provider', params.name, 'not found');
        callback({ code: 404 });
      } else {
        var provider = result[0];
        console.info('Delete', provider);
        // NOTE sign_iv, sign_key запрашиваются для единообразности ответа при создании и удалении. Не уверен, что это надо
        ls.providers.query('SELECT sign_iv, sign_key FROM providers WHERE id = ?', provider.encryption_key_id, function(err, result) {
          if (err) {
            console.error(err);
          } else if (!result[0]) {
            console.error('Provider', params.name, 'not found in providers db');
          } else {
            provider.sign_iv = result[0].sign_iv;
            provider.sign_key = result[0].sign_key;
          }
          ls.providers.query('DELETE FROM providers WHERE id = ?', provider.encryption_key_id, function(err) {
            if (err) {
              console.error(err);
              callback({ code: 500 });
            } else {
              ls.database.query('DELETE FROM providers WHERE id = ?', provider.id, function(err) {
                if (err) {
                  console.error(err);
                  callback({ code: 500 });
                } else {
                  callback(null, pretty(provider));
                }
              });
            }
          });
        });
      }
    });
  }
};

function validate(params, callback) {
  if (!params.name) {
    return callback({ code: 400, message: 'Name missing' });
  }
  if (!/^\w{5,255}$/.test(params.name)) {
    return callback({ code: 400, message: 'Invalid name' });
  }
  ls.database.query("SELECT COUNT(*) AS count FROM providers WHERE name = ?", params.name, function(err, result) {
    if (err) {
      console.error(err);
      callback({ code: 500 });
    } else if (result[0].count) {
      callback({ code: 409, message: 'Name exists' });
    } else {
      callback();
    }
  });
}

/**
 * Sum all object flags to one number
 * @param  {Object} flags Object of flags
 * @return {Number}
 */
function sumFlags(flags) {
  var sum = 0;
  if (flags) {
    for (var f in flags) {
      if (flags[f]) {
        sum = sum | FLAGS[f];
      }
    }
  }
  return sum;
}

/**
 * Convert flags number back to object
 * @param  {Number} flags Numeric representation of flags
 * @return {Object}
 */
function parseFlags(flags) {
  var obj = {};
  for (var f in FLAGS) {
    obj[f] = (flags & FLAGS[f]) ? 1 : 0;
  }
  return obj;
}

/**
 * Handle provider fields before return. Parse flags. Stringify keys. Filter fields
 * @param  {Object} provider Provider as it's presented in database
 * @return {Object} Pretty provider
 */
function pretty(provider) {
  return {
    name: provider.name,
    flags: parseFlags(provider.flags),
    sign_iv: provider.sign_iv.toString('hex'),
    sign_key: provider.sign_key.toString('hex')
  };
}