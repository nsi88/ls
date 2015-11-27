var create_root_provider = new Migration({
  up: function() {
    // TODO Migration#before
    var ls = require('../lib/ls');
    var providers = require('../lib/providers');
    var root_provider = require('./seeds/root_provider');
    ls.init(function() {
      ls.mysqlConnect(function() {
        providers.create(root_provider, function(err, provider) {
          if (err) {
            console.log(err);
          } else {
            console.log('Root provider created');
            console.log(provider)
          }
        });
      });
    });
	},
	down: function() {
    var ls = require('../lib/ls');
    var providers = require('../lib/providers');
    var root_provider = require('./seeds/root_provider');
    ls.init(function() {
      ls.mysqlConnect(function() {
        providers.destroy({ name: root_provider.name }, function(err, provider) {
          if (err) {
            console.log(err);
          } else {
            console.log('Root provider destroyed');
            console.log(provider);
          }
        });
      });
    });
	}
});