import React, { useEffect, useRef, useState } from 'react';
import useMindMapStore from '../../store/mindMapStore';

// Título do mapa no header: clique edita; Enter/blur confirma (vai no próximo
// ciclo de autosave); Esc cancela.
const MapTitle = () => {
  const mapTitle = useMindMapStore((state) => state.mapTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(mapTitle);
  const inputRef = useRef(null);

  useEffect(() => setDraft(mapTitle), [mapTitle]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const clean = draft.trim();
    if (clean && clean !== mapTitle) {
      useMindMapStore.getState().renameMap(clean);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(mapTitle); setEditing(false); }
        }}
        className="bg-gray-600 rounded px-2 py-1 text-sm text-white w-52 focus:outline-none focus:ring-1 focus:ring-blue-400"
        autoFocus
        aria-label="Nome do mapa"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Renomear mapa (clique para editar)"
      className="text-sm text-gray-200 hover:text-white hover:bg-gray-600 rounded px-2 py-1 max-w-[220px] truncate"
    >
      {mapTitle}
    </button>
  );
};

export default MapTitle;
