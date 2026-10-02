# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [0.6.1] — 2026-10-03

### Adicionado (micro-release "Onboarding de provedores locais" — fricção #1 do log, severidade alta)

- **Status vivo dos servidores locais** (LM Studio e Ollama): probe ao abrir a aba IA Config + botão "Verificar locais"; chip **"● no ar" / "○ servidor fora"** em cada linha da cadeia e no cartão novo. No "fora", o chip abre os 3 passos em pt-BR para ligar (LM Studio: Developer ▸ Start Server; Ollama: `ollama serve`). O app detecta "servidor respondendo", nunca "instalado" — e o texto ensina isso.
- **Cartão "LM Studio (local)"** nas Configurações de IA (espelho do do Ollama): URL Base (default `http://localhost:1234/v1`, editável e persistida) + Modelo como SELECT populado pelo servidor; com o servidor fora, vira texto livre. 
- **Helper de primeira execução**: nenhum local no ar e nenhuma chave configurada → painel "Como ativar a IA em 2 minutos" com os dois caminhos locais (LM Studio ou Ollama — sem chave de nuvem) e botão "Verificar de novo".
- **📋 virou "listar E selecionar"**: na linha da cadeia, os locais ganham dropdown de modelos que **persiste na hora** (`provider_chain.model`) e passa a ser o modelo usado nas chamadas.

### Corrigido — o diagnóstico da fricção (o 📋 nunca funcionou; eram TRÊS bugs empilhados)

1. **Rota no mount errado**: a listagem vivia em `/api/v1/ai/chain/models/{provider}` enquanto o frontend SEMPRE chamou `/api/v1/ai/models/{provider}` → **404 desde a v0.4**. Movida para o mount correto.
2. **Caminho duplicado**: para LM Studio o handler montava `{base}/v1/models` com `base` já terminando em `/v1` → `/v1/v1/models`, inexistente. Corrigido (e o caminho agora honra o `base_url` configurado).
3. **`provider_chain.model` era ignorado**: o `execute_chain` (REST e stream) só usava `model` da requisição (para o preferred) ou o `default_model` do adapter — para LM Studio, **`"local-model"`**, um placeholder que o servidor real rejeita. Agora o modelo por provedor da cadeia vence o default (request do preferred continua em cima), e a `base_url` da cadeia sobrescreve a do adapter (parâmetro novo `base_url` em `complete`/`complete_stream`).

### Técnico
- Coluna nova `provider_chain.base_url` (migração idempotente no boot); `save_chain_config` preserva a `base_url` anterior quando a entrada omite (o save da UI comum não apaga a configuração do cartão).
- mock_upstream serve `/v1/models` e `/api/tags` (respeita `mode=down`) e **ecoa o modelo recebido** no texto (`[model=...]`) — é assim que o E2E prova que a seleção chegou à chamada.
- Correção no próprio mock: `mode=down` agora é checado ANTES do `/control` não ficar — `/control` volta a ser o primeiro branch (servidor "fora" continuava controlável).

### Testes
- Backend: 127 → **134** pytest (persistência/preservação de `base_url`, modelo da cadeia usado na chamada, `base_url` usada na chamada, list_models caminho correto + override + 503).
- Frontend: 96 → **100** vitest (probe up/down, persistChainEntry preservando os demais, falha sem corromper) + **3 E2E** (`onboarding.spec.js`: no ar → seleção usada de verdade; fora → chip+instruções+helper; recuperação → helper some).

## [0.6.0] — 2026-10-02

## [0.6.0] — 2026-10-02## [0.4.5] — 2026-10-02

### Adicionado (épico Experiência de IA — ver docs/design/ai-experience.md)

