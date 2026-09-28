import dagre from '@dagrejs/dagre';
import { computeBalancedLayout } from './balance';

/**
 * Motor de layout automático — FUNÇÃO PURA (Diretriz b do Tech Lead):
 * (grafo + config) -> mapa de posições. Sem DOM, sem store, sem efeitos.
 *
 * Determinístico (Diretriz e): a entrada é ordenada por id antes de alimentar
 * o dagre, então o mesmo grafo + mesma direção produz SEMPRE as mesmas posições.
 *
 * Tamanhos (Diretriz a): usa node.measured (v12) quando existir; nós ainda não
 * medidos (boot/headless) caem nos defaults por tipo — o layout é determinístico
 * independente de "o nó já renderizou?".
 */

export const DEFAULT_NODE_SIZE = { width: 220, height: 70 };

// Schemas no estilo niMind: 4 direções simples + 2 balanceadas (raiz no centro)
export const LAYOUT_SCHEMAS = [
  { value: 'LR', label: 'Esquerda → Direita' },
  { value: 'RL', label: 'Direita → Esquerda' },
  { value: 'TB', label: 'Cima → Baixo' },
  { value: 'BT', label: 'Baixo → Cima' },
  { value: 'balanced-lr', label: 'Left-Right (balanceado)' },
  { value: 'balanced-ud', label: 'Up-Down (balanceado)' },
];

// Compat com o B1 (canvas antigo/testes)
export const LAYOUT_DIRECTIONS = LAYOUT_SCHEMAS.filter((s) => !s.value.startsWith('balanced'));

const BALANCED_SCHEMAS = {
  'balanced-lr': { axis: 'x', flip: false },
  'balanced-rl': { axis: 'x', flip: true },
  'balanced-ud': { axis: 'y', flip: false },
  'balanced-du': { axis: 'y', flip: true },
};

function nodeSize(node) {
  return {
    width: node.measured?.width ?? node.width ?? DEFAULT_NODE_SIZE.width,
    height: node.measured?.height ?? node.height ?? DEFAULT_NODE_SIZE.height,
  };
}

function compareById(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function edgeKey(edge) {
  const source = edge.source ?? '';
  const target = edge.target ?? '';
  return `${source}->${target}`;
}

/**
 * @param {Array} nodes   nós no formato React Flow ({ id, position, measured?, width?, height? })
 * @param {Array} edges   arestas no formato React Flow ({ id, source, target })
 * @param {object} config { schema?: 'LR'|'RL'|'TB'|'BT'|'balanced-lr'|'balanced-ud'|…,
 *                          direction?: (alias legado de schema), nodesep, ranksep }
 * @returns {object}      { nodeId: { x, y } } — canto superior esquerdo (formato React Flow)
 */
export function computeLayout(nodes, edges, {
  schema,
  direction,
  nodesep = 60,
  ranksep = 120,
} = {}) {
  const effective = schema ?? direction ?? 'LR';

  if (BALANCED_SCHEMAS[effective]) {
    return computeBalancedLayout(nodes, edges, {
      ...BALANCED_SCHEMAS[effective],
      nodesep,
      ranksep,
    });
  }

  const sortedNodes = [...nodes].sort(compareById);
  const sortedEdges = [...edges].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: effective, nodesep, ranksep, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setDefaultNodeLabel(() => ({}));

  const sizeById = new Map();
  for (const node of sortedNodes) {
    const size = nodeSize(node);
    sizeById.set(node.id, size);
    graph.setNode(node.id, size);
  }
  for (const edge of sortedEdges) {
    if (sizeById.has(edge.source) && sizeById.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  // dagre devolve o CENTRO do nó; React Flow quer o canto superior esquerdo
  const positions = {};
  for (const node of sortedNodes) {
    const { x, y } = graph.node(node.id);
    const size = sizeById.get(node.id);
    positions[node.id] = {
      x: Math.round(x - size.width / 2),
      y: Math.round(y - size.height / 2),
    };
  }
  return positions;
}
