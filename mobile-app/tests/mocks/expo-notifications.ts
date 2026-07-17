// Minimal mocks so Jest can import app modules without native Expo runtime.

export const Subscription = class {};

export const setNotificationHandler = (_handler: any) => {};
export const setNotificationCategoryAsync = async () => ({});
export const addNotificationResponseReceivedListener = (_cb: any) => ({ remove: () => {} });
export const getPermissionsAsync = async () => ({ status: 'granted' });
export const requestPermissionsAsync = async () => ({ status: 'granted' });
export const getExpoPushTokenAsync = async () => ({ data: 'fake-token' });