- **Streaming SSE ponta a ponta (B1)**: `deep-research/stream` e `chat/stream` com eventos `chain/token/done/error`, heartbeat `: ping` a cada 15s, commit-point (fallback só antes do primeiro token; depois `PROVIDER_STREAM_INTERRUPTED` com retry no cliente). Parser SSE incremental no frontend sobrevive a fronteiras de chunk do TCP; buffer de renderização (flush 50ms); linha de status viva da cadeia no painel de Pesquisas — que agora abre junto com a pesquisa. 8/8 adaptadores com `supports_stream` (Gemini via `alt=sse` com parser próprio; Ollama NDJSON; OpenAI-compatible com sentinel `[DONE]` — fim sem sentinel = truncamento).
- **Chat com o mapa (B2)**: aba Chat com RAG (`context_builder`: outline completo vs retrieval FTS5 bm25 + ancestrais nearest-first), histórico das últimas 10 trocas no prompt, persistência em `meta.chat` (teto de 40) e transparência — cada resposta mostra estratégia/nós incluídos/caracteres do contexto.
- **Gerar mapa a partir de um tópico (B3)**: `POST /ai/generate` (cadeia + parse JSON robusto + 1 retry de parse no mesmo provedor), modal com profundidade/largura, conversão `treeToGraph`, mapa NOVO não-destrutivo com toast "Voltar ao anterior".
- **Resumir mapa (B4)**: botão no menu Mapas reusa o chat/stream com pergunta fixa — abre a aba Chat, resposta em streaming, toast "Resumo gerado na aba Chat". Zero endpoints/UI novos.
- **Expansão em lote (B4)**: selecione até 5 nós (Ctrl+clique) → "Expandir N nós com IA" no último selecionado → `POST /ai/suggest-nodes-batch` (`{map_id, node_ids}`) com `asyncio.gather` em paralelo; falha de um nó não derruba o lote (`error_code` por nó); inserção via o mesmo `addNode` atômico. Sem streaming (REST da v0.4 — evolução futura).
- **Drag-and-drop na cadeia (B4)**: reordenação por handle ⠿ com @dnd-kit (+15KB gzip, dentro do orçamento de 50KB); botões ▲▼ permanecem como fallback de acessibilidade; persistência segue no "Salvar cadeia".

### Corrigido

- **Dívida do B3**: o commit B3 trouxe só o frontend da geração de mapa — backend (`/ai/generate` + `generation_service`), ação `generateMap` no store, `generateMapApi` e o import do modal no MapsMenu não foram portados (o E2E de geração nunca passou de verdade). Portados e cobertos por testes.
- **Pesquisa concorrente**: uma nova pesquisa aborta a anterior (AbortController); a suplantada termina em silêncio sem tocar em `streamState`/`aiLoading` — antes, dois streams simultâneos produziam resumo vazio.
- **E2Es**: `generate.spec` esperava 4 nós/3 arestas (incompatível com o próprio fixture — o `treeToGraph` mantém todos os níveis: 6/5) e não limpava mapas herdados; `stream.spec` clicava o retry por coordenadas (corrida com o toast animando disparava uma 2ª pesquisa).

### Testes
- Backend: 87 → **121** pytest (parser SSE Gemini, poda do chat, batch com falha isolada, geração com parse adversarial).
- Frontend: 50 → **66** vitest (orquestração do stream, chat, resumo, lote, seleção múltipla).
- E2E: 19 → **25** Playwright (stream vivo/interrupção-retry, chat RAG, geração, resumo, lote, dnd da cadeia).

## [0.4.0] — 2026-09-29

### Adicionado (épico Provider Chain — ver docs/design/provider-chain.md)

- **IA sempre-disponível**: 8 provedores com adaptadores próprios (Groq, Gemini, OpenRouter, Cerebras, DeepSeek, OpenAI, Ollama, LM Studio — 6 deles via uma classe OpenAI-compatible); chain executor com fallback automático, cooldowns por tipo (RateLimit 30s / Quota via Retry-After ou 1h) e trilha de fallbacks na resposta (`provider_used` + `fallback_trail`).
- **Chaves criptografadas em repouso**: tabela `api_keys` (Fernet), master key de `ENCRYPTION_SECRET` ou auto-gerada; migração automática das chaves do .env no primeiro boot; endpoints CRUD sem jamais ecoar o material.
- **Classificação fina de 8 tipos de erro** (quota, rate limit, chave inválida, modelo inexistente, contexto estourado, rede, erro do provedor, desconhecido) — incluindo a pegadinha do Gemini responder chave inválida com 400 e o 402 de créditos do OpenRouter/DeepSeek.
- **UI da Cadeia** (aba IA Config): ordem com ▲▼, toggles com mínimo 1 habilitado, 'Testar conexão' com latência, listagem de modelos locais, Resetar padrão; **badge no header** com 'Usando: X', '(fallback)' pós-rotação e 'IA indisponível'.
- **Toasts com trilha**: ALL_PROVIDERS_FAILED (503) mostra o motivo de cada provedor tentado.
- **Testes**: +30 no backend (74→87: adapters, chain, config, cripto) e 6 E2Es novos (3 de API da cadeia com upstreams mockados controláveis + 3 de UI: reordenar, desabilitar, fallback visível no badge).

