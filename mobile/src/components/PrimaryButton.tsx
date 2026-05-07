import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Typography, Radius, Spacing, Shadows } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
  style?: ViewStyle;
}

export default function PrimaryButton({ label, onPress, loading, disabled, variant = 'primary', style }: Props) {
  if (variant === 'ghost') {
    return (
      <TouchableOpacity style={[styles.ghost, style]} onPress={onPress} disabled={disabled || loading} activeOpacity={0.7}>
        {loading ? <ActivityIndicator color={Colors.primary} size="small" /> : <Text style={styles.ghostText}>{label}</Text>}
      </TouchableOpacity>
    );
  }

  const colors: [string, string] = variant === 'danger'
    ? ['#EF4444', '#DC2626']
    : [Colors.primary, Colors.primaryDark];

  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading} activeOpacity={0.85} style={[Shadows.glow, style]}>
      <LinearGradient colors={colors} style={styles.button} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
        {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.label}>{label}</Text>}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#fff',
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
    letterSpacing: 0.3,
  },
  ghost: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  ghostText: {
    color: Colors.primary,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
  },
});
