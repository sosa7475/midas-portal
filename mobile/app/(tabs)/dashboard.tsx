import { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, RefreshControl, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useStore } from '../../src/store';
import { walletAPI, tradeAPI } from '../../src/services/api';
import GlassCard from '../../src/components/GlassCard';
import { Colors, Typography, Spacing, Radius } from '../../src/theme';
import { useState } from 'react';

export default function DashboardScreen() {
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;
  const { balance, setBalance, trades, setTrades, user } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(!balance);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [balRes, tradeRes] = await Promise.allSettled([walletAPI.getBalance(), tradeAPI.history(10)]);
      if (balRes.status === 'fulfilled') setBalance(balRes.value.data);
      if (tradeRes.status === 'fulfilled') setTrades(tradeRes.value.data.trades);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const recentTrades = trades.slice(0, 5);
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winRate = trades.length > 0
    ? Math.round((trades.filter((t) => (t.pnl || 0) > 0).length / trades.filter((t) => t.pnl != null).length) * 100)
    : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <LinearGradient colors={isDark ? ['#0F0F0F', '#0D1F17'] : ['#FAFAFA', '#F0FDF4']} style={StyleSheet.absoluteFill} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={Colors.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.greeting, { color: theme.textSecondary }]}>Good {getTimeOfDay()},</Text>
          <Text style={[styles.name, { color: theme.text }]}>{user?.displayName || user?.email?.split('@')[0] || 'Trader'}</Text>
        </View>

        {/* Balance card */}
        <GlassCard style={styles.balanceCard}>
          <Text style={[styles.balLabel, { color: theme.textSecondary }]}>Total Collateral</Text>
          {loading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.sm }} />
          ) : balance ? (
            <>
              <Text style={[styles.balAmount, { color: theme.text }]}>${Number(balance.totalCollateral || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
              <View style={styles.balRow}>
                <Text style={[styles.balSub, { color: theme.textSecondary }]}>
                  Free: ${Number(balance.freeCollateral || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            </>
          ) : (
            <Text style={[styles.balEmpty, { color: theme.textMuted }]}>Connect your wallet to see balance</Text>
          )}
        </GlassCard>

        {/* Stats row */}
        {trades.length > 0 && (
          <View style={styles.statsRow}>
            <GlassCard style={styles.statCard}>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Total P&L</Text>
              <Text style={[styles.statValue, { color: totalPnl >= 0 ? Colors.profit : Colors.loss }]}>
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
              </Text>
            </GlassCard>
            <GlassCard style={styles.statCard}>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Win Rate</Text>
              <Text style={[styles.statValue, { color: Colors.primary }]}>{winRate != null ? `${winRate}%` : '—'}</Text>
            </GlassCard>
            <GlassCard style={styles.statCard}>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Trades</Text>
              <Text style={[styles.statValue, { color: theme.text }]}>{trades.length}</Text>
            </GlassCard>
          </View>
        )}

        {/* Recent trades */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Recent Trades</Text>
        {recentTrades.length === 0 ? (
          <GlassCard>
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>No trades yet. Start by sharing a trade idea in the Chat tab.</Text>
          </GlassCard>
        ) : (
          recentTrades.map((trade) => (
            <GlassCard key={trade.id} style={styles.tradeRow}>
              <View style={styles.tradeLeft}>
                <Text style={[styles.tradePair, { color: theme.text }]}>{trade.pair}</Text>
                <Text style={[styles.tradeDate, { color: theme.textMuted }]}>{new Date(trade.createdAt).toLocaleDateString()}</Text>
              </View>
              <View style={styles.tradeRight}>
                <View style={[styles.sideTag, { backgroundColor: trade.side === 'long' ? Colors.profit + '22' : Colors.loss + '22' }]}>
                  <Text style={{ color: trade.side === 'long' ? Colors.profit : Colors.loss, fontSize: Typography.sizes.xs, fontWeight: Typography.weights.semibold }}>
                    {trade.side.toUpperCase()}
                  </Text>
                </View>
                {trade.pnl != null && (
                  <Text style={{ color: trade.pnl >= 0 ? Colors.profit : Colors.loss, fontWeight: Typography.weights.semibold, marginTop: 2 }}>
                    {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                  </Text>
                )}
              </View>
            </GlassCard>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing['3xl'] },
  header: { paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  greeting: { fontSize: Typography.sizes.sm },
  name: { fontSize: Typography.sizes['2xl'], fontWeight: Typography.weights.bold },
  balanceCard: { marginTop: Spacing.xs },
  balLabel: { fontSize: Typography.sizes.sm },
  balAmount: { fontSize: Typography.sizes['3xl'], fontWeight: Typography.weights.bold, marginTop: Spacing.xs },
  balRow: { marginTop: Spacing.xs },
  balSub: { fontSize: Typography.sizes.sm },
  balEmpty: { fontSize: Typography.sizes.sm, marginTop: Spacing.sm },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1 },
  statLabel: { fontSize: Typography.sizes.xs },
  statValue: { fontSize: Typography.sizes.lg, fontWeight: Typography.weights.bold, marginTop: 4 },
  sectionTitle: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.semibold, marginTop: Spacing.sm },
  emptyText: { fontSize: Typography.sizes.sm, lineHeight: 20 },
  tradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tradeLeft: {},
  tradePair: { fontSize: Typography.sizes.base, fontWeight: Typography.weights.semibold },
  tradeDate: { fontSize: Typography.sizes.xs, marginTop: 2 },
  tradeRight: { alignItems: 'flex-end' },
  sideTag: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.sm },
});
