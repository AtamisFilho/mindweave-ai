import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMindMapStore from './mindMapStore';
import apiClient from '../services/api';

// Suite do B4 (v0.4.5): Resumir mapa (reusa o chat/stream) + expansão em
// lote (REST) + rastreio da seleção múltipla. Backend provado por pytest;
// aqui provamos a ORQUESTRAÇÃO do store.
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

const mkNode = (id, label, extra = {}) => ({
  id, type: 'custom', data: { label, parentId: null, isNew: false, ...extra }, position: { x: 0, y: 0 },
});
const root = mkNode('root', 'Raiz', { isRoot: true });

beforeEach(() => {
  useMindMapStore.setState({
    nodes: [root],
    edges: [],
    aiLoading: false,
    aiError: null,
    aiErrorCode: null,
    chat: [],
    chatState: null,
    currentMapId: 'map-1',
    activePanel: 'nodes',
    lastSelectedNodeId: null,
    selectedCount: 0,
    lastProviderUsed: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('summarizeMap (B4: pergunta fixa no chat, sem endpoint novo)', () => {
  it('abre a aba Chat, envia a pergunta fixa e anexa a resposta', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      { event: 'chain', provider_label: 'Ollama (local)', status: 'committed' },
      { event: 'token', delta: 'Resumo: ' },
      { event: 'token', delta: 'horta' },
      { event: 'done', provider_used: 'Ollama (local)', context_meta: { strategy: 'outline', nodes_included: 3, chars: 120 } },
    ]));

    await useMindMapStore.getState().summarizeMap();
    const s = useMindMapStore.getState();

    expect(s.activePanel).toBe('chat'); // abre a aba automaticamente
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.question).toContain('resumo executivo'); // pergunta fixa
    expect(s.chat).toHaveLength(2);
    expect(s.chat[0].role).toBe('user');
    expect(s.chat[0].content).toContain('resumo executivo');
    expect(s.chat[1]).toMatchObject({ role: 'assistant', content: 'Resumo: horta' });
    expect(s.chat[1].context_meta.strategy).toBe('outline');
    expect(s.chatState).toBeNull();
  });

  it('não dispara se já há resposta em andamento', async () => {
    useMindMapStore.setState({ chatState: { phase: 'trying', text: '' } });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await useMindMapStore.getState().summarizeMap();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falha do stream não deixa pergunta órfã no chat', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      { event: 'error', error_code: 'ALL_PROVIDERS_FAILED', message: 'toda a cadeia falhou', fallback_trail: [] },
    ]));
    await useMindMapStore.getState().summarizeMap();
    const s = useMindMapStore.getState();
    expect(s.chat).toHaveLength(0); // pergunta removida (sem resposta)
    expect(s.chatState).toBeNull();
  });
});

