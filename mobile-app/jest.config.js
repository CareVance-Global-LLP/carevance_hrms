/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  moduleNameMapper: {
    '^expo/(.*)$': '<rootDir>/tests/mocks/expo.ts',
    '^expo-router$': '<rootDir>/tests/mocks/expo-router.ts',
    '^expo-notifications$': '<rootDir>/tests/mocks/expo-notifications.ts',
    '^expo-haptics$': '<rootDir>/tests/mocks/expo-haptics.ts',
    '^expo-linking$': '<rootDir>/tests/mocks/expo-linking.ts',
    '^expo-secure-store$': '<rootDir>/tests/mocks/expo-secure-store.ts',
    '^expo-constants$': '<rootDir>/tests/mocks/expo-constants.ts',
    '^react-native$': '<rootDir>/tests/mocks/react-native.ts',
  },
};
