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

export default apiClient;
