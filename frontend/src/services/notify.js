import { toast } from 'sonner';

/**
 * Mapeia o error_code estável do backend para toasts do sonner.
 * `onOpenConfig` é chamado para erros de chave ausente — leva o usuário
 * direto ao campo correto no painel de configurações.
 */
export const notifyAiError = ({ code, message, trail } = {}, { onOpenConfig } = {}) => {
  if (code === 'ALL_PROVIDERS_FAILED') {
    // Trilha resumida: um provedor:motivo por linha (o "por quê" de cada falha)
    const lines = (trail ?? [])
      .map((t) => `• ${t.provider}: ${t.message || (t.kind === 'RATE_LIMIT' ? 'rate limit' : t.kind === 'QUOTA_EXHAUSTED' ? 'quota esgotada' : t.kind === 'NETWORK_ERROR' ? 'não respondeu' : 'falhou')}`)
      .join('\n');
    toast.error('IA indisponível', {
      description: `${message}${lines ? `\n${lines}` : ''}`,
      duration: 12000,
      action: onOpenConfig
        ? { label: 'Abrir Configurações', onClick: onOpenConfig }
        : undefined,
    });
    return;
  }
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
