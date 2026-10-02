# MindWeave AI — Roadmap

Estado atual (v0.4.0): **IA sempre-disponível** — cadeia de 8 provedores com fallback automático, chaves criptografadas, UI de configuração da cadeia. Somado ao que já existia: layout engine (dagre balanceado estilo niMind), persistência SQLite com autosave/offline/busca FTS5, DAG com cross-links.

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

### v0.4 — Provider Chain (fundação de IA) ✅ v0.4.0 — ver [docs/design/provider-chain.md](docs/design/provider-chain.md)

- [x] **8 provedores** com adaptadores próprios (sem LiteLLM): OpenAI-compatible cobre Groq/OpenRouter/Cerebras/DeepSeek/OpenAI/LM Studio; Gemini e Ollama nativos
- [x] **Chain executor**: fallback automático, cooldowns por tipo (Retry-After respeitado), trilha de fallbacks na resposta
- [x] **Chaves criptografadas** (Fernet + api_keys) com migração automática do .env; fonte única (globais em memória eliminados)
- [x] **Classificação fina de erros** (8 tipos) — quota ≠ rate limit ≠ chave ≠ contexto
- [x] **UI da Cadeia** (ordem ▲▼, toggles, Testar conexão, modelos locais, Resetar) + badge no header com fallback
- [x] 'Configuração de modelo por requisição' — **subsumido**: cada provedor da cadeia carrega seu modelo

## v0.4.5 — Experiência de IA ✅ v0.4.5 — ver [docs/design/ai-experience.md](docs/design/ai-experience.md)

- [x] **Streaming** das respostas (SSE) com a trilha de fallbacks em tempo real ('tentando groq… → gemini…')
- [x] **Chat com o mapa**: perguntas sobre o conteúdo do grafo
- [x] **Gerar mapa inteiro a partir de um tópico** (não só expandir nós)
- [x] **Resumo do mapa completo** (reusa o chat com pergunta fixa — resposta na aba Chat)
- [x] **Drag-and-drop na cadeia** (dnd-kit, +15KB gzip; ▲▼ permanece acessível)
- [x] Seleção múltipla de nós → expandir vários de uma vez (`/ai/suggest-nodes-batch`, asyncio.gather)

### v0.5 — Layout Engine (esquemas estilo niMind) ✅ v0.5.0 — ver [docs/design/layout-engine.md](docs/design/layout-engine.md)

- [x] **Motor de posicionamento** (dagre na v1; interface pronta para elkjs) — movido da v1.0
- [x] Direções Up/Down/Left/Right + **balanceadas Left-Right/Up-Down** (partição de subárvores por peso + espelhamento)
- [x] **9 esquemas visuais** = estilo de aresta (curved/direct/cornered) × densidade (tree/list compacta)
- [x] UI: popover no canvas com direções + mini-SVGs + botão "Auto-organizar" + toggle "Auto"
- [x] Posições + estilo persistidos no documento (`meta.layout`); Free-form congela; Undo escopado
- [x] Escrita de posições sempre via `applyLayoutPositions` (preparado para o undo/redo da v0.2.5)

## v0.6 — Consolidação & Dogfooding — ver [docs/design/v0.6-consolidation.md](docs/design/v0.6-consolidation.md)

Primeiro usuário real por 3–4 semanas, com log de fricções (`docs/dogfooding/log.md`).
Escala só depois: a v1.0 é reavaliada pelo que o uso provar.

- [x] **Undo/redo** do mapa (snapshots estruturais, teto 50; Ctrl+Z/Ctrl+Shift+Z + botões; drag = 1 entrada; a v0.2.5 que nunca aconteceu) — v0.6.0 B1
- [x] **Export Markdown** (a mesma travessia do contexto do chat; cross-links em todos os ramos; sem teto de profundidade) — v0.6.0 B2
- [x] **Diário de pesquisas persistido** (`meta.research`, teto 40 — sobrevive ao F5; promovido à v0.6.0 pelo orquestrador) — v0.6.0 B2.5
- [x] **Enter/Tab — continuidade de edição** (filho/irmão com corrente de foco; Tab na raiz = outra raiz; portão disparou: B1+B2+B2.5 fecharam sem drift) — v0.6.0 B3
- [ ] Export OPML — v0.6.1
- [ ] **Micro-releases v0.6.x** alimentadas pelo log de fricções (candidatas remanescentes: Ctrl+F localizar nó, duplicar mapa como checkpoint)
- [ ] Veredito do dogfooding: o que da v1.0 se confirma, muda ou morre

## v1.0 — Escala (após validação por uso real — v0.6)

- [ ] Export do mapa: PNG (Markdown/OPML antecipados para a v0.6)
- [ ] Compartilhamento por link (mapas somente leitura)
- [ ] Multiusuário: Postgres + autenticação (OAuth/e-mail)
- [ ] Docker Compose (frontend + backend + Ollama opcional)
- [ ] Armazenamento seguro e persistente de chaves de API no backend
