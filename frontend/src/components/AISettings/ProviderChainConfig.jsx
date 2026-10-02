import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import useMindMapStore from '../../store/mindMapStore';
import Button from '../UI/Button';
import {
  saveChain, resetChainApi, testProviderApi, getProviderModelsApi,
} from '../../services/api';

const PROVIDER_META = {
  groq: { icon: '⚡' }, gemini: { icon: '◆' }, openrouter: { icon: '🔀' },
  cerebras: { icon: '🧠' }, deepseek: { icon: '🐋' }, openai: { icon: '🤖' },
  ollama: { icon: '🦙', local: true }, lmstudio: { icon: '🖥️', local: true },
};

// Estados por provedor: idle | testing | ok | fail(kind) | sem chave
const statusIcon = (entry, test) => {
  if (test?.state === 'testing') return '⏳';
  if (test?.state === 'ok') return '✅';
  if (test?.state === 'fail') return '❌';
  if (!entry.has_key && entry.requires_key) return '⚠️';
  return '🔑';
};

// Linha da cadeia (v0.4.5 B4): reordenável por drag (handle ⠿) — os botões
// ▲▼ permanecem como fallback de acessibilidade/precisão.
function ChainRow({ entry, index, chainLength, onMove, onToggle, onRunTest, test, hasModelList, onLoadModels }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.provider });
  const meta = PROVIDER_META[entry.provider] ?? { icon: '🔌' };
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-xs ${
        entry.enabled
          ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
          : 'border-dashed border-gray-300 dark:border-gray-600 opacity-60'
      } ${isDragging ? 'opacity-60 shadow-lg relative z-10' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 select-none"
        title="Arraste para reordenar (ou use ▲▼)"
        aria-label={`Reordenar ${entry.provider}`}
      >
        ⠿
      </button>
      <span title={entry.provider} className="shrink-0">{meta.icon}</span>
      <span className="font-medium text-gray-700 dark:text-gray-200 truncate flex-1">
        {entry.provider}
        {entry.model ? <span className="text-gray-400"> · {entry.model}</span> : null}
      </span>
      <span title={statusTitle(entry, test)}>{statusIcon(entry, test)}</span>
      <button onClick={() => onMove(index, -1)} disabled={index === 0} title="Subir (prioridade maior)" aria-label={`Subir ${entry.provider}`} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30">▲</button>
      <button onClick={() => onMove(index, 1)} disabled={index === chainLength - 1} title="Descer (prioridade menor)" aria-label={`Descer ${entry.provider}`} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30">▼</button>
      <button
        onClick={() => onToggle(index)}
        className={`px-1.5 rounded ${entry.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}
        title={entry.enabled ? 'Habilitado — clique para desabilitar' : 'Desabilitado — clique para habilitar'}
      >
        {entry.enabled ? '⬤' : '◯'}
      </button>
      <button
        onClick={() => onRunTest(entry)}
        disabled={test?.state === 'testing'}
        className="text-[10px] border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 hover:border-blue-400 text-gray-600 dark:text-gray-300 shrink-0"
      >
        Testar
      </button>
      {hasModelList || entry.provider === 'lmstudio' || entry.provider === 'ollama' ? (
        <button
          onClick={() => (hasModelList ? undefined : onLoadModels(entry))}
          title="Listar modelos disponíveis"
          className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-0.5"
        >
          📋
        </button>
      ) : null}
    </div>
  );
}

export default function ProviderChainConfig() {
  const { chain, setChain, refreshChain } = useMindMapStore(useShallow((s) => ({
    chain: s.chainConfig,
    setChain: s.setChainConfig,
    refreshChain: s.fetchChainConfig,
  })));
  const [tests, setTests] = useState({}); // provider -> {state, message}
  const [models, setModels] = useState({}); // provider -> [nomes]

  useEffect(() => { refreshChain(); }, [refreshChain]);

  const move = (index, delta) => {
    const next = [...chain];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setChain(next);
  };

  const toggle = (index) => {
    const next = [...chain];
    const anyOtherOn = next.some((c, i) => i !== index && c.enabled);
    if (next[index].enabled && !anyOtherOn) {
      toast.error('Pelo menos um provedor deve ficar habilitado.');
      return;
    }
    next[index] = { ...next[index], enabled: !next[index].enabled };
    setChain(next);
  };

  const persist = async () => {
    try {
      const saved = await saveChain(chain.map(({ provider, enabled, model }) => ({ provider, enabled, model })));
      setChain(saved);
      toast.success('Cadeia salva — a IA usará esta ordem.');
    } catch (error) {
      toast.error(error?.detail?.message || 'Falha ao salvar a cadeia.', {
        description: error?.detail?.error_code === 'ALL_DISABLED'
          ? 'Habilite pelo menos um provedor.' : undefined,
      });
    }
  };

  const resetToDefault = async () => {
    try {
      const saved = await resetChainApi();
      setChain(saved);
      toast.success('Cadeia restaurada para o padrão.');
    } catch {
      toast.error('Falha ao restaurar a cadeia.');
    }
  };

  const runTest = async (entry) => {
    setTests((t) => ({ ...t, [entry.provider]: { state: 'testing' } }));
    try {
      const result = await testProviderApi(entry.provider);
      setTests((t) => ({
        ...t,
        [entry.provider]: result.ok
          ? { state: 'ok', message: `Conectado (${result.latency_ms}ms)` }
          : { state: 'fail', message: result.message ?? 'Falhou' },
      }));
    } catch {
      setTests((t) => ({ ...t, [entry.provider]: { state: 'fail', message: 'Falhou' } }));
    }
  };

  const loadModels = async (entry) => {
    try {
      const result = await getProviderModelsApi(entry.provider);
      setModels((m) => ({ ...m, [entry.provider]: result.models ?? [] }));
    } catch {
      toast.error(`Não foi possível listar modelos de ${entry.provider}.`);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // v0.4.5 B4: reordenação por drag — rearranja o estado local; persistir
  // continua sendo pelo botão "Salvar cadeia" (mesma semântica do ▲▼).
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = chain.findIndex((c) => c.provider === active.id);
    const newIndex = chain.findIndex((c) => c.provider === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setChain(arrayMove(chain, oldIndex, newIndex));
  };

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2 text-gray-700 dark:text-gray-200">Cadeia de Provedores</h3>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
        A IA tenta os provedores na ordem abaixo e cai automaticamente para o próximo em caso de falha. O primeiro é o preferido; locais ficam por último como fallback soberano. Arraste pelo ⠿ (ou use ▲▼) para reordenar.
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={chain.map((c) => c.provider)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {chain.map((entry, index) => (
              <ChainRow
                key={entry.provider}
                entry={entry}
                index={index}
                chainLength={chain.length}
                onMove={move}
                onToggle={toggle}
                onRunTest={runTest}
                test={tests[entry.provider]}
                hasModelList={entry.provider in models}
                onLoadModels={loadModels}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {Object.entries(models).map(([provider, list]) => (
        list?.length ? (
          <p key={provider} className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
            {provider}: {list.slice(0, 4).join(', ')}{list.length > 4 ? '…' : ''}
          </p>
        ) : null
      ))}

      {Object.entries(tests).filter(([, t]) => t?.message).map(([provider, t]) => (
        <p key={provider} className={`text-[10px] mt-1 ${t.state === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
          {provider}: {t.message}
        </p>
      ))}

      <div className="flex gap-1.5 mt-3">
        <Button onClick={persist} variant="primary" className="flex-1 text-xs py-1">
          Salvar cadeia
        </Button>
        <Button onClick={resetToDefault} variant="outline" className="flex-1 text-xs py-1">
          Resetar padrão
        </Button>
      </div>
    </div>
  );
}

function statusTitle(entry, test) {
  if (test?.state === 'testing') return 'Testando conexão…';
  if (test?.state === 'ok') return `Conectado (${test.message})`;
  if (test?.state === 'fail') return `Falhou: ${test.message}`;
  if (!entry.has_key && entry.requires_key) return 'Sem chave configurada';
  return 'Chave configurada';
}
