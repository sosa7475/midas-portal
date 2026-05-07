import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../../src/store';
import { chatAPI, strategyAPI, tradeAPI, streamChat } from '../../src/services/api';
import TradeCard from '../../src/components/TradeCard';
import GlassCard from '../../src/components/GlassCard';
import { Colors, Typography, Spacing, Radius } from '../../src/theme';

export default function ChatScreen() {
  const isDark = useStore((s) => s.isDark);
  const theme = isDark ? Colors.dark : Colors.light;
  const { messages, addMessage, setMessages, isTyping, setTyping, token, pendingTrade, setPendingTrade } = useStore();
  const [input, setInput] = useState('');
  const [confirmingTrade, setConfirmingTrade] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const res = await chatAPI.getHistory();
      setMessages(
        res.data.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          tradeRecommendation: m.metadata?.tradeRecommendation || null,
          createdAt: m.created_at,
        }))
      );
    } catch {}
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;
    const userMsg = { id: uuidv4(), role: 'user' as const, content: text.trim(), createdAt: new Date().toISOString() };
    addMessage(userMsg);
    setInput('');
    setTyping(true);

    let assistantContent = '';
    let tradeRec: any = null;
    const assistantId = uuidv4();

    addMessage({ id: assistantId, role: 'assistant', content: '...', createdAt: new Date().toISOString() });

    const cancel = streamChat(text.trim(), token!, (data) => {
      if (data.type === 'message') {
        assistantContent = data.content;
        tradeRec = data.tradeRecommendation || null;
        setMessages(
          useStore.getState().messages.map((m) =>
            m.id === assistantId ? { ...m, content: assistantContent, tradeRecommendation: tradeRec } : m
          )
        );
        if (tradeRec) setPendingTrade(tradeRec);
      }
    });

    setTimeout(() => {
      setTyping(false);
      cancel();
    }, 60000);
  }, [isTyping, token]);

  async function handleImagePick() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Photo library access required.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled) return;

    const asset = result.assets[0];
    const userMsg = { id: uuidv4(), role: 'user' as const, content: '📸 Chart uploaded for analysis', createdAt: new Date().toISOString() };
    addMessage(userMsg);
    setTyping(true);

    try {
      const formData = new FormData();
      formData.append('screenshot', { uri: asset.uri, type: asset.mimeType || 'image/jpeg', name: 'chart.jpg' } as any);
      if (input.trim()) formData.append('notes', input.trim());

      const res = await strategyAPI.analyzeScreenshot(formData);
      const { content, tradeRecommendation } = res.data;

      addMessage({ id: uuidv4(), role: 'assistant', content, tradeRecommendation: tradeRecommendation || null, createdAt: new Date().toISOString() });
      if (tradeRecommendation) setPendingTrade(tradeRecommendation);
      setInput('');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Analysis failed');
    } finally {
      setTyping(false);
    }
  }

  async function handleConfirmTrade() {
    if (!pendingTrade) return;
    setConfirmingTrade(true);
    try {
      const res = await tradeAPI.confirm({
        pair: pendingTrade.pair,
        side: pendingTrade.side,
        size: pendingTrade.size || 0,
        entry: pendingTrade.entry || undefined,
        stopLoss: pendingTrade.stopLoss || undefined,
        takeProfit: pendingTrade.takeProfit || undefined,
      });
      setPendingTrade(null);
      const confirmMsg = `Trade executed! Order ID: ${res.data.execution.orderId}\nStatus: ${res.data.execution.status}`;
      addMessage({ id: uuidv4(), role: 'assistant', content: confirmMsg, createdAt: new Date().toISOString() });
      useStore.getState().addTrade(res.data.trade);
    } catch (err: any) {
      Alert.alert('Trade Failed', err.response?.data?.error || 'Execution failed');
    } finally {
      setConfirmingTrade(false);
    }
  }

  function renderMessage({ item }: { item: any }) {
    const isUser = item.role === 'user';
    const isThinking = item.content === '...';

    return (
      <View style={[styles.msgRow, isUser && styles.msgRowRight]}>
        {!isUser && (
          <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.avatar}>
            <Text style={styles.avatarText}>M</Text>
          </LinearGradient>
        )}
        <View style={{ maxWidth: '80%' }}>
          <View style={[
            styles.bubble,
            isUser
              ? { backgroundColor: Colors.primary }
              : { backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border },
          ]}>
            {isThinking ? (
              <View style={styles.thinkingDots}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={[styles.thinkingText, { color: theme.textSecondary }]}>Midas is thinking...</Text>
              </View>
            ) : (
              <Text style={[styles.bubbleText, { color: isUser ? '#fff' : theme.text }]}>{item.content}</Text>
            )}
          </View>
          {item.tradeRecommendation && !isThinking && (
            <TradeCard
              trade={item.tradeRecommendation}
              onConfirm={handleConfirmTrade}
              onReject={() => setPendingTrade(null)}
              isLoading={confirmingTrade}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <LinearGradient colors={isDark ? ['#0F0F0F', '#0D1F17'] : ['#FAFAFA', '#F0FDF4']} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.headerAvatar}>
          <Text style={styles.avatarText}>M</Text>
        </LinearGradient>
        <View>
          <Text style={[styles.headerName, { color: theme.text }]}>Midas</Text>
          <View style={styles.onlineRow}>
            <View style={styles.onlineDot} />
            <Text style={[styles.onlineText, { color: theme.textSecondary }]}>Ready to trade</Text>
          </View>
        </View>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex} keyboardVerticalOffset={100}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>Welcome to Midas</Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                Share a trade idea, upload a chart, or ask for analysis. I'll apply your strategy and recommend precise entries.
              </Text>
            </View>
          }
        />

        {/* Input bar */}
        <View style={[styles.inputBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          <TouchableOpacity onPress={handleImagePick} style={styles.iconBtn}>
            <Ionicons name="image-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={[styles.textInput, { color: theme.text, backgroundColor: theme.bgCard }]}
            placeholder="Trade idea, question, or chart notes..."
            placeholderTextColor={theme.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={2000}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
          />
          <TouchableOpacity
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || isTyping}
            style={[styles.sendBtn, (!input.trim() || isTyping) && { opacity: 0.4 }]}
          >
            <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.sendGradient}>
              <Ionicons name="arrow-up" size={18} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerName: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.semibold },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary },
  onlineText: { fontSize: Typography.sizes.xs },
  messageList: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing.xl },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  msgRowRight: { flexDirection: 'row-reverse' },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { color: '#fff', fontSize: Typography.sizes.sm, fontWeight: Typography.weights.bold },
  bubble: { borderRadius: Radius.lg, padding: Spacing.md },
  bubbleText: { fontSize: Typography.sizes.base, lineHeight: 22 },
  thinkingDots: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  thinkingText: { fontSize: Typography.sizes.sm },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderTopWidth: 1,
  },
  iconBtn: { paddingBottom: Spacing.sm },
  textInput: {
    flex: 1, borderRadius: Radius.lg, paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm, paddingBottom: Spacing.sm,
    fontSize: Typography.sizes.base, maxHeight: 120,
  },
  sendBtn: { paddingBottom: 2 },
  sendGradient: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: Spacing['2xl'] },
  emptyTitle: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold, marginBottom: Spacing.sm },
  emptySubtitle: { fontSize: Typography.sizes.sm, textAlign: 'center', lineHeight: 22 },
});
