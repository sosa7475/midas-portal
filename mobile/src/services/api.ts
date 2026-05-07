import axios from 'axios';
import { useStore } from '../store';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

api.interceptors.request.use((config) => {
  const token = useStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      useStore.getState().logout();
    }
    return Promise.reject(err);
  }
);

// Auth
export const authAPI = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  register: (email: string, password: string, displayName?: string) =>
    api.post('/auth/register', { email, password, displayName }),
};

// Wallet
export const walletAPI = {
  connect: (apiKey: string, apiSecret: string) => api.post('/wallet/connect', { apiKey, apiSecret }),
  getBalance: () => api.get('/wallet/balance'),
};

// Strategy
export const strategyAPI = {
  get: () => api.get('/strategy'),
  define: (rulesText: string, name?: string) => api.post('/strategy/define', { rulesText, name }),
  tradeIdea: (idea: string) => api.post('/strategy/trade-idea', { idea }),
  analyzeScreenshot: (formData: FormData) =>
    api.post('/strategy/analyze-screenshot', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    }),
};

// Trade
export const tradeAPI = {
  confirm: (params: {
    pair: string; side: string; size: number; entry?: number;
    stopLoss?: number; takeProfit?: number; orderType?: string;
    agentReasoning?: string;
  }) => api.post('/trade/confirm', params),
  history: (limit = 50, offset = 0) => api.get('/trade/history', { params: { limit, offset } }),
  getById: (id: string) => api.get(`/trade/${id}`),
};

// Chat history
export const chatAPI = {
  getHistory: () => api.get('/chat/history'),
};

// Settings
export const settingsAPI = {
  saveApiKey: (provider: string, apiKey: string) => api.post('/settings/api-key', { provider, apiKey }),
  getApiKeys: () => api.get('/settings/api-keys'),
  deleteApiKey: (provider: string) => api.delete(`/settings/api-key/${provider}`),
};

// Onchain (DefiLlama public + Moralis per-user)
export const onchainAPI = {
  // Moralis key management
  connectMoralis: (apiKey: string) => api.post('/onchain/moralis/connect', { apiKey }),
  moralisStatus: () => api.get('/onchain/moralis/status'),
  disconnectMoralis: () => api.delete('/onchain/moralis'),

  // Macro pulse for the dashboard
  pulse: () => api.get('/onchain/pulse'),

  // DefiLlama
  protocolTvl: (slug: string) => api.get(`/onchain/defillama/protocol/${slug}`),
  chainTvl: (chain: string) => api.get(`/onchain/defillama/chain/${chain}`),
  topProtocols: (params?: { chain?: string; category?: string; limit?: number }) =>
    api.get('/onchain/defillama/protocols', { params }),
  tokenPrices: (coins: string[]) => api.post('/onchain/defillama/prices', { coins }),
  dexVolume: (chain: string) => api.get(`/onchain/defillama/dex/${chain}`),
  perpsVolume: (chain = 'all') => api.get('/onchain/defillama/perps', { params: { chain } }),
  stablecoinFlows: () => api.get('/onchain/defillama/stablecoins'),
  stablecoinChainFlows: (chain: string) => api.get(`/onchain/defillama/stablecoins/${chain}`),
  topYields: (params?: { chain?: string; project?: string; symbol?: string; minTvl?: number; limit?: number }) =>
    api.get('/onchain/defillama/yields', { params }),

  // Moralis (require connected key)
  tokenPrice: (chain: string, address: string) => api.get(`/onchain/moralis/price/${chain}/${address}`),
  tokenMetadata: (chain: string, address: string) => api.get(`/onchain/moralis/metadata/${chain}/${address}`),
  tokenHolders: (chain: string, address: string, limit = 25) =>
    api.get(`/onchain/moralis/holders/${chain}/${address}`, { params: { limit } }),
  walletTokens: (chain: string, address: string) => api.get(`/onchain/moralis/wallet/${chain}/${address}/tokens`),
  walletPnl: (chain: string, address: string, days: string = 'all') =>
    api.get(`/onchain/moralis/wallet/${chain}/${address}/pnl`, { params: { days } }),
  walletSwaps: (chain: string, address: string, limit = 25) =>
    api.get(`/onchain/moralis/wallet/${chain}/${address}/swaps`, { params: { limit } }),
  tokenTransfers: (chain: string, address: string, limit = 25) =>
    api.get(`/onchain/moralis/transfers/${chain}/${address}`, { params: { limit } }),
  topGainers: (params?: { chain?: string; timeFrame?: string; minMarketCap?: number; limit?: number }) =>
    api.get('/onchain/moralis/top-gainers', { params }),
  trending: (params?: { chain?: string; limit?: number }) =>
    api.get('/onchain/moralis/trending', { params }),
};

// SSE streaming chat
export function streamChat(message: string, token: string, onChunk: (data: any) => void): () => void {
  const controller = new AbortController();

  fetch(`${API_BASE}/chat/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
    signal: controller.signal,
  })
    .then(async (res) => {
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));
        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try { onChunk(JSON.parse(data)); } catch {}
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') console.error('Stream error:', err);
    });

  return () => controller.abort();
}

export default api;
