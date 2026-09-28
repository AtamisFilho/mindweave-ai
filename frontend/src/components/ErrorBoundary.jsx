import React from 'react';

/**
 * Captura crashes de renderização (ex.: conteúdo inesperado vindo de um LLM)
 * e exibe um fallback em vez de derrubar a aplicação inteira.
 *
 * `fallback` é uma função (error) => ReactNode. Sem ela, retorna null.
 * Passe `resetKey` para limpar o estado de erro quando o valor mudar
 * (ex.: trocar de entrada no histórico de pesquisas).
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error);
      }
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
