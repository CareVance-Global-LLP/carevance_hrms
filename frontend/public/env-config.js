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

// ── Feature toggles (edit per-deployment, no rebuild needed) ──────────
//
// Anything set here WINS over the build-time value from .env — runtimeConfig
// reads the runtime value first and only falls back to the build value when it
// is empty. So leave these commented out unless a specific deployment really
// has to override its build.
//
// This file previously ended with an unconditional
//     window.__APP_CONFIG__.VITE_PAYROLL_ENABLED = "false";
// placed outside the localhost guard above, which meant every environment —
// production included — hid payroll regardless of what the build or the
// customer's plan said. Payroll entitlement is decided by the plan
// (`usePlan().isPayrollPlan`) plus VITE_PAYROLL_ENABLED from .env; this file
// should not have an opinion by default.
//
// To force payroll off for one deployment, uncomment:
// window.__APP_CONFIG__.VITE_PAYROLL_ENABLED = "false";
