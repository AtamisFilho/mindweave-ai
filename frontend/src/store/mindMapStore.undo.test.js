import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyNodeChanges } from '@xyflow/react';
import useMindMapStore from './mindMapStore';
import apiClient from '../services/api';

// Suite do undo/redo (v0.6.0 B1): semântica de pilha, coalescing de drag,
// decisão por tipo de ação e a invariante de imutabilidade sob os DOIS
// mutadores (nossas ações E applyNodeChanges — o mutador perigoso é a
// biblioteca, não o nosso código).
const mkNode = (id, label, extra = {}) => ({
  id, type: 'custom', data: { label, parentId: null, isNew: false, ...extra }, position: { x: 0, y: 0 },
});
const root = () => mkNode('root', 'Raiz', { isRoot: true });

const st = () => useMindMapStore.getState();

beforeEach(() => {
  useMindMapStore.setState({
    nodes: [root()],
    edges: [],
    aiLoading: false,
    chat: [],
    chatState: null,
    currentMapId: 'map-1',
    activePanel: 'nodes',
    undoStack: [],
    redoStack: [],
    layoutMeta: { schema: 'balanced-lr', edgeType: null, compact: false },
  });
});

describe('pushUndo/undo/redo (semântica de pilha)', () => {
  it('addNode empilha; undo remove nó + aresta; redo restaura', () => {
    const id = st().addNode('root', undefined, { label: 'A' });
    expect(st().undoStack).toHaveLength(1);
    expect(st().undoStack[0].label).toBe('adicionar nó');

    st().undo();
    expect(st().nodes.map((n) => n.id)).toEqual(['root']);
    expect(st().edges).toHaveLength(0);
    expect(st().redoStack).toHaveLength(1);

    st().redo();
    expect(st().nodes.map((n) => n.id)).toContain(id);
    expect(st().edges.map((e) => `${e.source}->${e.target}`)).toContain(`root->${id}`);
  });

  it('nova ação zera o redo', () => {
    st().addNode('root', undefined, { label: 'A' });
    st().undo();
    expect(st().redoStack).toHaveLength(1);
    st().addNode('root', undefined, { label: 'B' }); // ação nova
    expect(st().redoStack).toHaveLength(0);
  });

  it('teto de 50: a mais antiga é descartada', () => {
    for (let i = 0; i < 60; i += 1) st().addNode('root', undefined, { label: `n${i}` });
    expect(st().undoStack).toHaveLength(50);
    // entradas 1..10 caíram fora; a primeira viva é a pré-inserção do n10
    expect(st().undoStack[0].nodes).toHaveLength(11); // raiz + n0..n9
  });

  it('snapshot é por referência: mutações seguintes não vazam para dentro', () => {
    st().addNode('root', undefined, { label: 'A' });
    const snap = st().undoStack[0];
    st().addNode('root', undefined, { label: 'B' });
    st().updateNodeLabel(st().nodes[1].id, 'MUDOU');
    // o snapshot continua íntegro (invariante de imutabilidade)
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].data.label).toBe('Raiz');
  });

  it('invariante sob applyNodeChanges (o mutador perigoso é a biblioteca)', () => {
    st().addNode('root', undefined, { label: 'A' });
    const idA = st().nodes[1].id;
    st().addNode('root', undefined, { label: 'B' }); // empilha snapshot COM o nó A
    const snap = st().undoStack.at(-1);
    const before = snap.nodes.find((n) => n.id === idA);

    // changes de position/dimensions via applyNodeChanges, como o canvas faz
    let nodes = applyNodeChanges(
      [{ id: idA, type: 'position', position: { x: 500, y: 400 }, dragging: true }], snap.nodes,
    );
    nodes = applyNodeChanges(
      [{ id: idA, type: 'dimensions', dimensions: { width: 300, height: 90 }, setAttributes: true }], nodes,
    );
    useMindMapStore.setState({ nodes });

    // snapshot intacto: objeto de antes não mutou
    const after = snap.nodes.find((n) => n.id === idA);
    expect(after).toBe(before);
    expect(after.position.x).toBe(before.position.x);
    expect(after.measured).toBeUndefined();
  });
});

