import React, { useState, useEffect, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';
import Button from '../UI/Button';

const CustomNode = ({ id, data, selected }) => {
  const {
    updateNodeLabel, performDeepResearch, suggestNewNodes, aiLoading, addNode, compactNodes,
    noteSelection, lastSelectedNodeId, selectedCount, suggestNodesBatch, addSiblingNode,
  } = useMindMapStore(useShallow((state) => ({
    updateNodeLabel: state.updateNodeLabel,
    performDeepResearch: state.performDeepResearch,
    suggestNewNodes: state.suggestNewNodes,
    aiLoading: state.aiLoading,
    addNode: state.addNode, // For adding child nodes via button
    compactNodes: state.layoutMeta?.compact ?? false, // densidade "list" (v0.5)
    noteSelection: state.noteSelection, // v0.4.5 B4: seleção múltipla
    lastSelectedNodeId: state.lastSelectedNodeId,
    selectedCount: state.selectedCount,
    suggestNodesBatch: state.suggestNodesBatch,
    addSiblingNode: state.addSiblingNode, // v0.6.0 B3: continuidade de edição
  })));

  const [isEditing, setIsEditing] = useState(data.isNew || false); 
  const [label, setLabel] = useState(data.label);
  const inputRef = useRef(null); // Ref for the input field

  useEffect(() => {
    setLabel(data.label);
  }, [data.label]);
  
  useEffect(() => {
    if (!data.isNew) return undefined;
    // O nó novo pode estar invisível no primeiro mount (medição do React
    // Flow) — focus em elemento invisível é no-op e o autoFocus não volta.
    // Re-tenta até concentrar (teto 1,5s); manual pós-estabilização funciona.
    const tick = () => {
      const el = inputRef.current;
      if (!el) return false;
      if (document.activeElement === el) return true;
      // se o usuário clicou fora de propósito, o loop NÃO sequestra o foco
      if (document.activeElement && document.activeElement !== document.body) return true;
      el.focus();
      el.select();
      return document.activeElement === el;
    };
    tick();
    const iv = setInterval(() => { if (tick()) clearInterval(iv); }, 80);
    const stop = setTimeout(() => clearInterval(iv), 1500);
    return () => { clearInterval(iv); clearTimeout(stop); };
    // No need to "clear" isNew from data here, store action updateNodeLabel does it.
  }, [data.isNew]);

  // Seleção múltipla (v0.4.5 B4): reporta a transição ao store — a ordem real
  // de clique define o "último selecionado" (onde o botão de lote aparece).
  useEffect(() => {
    noteSelection(id, selected);
  }, [selected, id, noteSelection]);


  const handleLabelChange = (e) => {
    setLabel(e.target.value);
  };

  const handleLabelBlur = () => {
    setIsEditing(false);
    commitLabel();
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
    // Ensure inputRef is focused after re-render if it becomes visible
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitLabel = () => {
    // Mesma regra do blur: só grava se mudou (ou se limpava isNew)
    if (label.trim() !== data.label || data.isNew) {
      updateNodeLabel(id, label.trim() || "Nó Vazio");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitLabel();
      setIsEditing(false);
      // Continuidade de edição (v0.6.0 B3): o novo nó nasce com isNew ->
      // o CustomNode dele abre o editor focado (rajada sem tocar o mouse)
      addNode(id, undefined, { label: 'Novo Nó' });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitLabel();
      setIsEditing(false);
      addSiblingNode(id);
    } else if (e.key === 'Escape') {
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

  // Expansão em lote (v0.4.5 B4): todos os nós selecionados de uma vez
  const onExpandBatch = (e) => {
    e.stopPropagation();
    const ids = useMindMapStore.getState().nodes.filter((n) => n.selected).map((n) => n.id);
    suggestNodesBatch(ids);
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
          // autoFocus (atributo, não effect): o React Flow mede o nó novo e
          // RECREIA o subtree — o elemento focado é removido e o foco cai no
          // body. O atributo re-dispara o focus a cada remount.
          autoFocus
          className="text-gray-900 bg-white p-1.5 rounded border border-sky-300 w-full text-center text-sm
                     focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none custom-node-input"
          rows={Math.max(1, Math.ceil(label.length / 20))} // Basic auto-resize for rows
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
          {selectedCount > 1 && lastSelectedNodeId === id && (
            <Button
              onClick={onExpandBatch}
              variant="outline"
              className="w-full bg-violet-50! text-violet-700! hover:bg-violet-100!
                         dark:bg-violet-700! dark:text-violet-100! dark:hover:bg-violet-600!
                         text-xs py-1 border-violet-200! dark:border-violet-600!"
              disabled={aiLoading}
              title={`Expande os ${selectedCount} nós selecionados de uma vez (máx. 5)`}
            >
              {aiLoading ? 'Expandindo...' : `Expandir ${selectedCount} nós com IA`}
            </Button>
          )}
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
