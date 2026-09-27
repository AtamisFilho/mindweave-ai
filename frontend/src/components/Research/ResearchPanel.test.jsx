import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResearchPanel from './ResearchPanel';
import useMindMapStore from '../../store/mindMapStore';

// Fixture com a formatação típica de resposta de LLM — guarda a renderização
// de react-markdown + remark-gfm ao longo do tempo (Diretriz 2 do Bloco 4).
const MD_FIXTURE = [
  '## Machine Learning — resumo',
  '',
  '**Machine Learning** é um subcampo da *inteligência artificial*:',
  '',
  '- **Supervisionado**: regressão e classificação',
  '- **Não supervisionado**: clustering',
  '',
  '| Paradigma | Exemplo | Uso típico |',
  '|---|---|---|',
  '| Supervisionado | Random Forest | Predição |',
  '| Não supervisionado | DBSCAN | Segmentação |',
].join('\n');

const root = { id: 'root', type: 'custom', data: { label: 'Raiz', parentId: null, isRoot: true, isNew: false }, position: { x: 0, y: 0 } };

beforeEach(() => {
  useMindMapStore.setState({
    nodes: [root],
    edges: [],
    researchHistory: [],
    researchPanelNodeId: null,
    researchPanelPinned: false,
    activePanel: 'research',
  });
});

describe('ResearchPanel', () => {
  it('mostra empty state quando não há pesquisas', () => {
    render(<ResearchPanel />);
    expect(screen.getByText('Nenhuma pesquisa para este nó ainda')).toBeInTheDocument();
    expect(screen.getByText(/Pesquisa IA/)).toBeInTheDocument();
  });

  it('renderiza markdown: heading, lista e tabela GFM', () => {
    useMindMapStore.setState({
      researchHistory: [{ id: 'r1', nodeId: 'root', summary: MD_FIXTURE, createdAt: Date.now() }],
      researchPanelNodeId: 'root',
    });
    render(<ResearchPanel />);
    // Heading vira <h2> com typography plugin
    expect(screen.getByRole('heading', { name: 'Machine Learning — resumo' })).toBeInTheDocument();
    // Lista com marcadores (texto quebrado em <strong> exige matcher funcional)
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === 'LI' && el.textContent === 'Supervisionado: regressão e classificação')
    ).toBeInTheDocument();
    // Tabela GFM
    expect(screen.getByRole('columnheader', { name: 'Paradigma' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Random Forest' })).toBeInTheDocument();
  });

  it('botão copiar grava o texto bruto no clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    useMindMapStore.setState({
      researchHistory: [{ id: 'r1', nodeId: 'root', summary: MD_FIXTURE, createdAt: Date.now() }],
      researchPanelNodeId: 'root',
    });
    render(<ResearchPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await screen.findByRole('button', { name: 'Copiado!' });
    expect(writeText).toHaveBeenCalledWith(MD_FIXTURE);
  });

  it('pin alterna o estado no store', () => {
    useMindMapStore.setState({ researchPanelNodeId: 'root' });
    render(<ResearchPanel />);
    fireEvent.click(screen.getByTitle(/Fixar/));
    expect(useMindMapStore.getState().researchPanelPinned).toBe(true);
    fireEvent.click(screen.getByTitle(/soltar/i));
    expect(useMindMapStore.getState().researchPanelPinned).toBe(false);
  });

  it('nó removido mostra tombstone e preserva o texto', () => {
    useMindMapStore.setState({
      researchHistory: [{ id: 'r1', nodeId: 'fantasma', summary: 'Texto preservado', createdAt: Date.now() }],
      researchPanelNodeId: 'fantasma',
    });
    render(<ResearchPanel />);
    expect(screen.getByText('(nó removido)')).toBeInTheDocument();
    expect(screen.getByText(/foi removido do mapa/)).toBeInTheDocument();
  });
});
