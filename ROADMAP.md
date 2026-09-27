# MindWeave AI — Roadmap

Estado atual (v0.1): aplicação funcional de ponta a ponta — edição de mapa mental com Pesquisa Profunda e Sugestão de Nós via Ollama/OpenAI/Gemini. Sem persistência: o mapa vive apenas em memória no navegador.

## v0.2 — Robustez

- [x] **Contexto hierárquico completo** ✅ v0.2 — implementado como **DAG**: as arestas do React Flow são a fonte única de verdade da hierarquia (cross-links permitidos, ciclos rejeitados, `parentId` restou como cache de posicionamento); `getAncestorContext` faz BFS pais-first com dedup
- [x] **Painel "research"** ✅ v0.2 — painel híbrido: segue o "último nó pesquisado" (não a seleção do canvas), com pin 📍 para travar contexto, visão "Este nó"/"Todas", Markdown (react-markdown + remark-gfm + typography), copiar, tombstone para nós removidos e empty states
- [x] **Erros estruturados** ✅ v0.2 — `AIProviderError` + `ErrorCode` estável (`PROVIDER_UNREACHABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_INVALID_KEY`, `MODEL_NOT_FOUND`, `RATE_LIMIT_EXCEEDED`, `KEY_NOT_CONFIGURED`…); payload `{"detail": {error_code, message, provider}}`; frontend normaliza com `extractApiError` e já expõe `aiErrorCode` no store
- [x] **Logging** ✅ v0.2 — `logging` estruturado com metadados (provider/model/ancestrais/tamanho); prompts completos apenas com `LOG_PROMPTS=true` (DEBUG); validado que chave e conteúdo de prompt não aparecem no log
- [x] **Segurança da chave Gemini** ✅ v0.2 — chave no header `x-goog-api-key` (fora da query string)
- [x] **Toasts de feedback** ✅ v0.2 — sonner (tema dark/light, richColors); erros mapeados por `error_code`; `KEY_NOT_CONFIGURED` com ação "Abrir Configurações" que abre a aba e foca+destaca o campo da chave correta
- [x] **Testes** ✅ v0.2 — 25 backend (pytest + respx: mapeamento de erros, parsing, contexto no prompt, chave no header) · 21 frontend (Vitest + Testing Library: DAG/ciclos/ancestrais no store, markdown do painel) · 4 E2E (Playwright com rotas mockadas: pesquisa+markdown, DAG via "Adicionar Filho", sugestões, sanity drag)
- [x] **CI** ✅ v0.2 — GitHub Actions com cache pip/npm: backend (ruff + pytest) · frontend (eslint + vitest + build) · E2E (Playwright + artefatos de trace em falha)

### v0.2.5 — Extras (pendências leves da v0.2)

- [ ] **Undo/redo** do mapa (Command pattern no store) — adiado da v0.2 por decisão de escopo

## v0.3 — Persistência (SQLite)

- [ ] SQLAlchemy + SQLite no backend FastAPI
- [ ] API `/api/v1/maps`: CRUD de mapas (nodes/edges serializados em JSON)
- [ ] UI: salvar/carregar/renomear/excluir múltiplos mapas
- [ ] Autosave local (debounce) + recuperação ao reabrir

## v0.4 — IA avançada

- [ ] **Gerar mapa inteiro a partir de um tópico** (não só expandir nós)
- [ ] **Chat com o mapa**: perguntas sobre o conteúdo do grafo
- [ ] **Resumo do mapa completo** (percurso hierárquico → LLM)
- [ ] **Streaming** das respostas (SSE) com exibição progressiva
- [ ] Seleção múltipla de nós → expandir vários de uma vez
- [ ] Configuração de modelo por requisição na UI (hoje só via store do Ollama)

## v1.0 — Escala

- [ ] Export do mapa: PNG, Markdown (outline), OPML
- [ ] Compartilhamento por link (mapas somente leitura)
- [ ] Multiusuário: Postgres + autenticação (OAuth/e-mail)
- [ ] Docker Compose (frontend + backend + Ollama opcional)
- [ ] Layout automático de árvores (dagre/elk)
- [ ] Armazenamento seguro e persistente de chaves de API no backend
