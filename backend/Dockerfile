FROM composer:2.8 AS vendor

WORKDIR /app
COPY . .
# --ignore-platform-req=ext-gd: the composer image has zip but not gd, so
# resolving phpoffice/phpspreadsheet's ext-gd here fails and takes the whole
# backend image build with it — this stage does not build today. The
# requirement is real, and it is satisfied where the code actually runs: the
# runtime stage below installs gd. Nothing is resolved differently, because
# `install` replays composer.lock rather than re-solving it.
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader \
        --ignore-platform-req=ext-gd

# FrankenPHP replaces `php artisan serve`, which Laravel documents as a
# single-threaded development server — two concurrent testers serialised behind
# each other. It is an HTTP server and a PHP runtime in one binary, so it swaps
# in without adding an fpm socket and a second nginx to configure.
FROM dunglas/frankenphp:1-php8.4

# The container contract is the port, not the server: frontend/nginx.conf
# proxies `/api/` to `backend:10000` and the compose files publish the same.
# A bare `:port` site address also tells Caddy not to attempt a certificate —
# TLS is terminated one hop out, by the edge Caddy in deploy/lightsail.
ENV SERVER_NAME=:10000
ENV SERVER_ROOT=/var/www/html/public

WORKDIR /var/www/html

# pdo_pgsql is what the app talks to Postgres with. gd and zip are hard
# requirements of phpoffice/phpspreadsheet (composer.lock: ext-gd, ext-zip) and
# dompdf, which every payroll filing and Form 16 render goes through — the old
# php:8.4-cli runtime shipped neither, so those paths failed at runtime.
RUN install-php-extensions \
        pdo_pgsql \
        gd \
        zip \
        intl \
        opcache

RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

# `artisan serve` ran under the CLI SAPI, where max_execution_time is forced to
# 0. FrankenPHP is not the CLI SAPI, so php.ini-production's 30s would newly
# kill long requests — filing generation and the bank file are both over it.
# 300s/512M are the values docker-compose.production.yml declared as intent and
# could never apply, because php:8.4-cli reads neither of those env vars.
RUN printf 'max_execution_time=300\nmemory_limit=512M\n' \
        > "$PHP_INI_DIR/conf.d/zz-carevance.ini"

COPY --from=vendor /app/vendor ./vendor
COPY . .

EXPOSE 10000

# No CMD: the base image already runs `frankenphp run` against its own Caddyfile,
# which reads SERVER_NAME and SERVER_ROOT above.
#
# The old CMD also ran `php artisan storage:link || true` on every start. Nothing
# is lost by dropping it: public/storage is a real committed directory here, not
# a link, so storage:link has always failed with "the link already exists" and
# the `|| true` hid it. Recreating it as a symlink would move where screenshots
# are served from.
#
# Deliberately no `artisan migrate` either. Migrations are an explicit deploy
# step now, so they run once per deploy instead of on every container restart,
# and a failure surfaces to the deploy rather than to a crash-looping container.
