import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// O React loga o erro capturado no console — silencia para a saída do teste
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const Bomb = () => {
  throw new Error('componente explodiu');
};

describe('ErrorBoundary global', () => {
  it('(a) child que lança → fallback com o botão Recarregar', () => {
    render(
      <ErrorBoundary
        fallback={() => (
          <div>
            <p>Algo deu errado na interface</p>
            <button onClick={() => window.location.reload()}>Recarregar</button>
          </div>
        )}
      >
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Algo deu errado na interface')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument();
  });

  it('children saudáveis passam ilesos', () => {
    render(
      <ErrorBoundary fallback={() => <p>falhou</p>}>
        <p>conteúdo seguro</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('conteúdo seguro')).toBeInTheDocument();
    expect(screen.queryByText('falhou')).not.toBeInTheDocument();
  });

  it('resetKey mudando limpa o erro e volta a renderizar os filhos', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey={1} fallback={() => <p>falhou</p>}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('falhou')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey={2} fallback={() => <p>falhou</p>}>
        <p>conteúdo seguro</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('conteúdo seguro')).toBeInTheDocument();
  });
});
