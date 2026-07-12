import { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView,
  Platform, TouchableOpacity, Alert, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { authAPI } from '../../src/services/api';
import { useStore } from '../../src/store';
import PrimaryButton from '../../src/components/PrimaryButton';
import { Colors, Typography, Spacing, Radius } from '../../src/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const setAuth = useStore((s) => s.setAuth);
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const res = isRegister
        ? await authAPI.register(email.trim(), password, displayName.trim() || undefined)
        : await authAPI.login(email.trim(), password);
      await setAuth(res.data.token, res.data.user);
      router.replace('/(tabs)/chat');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <LinearGradient colors={isDark ? ['#0F0F0F', '#0D1F17'] : ['#FAFAFA', '#F0FDF4']} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kav}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={styles.logoArea}>
            <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.logoCircle}>
              <Text style={styles.logoText}>M</Text>
            </LinearGradient>
            <Text style={[styles.appName, { color: theme.text }]}>Midas Portal</Text>
            <Text style={[styles.tagline, { color: theme.textSecondary }]}>Trade with discipline</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {isRegister && (
              <TextInput
                style={[styles.input, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text }]}
                placeholder="Display name (optional)"
                placeholderTextColor={theme.textMuted}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
            )}
            <TextInput
              style={[styles.input, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text }]}
              placeholder="Email"
              placeholderTextColor={theme.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={[styles.input, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text }]}
              placeholder="Password"
              placeholderTextColor={theme.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <PrimaryButton
              label={isRegister ? 'Create Account' : 'Sign In'}
              onPress={handleSubmit}
              loading={loading}
              style={styles.submitBtn}
            />

            <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={styles.switchBtn}>
              <Text style={[styles.switchText, { color: theme.textSecondary }]}>
                {isRegister ? 'Already have an account? ' : "Don't have an account? "}
                <Text style={{ color: Colors.primary }}>{isRegister ? 'Sign In' : 'Register'}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing['2xl'] },
  logoArea: { alignItems: 'center', marginBottom: Spacing['3xl'] },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.base,
  },
  logoText: { fontSize: Typography.sizes['2xl'], fontWeight: Typography.weights.bold, color: '#fff' },
  appName: { fontSize: Typography.sizes['2xl'], fontWeight: Typography.weights.bold },
  tagline: { fontSize: Typography.sizes.sm, marginTop: Spacing.xs },
  form: { gap: Spacing.md },
  input: {
    borderWidth: 1, borderRadius: Radius.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    fontSize: Typography.sizes.base,
  },
  submitBtn: { marginTop: Spacing.sm },
  switchBtn: { alignItems: 'center', marginTop: Spacing.sm },
  switchText: { fontSize: Typography.sizes.sm },
});
