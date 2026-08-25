module.exports = {
  Platform: { OS: 'ios', select: (o) => o.ios },
  Alert: { alert: () => {} },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: () => {} }),
  },
  useColorScheme: () => ({ dark: false }),
};
