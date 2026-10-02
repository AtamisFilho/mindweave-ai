import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
} from '@xyflow/react';
import {
  getAIConfig, updateAIConfig as apiUpdateAIConfig,
  suggestNewNodes as apiSuggestNewNodes,
  suggestNodesBatch as apiSuggestNodesBatch,
  extractApiError,
  createMap as apiCreateMap,
  getMap as apiGetMap,
  getLastMap,
  saveMapApi,
  deleteMapApi,
  getChain,
  streamDeepResearch,
  streamChat,
  generateMapApi,
} from '../services/api'; // Renomeado para evitar conflito
import { notifyAiError } from '../services/notify';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import { computeLayout } from '../layout/engine';

const CHAT_HISTORY_LIMIT = 40; // teto de mensagens persistidas em meta.chat

// Pergunta fixa do "Resumir mapa" (v0.4.5 B4): reusa o /ai/chat/stream —
// nenhuma superfície nova de UI ou endpoint; a resposta nasce na aba Chat.
const SUMMARY_QUESTION =
  'Faça um resumo executivo deste mapa mental, destacando os temas principais e suas relações hierárquicas.';

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
  chainConfig: [],          // cadeia de provedores (v0.4 B3)
  lastProviderUsed: null,   // quem respondeu a última pesquisa (badge do header)
  fallbackActiveUntil: 0,   // timestamp até quando mostrar "(fallback)" no badge
  streamState: null,        // linha de status viva do streaming (v0.4.5)
  chat: [],                 // [{role, content, context_meta?}] — persistido em meta.chat
  chatState: null,          // fase viva do chat (trying/committed/streaming)
  lastSelectedNodeId: null, // último nó que o usuário selecionou (v0.4.5 B4)
  selectedCount: 0,         // nº de nós selecionados (botão de expansão em lote)
  generatingMap: false,     // geração de mapa a partir de tópico (v0.4.5 B3)
  generateError: null,
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

  // --- Layout (v0.5) ---
  layoutMeta: { schema: 'balanced-lr', edgeType: null, compact: false },
  autoLayout: false,         // relayout pós-mudança estrutural (B4)


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
  // O tipo da aresta segue o preset visual ativo (curved/direct/cornered).
  connectNodes: (params) => {
    const { source, target } = params;
    if (!source || !target || source === target) return false;
    const state = get();
    const targetNode = state.nodes.find(n => n.id === target);
    if (!targetNode || targetNode.data.isRoot) return false; // raiz não vira filha
    if (state.edges.some(e => e.source === source && e.target === target)) return false;
    if (wouldCreateCycle(state.edges, source, target)) return false;
    const edgeType = state.layoutMeta?.edgeType ?? undefined;
    set((s) => ({
      edges: rfAddEdge({ ...params, type: edgeType, animated: true, style: { strokeWidth: 2 } }, s.edges),
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

  fetchChainConfig: async () => {
    try {
      const chain = await getChain();
      set({ chainConfig: chain });
    } catch { /* backend offline: mantém a cadeia atual */ }
  },

  setChainConfig: (chain) => set({ chainConfig: chain }),

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
    // UMA pesquisa viva por vez (o último pedido vence): aborta a anterior —
    // duas correntes compartilham streamState e o resumo da primeira sai
    // vazio (tokens dela descartados quando a segunda completa).
    researchAbort?.abort();
    const abort = new AbortController();
    researchAbort = abort;

    set({
      aiLoading: true, aiError: null, aiErrorCode: null, researchResult: null,
      // linha de status viva da cadeia (v0.4.5) — o painel abre JUNTO:
      // sem isso o usuário não vê trying/committed/trail de lugar nenhum
      activePanel: 'research',
      streamState: { phase: 'trying', providerLabel: null, trail: [], text: '' },
    });
    const node = get().nodes.find(n => n.id === nodeId);
    if (!node) {
      set({ aiError: 'Nó não encontrado.', aiErrorCode: 'NODE_NOT_FOUND', aiLoading: false, streamState: null });
      return;
    }

    const researchData = {
      nodeId: node.id,
      nodeContent: node.data.label,
      ancestorContext: getAncestorContext(get().nodes, get().edges, nodeId),
      // v0.4 B3: a ORDEM DA CADEIA decide (sem preferred, sem provider fixo)
      model_name: get().aiConfig.ollamaConfig?.model || undefined,
    };

    // Buffer de renderização: deltas chegam centenas/s — flush a cada 50ms
    let pendingText = '';
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      if (researchAbort !== abort) return; // suplantada: não escreve no estado alheio
      set((s) => (s.streamState ? { streamState: { ...s.streamState, text: s.streamState.text + pendingText } } : {}));
      pendingText = '';
    };

    try {
      let donePayload = null;
      await streamDeepResearch(researchData, {
        signal: abort.signal,
        onEvent: (ev) => {
          if (ev.event === 'chain') {
            set((s) => {
              if (!s.streamState) return {};
              if (ev.status === 'failed' || ev.status === 'skipped') {
                return { streamState: { ...s.streamState, trail: [...s.streamState.trail, {
                  provider: ev.provider_label ?? ev.provider,
                  kind: ev.kind, message: ev.message, skipped: ev.status === 'skipped',
                }] } };
              }
              return { streamState: { ...s.streamState,
                phase: ev.status === 'committed' ? 'committed' : 'trying',
                providerLabel: ev.provider_label ?? ev.provider } };
            });
          } else if (ev.event === 'token') {
            pendingText += ev.delta;
            if (!flushTimer) flushTimer = setTimeout(flush, 50);
          } else if (ev.event === 'done') {
            donePayload = { provider_used: ev.provider_used, fallback_trail: ev.fallback_trail ?? [] };
          } else if (ev.event === 'error') {
            throw { response: { status: 503, data: { detail: {
              error_code: ev.error_code, message: ev.message,
              provider: 'chain', fallback_trail: ev.fallback_trail ?? [],
            } } } };
          }
        },
      });
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (researchAbort !== abort) return; // suplantada: a mais nova escreve
      flush(); // done pode chegar antes do timer de 50ms — descarrega o texto pendente

      const summary = get().streamState?.text ?? '';
      const entry = {
        id: `${Date.now()}-${researchData.nodeId}`,
        nodeId: researchData.nodeId,
        summary,
        createdAt: Date.now(),
      };
      set((s) => ({
        researchResult: { nodeId: researchData.nodeId, summary },
        researchHistory: [entry, ...s.researchHistory],
        researchPanelNodeId: s.researchPanelPinned ? s.researchPanelNodeId : researchData.nodeId,
        activePanel: 'research',
        aiLoading: false,
        lastProviderUsed: donePayload.provider_used ?? null,
        fallbackActiveUntil: (donePayload.fallback_trail?.length ?? 0) > 0 ? Date.now() + 12000 : 0,
        streamState: null,
      }));
      toast.success('Pesquisa concluída', {
        description: `Respondido por ${donePayload.provider_used ?? 'IA'}.`,
      });
    } catch (error) {
      if (flushTimer) clearTimeout(flushTimer);
      if (abort.signal.aborted) {
        // suplantada por uma pesquisa mais nova: NÃO toca no estado —
        // streamState/aiLoading agora são da corrente
        return;
      }
      const { code, message, provider, trail } = extractApiError(error);
      set({ aiError: message, aiErrorCode: code, aiLoading: false, streamState: null });
      if (code === 'PROVIDER_STREAM_INTERRUPTED') {
        // commit point já passado: sem fallback — o cliente decide o retry
        toast.error('Conexão interrompida', {
          description: message,
          duration: 12000,
          action: { label: 'Tentar novamente', onClick: () => get().performDeepResearch(nodeId) },
        });
        return;
      }
      notifyAiError(
        { code, message, provider, trail },
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
      // v0.4 B3: a ORDEM DA CADEIA decide (sem preferred, sem provider fixo)
      model_name: get().aiConfig.ollamaConfig?.model || undefined,
    };

    try {
      const result = await apiSuggestNewNodes(suggestionData); // from api.js
      if (result.suggestedNodes && result.suggestedNodes.length > 0) {
        result.suggestedNodes.forEach((suggestion) => {
          // Use addNode to create and position the new suggested nodes
          get().addNode(nodeId, undefined, { label: suggestion.content });
        });
        toast.success(`${result.suggestedNodes.length} nós sugeridos`, {
          description: `Adicionados como filhos (via ${result.provider_used ?? 'IA'}).`,
        });
      } else {
        toast.info('A IA não retornou sugestões desta vez.');
      }
      set({ aiLoading: false, lastProviderUsed: result.provider_used ?? null });
    } catch (error) {
      const { code, message, provider } = extractApiError(error);
      set({ aiError: message, aiErrorCode: code, aiLoading: false });
      notifyAiError(
        { code, message, provider, trail: extractApiError(error).trail },
        { onOpenConfig: () => get().openConfigForKey(provider) },
      );
    }
  },

  // Expansão em lote (v0.4.5 B4): N nós selecionados -> filhos sugeridos.
  // O backend resolve rótulos/ancestrais do documento persistido; a inserção
  // usa o MESMO addNode atômico do fluxo individual (nó + aresta no mesmo set).
  // Limitação consciente: REST sem streaming (o batch em stream é evolução).
  suggestNodesBatch: async (nodeIds) => {
    const ids = [...new Set(nodeIds ?? [])].slice(0, 5);
    if (ids.length === 0 || get().aiLoading) return;
    const mapId = get().currentMapId;
    if (!mapId) {
      toast.error('Sincronize o mapa antes de expandir em lote.');
      return;
    }
    set({ aiLoading: true, aiError: null, aiErrorCode: null });
    try {
      const result = await apiSuggestNodesBatch({ map_id: mapId, node_ids: ids });
      let added = 0;
      const failures = [];
      for (const r of result.results ?? []) {
        if (r.error_code) { failures.push(r); continue; }
        for (const suggestion of r.suggestedNodes ?? []) {
          get().addNode(r.node_id, undefined, { label: suggestion.content });
          added += 1;
        }
        if (r.provider_used) set({ lastProviderUsed: r.provider_used });
      }
      set({ aiLoading: false });
      if (added > 0) {
        toast.success(`${added} nós sugeridos adicionados`, {
          description: failures.length
            ? `${failures.length} nó${failures.length > 1 ? 's' : ''} não puderam ser expandidos (${failures[0].message ?? failures[0].error_code}).`
            : 'Inseridos como filhos dos nós selecionados.',
        });
      } else if (failures.length > 0) {
        toast.error('Nenhum nó foi expandido', {
          description: failures[0].message ?? failures[0].error_code ?? 'A cadeia de IA falhou.',
        });
      } else {
        toast.info('A IA não retornou sugestões desta vez.');
      }
    } catch (error) {
      const { code, message, provider, trail } = extractApiError(error);
      set({ aiError: message, aiErrorCode: code, aiLoading: false });
      notifyAiError(
        { code, message, provider, trail },
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
      layoutMeta: map.document.meta?.layout ?? { schema: 'balanced-lr', edgeType: null, compact: false },
      chat: map.document.meta?.chat ?? [],
      researchHistory: [],
      researchPanelNodeId: null,
    }),

  _documentFromState: () => {
    const s = get();
    return {
      nodes: s.nodes,
      edges: s.edges,
      meta: {
        layout: s.layoutMeta,
        // teto do histórico: as 40 últimas trocas (~32KB) persistem
        chat: s.chat.slice(-CHAT_HISTORY_LIMIT),
      },
    };
  },

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
        writePending(get()._documentFromState());
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
    const document = { nodes: [freshRootNode()], edges: [], meta: { layout: { schema: 'balanced-lr', edgeType: null, compact: false } } };
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
    const document = s._documentFromState();
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
          document: s._documentFromState(),
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

  // Preset visual (v0.5 B3): estilo de aresta + densidade — afeta TODO o mapa
  // e as arestas criadas daqui em diante. Posições só mudam no ⚡ Auto-organizar.
  setVisualPreset: ({ edgeType, compact }) =>
    set((s) => ({
      layoutMeta: { ...s.layoutMeta, edgeType: edgeType ?? null, compact: !!compact },
      edges: s.edges.map((e) => ({ ...e, type: edgeType ?? undefined })),
    })),

  setLayoutSchema: (schema) =>
    set((s) => ({ layoutMeta: { ...s.layoutMeta, schema } })),

  setAutoLayout: (autoLayout) => set({ autoLayout: !!autoLayout }),

  // B4: relayout silencioso pós-mudança estrutural (chamado pelo subscribe)
  relayoutAuto: () => {
    const s = get();
    if (!s.autoLayout || s.hydrating || s.nodes.length === 0) return;
    const positions = computeLayout(s.nodes, s.edges, { schema: s.layoutMeta.schema });
    s.applyLayoutPositions(positions);
  },

  // --- Chat com o mapa (v0.4.5 B2) ---
  askMap: async (question, focusNodeId = null) => {
    const trimmed = question.trim();
    if (!trimmed || get().chatState) return false;
    const mapId = get().currentMapId;
    set((s) => ({
      chat: [...s.chat, { role: 'user', content: trimmed }],
      chatState: { phase: 'trying', providerLabel: null, text: '' },
    }));
    let pendingText = '';
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      set((s) => (s.chatState ? { chatState: { ...s.chatState, text: s.chatState.text + pendingText } } : {}));
      pendingText = '';
    };

    try {
      let donePayload = null;
      await streamChat({
        map_id: mapId,
        question: trimmed,
        history: get().chat.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        focus_node_id: focusNodeId,
      }, {
        onEvent: (ev) => {
          if (ev.event === 'chain') {
            set((s) => (s.chatState ? { chatState: { ...s.chatState,
              phase: ev.status === 'committed' ? 'committed' : 'trying',
              providerLabel: ev.provider_label ?? ev.provider } } : {}));
          } else if (ev.event === 'token') {
            pendingText += ev.delta;
            if (!flushTimer) flushTimer = setTimeout(flush, 50);
          } else if (ev.event === 'done') {
            donePayload = ev;
          } else if (ev.event === 'error') {
            throw { response: { status: 503, data: { detail: {
              error_code: ev.error_code, message: ev.message,
              provider: 'chain', fallback_trail: ev.fallback_trail ?? [],
            } } } };
          }
        },
      });
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flush();

      const meta = donePayload?.context_meta ?? null;
      set((s) => ({
        chat: [...s.chat, {
          role: 'assistant',
          content: s.chatState?.text ?? '',
          context_meta: meta,
        }],
        chatState: null,
        lastProviderUsed: donePayload?.provider_used ?? null,
      }));
      return true;
    } catch (error) {
      if (flushTimer) clearTimeout(flushTimer);
      const { code, message, provider, trail } = extractApiError(error);
      set({ chatState: null });
      notifyAiError(
        { code, message, provider, trail },
        { onOpenConfig: () => get().openConfigForKey(provider) },
      );
      // remove a pergunta órfã (não houve resposta): o usuário reformula
      set((s) => ({ chat: s.chat.filter((m, i, arr) => !(i === arr.length - 1 && m.role === 'user')) }));
      return false;
    }
  },

  // Resumir mapa (v0.4.5 B4): pergunta fixa no chat — sem endpoint nem UI nova.
  // Abre a aba Chat ANTES de perguntar: o usuário vê o resumo nascer em stream.
  summarizeMap: async () => {
    if (get().chatState) return;
    set({ activePanel: 'chat' });
    const ok = await get().askMap(SUMMARY_QUESTION);
    if (ok) toast.success('Resumo gerado na aba Chat');
  },

  clearChat: () => set({ chat: [], chatState: null }),

  hydrateChat: (chatHistory) => set({ chat: Array.isArray(chatHistory) ? chatHistory : [] }),

  // --- Geração de mapa (v0.4.5 B3) — NÃO-DESTRUTIVA: cria mapa NOVO ---
  // O mapa atual nunca é sobrescrito; o toast oferece "Voltar ao anterior".
  generateMap: async (topic, depth = 3, breadth = 5) => {
    const clean = topic.trim();
    if (!clean || get().generatingMap) return;
    const previousMapId = get().currentMapId;
    set({ generatingMap: true, generateError: null });

    try {
      const result = await generateMapApi({ topic: clean, depth, breadth });
      const { treeToGraph } = await import('../utils/treeToGraph');
      const graph = treeToGraph(result.tree);

      // persiste o mapa novo (Fricção Zero: já nasce salvo)
      const created = await apiCreateMap({
        title: clean.slice(0, 80),
        document: {
          nodes: graph.nodes, edges: graph.edges,
          meta: { layout: { schema: 'balanced-lr', edgeType: null, compact: false } },
        },
      });

      set({
        nodes: graph.nodes,
        edges: graph.edges,
        mapTitle: created.title,
        currentMapId: created.id,
        mapVersion: created.version,
        layoutMeta: { schema: 'balanced-lr', edgeType: null, compact: false },
        chat: [], researchHistory: [], researchPanelNodeId: null,
        aiLoading: false, generatingMap: false,
        lastProviderUsed: result.provider_used ?? null,
      });
      toast.success(`Mapa "${created.title}" gerado`, {
        description: `${graph.count} nós · via ${result.provider_used}.`,
        action: previousMapId && previousMapId !== created.id
          ? { label: 'Voltar ao anterior', onClick: () => get().loadMap(previousMapId) }
          : undefined,
      });
    } catch (error) {
      set({ generatingMap: false });
      const { message } = extractApiError(error);
      set({ generateError: message });
      toast.error('Falha ao gerar o mapa', { description: message });
    }
  },

  // --- UI State ---
  setActivePanel: (panelName) => set({ activePanel: panelName }),
  clearResearchError: () => set({ aiError: null, aiErrorCode: null }),
  clearResearchResult: () => set({ researchResult: null }),

  // Seleção múltipla (v0.4.5 B4): o CustomNode reporta transições de seleção;
  // aqui ficam o CONTAGEM e o ÚLTIMO selecionado (ordem real de clique).
  noteSelection: (nodeId, selected) => {
    const s = get();
    const count = s.nodes.filter((n) => n.selected).length;
    const patch = {};
    if (selected && s.lastSelectedNodeId !== nodeId) patch.lastSelectedNodeId = nodeId;
    if (count !== s.selectedCount) patch.selectedCount = count;
    if (Object.keys(patch).length) set(patch);
  },

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

// Pesquisa viva corrente (AbortController) — UMA por vez; a mais nova vence
let researchAbort = null;

// B4: assinatura ESTRUTURAL (ids) — muda ao adicionar/remover/conectar,
// mas NÃO em drag de posição: o auto-layout não briga com o usuário.
const structuralSignature = (s) =>
  `${s.nodes.length}:${s.nodes.map((n) => n.id).join(',')}|${s.edges.length}:${s.edges.map((e) => e.id).join(',')}`;

let autoLayoutTimer = null;

useMindMapStore.subscribe((state, prev) => {
  if (state.hydrating) return;
  if (
    state.nodes !== prev.nodes ||
    state.edges !== prev.edges ||
    state.mapTitle !== prev.mapTitle ||
    state.chat !== prev.chat
  ) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      useMindMapStore.getState().saveNow();
    }, 1000);

    // v0.5 B4: toggle "Auto" — relayout silencioso após mudança estrutural
    if (state.autoLayout && structuralSignature(state) !== structuralSignature(prev)) {
      clearTimeout(autoLayoutTimer);
      autoLayoutTimer = setTimeout(() => useMindMapStore.getState().relayoutAuto(), 800);
    }
  }
});

export default useMindMapStore;
