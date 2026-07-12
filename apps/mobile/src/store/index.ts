import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface User {
  id: string;
  email: string;
  displayName?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tradeRecommendation?: TradeRecommendation | null;
  createdAt: string;
}

interface TradeRecommendation {
  pair: string;
  side: 'long' | 'short';
  entry: number | null;
  size: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}

interface Strategy {
  id: string;
  name: string;
  rulesText: string;
  parsedRulesJson?: object | null;
  createdAt: string;
}

interface Trade {
  id: string;
  pair: string;
  side: 'long' | 'short';
  size: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  orderId?: string;
  status: string;
  pnl?: number;
  createdAt: string;
}

interface WalletBalance {
  totalCollateral: number;
  freeCollateral: number;
  holdings: Array<{ token: string; holding: number }>;
}

interface AppState {
  // Auth
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;

  // Theme
  isDark: boolean;
  toggleTheme: () => void;

  // Chat
  messages: Message[];
  isTyping: boolean;
  addMessage: (msg: Message) => void;
  setMessages: (msgs: Message[]) => void;
  setTyping: (v: boolean) => void;

  // Strategy
  strategy: Strategy | null;
  setStrategy: (s: Strategy | null) => void;

  // Wallet
  balance: WalletBalance | null;
  setBalance: (b: WalletBalance) => void;

  // Trades
  trades: Trade[];
  setTrades: (t: Trade[]) => void;
  addTrade: (t: Trade) => void;

  // Pending trade recommendation (awaiting user confirm/reject)
  pendingTrade: TradeRecommendation | null;
  setPendingTrade: (t: TradeRecommendation | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  token: null,
  user: null,
  setAuth: async (token, user) => {
    await AsyncStorage.setItem('auth_token', token);
    await AsyncStorage.setItem('auth_user', JSON.stringify(user));
    set({ token, user });
  },
  logout: async () => {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('auth_user');
    set({ token: null, user: null, messages: [], strategy: null, balance: null, trades: [] });
  },

  isDark: true,
  toggleTheme: () => set((s) => ({ isDark: !s.isDark })),

  messages: [],
  isTyping: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setTyping: (v) => set({ isTyping: v }),

  strategy: null,
  setStrategy: (s) => set({ strategy: s }),

  balance: null,
  setBalance: (b) => set({ balance: b }),

  trades: [],
  setTrades: (t) => set({ trades: t }),
  addTrade: (t) => set((s) => ({ trades: [t, ...s.trades] })),

  pendingTrade: null,
  setPendingTrade: (t) => set({ pendingTrade: t }),
}));

// Rehydrate auth from storage on app start
export async function rehydrateAuth() {
  const token = await AsyncStorage.getItem('auth_token');
  const userStr = await AsyncStorage.getItem('auth_user');
  if (token && userStr) {
    useStore.setState({ token, user: JSON.parse(userStr) });
    return true;
  }
  return false;
}
