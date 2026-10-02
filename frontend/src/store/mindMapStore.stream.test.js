import { beforeEach, describe, expect, it, vi } from 'vitest';
import useMindMapStore from './mindMapStore';

// Suite do performDeepResearch streaming: fetch mockado com o wire SSE exato
// (backend provado por pytest; aqui provamos a ORQUESTRAÇÃO do store).
function sseResponse(events) {
  const body = new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const root = { id: 'root', type: 'custom', data: { label: 'Raiz', parentId: null, isRoot: true, isNew: false }, position: { x: 0, y: 0 } };

beforeEach(() => {
  useMindMapStore.setState({
    nodes: [root],
    edges: [],
    aiLoading: false,
    aiError: null,
    aiErrorCode: null,
    researchResult: null,
    researchHistory: [],
    researchPanelNodeId: null,
    researchPanelPinned: false,
    lastProviderUsed: null,
    fallbackActiveUntil: 0,
    streamState: null,
    activePanel: 'nodes',
  });
});

describe('performDeepResearch streaming (orquestração do store)', () => {
  it('done: histórico + badge + streamState limpo', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'trying' },
      { event: 'chain', provider_label: 'LM Studio (local)', status: 'committed' },
      { event: 'token', delta: 'resposta ' },
      { event: 'token', delta: 'completa' },
      { event: 'done', provider_used: 'LM Studio (local)', model: 'm', fallback_trail: [] },
    ]));

    await useMindMapStore.getState().performDeepResearch('root');
    const s = useMindMapStore.getState();

    expect(s.researchHistory).toHaveLength(1);
    expect(s.researchHistory[0].summary).toBe('resposta completa');
    expect(s.lastProviderUsed).toBe('LM Studio (local)');
    expect(s.streamState).toBeNull();
    expect(s.activePanel).toBe('research');
    expect(s.aiErrorCode).toBeNull();
  });

  it('mid-death APÓS o commit: PROVIDER_STREAM_INTERRUPTED, sem entrada no histórico', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'trying' },
      { event: 'chain', provider_label: 'LM Studio (local)', status: 'committed' },
      { event: 'token', delta: 'parcial ' },
      { event: 'error', error_code: 'PROVIDER_STREAM_INTERRUPTED', message: 'LM Studio (local): conexão interrompida durante a resposta.', fallback_trail: [{ provider: 'LM Studio (local)', kind: 'NETWORK_ERROR' }], retryable: true },
    ]));

    await useMindMapStore.getState().performDeepResearch('root');
    const s = useMindMapStore.getState();

    expect(s.aiErrorCode).toBe('PROVIDER_STREAM_INTERRUPTED');
    expect(s.aiError).toContain('conexão interrompida');
    expect(s.researchHistory).toHaveLength(0);
    expect(s.streamState).toBeNull();
  });

  it('fallback ANTES do commit: trail acumulada na streamState e done do segundo provedor', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'trying' },
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'failed', kind: 'RATE_LIMIT', message: 'rate limit' },
      { event: 'chain', provider: 'ollama', provider_label: 'Ollama (local)', status: 'trying' },
      { event: 'chain', provider_label: 'Ollama (local)', status: 'committed' },
      { event: 'token', delta: 'do ollama' },
      { event: 'done', provider_used: 'Ollama (local)', model: 'llama3', fallback_trail: [{ provider: 'LM Studio (local)', kind: 'RATE_LIMIT' }] },
    ]));

    await useMindMapStore.getState().performDeepResearch('root');
    const s = useMindMapStore.getState();

    expect(s.lastProviderUsed).toBe('Ollama (local)');
    expect(s.fallbackActiveUntil).toBeGreaterThan(Date.now() - 1000); // badge de fallback ativo
    expect(s.researchHistory[0].summary).toBe('do ollama');
  });

  it('ALL_PROVIDERS_FAILED: erro com trilha, sem histórico', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'trying' },
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'failed', kind: 'NETWORK_ERROR', message: 'fora' },
      { event: 'chain', provider: 'ollama', provider_label: 'Ollama (local)', status: 'trying' },
      { event: 'chain', provider: 'ollama', provider_label: 'Ollama (local)', status: 'failed', kind: 'NETWORK_ERROR', message: 'fora' },
      { event: 'error', error_code: 'ALL_PROVIDERS_FAILED', message: 'Todos os provedores da cadeia falharam.', fallback_trail: [], retryable: true },
    ]));

    await useMindMapStore.getState().performDeepResearch('root');
    const s = useMindMapStore.getState();

    expect(s.aiErrorCode).toBe('ALL_PROVIDERS_FAILED');
    expect(s.researchHistory).toHaveLength(0);
    expect(s.streamState).toBeNull();
  });
});
