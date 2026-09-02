import Constants from 'expo-constants';

// Auto-detect the LAN host the app was loaded from (e.g. "192.168.0.81:8081")
// so the API URL always matches the PC running Metro, even if the IP changes.
const hostUri =
  Constants.expoConfig?.hostUri ??
  (Constants as any).expoGoConfig?.debuggerHost ??
  (Constants as any).manifest?.debuggerHost ??
  '';
const lanHost = hostUri.split(':')[0];
const devApiUrl = lanHost
  ? `http://${lanHost}:8000/api`
  : 'http://192.168.0.71:8000/api';

const ENV = {
  development: {
    API_URL: devApiUrl,
  },
  staging: {
    API_URL: 'https://staging-api.carevance.com/api',
  },
  production: {
    API_URL: 'https://api.carevance.com/api',
  },
};

const getEnvVars = () => {
  const expoEnv = Constants.expoConfig?.extra?.env ?? 'development';
  return ENV[expoEnv as keyof typeof ENV] ?? ENV.development;
};

export const config = getEnvVars();
