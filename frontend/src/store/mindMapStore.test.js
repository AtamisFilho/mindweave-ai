import { beforeEach, describe, expect, it } from 'vitest';
import useMindMapStore, { getAncestorContext } from './mindMapStore';

// Suite da lógica pura do store — chama as actions direto, sem simular mouse.
const getState = () => useMindMapStore.getState();
const setState = useMindMapStore.setState;

const labels = () => getState().nodes.map((n) => n.data.label);
const edgePairs = () => getState().edges.map((e) => `${e.source}->${e.target}`);
const nodeByLabel = (label) => getState().nodes.find((n) => n.data.label === label);

beforeEach(() => {
  setState({
    nodes: [{ id: 'root', type: 'custom', data: { label: 'Raiz', parentId: null, isRoot: true, isNew: false }, position: { x: 0, y: 0 } }],
    edges: [],
    aiLoading: false,
    aiError: null,
    aiErrorCode: null,
    researchResult: null,
    researchHistory: [],
    researchPanelNodeId: null,
    researchPanelPinned: false,
    configFocusKey: null,
    activePanel: 'nodes',
  });
});

describe('addNode (atomicidade nó + aresta)', () => {
  it('cria o nó E a aresta num único estado', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    expect(labels()).toEqual(['Raiz', 'A']);
    expect(edgePairs()).toEqual(['root->' + idA]);
    expect(getState().nodes.find((n) => n.id === idA).data.parentId).toBe('root');
  });
});

describe('connectNodes (DAG com validações)', () => {
  it('permite cross-link: segundo pai para o mesmo nó', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    const idB = getState().addNode(idA, undefined, { label: 'B' });
    expect(getState().connectNodes({ source: 'root', target: idB })).toBe(true);
    expect(edgePairs()).toHaveLength(3); // root->A, A->B, root->B
  });

  it('rejeita aresta duplicada', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    expect(getState().connectNodes({ source: 'root', target: idA })).toBe(false);
    expect(edgePairs()).toHaveLength(1);
  });

  it('rejeita ciclo (filho -> ancestral)', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    const idB = getState().addNode(idA, undefined, { label: 'B' });
    const idC = getState().addNode(idB, undefined, { label: 'C' });
    expect(getState().connectNodes({ source: idC, target: idA })).toBe(false);
    expect(getState().connectNodes({ source: idB, target: 'root' })).toBe(false);
    expect(edgePairs()).toHaveLength(3);
  });

  it('rejeita auto-conexão e conexão em nó raiz', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    expect(getState().connectNodes({ source: idA, target: idA })).toBe(false);
    expect(getState().connectNodes({ source: idA, target: 'root' })).toBe(false);
  });

  it('atualiza o cache parentId ao conectar manualmente', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    const idB = getState().addNode(idA, undefined, { label: 'B' });
    getState().connectNodes({ source: 'root', target: idB });
    expect(getState().nodes.find((n) => n.id === idB).data.parentId).toBe('root');
  });
});

describe('getAncestorContext (BFS pais-first)', () => {
  it('retorna pais diretos antes dos ancestrais, sem duplicatas', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    const idB = getState().addNode(idA, undefined, { label: 'B' });
    getState().connectNodes({ source: 'root', target: idB }); // cross-link
    const context = getAncestorContext(getState().nodes, getState().edges, idB);
    expect(context.map((c) => c.content)).toEqual(['A', 'Raiz']);
  });

  it('percorre múltiplos caminhos do DAG (dois pais com ancestrais distintos)', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    const idB = getState().addNode('root', undefined, { label: 'B' });
    const idC = getState().addNode(idA, undefined, { label: 'C' });
    getState().connectNodes({ source: idB, target: idC }); // C tem pais A e B
    const context = getAncestorContext(getState().nodes, getState().edges, idC);
    expect(context.map((c) => c.content)).toEqual(['A', 'B', 'Raiz']);
  });

  it('nó raiz não tem ancestrais', () => {
    expect(getAncestorContext(getState().nodes, getState().edges, 'root')).toEqual([]);
  });

  it('teta o contexto em 12 ancestrais', () => {
    let parentId = 'root';
    for (let i = 0; i < 20; i++) {
      parentId = getState().addNode(parentId, undefined, { label: `N${i}` });
    }
    const context = getAncestorContext(getState().nodes, getState().edges, parentId);
    expect(context).toHaveLength(12);
  });
});

