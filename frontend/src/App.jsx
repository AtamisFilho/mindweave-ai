import React, { useEffect, useState, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from './store/mindMapStore';
import Button from './components/UI/Button';
import Modal from './components/UI/Modal';
// import './App.css'; // Specific App.css can be added if needed for App layout

// Lazy load components for better initial load time
const MindMapCanvas = React.lazy(() => import('./components/MindMap/MindMapCanvas'));
const AISettingsPanel = React.lazy(() => import('./components/AISettings/AISettingsPanel'));


function App() {
  const {
    activePanel,
    setActivePanel,
    aiLoading,
    aiError,
    researchResult,
    clearResearchError,
    clearResearchResult
  } = useMindMapStore(useShallow((state) => ({
    activePanel: state.activePanel,
    setActivePanel: state.setActivePanel,
    aiLoading: state.aiLoading,
    aiError: state.aiError,
    researchResult: state.researchResult,
    clearResearchError: state.clearResearchError,
    clearResearchResult: state.clearResearchResult,
  })));

  const [isResearchModalOpen, setIsResearchModalOpen] = useState(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  // Basic dark mode toggle state - can be moved to Zustand store for persistence
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('darkMode') === 'true' || 
             (!('darkMode' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (darkMode) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('darkMode', 'true');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('darkMode', 'false');
      }
    }
  }, [darkMode]);

  useEffect(() => {
    if (researchResult) {
      setIsResearchModalOpen(true);
    }
  }, [researchResult]);

  useEffect(() => {
    if (aiError) {
      setIsErrorModalOpen(true);
    }
  }, [aiError]);

  const closeResearchModal = () => {
    setIsResearchModalOpen(false);
    // Delay clearing to allow modal to fade out if animations are tied to researchResult
    setTimeout(clearResearchResult, 300); 
  };

  const closeErrorModal = () => {
    setIsErrorModalOpen(false);
    setTimeout(clearResearchError, 300);
  };
  
  const researchNode = researchResult ? useMindMapStore.getState().nodes.find(n => n.id === researchResult.nodeId) : null;

  const toggleDarkMode = () => setDarkMode(!darkMode);

  const LoadingFallback = ({text = "Carregando componente..."}) => (
    <div className="flex items-center justify-center h-full w-full p-4 text-gray-500 dark:text-gray-400 text-sm">
      {text}
    </div>
  );

  return (
    <div className={`flex flex-col h-screen antialiased text-gray-800 dark:text-gray-200 ${darkMode ? 'dark' : ''}`}>
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
                    <li>Use os controles no canto para zoom e pan.</li>
                    <li>Clique "Adicionar Nó Raiz" para iniciar um novo mapa.</li>
                </ul>
              </div>
            )}
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

      <Modal
        isOpen={isResearchModalOpen}
        onClose={closeResearchModal}
        title={`Pesquisa para: ${researchNode?.data.label || 'Nó'}`}
        footerContent={<Button onClick={closeResearchModal} variant="primary" className="text-sm py-1.5">Fechar</Button>}
        size="lg"
      >
        <div className="text-sm whitespace-pre-wrap p-2 bg-gray-50 dark:bg-gray-700 rounded max-h-[50vh] overflow-y-auto">
          {researchResult?.summary}
        </div>
      </Modal>

      <Modal
        isOpen={isErrorModalOpen}
        onClose={closeErrorModal}
        title="Erro da IA"
        footerContent={<Button onClick={closeErrorModal} variant="danger" className="text-sm py-1.5">Fechar</Button>}
      >
        <p className="text-sm text-red-500 dark:text-red-400 p-2 bg-red-50 dark:bg-red-900 rounded">{aiError}</p>
      </Modal>
    </div>
  );
}

export default App;
