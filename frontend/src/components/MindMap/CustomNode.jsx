import React, { useState, useEffect, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';
import Button from '../UI/Button';

const CustomNode = ({ id, data, selected }) => {
  const { updateNodeLabel, performDeepResearch, suggestNewNodes, aiLoading, addNode, compactNodes } = useMindMapStore(useShallow((state) => ({
    updateNodeLabel: state.updateNodeLabel,
    performDeepResearch: state.performDeepResearch,
    suggestNewNodes: state.suggestNewNodes,
    aiLoading: state.aiLoading,
    addNode: state.addNode, // For adding child nodes via button
    compactNodes: state.layoutMeta?.compact ?? false, // densidade "list" (v0.5)
  })));

  const [isEditing, setIsEditing] = useState(data.isNew || false); 
  const [label, setLabel] = useState(data.label);
  const inputRef = useRef(null); // Ref for the input field

  useEffect(() => {
    setLabel(data.label);
  }, [data.label]);
  
  useEffect(() => {
    if (data.isNew && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select(); // Select text for easy replacement
    }
    // No need to "clear" isNew from data here, store action updateNodeLabel does it.
  }, [data.isNew]);


  const handleLabelChange = (e) => {
    setLabel(e.target.value);
  };

  const handleLabelBlur = () => {
    setIsEditing(false);
    // Only update if the label has actually changed to avoid unnecessary re-renders
    if (label.trim() !== data.label || data.isNew) { // also update if it was a new node to clear isNew
      updateNodeLabel(id, label.trim() || "Nó Vazio");
    }
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
    // Ensure inputRef is focused after re-render if it becomes visible
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent form submission or other default Enter behavior
      handleLabelBlur();
    } else if (e.key === 'Escape'){
      setLabel(data.label); // Revert to original label
      setIsEditing(false);
    }
  };

  const onDeepResearch = (e) => {
    e.stopPropagation(); 
    performDeepResearch(id);
  };

  const onSuggestNodes = (e) => {
    e.stopPropagation();
    suggestNewNodes(id);
  };

  const onAddChildNode = (e) => {
    e.stopPropagation();
    addNode(id, undefined, { label: 'Novo Filho' }); // Pass parentId (current node id)
  };
  
  // Densidade "list" (v0.5): nó compacto para caber mais por tela
  const nodeBaseStyle = compactNodes
    ? `bg-linear-to-br from-sky-500 to-sky-600 dark:from-sky-600 dark:to-sky-700
       shadow-md rounded-md p-1 text-white min-w-[120px] max-w-[160px] text-xs text-center relative group`
    : `bg-linear-to-br from-sky-500 to-sky-600 dark:from-sky-600 dark:to-sky-700
       shadow-lg rounded-lg p-3 text-white
       min-w-[180px] max-w-[280px] text-center relative group`; // Added group for potential hover effects
  const nodeSelectedStyle = selected ? "ring-2 ring-yellow-400 dark:ring-yellow-500 ring-offset-1 ring-offset-gray-100 dark:ring-offset-gray-800" : "border border-transparent";

  return (
    <div 
      className={`${nodeBaseStyle} ${nodeSelectedStyle}`}
      onDoubleClick={handleDoubleClick}
    >
      {!data.isRoot && <Handle type="target" position={Position.Top} className="bg-gray-500! dark:bg-gray-400! w-2.5! h-2.5! border-white! dark:border-gray-700! border-2!" />}
      
      {isEditing ? (
        <textarea
          ref={inputRef}
          value={label}
          onChange={handleLabelChange}
          onBlur={handleLabelBlur}
          onKeyDown={handleKeyDown}
          aria-label="Texto do nó"
          className="text-gray-900 bg-white p-1.5 rounded border border-sky-300 w-full text-center text-sm
                     focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none custom-node-input"
          rows={Math.max(1, Math.ceil(label.length / 20))} // Basic auto-resize for rows
          autoFocus
        />
      ) : (
        <div className="font-medium text-sm break-words p-1.5 cursor-pointer min-h-[2.5em] flex items-center justify-center" title="Clique duplo para editar">
          {label || " "} {/* Ensure div doesn't collapse if label is empty */}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="bg-gray-500! dark:bg-gray-400! w-2.5! h-2.5! border-white! dark:border-gray-700! border-2!" />

      {/* Action buttons - visible when node is selected or hovered (if using group hover) */}
      {selected && (
        <div className="mt-2.5 pt-2.5 border-t border-sky-400 dark:border-sky-500 space-y-1.5">
          {/* TODO(v0.4): getState() em render não é reativo (auditoria v0.3.1) —
              mover researchResult para o seletor useShallow acima. */}
          <Button
            onClick={onDeepResearch}
            variant="outline"
            className="w-full bg-sky-50! text-sky-700! hover:bg-sky-100!
                       dark:bg-sky-700! dark:text-sky-100! dark:hover:bg-sky-600!
                       text-xs py-1 border-sky-200! dark:border-sky-600!"
            disabled={aiLoading && (useMindMapStore.getState().researchResult?.nodeId === id || !useMindMapStore.getState().researchResult)} // More specific loading state if needed
            title="Pesquisar este tópico com IA"
          >
            {aiLoading && (useMindMapStore.getState().researchResult?.nodeId === id) ? 'Pesquisando...' : 'Pesquisa IA'}
          </Button>
          <Button
            onClick={onSuggestNodes}
            variant="outline"
            className="w-full bg-sky-50! text-sky-700! hover:bg-sky-100!
                       dark:bg-sky-700! dark:text-sky-100! dark:hover:bg-sky-600!
                       text-xs py-1 border-sky-200! dark:border-sky-600!"
            disabled={aiLoading}
            title="Sugerir novos nós filhos com IA"
          >
            {aiLoading ? 'Sugerindo...' : 'Sugerir Nós IA'}
          </Button>
           <Button
            onClick={onAddChildNode}
            variant="outline"
            className="w-full bg-green-50! text-green-700! hover:bg-green-100!
                       dark:bg-green-700! dark:text-green-100! dark:hover:bg-green-600!
                       text-xs py-1 border-green-200! dark:border-green-600!"
            title="Adicionar um novo nó filho manualmente"
          >
            Adicionar Filho
          </Button>
        </div>
      )}
    </div>
  );
};

export default React.memo(CustomNode);
