'use strict';

/**
 * Token verification
 * @module  tokens
 */

var sign = require('./sign');
var ls = require('./ls');

/**
 * Verify token.
 * Check expiration part, signature, and make sure it doesn't already exist in db.
 * Expiration - UTC timestamp (in seconds)
 * For signature the same algorithm used as for requests signature.
 * If token valid, write it to db and callback true.
 * @param  {String} token {payload[16]}{signature[44]}{exp[10]}
 * @param  {String} iv
 * @param  {String} key
 * @param  {Function} callback
 * @return {Boolean}
 */
exports.verify = function(token, iv, key, callback) {
  if (!token || token.length != 70) {
    return callback(false);
  }
  
  var exp = token.slice(60, 70);
  if (isNaN(exp) || exp < (Date.now() / 1000)) {
    console.debug('Expired token', token, exp, ' < ', (Date.now() / 1000));
    return callback(false);
  }
  
  var payload = token.slice(0, 16);
  var signature = token.slice(16, 60);
  if (!sign.verify({ sign: signature, payload: payload, exp: exp }, iv, key)) {
    console.debug('Wrong signature for token', token);
    return callback(false);
  }

  ls.database.query('SELECT * FROM tokens WHERE payload = ? LIMIT 1', payload, function(err, result) {
    if (err) {
      console.error(err);
      callback(false);
    } else if (result[0]) {
      console.debug('Token already used', token);
      callback(false);
    } else {
      ls.database.query('INSERT INTO tokens SET ?', { payload: payload, exp: exp }, function(err, result) {
        console.debug('Save token', token);
        if (err) {
          console.error(err)
          callback(false);
        } else {
          callback(true);
        }
      });
    }
  });
};

/**
 * Delete expired (expiration < Date.now() / 1000) tokens from DB
 * @param  {Function} callback
 * @return {Error | Number} Error or count of deleted tokens
 */
exports.deleteExpired = function(callback) {
  console.debug('Delete expired tokens');
  ls.database.query('DELETE FROM tokens WHERE exp < ?', Date.now() / 1000, function(err, result) {
    if (err) {
      console.error(err);
      callback(err);
    } else {
      console.info('Deleted tokens:', result.affectedRows);
      callback(null, result.affectedRows);
    }
  });
};