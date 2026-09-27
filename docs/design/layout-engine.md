# Design Doc — Motor de Layout Automático (esquemas estilo niMind)

**Épico:** v0.5 — Layout Engine · **Status:** proposta (aguardando aprovação) · **Branch:** `feature/layout-engine`
**Referência:** dialog "Select Layout Schema" do niMind (6 direções × 9 esquemas visuais)

---

## 1. Decodificando os 9 esquemas

A leitura de que os 9 thumbnails são **combinações de eixos ortogonais** está correta, com um ajuste de vocabulário:

| Eixo | Valores | Custo de implementação |
|---|---|---|
| **Direção** (motor) | Up / Down / Left / Right (+ variantes balanceadas Up-Down / Left-Right) | Alto — é o motor de posicionamento |
| **Estilo de aresta** | *curved* = bezier · *direct* = straight · *cornered* = smoothstep | **Quase zero** — tipos nativos do @xyflow/react (`default`, `straight`, `smoothstep`) |
| **Densidade do nó** | *tree* (nó completo) vs *list* (variante compacta) | Baixo — prop `compact` no CustomNode (padding/altura menores) |

Consequência prática: **os 9 desenhos são uma matriz de apresentação; o trabalho real é o motor**. O produto final expõe `direção × esquema visual`, e internamente traduzimos para `(algoritmo de posição, edge type, densidade)`.

## 2. Escolha do motor (Q1)

| Critério | **dagre** (@dagrejs/dagre) | elkjs | d3-hierarchy |
|---|---|---|---|
| Modelo | Hierárquico (Sugiyama) — **DAG nativo** | Hierárquico + force/stress/radial | **Somente árvore estrita** |
| Execução | **Síncrona** (cabe no store/autosave sem worker) | Async (worker recomendado) | Síncrona |
| Bundle | ~30 KB gz | ~1–2 MB | ~10 KB |
| Cross-links do nosso DAG | Tratados como arestas no layering | Melhor routing (ports/labels) | **Quebram** o tidy tree |
| Maturidade c/ React Flow | Padrão de fato da comunidade | Menos comum | N/A |

**Decisão: dagre na v1** — concordo com a intuição. Os três motivos decisivos: (1) nosso grafo é um **DAG com cross-links** (Bloco 1 da v0.2), e o layering do dagre engole isso de graça enquanto o d3-hierarchy exige poda de arestas e gambiarras; (2) execução **síncrona** casa com o modelo client-authoritative: `applyLayoutPositions()` é uma função pura no store, sem worker nem promises no caminho do autosave; (3) bundle. O d3-hierarchy ficaria tentador só se abrirmos mão de cross-links no auto-layout — não abriremos.

**Plano de escada:** se a v0.5+ exigir layouts radiais/force ou routing sofisticado, elkjs entra como *segundo adapter* atrás da mesma interface — a arquitetura abaixo isola essa troca.

## 3. Arquitetura

```
frontend/src/layout/
├── engine.js          # interface única: computeLayout({nodes, edges}, config) -> positionsById
├── dagreAdapter.js    # dagre puro: TB/BT/LR/RL + opções (nodesep/ranksep)
├── balanced.js        # particionamento L/R + espelhamento (ver §4) — compõe o dagreAdapter
├── schemas.js         # declaração declarativa dos 9 esquemas + 6 direções:
│                      #   { id, direction, edgeType: 'default'|'straight'|'smoothstep', compact }
└── previews.jsx       # mini-SVGs dos 9 thumbnails (autorais, ~6 linhas cada)
```

- **Contrato:** `computeLayout` é **função pura** — recebe o grafo, devolve `{nodeId → {x, y}}`. Nada de efeitos: testável 100% em Vitest sem canvas.
- **Tamanhos reais:** `node.measured.width/height` (fornecido pelo @xyflow/react v12) com fallback `220×70`.
- **Aplicação:** única action no store (ver §7) — `applyLayoutPositions(positions, edgeType, compact)`.

## 4. Layout balanceado (Left-Right / Up-Down) — pseudo-código (Q2)

Nenhum motor faz "raiz no centro, subárvores nos dois lados" nativamente. Composição sobre o dagre:

