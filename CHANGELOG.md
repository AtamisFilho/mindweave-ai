# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [0.3.1] — 2026-09-28

### Hardening (auditoria adversarial pré-Layout)

- **Histórico git higienizado pré-publicação**: 6 bancos SQLite removidos de todos os commits com `git-filter-repo` (tags v0.2.0/v0.3.0 reapontadas; backup local mantido em `../mindweave-backup-pre-purge-v0.3.0`; hashes a partir do commit de persistência mudaram). Conteúdo dos bancos era dado de teste — nenhum segredo no histórico (verificado por varredura de padrões).
- **`.gitignore` do backend corrigido**: padrões relativos (`*.db`, `*.db-wal`, `*.db-shm`) — o padrão antigo tinha prefixo `backend/` dentro do próprio `backend/.gitignore` e nunca casava.
- **ErrorBoundary duplo**: global (crash de render → tela amigável com "Recarregar") e dedicado ao painel de Markdown (fallback com o texto cru em `<pre>` — o conteúdo nunca some).
- **Headers de segurança** via middleware: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. HSTS atrás da flag `SECURITY_HSTS` (só com HTTPS).
- **CORS env-driven**: `ALLOWED_ORIGINS` no Settings (default = dev local).
- **a11y**: `aria-label` no textarea de edição do nó; TODO anotado para o `getState()` não-reativo no `CustomNode`.
- **Testes**: `conftest` respeita `DATABASE_URL` externo (`setdefault`) — permite override em CI.

## [0.3.0] — 2026-09-27

### Adicionado
- **Persistência de mapas ("Híbrido Invertido")**: documento JSON como fonte da verdade (formato nativo do frontend, salvo atomicamente) + índice derivado `node_index` (FTS5) reconstruído a cada save — busca global de nós já disponível via `GET /api/v1/maps/search` (caixa/acento-insensível, prefixo).
- **Fricção Zero**: o app abre direto no último mapa editado (`GET /maps/last`); primeiro acesso cria um "Mapa sem título" sem nenhuma UI. Gestão de mapas (Novo, Renomear, Buscar, Excluir) vive num menu discreto no header.
- **Autosave silencioso** com debounce de 1s em qualquer mudança de nós/arestas/título + **Ctrl/Cmd+S** salva imediatamente (toast "Mapa salvo").
- **Concorrência otimista**: coluna `version` — autosave de outra aba recebe 409 `MAP_VERSION_CONFLICT` e o frontend oferece "Recarregar", nunca sobrescrevendo silenciosamente.
- **Resiliência offline**: falha de rede → snapshot automático em `localStorage` + indicador "⚠️ Offline (salvo localmente) — Sincronizar"; replay automático ao voltar a conexão, com alerta de conflito se o mapa mudou no servidor.
- **Título editável inline** no header (Enter salva, Esc cancela).
- **E2Es de persistência** contra backend real: cria→recarrega, autosave sem Ctrl+S, 409 entre duas abas.

### Técnico
- SQLAlchemy 2.0 + SQLite (`PRAGMA foreign_keys=ON`, `journal_mode=WAL`); FTS5 via DDL.
- Padrão de sinal de teste: asserts de save consultam o **servidor** (`/last`), nunca o indicador local (que fica "Salvo" desde o boot).

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
