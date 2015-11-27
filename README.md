Authors: Inventos Company <contacts@inventos.ru> 
Version: 2015-11-26

Please do NOT copy or redistribute without permission.

# License Server

## Installation

1. Create licenses database. Configure config/database.yml

2. Create providers database. Locate it on different servers than licenses and use ssl connections. Configure config/providers.yml. Create providers table manually (migrations work only with licenses database)

    CREATE TABLE `providers` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT, 
    `crypto_iv` varbinary(16) NOT NULL,
    `crypto_key` varbinary(32) NOT NULL,
    `sign_iv` varbinary(16) NOT NULL,
    `sign_key` varbinary(32) NOT NULL,
    PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;

3. Check and edit, if you need, db/seeds/root_provider.js

4. Run migrations
    
    cd db && NODE_ENV=<env> node migrate.js migrate

5. Save sign_iv and sign_key of root provider from migrations output. Example:

    Root provider created
    { name: 'root_provider',
    flags: { check_sign: 0, check_token: 0, manage_providers: 1 },
    sign_iv: '5676cce6c013a39a7e50c9e4300688fd',
    sign_key: '5f7311f878b79dc2e40a5aa9ab235a83b414a8df2650041e56b24e82f27fcffd' }