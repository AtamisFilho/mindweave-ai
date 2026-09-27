import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
} from '@xyflow/react';
import { getAIConfig, updateAIConfig as apiUpdateAIConfig, performDeepResearch as apiPerformDeepResearch, suggestNewNodes as apiSuggestNewNodes } from '../services/api'; // Renomeado para evitar conflito
import { nanoid } from 'nanoid'; 

// --- Hierarquia derivada das arestas (DAG) ---
// As arestas do React Flow são a fonte única de verdade da hierarquia;
// data.parentId é apenas cache de posicionamento (pai "principal" mais recente).
const getAncestorContext = (nodes, edges, nodeId) => {
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
  nodes: [{ id: nanoid(6), type: 'custom', data: { label: 'Nó Raiz', parentId: null, isRoot: true, isNew: false }, position: { x: 250, y: 5 } }],
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
  researchResult: null, 
  activePanel: 'nodes', 


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
            // Basic positioning: directly below, slightly offset horizontally for multiple children
            newNodePosition = {
                x: parentNode.position.x + (childrenCount * 40) - ((get().nodes.filter(n=>n.data.parentId === parentNodeId).length > 0 ? get().nodes.filter(n=>n.data.parentId === parentNodeId).length-1 : 0) * 20),
                y: parentNode.position.y + 150,
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
    set({ aiLoading: true, aiError: null });
    try {
      const config = await getAIConfig(); // From api.js
      set({ aiConfig: config, aiLoading: false });
    } catch (error) {
      set({ aiError: error.message || 'Falha ao buscar configuração da IA.', aiLoading: false });
    }
  },

  updateAIConfig: async (newConfig) => {
    set({ aiLoading: true, aiError: null });
    try {
      const updatedConfig = await apiUpdateAIConfig(newConfig); // From api.js
      set({ aiConfig: updatedConfig, aiLoading: false });
    } catch (error) {
      set({ aiError: error.message || 'Falha ao atualizar configuração da IA.', aiLoading: false });
      throw error; 
    }
  },
  
  // --- AI Feature actions ---
  performDeepResearch: async (nodeId) => {
    set({ aiLoading: true, aiError: null, researchResult: null });
    const node = get().nodes.find(n => n.id === nodeId);
    if (!node) {
      set({ aiError: 'Nó não encontrado.', aiLoading: false });
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
      set({ researchResult: {nodeId: result.nodeId, summary: result.researchSummary }, aiLoading: false });
    } catch (error) {
      set({ aiError: error.detail || error.message || 'Falha na pesquisa profunda.', aiLoading: false });
    }
  },

  suggestNewNodes: async (nodeId) => {
    set({ aiLoading: true, aiError: null });
    const parentNode = get().nodes.find(n => n.id === nodeId);
    if (!parentNode) {
      set({ aiError: 'Nó pai não encontrado para sugestões.', aiLoading: false });
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
        result.suggestedNodes.forEach((suggestion, index) => {
          // Use addNode to create and position the new suggested nodes
          get().addNode(nodeId, undefined, { label: suggestion.content });
        });
      }
      set({ aiLoading: false });
    } catch (error) {
      set({ aiError: error.detail || error.message || 'Falha ao sugerir novos nós.', aiLoading: false });
    }
  },

  // --- UI State ---
  setActivePanel: (panelName) => set({ activePanel: panelName }),
  clearResearchError: () => set({ aiError: null }),
  clearResearchResult: () => set({ researchResult: null }),

}));

export default useMindMapStore;