describe('decisão por tipo de ação (não por assinatura)', () => {
  it('edição de rótulo empilha; rótulo igual não empilha', () => {
    st().updateNodeLabel('root', 'Novo nome');
    expect(st().undoStack).toHaveLength(1);
    expect(st().undoStack[0].label).toBe('renomear nó');

    st().undo();
    expect(st().nodes[0].data.label).toBe('Raiz');

    st().updateNodeLabel('root', 'Raiz'); // igual: sem entrada
    expect(st().undoStack).toHaveLength(0);
  });

  it('isNew não revive no undo (não reabre o editor)', () => {
    const id = st().addNode('root', undefined, { label: 'Rascunho' });
    st().updateNodeLabel(id, 'Definido');
    st().undo(); // volta ao estado pré-edição: nó existia com isNew:true
    expect(st().nodes.find((n) => n.id === id).data.isNew).toBe(false);
  });

  it('connectNodes: válido empilha; duplicata/raiz-alvo não empilham', () => {
    const a = st().addNode('root', undefined, { label: 'A' });
    const b = st().addNode(a, undefined, { label: 'B' });
    const before = st().undoStack.length;

    // cross-link válido (DAG): root vira segundo pai de B
    expect(st().connectNodes({ source: 'root', target: b })).toBe(true);
    expect(st().undoStack.length).toBe(before + 1);

    expect(st().connectNodes({ source: 'root', target: b })).toBe(false); // duplicata
    expect(st().connectNodes({ source: b, target: 'root' })).toBe(false); // raiz não vira filha
    expect(st().connectNodes({ source: 'root', target: a })).toBe(false); // criaria ciclo
    expect(st().undoStack.length).toBe(before + 1);
  });

  it('deleção via onNodesChange: 1 entrada e undo restaura nó, arestas e cache', () => {
    const a = st().addNode('root', undefined, { label: 'A' });
    const b = st().addNode(a, undefined, { label: 'B' });
    const before = st().undoStack.length;

    st().onNodesChange([{ id: b, type: 'remove' }]);
    expect(st().nodes.map((n) => n.id)).toEqual(['root', a]);
    expect(st().edges.some((e) => e.target === b)).toBe(false);
    // filho de B (nenhum) — mas o cache do A não foi afetado; removendo A:
    st().onNodesChange([{ id: a, type: 'remove' }]);
    const aEntry = st().undoStack.length - before;
    expect(aEntry).toBe(2); // 2 deleções = 2 entradas

    st().undo();
    expect(st().nodes.map((n) => n.id)).toContain(a);
    expect(st().edges.some((e) => e.target === a)).toBe(true);
    // e o undo da deleção de A restaura B? Não — entradas são independentes;
    // o snapshot anterior à deleção de A contém B
    expect(st().nodes.find((n) => n.id === a).data.parentId).toBe('root');
  });

  it('drag: 3 eventos dragging + dragging:false = 1 entrada', () => {
    const before = st().undoStack.length;
    st().onNodesChange([{ id: 'root', type: 'position', position: { x: 10, y: 10 }, dragging: true }]);
    st().onNodesChange([{ id: 'root', type: 'position', position: { x: 20, y: 20 }, dragging: true }]);
    st().onNodesChange([{ id: 'root', type: 'position', position: { x: 30, y: 30 }, dragging: true }]);
    st().onNodesChange([{ id: 'root', type: 'position', position: { x: 40, y: 40 }, dragging: false }]);
    expect(st().undoStack.length - before).toBe(1);

    // drag seguinte arma de novo (e FECHA: teste seguinte começa desarmado)
    st().onNodesChange([{ id: 'root', type: 'position', position: { x: 50, y: 50 }, dragging: true }]);
    st().onNodesChange([{ id: 'root', type: 'position', position: { x: 60, y: 60 }, dragging: false }]);
    expect(st().undoStack.length - before).toBe(2);
  });

  it('movimento pontual (sem drag) = 1 entrada; seleção/dimensions = 0', () => {
    const before = st().undoStack.length;
    st().onNodesChange([{ id: 'root', type: 'position', position: { x: 10, y: 10 }, dragging: false }]);
    expect(st().undoStack.length - before).toBe(1);

    st().onNodesChange([{ id: 'root', type: 'select', selected: true }]);
    expect(st().undoStack.length - before).toBe(1); // seleção não empilha

    st().onNodesChange([{ id: 'root', type: 'dimensions', dimensions: { width: 200, height: 60 }, setAttributes: true }]);
    expect(st().undoStack.length - before).toBe(1); // dimensions não empilha
  });
});

