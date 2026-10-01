import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';
import { listMaps, searchNodesApi } from '../../services/api';

const relTime = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

// Menu discreto de mapas: busca FTS5 no topo (debounce 300ms) filtra a lista
// e mostra os nós que casaram; "＋ Novo mapa" e exclusão com Undo vivem aqui.
const MapsMenu = () => {
  const { currentMapId, createNewMap, loadMap, deleteMapWithUndo } = useMindMapStore(useShallow((state) => ({
    currentMapId: state.currentMapId,
    createNewMap: state.createNewMap,
    loadMap: state.loadMap,
    deleteMapWithUndo: state.deleteMapWithUndo,
  })));

  const [open, setOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [maps, setMaps] = useState([]);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState(null); // null = lista completa; [] = busca sem hits
  const [confirmId, setConfirmId] = useState(null);
  const menuRef = useRef(null);
  const debounceRef = useRef(null);

  const refresh = () => listMaps().then(setMaps).catch(() => setMaps([]));

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const onClickOutside = (e) => {
      if (!menuRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setRows(null);
      return undefined;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await searchNodesApi(query.trim());
        const byMap = {};
        hits.forEach((hit) => {
          (byMap[hit.map_id] ||= []).push(hit.node_text);
        });
        setRows(maps.filter((m) => byMap[m.id]).map((m) => ({ ...m, matches: byMap[m.id].slice(0, 3) })));
      } catch {
        setRows([]);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, open, maps]);

  const display = rows ?? maps;

  const handleDelete = async (map) => {
    await deleteMapWithUndo(map.id, map.title);
    setConfirmId(null);
    refresh();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm bg-gray-600 hover:bg-gray-500 text-white rounded px-2 py-1 flex items-center gap-1"
        title="Novo, renomear, buscar e excluir mapas"
      >
        Mapas <span className="text-[10px]">▼</span>
      </button>

      {generateOpen && (
        <GenerateMapModal open onClose={() => setGenerateOpen(false)} />
      )}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white dark:bg-gray-800 rounded-md shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
          <button
            onClick={() => { createNewMap(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            ＋ Novo mapa
          </button>
          <button
            onClick={() => { setGenerateOpen(true); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm font-medium text-purple-600 dark:text-purple-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            title="A IA cria um mapa NOVO a partir de um tópico"
          >
            ✨ Gerar mapa a partir de um tópico…
          </button>

          <div className="px-3 pb-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar nós em todos os mapas…"
              className="w-full text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <div className="max-h-72 overflow-y-auto border-t border-gray-100 dark:border-gray-700">
            {display.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-3 text-center">
                {rows ? 'Nenhum nó corresponde à busca.' : 'Nenhum mapa salvo.'}
              </p>
            )}
            {display.map((map) => (
              <div
                key={map.id}
                className={`group flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 ${map.id === currentMapId ? 'bg-blue-50 dark:bg-gray-900' : ''}`}
              >
                <button
                  onClick={() => { if (map.id !== currentMapId) loadMap(map.id); setOpen(false); }}
                  className="flex-1 text-left min-w-0"
                >
                  <p className={`text-sm truncate ${map.id === currentMapId ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                    {map.title}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {map.node_count} nós · {relTime(map.updated_at)}
                  </p>
                  {map.matches && (
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                      ↳ {map.matches.join(' · ')}
                    </p>
                  )}
                </button>
                {confirmId === map.id ? (
                  <button
                    onClick={() => handleDelete(map)}
                    className="text-[10px] bg-red-500 text-white px-1.5 py-1 rounded ml-2 shrink-0"
                    title="Clique de novo para excluir definitivamente"
                  >
                    Confirmar?
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmId(map.id)}
                    className="text-xs text-gray-300 group-hover:text-red-400 px-1 ml-2 shrink-0"
                    title={`Excluir "${map.title}"`}
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
          </div>

          <p className="text-[10px] text-gray-400 px-3 py-1.5 border-t border-gray-100 dark:border-gray-700">
            A exclusão pode ser desfeita por 5 segundos (toast).
          </p>
        </div>
      )}
    </div>
  );
};

export default MapsMenu;
