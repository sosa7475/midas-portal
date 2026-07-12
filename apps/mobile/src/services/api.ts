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
    agentReasoning?: string; idempotencyKey: string;
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

// SSE streaming chat — XHR-based: React Native's fetch has no streaming body
// (res.body.getReader() is unsupported), but XHR onprogress delivers incremental
// text, so tokens render as they arrive.
export function streamChat(message: string, token: string, onChunk: (data: any) => void): () => void {
  const xhr = new XMLHttpRequest();
  let seenBytes = 0;
  let buffer = '';
  let done = false;

  const processBuffer = () => {
    // SSE events are separated by a blank line
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') { done = true; return; }
        try { onChunk(JSON.parse(data)); } catch {}
      }
    }
  };

  const drain = () => {
    if (done) return;
    buffer += xhr.responseText.slice(seenBytes);
    seenBytes = xhr.responseText.length;
    processBuffer();
  };

  xhr.open('POST', `${API_BASE}/chat/message`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.setRequestHeader('Accept', 'text/event-stream');

  xhr.onprogress = drain;
  xhr.onload = () => {
    drain();
    if (!done) {
      buffer += '\n\n'; // flush any trailing event
      processBuffer();
    }
  };
  xhr.onerror = () => {
    if (!done) onChunk({ type: 'error', error: 'Connection lost' });
  };

  xhr.send(JSON.stringify({ message }));
  return () => xhr.abort();
}

export default api;
