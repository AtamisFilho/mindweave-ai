import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
} from '@xyflow/react';
import {
  getAIConfig, updateAIConfig as apiUpdateAIConfig,
  performDeepResearch as apiPerformDeepResearch,
  suggestNewNodes as apiSuggestNewNodes,
  extractApiError,
  createMap as apiCreateMap,
  getMap as apiGetMap,
  getLastMap,
  saveMapApi,
  deleteMapApi,
} from '../services/api'; // Renomeado para evitar conflito
import { notifyAiError } from '../services/notify';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';

// --- Snapshot offline (localStorage) ---
// Se o autosave falhar por rede, o estado vai para cá; o replay acontece
// no bootstrap (backend de volta), no evento 'online' ou no botão Sincronizar.
const PENDING_KEY = 'mindweave:pending-map';
const readPending = () => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)); } catch { return null; }
};
const writePending = (payload) => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(payload)); } catch { /* storage cheio/indisponível */ }
};
const clearPending = () => {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
};

const freshRootNode = () => ({
  id: nanoid(6),
  type: 'custom',
  data: { label: 'Nó Raiz', parentId: null, isRoot: true, isNew: false },
  position: { x: 250, y: 5 },
});

// --- Hierarquia derivada das arestas (DAG) ---
// As arestas do React Flow são a fonte única de verdade da hierarquia;
// data.parentId é apenas cache de posicionamento (pai "principal" mais recente).
export const getAncestorContext = (nodes, edges, nodeId) => {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set([nodeId]);
  const queue = [];
  const context = [];

  // Pais diretos primeiro (BFS subindo pelas arestas de entrada)
  for (const edge of edges) {
    if (edge.target === nodeId && !visited.has(edge.source)) {
      queue.push(edge.source);
      visited.add(edge.source);
    }
  }
  while (queue.length > 0) {
    const currentId = queue.shift();
    const ancestorNode = nodeById.get(currentId);
    if (ancestorNode) {
      context.push({ id: ancestorNode.id, content: ancestorNode.data.label });
    }
    for (const edge of edges) {
      if (edge.target === currentId && !visited.has(edge.source)) {
        queue.push(edge.source);
        visited.add(edge.source);
      }
    }
  }
  return context.slice(0, 12); // teto de custo do contexto enviado à IA
};

// source→target fecharia um ciclo se target já é ancestral de source
const wouldCreateCycle = (edges, source, target) => {
  const visited = new Set([source]);
  const stack = [source];
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId === target) return true;
    for (const edge of edges) {
      if (edge.target === currentId && !visited.has(edge.source)) {
        visited.add(edge.source);
        stack.push(edge.source);
      }
    }
  }
  return false;
};


