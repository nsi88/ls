Authors: Inventos Company <contacts@inventos.ru> 
Version: 2015-11-26

Please do NOT copy or redistribute without permission.

# License Server

## Installation


1. Create licenses database. Configure connect in config/database.yml. Run migrations 
    
    cd db && NODE_ENV=<env> node migrate.js migrate

2. Create providers database. It should be located on different servers than licenses. Create providers table manually

    CREATE TABLE `providers` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT, 
    `crypto_iv` varbinary(7) NOT NULL,
    `crypto_key` varbinary(8) NOT NULL,
    `sign_iv` varbinary(7) NOT NULL,
    `sign_key` varbinary(8) NOT NULL,
    PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;

Configure connect in config/providers.yml. Use ssl connection. See:
    
<https://dev.mysql.com/doc/refman/5.6/en/creating-ssl-files-using-openssl.html>

<https://dev.mysql.com/doc/refman/5.6/en/using-ssl-connections.html>