describe('suggestNodesBatch (B4: expansão múltipla via REST)', () => {
  it('insere as sugestões como filhos com o addNode atômico', async () => {
    const n1 = mkNode('n1', 'Plantio', { parentId: 'root' });
    useMindMapStore.setState({
      nodes: [root, n1],
      edges: [{ id: 'e-root-n1', source: 'root', target: 'n1' }],
    });
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: { results: [
        { node_id: 'root', suggestedNodes: [{ content: 'A' }, { content: 'B' }], provider_used: 'Ollama (local)' },
        { node_id: 'n1', suggestedNodes: [{ content: 'C' }], provider_used: 'Ollama (local)' },
      ] },
    });

    await useMindMapStore.getState().suggestNodesBatch(['root', 'n1']);
    const s = useMindMapStore.getState();

    expect(postSpy).toHaveBeenCalledWith('/ai/suggest-nodes-batch', {
      map_id: 'map-1', node_ids: ['root', 'n1'],
    });
    expect(s.nodes.map((n) => n.data.label)).toEqual(['Raiz', 'Plantio', 'A', 'B', 'C']);
    const pairs = () => s.edges.map((e) => `${e.source}->${e.target}`);
    expect(pairs()).toContain('root->' + s.nodes.find((n) => n.data.label === 'A').id);
    expect(pairs()).toContain('root->' + s.nodes.find((n) => n.data.label === 'B').id);
    expect(pairs()).toContain('n1->' + s.nodes.find((n) => n.data.label === 'C').id);
    expect(s.aiLoading).toBe(false);
    expect(s.lastProviderUsed).toBe('Ollama (local)');
  });

  it('falha isolada de UM nó não impede os demais', async () => {
    const n1 = mkNode('n1', 'Plantio', { parentId: 'root' });
    useMindMapStore.setState({ nodes: [root, n1], edges: [] });
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: { results: [
        { node_id: 'root', error_code: 'ALL_PROVIDERS_FAILED', message: 'cadeia fora' },
        { node_id: 'n1', suggestedNodes: [{ content: 'C' }], provider_used: 'Ollama (local)' },
      ] },
    });

    await useMindMapStore.getState().suggestNodesBatch(['root', 'n1']);
    const s = useMindMapStore.getState();

    expect(s.nodes.map((n) => n.data.label)).toContain('C');
    expect(s.nodes.map((n) => n.data.label)).toHaveLength(3);
    expect(s.aiLoading).toBe(false);
  });

  it('todos falharam: nenhum nó inserido', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: { results: [
        { node_id: 'root', error_code: 'ALL_PROVIDERS_FAILED', message: 'cadeia fora' },
      ] },
    });
    await useMindMapStore.getState().suggestNodesBatch(['root']);
    expect(useMindMapStore.getState().nodes).toHaveLength(1);
  });

  it('sem mapa sincronizado: nem chama a API', async () => {
    useMindMapStore.setState({ currentMapId: null });
    const postSpy = vi.spyOn(apiClient, 'post');
    await useMindMapStore.getState().suggestNodesBatch(['root']);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('teto consciente: no máximo 5 nós por lote', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({ data: { results: [] } });
    await useMindMapStore.getState().suggestNodesBatch(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(postSpy.mock.calls[0][1].node_ids).toHaveLength(5);
  });
});

describe('noteSelection (B4: rastreio da seleção múltipla)', () => {
  it('registra a contagem e o ÚLTIMO selecionado (ordem de clique)', () => {
    const n1 = mkNode('n1', 'A');
    const n2 = mkNode('n2', 'B');
    useMindMapStore.setState({ nodes: [n1, n2] });

    const note = useMindMapStore.getState().noteSelection;
    useMindMapStore.setState({
      nodes: [{ ...n1, selected: true }, n2],
    });
    note('n1', true);
    expect(useMindMapStore.getState().lastSelectedNodeId).toBe('n1');
    expect(useMindMapStore.getState().selectedCount).toBe(1);

    // segundo clique: contagem sobe e o último passa a ser n2
    useMindMapStore.setState({
      nodes: [{ ...n1, selected: true }, { ...n2, selected: true }],
    });
    note('n2', true);
    expect(useMindMapStore.getState().lastSelectedNodeId).toBe('n2');
    expect(useMindMapStore.getState().selectedCount).toBe(2);
  });

  it('desseleção atualiza a contagem sem trocar o último selecionado', () => {
    const n1 = { ...mkNode('n1', 'A'), selected: true };
    const n2 = { ...mkNode('n2', 'B'), selected: true };
    useMindMapStore.setState({ nodes: [n1, n2], selectedCount: 0, lastSelectedNodeId: 'n1' });
    const note = useMindMapStore.getState().noteSelection;
    note('n2', true); // último clique
    expect(useMindMapStore.getState().lastSelectedNodeId).toBe('n2');
    expect(useMindMapStore.getState().selectedCount).toBe(2);

    useMindMapStore.setState({ nodes: [n1, { ...n2, selected: false }] });
    note('n2', false);
    const s = useMindMapStore.getState();
    expect(s.selectedCount).toBe(1);
    expect(s.lastSelectedNodeId).toBe('n2'); // não muda na desseleção (o gate exige selected)
  });
});
