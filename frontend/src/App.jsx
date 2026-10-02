import React, { useEffect, Suspense } from 'react';
import { Toaster } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from './store/mindMapStore';
import Button from './components/UI/Button';
import ErrorBoundary from './components/ErrorBoundary';
import MapTitle from './components/Maps/MapTitle';
import MapsMenu from './components/Maps/MapsMenu';
import SaveIndicator from './components/Maps/SaveIndicator';
import AIStatusBadge from './components/AISettings/AIStatusBadge';

// Lazy load components for better initial load time
const MindMapCanvas = React.lazy(() => import('./components/MindMap/MindMapCanvas'));
const AISettingsPanel = React.lazy(() => import('./components/AISettings/AISettingsPanel'));
const ProviderChainConfig = React.lazy(() => import('./components/AISettings/ProviderChainConfig'));
const ResearchPanel = React.lazy(() => import('./components/Research/ResearchPanel'));
const ChatPanel = React.lazy(() => import('./components/Chat/ChatPanel'));

function App() {
  const {
    activePanel,
    setActivePanel,
    darkMode,
    toggleDarkMode,
    aiLoading,
    undoDepth, redoDepth, lastUndoLabel, lastRedoLabel,
  } = useMindMapStore(useShallow((state) => ({
    activePanel: state.activePanel,
    setActivePanel: state.setActivePanel,
    darkMode: state.darkMode,
    toggleDarkMode: state.toggleDarkMode,
    aiLoading: state.aiLoading,
    undoDepth: state.undoStack.length,
    redoDepth: state.redoStack.length,
    lastUndoLabel: state.undoStack.at(-1)?.label ?? null,
    lastRedoLabel: state.redoStack.at(-1)?.label ?? null,
  })));

  // Fricção Zero: carrega o último mapa (ou cria um novo) — sem tela de lista
  useEffect(() => {
    useMindMapStore.getState().bootstrapMap();
  }, []);

  // Ctrl/Cmd+S: salva imediatamente (bypassa o debounce do autosave)
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        useMindMapStore.getState().saveNow({ manual: true });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Undo/redo do mapa (v0.6.0): Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y. Guarda: com o
  // foco em campo de texto, o undo é o NATIVO do campo — nunca desfaz grafo.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      const st = useMindMapStore.getState();
      if (k === 'y' || e.shiftKey) st.redo();
      else st.undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Offline -> online: tenta sincronizar pendências automaticamente
  useEffect(() => {
    const onOnline = () => useMindMapStore.getState().retrySync();
    const onFocus = () => {
      if (useMindMapStore.getState().pendingLocal) onOnline();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const LoadingFallback = ({text = "Carregando componente..."}) => (
    <div className="flex items-center justify-center h-full w-full p-4 text-gray-500 dark:text-gray-400 text-sm">
      {text}
    </div>
  );

  // Aplica a classe .dark no <html> (o Tailwind v4 usa variante dark por classe)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  return (
    <ErrorBoundary
      fallback={() => (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200 gap-3 p-6 text-center">
          <span className="text-4xl" aria-hidden="true">🧩</span>
          <h1 className="text-xl font-semibold">Algo deu errado na interface</h1>
          <p className="text-sm max-w-md text-gray-500 dark:text-gray-400">
            Seu último mapa salvo está a salvo no servidor — nada foi perdido.
            Recarregue a página para voltar ao trabalho.
          </p>
          <Button onClick={() => window.location.reload()} variant="primary" className="mt-2">
            Recarregar
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col h-screen antialiased text-gray-800 dark:text-gray-200">
      <header className="bg-gray-700 dark:bg-gray-900 text-white p-3 shadow-md flex justify-between items-center gap-2 print:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-xl font-semibold shrink-0">MindWeave AI</h1>
          <span className="text-gray-500">/</span>
          <MapTitle />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AIStatusBadge />
          <Button
            onClick={() => useMindMapStore.getState().undo()}
            disabled={undoDepth === 0}
            variant="ghost"
            className="text-sm px-2! py-1!"
            title={lastUndoLabel ? `Desfazer: ${lastUndoLabel}` : 'Nada para desfazer'}
            aria-label="Desfazer"
          >
            ↩
          </Button>
          <Button
            onClick={() => useMindMapStore.getState().redo()}
            disabled={redoDepth === 0}
            variant="ghost"
            className="text-sm px-2! py-1!"
            title={lastRedoLabel ? `Refazer: ${lastRedoLabel}` : 'Nada para refazer'}
            aria-label="Refazer"
          >
            ↪
          </Button>
          <SaveIndicator />
          <MapsMenu />
          <Button onClick={toggleDarkMode} variant="ghost" className="text-sm px-2! py-1!">
            {darkMode ? 'Modo Claro' : 'Modo Escuro'}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-full md:w-1/3 lg:w-1/4 max-w-xs p-3 bg-gray-100 dark:bg-gray-800 shadow-lg overflow-y-auto sidebar-panel space-y-3 print:hidden">
          <div className="flex space-x-1 mb-3">
            <Button
              onClick={() => setActivePanel('nodes')}
              variant={activePanel === 'nodes' ? 'primary' : 'outline'}
              className="flex-1 text-xs py-1.5"
            >
              Ajuda
            </Button>
            <Button
              onClick={() => setActivePanel('research')}
              variant={activePanel === 'research' ? 'primary' : 'outline'}
              className="flex-1 text-xs py-1.5"
            >
              Pesquisas
            </Button>
            <Button
              onClick={() => setActivePanel('chat')}
              variant={activePanel === 'chat' ? 'primary' : 'outline'}
              className="flex-1 text-xs py-1.5"
            >
              Chat
            </Button>
            <Button
              onClick={() => setActivePanel('config')}
              variant={activePanel === 'config' ? 'primary' : 'outline'}
              className="flex-1 text-xs py-1.5"
            >
              IA Config
            </Button>
          </div>

          <Suspense fallback={<LoadingFallback />}>
            {activePanel === 'nodes' && (
              <div> {/* This div will get sidebar-panel > div styling from index.css */}
                <h3 className="text-md font-semibold mb-2 text-gray-700 dark:text-gray-200">Instruções</h3>
                <ul className="list-disc list-inside text-xs text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Clique duplo no nó para editar texto.</li>
                    <li>Com o editor aberto: Enter cria um filho, Tab cria um irmão (na raiz, outra raiz) — o novo nó já abre em edição.</li>
                    <li>Selecione um nó para ver ações de IA.</li>
                    <li>Use 'Delete' ou 'Backspace' para remover nós.</li>
                    <li>Arraste de um círculo em um nó para outro para conectar.</li>
                    <li>Conexões cruzadas (cross-links) são bem-vindas — a IA entende múltiplos pais.</li>
                    <li>Use os controles no canto para zoom e pan.</li>
                    <li>Clique "Adicionar Nó Raiz" para iniciar um novo mapa.</li>
                </ul>
              </div>
            )}
            {activePanel === 'research' && <ResearchPanel />}
            {activePanel === 'chat' && <ChatPanel />}
            {activePanel === 'config' && (
              <div className="space-y-4">
                <ProviderChainConfig />
                <AISettingsPanel />
              </div>
            )}
          </Suspense>
        </aside>

        <main className="flex-1 flex flex-col relative bg-white dark:bg-gray-900">
          <Suspense fallback={<LoadingFallback text="Carregando Mapa Mental..." />}>
            <MindMapCanvas />
          </Suspense>
          {aiLoading && (
            <div className="absolute bottom-4 right-4 bg-yellow-400 text-yellow-800 px-3 py-1.5 rounded shadow-lg animate-pulse text-sm print:hidden">
              IA Processando...
            </div>
          )}
        </main>
      </div>

      <Toaster
        theme={darkMode ? 'dark' : 'light'}
        position="bottom-right"
        richColors
        closeButton
      />
      </div>
    </ErrorBoundary>
  );
}

export default App;
