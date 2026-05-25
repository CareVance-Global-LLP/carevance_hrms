window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};

(function applyLocalRuntimeDefaults(config) {
  if (typeof window === 'undefined' || !window.location) {
    return;
  }

  var isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocalHost) {
    return;
  }

  if (!config.VITE_API_URL) {
    config.VITE_API_URL = 'http://127.0.0.1:8000/api';
  }

  if (!config.VITE_WEB_APP_URL) {
    config.VITE_WEB_APP_URL = 'http://localhost:5173';
  }

  if (!config.VITE_DESKTOP_DOWNLOAD_URL) {
    config.VITE_DESKTOP_DOWNLOAD_URL = 'http://127.0.0.1:8000/api/downloads/desktop/windows';
  }
})(window.__APP_CONFIG__);
