import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';

const formatAgo = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'agora mesmo';
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m}min`;
  return `há ${Math.round(m / 60)}h`;
};

const SaveIndicator = () => {
  const { saveState, lastSavedAt, retrySync } = useMindMapStore(useShallow((state) => ({
    saveState: state.saveState,
    lastSavedAt: state.lastSavedAt,
    retrySync: state.retrySync,
  })));

  // mantém "Salvo há Xs" atualizado
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  if (saveState === 'offline') {
    return (
      <button
        onClick={retrySync}
        title="As alterações estão no seu navegador. Clique para tentar sincronizar agora."
        className="text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded hover:bg-amber-500/30 transition-colors"
      >
        ⚠️ Offline (salvo localmente) — Sincronizar
      </button>
    );
  }
  if (saveState === 'conflict') {
    return (
      <span className="text-xs text-red-300 px-2" title="O mapa mudou em outra aba — veja o toast para recarregar">
        ⚠️ Conflito de versão
      </span>
    );
  }
  if (saveState === 'saving') {
    return <span className="text-xs text-gray-300 animate-pulse px-2">Salvando…</span>;
  }
  if (lastSavedAt) {
    return (
      <span
        className="text-xs text-gray-400 px-2"
        title="Autosave ativo — Ctrl+S salva imediatamente"
      >
        Salvo {formatAgo(lastSavedAt)}
      </span>
    );
  }
  return null;
};

export default SaveIndicator;
