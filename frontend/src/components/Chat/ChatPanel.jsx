import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useMindMapStore from '../../store/mindMapStore';
import Button from '../UI/Button';
import ErrorBoundary from '../ErrorBoundary';

const metaLine = (meta) => {
  if (!meta) return null;
  if (meta.strategy === 'outline') return 'Contexto: mapa completo';
  const n = meta.nodes_included ?? 0;
  return `Contexto: ${n} nó${n === 1 ? '' : 's'} recuperado${n === 1 ? '' : 's'} por busca`;
};

// Aba Chat (v0.4.5 B2): conversa sobre o mapa atual com RAG (context_builder)
// e transparência — cada resposta mostra o que entrou no contexto.
const ChatPanel = () => {
  const {
    chat, chatState, askMap, clearChat,
  } = useMindMapStore(useShallow((state) => ({
    chat: state.chat,
    chatState: state.chatState,
    askMap: state.askMap,
    clearChat: state.clearChat,
  })));
  const [question, setQuestion] = useState('');
  const [copiedIdx, setCopiedIdx] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length, chatState?.text]);

  const submit = (e) => {
    e.preventDefault();
    if (!question.trim() || chatState) return;
    askMap(question); // âncora de foco (focus_node_id) chega com a seleção do canvas no B3
    setQuestion('');
    inputRef.current?.focus();
  };

  const copyAnswer = async (content, index) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(index);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch { /* clipboard indisponível */ }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Chat</h3>
        {chat.length > 0 && (
          <button
            onClick={clearChat}
            className="text-[10px] text-gray-400 hover:text-red-400 px-1"
            title="Limpar a conversa deste mapa"
          >
            🗑 limpar
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
        Pergunte sobre o mapa atual — a resposta considera a estrutura dos nós.
      </p>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px] pr-1">
        {chat.length === 0 && !chatState && (
          <div className="text-center py-6 px-2">
            <div className="text-2xl mb-1" aria-hidden="true">💬</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Converse sobre o seu mapa: &ldquo;o que já explorei sobre X?&rdquo;, &ldquo;resuma este ramo&rdquo;…
            </p>
          </div>
        )}

        {chat.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={
              msg.role === 'user'
                ? 'bg-blue-500 text-white rounded-lg px-2.5 py-1.5 max-w-[85%] text-xs'
                : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 max-w-[85%] text-xs'
            }>
              <div className={msg.role === 'assistant' ? 'whitespace-pre-wrap text-gray-700 dark:text-gray-300' : 'whitespace-pre-wrap'}>
                {msg.content}
              </div>
              {msg.role === 'assistant' && msg.context_meta && (
                <div className="mt-1 pt-1 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-400">
                    {metaLine(msg.context_meta)} · {msg.context_meta.chars ? `${Math.round(msg.context_meta.chars / 100) / 10}k chars` : ''}
                  </span>
                  <button
                    onClick={() => copyAnswer(msg.content, i)}
                    className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
                    title="Copiar resposta"
                  >
                    {copiedIdx === i ? 'copiado!' : 'copiar'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {chatState && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded-lg px-2.5 py-1.5 max-w-[85%] text-xs">
              <p className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
                {chatState.phase === 'committed'
                  ? `✍️ ${chatState.providerLabel}…`
                  : `⛓ ${chatState.providerLabel ?? 'cadeia'}…`}
              </p>
              {chatState.text && (
                <pre className="whitespace-pre-wrap text-gray-600 dark:text-gray-400 mt-1 max-h-32 overflow-hidden">{chatState.text}</pre>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="mt-2 flex gap-1.5">
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={chatState ? 'Respondendo…' : 'Pergunte sobre o mapa…'}
          disabled={!!chatState}
          maxLength={2000}
          className="flex-1 text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-60"
          aria-label="Pergunta para o chat"
        />
        <Button type="submit" variant="primary" disabled={!!chatState || !question.trim()} className="text-xs py-1 px-3 shrink-0">
          Enviar
        </Button>
      </form>
    </div>
  );
};

export default ChatPanel;
