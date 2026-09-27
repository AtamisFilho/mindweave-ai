import React, { useEffect, useState, Suspense } from 'react';
import { Toaster } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from './store/mindMapStore';
import Button from './components/UI/Button';

// Lazy load components for better initial load time
const MindMapCanvas = React.lazy(() => import('./components/MindMap/MindMapCanvas'));
const AISettingsPanel = React.lazy(() => import('./components/AISettings/AISettingsPanel'));
const ResearchPanel = React.lazy(() => import('./components/Research/ResearchPanel'));

function App() {
  const {
    activePanel,
    setActivePanel,
    darkMode,
    toggleDarkMode,
    aiLoading,
  } = useMindMapStore(useShallow((state) => ({
    activePanel: state.activePanel,
    setActivePanel: state.setActivePanel,
    darkMode: state.darkMode,
    toggleDarkMode: state.toggleDarkMode,
    aiLoading: state.aiLoading,
  })));

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
    <div className="flex flex-col h-screen antialiased text-gray-800 dark:text-gray-200">
      <header className="bg-gray-700 dark:bg-gray-900 text-white p-3 shadow-md flex justify-between items-center print:hidden">
        <h1 className="text-xl font-semibold">MindWeave AI</h1>
        <Button onClick={toggleDarkMode} variant="ghost" className="text-sm px-2! py-1!">
          {darkMode ? 'Modo Claro' : 'Modo Escuro'}
        </Button>
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
            {activePanel === 'config' && <AISettingsPanel />}
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
  );
}

export default App;
