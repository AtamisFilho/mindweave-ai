# Design Doc — Experiência de IA: Streaming, Chat com o Mapa e Geração (v0.4.5)

**Épico:** v0.4.5 · **Status:** proposta v1 — revisão do Tech Lead pendente
**Branch:** `feature/ai-experience` (a partir de `main` @ v0.4.0)
**Fundação herdada:** `complete_stream` no Protocol dos adapters (stub desde a v0.4), chain executor com classificação fina, FTS5 (`node_index`) como retriever em potencial, toasts por `error_code`.

---

## 1. Decisões de produto

### 1.1 Geração de mapa cria um MAPA NOVO — concordo, com uma consequência que simplifica

Concordo integralmente: **nunca sobrescrever o trabalho atual**. Mas a consequência é mais forte do que "mesclar fica para depois": se a geração cria um mapa novo e navega para ele, o **mapa atual nunca foi tocado** — a necessidade de Undo **dissolve por construção** (non-destructive by construction). O que existe hoje já cobre o arrependimento: excluir o mapa gerado pelo menu "Mapas" tem toast **Desfazer (5s)**. Portanto:

- ~~"Geração = uma ação undoable (padrão applyLayoutPositions)"~~ → **"Geração = não-destrutiva por construção"**. O padrão `applyLayoutPositions` continua reservado para o undo/redo da v0.2.5.
- O mapa novo nasce já salvo (título = tópico da geração, via `createNewMap`-like com payload) — autosave assume daí em diante. Zero trabalho extra de estado.
- "Mesclar como subárvore" fica para a v1.0 (exigiria merge de IDs e resolução de conflitos — escopo próprio).

### 1.2 Chat na aba "Chat" com histórico em `document.meta.chat` — concordo, com 3 guardas

Aba nova na sidebar (quarta aba: Ajuda · Pesquisas · **Chat** · IA Config), contexto = mapa atual, histórico no blob. Coerente com o Híbrido Invertido. As guardas que o blob exige:

1. **Autosave por mensagem, nunca por token**: o par (pergunta, resposta) entra em `meta.chat` **quando a resposta termina** — streaming atualiza só o estado em memória. O autosave (debounce 1s) dispara uma vez por troca.
2. **Teto de histórico**: últimas **40 mensagens (~32 KB)** persistidas; o que passar do teto é podado (as mais antigas somem — é um chat de sessão de trabalho, não arquivo). Sem isso, o blob cresce sem limite e todo autosave passa a carregar o chat inteiro para sempre.
3. **Conflito 409**: conversar em duas abas do mesmo mapa → o 409 existente resolve (segunda aba recarrega e perde as últimas mensagens). Aceitável e já comunicadp pela UI.

### 1.3 Fallback só ANTES do primeiro token — concordo; formalizando como "commit point"

Correto e é como o ecossistema funciona (stream aberto = provedor comprometido). Formalizo no protocolo (§2) o **commit point**: o evento `chain{status: "committed"}` marca o instante em que o primeiro token chegou do provedor escolhido. Depois dele:

- Nenhum fallback. Se o stream morrer no meio → `error{error_code: PROVIDER_STREAM_INTERRUPTED, retryable: true}`.
- A UI mostra "Conexão interrompida — Tentar novamente", que **re-executa a cadeia inteira do zero** (novo `chain{trying}` etc.). Simples e honesto: não tentamos "retomar" de onde parou (não dá para retomar um prompt parcial num outro provedor sem repetir tudo).

---

## 2. Protocolo de streaming

### 2.1 ⚠️ Correção de transporte: **EventSource não serve — `fetch` + `ReadableStream`**

O contrato de eventos é SSE (formato `data: ...\n\n`), mas o **transporte não pode ser `EventSource`**: a API só faz GET e não aceita corpo — e a pesquisa/chat precisam de POST com JSON (nodeId, ancestorContext, pergunta, cadeia). Decisão:

- **`fetch(POST)` com corpo JSON + leitura do `response.body` (ReadableStream)**, parseando o formato de linha SSE no cliente (`data: {...}` / `: ping`).
- Content-Type `text/event-stream` + header `X-Accel-Buffering: no` na resposta (desabilita buffering de proxy).
- Motivo para manter o **formato** SSE apesar do transporte custom: depurável com curl, compatível com qualquer proxy futuro, e o parse é ~20 linhas.

### 2.2 Contrato de eventos (wire format)

