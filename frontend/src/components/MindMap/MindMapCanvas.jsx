import React, { useCallback, useMemo, useEffect } from 'react';
import { ReactFlow, MiniMap, Controls, Background, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useShallow } from 'zustand/react/shallow';

import useMindMapStore from '../../store/mindMapStore';
import CustomNode from './CustomNode';
import Button from '../UI/Button';

const MindMapCanvas = () => {
  const {
    nodes, // Direct from store
    edges, // Direct from store
    onNodesChange, // Store's handler
    onEdgesChange, // Store's handler
    addEdge,       // Store's handler
    addNode,       // Store's handler for adding new nodes
    fetchAIConfig, // To fetch AI config on load
  } = useMindMapStore(useShallow((state) => ({
    nodes: state.nodes,
    edges: state.edges,
    onNodesChange: state.onNodesChange,
    onEdgesChange: state.onEdgesChange,
    addEdge: state.addEdge,
    addNode: state.addNode,
    fetchAIConfig: state.fetchAIConfig,
  })));

  // Fetch AI config when the canvas mounts, so it's ready
  useEffect(() => {
    fetchAIConfig();
  }, [fetchAIConfig]);

  const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);

  const onConnect = useCallback(
    (params) => {
      addEdge(params);
    },
    [addEdge]
  );

  const handleAddRootNode = () => {
    const existingRootNodes = nodes.filter(n => n.data.isRoot);
    const newX = 250 + (existingRootNodes.length * 50); // Offset new root nodes slightly
    const newY = 5 + (existingRootNodes.length * 20);
    addNode(null, { x: newX, y: newY }, { label: 'Novo Raiz' });
  };

  // Fit view options to ensure nodes are not too small initially
  const fitViewOptions = {
    padding: 0.2, // Add some padding around the nodes
    // maxZoom: 1.5, // Don't zoom in too much
  };

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }} className="mindmap-canvas-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={fitViewOptions}
        attributionPosition="bottom-left"
        className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900"
        deleteKeyCode={['Backspace', 'Delete']} // Allow deleting nodes with Backspace/Delete
      >
        <Controls className="react-flow__controls_custom" />
        <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            className="react-flow__minimap_custom"
            nodeColor={(node) => {
                switch (node.type) {
                    case 'custom': return '#60a5fa'; // blue-400
                    default: return '#e2e8f0'; // slate-200
                }
            }}
        />
        <Background variant="dots" gap={16} size={0.8} color="#cbd5e1" className="dark:bg-gray-800! dark:text-gray-600!" />

        <Panel position="top-left" className="p-2">
            <Button onClick={handleAddRootNode} variant="primary" className="shadow-lg text-xs py-1.5 px-3">
                Adicionar Nó Raiz
            </Button>
        </Panel>

      </ReactFlow>
      {/* Customizações dos controles do React Flow vivem em src/index.css */}
    </div>
  );
};

export default MindMapCanvas;