### Mudado
- **Select único 'Provedor de IA' removido** (migração B2→B3): a ORDEM DA CADEIA define a prioridade — a UI não envia mais preferred/provider fixo.
- **ai_service.py slim**: virou montagem de prompts/parsing; gerência de chaves 100% em keys_service (tabela criptografada como fonte única — globais em memória eliminados).

### Notas de migração
- Chaves do .env migram sozinhas no primeiro boot (idempotente); cadeia padrão semeada de forma idempotente ([groq, gemini, openrouter, cerebras, deepseek, openai, lmstudio, ollama] — locais por último).
- Quem usava o select único: configure a ordem em IA Config ▸ Cadeia de Provedores.



### Adicionado
- **Chaves de API criptografadas em repouso**: tabela `api_keys` (provider PK + Fernet), master key derivada de `ENCRYPTION_SECRET` (.env) ou auto-gerada em `backend/data/secret.key` (gitignored).
- **Endpoints `/api/v1/ai/keys`**: PUT (upsert), GET (metadados sem material), DELETE. Provedor desconhecido → 400 `UNKNOWN_PROVIDER`.
- **Migração automática v0.3**: chaves de `OPENAI_API_KEY`/`GOOGLE_API_KEY` (.env) vão criptografadas para o banco no startup (idempotente); chaves salvas pela UI também são espelhadas no banco.
- **Testes**: round-trip Fernet, isolamento por provedor, sigilo em logs e respostas (sem o material das chaves).
- **Endpoints na cadeia (v0.4 B2)**: `deep-research`/`suggest-nodes` executam na cadeia com fallback automático; respostas carregam `provider_used` + `fallback_trail` (com `cooldown_until`); campo legado `provider` fixa um provedor sem fallback; todos-falham → 503 `ALL_PROVIDERS_FAILED` com trilha completa.
- **Cooldowns** por tipo (RateLimit 30s / Quota Retry-After ou 1h) + endpoint `POST /ai/keys/reset-cooldowns` (testes/E2E e Sincronizar).
- **E2E da cadeia** (3 cenários) com upstreams mockados controláveis (`tests/mock_upstream.py` nas portas 1234/11434).


## [0.5.0] — 2026-09-28

### Adicionado (épico Layout Engine — ver docs/design/layout-engine.md)

- **Motor de layout automático**: `computeLayout` puro (grafo + schema → posições), determinístico bit a bit, sobre o dagre; tamanhos de nós de `node.measured` com fallback determinístico para não-medidos.
- **Layout balanceado Left-Right/Up-Down** (estilo XMind/niMind): partição gulosa dos filhos da raiz por peso de subárvore + espelhamento do lado A sobre dois dagres LR. Regra de dono: filhos diretos da raiz nunca mudam de lado por cross-link.
- **6 schemas** no seletor: 4 direções (LR/RL/TB/BT) + 2 balanceados; **⚡ Auto-organizar** com transição animada (350ms), `fitView` e respeito a `prefers-reduced-motion`.
- **Presets visuais (grade estilo × densidade)**: curved/direct/cornered × tree/list — mini-SVGs autorais no popover; aplica estilo de aresta em todo o mapa (inclusive arestas novas) e densidade compacta do nó.
- **Free-form**: congela as posições atuais e limpa o estilo; **Auto: ON** reorganiza sozinho após mudanças estruturais (nunca durante drag).
- **Undo escopado**: toast "Layout aplicado — Desfazer" (5s) via `applyLayoutPositions` (snapshot → único comando para o futuro histórico v0.2.5).
- **Persistência**: `document.meta.layout` no blob (schema, edgeType, compact) — layout sobrevive ao reload.
- **Testes**: 20 novos no motor de layout (determinismo, pureza, partição gulosa, fixtures assimétricas, cross-links inter-lados, UD) — 45 unitários no total; E2Es de persistência cobrem layout salvo via reload.

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
