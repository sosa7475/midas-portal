import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, SafeAreaView,
  Alert, TouchableOpacity, Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStore } from '../../src/store';
import { walletAPI, settingsAPI, onchainAPI } from '../../src/services/api';
import GlassCard from '../../src/components/GlassCard';
import PrimaryButton from '../../src/components/PrimaryButton';
import { Colors, Typography, Spacing, Radius } from '../../src/theme';

export default function SettingsScreen() {
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;
  const { toggleTheme, user, logout } = useStore();

  const [orderlyKey, setOrderlyKey] = useState('');
  const [orderlySecret, setOrderlySecret] = useState('');
  const [connectingWallet, setConnectingWallet] = useState(false);

  const [llmProvider, setLlmProvider] = useState('openai');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [savedProviders, setSavedProviders] = useState<string[]>([]);

  const [moralisKey, setMoralisKey] = useState('');
  const [moralisConnected, setMoralisConnected] = useState(false);
  const [savingMoralis, setSavingMoralis] = useState(false);

  useEffect(() => { loadSavedKeys(); loadMoralisStatus(); }, []);

  async function loadSavedKeys() {
    try {
      const res = await settingsAPI.getApiKeys();
      setSavedProviders(res.data.providers.map((p: any) => p.provider));
    } catch {}
  }

  async function loadMoralisStatus() {
    try {
      const res = await onchainAPI.moralisStatus();
      setMoralisConnected(!!res.data.connected);
    } catch {}
  }

  async function saveMoralisKey() {
    if (!moralisKey.trim()) { Alert.alert('Error', 'Enter your Moralis API key.'); return; }
    setSavingMoralis(true);
    try {
      await onchainAPI.connectMoralis(moralisKey.trim());
      Alert.alert('Connected', 'Moralis key saved and verified.');
      setMoralisKey('');
      setMoralisConnected(true);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to save Moralis key');
    } finally {
      setSavingMoralis(false);
    }
  }

  async function disconnectMoralis() {
    Alert.alert('Remove Moralis Key', 'Disconnect your Moralis API key?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try { await onchainAPI.disconnectMoralis(); setMoralisConnected(false); } catch {}
        },
      },
    ]);
  }

  async function connectWallet() {
    if (!orderlyKey.trim() || !orderlySecret.trim()) {
      Alert.alert('Error', 'Enter your Orderly API key and secret.');
      return;
    }
    setConnectingWallet(true);
    try {
      await walletAPI.connect(orderlyKey.trim(), orderlySecret.trim());
      Alert.alert('Connected', 'Orderly wallet connected successfully.');
      setOrderlyKey('');
      setOrderlySecret('');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Connection failed');
    } finally {
      setConnectingWallet(false);
    }
  }

  async function saveLlmKey() {
    if (!llmApiKey.trim()) { Alert.alert('Error', 'Enter your API key.'); return; }
    setSavingKey(true);
    try {
      await settingsAPI.saveApiKey(llmProvider, llmApiKey.trim());
      Alert.alert('Saved', `${llmProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API key saved.`);
      setLlmApiKey('');
      await loadSavedKeys();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to save key');
    } finally {
      setSavingKey(false);
    }
  }

  async function deleteProvider(provider: string) {
    Alert.alert('Remove Key', `Remove your ${provider} API key?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await settingsAPI.deleteApiKey(provider);
            setSavedProviders((prev) => prev.filter((p) => p !== provider));
          } catch {}
        },
      },
    ]);
  }

  function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { logout(); router.replace('/(auth)/login'); } },
    ]);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <LinearGradient colors={isDark ? ['#0F0F0F', '#0D1F17'] : ['#FAFAFA', '#F0FDF4']} style={StyleSheet.absoluteFill} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>Settings</Text>

        {/* User info */}
        <GlassCard>
          <View style={styles.userRow}>
            <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.userAvatar}>
              <Text style={styles.userAvatarText}>{user?.email?.[0].toUpperCase()}</Text>
            </LinearGradient>
            <View>
              <Text style={[styles.userName, { color: theme.text }]}>{user?.displayName || 'Trader'}</Text>
              <Text style={[styles.userEmail, { color: theme.textSecondary }]}>{user?.email}</Text>
            </View>
          </View>
        </GlassCard>

        {/* Appearance */}
        <SectionLabel title="Appearance" theme={theme} />
        <GlassCard>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.text }]}>Dark Mode</Text>
            <Switch value={isDark} onValueChange={toggleTheme} trackColor={{ false: '#767577', true: Colors.primary }} />
          </View>
        </GlassCard>

        {/* Wallet */}
        <SectionLabel title="Orderly Wallet" theme={theme} />
        <GlassCard>
          <Text style={[styles.sectionDesc, { color: theme.textSecondary }]}>Connect your Orderly Network account for trade execution.</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text, marginTop: Spacing.sm }]}
            placeholder="Orderly Account ID / API Key"
            placeholderTextColor={theme.textMuted}
            value={orderlyKey}
            onChangeText={setOrderlyKey}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text }]}
            placeholder="API Secret"
            placeholderTextColor={theme.textMuted}
            value={orderlySecret}
            onChangeText={setOrderlySecret}
            secureTextEntry
            autoCapitalize="none"
          />
          <PrimaryButton label={connectingWallet ? 'Connecting...' : 'Connect Wallet'} onPress={connectWallet} loading={connectingWallet} style={{ marginTop: Spacing.sm }} />
        </GlassCard>

        {/* LLM provider */}
        <SectionLabel title="AI Provider" theme={theme} />
        <GlassCard>
          <Text style={[styles.sectionDesc, { color: theme.textSecondary }]}>
            Default is server-side OpenAI. Add your own key to use your account and model.
          </Text>

          {/* Provider toggle */}
          <View style={styles.providerToggle}>
            {['openai', 'anthropic'].map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setLlmProvider(p)}
                style={[styles.providerPill, llmProvider === p && styles.providerPillActive]}
              >
                <Text style={[styles.providerText, { color: llmProvider === p ? '#fff' : theme.textSecondary }]}>
                  {p === 'openai' ? 'OpenAI' : 'Anthropic'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text, marginTop: Spacing.sm }]}
            placeholder={llmProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
            placeholderTextColor={theme.textMuted}
            value={llmApiKey}
            onChangeText={setLlmApiKey}
            secureTextEntry
            autoCapitalize="none"
          />
          <PrimaryButton label={savingKey ? 'Saving...' : 'Save API Key'} onPress={saveLlmKey} loading={savingKey} style={{ marginTop: Spacing.sm }} />

          {savedProviders.length > 0 && (
            <View style={{ marginTop: Spacing.md }}>
              <Text style={[styles.savedLabel, { color: theme.textSecondary }]}>Saved Providers</Text>
              {savedProviders.map((p) => (
                <View key={p} style={styles.savedRow}>
                  <View style={[styles.savedBadge, { backgroundColor: Colors.primary + '22' }]}>
                    <Text style={[styles.savedBadgeText, { color: Colors.primary }]}>{p}</Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteProvider(p)}>
                    <Ionicons name="trash-outline" size={18} color={Colors.loss} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </GlassCard>

        {/* Onchain data */}
        <SectionLabel title="Onchain Data" theme={theme} />
        <GlassCard>
          <Text style={[styles.sectionDesc, { color: theme.textSecondary }]}>
            Connect your Moralis Web3 API key. The agent uses it for live token prices, holder concentration, wallet PnL, and smart-money signals across EVM chains + Solana. DefiLlama (TVL, DEX volumes, stablecoin flows) needs no key.
          </Text>

          {moralisConnected ? (
            <View style={[styles.savedRow, { marginTop: Spacing.sm }]}>
              <View style={[styles.savedBadge, { backgroundColor: Colors.primary + '22' }]}>
                <Text style={[styles.savedBadgeText, { color: Colors.primary }]}>moralis · connected</Text>
              </View>
              <TouchableOpacity onPress={disconnectMoralis}>
                <Ionicons name="trash-outline" size={18} color={Colors.loss} />
              </TouchableOpacity>
            </View>
          ) : null}

          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, borderColor: theme.border, color: theme.text, marginTop: Spacing.sm }]}
            placeholder={moralisConnected ? 'Replace existing Moralis key' : 'Moralis API Key'}
            placeholderTextColor={theme.textMuted}
            value={moralisKey}
            onChangeText={setMoralisKey}
            secureTextEntry
            autoCapitalize="none"
          />
          <PrimaryButton
            label={savingMoralis ? 'Verifying...' : moralisConnected ? 'Update Key' : 'Connect Moralis'}
            onPress={saveMoralisKey}
            loading={savingMoralis}
            style={{ marginTop: Spacing.sm }}
          />
        </GlassCard>

        {/* Sign out */}
        <PrimaryButton label="Sign Out" onPress={handleLogout} variant="danger" style={{ marginTop: Spacing.md }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ title, theme }: { title: string; theme: any }) {
  return <Text style={[{ color: theme.textSecondary, fontSize: Typography.sizes.xs, textTransform: 'uppercase', letterSpacing: 1, marginTop: Spacing.md }]}>{title}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.base, gap: Spacing.sm, paddingBottom: Spacing['3xl'] },
  title: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold, paddingTop: Spacing.md, marginBottom: Spacing.sm },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  userAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { color: '#fff', fontSize: Typography.sizes.lg, fontWeight: Typography.weights.bold },
  userName: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.semibold },
  userEmail: { fontSize: Typography.sizes.sm, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: Typography.sizes.base },
  sectionDesc: { fontSize: Typography.sizes.sm, lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, fontSize: Typography.sizes.base, marginBottom: Spacing.sm },
  providerToggle: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  providerPill: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1, borderColor: Colors.neutral + '44' },
  providerPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  providerText: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.semibold },
  savedLabel: { fontSize: Typography.sizes.xs, marginBottom: Spacing.sm },
  savedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  savedBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.sm },
  savedBadgeText: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium },
});
