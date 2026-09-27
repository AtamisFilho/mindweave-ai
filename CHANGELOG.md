# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [0.2.0] — 2026-09-27

### Adicionado
- **Hierarquia como DAG**: cross-links (nó com múltiplos pais) suportados; as arestas do canvas são a fonte única de verdade da hierarquia e ciclos são rejeitados na conexão. O contexto enviado à IA percorre o grafo em BFS (pais-first, sem duplicatas).
- **Painel de Pesquisas**: histórico das pesquisas de IA em Markdown (react-markdown + remark-gfm + typography), seguindo o "último nó pesquisado" (não a seleção do canvas), com pin 📍 para travar o contexto, visão "Este nó"/"Todas", copiar, tombstone para nós removidos e empty states.
- **Toasts interativos (sonner)**: erros de IA mapeados por `error_code`; `KEY_NOT_CONFIGURED` oferece a ação "Abrir Configurações", que abre a aba de configuração, troca para o provedor indicado e foca/destaca o campo da chave correta.
- **Testes e CI**: 25 testes backend (pytest + respx), 21 unitários frontend (Vitest + Testing Library), 4 cenários E2E (Playwright, backend mockado via `page.route`) e GitHub Actions com cache de pip/npm (ruff + pytest · eslint + vitest + build · Playwright).

### Corrigido
- Backend não inicializava (`typing.List`/`Optional` sem import) — crash no import.
- CORS liberava apenas a porta 3000; agora cobre a 5173 do Vite — toda chamada do frontend era bloqueada.
- Build do CSS com Tailwind v4 instalado e configuração de v3; dark mode por classe agora funciona (`@custom-variant`).
- Loop infinito de re-render: seletores Zustand retornando objeto novo a cada chamada (agora com `useShallow`).
- `ReferenceError` em "Pesquisa IA" (`setActivePanel` fora de escopo) que travava o loading para sempre.
- Aresta do nó filho era descartada no React Flow v12 (nó e aresta agora criados atomicamente).
- **Nó filho nascia sob o painel de ações do pai selecionado** (sobreposição revelada pelo E2E): filhos agora nascem à direita do pai — o mapa cresce horizontalmente.

### Segurança
- Chave do Gemini movida da query string para o header `x-goog-api-key`.
- Logging sanitizado: prompts completos apenas com `LOG_PROMPTS=true` (DEBUG); chaves e conteúdo de prompt nunca aparecem nos logs.
- Timeouts de rede: 60s totais / 10s de conexão, com código de erro dedicado (`PROVIDER_TIMEOUT`).
- Erros estruturados `{"detail": {error_code, message, provider}}` substituem o controle de fluxo por strings `"Error:"`.

### Mudado
- `reactflow` v11 → `@xyflow/react` v12 (suporte nativo a React 19); Tailwind v3 → v4 (`@tailwindcss/vite`).

## [0.1.0] — 2026-09-27

### Adicionado
- Editor de mapas mentais (React Flow): criar/editar/conectar/remover nós, minimap, zoom/pan.
- Integração com IA via 3 provedores configuráveis pela UI: Ollama (local), OpenAI e Google Gemini.
- Pesquisa Profunda com contexto hierárquico dos nós pais e Sugestão automática de sub-nós.
