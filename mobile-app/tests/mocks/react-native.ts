module.exports = {
  Platform: { OS: 'ios', select: (o) => o.ios },
  Alert: { alert: () => {} },
  useColorScheme: () => ({ dark: false }),
};
