import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Normaliza o erro da API para { code, message, provider }.
// O backend responde falhas de IA com: { detail: { error_code, message, provider } }
export const extractApiError = (error) => {
  const detail = error?.response?.data?.detail ?? error?.detail ?? error?.message;
  if (typeof detail === 'string') {
    return { code: 'UNKNOWN', message: detail, provider: null };
  }
  return {
    code: detail?.error_code || 'UNKNOWN',
    message: detail?.message || 'Erro inesperado ao chamar a IA.',
    provider: detail?.provider || null,
    trail: detail?.fallback_trail ?? null,
  };
};

// --- AI Configuration Endpoints ---
export const getAIConfig = async () => {
  try {
    const response = await apiClient.get('/ai/config');
    return response.data;
  } catch (error) {
    console.error('Error fetching AI config:', error.response ? error.response.data : error.message);
    throw error.response ? error.response.data : new Error('Error fetching AI config');
  }
};

export const updateAIConfig = async (configData) => {
  try {
    // Ensure API keys are not sent if they are empty strings or null
    const payload = { ...configData };
    if (!payload.openaiApiKey) delete payload.openaiApiKey;
    if (!payload.googleApiKey) delete payload.googleApiKey;

    const response = await apiClient.put('/ai/config', payload);
    return response.data;
  } catch (error) {
    console.error('Error updating AI config:', error.response ? error.response.data : error.message);
    throw error.response ? error.response.data : new Error('Error updating AI config');
  }
};

// --- AI Feature Endpoints ---
export const performDeepResearch = async (researchData) => {
  try {
    const response = await apiClient.post('/ai/deep-research', researchData);
    return response.data;
  } catch (error) {
    console.error('Error performing deep research:', error.response ? error.response.data : error.message);
    throw error.response ? error.response.data : new Error('Error performing deep research');
  }
};

export const suggestNewNodes = async (suggestionData) => {
  try {
    const response = await apiClient.post('/ai/suggest-nodes', suggestionData);
    return response.data;
  } catch (error) {
    console.error('Error suggesting new nodes:', error.response ? error.response.data : error.message);
    throw error.response ? error.response.data : new Error('Error suggesting new nodes');
  }
};

// Expansão em lote (v0.4.5 B4): o backend resolve rótulos/ancestrais do
// documento persistido e expande os nós em paralelo (REST, sem streaming).
export const suggestNodesBatch = async ({ map_id, node_ids }) => {
  const response = await apiClient.post('/ai/suggest-nodes-batch', { map_id, node_ids });
  return response.data;
};

// --- Maps Endpoints (persistência) ---
export const listMaps = async () => {
  const response = await apiClient.get('/maps');
  return response.data;
};

export const createMap = async (payload) => {
  const response = await apiClient.post('/maps', payload);
  return response.data;
};

export const getMap = async (id) => {
  const response = await apiClient.get(`/maps/${id}`);
  return response.data;
};

export const getLastMap = async () => {
  const response = await apiClient.get('/maps/last');
  return response.data;
};

export const saveMapApi = async (id, payload) => {
  const response = await apiClient.put(`/maps/${id}`, payload);
  return response.data;
};

export const deleteMapApi = async (id) => {
  const response = await apiClient.delete(`/maps/${id}`);
  return response.data;
};

export const searchNodesApi = async (q) => {
  const response = await apiClient.get('/maps/search', { params: { q } });
  return response.data;
};

// --- Provider Chain (v0.4) ---
export const getChain = async () => {
  const response = await apiClient.get('/ai/chain');
  return response.data;
};

export const saveChain = async (chain) => {
  const response = await apiClient.put('/ai/chain', { chain });
  return response.data;
};

export const resetChainApi = async () => {
  const response = await apiClient.post('/ai/chain/reset');
  return response.data;
};

export const testProviderApi = async (provider) => {
  const response = await apiClient.post(`/ai/keys/${provider}/test`);
  return response.data;
};

export const getProviderModelsApi = async (provider) => {
  const response = await apiClient.get(`/ai/models/${provider}`);
  return response.data;
};

// Geração de mapa a partir de um tópico (v0.4.5 B3) — REST, sem stream
export const generateMapApi = async (payload) => {
  const response = await apiClient.post('/ai/generate', payload);
  return response.data;
};

// Export Markdown (v0.6.0 B2): blob + filename do Content-Disposition
// (o backend sanitiza — fonte única do nome do arquivo)
export const exportMapMarkdown = async (id) => {
  const response = await apiClient.get(`/maps/${id}/export/markdown`, { responseType: 'blob' });
  const cd = response.headers?.['content-disposition'] ?? '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  return { blob: response.data, filename: match?.[1] ?? 'mapa.md' };
};



// --- Streaming SSE (v0.4.5) ---
// Transporte: fetch POST + ReadableStream (EventSource não aceita corpo).
// Wire format SSE parseado incrementalmente (createSSEParser sobrevive a
// fronteiras de chunk arbitrárias do TCP).

export const streamDeepResearch = async (payload, { onEvent, signal } = {}) => {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/ai/deep-research/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw { response: { status: 503, data: { detail: { error_code: 'PROVIDER_UNREACHABLE', message: 'Backend inacessível.' } } } };
  }

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw { response: { status: response.status, data } };
  }

  const { createSSEParser } = await import('./sse');
  const parser = createSSEParser(onEvent);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
  parser.flush();
};

export default apiClient;

// Chat com o mapa (v0.4.5 B2): mesmo transporte fetch+SSE da pesquisa
export const streamChat = async (payload, { onEvent, signal } = {}) => {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw { response: { status: 503, data: { detail: { error_code: 'PROVIDER_UNREACHABLE', message: 'Backend inacessível.' } } } };
  }
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw { response: { status: response.status, data } };
  }
  const { createSSEParser } = await import('./sse');
  const parser = createSSEParser(onEvent);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
  parser.flush();
};