describe('layout, preset e sugestões', () => {
  it('applyLayoutPositions empilha; relayoutAuto (skipUndo) não empilha', () => {
    const id = st().addNode('root', undefined, { label: 'A' });
    const before = st().undoStack.length;

    useMindMapStore.setState({ autoLayout: true });
    st().relayoutAuto(); // skipUndo — absorvido
    expect(st().undoStack.length - before).toBe(0);

    st().applyLayoutPositions({ [id]: { x: 999, y: 0 } }); // manual empilha
    expect(st().undoStack.length - before).toBe(1);
    expect(st().undoStack.at(-1).label).toBe('organizar layout');

    st().undo();
    expect(st().nodes.find((n) => n.id === id).position.x).not.toBe(999);
  });

  it('setVisualPreset empilha e undo restaura arestas + layoutMeta juntos', () => {
    st().addNode('root', undefined, { label: 'A' }); // cria a aresta do preset
    useMindMapStore.setState({ undoStack: [], redoStack: [] }); // isolamento
    st().setVisualPreset({ edgeType: 'straight', compact: true });
    expect(st().layoutMeta.compact).toBe(true);
    expect(st().edges[0].type).toBe('straight');

    st().undo();
    expect(st().layoutMeta.compact).toBe(false);
    expect(st().edges[0].type).toBe('smoothstep'); // tipo do addNode (pré-preset)
  });

  it('sugestões de IA em lote = 1 entrada (addNode com skipUndo)', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: { suggestedNodes: [{ content: 'S1' }, { content: 'S2' }, { content: 'S3' }], provider_used: 'Ollama (local)' },
    });
    await st().suggestNewNodes('root');
    expect(st().undoStack).toHaveLength(1);
    expect(st().undoStack[0].label).toBe('sugestões de IA');
    expect(st().nodes).toHaveLength(4);

    st().undo();
    expect(st().nodes).toHaveLength(1); // as 3 sugestões saem JUNTAS
  });

  it('lote sem sugestões não empilha', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: { results: [{ node_id: 'root', suggestedNodes: [], provider_used: 'x' }] },
    });
    await st().suggestNewNodes('root');
    expect(st().undoStack).toHaveLength(0);
  });
});

describe('troca/criação de mapa limpa os stacks', () => {
  it('undo não atravessa mapas (_applyServerMap limpa)', async () => {
    st().addNode('root', undefined, { label: 'A' });
    expect(st().undoStack).toHaveLength(1);

    // carrega "outro mapa" do servidor
    vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
      data: { id: 'map-2', title: 'Outro', version: 1, document: { nodes: [root()], edges: [] } },
    });
    await st().loadMap('map-2');
    expect(st().undoStack).toHaveLength(0);
    expect(st().redoStack).toHaveLength(0);
  });

  it('generateMap limpa os stacks ao criar o mapa novo', async () => {
    st().addNode('root', undefined, { label: 'A' });
    vi.spyOn(apiClient, 'post').mockImplementation(async (url) => {
      if (url === '/ai/generate') {
        return { data: { title: 'Gerado', tree: { topic: 'Gerado', children: [] }, provider_used: 'Groq' } };
      }
      return { data: { id: 'map-3', title: 'Gerado', version: 1, document: { nodes: [], edges: [] } } };
    });
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { models: [] } });
    await st().generateMap('Gerado');
    expect(st().undoStack).toHaveLength(0);
    expect(st().redoStack).toHaveLength(0);
  });
});

describe('undo não toca no chat', () => {
  it('chat permanece intacto entre undos', () => {
    useMindMapStore.setState({ chat: [{ role: 'user', content: 'pergunta' }] });
    st().addNode('root', undefined, { label: 'A' });
    st().undo();
    expect(st().chat).toEqual([{ role: 'user', content: 'pergunta' }]);
  });
});
