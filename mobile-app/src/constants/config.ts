import Constants from 'expo-constants';

const ENV = {
  development: {
    API_URL: 'http://192.168.0.72:8000/api',
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