const useMindMapStore = create((set, get) => ({
  nodes: [freshRootNode()],
  edges: [],
  aiConfig: {
    selectedProvider: 'ollama',
    ollamaConfig: {
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    },
    isOpenAiKeySet: false,
    isGoogleKeySet: false,
  },
  aiLoading: false,
  aiError: null,
  aiErrorCode: null, // código estável do backend (ex: PROVIDER_TIMEOUT) — consumido pelos toasts
  researchResult: null,
  researchHistory: [],      // [{id, nodeId, summary, createdAt}] — mais recente primeiro
  researchPanelNodeId: null, // nó exibido no painel (NÃO segue a seleção do canvas)
  researchPanelPinned: false, // pin: novas pesquisas não trocam o contexto do painel
  configFocusKey: null,     // 'openai' | 'google' | null — foca o campo da chave faltante
  darkMode: (typeof window !== 'undefined')
    ? (localStorage.getItem('darkMode') === 'true' ||
       (!('darkMode' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches))
    : false,
  activePanel: 'nodes',

  // --- Persistência (v0.3) ---
  hydrating: false,          // carregando/sincronizando: autosave suspenso
  currentMapId: null,
  mapTitle: 'Mapa sem título',
  mapVersion: null,
  saveState: 'idle',         // idle | saving | saved | offline | conflict
  lastSavedAt: null,
  pendingLocal: false,       // existe snapshot no localStorage aguardando sync


  // --- React Flow specific actions ---
  onNodesChange: (changes) =>
    set((state) => {
      const nodes = applyNodeChanges(changes, state.nodes);
      const removedIds = changes.filter(c => c.type === 'remove').map(c => c.id);
      if (removedIds.length === 0) return { nodes };
      // Nós removidos: limpa arestas órfãs e o cache parentId dos filhos
      const removed = new Set(removedIds);
      const aliveIds = new Set(nodes.map(n => n.id));
      return {
        nodes: nodes.map(n =>
          n.data.parentId && !aliveIds.has(n.data.parentId)
            ? { ...n, data: { ...n.data, parentId: null } }
            : n
        ),
        edges: state.edges.filter(e => !removed.has(e.source) && !removed.has(e.target)),
      };
    }),
  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    })),
  // Conexão manual (drag entre handles): valida raiz/duplicata/ciclo e grava
  // aresta + cache de posicionamento atomicamente. Cross-links são permitidos (DAG).
  connectNodes: (params) => {
    const { source, target } = params;
    if (!source || !target || source === target) return false;
    const state = get();
    const targetNode = state.nodes.find(n => n.id === target);
    if (!targetNode || targetNode.data.isRoot) return false; // raiz não vira filha
    if (state.edges.some(e => e.source === source && e.target === target)) return false;
    if (wouldCreateCycle(state.edges, source, target)) return false;
    set((s) => ({
      edges: rfAddEdge({ ...params, type: 'smoothstep', animated: true, style: { strokeWidth: 2 } }, s.edges),
      nodes: s.nodes.map(n => (n.id === target ? { ...n, data: { ...n.data, parentId: source } } : n)),
    }));
    return true;
  },

  // --- Node manipulation actions ---
  addNode: (parentNodeId = null, position, initialData = {}) => {
    const newNodeId = nanoid(6);
    let newNodePosition;

    if (parentNodeId) {
        const parentNode = get().nodes.find(n => n.id === parentNodeId);
        if (parentNode) {
            const childrenCount = get().nodes.filter(n => n.data.parentId === parentNodeId).length;
            // Filhos nascem À DIREITA do pai (largura máx. do nó = 280px): o mapa
            // cresce horizontalmente e o painel de ações do pai selecionado nunca
            // cobre o filho (bug de sobreposição que o E2E do Bloco 4 revelou).
            newNodePosition = {
                x: parentNode.position.x + 300,
                y: parentNode.position.y + childrenCount * 130,
            };
        } else { // Fallback if parent not found (should not happen ideally)
            newNodePosition = position || { x: Math.random() * 300, y: Math.random() * 300 };
        }
    } else {
      newNodePosition = position || { x: Math.random() * 300, y: Math.random() * 300 };
    }

    const defaultLabel = `Novo Nó`;
    const newNode = {
      id: newNodeId,
      type: 'custom', 
      data: { 
        label: initialData.label || defaultLabel, 
        parentId: parentNodeId, 
        isRoot: !parentNodeId,
        isNew: true, // Mark as new for potential auto-edit
        ...initialData 
      },
      position: newNodePosition,
    };

    // Nó e aresta precisam ser criados no MESMO set(): no React Flow v12,
    // uma aresta cujo nó alvo ainda não existe é descartada na sincronização.
    set((state) => {
      const newEdges = parentNodeId
        ? rfAddEdge(
            { source: parentNodeId, target: newNodeId, id: `e-${parentNodeId}-${newNodeId}`, type: 'smoothstep', animated: true, style: { strokeWidth: 2 } },
            state.edges
          )
        : state.edges;
      return { nodes: [...state.nodes, newNode], edges: newEdges };
    });

    return newNodeId; // Return the new node's ID
  },

  updateNodeLabel: (nodeId, label) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, label, isNew: false } } // Clear isNew after first edit
          : node
      ),
    })),
  
  // --- AI Configuration actions ---
  fetchAIConfig: async () => {
    set({ aiLoading: true, aiError: null, aiErrorCode: null });
    try {
      const config = await getAIConfig(); // From api.js
      set({ aiConfig: config, aiLoading: false });
    } catch (error) {
      const { code, message } = extractApiError(error);
      set({ aiError: message, aiErrorCode: code, aiLoading: false });
    }
  },

  updateAIConfig: async (newConfig) => {
    set({ aiLoading: true, aiError: null, aiErrorCode: null });
    try {
      const updatedConfig = await apiUpdateAIConfig(newConfig); // From api.js
      set({ aiConfig: updatedConfig, aiLoading: false });
    } catch (error) {
      const { code, message } = extractApiError(error);
      set({ aiError: message, aiErrorCode: code, aiLoading: false });
      throw error;
    }
  },
  
  // --- AI Feature actions ---
  performDeepResearch: async (nodeId) => {
    set({ aiLoading: true, aiError: null, aiErrorCode: null, researchResult: null });
    const node = get().nodes.find(n => n.id === nodeId);
    if (!node) {
      set({ aiError: 'Nó não encontrado.', aiErrorCode: 'NODE_NOT_FOUND', aiLoading: false });
      return;
    }

    const researchData = {
      nodeId: node.id,
      nodeContent: node.data.label,
      ancestorContext: getAncestorContext(get().nodes, get().edges, nodeId),
      provider: get().aiConfig.selectedProvider,
      model_name: get().aiConfig.selectedProvider === 'ollama' ? get().aiConfig.ollamaConfig.model : undefined,
    };

    try {
      const result = await apiPerformDeepResearch(researchData); // from api.js
      const entry = {
        id: `${Date.now()}-${result.nodeId}`,
        nodeId: result.nodeId,
        summary: result.researchSummary,
        createdAt: Date.now(),
      };
      set((s) => ({
        researchResult: { nodeId: result.nodeId, summary: result.researchSummary },
        researchHistory: [entry, ...s.researchHistory],
        // Painel segue o "último nó pesquisado", exceto quando fixado (pin)
        researchPanelNodeId: s.researchPanelPinned ? s.researchPanelNodeId : result.nodeId,
        activePanel: 'research',
        aiLoading: false,
      }));
      toast.success('Pesquisa concluída', {
        description: 'O resultado está no painel de Pesquisas.',
      });
    } catch (error) {
      const { code, message, provider } = extractApiError(error);
      set({ aiError: message, aiErrorCode: code, aiLoading: false });
      notifyAiError(
        { code, message, provider },
        { onOpenConfig: () => get().openConfigForKey(provider) },
      );
    }
  },

  suggestNewNodes: async (nodeId) => {
    set({ aiLoading: true, aiError: null, aiErrorCode: null });
    const parentNode = get().nodes.find(n => n.id === nodeId);
    if (!parentNode) {
      set({ aiError: 'Nó pai não encontrado para sugestões.', aiErrorCode: 'NODE_NOT_FOUND', aiLoading: false });
      return;
    }

    const suggestionData = {
      nodeId: parentNode.id,
      nodeContent: parentNode.data.label,
      ancestorContext: getAncestorContext(get().nodes, get().edges, nodeId),
      provider: get().aiConfig.selectedProvider,
      model_name: get().aiConfig.selectedProvider === 'ollama' ? get().aiConfig.ollamaConfig.model : undefined,
    };

    try {
      const result = await apiSuggestNewNodes(suggestionData); // from api.js
      if (result.suggestedNodes && result.suggestedNodes.length > 0) {
        result.suggestedNodes.forEach((suggestion) => {
          // Use addNode to create and position the new suggested nodes
          get().addNode(nodeId, undefined, { label: suggestion.content });
        });
        toast.success(`${result.suggestedNodes.length} nós sugeridos`, {
          description: 'Adicionados como filhos do nó selecionado.',
        });
      } else {
        toast.info('A IA não retornou sugestões desta vez.');
      }
      set({ aiLoading: false });
    } catch (error) {
      const { code, message, provider } = extractApiError(error);
      set({ aiError: message, aiErrorCode: code, aiLoading: false });
      notifyAiError(
        { code, message, provider },
        { onOpenConfig: () => get().openConfigForKey(provider) },
      );
    }
  },

  // --- Persistência (v0.3) ---
  _applyServerMap: (map) =>
    set({
      nodes: map.document.nodes,
      edges: map.document.edges,
      mapTitle: map.title,
      currentMapId: map.id,
      mapVersion: map.version,
      lastSavedAt: Date.now(),
      saveState: 'saved',
      researchHistory: [],
      researchPanelNodeId: null,
    }),

  // Fricção Zero: carrega o último mapa; 404 -> cria "Mapa sem título" sem UI;
  // backend fora -> canvas default + snapshot offline.
  bootstrapMap: async () => {
    if (get().hydrating || get().currentMapId) return;
    set({ hydrating: true });
    try {
      await get().replayPending(); // sincroniza pendência offline, se houver e backend no ar
    } catch {
      set({ hydrating: false, saveState: 'offline', pendingLocal: true });
      return;
    }
    try {
      const last = await getLastMap();
      get()._applyServerMap(last);
    } catch (error) {
      if (error?.response?.status === 404) {
        await get().createNewMap(); // primeiro acesso
      } else {
        writePending({
          mapId: null,
          title: get().mapTitle,
          document: { nodes: get().nodes, edges: get().edges },
          expected_version: null,
        });
        set({ saveState: 'offline', pendingLocal: true });
      }
    } finally {
      set({ hydrating: false });
    }
  },

  loadMap: async (id) => {
    set({ hydrating: true });
    try {
      const map = await apiGetMap(id);
      get()._applyServerMap(map);
      toast.success(`Mapa "${map.title}" carregado`);
    } catch (error) {
      const { message } = extractApiError(error);
      toast.error('Falha ao carregar o mapa', { description: message });
    } finally {
      set({ hydrating: false });
    }
  },

  createNewMap: async () => {
    set({ hydrating: true });
    const document = { nodes: [freshRootNode()], edges: [] };
    try {
      const created = await apiCreateMap({ title: 'Mapa sem título', document });
      get()._applyServerMap(created);
      set({ researchHistory: [], researchPanelNodeId: null });
    } catch {
      // Offline: canvas novo local; o POST vira pendência (mapId nulo -> cria no replay)
      set({
        nodes: document.nodes,
        edges: [],
        mapTitle: 'Mapa sem título',
        currentMapId: null,
        mapVersion: null,
        saveState: 'offline',
        researchHistory: [],
        researchPanelNodeId: null,
      });
      writePending({ mapId: null, title: 'Mapa sem título', document, expected_version: null });
      set({ pendingLocal: true });
      toast.info('Sem conexão — novo mapa será criado ao sincronizar');
    } finally {
      set({ hydrating: false });
    }
  },

  renameMap: (title) => set({ mapTitle: title }), // autosave captura via subscribe

  saveNow: async ({ manual = false } = {}) => {
    clearTimeout(autosaveTimer);
    const s = get();
    if (s.hydrating) return;
    const document = { nodes: s.nodes, edges: s.edges };
    set({ saveState: 'saving' });
    try {
      if (!s.currentMapId) {
        const created = await apiCreateMap({ title: s.mapTitle, document });
        set({
          currentMapId: created.id,
          mapVersion: created.version,
          lastSavedAt: Date.now(),
          saveState: 'saved',
          pendingLocal: false,
        });
        clearPending();
      } else {
        const saved = await saveMapApi(s.currentMapId, {
          title: s.mapTitle,
          document,
          expected_version: s.mapVersion,
        });
        set({
          mapVersion: saved.version,
          lastSavedAt: Date.now(),
          saveState: 'saved',
          pendingLocal: false,
        });
        clearPending();
      }
      if (manual) toast.success('Mapa salvo');
    } catch (error) {
      if (error?.response?.status === 409) {
        // Outra aba salvou: nunca sobrescreve calado — oferece recarregar
        set({ saveState: 'conflict' });
        toast.error('Mapa alterado em outra aba', {
          description: 'Recarregar substitui suas alterações locais pela versão do servidor.',
          duration: 15000,
          action: {
            label: 'Recarregar',
            onClick: () => get().loadMap(get().currentMapId),
          },
        });
      } else {
        writePending({
          mapId: s.currentMapId,
          title: s.mapTitle,
          document,
          expected_version: s.mapVersion,
        });
        set({ saveState: 'offline', pendingLocal: true });
        if (manual) toast.error('Sem conexão — alterações salvas localmente');
      }
    }
  },

  retrySync: () => get().saveNow({ manual: false }),

  replayPending: async () => {
    const pending = readPending();
    if (!pending) return;
    try {
      if (pending.mapId) {
        const saved = await saveMapApi(pending.mapId, {
          title: pending.title,
          document: pending.document,
          expected_version: pending.expected_version,
        });
        set({ currentMapId: saved.id, mapVersion: saved.version });
      } else {
        const created = await apiCreateMap({ title: pending.title, document: pending.document });
        set({ currentMapId: created.id, mapVersion: created.version });
      }
      clearPending();
      set({ pendingLocal: false, saveState: 'saved', lastSavedAt: Date.now() });
      toast.success('Alterações offline sincronizadas');
    } catch (error) {
      if (error?.response?.status === 409) {
        // O mapa mudou no servidor enquanto estávamos offline: NÃO sobrescreve.
        set({ saveState: 'conflict', pendingLocal: true });
        toast.error('Conflito ao sincronizar', {
          description: 'O mapa mudou no servidor enquanto estávamos offline.',
          duration: 20000,
          action: {
            label: 'Manter do servidor',
            onClick: () => {
              clearPending();
              set({ pendingLocal: false, saveState: 'saved' });
              get().loadMap(get().currentMapId);
            },
          },
        });
        return; // bootstrap segue carregando a versão do servidor (segura)
      }
      throw error; // rede/5xx: quem chamou entra em modo offline
    }
  },

  deleteMapWithUndo: async (id, title) => {
    const s = get();
    // Snapshot para o Undo: do store (se for o atual) ou do servidor
    let document;
    if (id === s.currentMapId) {
      document = { nodes: s.nodes, edges: s.edges };
    } else {
      try {
        document = (await apiGetMap(id)).document;
      } catch {
        toast.error('Não foi possível obter o mapa para excluir.');
        return;
      }
    }
    try {
      await deleteMapApi(id);
    } catch (error) {
      const { message } = extractApiError(error);
      toast.error('Não foi possível excluir agora', { description: message });
      return;
    }
    if (id === s.currentMapId) {
      // some do canvas: carrega outro ou cria novo (createNewMap lida com offline)
      const remaining = await getLastMap().catch(() => null);
      if (remaining) await get().loadMap(remaining.id);
      else await get().createNewMap();
    }
    toast.success(`"${title}" excluído`, {
      duration: 5000,
      action: {
        label: 'Desfazer',
        onClick: async () => {
          try {
            const restored = await apiCreateMap({ title, document });
            toast.success(`"${title}" restaurado`, {
              description: 'Abra pelo menu "Mapas".',
            });
            return restored;
          } catch {
            toast.error('Não foi possível restaurar (sem conexão?).');
          }
        },
      },
    });
  },

  // --- Layout automático (v0.5) ---
  // ÚNICO caminho para escritas de posição em massa (Diretriz d do Tech Lead):
  // snapshot antes + aplicação atômica -> o futuro undo/redo (v0.2.5) captura
  // a aplicação do layout como UM comando, e o autosave enxerga um único lote.
  applyLayoutPositions: (positionsById) => {
    const previous = Object.fromEntries(
      get().nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    );
    set((state) => ({
      nodes: state.nodes.map((n) =>
        positionsById[n.id]
          ? { ...n, position: { x: positionsById[n.id].x, y: positionsById[n.id].y } }
          : n,
      ),
    }));
    return previous; // snapshot para restorePositions (Undo escopado)
  },

  restorePositions: (previousPositionsById) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        previousPositionsById[n.id]
          ? { ...n, position: { ...previousPositionsById[n.id] } }
          : n,
      ),
    }));
  },

  // --- UI State ---
  setActivePanel: (panelName) => set({ activePanel: panelName }),
  clearResearchError: () => set({ aiError: null, aiErrorCode: null }),
  clearResearchResult: () => set({ researchResult: null }),

  toggleDarkMode: () =>
    set((s) => {
      const darkMode = !s.darkMode;
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', darkMode);
        localStorage.setItem('darkMode', String(darkMode));
      }
      return { darkMode };
    }),

  // Painel de pesquisas: segue o "último nó pesquisado", com pin opcional
  toggleResearchPanelPin: () =>
    set((s) => ({ researchPanelPinned: !s.researchPanelPinned })),
  setResearchPanelNode: (nodeId) =>
    set({ researchPanelNodeId: nodeId, activePanel: 'research' }),

  // Toast "Abrir Configurações": abre a aba de config e aponta o campo da chave
  openConfigForKey: (provider) => {
    const target = String(provider || '').toLowerCase() === 'google'
      ? 'google'
      : String(provider || '').toLowerCase() === 'openai'
        ? 'openai'
        : null;
    set({ activePanel: 'config', configFocusKey: target });
  },
  clearConfigFocusKey: () => set({ configFocusKey: null }),

}));

// --- Autosave: qualquer mutação de nós/arestas/título agenda o save ---
// Guarda: durante a hidratação (bootstrap/load/create) o autosave fica suspenso.
let autosaveTimer = null;

useMindMapStore.subscribe((state, prev) => {
  if (state.hydrating) return;
  if (
    state.nodes !== prev.nodes ||
    state.edges !== prev.edges ||
    state.mapTitle !== prev.mapTitle
  ) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      useMindMapStore.getState().saveNow();
    }, 1000);
  }
});

export default useMindMapStore;
