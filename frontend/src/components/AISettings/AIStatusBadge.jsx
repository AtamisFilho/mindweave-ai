import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';

// Badge contínuo do header: quem respondeu a última pesquisa de IA,
// destacando fallbacks por 5s e indisponibilidade total.
const AIStatusBadge = () => {
  const { lastProviderUsed, fallbackActiveUntil, aiErrorCode, chainConfig } = useMindMapStore(useShallow((state) => ({
    lastProviderUsed: state.lastProviderUsed,
    fallbackActiveUntil: state.fallbackActiveUntil,
    aiErrorCode: state.aiErrorCode,
    chainConfig: state.chainConfig,
  })));

  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  if (aiErrorCode === 'ALL_PROVIDERS_FAILED') {
    return (
      <span
        className="text-xs bg-red-500/20 text-red-300 px-2 py-1 rounded"
        title="Todos os provedores da cadeia falharam — veja o toast para detalhes."
      >
        ⚠️ IA indisponível
      </span>
    );
  }

  if (!lastProviderUsed) return null;

  const chainSummary = chainConfig
    .filter((c) => c.enabled)
    .map((c) => c.provider)
    .join(' → ');

  const isFallback = fallbackActiveUntil > Date.now();
  return (
    <span
      className={`text-xs px-2 py-1 rounded ${
        isFallback
          ? 'bg-amber-500/20 text-amber-300'
          : 'text-gray-400'
      }`}
      title={isFallback ? `Fallback ativo — cadeia: ${chainSummary || '—'}` : `Cadeia de IA: ${chainSummary || '—'}`}
    >
      {isFallback ? '⚠️ ' : ''}Usando: {lastProviderUsed}
      {isFallback ? ' (fallback)' : ''}
    </span>
  );
};

export default AIStatusBadge;