```js
function layoutBalanced(nodes, edges, { axis = 'x' /* x = LR, y = UD */ }) {
  const roots = nodes.filter(n => semArestaEntrante(n));           // ~isRoot, mas derivado
  const root = roots[0];                                            // v1: 1 raiz
  const filhos = filhosDe(root);                                    // arestas root -> X

  // 1) peso de subárvore = tamanho do fecho descendente (DFS nas arestas de saída,
  //    com Set de visitados — cross-links contam uma única vez, no primeiro alcance)
  const peso = new Map(filhos.map(f => [f.id, subtreeWeight(f)]));

  // 2) partição gulosa: filhos por peso desc, alternando para o lado mais leve
  const L = [], R = [];
  for (const f of [...filhos].sort((a, b) => peso.get(b.id) - peso.get(a.id))) {
    (pesoL <= pesoR ? (L.push(f), pesoL += peso.get(f.id))
                    : (R.push(f), pesoR += peso.get(f.id)));
  }

  // 3) dois dagres INDEPENDENTES, ambos rankdir=LR (evita quirks do RL);
  //    cross-links ENTRE lados ficam FORA dos grafos (ver política abaixo)
  const gR = dagreGraph(L, arestasInternas(L), { rankdir: 'LR' });
  const gL = dagreGraph(R, arestasInternas(R), { rankdir: 'LR' });
  dagre.layout(gR); dagre.layout(gL);

  // 4) espelhar o lado esquerdo: x' = -x - width  (mesma métrica de espaçamento,
  //    cresce para fora do centro) — e o mesmo para y no modo Up-Down
  const pos = new Map();
  pos.set(root.id, { x: 0, y: 0 });
  for (const n of gR.nodes()) pos.set(n, { x: gR.node(n).x + root.width/2 + GAP, y: gR.node(n).y });
  for (const n of gL.nodes()) pos.set(n, { x: -(gL.node(n).x + root.width/2 + GAP), y: gL.node(n).y });

  // 5) normalizar para positivo (min x/y -> padding) e devolver
  return normalizar(pos);
}
```

**Política de cross-links (decisão explícita):**
- **Mesmo lado:** entram no grafo dagre do lado — o layering respeita como restrição. ✓
- **Lado oposto (atravessam o centro):** **ignorados pelo motor na v1** — a aresta é desenhada por cima do canvas (smoothstep/straight), mas não constrange posições. Simplificação consciente: incluir exigiria constraints entre os dois grafos (duplicação de nós dummy). Documentado como limitação; revisitar só se visualmente incômodo.

**Up-Down:** mesma função com `axis = 'y'` (espelho vertical). **Up / Down / Left / Right "puros":** um único dagre com o rankdir correspondente, sem partição — é o caso degenerado do mesmo código.

## 5. Quando aplicar (Q3)

Palpite confirmado: **sob demanda + toggle opcional, nunca durante drag.**

- **Botão "Auto-organizar"** (ou escolha de esquema no popover): aplica uma vez, com transição animada (CSS `transition` na `transform` dos nós por ~300ms — o @xyflow posiciona via transform, então é de graça).
- **Toggle "Auto"**: após mudanças **estruturais** (adicionar/remover/conectar nó) com debounce de 800ms — **nunca** em mudança de posição (drag). Detecção: assinatura `ids de nós + ids de arestas` (mudou estrutura → relayout; mudou só posição → não).
- Interação com o autosave (v0.3): o relayout marca dirty **uma vez** → um único PUT com as posições novas. Sem conflito com o debounce de 1s (o 800ms do layout e o 1s do save correm independentes; o save pega o estado final).

## 6. Convivência com o Free-form (Q4)

- **Persistência:** `document.meta.layout = 'lr' | 'lr-balanced' | 'tb-balanced' | 'free-form' | …` no blob — o documento é a fonte da verdade (padrão da v0.3); `meta` é novo e opcional (mapas antigos = free-form).
- **Voltar para Free-form = "congelar as posições atuais"**, não restaurar as antigas. Motivo: snapshot de posições por troca de schema é complexidade + inchaço do documento para cobrir um acidente que o **Undo cobre melhor** (toast "Layout aplicado — Desfazer" por 5s, mesmo padrão da exclusão de mapa).
- Consequência: o épico **depende do ponto de integração do undo** (§7), não do undo completo.

