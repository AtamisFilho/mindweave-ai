import { beforeEach, describe, expect, it } from 'vitest';
import useMindMapStore from './mindMapStore';

// Suite do B3 (v0.6.0): Enter/Tab — continuidade de edição. O guarda de
// escopo (só com editor ativo) é comportamento do CustomNode → E2E; aqui
// ficam a semântica do addSiblingNode e a granularidade do undo.
const mkNode = (id, label, extra = {}) => ({
  id, type: 'custom', data: { label, parentId: null, isNew: false, ...extra }, position: { x: 0, y: 0 },
});
const root = () => mkNode('root', 'Raiz', { isRoot: true });

const st = () => useMindMapStore.getState();

beforeEach(() => {
  useMindMapStore.setState({
    nodes: [root()],
    edges: [],
    currentMapId: 'map-1',
    undoStack: [],
    redoStack: [],
    autoLayout: false,
  });
});

describe('addSiblingNode (Tab)', () => {
  it('irmão nasce com o MESMO pai, após os irmãos existentes', () => {
    st().addNode('root', undefined, { label: 'A' });
    const b = st().addNode('root', undefined, { label: 'B' });

    const sib = st().addSiblingNode(b);
    const sibNode = st().nodes.find((n) => n.id === sib);
    expect(sibNode.data.parentId).toBe('root');
    const yOf = (id) => st().nodes.find((n) => n.id === id).position.y;
    expect(yOf(sib)).toBeGreaterThan(yOf(b)); // após o irmão em edição
    expect(st().edges.map((e) => `${e.source}->${e.target}`)).toContain(`root->${sib}`);
  });

  it('irmão de RAIZ é outra raiz (isRoot, sem pai, sem aresta)', () => {
    const sib = st().addSiblingNode('root');
    const sibNode = st().nodes.find((n) => n.id === sib);
    expect(sibNode.data.isRoot).toBe(true);
    expect(sibNode.data.parentId).toBeNull();
    expect(st().edges).toHaveLength(0);
    expect(st().nodes).toHaveLength(2);
  });

  it('nó nasce em modo de edição (isNew) — corrente de foco do B3', () => {
    const a = st().addNode('root', undefined, { label: 'A' });
    const sib = st().addSiblingNode(a);
    expect(st().nodes.find((n) => n.id === sib).data.isNew).toBe(true);
  });

  it('nó inexistente: null, nada criado', () => {
    expect(st().addSiblingNode('fantasma')).toBeNull();
    expect(st().nodes).toHaveLength(1);
  });
});

describe('undo granular (cada Enter/Tab = 1 entrada)', () => {
  it('rajada de 2 filhos + 1 irmão = 3 entradas; cada undo remove UM nó', () => {
    const a = st().addNode('root', undefined, { label: 'A' });       // 1
    const b = st().addNode(a, undefined, { label: 'B' });            // 2
    st().addSiblingNode(b);                                          // 3
    expect(st().undoStack).toHaveLength(3);
    expect(st().nodes).toHaveLength(4); // root, A, B, irmão

    st().undo(); // tira o irmão
    expect(st().nodes).toHaveLength(3);
    st().undo(); // tira B
    expect(st().nodes).toHaveLength(2);
    expect(st().nodes.map((n) => n.data.label)).toEqual(['Raiz', 'A']);
  });
});
