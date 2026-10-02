import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMindMapStore from './mindMapStore';
import apiClient from '../services/api';

// Suite do B2.5 (v0.6.0): persistência do diário de pesquisas em meta.research.
// Critérios: (b) teto 40 com poda, (d) tombstones coerentes pós undo,
// (f) done de pesquisa dispara o autosave SEM tocar no grafo, (g) hidratação
// pelo _applyServerMap (nada de zerar calado).
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

const mkNode = (id, label) => ({
  id, type: 'custom', data: { label, parentId: null, isNew: false }, position: { x: 0, y: 0 },
});
const root = () => mkNode('root', 'Raiz', { isRoot: true });
const entry = (n) => ({ id: `e${n}`, nodeId: 'root', summary: `resumo ${n}`, createdAt: n });

const st = () => useMindMapStore.getState();

beforeEach(() => {
  useMindMapStore.setState({
    nodes: [root()],
    edges: [],
    researchHistory: [],
    researchResult: null,
    chat: [],
    currentMapId: 'map-1',
    mapVersion: 1,
    hydrating: false,
    saveState: 'idle',
    activePanel: 'nodes',
    undoStack: [],
    redoStack: [],
    autoLayout: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('(b) teto de 40 com poda', () => {
  it('_documentFromState persiste as 40 últimas (a 41ª poda a mais antiga)', () => {
    const history = Array.from({ length: 41 }, (_, i) => entry(i + 1));
    useMindMapStore.setState({ researchHistory: history });
    const meta = st()._documentFromState().meta;
    expect(meta.research).toHaveLength(40);
    expect(meta.research[0].summary).toBe('resumo 2'); // resumo 1 podado
    expect(meta.research[39].summary).toBe('resumo 41');
  });

  it('resumo é podado na criação (teto por entrada, bounda o blob)', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      { event: 'chain', provider_label: 'Ollama (local)', status: 'committed' },
      { event: 'token', delta: 'x'.repeat(4500) },
      { event: 'done', provider_used: 'Ollama (local)', fallback_trail: [] },
    ]));
    await st().performDeepResearch('root');
    expect(st().researchHistory[0].summary).toHaveLength(4000);
  });
});

describe('(f) done de pesquisa dispara o autosave sem tocar no grafo', () => {
  it('PUT sai com meta.research; nodes/edges idênticos aos do carregamento', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async () => sseResponse([
      { event: 'chain', provider_label: 'Ollama (local)', status: 'committed' },
      { event: 'token', delta: 'achado importante' },
      { event: 'done', provider_used: 'Ollama (local)', fallback_trail: [] },
    ]));
    const putSpy = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { version: 2 } });

    const nodesBefore = st().nodes;
    const edgesBefore = st().edges;

    await st().performDeepResearch('root');
    expect(st().researchHistory).toHaveLength(1); // done registrado
    expect(st().nodes).toBe(nodesBefore); // GRAFO INTACTO
    expect(st().edges).toBe(edgesBefore);

    await vi.advanceTimersByTimeAsync(1100); // debounce do autosave (1s)
    expect(putSpy).toHaveBeenCalledTimes(1);
    const body = putSpy.mock.calls[0][1];
    expect(body.document.meta.research).toHaveLength(1);
    expect(body.document.meta.research[0].summary).toBe('achado importante');
    expect(body.document.meta.chat).toEqual([]); // chat segue no mesmo blob
  });
});

describe('(d) tombstones coerentes após undo de deleção', () => {
  it('entrada sobrevive à deleção do nó e volta a resolver com o undo', () => {
    const id = st().addNode('root', undefined, { label: 'Anotado' });
    useMindMapStore.setState({
      researchHistory: [{ id: 'e1', nodeId: id, summary: 'diário do nó', createdAt: 1 }],
      undoStack: [], redoStack: [],
    });

    st().onNodesChange([{ id, type: 'remove' }]);
    expect(st().nodes.find((n) => n.id === id)).toBeUndefined();
    // tombstone: a entrada permanece (o diário não é apagado pela deleção)
    expect(st().researchHistory[0].nodeId).toBe(id);

    st().undo();
    expect(st().nodes.find((n) => n.id === id)).toBeDefined();
    expect(st().researchHistory[0].nodeId).toBe(id); // volta a resolver
  });
});

describe('(g) hidratação pelo _applyServerMap', () => {
  it('hidrata de meta.research (não zera) e antes de qualquer painel', () => {
    st()._applyServerMap({
      id: 'map-9', title: 'Título', version: 3,
      document: {
        nodes: [root()], edges: [],
        meta: { research: [{ id: 'e9', nodeId: 'root', summary: 'diário salvo', createdAt: 9 }] },
      },
    });
    expect(st().researchHistory).toHaveLength(1);
    expect(st().researchHistory[0].summary).toBe('diário salvo');
  });

  it('mapa sem meta.research: array vazio, sem crash', () => {
    st()._applyServerMap({
      id: 'map-10', title: 'Velho', version: 1,
      document: { nodes: [root()], edges: [], meta: {} },
    });
    expect(st().researchHistory).toEqual([]);
  });

  it('generateMap hidrata do documento criado (mesma regra)', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockImplementation(async (url) => {
      if (url === '/ai/generate') {
        return { data: { title: 'G', tree: { topic: 'G', children: [] }, provider_used: 'Groq' } };
      }
      return {
        data: {
          id: 'map-11', title: 'G', version: 1,
          document: { nodes: [root()], edges: [], meta: { research: [entry(7)] } },
        },
      };
    });
    await st().generateMap('G');
    expect(postSpy).toHaveBeenCalled();
    expect(st().researchHistory.map((e) => e.summary)).toContain('resumo 7');
  });
});
