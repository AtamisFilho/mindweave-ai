import { nanoid } from 'nanoid';

/**
 * Converte a árvore gerada pelo LLM ({topic, children[]}) em nós/arestas
 * no formato React Flow. Posições (0,0) — o layout balanced-lr é aplicado
 * pelo chamador via computeLayout/applyLayoutPositions.
 *
 * Determinístico: travessia em profundidade, filhos na ordem recebida
 * (o backend já impôs profundidade/largura/teto).
 */
export function treeToGraph(tree, { maxNodes = 40 } = {}) {
  const nodes = [];
  const edges = [];
  let count = 0;

  const rootId = nanoid(6);
  nodes.push({
    id: rootId,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { label: String(tree.topic ?? 'Mapa').slice(0, 200), parentId: null, isRoot: true, isNew: false },
  });
  count += 1;

  const walk = (nodeObj, parentId, depth) => {
    if (count >= maxNodes) return;
    const children = Array.isArray(nodeObj.children) ? nodeObj.children : [];
    for (const child of children) {
      if (count >= maxNodes || !child || typeof child !== 'object') continue;
      const id = nanoid(6);
      nodes.push({
        id,
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          label: String(child.topic ?? 'Novo').slice(0, 200),
          parentId,
          isRoot: false,
          isNew: false,
        },
      });
      edges.push({
        id: `e-${parentId}-${id}`,
        source: parentId,
        target: id,
        animated: true,
        style: { strokeWidth: 2 },
      });
      count += 1;
      walk(child, id, depth + 1);
    }
  };

  walk(tree, rootId, 0);
  return { nodes, edges, count };
}