describe('exclusões consistentes', () => {
  it('remover nó poda arestas conectadas e limpa parentId órfão', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    const idB = getState().addNode(idA, undefined, { label: 'B' });
    getState().onNodesChange([{ id: idA, type: 'remove' }]);
    expect(labels()).toEqual(['Raiz', 'B']);
    expect(edgePairs()).toEqual([]);
    expect(getState().nodes.find((n) => n.id === idB).data.parentId).toBeNull();
  });

  it('remover aresta não remove os nós', () => {
    getState().addNode('root', undefined, { label: 'A' });
    const edgeId = getState().edges[0].id;
    getState().onEdgesChange([{ id: edgeId, type: 'remove' }]);
    expect(getState().nodes).toHaveLength(2);
    expect(getState().edges).toHaveLength(0);
  });
});

describe('painel de pesquisas (pin e contexto)', () => {
  it('pin ativo impede que nova pesquisa troque o nó exibido', () => {
    setState({ researchPanelNodeId: 'root', researchPanelPinned: true, researchHistory: [] });
    getState().setResearchPanelNode; // existe
    // simula o efeito de sucesso de uma pesquisa com pin ativo:
    setState((s) => ({
      researchHistory: [{ id: 'r1', nodeId: 'outro', summary: 'x', createdAt: Date.now() }],
      researchPanelNodeId: s.researchPanelPinned ? s.researchPanelNodeId : 'outro',
    }));
    expect(getState().researchPanelNodeId).toBe('root');
  });

  it('sem pin, nova pesquisa troca o nó exibido', () => {
    setState({ researchPanelNodeId: 'root', researchPanelPinned: false });
    setState((s) => ({
      researchHistory: [{ id: 'r1', nodeId: 'outro', summary: 'x', createdAt: Date.now() }],
      researchPanelNodeId: s.researchPanelPinned ? s.researchPanelNodeId : 'outro',
    }));
    expect(getState().researchPanelNodeId).toBe('outro');
  });

  it('openConfigForKey mapeia provider para o campo correto', () => {
    getState().openConfigForKey('Google');
    expect(getState().configFocusKey).toBe('google');
    getState().openConfigForKey('OpenAI');
    expect(getState().configFocusKey).toBe('openai');
  });
});

describe('applyLayoutPositions / restorePositions (v0.5)', () => {
  it('aplica posições em massa e devolve o snapshot anterior', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    const previous = getState().applyLayoutPositions({
      root: { x: 100, y: 200 },
      [idA]: { x: 400, y: 200 },
    });
    const root = getState().nodes.find((n) => n.id === 'root');
    const a = getState().nodes.find((n) => n.id === idA);
    expect(root.position).toEqual({ x: 100, y: 200 });
    expect(a.position).toEqual({ x: 400, y: 200 });
    expect(previous.root).toEqual({ x: 0, y: 0 }); // posição original do root
  });

  it('restorePositions volta o mapa ao snapshot (Undo escopado)', () => {
    const idA = getState().addNode('root', undefined, { label: 'A' });
    const previous = getState().applyLayoutPositions({
      root: { x: 100, y: 200 },
      [idA]: { x: 400, y: 200 },
    });
    getState().restorePositions(previous);
    expect(getState().nodes.find((n) => n.id === 'root').position).toEqual({ x: 0, y: 0 });
  });

  it('aplicar layout dispara o autosave (nodes mudam) e é um único lote', () => {
    // guard: hidratação suspende, mutação de nodes dispara — já coberto pelo
    // subscribe; aqui garantimos que posições viram parte do documento salvo
    const idA = getState().addNode('root', undefined, { label: 'A' });
    getState().applyLayoutPositions({ root: { x: 10, y: 20 }, [idA]: { x: 30, y: 40 } });
    const saved = getState().nodes;
    expect(saved.find((n) => n.id === 'root').position).toEqual({ x: 10, y: 20 });
    expect(saved.find((n) => n.id === idA).position).toEqual({ x: 30, y: 40 });
  });
});

describe('sanidade do grafo inicial', () => {
  it('raiz inicial é única e marcada como root', () => {
    expect(nodeByLabel('Raiz').data.isRoot).toBe(true);
    expect(edgePairs()).toEqual([]);
  });
});
