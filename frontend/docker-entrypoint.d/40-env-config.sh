#!/bin/sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__APP_CONFIG__ = {
  VITE_API_URL: "$(json_escape "${VITE_API_URL:-}")",
  VITE_WEB_APP_URL: "$(json_escape "${VITE_WEB_APP_URL:-}")",
  VITE_DESKTOP_DOWNLOAD_URL: "$(json_escape "${VITE_DESKTOP_DOWNLOAD_URL:-}")",
  VITE_DESKTOP_DOWNLOAD_LABEL: "$(json_escape "${VITE_DESKTOP_DOWNLOAD_LABEL:-}")",
  VITE_SALES_EMAIL: "$(json_escape "${VITE_SALES_EMAIL:-}")",
  VITE_SUPPORT_EMAIL: "$(json_escape "${VITE_SUPPORT_EMAIL:-}")",
  VITE_GA_MEASUREMENT_ID: "$(json_escape "${VITE_GA_MEASUREMENT_ID:-}")",
  VITE_PLAUSIBLE_DOMAIN: "$(json_escape "${VITE_PLAUSIBLE_DOMAIN:-}")",
  VITE_POSTHOG_KEY: "$(json_escape "${VITE_POSTHOG_KEY:-}")",
  VITE_POSTHOG_HOST: "$(json_escape "${VITE_POSTHOG_HOST:-}")",
  VITE_GOOGLE_OAUTH_ENABLED: "$(json_escape "${VITE_GOOGLE_OAUTH_ENABLED:-}")",
  VITE_IDLE_TRACK_THRESHOLD_SECONDS: "$(json_escape "${VITE_IDLE_TRACK_THRESHOLD_SECONDS:-}")",
  VITE_IDLE_AUTO_STOP_THRESHOLD_SECONDS: "$(json_escape "${VITE_IDLE_AUTO_STOP_THRESHOLD_SECONDS:-}")",
  VITE_IDLE_GUARD_INTERVAL_MS: "$(json_escape "${VITE_IDLE_GUARD_INTERVAL_MS:-}")",
  VITE_REVERB_APP_KEY: "$(json_escape "${VITE_REVERB_APP_KEY:-}")",
  VITE_REVERB_HOST: "$(json_escape "${VITE_REVERB_HOST:-}")",
  VITE_REVERB_PORT: "$(json_escape "${VITE_REVERB_PORT:-}")",
  VITE_REVERB_SCHEME: "$(json_escape "${VITE_REVERB_SCHEME:-}")"
};
EOF
