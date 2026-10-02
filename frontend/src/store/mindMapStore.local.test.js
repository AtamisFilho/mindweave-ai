import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import useMindMapStore from './mindMapStore';
import apiClient from '../services/api';

// Suite do onboarding local (v0.6.1): probe dos servidores e persistência
// de UM campo de UM provedor na cadeia.
const st = () => useMindMapStore.getState();

beforeEach(() => {
  useMindMapStore.setState({
    chainConfig: [
      { provider: 'lmstudio', enabled: true, model: null, base_url: null },
      { provider: 'ollama', enabled: true, model: 'llama3', base_url: null },
    ],
    localStatus: { lmstudio: null, ollama: null },
    localModels: { lmstudio: [], ollama: [] },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('probeLocalServers', () => {
  it('200 → up com modelos; erro → down', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
      if (url === '/ai/models/lmstudio') return { data: { models: ['qwen2.5-7b-instruct'], base_url: 'http://localhost:1234/v1' } };
      throw { response: { status: 503, data: { detail: { error_code: 'PROVIDER_UNREACHABLE' } } } };
    });

    await st().probeLocalServers();
    const s = st();
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(s.localStatus).toEqual({ lmstudio: 'up', ollama: 'down' });
    expect(s.localModels.lmstudio).toEqual(['qwen2.5-7b-instruct']);
    expect(s.localModels.ollama).toEqual([]);
  });
});

describe('persistChainEntry', () => {
  it('PUT preserva os outros provedores e atualiza a cadeia com a resposta', async () => {
    const putSpy = vi.spyOn(apiClient, 'put').mockResolvedValue({
      data: [
        { provider: 'lmstudio', enabled: true, model: 'qwen2.5-7b-instruct', base_url: null },
        { provider: 'ollama', enabled: true, model: 'llama3', base_url: null },
      ],
    });

    const ok = await st().persistChainEntry('lmstudio', { model: 'qwen2.5-7b-instruct' });
    expect(ok).toBe(true);
    const sent = putSpy.mock.calls[0][1].chain;
    expect(sent.find((e) => e.provider === 'lmstudio').model).toBe('qwen2.5-7b-instruct');
    expect(sent.find((e) => e.provider === 'ollama').model).toBe('llama3'); // intacto
    expect(st().chainConfig[0].model).toBe('qwen2.5-7b-instruct'); // resposta do servidor vence
  });

  it('base_url é enviada quando presente e omitida quando ausente', async () => {
    const putSpy = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: st().chainConfig });
    await st().persistChainEntry('lmstudio', { base_url: 'http://localhost:9911/v1' });
    const sentLm = putSpy.mock.calls[0][1].chain.find((e) => e.provider === 'lmstudio');
    expect(sentLm.base_url).toBe('http://localhost:9911/v1');
  });

  it('falha no PUT → false + chainConfig intacto', async () => {
    vi.spyOn(apiClient, 'put').mockRejectedValue({ response: { status: 500 } });
    const ok = await st().persistChainEntry('lmstudio', { model: 'x' });
    expect(ok).toBe(false);
    expect(st().chainConfig[0].model).toBeNull(); // não corrompeu
  });
});
