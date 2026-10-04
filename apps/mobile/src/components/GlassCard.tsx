import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Colors, Radius, Spacing } from '../theme';
import { useStore } from '../store';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
  noPadding?: boolean;
}

export default function GlassCard({ children, style, intensity = 20, noPadding = false }: Props) {
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;

  return (
    <View style={[styles.wrapper, { borderColor: theme.bgCardBorder }, style]}>
      <BlurView intensity={intensity} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={[styles.inner, !noPadding && styles.padding]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  inner: { flex: 1 },
  padding: { padding: Spacing.base },
});
