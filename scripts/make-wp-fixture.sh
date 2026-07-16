#!/usr/bin/env bash
# Generate a tiny synthetic WordPress + WooCommerce fixture for smoke tests.
# Default location: /tmp/wp-fixture. Pass a path as $1 to override.

set -euo pipefail

ROOT="${1:-/tmp/wp-fixture}"
rm -rf "$ROOT"
mkdir -p "$ROOT/wp-content/themes/storefront"
mkdir -p "$ROOT/wp-content/plugins/woocommerce"
mkdir -p "$ROOT/wp-content/plugins/akismet"

cat > "$ROOT/wp-config.php" <<'PHP'
<?php
define( 'DB_NAME',     'wordpress' );
define( 'DB_USER',     'root' );
define( 'DB_PASSWORD', 'root' );
define( 'DB_HOST',     'localhost' );
define( 'WP_HOME',     'http://localhost:8080' );
define( 'WP_SITEURL',  'http://localhost:8080' );
define( 'WP_DEBUG',    true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_MEMORY_LIMIT', '256M' );

$table_prefix = 'wp_';

if ( !defined('ABSPATH') ) {
    define('ABSPATH', dirname(__FILE__) . '/');
}
require_once(ABSPATH . 'wp-settings.php');
PHP

touch "$ROOT/wp-settings.php" "$ROOT/wp-load.php"

cat > "$ROOT/wp-content/themes/storefront/style.css" <<'CSS'
/*
Theme Name: Storefront
Theme URI: https://woocommerce.com/storefront/
Author: WooCommerce
Description: Storefront fixture for detection tests.
Version: 4.0.0
*/
CSS

cat > "$ROOT/wp-content/plugins/woocommerce/woocommerce.php" <<'PHP'
<?php
/*
Plugin Name: WooCommerce
Plugin URI: https://woocommerce.com/
Description: WooCommerce fixture for detection tests.
Version: 9.0.0
*/
PHP

cat > "$ROOT/wp-content/plugins/akismet/akismet.php" <<'PHP'
<?php
/*
Plugin Name: Akismet Anti-Spam
Description: Akismet fixture for detection tests.
Version: 5.0.0
*/
PHP

echo "WP fixture ready at $ROOT"
