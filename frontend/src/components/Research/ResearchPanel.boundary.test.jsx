import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Payload hostil: o próprio react-markdown "explode" ao renderizar.
// O que está em teste é o NOSSO ErrorBoundary + fallback (texto cru), não a lib.
vi.mock('react-markdown', () => ({
  default: () => {
    throw new Error('markdown hostil explodiu');
  },
}));
vi.mock('remark-gfm', () => ({ default: () => {} }));

const ResearchPanel = (await import('./ResearchPanel')).default;
const useMindMapStore = (await import('../../store/mindMapStore')).default;

const HOSTILE = [
  '![![payload](x)](y) <script>alert(1)</script>',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
].join('\n');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useMindMapStore.setState({
    nodes: [{ id: 'root', type: 'custom', data: { label: 'Raiz', isRoot: true } }],
    edges: [],
    researchHistory: [{ id: 'r1', nodeId: 'root', summary: HOSTILE, createdAt: Date.now() }],
    researchPanelNodeId: 'root',
    researchPanelPinned: false,
    activePanel: 'research',
  });
});

describe('ResearchPanel com markdown hostil (ErrorBoundary dedicado)', () => {
  it('(b) fallback com aviso + texto cru em <pre> — o conteúdo nunca some', () => {
    render(<ResearchPanel />);
    expect(
      screen.getByText('⚠️ Não foi possível renderizar esta pesquisa — exibindo o texto original.'),
    ).toBeInTheDocument();
    // o resumo bruto continua acessível ao usuário dentro de um <pre>
    const pre = screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === HOSTILE);
    expect(pre).toBeInTheDocument();
    // e a UI do painel segue de pé (título e botão copiar presentes)
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });
});
