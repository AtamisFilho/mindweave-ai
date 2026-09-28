# MindWeave AI — Roadmap

Estado atual (v0.3.0): aplicação funcional de ponta a ponta com **persistência** — mapas salvos automaticamente em SQLite (documento + índice FTS5), Fricção Zero no boot, resiliência offline. IA de Pesquisa Profunda e Sugestão de Nós via Ollama/OpenAI/Gemini.

## v0.2 — Robustez

- [x] **Contexto hierárquico completo** ✅ v0.2 — implementado como **DAG**: as arestas do React Flow são a fonte única de verdade da hierarquia (cross-links permitidos, ciclos rejeitados, `parentId` restou como cache de posicionamento); `getAncestorContext` faz BFS pais-first com dedup
- [x] **Painel "research"** ✅ v0.2 — painel híbrido: segue o "último nó pesquisado" (não a seleção do canvas), com pin 📍 para travar contexto, visão "Este nó"/"Todas", Markdown (react-markdown + remark-gfm + typography), copiar, tombstone para nós removidos e empty states
- [x] **Erros estruturados** ✅ v0.2 — `AIProviderError` + `ErrorCode` estável (`PROVIDER_UNREACHABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_INVALID_KEY`, `MODEL_NOT_FOUND`, `RATE_LIMIT_EXCEEDED`, `KEY_NOT_CONFIGURED`…); payload `{"detail": {error_code, message, provider}}`; frontend normaliza com `extractApiError` e já expõe `aiErrorCode` no store
- [x] **Logging** ✅ v0.2 — `logging` estruturado com metadados (provider/model/ancestrais/tamanho); prompts completos apenas com `LOG_PROMPTS=true` (DEBUG); validado que chave e conteúdo de prompt não aparecem no log
- [x] **Segurança da chave Gemini** ✅ v0.2 — chave no header `x-goog-api-key` (fora da query string)
- [x] **Toasts de feedback** ✅ v0.2 — sonner (tema dark/light, richColors); erros mapeados por `error_code`; `KEY_NOT_CONFIGURED` com ação "Abrir Configurações" que abre a aba e foca+destaca o campo da chave correta
- [x] **Testes** ✅ v0.2 — 25 backend (pytest + respx: mapeamento de erros, parsing, contexto no prompt, chave no header) · 21 frontend (Vitest + Testing Library: DAG/ciclos/ancestrais no store, markdown do painel) · 4 E2E (Playwright com rotas mockadas: pesquisa+markdown, DAG via "Adicionar Filho", sugestões, sanity drag)
- [x] **CI** ✅ v0.2 — GitHub Actions com cache pip/npm: backend (ruff + pytest) · frontend (eslint + vitest + build) · E2E (Playwright + artefatos de trace em falha)

### v0.3 — Persistência (SQLite) ✅ v0.3.0

- [x] **Schema Híbrido Invertido**: `maps` (documento JSON canônico + `version` para concorrência otimista) + `node_index` FTS5 derivado, reconstruído na transação do save
- [x] **API `/api/v1/maps`**: CRUD + `/last` (Fricção Zero) + `/search` (FTS5, caixa/acento-insensível) + 409 `MAP_VERSION_CONFLICT`
- [x] **Autosave** com debounce de 1s + Ctrl/Cmd+S imediato + indicador no header (Salvando…/Salvo há Xs/Offline/Conflito)
- [x] **Fricção Zero**: boot carrega o último mapa ou cria "Mapa sem título" sem UI; menu discreto "Mapas" no header (Novo/Renomear inline/Busca/Excluir com Undo de 5s)
- [x] **Resiliência offline**: snapshot em `localStorage`, indicador com botão Sincronizar, replay no bootstrap/'online'/focus, conflito 409 com "Manter do servidor"
- [x] **E2Es de persistência** contra backend real: cria→recarrega, autosave sem Ctrl+S, 409 entre duas abas

### v0.2.5 — Extras (pendências leves da v0.2)

- [ ] **Undo/redo** do mapa (Command pattern no store) — adiado da v0.2 por decisão de escopo

## v0.4 — IA avançada

- [ ] **Gerar mapa inteiro a partir de um tópico** (não só expandir nós)
- [ ] **Chat com o mapa**: perguntas sobre o conteúdo do grafo
- [ ] **Resumo do mapa completo** (percurso hierárquico → LLM)
- [ ] **Streaming** das respostas (SSE) com exibição progressiva
- [ ] Seleção múltipla de nós → expandir vários de uma vez
- [ ] Configuração de modelo por requisição na UI (hoje só via store do Ollama)

### v0.5 — Layout Engine (esquemas estilo niMind) — ver [docs/design/layout-engine.md](docs/design/layout-engine.md)

- [ ] **Motor de posicionamento** (dagre na v1; interface pronta para elkjs) — movido da v1.0
- [ ] Direções Up/Down/Left/Right + **balanceadas Left-Right/Up-Down** (partição de subárvores + espelhamento)
- [ ] **9 esquemas visuais** = estilo de aresta (curved/direct/cornered) × densidade (tree/list compacta)
- [ ] UI: popover no canvas com direções + mini-SVGs + botão "Auto-organizar" + toggle "Auto"
- [ ] `document.meta.layout` persistido por mapa; Free-form congela posições; Undo de 1 clique
- [ ] Escrita de posições sempre via `applyLayoutPositions` (preparado para o undo da v0.2.5)

## v1.0 — Escala

- [ ] Export do mapa: PNG, Markdown (outline), OPML
- [ ] Compartilhamento por link (mapas somente leitura)
- [ ] Multiusuário: Postgres + autenticação (OAuth/e-mail)
- [ ] Docker Compose (frontend + backend + Ollama opcional)
- [ ] Armazenamento seguro e persistente de chaves de API no backend
