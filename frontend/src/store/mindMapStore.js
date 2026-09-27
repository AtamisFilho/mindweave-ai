import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
} from '@xyflow/react';
import { getAIConfig, updateAIConfig as apiUpdateAIConfig, performDeepResearch as apiPerformDeepResearch, suggestNewNodes as apiSuggestNewNodes } from '../services/api'; // Renomeado para evitar conflito
import { nanoid } from 'nanoid'; 

// Helper function to get ancestor context
const getAncestorContext = (nodes, nodeId) => {
    const context = [];
    let currentNode = nodes.find(n => n.id === nodeId);
    if (!currentNode) return [];

    // Assume parentId is stored in node.data.parentId
    let parentId = currentNode.data?.parentId; 
    while (parentId) {
        const parentNode = nodes.find(n => n.id === parentId);
        if (parentNode) {
            context.push({ id: parentNode.id, content: parentNode.data.label });
            parentId = parentNode.data?.parentId;
        } else {
            break; 
        }
    }
    return context; 
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
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
    })),
  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    })),
  addEdge: (params) =>
    set((state) => ({
      edges: rfAddEdge({ ...params, type: 'smoothstep', animated: true, style: { strokeWidth: 2 } }, state.edges),
    })),

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
      ancestorContext: getAncestorContext(get().nodes, nodeId),
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
      ancestorContext: getAncestorContext(get().nodes, nodeId),
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
