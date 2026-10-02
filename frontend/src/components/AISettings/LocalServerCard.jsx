import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';
import Button from '../UI/Button';
import Input from '../UI/Input';

const META = {
  lmstudio: {
    label: 'LM Studio (local)',
    defaultUrl: 'http://localhost:1234/v1',
    urlHint: 'porta padrão do servidor do LM Studio',
    steps: [
      'Abra o LM Studio.',
      'Vá na aba Developer (ícone de terminal, à esquerda).',
      'Clique em Start Server — a porta 1234 deve ficar no ar.',
    ],
  },
  ollama: {
    label: 'Ollama (local)',
    defaultUrl: 'http://localhost:11434',
    urlHint: 'porta padrão do Ollama',
    steps: [
      'Abra um terminal (Prompt de Comando).',
      'Rode: ollama serve',
      'Deixe essa janela aberta enquanto usa o MindWeave.',
    ],
  },
};

// Cartão de servidor local (v0.6.1): status vivo (probe), URL base editável
// e seleção de modelo — o modelo escolhido vira o usado nas chamadas.
// Não detectamos "instalado": detectamos "servidor respondendo".
const LocalServerCard = ({ provider }) => {
  const meta = META[provider];
  const {
    status, models, chainEntry, probeLocalServers, persistChainEntry,
  } = useMindMapStore(useShallow((state) => ({
    status: state.localStatus[provider] ?? null,
    models: state.localModels[provider] ?? [],
    chainEntry: state.chainConfig.find((e) => e.provider === provider) ?? {},
    probeLocalServers: state.probeLocalServers,
    persistChainEntry: state.persistChainEntry,
  })));

  const [url, setUrl] = useState(chainEntry.base_url || meta.defaultUrl);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setUrl(chainEntry.base_url || meta.defaultUrl);
  }, [chainEntry.base_url, meta.defaultUrl]);

  const dirtyUrl = url.trim() !== (chainEntry.base_url || meta.defaultUrl);
  const up = status === 'up';
  const down = status === 'down';
  const model = chainEntry.model ?? '';

  const selectModel = async (value) => {
    const ok = await persistChainEntry(provider, { model: value || null });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const saveUrl = async () => {
    const ok = await persistChainEntry(provider, { base_url: url.trim() || meta.defaultUrl });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      probeLocalServers(); // nova URL: re-probe
    }
  };

  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-md font-semibold text-gray-700 dark:text-gray-200">{meta.label}</h4>
        <span
          className={`text-xs font-medium shrink-0 ${up ? 'text-emerald-600 dark:text-emerald-400' : down ? 'text-red-500 dark:text-red-400' : 'text-gray-400'}`}
          title={up ? 'Servidor respondendo' : down ? 'Servidor local não respondeu' : 'Verificando...'}
        >
          {up ? '● no ar' : down ? '○ servidor fora' : '… verificando'}
        </span>
      </div>

      {down && (
        <div className="text-xs bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded p-2 space-y-1">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            Para usar a IA por aqui, ligue o servidor do {meta.label.split(' (')[0]}:
          </p>
          <ol className="list-decimal list-inside text-gray-600 dark:text-gray-300 space-y-0.5">
            {meta.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <Button
            onClick={() => probeLocalServers()}
            variant="outline"
            className="text-xs py-0.5 px-2 mt-1"
          >
            Verificar de novo
          </Button>
        </div>
      )}

      <div>
        <label htmlFor={`${provider}BaseUrl`} className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          URL Base ({meta.urlHint})
        </label>
        <div className="flex gap-1.5">
          <Input
            id={`${provider}BaseUrl`}
            name={`${provider}BaseUrl`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full text-sm"
          />
          {dirtyUrl && (
            <Button onClick={saveUrl} variant="outline" className="text-xs py-1 px-2 shrink-0">
              Salvar
            </Button>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={`${provider}Model`} className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          Modelo {saved && <span className="text-green-500">(salvo!)</span>}
        </label>
        {up && models.length > 0 ? (
          <select
            id={`${provider}Model`}
            value={model}
            onChange={(e) => selectModel(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
            aria-label={`Modelo do ${meta.label}`}
          >
            <option value="">(padrão do servidor)</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <Input
            id={`${provider}Model`}
            value={model}
            onChange={(e) => selectModel(e.target.value)}
            placeholder={down ? 'servidor fora — digite o id do modelo se souber' : 'ex: qwen2.5-7b-instruct'}
            className="w-full text-sm"
            aria-label={`Modelo do ${meta.label}`}
          />
        )}
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {up
            ? `Modelos carregados do servidor (${models.length}). A escolha vale para todas as chamadas.`
            : 'O app usa a IA quando o servidor estiver respondendo — nada é instalado automaticamente.'}
        </p>
      </div>
    </div>
  );
};

export default LocalServerCard;
