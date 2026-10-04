import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, SafeAreaView,
  RefreshControl, TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useStore } from '../../src/store';
import { tradeAPI } from '../../src/services/api';
import GlassCard from '../../src/components/GlassCard';
import { Colors, Typography, Spacing, Radius } from '../../src/theme';

type FilterType = 'all' | 'long' | 'short';

export default function HistoryScreen() {
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;
  const { trades, setTrades } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => { loadTrades(); }, []);

  async function loadTrades() {
    try {
      const res = await tradeAPI.history(100);
      setTrades(res.data.trades);
    } catch {} finally {
      setRefreshing(false);
    }
  }

  const filtered = filter === 'all' ? trades : trades.filter((t) => t.side === filter);
  // Postgres returns DECIMAL pnl as a string; coerce with Number() before math.
  const totalPnl = filtered.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const wins = filtered.filter((t) => Number(t.pnl || 0) > 0).length;

  function renderTrade({ item: trade }: { item: any }) {
    const isLong = trade.side === 'long';
    const hasPnl = trade.pnl != null;

    return (
      <GlassCard style={styles.tradeCard}>
        <View style={styles.tradeTop}>
          <View>
            <Text style={[styles.pair, { color: theme.text }]}>{trade.pair}</Text>
            <Text style={[styles.date, { color: theme.textMuted }]}>{new Date(trade.created_at || trade.createdAt).toLocaleString()}</Text>
          </View>
          <View style={styles.tradeRight}>
            <View style={[styles.badge, { backgroundColor: isLong ? Colors.profit + '22' : Colors.loss + '22' }]}>
              <Text style={[styles.badgeText, { color: isLong ? Colors.profit : Colors.loss }]}>
                {isLong ? '▲' : '▼'} {trade.side.toUpperCase()}
              </Text>
            </View>
            {hasPnl && (
              <Text style={[styles.pnl, { color: trade.pnl >= 0 ? Colors.profit : Colors.loss }]}>
                {trade.pnl >= 0 ? '+' : ''}${Number(trade.pnl).toFixed(2)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.statsRow}>
          <TradeDetail label="Size" value={String(trade.size)} theme={theme} />
          {trade.entry_price && <TradeDetail label="Entry" value={`$${Number(trade.entry_price).toLocaleString()}`} theme={theme} />}
          {trade.stop_loss && <TradeDetail label="SL" value={`$${Number(trade.stop_loss).toLocaleString()}`} valueColor={Colors.loss} theme={theme} />}
          {trade.take_profit && <TradeDetail label="TP" value={`$${Number(trade.take_profit).toLocaleString()}`} valueColor={Colors.profit} theme={theme} />}
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(trade.status) + '22' }]}>
            <Text style={[styles.statusText, { color: getStatusColor(trade.status) }]}>{trade.status}</Text>
          </View>
          {trade.order_id && (
            <Text style={[styles.orderId, { color: theme.textMuted }]}>#{trade.order_id.slice(-8)}</Text>
          )}
        </View>
      </GlassCard>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <LinearGradient colors={isDark ? ['#0F0F0F', '#0D1F17'] : ['#FAFAFA', '#F0FDF4']} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>Trade Journal</Text>
        {filtered.length > 0 && (
          <Text style={[styles.summary, { color: totalPnl >= 0 ? Colors.profit : Colors.loss }]}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} · {wins}/{filtered.filter((t) => t.pnl != null).length} wins
          </Text>
        )}
      </View>

      {/* Filter pills */}
      <View style={styles.filters}>
        {(['all', 'long', 'short'] as FilterType[]).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.pill, filter === f && styles.pillActive]}
          >
            <Text style={[styles.pillText, { color: filter === f ? '#fff' : theme.textSecondary }]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(t) => t.id}
        renderItem={renderTrade}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTrades(); }} tintColor={Colors.primary} />}
        ListEmptyComponent={
          <GlassCard>
            <Text style={[styles.empty, { color: theme.textMuted }]}>No trades yet. Confirm a trade recommendation from the Chat tab.</Text>
          </GlassCard>
        }
      />
    </SafeAreaView>
  );
}

function TradeDetail({ label, value, valueColor, theme }: any) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: theme.textMuted, fontSize: Typography.sizes.xs }}>{label}</Text>
      <Text style={{ color: valueColor || theme.text, fontSize: Typography.sizes.sm, fontWeight: '600', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function getStatusColor(status: string) {
  const map: Record<string, string> = {
    filled: Colors.profit, confirmed: Colors.profit, pending: Colors.warning,
    cancelled: Colors.neutral, rejected: Colors.loss,
  };
  return map[status] || Colors.neutral;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderBottomWidth: 1 },
  title: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold },
  summary: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.semibold },
  filters: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  pill: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.neutral + '44' },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium },
  list: { padding: Spacing.base, gap: Spacing.sm, paddingBottom: Spacing['3xl'] },
  tradeCard: {},
  tradeTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  pair: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.bold },
  date: { fontSize: Typography.sizes.xs, marginTop: 2 },
  tradeRight: { alignItems: 'flex-end', gap: 4 },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.sm },
  badgeText: { fontSize: Typography.sizes.xs, fontWeight: Typography.weights.semibold },
  pnl: { fontSize: Typography.sizes.base, fontWeight: Typography.weights.bold },
  statsRow: { flexDirection: 'row', gap: Spacing.lg, marginBottom: Spacing.sm },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.sm },
  statusText: { fontSize: Typography.sizes.xs, fontWeight: Typography.weights.semibold, textTransform: 'uppercase' },
  orderId: { fontSize: Typography.sizes.xs },
  empty: { fontSize: Typography.sizes.sm, lineHeight: 20 },
});