| Evento | Payload | Significado |
|---|---|---|
| `chain` | `{provider, provider_label, status: "trying"\|"failed"\|"committed", kind?, message?}` | A cadeia viva: `trying` = tentando este provedor; `failed` = falhou (kind = taxonomia da v0.4), segue para o próximo; `committed` = **primeiro token recebido** — stream travado neste provedor |
| `token` | `{delta}` | Fragmento de texto (provider já commitado) |
| `done` | `{provider_used, model, fallback_trail}` | Fluxo completo — payload idêntico ao contrato REST da v0.4 (frontend reusa tudo) |
| `error` | `{error_code, message, fallback_trail, retryable}` | Antes do commit: toda a cadeia falhou (ALL_PROVIDERS_FAILED etc.). Depois do commit: `PROVIDER_STREAM_INTERRUPTED`, `retryable: true` |
| `: ping` | (comentário SSE) | **Heartbeat a cada 15s** durante o "thinking time" (antes do primeiro token, LLMs ficam 10–30s em silêncio) — evita que proxies/LB maten a conexão ociosa. Gotcha real de SSE que morre em produção silenciosamente. |

### 2.3 Endpoint

- `POST /api/v1/ai/deep-research/stream` e `POST /api/v1/ai/chat/stream` — mesmos bodies dos endpoints REST + `StreamingResponse(media_type="text/event-stream")` no FastAPI.
- Os endpoints REST da v0.4 **permanecem** (compatibilidade, E2Es existentes e caminho sem-streaming para adapters sem capacidade).

---

## 3. Streaming por adaptador

| Provedor | Método | B1 | Notas |
|---|---|---|---|
| OpenAI-compatible (Groq, OpenRouter, Cerebras, DeepSeek, OpenAI, LM Studio) | `stream: true` no payload; parse de `data: {json}` → `choices[0].delta.content` | ✅ B1 | **UM parser cobre 6 provedores** — o maior ganho por linha escrita |
| Ollama | `stream: true` nativo; NDJSON linha a linha (`{response: "..."}`) | ✅ B1 | Parser trivial (JSON por linha) |
| Gemini | `streamGenerateContent?alt=sse`; parse de `candidates[0].content.parts[0].text` | 🔜 B2 | Mesma família de parse do SSE; encaixa no bloco do chat (onde o contexto gigante do Gemini mais vale) |

**Flag de capacidade, não quebra de protocolo:** cada adapter ganha `supports_stream: bool`. O chain executor prefere stream quando disponível; **sem stream, executa `complete()` e emite o texto inteiro como um único evento `token` + `done`** — a UI não sabe a diferença. Gemini sem stream na B1 não quebra nada (pesquisa via REST da v0.4 segue funcionando); no B2 ganha streaming sem tocar no protocolo.

---

## 4. Renderização progressiva

- **Durante o stream: texto puro** (`whitespace-pre-wrap`) — concordo. react-markdown em texto parcial renders quebrados (cercas de código abertas, tabelas incompletas) e custa CPU a cada delta.
- **No `done`: a resposta entra no `researchHistory`/`meta.chat`** e os componentes existentes (ResearchPanel/chat) renderizam Markdown com a tipografia atual — zero código novo de renderização final.
- **⚠️ Buffer de renderização**: nunca `setState` por token (LLMs emitiram centenas de deltas/s). Buffer de deltas + flush a cada **~50ms** (ou `requestAnimationFrame`) no hook de streaming. Um `useStreamCompletion` centraliza: conexão, parse, buffer, estados (`idle/trying/committed/done/error`), abort via `AbortController` (fechar aba/cancelar pesquisa mata o fetch).

---

## 5. Contexto do chat — RAG com FTS5 (a peça central do épico)

### 5.1 Duas estratégias, um orçamento fixo

O limiar **não pode ser chars/4 vs contexto do modelo**: não sabemos o contexto do modelo (o usuário configura qualquer modelo em qualquer provedor). Decisão: **orçamento fixo de contexto** — `MAX_CONTEXT_CHARS = 24_000` (≈ 6k tokens, conservador para qualquer modelo free-tier) numa única constante. A montagem:

1. **Outline completo** (mapa pequeno): travessia raiz→folhas gerando lista Markdown indentada (`- Machine Learning\n  - Supervisionado\n    - ...`). Se couber no orçamento → usa tudo (cenário comum: a maioria dos mapas reais).
2. **Retrieval FTS5** (mapa grande): pergunta → termos → `MATCH 'termo1* OR termo2*'` → **top-12 nós por bm25()** (ranking nativo do FTS5, sem custo extra) → para cada nó recuperado, inclui o **caminho ancestral completo** (via BFS das arestas, dedup) + **filhos diretos** (a vizinhança importa tanto quanto o nó). Dedup global, respeitando o orçamento.

### 5.2 Detalhes do retriever (o que o torna RAG de verdade, não um grep)

- **Query**: pergunta limpa (remove stopwords curtas pt/en, pontuação) → termos com prefixo (`machine* learning*`) — o prefixo do FTS5 já nos dá stemming pobre-mas-útil e o `unicode61` já normaliza acento/caixa (prova na v0.3).
- **Vizinhança**: nó recuperado sozinho é inútil ("Supervisionado" sem o pai "Machine Learning" não dá contexto). Ancestrais + filhos diretos entram sempre.
- **Mapa vazio / zero hits**: degrada com elegância — outline truncado ao orçamento + nota no prompt ("o mapa não contém termos relacionados à pergunta; responda com base no que existe").
- **Rótulo estrutural**: o contexto entra no prompt como "Mapa: <título>\n\nEstrutura:\n<outline ou nós recuperados>" — o modelo cita o que existe em vez de alucinar estrutura.

