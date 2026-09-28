import { describe, expect, it } from 'vitest';
import { computeLayout } from './engine';
import { partitionChildren } from './balance';

/**
 * Fixtures ASSIMÉTRICAS (Diretriz 6 do B2):
 * - pesado: filho da raiz com subárvore de 10 nós (peso 10)
 * - 5 folhas diretas da raiz (peso 1 cada)
 * Guloso esperado: [pesado] -> lado A (peso 10); [5 folhas] -> lado B (peso 5).
 * (O pesado é atômico — 10 > 15/2 — então 10×5 é a partição ótima.)
 */
function heavyFixture() {
  const nodes = [{ id: 'root', data: { isRoot: true }, position: { x: 0, y: 0 } }];
  const edges = [];

  // subárvore pesada: heavy + 9 descendentes em cadeia
  nodes.push({ id: 'heavy', position: { x: 0, y: 0 } });
  edges.push({ id: 'erh', source: 'root', target: 'heavy' });
  let prev = 'heavy';
  for (let i = 1; i <= 9; i++) {
    const id = `h${i}`;
    nodes.push({ id, position: { x: 0, y: 0 } });
    edges.push({ id: `eh${i}`, source: prev, target: id });
    prev = id;
  }

  // 5 folhas diretas da raiz
  for (let i = 1; i <= 5; i++) {
    const id = `leaf${i}`;
    nodes.push({ id, position: { x: 0, y: 0 } });
    edges.push({ id: `el${i}`, source: 'root', target: id });
  }

  return { nodes, edges };
}

// Dois filhos com subárvores IGUAIS de 3 nós — pesos empatados (3×3)
function symmetricFixture() {
  const nodes = [{ id: 'root', data: { isRoot: true }, position: { x: 0, y: 0 } }];
  const edges = [];
  for (const child of ['c1', 'c2']) {
    nodes.push({ id: child, position: { x: 0, y: 0 } });
    edges.push({ id: `e-${child}`, source: 'root', target: child });
    for (let i = 1; i <= 2; i++) {
      const id = `${child}-d${i}`;
      nodes.push({ id, position: { x: 0, y: 0 } });
      edges.push({ id: `ed-${child}-${i}`, source: child, target: id });
    }
  }
  return { nodes, edges };
}

const sideOf = (positions, rootX) => ({
  left: Object.entries(positions).filter(([id, p]) => id !== 'root' && p.x < rootX).map(([id]) => id),
  right: Object.entries(positions).filter(([id, p]) => id !== 'root' && p.x >= rootX).map(([id]) => id),
});

describe('partição gulosa (partitionChildren)', () => {
  it('(a) fixture assimétrica: pesado sozinho no lado A, 5 folhas no lado B', () => {
    const { nodes, edges } = heavyFixture();
    const { sideA, sideB, weight } = partitionChildren('root', nodes, edges);
    expect(sideA).toEqual(['heavy']);
    expect(sideB).toEqual(['leaf1', 'leaf2', 'leaf3', 'leaf4', 'leaf5']);
    expect(weight.get('heavy')).toBe(10);
  });

  it('(b) pesos empatados: um filho em cada lado (3×3)', () => {
    const { nodes, edges } = symmetricFixture();
    const { sideA, sideB } = partitionChildren('root', nodes, edges);
    expect(sideA).toEqual(['c1']);
    expect(sideB).toEqual(['c2']);
  });

  it('flip troca os lados', () => {
    const { nodes, edges } = heavyFixture();
    const { sideA, sideB } = partitionChildren('root', nodes, edges, true);
    expect(sideA).toEqual(['leaf1', 'leaf2', 'leaf3', 'leaf4', 'leaf5']);
    expect(sideB).toEqual(['heavy']);
  });
});

describe('balanced-lr (Left-Right balanceado)', () => {
  it('(a) subárvore pesada de um lado, folhas do outro — altura balanceada', () => {
    const { nodes, edges } = heavyFixture();
    const p = computeLayout(nodes, edges, { schema: 'balanced-lr' });
    const rootX = p.root.x;
    const sides = sideOf(p, rootX);
    // pesado + descendentes à ESQUERDA; folhas à DIREITA
    expect(sides.left).toContain('heavy');
    expect(sides.left).toHaveLength(10);
    expect(sides.right.filter((id) => id.startsWith('leaf'))).toHaveLength(5);
    // descentes do pesado seguem à esquerda da raiz
    expect(p.h9.x).toBeLessThan(rootX);
  });

  it('(b) pesos empatados -> lados simétricos', () => {
    const { nodes, edges } = symmetricFixture();
    const p = computeLayout(nodes, edges, { schema: 'balanced-lr' });
    // c1 (lado espelhado) à esquerda, c2 à direita, com distâncias espelhadas
    expect(p.c1.x).toBeLessThan(p.root.x);
    expect(p.c2.x).toBeGreaterThan(p.root.x);
    const widthC = p.c2.x - p.c1.x - 220; // 220 = largura default dos nós
    expect(widthC).toBeGreaterThanOrEqual(60); // nodesep default respeitado
    expect(p.c1.y).toBe(p.c2.y); // espelhamento preserva o eixo dos filhos únicos
  });

  it('(c) mesma árvore, duas execuções -> posições idênticas bit a bit', () => {
    const { nodes, edges } = heavyFixture();
    const p1 = computeLayout(nodes, edges, { schema: 'balanced-lr' });
    const p2 = computeLayout(nodes, edges, { schema: 'balanced-lr' });
    expect(p1).toEqual(p2);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });

  it('cross-link inter-lado é ignorado no layout (limitação v1) sem quebrar', () => {
    const { nodes, edges } = heavyFixture();
    // heavy-descendente (lado esquerdo) -> leaf1 (lado direito): cruza a raiz
    edges.push({ id: 'ecross', source: 'h9', target: 'leaf1' });
    const p = computeLayout(nodes, edges, { schema: 'balanced-lr' });
    const rootX = p.root.x;
    expect(p.h9.x).toBeLessThan(rootX);
    expect(p.leaf1.x).toBeGreaterThan(rootX);
    // ambos os pontas continuam posicionados
    expect(p.h9).toBeDefined();
    expect(p.leaf1).toBeDefined();
  });
});

describe('balanced-ud (Up-Down balanceado)', () => {
  it('(a) eixo trocado: pesado acima, folhas abaixo', () => {
    const { nodes, edges } = heavyFixture();
    const p = computeLayout(nodes, edges, { schema: 'balanced-ud' });
    const sides = {
      top: Object.entries(p).filter(([id, pt]) => id !== 'root' && pt.y < p.root.y).map(([id]) => id),
      bottom: Object.entries(p).filter(([id, pt]) => id !== 'root' && pt.y >= p.root.y).map(([id]) => id),
    };
    expect(sides.top).toHaveLength(10);
    expect(sides.top).toContain('heavy');
    expect(sides.bottom.filter((id) => id.startsWith('leaf'))).toHaveLength(5);
  });

  it('(c) determinismo no eixo vertical', () => {
    const { nodes, edges } = heavyFixture();
    const p1 = computeLayout(nodes, edges, { schema: 'balanced-ud' });
    const p2 = computeLayout(nodes, edges, { schema: 'balanced-ud' });
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });
});
