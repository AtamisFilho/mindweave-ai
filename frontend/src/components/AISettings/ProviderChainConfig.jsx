import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
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

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2 text-gray-700 dark:text-gray-200">Cadeia de Provedores</h3>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
        A IA tenta os provedores na ordem abaixo e cai automaticamente para o próximo em caso de falha. O primeiro é o preferido; locais ficam por último como fallback soberano.
      </p>

      <div className="space-y-1.5">
        {chain.map((entry, index) => {
          const meta = PROVIDER_META[entry.provider] ?? { icon: '🔌' };
          const test = tests[entry.provider];
          return (
            <div
              key={entry.provider}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-xs ${
                entry.enabled
                  ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  : 'border-dashed border-gray-300 dark:border-gray-600 opacity-60'
              }`}
            >
              <span title={entry.provider} className="shrink-0">{meta.icon}</span>
              <span className="font-medium text-gray-700 dark:text-gray-200 truncate flex-1">
                {entry.provider}
                {entry.model ? <span className="text-gray-400"> · {entry.model}</span> : null}
              </span>
              <span title={statusTitle(entry, test)}>{statusIcon(entry, test)}</span>
              <button onClick={() => move(index, -1)} disabled={index === 0} title="Subir (prioridade maior)" className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30">▲</button>
              <button onClick={() => move(index, 1)} disabled={index === chain.length - 1} title="Descer (prioridade menor)" className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30">▼</button>
              <button
                onClick={() => toggle(index)}
                className={`px-1.5 rounded ${entry.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}
                title={entry.enabled ? 'Habilitado — clique para desabilitar' : 'Desabilitado — clique para habilitar'}
              >
                {entry.enabled ? '⬤' : '◯'}
              </button>
              <button
                onClick={() => runTest(entry)}
                disabled={test?.state === 'testing'}
                className="text-[10px] border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 hover:border-blue-400 text-gray-600 dark:text-gray-300 shrink-0"
              >
                Testar
              </button>
              {entry.provider in models || (entry.provider === 'lmstudio' || entry.provider === 'ollama') ? (
                <button
                  onClick={() => (models[entry.provider] ? undefined : loadModels(entry))}
                  title="Listar modelos disponíveis"
                  className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-0.5"
                >
                  📋
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

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