### 5.3 Serviço e testes

- `context_builder.py` puro (mapa/documento → string de contexto; estratégia decidida pelo orçamento) — **testável sem rede**: mapa pequeno → outline completo; mapa com 500 nós → retrieval respeita orçamento e traz ancestrais; zero hits → degradação.
- Guardas: pergunta ≤ 2.000 chars; `LOG_PROMPTS` cobre o chat (nunca logar conteúdo por padrão).

---

## 6. Geração de mapa a partir de um tópico

### 6.1 Contrato do LLM

- **Schema recursivo**: `{"topic": str, "children": [{"topic": str, "children": [...]}]}` — profundidade ≤ 3, largura ≤ 5, **teto de 40 nós** (protege layout/FTS5/usabilidade; configurável no modal: profundidade e largura como selects).
- **Structured output onde existir, sem acoplamento**: OpenAI-compatible tenta `response_format: {type: "json_object"}` (suporte varia por provedor — o adapter tenta e cai para o prompt puro em erro de validação do provedor); Gemini usaria `responseMimeType`. **Fallback universal**: prompt "responda SOMENTE com JSON válido no schema" + parser robusto.
- **Parser robusto (o trabalho real)**: limpar cercas de código (` ```json `), extrair o **primeiro `{...}` balanceado** (contador de chaves, ignora strings), `json.loads`; falha → **1 retry** com prompt "o texto acima não é JSON válido; responda apenas com o JSON". Falha de novo → erro estruturado `GENERATION_PARSE_FAILED` (toast + tentar outro provedor da cadeia faz sentido aqui: parsing falho é do modelo, e o chain já roda o retry no MESMO provedor antes de cair).

### 6.2 Fluxo (não-destrutivo, §1.1)

1. Modal: tópico + profundidade (2/3) + largura (3/4/5) → "Gerar mapa"
2. `POST /ai/generate` (REST, sem stream — é um único JSON; um mini-stream aqui não vale o custo) → chain executor com o prompt de geração → parse → árvore validada (profundidade/largura/teto impostos no backend)
3. Frontend: converte em nodes/edges (nanoid; raiz = tópico), cria o **mapa novo já salvo** com título = tópico, aplica **`balanced-lr`** via `computeLayout` + transição animada (padrão do Layout Engine), toast "Mapa '<tópico>' gerado"
4. O mapa anterior permanece intacto — arrependimento = excluir (com Desfazer de 5s)

---

## 7. Blocos de execução

- **B1 — Streaming SSE**: protocolo (`/deep-research/stream`), transporte fetch+ReadableStream, adapters OpenAI-compatible + Ollama (`supports_stream`), heartbeat, hook `useStreamCompletion` com buffer de 50ms, ResearchPanel com linha de status viva (`trying → failed → committed`) + tokens progressivos → Markdown no done. E2E: mock upstream em modo stream (o mock_upstream ganha modo "sse") + assert de tokens progressivos e badge.
- **B2 — Chat com o mapa**: `context_builder.py` (outline vs retrieval FTS5, orçamento 24k), endpoint `/ai/chat/stream` (chain + stream), aba Chat (histórico em `meta.chat`, teto 40 msgs, autosave por troca), **Gemini stream** (fecha a matriz de adapters), E2E: pergunta com hit FTS5 → resposta citando nós; mapa grande → retrieval path.
- **B3 — Geração de mapa**: modal, prompt de geração, parser robusto + retry, criação do mapa novo com layout balanced-lr, E2E: gera → mapa novo existe → layout aplicado → mapa antigo intacto.
- **B4 — Restos + fechamento**: "Resumir mapa" (botão que usa o context_builder com pergunta fixa — quase de graça pós-B2), seleção múltipla → expandir vários (payload com múltiplos nodeContents), dnd na cadeia (dnd-kit, ▲▼ permanece), CHANGELOG + tag **v0.4.5**.

---

## 8. Riscos abertos

- **Proxies matando streams ociosos**: heartbeat resolve o conhecido; staging com proxy real antes da tag.
- **Streaming via adapters free-tier**: alguns provedores free limitam RPM de streams AGRESSIVAMENTE — o chain com fallback antes do commit cobre.
- **Gemini alt=sse em httpx**: fluxo assíncrono de linhas difere do NDJSON do Ollama — isolar num parser próprio testado com fixtures reais.
- **Chat em duas abas**: 409 já cobre; UX de recuperação aceita perder as últimas mensagens (documentado §1.2).
- **Custo de contexto na v1.0 multiusuário**: orçamento fixo de 24k é global; quando houver contas, vira configuração por usuário.
