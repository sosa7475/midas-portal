import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import GlassCard from './GlassCard';
import PrimaryButton from './PrimaryButton';
import { Colors, Typography, Spacing, Radius } from '../theme';
import { useStore } from '../store';

interface TradeRec {
  pair: string;
  side: 'long' | 'short';
  entry: number | null;
  size: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}

interface Props {
  trade: TradeRec;
  onConfirm: () => void;
  onReject: () => void;
  isLoading?: boolean;
}

export default function TradeCard({ trade, onConfirm, onReject, isLoading }: Props) {
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;
  const isLong = trade.side === 'long';

  const rr =
    trade.entry && trade.stopLoss && trade.takeProfit
      ? Math.abs((trade.takeProfit - trade.entry) / (trade.entry - trade.stopLoss)).toFixed(1)
      : null;

  return (
    <GlassCard style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.pair, { color: theme.text }]}>{trade.pair}</Text>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Trade Recommendation</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: isLong ? Colors.profit + '22' : Colors.loss + '22' }]}>
          <Text style={[styles.badgeText, { color: isLong ? Colors.profit : Colors.loss }]}>
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </Text>
        </View>
      </View>

      {/* Stats grid */}
      <View style={styles.grid}>
        <Stat label="Entry" value={trade.entry ? `$${trade.entry.toLocaleString()}` : 'Market'} color={theme.text} />
        <Stat label="Size" value={trade.size ? `${trade.size}` : '—'} color={theme.text} />
        <Stat label="Stop-Loss" value={trade.stopLoss ? `$${trade.stopLoss.toLocaleString()}` : '—'} color={Colors.loss} />
        <Stat label="Take-Profit" value={trade.takeProfit ? `$${trade.takeProfit.toLocaleString()}` : '—'} color={Colors.profit} />
        {rr && <Stat label="Risk:Reward" value={`1:${rr}`} color={Colors.primary} />}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <PrimaryButton label="Confirm Trade" onPress={onConfirm} loading={isLoading} style={styles.confirmBtn} />
        <PrimaryButton label="Reject" onPress={onReject} variant="ghost" style={styles.rejectBtn} />
      </View>
    </GlassCard>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginVertical: Spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  pair: { fontSize: Typography.sizes.lg, fontWeight: Typography.weights.bold },
  label: { fontSize: Typography.sizes.sm, marginTop: 2 },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  badgeText: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.semibold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  stat: { width: '47%' },
  statLabel: { fontSize: Typography.sizes.xs, marginBottom: 2 },
  statValue: { fontSize: Typography.sizes.base, fontWeight: Typography.weights.semibold },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  confirmBtn: { flex: 1 },
  rejectBtn: { flex: 1 },
});
