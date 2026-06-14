import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, SafeAreaView,
  Alert, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../src/store';
import { strategyAPI } from '../../src/services/api';
import GlassCard from '../../src/components/GlassCard';
import PrimaryButton from '../../src/components/PrimaryButton';
import { Colors, Typography, Spacing, Radius } from '../../src/theme';

const EXAMPLES = [
  'Buy BTC breakouts above key resistance with high volume. Risk 2% per trade. Stop-loss 3% below entry. Take profit at 6% for 1:2 R:R.',
  'Short altcoins showing bearish divergence on 4h chart. Max 5% position size. No trades during high-impact news.',
  'Scalp ETH on 15m chart. Only trade with trend on 1h. Risk 1% max. Close positions before 10pm UTC.',
];

export default function StrategyScreen() {
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;
  const { strategy, setStrategy } = useStore();
  const [rulesText, setRulesText] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => { loadStrategy(); }, []);

  async function loadStrategy() {
    try {
      const res = await strategyAPI.get();
      if (res.data.strategy) {
        setStrategy(res.data.strategy);
        setRulesText(res.data.strategy.rules_text || '');
        setName(res.data.strategy.name || '');
      } else {
        setEditing(true);
      }
    } catch {}
  }

  async function saveStrategy() {
    if (!rulesText.trim()) { Alert.alert('Error', 'Strategy cannot be empty.'); return; }
    setSaving(true);
    try {
      const res = await strategyAPI.define(rulesText, name || 'My Strategy');
      setStrategy(res.data.strategy);
      setEditing(false);
      Alert.alert('Saved', 'Your strategy has been saved and parsed.');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to save strategy');
    } finally {
      setSaving(false);
    }
  }

  const parsedRules = strategy?.parsed_rules_json as any;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <LinearGradient colors={isDark ? ['#0F0F0F', '#0D1F17'] : ['#FAFAFA', '#F0FDF4']} style={StyleSheet.absoluteFill} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>Trading Strategy</Text>
          {strategy && !editing && (
            <TouchableOpacity onPress={() => setEditing(true)} style={styles.editBtn}>
              <Ionicons name="pencil-outline" size={18} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Define your rules in plain English. Midas will apply them to every trade idea.
        </Text>

        {/* Current strategy or editor */}
        {strategy && !editing ? (
          <>
            <GlassCard>
              <View style={styles.stratHeader}>
                <View style={styles.stratTitleRow}>
                  <Ionicons name="shield-checkmark" size={18} color={Colors.primary} />
                  <Text style={[styles.stratName, { color: theme.text }]}>{strategy.name}</Text>
                </View>
                <Text style={[styles.stratDate, { color: theme.textMuted }]}>
                  Active since {new Date(strategy.created_at || strategy.createdAt || Date.now()).toLocaleDateString()}
                </Text>
              </View>
              <Text style={[styles.stratText, { color: theme.textSecondary }]}>{strategy.rules_text || rulesText}</Text>
            </GlassCard>

            {parsedRules && (
              <>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Parsed Rules</Text>
                {parsedRules.entryConditions?.length > 0 && (
                  <RuleSection title="Entry Conditions" items={parsedRules.entryConditions} isDark={isDark} />
                )}
                {parsedRules.riskPerTrade && (
                  <GlassCard style={styles.ruleRow}>
                    <Text style={[styles.ruleLabel, { color: theme.textSecondary }]}>Risk Per Trade</Text>
                    <Text style={[styles.ruleValue, { color: Colors.primary }]}>{parsedRules.riskPerTrade}</Text>
                  </GlassCard>
                )}
                {parsedRules.stopLossRule && (
                  <GlassCard style={styles.ruleRow}>
                    <Text style={[styles.ruleLabel, { color: theme.textSecondary }]}>Stop-Loss Rule</Text>
                    <Text style={[styles.ruleValue, { color: Colors.loss }]}>{parsedRules.stopLossRule}</Text>
                  </GlassCard>
                )}
                {parsedRules.takeProfitRule && (
                  <GlassCard style={styles.ruleRow}>
                    <Text style={[styles.ruleLabel, { color: theme.textSecondary }]}>Take-Profit Rule</Text>
                    <Text style={[styles.ruleValue, { color: Colors.profit }]}>{parsedRules.takeProfitRule}</Text>
                  </GlassCard>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <TextInput
              style={[styles.nameInput, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text }]}
              placeholder="Strategy name (e.g. Breakout Scalp)"
              placeholderTextColor={theme.textMuted}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={[styles.editor, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text }]}
              placeholder="Describe your strategy in plain English..."
              placeholderTextColor={theme.textMuted}
              value={rulesText}
              onChangeText={setRulesText}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
            />

            <PrimaryButton label={saving ? 'Saving...' : 'Save Strategy'} onPress={saveStrategy} loading={saving} />

            {strategy && (
              <PrimaryButton label="Cancel" onPress={() => setEditing(false)} variant="ghost" style={{ marginTop: Spacing.sm }} />
            )}

            {/* Examples */}
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Examples</Text>
            {EXAMPLES.map((ex, i) => (
              <TouchableOpacity key={i} onPress={() => setRulesText(ex)} activeOpacity={0.7}>
                <GlassCard>
                  <Text style={[styles.exampleText, { color: theme.textSecondary }]}>{ex}</Text>
                  <Text style={[styles.useExample, { color: Colors.primary }]}>Tap to use →</Text>
                </GlassCard>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RuleSection({ title, items, isDark }: { title: string; items: string[]; isDark: boolean }) {
  const theme = isDark ? Colors.dark : Colors.light;
  return (
    <GlassCard style={{ marginBottom: Spacing.sm }}>
      <Text style={[{ color: theme.textSecondary, fontSize: Typography.sizes.xs, marginBottom: Spacing.sm }]}>{title}</Text>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: 4 }}>
          <Text style={{ color: Colors.primary }}>•</Text>
          <Text style={{ color: theme.text, fontSize: Typography.sizes.sm, flex: 1 }}>{item}</Text>
        </View>
      ))}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing['3xl'] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Spacing.md },
  title: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold },
  editBtn: { padding: Spacing.sm },
  subtitle: { fontSize: Typography.sizes.sm, lineHeight: 20 },
  sectionTitle: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.semibold, marginTop: Spacing.sm },
  nameInput: {
    borderWidth: 1, borderRadius: Radius.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    fontSize: Typography.sizes.base,
  },
  editor: {
    borderWidth: 1, borderRadius: Radius.md,
    padding: Spacing.base, fontSize: Typography.sizes.base,
    minHeight: 150, lineHeight: 22,
  },
  stratHeader: { marginBottom: Spacing.md },
  stratTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 4 },
  stratName: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.semibold },
  stratDate: { fontSize: Typography.sizes.xs },
  stratText: { fontSize: Typography.sizes.sm, lineHeight: 22 },
  ruleRow: {},
  ruleLabel: { fontSize: Typography.sizes.xs, marginBottom: 4 },
  ruleValue: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium },
  exampleText: { fontSize: Typography.sizes.sm, lineHeight: 20, marginBottom: Spacing.sm },
  useExample: { fontSize: Typography.sizes.xs, fontWeight: Typography.weights.semibold },
});