## 7. Undo (Q6) — decisão de design agora

Sim, muda (bem pouco) o design agora: **toda escrita de posição do motor passa por UMA action:**

```js
applyLayoutPositions(positionsById, meta /* {schema, edgeType, compact} */)
```

A action: (1) snapshot do `positionsById` antigo; (2) aplica; (3) registra `{antes, depois}` no futuro histórico. Quando o undo/redo (v0.2.5) chegar com Command pattern, o layout entra como **um único comando** de graça — desde que NENHUM outro código escreva posições em massa fora dessa action. Também garante: o autosave enxerga a aplicação do layout como um único lote.

## 8. UI (Q5) — wireframe textual

Canvas é o protagonista; o controle mora **num Panel do próprio canvas** (não no header — header é biblioteca/config):

```
┌────────────────────────────────────────────────────────────┐
│ MindWeave AI / Tese ▼          Salvo há 2s   Mapas ▼  ☾   │  ← header (intocado)
├────────────────────────────────────────────────────────────┤
│         [ ⚡ Auto-organizar ▾ ]                ← Panel top-center
│         ┌───────────────────────────────┐                  │
│         │ Direção   ↑  ↓  ↕  ←  →  ↔   │                  │
│         │ Esquema (3×3)                 │                  │
│         │ ┌──┐┌──┐┌──┐                  │                  │
│         │ │⌒⌒││╱╱││└┐│   ← mini-SVGs    │                  │
│         │ └──┘└──┘└──┘   autorais       │                  │
│         │ ┌──┐┌──┐┌──┐                  │                  │
│         │ │…││…││…│                   │                  │
│         │ Auto ▢   ↺ Free-form          │                  │
│         └───────────────────────────────┘                  │
│   [Nó Raiz]───[A]───[B]                                    │
│        └────[C]                                            │
└────────────────────────────────────────────────────────────┘
```

- Os 9 thumbnails são **mini-SVGs autorais** (5–6 nós em 40×28px demonstrando curva/reta/canto × árvore/lista) — não renderizamos o mapa real em miniatura.
- Esquema ativo fica com anel de destaque; `Free-form` reseta o toggle.

## 9. ROADMAP (Q7)

**Proposta:** criar o épico **v0.5 — Layout Engine** (entre a v0.4 IA avançada e a v1.0 Escala) e **mover o item** "Layout automático de árvores (dagre/elk)" de v1.0 para lá. Racional: a v0.4 entrega mais valor de produto (IA é o coração do app) e o layout é polimento de alto impacto — mas se o feedback de usuários pedir, v0.4 ⇄ v0.5 trocam de lugar sem custo (são independentes).

## 10. Blocos de execução (futuros — nada implementado neste branch)

- **B1 — Motor base:** dependência dagre, `engine.js` + `dagreAdapter.js` (TB/BT/LR/RL), botão "Auto-organizar", `applyLayoutPositions` no store, Vitest do engine puro.
- **B2 — Balanceado:** `balanced.js` (partição por peso + espelhamento) + direções Up-Down/Left-Right + política de cross-links + testes de_snapshot (posições determinísticas).
- **B3 — Os 9 esquemas + UI:** `schemas.js` (edgeType × densidade), variante compacta do CustomNode, popover com previews mini-SVG, `document.meta.layout` persistido, Free-form + toast Undo.
- **B4 — Fechamento:** toggle "Auto" pós-mudança estrutural, E2E (aplicar layout → reload → persistido; busca→layout→snapshot), CHANGELOG + tag v0.5.0.

## 11. Riscos abertos

- **Nós desconectados / múltiplas raízes:** v1 trata cada componente como layout independente empilhado; refinamos se feio.
- **Medição de nós não montados** (lazy): fallback de tamanho antes do `measured` — posições levemente off na primeira aplicação; re-layout barato corrige.
- **dagre e arestas reversas em ciclos:** nossos ciclos já são impossíveis (Bloco 1 v0.2), mas arestas "para trás" no layering viram ranks artificiais — aceitável visualmente.
