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

// Chat over SSE. NOTE: React Native's fetch does not support streaming response
// bodies (`res.body.getReader()` is undefined), so we read the full response
// text and parse the SSE `data:` lines. The backend emits the reply in a single
// event then `[DONE]`, so there's no token-by-token streaming to lose here.
// `onDone` always fires once (success or error) so callers can clear UI state.
export function streamChat(
  message: string,
  token: string,
  onChunk: (data: any) => void,
  onDone?: () => void
): () => void {
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
      const text = await res.text();
      const lines = text.split('\n').filter((l) => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try { onChunk(JSON.parse(data)); } catch {}
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') console.error('Stream error:', err);
    })
    .finally(() => { onDone?.(); });

  return () => controller.abort();
}

export default api;
