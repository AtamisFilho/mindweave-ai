import { toast } from 'sonner';

/**
 * Mapeia o error_code estável do backend para toasts do sonner.
 * `onOpenConfig` é chamado para erros de chave ausente — leva o usuário
 * direto ao campo correto no painel de configurações.
 */
export const notifyAiError = ({ code, message, provider } = {}, { onOpenConfig } = {}) => {
  if (code === 'KEY_NOT_CONFIGURED') {
    toast.error('Chave de API necessária', {
      description: message,
      duration: 10000,
      action: onOpenConfig
        ? { label: 'Abrir Configurações', onClick: onOpenConfig }
        : undefined,
    });
    return;
  }
  if (code === 'PROVIDER_UNREACHABLE' || code === 'PROVIDER_TIMEOUT') {
    toast.error(message, {
      description: 'Confira se o serviço de IA está acessível e tente novamente.',
      duration: 8000,
    });
    return;
  }
  if (code === 'RATE_LIMIT_EXCEEDED') {
    toast.warning(message, { duration: 8000 });
    return;
  }
  if (code === 'NODE_NOT_FOUND') {
    toast.error(message || 'Nó não encontrado.');
    return;
  }
  toast.error(message || 'Falha na chamada de IA.');
};
