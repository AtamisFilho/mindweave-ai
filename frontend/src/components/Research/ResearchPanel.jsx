import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';
import Button from '../UI/Button';
import ErrorBoundary from '../ErrorBoundary';

const formatTime = (ts) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const EmptyState = ({ icon, title, hint }) => (
  <div className="text-center py-8 px-3 text-gray-500 dark:text-gray-400">
    <div className="text-3xl mb-2" aria-hidden="true">{icon}</div>
    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</p>
    <p className="text-xs mt-1 leading-relaxed">{hint}</p>
  </div>
);

const ResearchEntry = ({ entry, nodeLabel, expanded, onToggle, onLabelClick }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(entry.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard indisponível (contexto não seguro) — ignora silenciosamente
    }
  };

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
      >
        <span
          className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate"
          title={onLabelClick ? 'Focar este nó no painel' : undefined}
          onClick={(e) => { if (onLabelClick) { e.stopPropagation(); onLabelClick(); } }}
        >
          {nodeLabel}
        </span>
        <span className="text-[10px] text-gray-400 shrink-0">{formatTime(entry.createdAt)}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-white dark:bg-gray-800">
          {/* Markdown malformado nunca derruba o painel: fallback com o texto cru */}
          <ErrorBoundary
            resetKey={entry.id}
            fallback={() => (
              <div>
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                  ⚠️ Não foi possível renderizar esta pesquisa — exibindo o texto original.
                </p>
                <pre className="text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-300 max-h-64 overflow-y-auto">
                  {entry.summary}
                </pre>
              </div>
            )}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.summary}</ReactMarkdown>
            </div>
          </ErrorBoundary>
          <div className="flex justify-end mt-1">
            <Button
              onClick={handleCopy}
              variant="ghost"
              className="text-[10px] px-2! py-0.5! text-gray-500 dark:text-gray-400"
              title="Copiar texto da pesquisa"
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const ResearchPanel = () => {
  const {
    researchHistory,
    researchPanelNodeId,
    researchPanelPinned,
    nodes,
    streamState,
    toggleResearchPanelPin,
    setResearchPanelNode,
  } = useMindMapStore(useShallow((state) => ({
    researchHistory: state.researchHistory,
    researchPanelNodeId: state.researchPanelNodeId,
    researchPanelPinned: state.researchPanelPinned,
    nodes: state.nodes,
    streamState: state.streamState,
    toggleResearchPanelPin: state.toggleResearchPanelPin,
    setResearchPanelNode: state.setResearchPanelNode,
  })));

  const [viewAll, setViewAll] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const labelFor = (nodeId) =>
    nodes.find((n) => n.id === nodeId)?.data.label || '(nó removido)';

  const entries = useMemo(
    () => (viewAll || !researchPanelNodeId
      ? researchHistory
      : researchHistory.filter((e) => e.nodeId === researchPanelNodeId)),
    [viewAll, researchPanelNodeId, researchHistory]
  );

  const panelNodeLabel = researchPanelNodeId ? labelFor(researchPanelNodeId) : null;
  const nodeMissing = researchPanelNodeId && !nodes.some((n) => n.id === researchPanelNodeId);

  // Linha de status viva da cadeia (v0.4.5): trying → failed/skipped → committed
  const phaseLabel = streamState?.phase === 'committed'
    ? `✍️ Gerando via ${streamState.providerLabel}…`
    : streamState?.providerLabel
      ? `⛓ Tentando ${streamState.providerLabel}…`
      : '⛓ Iniciando cadeia…';

  return (
    <div>
      {streamState && (
        <div className="mb-3 rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 p-2.5">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
            {phaseLabel}
          </p>
          {streamState.trail.length > 0 && (
            <ul className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
              {streamState.trail.map((t, i) => (
                <li key={i}>
                  {t.skipped ? '⏭' : '✗'} {t.provider}: {t.skipped ? 'cooldown' : (t.kind === 'RATE_LIMIT' ? 'rate limit' : t.kind === 'QUOTA_EXHAUSTED' ? 'quota esgotada' : t.kind === 'NETWORK_ERROR' ? 'indisponível' : (t.message || 'falhou'))}
                </li>
              ))}
            </ul>
          )}
          {streamState.text && (
            <pre className="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300 mt-1.5 max-h-40 overflow-y-auto">
              {streamState.text}
            </pre>
          )}
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Pesquisas</h3>
        <button
          type="button"
          onClick={toggleResearchPanelPin}
          className={`text-sm rounded px-1.5 py-0.5 transition-colors ${
            researchPanelPinned
              ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
          title={researchPanelPinned
            ? 'Fixado: novas pesquisas não trocam este contexto (clique para soltar)'
            : 'Fixar: manter este nó visível ao pesquisar outros'}
        >
          {researchPanelPinned ? '📍' : '📌'}
        </button>
      </div>

      <div className="flex space-x-1 mb-3">
        <Button
          onClick={() => setViewAll(false)}
          variant={!viewAll ? 'primary' : 'outline'}
          className="flex-1 text-xs py-1"
        >
          {panelNodeLabel ? `Nó: ${panelNodeLabel}` : 'Este nó'}
        </Button>
        <Button
          onClick={() => setViewAll(true)}
          variant={viewAll ? 'primary' : 'outline'}
          className="flex-1 text-xs py-1"
        >
          Todas ({researchHistory.length})
        </Button>
      </div>

      {nodeMissing && !viewAll && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
          O nó pesquisado foi removido do mapa — o texto permanece aqui.
        </p>
      )}

      {entries.length === 0 ? (
        viewAll ? (
          <EmptyState
            icon="📓"
            title="Seu diário de bordo está vazio"
            hint="Selecione um nó no mapa e clique em “Pesquisa IA” para gerar a primeira pesquisa."
          />
        ) : (
          <EmptyState
            icon="🔍"
            title="Nenhuma pesquisa para este nó ainda"
            hint="Selecione um nó no mapa e use o botão “Pesquisa IA” nele. O resultado aparece aqui, com formatação e histórico."
          />
        )
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <ResearchEntry
              key={entry.id}
              entry={entry}
              nodeLabel={viewAll ? labelFor(entry.nodeId) : (panelNodeLabel || labelFor(entry.nodeId))}
              expanded={expandedId === null ? entry.id === entries[0].id : expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              onLabelClick={viewAll && nodes.some((n) => n.id === entry.nodeId)
                ? () => { setResearchPanelNode(entry.nodeId); setViewAll(false); setExpandedId(null); }
                : undefined}
            />
          ))}
          {viewAll && (
            <p className="text-[10px] text-gray-400 text-center pt-1">
              Clique em uma pesquisa para expandir. Use 📌 para fixar o contexto de um nó.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ResearchPanel;
