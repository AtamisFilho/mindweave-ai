import React, { useState, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';
import { extractApiError } from '../../services/api';
import Button from '../UI/Button';
import Input from '../UI/Input';
import Select from '../UI/Select';

const AISettingsPanel = () => {
  const {
    aiConfig,
    fetchAIConfig,
    updateAIConfig,
    aiLoading,
    configFocusKey,
    clearConfigFocusKey,
  } = useMindMapStore(useShallow((state) => ({
    aiConfig: state.aiConfig,
    fetchAIConfig: state.fetchAIConfig,
    updateAIConfig: state.updateAIConfig,
    aiLoading: state.aiLoading,
    configFocusKey: state.configFocusKey,
    clearConfigFocusKey: state.clearConfigFocusKey,
  })));

  const openaiInputRef = useRef(null);
  const googleInputRef = useRef(null);
  const [highlightField, setHighlightField] = useState(null);

  const [localConfig, setLocalConfig] = useState({
    selectedProvider: 'ollama',
    ollamaConfig: { baseUrl: 'http://localhost:11434', model: 'llama3' },
    openaiApiKey: '',
    googleApiKey: '',
    isOpenAiKeySet: false,
    isGoogleKeySet: false,
  });
  const [statusMessage, setStatusMessage] = useState(''); // For success/error messages specific to this panel
  const [panelError, setPanelError] = useState(''); // For errors specific to this panel

  useEffect(() => {
    fetchAIConfig(); // Fetch initial config when component mounts
  }, [fetchAIConfig]);

  useEffect(() => {
    // Update local state when store's aiConfig changes (e.g., after fetch or external update)
    if (aiConfig) {
      setLocalConfig(prev => ({
        ...prev, // Keep current API key inputs if user is typing
        selectedProvider: aiConfig.selectedProvider || 'ollama',
        ollamaConfig: {
          baseUrl: aiConfig.ollamaConfig?.baseUrl || 'http://localhost:11434',
          model: aiConfig.ollamaConfig?.model || 'llama3',
        },
        isOpenAiKeySet: aiConfig.isOpenAiKeySet,
        isGoogleKeySet: aiConfig.isGoogleKeySet,
      }));
    }
  }, [aiConfig]);

  // Toast "Abrir Configurações": troca para o provedor indicado, foca e destaca o campo
  useEffect(() => {
    if (!configFocusKey) return undefined;
    setLocalConfig((prev) => ({ ...prev, selectedProvider: configFocusKey }));
    setHighlightField(configFocusKey);
    const focusTimer = setTimeout(() => {
      const input = configFocusKey === 'google' ? googleInputRef.current : openaiInputRef.current;
      input?.focus();
      clearConfigFocusKey();
    }, 250); // aguarda o bloco do provedor re-renderizar
    const highlightTimer = setTimeout(() => setHighlightField(null), 4000);
    return () => { clearTimeout(focusTimer); clearTimeout(highlightTimer); };
  }, [configFocusKey, clearConfigFocusKey]);

  const fieldHighlight = (field) =>
    highlightField === field
      ? 'ring-2 ring-amber-400 dark:ring-amber-500 rounded-md p-1 -m-1 bg-amber-50 dark:bg-amber-900/30'
      : '';

  const handleChange = (e) => {
    const { name, value } = e.target;
    setPanelError(''); // Clear panel-specific error on change
    setStatusMessage(''); // Clear status message

    if (name === 'selectedProvider') {
      setLocalConfig(prev => ({ ...prev, selectedProvider: value, openaiApiKey: '', googleApiKey: '' })); // Clear keys when provider changes
    } else if (name === 'ollamaBaseUrl') {
      setLocalConfig(prev => ({ ...prev, ollamaConfig: { ...prev.ollamaConfig, baseUrl: value } }));
    } else if (name === 'ollamaModel') {
      setLocalConfig(prev => ({ ...prev, ollamaConfig: { ...prev.ollamaConfig, model: value } }));
    } else {
      setLocalConfig(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setPanelError('');
    setStatusMessage('');

    // Construct payload, only include API keys if they are provided by the user
    const payload = {
        selectedProvider: localConfig.selectedProvider,
        ollamaConfig: localConfig.ollamaConfig,
    };
    if (localConfig.openaiApiKey) {
        payload.openaiApiKey = localConfig.openaiApiKey;
    }
    if (localConfig.googleApiKey) {
        payload.googleApiKey = localConfig.googleApiKey;
    }

    try {
      await updateAIConfig(payload); 
      setStatusMessage('Configurações salvas com sucesso!');
      // Clear API key input fields after successful submission for better UX
      setLocalConfig(prev => ({...prev, openaiApiKey: '', googleApiKey: ''}));
      // Re-fetch to get updated isOpenAiKeySet, isGoogleKeySet status from backend
      fetchAIConfig(); 
    } catch (error) {
      // extractApiError normaliza { detail: { error_code, message } } do backend
      const { message: errorMessage } = extractApiError(error);
      setPanelError(errorMessage);
      setStatusMessage(''); // Clear success message if there was one
    }
  };
  
  const providerOptions = [
    { value: 'ollama', label: 'Ollama' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'google', label: 'Google (Gemini)' },
  ];

  return (
    <div className="p-1"> {/* Reduced padding for the containing div */}
      <h3 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-200">Configurações de IA</h3>
      {panelError && <p className="text-red-500 bg-red-100 dark:bg-red-900 dark:text-red-200 p-2 rounded mb-3 text-sm">{panelError}</p>}
      {statusMessage && (
        <p className={`p-2 rounded mb-3 text-sm ${statusMessage.includes('sucesso') ? 'text-green-700 bg-green-100 dark:bg-green-900 dark:text-green-200' : 'text-red-700 bg-red-100 dark:bg-red-900 dark:text-red-200'}`}>
          {statusMessage}
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="selectedProvider" className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
            Provedor de IA
          </label>
          <Select
            name="selectedProvider"
            value={localConfig.selectedProvider}
            onChange={handleChange}
            options={providerOptions}
            className="w-full"
          />
        </div>

        {localConfig.selectedProvider === 'ollama' && (
          <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 space-y-3">
            <h4 className="text-md font-semibold text-gray-700 dark:text-gray-200">Ollama</h4>
            <div>
              <label htmlFor="ollamaBaseUrl" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                URL Base
              </label>
              <Input
                name="ollamaBaseUrl"
                value={localConfig.ollamaConfig.baseUrl}
                onChange={handleChange}
                placeholder="ex: http://localhost:11434"
                className="w-full text-sm"
              />
            </div>
            <div>
              <label htmlFor="ollamaModel" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Modelo
              </label>
              <Input
                name="ollamaModel"
                value={localConfig.ollamaConfig.model}
                onChange={handleChange}
                placeholder="ex: llama3, mistral"
                className="w-full text-sm"
              />
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Certifique-se que o modelo foi baixado: `ollama pull nome_do_modelo`.</p>
            </div>
          </div>
        )}

        {localConfig.selectedProvider === 'openai' && (
          <div className={`p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 ${fieldHighlight('openai')}`}>
            <h4 className="text-md font-semibold text-gray-700 dark:text-gray-200">OpenAI</h4>
            <div>
              <label htmlFor="openaiApiKey" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Chave da API OpenAI {localConfig.isOpenAiKeySet && <span className="text-green-500 text-xs">(Configurada)</span>}
              </label>
              <Input
                ref={openaiInputRef}
                type="password"
                name="openaiApiKey"
                value={localConfig.openaiApiKey}
                onChange={handleChange}
                placeholder={localConfig.isOpenAiKeySet ? "Deixe em branco para manter a chave atual" : "Sua chave sk-..."}
                className="w-full text-sm"
              />
            </div>
          </div>
        )}

        {localConfig.selectedProvider === 'google' && (
          <div className={`p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 ${fieldHighlight('google')}`}>
            <h4 className="text-md font-semibold text-gray-700 dark:text-gray-200">Google (Gemini)</h4>
            <div>
              <label htmlFor="googleApiKey" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Chave da API Google {localConfig.isGoogleKeySet && <span className="text-green-500 text-xs">(Configurada)</span>}
              </label>
              <Input
                ref={googleInputRef}
                type="password"
                name="googleApiKey"
                value={localConfig.googleApiKey}
                onChange={handleChange}
                placeholder={localConfig.isGoogleKeySet ? "Deixe em branco para manter a chave atual" : "Sua chave AIzaSy..."}
                className="w-full text-sm"
              />
            </div>
          </div>
        )}
        
        <div className="flex justify-end pt-2">
          <Button type="submit" variant="primary" disabled={aiLoading} className="min-w-[100px] text-sm py-1.5">
            {aiLoading ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AISettingsPanel;
