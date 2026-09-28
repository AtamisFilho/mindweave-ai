import { describe, expect, it } from 'vitest';
import { computeLayout, DEFAULT_NODE_SIZE } from './engine';

// Grafo de referência: Raiz -> A, Raiz -> B (mesmos tamanhos medidos)
const nodes = [
  { id: 'root', position: { x: 0, y: 0 }, measured: { width: 200, height: 60 } },
  { id: 'a', position: { x: 0, y: 0 }, measured: { width: 200, height: 60 } },
  { id: 'b', position: { x: 0, y: 0 }, measured: { width: 200, height: 60 } },
];
const edges = [
  { id: 'e1', source: 'root', target: 'a' },
  { id: 'e2', source: 'root', target: 'b' },
];

describe('computeLayout (motor puro — Diretriz b)', () => {
  it('é determinístico: mesma entrada -> mesmas posições (Diretriz e)', () => {
    const p1 = computeLayout(nodes, edges, { direction: 'LR' });
    const p2 = computeLayout(nodes, edges, { direction: 'LR' });
    expect(p1).toEqual(p2);
  });

  it('não muta a entrada', () => {
    const snapshot = JSON.stringify({ nodes, edges });
    computeLayout(nodes, edges, { direction: 'LR' });
    expect(JSON.stringify({ nodes, edges })).toBe(snapshot);
  });

  it('LR posiciona os filhos À DIREITA da raiz', () => {
    const p = computeLayout(nodes, edges, { direction: 'LR' });
    expect(p.a.x).toBeGreaterThan(p.root.x);
    expect(p.b.x).toBeGreaterThan(p.root.x);
  });

  it('TB posiciona os filhos ABAIXO da raiz', () => {
    const p = computeLayout(nodes, edges, { direction: 'TB' });
    expect(p.a.y).toBeGreaterThan(p.root.y);
    expect(p.b.y).toBeGreaterThan(p.root.y);
  });

  it('devolve posições em formato React Flow (canto superior esquerdo)', () => {
    // raiz sozinha: dagre centra em (w/2, h/2) -> canto = (0, 0) com margin 0
    const p = computeLayout([nodes[0]], [], { direction: 'LR' });
    expect(p.root.x).toBe(0);
    expect(p.root.y).toBe(0);
  });

  it('nó sem measured usa os defaults por tipo (Diretriz a)', () => {
    // O tamanho só é observável na DISTÂNCIA entre nós de ranks diferentes:
    // diferença de canto = largura do nó de origem + ranksep
    const chain = (measured) => [
      { id: 'root', position: { x: 0, y: 0 }, ...(measured ? { measured } : {}) },
      { id: 'child', position: { x: 0, y: 0 }, ...(measured ? { measured } : {}) },
    ];
    const edges = [{ id: 'e', source: 'root', target: 'child' }];

    const withMeasured = computeLayout(chain({ width: 100, height: 40 }), edges, { direction: 'LR', ranksep: 120 });
    const withFallback = computeLayout(chain(null), edges, { direction: 'LR', ranksep: 120 });

    const diffMeasured = withMeasured.child.x - withMeasured.root.x; // 100 + 120
    const diffFallback = withFallback.child.x - withFallback.root.x; // 220 + 120 (fallback)
    expect(diffMeasured).toBe(220);
    expect(diffFallback).toBe(340);
    expect(diffFallback).toBe(diffMeasured + (DEFAULT_NODE_SIZE.width - 100));
    expect(DEFAULT_NODE_SIZE.width).toBeGreaterThan(100); // sanity do fixture
  });

  it('ignora arestas referenciando nós inexistentes (não lança)', () => {
    expect(() =>
      computeLayout(nodes, [{ id: 'e9', source: 'root', target: 'fantasma' }], { direction: 'LR' }),
    ).not.toThrow();
  });

  it('grafo vazio -> objeto vazio', () => {
    expect(computeLayout([], [])).toEqual({});
  });
});
