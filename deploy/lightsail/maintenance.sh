#!/usr/bin/env bash
set -euo pipefail

# Safe maintenance script for Lightsail nginx/PHP deployments (interactive)
# - Shows resource usage
# - Optionally stops dev servers (pm2, vite, node)
# - Truncates common large logs (ask before truncating)
# - Restarts nginx and php-fpm if present
# - Shows final resource snapshot

PROJECT_DIR="/var/www/carevance"
LOG_PATHS=("$PROJECT_DIR/frontend/vite-dev.log" "$PROJECT_DIR/frontend/vite-dev.err.log" "$PROJECT_DIR/backend/carevance-backend-local.log" "$PROJECT_DIR/backend/carevance-backend-local.err.log")

echo "== Resource snapshot =="
free -h || true
uptime || true
ps aux --sort=-%mem | head -n 10 || true

read -p "Proceed to list candidate dev processes (node/vite/pm2)? (y/N): " -r
if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  echo "\n== Candidate processes =="
  ps aux | egrep 'node|vite|npm|pm2' | egrep -v 'egrep|maintenance.sh' || true
  read -p "Kill these candidate processes? This will stop development servers (y/N): " -r
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then
    if command -v pm2 >/dev/null 2>&1; then
      echo "Stopping PM2-managed apps..."
      pm2 stop all || true
    fi
    echo "Killing vite/node/npm dev processes..."
    pkill -f vite || true
    pkill -f 'npm run dev' || true
    pkill -f 'node .*vite' || true
    pkill -f node || true
    sleep 1
  else
    echo "Skipping killing dev processes."
  fi
else
  echo "Skipping process listing."
fi

# Truncate logs (ask before each)
for f in "${LOG_PATHS[@]}"; do
  if [ -f "$f" ]; then
    ls -lh "$f"
    read -p "Truncate $f? (makes file size 0) (y/N): " -r
    if [[ "$REPLY" =~ ^[Yy]$ ]]; then
      sudo truncate -s 0 "$f" && echo "Truncated $f"
    else
      echo "Left $f untouched"
    fi
  fi
done

# Restart nginx
if systemctl list-unit-files | grep -q nginx; then
  echo "Restarting nginx..."
  sudo systemctl restart nginx || sudo service nginx restart || true
fi

# Restart common php-fpm services if present
PHP_SERVICES=(php8.4-fpm php8.3-fpm php8.2-fpm php8.1-fpm php8.0-fpm php7.4-fpm php-fpm)
for svc in "${PHP_SERVICES[@]}"; do
  if systemctl list-unit-files | grep -q "$svc"; then
    echo "Restarting $svc..."
    sudo systemctl restart "$svc" || true
  fi
done

# Optionally clear caches (ask)
read -p "Run composer install --no-dev --optimize-autoloader in backend? (Only if you know it's safe) (y/N): " -r
if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  if [ -d "$PROJECT_DIR/backend" ]; then
    pushd "$PROJECT_DIR/backend" >/dev/null
    sudo composer install --no-dev --optimize-autoloader --no-interaction || true
    popd >/dev/null
  else
    echo "Backend directory not found at $PROJECT_DIR/backend"
  fi
fi

read -p "Run npm ci --production in frontend? (Only if you know it's safe) (y/N): " -r
if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  if [ -d "$PROJECT_DIR/frontend" ]; then
    pushd "$PROJECT_DIR/frontend" >/dev/null
    npm ci --production || true
    npm run build || true
    popd >/dev/null
  else
    echo "Frontend directory not found at $PROJECT_DIR/frontend"
  fi
fi

echo "== Final resource snapshot =="
free -h || true
ps aux --sort=-%mem | head -n 10 || true

echo "Maintenance script completed. If the site still feels slow, consider upgrading instance RAM or moving builds to CI and serving prebuilt assets via nginx."
