import dagre from '@dagrejs/dagre';

/**
 * Layout BALANCEADO estilo mindmap (Left-Right / Up-Down):
 * raiz no centro, subárvores distribuídas nos dois lados.
 *
 * LIMITAÇÃO v1 — cross-links inter-lados: uma aresta que conecta um nó do lado
 * esquerdo a um nó do lado direito é IGNORADA pelo particionamento e pelo
 * layout dos lados; ela é desenhada por cima do canvas (bezier/straight).
 * Resolvê-la exigiria um motor force-directed, que sacrificaria o
 * determinismo bit-a-bit exigido pelo produto.
 *
 * Peso da subárvore: contagem de nós no fecho descendente (modo 'count').
 * Refinamento visual futuro: soma de alturas medidas ('visual').
 *
 * Determinismo: todas as iterações partem de coleções ordenadas por id;
 * empates de peso vão sempre para o lado A.
 */

function compareById(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function buildChildrenMap(nodes, edges) {
  const childrenOf = new Map();
  for (const edge of edges) {
    if (!childrenOf.has(edge.source)) childrenOf.set(edge.source, []);
    childrenOf.get(edge.source).push(edge.target);
  }
  for (const [id, children] of childrenOf) {
    children.sort(compareById);
    childrenOf.set(id, children);
  }
  return childrenOf;
}

function subtreeClosure(startId, childrenOf, claimed) {
  const closure = [];
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (claimed.has(id)) continue;
    claimed.add(id);
    closure.push(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return closure;
}

/**
 * Particiona os filhos diretos da raiz em dois lados (guloso):
 * filhos ordenados por peso DESC; cada um vai para o lado atualmente mais
 * leve (empate -> lado A). flip troca qual lado é A.
 */
export function partitionChildren(rootId, nodes, edges, flip = false) {
  const childrenOf = buildChildrenMap(nodes, edges);
  const direct = [...(childrenOf.get(rootId) ?? [])].sort(compareById);

  const weight = new Map();
  for (const childId of direct) {
    weight.set(childId, subtreeClosure(childId, childrenOf, new Set()).length);
  }

  const sorted = [...direct].sort(
    (a, b) => (weight.get(b) - weight.get(a)) || compareById(a, b),
  );

  const sideA = [];
  const sideB = [];
  let weightA = 0;
  let weightB = 0;
  for (const childId of sorted) {
    const w = weight.get(childId);
    if (weightA <= weightB) {
      sideA.push(childId);
      weightA += w;
    } else {
      sideB.push(childId);
      weightB += w;
    }
  }
  // flip = espelho do balanceamento (lados trocados), não uma 2ª heurística
  if (flip) {
    return { sideA: sideB, sideB: sideA, weight };
  }
  return { sideA, sideB, weight };
}

function layoutSide(root, sideIds, nodesById, sizeById, edges, { axis, mirrored, nodesep, ranksep }) {
  const sideNodes = [root.id, ...sideIds];
  const present = new Set(sideNodes);

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: axis === 'y' ? 'TB' : 'LR', // SEMPRE crescente; o espelho faz o lado oposto (evita quirks do RL/BT)
    nodesep,
    ranksep,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setDefaultNodeLabel(() => ({}));

  for (const id of sideNodes) graph.setNode(id, sizeById.get(id));
  // cross-links inter-lados: arestas com ponta fora do lado são ignoradas (limitação v1)
  for (const edge of edges) {
    if (present.has(edge.source) && present.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  // traduz para a raiz ficar no centro (0,0) e espelha o lado, quando for o caso
  const rootCenter = graph.node(root.id);
  const centers = new Map();
  for (const id of sideNodes) {
    const { x, y } = graph.node(id);
    let cx = x - rootCenter.x;
    let cy = y - rootCenter.y;
    if (axis === 'x' && mirrored) cx = -cx;
    if (axis === 'y' && mirrored) cy = -cy;
    centers.set(id, { x: cx, y: cy });
  }
  return centers;
}

/**
 * @returns {object} { nodeId: { x, y } } — cantos normalizados (min -> 0,0)
 */
export function computeBalancedLayout(nodes, edges, {
  axis = 'x',
  flip = false,
  nodesep = 60,
  ranksep = 120,
} = {}) {
  const sortedNodes = [...nodes].sort(compareById);
  const sortedEdges = [...edges].sort((a, b) => `${a.source}->${a.target}`.localeCompare(`${b.source}->${b.target}`));
  const sizeById = new Map(sortedNodes.map((n) => [n.id, {
    width: n.measured?.width ?? n.width ?? 220,
    height: n.measured?.height ?? n.height ?? 70,
  }]));

  // raiz: marcada como isRoot; senão, sem aresta entrante; senão, o primeiro nó
  const targetIds = new Set(sortedEdges.map((e) => e.target));
  const root = sortedNodes.find((n) => n.data?.isRoot)
    ?? sortedNodes.find((n) => !targetIds.has(n.id))
    ?? sortedNodes[0];
  if (!root) return {};

  const { sideA, sideB } = partitionChildren(root.id, sortedNodes, sortedEdges, flip);

  // fechos com claim compartilhado. Filhos DIRETOS da raiz já têm dono (a
  // partição) — o fecho do lado oposto nunca os rouba (um cross-link que
  // alcança um filho direto não o move de lado). Demais nós: primeiro lado
  // que os alcança (ordem fixa = determinístico).
  const childrenOf = buildChildrenMap(sortedNodes, sortedEdges);
  const claimed = new Set([root.id, ...sideA, ...sideB]);
  const collectDescendants = (startId, closure) => {
    const stack = [...(childrenOf.get(startId) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop();
      if (claimed.has(id)) continue;
      claimed.add(id);
      closure.push(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
  };
  const closureA = [];
  for (const id of sideA) {
    closureA.push(id); // o filho direto pertence ao seu lado (claimed acima)
    collectDescendants(id, closureA);
  }
  const closureB = [];
  for (const id of sideB) {
    closureB.push(id);
    collectDescendants(id, closureB);
  }

  // lado A = espelhado (esquerda/cima); lado B = direto (direita/baixo)
  const centersA = layoutSide(root, closureA, new Map(sortedNodes.map((n) => [n.id, n])), sizeById, sortedEdges, { axis, mirrored: !flip, nodesep, ranksep });
  const centersB = layoutSide(root, closureB, new Map(sortedNodes.map((n) => [n.id, n])), sizeById, sortedEdges, { axis, mirrored: flip, nodesep, ranksep });

  const centers = new Map([[root.id, { x: 0, y: 0 }]]);
  for (const [id, c] of centersA) if (id !== root.id) centers.set(id, c);
  for (const [id, c] of centersB) if (id !== root.id) centers.set(id, c);

  // centros -> cantos; normaliza o bounding box para (0,0)
  const corners = new Map();
  let minX = Infinity;
  let minY = Infinity;
  for (const node of sortedNodes) {
    const size = sizeById.get(node.id);
    const center = centers.get(node.id);
    if (!center) continue; // nós desconectados mantêm a posição atual (nada a organizar)
    const corner = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
    corners.set(node.id, corner);
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
  }

  const positions = {};
  for (const node of sortedNodes) {
    const corner = corners.get(node.id);
    if (!corner) continue;
    positions[node.id] = {
      x: Math.round(corner.x - minX),
      y: Math.round(corner.y - minY),
    };
  }
  return positions;
}
