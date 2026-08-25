import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/hooks/useAuth';
import { useTheme } from '../src/hooks/useTheme';
import { useToast } from '../src/components/Toast';
import type { ThemeColors } from '../src/constants/theme';

export default function LoginScreen() {
  const { login, isAuthenticated } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (isAuthenticated) router.replace('/(tabs)'); }, [isAuthenticated]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { toast.error('Please enter email and password'); return; }
    setLoading(true);
    try { await login(email.trim(), password); }
    catch (err: any) {
      const data = err?.response?.data;
      const fieldError = data?.errors?.email?.[0] || data?.errors?.password?.[0];
      const message = fieldError
        || (data?.message === 'The given data was invalid.' ? null : data?.message)
        || err?.message
        || 'Login failed';
      toast.error(message);
    }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={s.wrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <View style={s.logoCircle}>
            <Text style={s.logoText}>C</Text>
          </View>
          <Text style={s.title}>CareVance HRMS</Text>
          <Text style={s.subtitle}>Sign in to your account</Text>
        </View>
        <View style={s.form}>
          <Text style={s.label}>Email</Text>
          <TextInput style={s.input} placeholder="you@company.com" placeholderTextColor={colors.textTertiary} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          <Text style={s.label}>Password</Text>
          <TextInput style={s.input} placeholder="Enter password" placeholderTextColor={colors.textTertiary} value={password} onChangeText={setPassword} secureTextEntry />
          <TouchableOpacity style={[s.button, loading && s.buttonDisabled]} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Sign In</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: c.background },
  container: { flex: 1, paddingHorizontal: 24 },
  header: { alignItems: 'center', marginTop: 60, marginBottom: 48 },
  logoCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  logoText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  subtitle: { fontSize: 14, color: c.textSecondary, marginTop: 4 },
  form: { flex: 1 },
  label: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 6 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, fontSize: 16, color: c.text, marginBottom: 16 },
  button: { backgroundColor: c.primary, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
