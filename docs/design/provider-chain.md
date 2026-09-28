# Design Doc — Provider Chain: IA sempre-disponível (fundação v0.4)

**Épico:** v0.4 — Fundação de IA (Provider Chain) · **Status:** proposta v1 — revisão do Tech Lead de produto pendente
**Branch:** `feature/provider-chain` (worktree: `../mindweave-provider-chain`)
**Premissas inegociáveis:** apenas provedores com API pública + chave do usuário. Sem puppeteer/login automático (ToS). Sem rotação de múltiplas contas do mesmo serviço (fraude).

---

## 1. Arquitetura (diagrama textual)

```
┌──────────────────────────── Frontend ────────────────────────────┐
│ IA Config: cadeia de provedores (ordem, on/off, chaves, modelos) │
│ Header: "IA: Groq" / "IA: Gemini (fallback)" + tooltip da cadeia │
└───────────────┬──────────────────────────────────────────────────┘
                │ POST /api/v1/ai/deep-research {..., chain_hint?}
┌───────────────▼────────────── Backend ───────────────────────────┐
│ ChainExecutor                                                    │
│  1. lê a cadeia ordenada do usuário (table provider_chain)       │
│  2. para cada provedor ON e sem cooldown:                        │
│     adapter.complete(prompt) ── erro? ──► classify_error()       │
│        │ 200 ──────────► retorna (content, provider usado)       │
│        └─ RATE_LIMIT → cooldown 30s, tenta o próximo             │
│          QUOTA      → indisponível até reset estimado            │
│          unreachable → tenta o próximo                           │
│  3. resposta + trilha: {"provider": "gemini", "fallbacks": [...]}│
└───────────────┬──────────────────────────────────────────────────┘
                │ httpx (timeouts do Bloco 2 da v0.2)
┌───────────────▼────────────── Provedores ────────────────────────┐
│ OpenAICompatible (Groq, OpenRouter, Cerebras, DeepSeek, LM S.)   │
│ GeminiNative (já existe no ai_service)  │ OllamaNative (idem)    │
└──────────────────────────────────────────────────────────────────┘
```

## 2. Q1 — LiteLLM vs adaptadores próprios: **adaptadores próprios**

O LiteLLM economizaria ~150 linhas, mas custaria mais do que economiza:

1. **Nossa superfície é mínima**: 1 operação (completion não-streaming) × 7 provedores. Não usamos 95% das 100+ integrações do LiteLLM.
2. **Erros estruturados**: a v0.2 construiu `AIProviderError` + `ErrorCode` exatamente para NÃO parsear strings. O LiteLLM normaliza exceções dele próprio e esconde os detalhes de quota específicos de cada provedor (o `RESOURCE_EXHAUSTED` do Gemini, o texto do Groq) — teríamos que fazer parse reverso, reintroduzindo a fragilidade que eliminamos.
3. **Dependência volátil**: LiteLLM evolui rápido, com breaking changes frequentes entre minors.
4. **Fato geométrico a nosso favor**: Groq, OpenRouter, Cerebras, DeepSeek e LM Studio são **todos OpenAI-compatible** → UMA classe `OpenAICompatibleProvider(base_url, model, api_key)` cobre 5 dos 7. Gemini nativo e Ollama nativo **já existem** no `ai_service`. Trabalho real: refatorar o que existe para uma interface comum.

**Interface:**
```python
class AIProvider(Protocol):
    id: str                      # 'groq', 'gemini', 'ollama', 'lmstudio'...
    label: str                   # 'Groq'
    def complete(self, prompt: str, model: str) -> str: ...        # levanta AIProviderError
    def classify(self, exc: AIProviderError) -> ErrorCode: ...     # refino do mapeamento
```

## 3. Q2 — Detecção de quota: **duas exceções distintas, sim**

`RateLimitError` (RPM — volta em segundos) e `QuotaExhaustedError` (cota diária/mensal — fora por horas) têm **tratamentos diferentes no chain**:

| | RateLimitError | QuotaExhaustedError |
|---|---|---|
| HTTP típico | 429 com `Retry-After` curto | 429/402/403 com reset diário |
| Ação do chain | pula o provedor **nesta request** + cooldown 30s | marca **indisponível até o reset estimado** (`Retry-After`/`X-RateLimit-Reset` quando o provedor mandar) |
| Exceção | `RateLimitError(AIProviderError)` | `QuotaExhaustedError(AIProviderError)` |

Mapeamento por provedor (método `classify(status, body)` do adapter):

| Provedor | Endpoint base | Auth | Quota free | Sinal de quota |
|---|---|---|---|---|
| Groq | `api.groq.com/openai/v1` | Bearer | 30 RPM / 14.4K tok-dia | 429 `Rate limit reached` + `Retry-After` |
| Gemini | `generativelanguage.googleapis.com` | `x-goog-api-key` | 60 RPM (Flash) | 429 `RESOURCE_EXHAUSTED` (body JSON) |
| OpenRouter | `openrouter.ai/api/v1` | Bearer | varia por modelo | 429 ou **402** `insufficient credits` |
| Cerebras | `api.cerebras.ai/v1` | Bearer | generoso | 429 |
| DeepSeek | `api.deepseek.com/v1` | Bearer | pré-pago | **402** `insufficient balance` |
| Ollama | `localhost:11434` | — | ilimitado | só offline (503/504 existentes) |
| LM Studio | `localhost:1234/v1` | placeholder | ilimitado | idem |

Regra de parsing: `429` → RateLimit; `402` → Quota; `401/403` → InvalidKey; `404` → ModelNotFound; **exceção Gemini**: 400 com "api key" no corpo → InvalidKey (padrão já implementado na v0.2).

## 4. Q3 — Chain execution: **server-side na v0.4; SSE de progresso na v0.4.5**

Concordo com o híbrido como destino, com uma simplificação de cronograma:

- **v0.4 (fundaçação)**: server-side puro — 1 request, o backend tenta a cadeia inteira. A resposta carrega a **trilha**: `{"researchSummary": "...", "provider_used": "gemini", "fallbacks": [{"provider": "groq", "error_code": "RATE_LIMIT_EXCEEDED"}]}`. O frontend mostra "Respondido por Gemini (fallback do Groq)" no toast/header. Chaves nunca saem do backend; 1 roundtrip; sem máquina de estados no cliente.
- **v0.4.5 (experiência)**: o streaming de tokens (SSE) já exige o canal de eventos — os progressos "tentando groq… → gemini…" passam a fluir no MESMO canal, cumprindo o híbrido completo sem retrabalho.

Latência somada só ocorre no caminho do fallback (raro) e cada tentativa tem timeout próprio de 60s/10s — o pior caso é limitado pela cadeia, aceitável.

## 5. Q4 — LM Studio

`OpenAICompatibleProvider(base_url='http://localhost:1234/v1', api_key='lm-studio')` — o placeholder satisfaz o header `Authorization` sem custo. Especial: o botão **"Testar conexão"** dos provedores locais chama `GET /v1/models` e **lista os modelos disponíveis** (o Ollama já tem o equivalente em `/api/tags`) — o usuário escolhe da lista em vez de digitar o identificador. Nenhum outro tratamento especial.

## 6. Q5 — UI de configuração (wireframe)

```
IA Config ▸ seção "Cadeia de IA" (substitui o select único de provedor):
┌────────────────────────────────────────────────────────┐
│ CADEIA DE PROVEDORES (ordem = prioridade)              │
│ ▲▼  ⬤  Groq        modelo: llama-3.3-70b   🟢 OK   ⚙  │
│ ▲▼  ⬤  Gemini     modelo: gemini-flash     🟡 429  ⚙  │
│ ▲▼  ⬤  Ollama     modelo: llama3           ⚫ local ⚙ │
│ ▲▼  ◯  OpenRouter (desligado)                  ⚙      │
│ [+ Adicionar provedor ▾]        [Testar cadeia ↻]      │
│  ↳ "Groq OK (230ms) · Gemini 429 · Ollama offline"     │
└────────────────────────────────────────────────────────┘
⚙ expande: base_url (locais), modelo (dropdown p/ locais, texto p/ remotos), chave
```

- **Reordenação**: botões ▲▼ na v0.4 (zero dependência, acessível por teclado); drag-and-drop (dnd-kit) só na v0.4.5 se a cadeia crescer.
- **Toggle ⬤** por provedor (entra/sai da cadeia sem apagar a config).
- **"Testar cadeia"**: ping de 1 token em cada provedor ON, em paralelo, com latência.
- **Header**: "IA: Groq" (tooltip = cadeia completa + status). Após fallback: "IA: Gemini (fallback de Groq)". Quota esgotada: "Groq: quota esgotada — reset ~03:00" **somente quando o provedor mandar** `Retry-After`/reset; sem header, mostramos "em cooldown".
- **Chave ausente na cadeia**: o provedor é pulado com aviso (não bloqueia os demais).

## 7. Q6 — Persistência de chaves (Fernet): **Bloco 0 da v0.4** ✓

Concordo — v0.3.2 criaria tag ponte fora do SemVer mental da série. Escopo do Bloco 0:

```sql
CREATE TABLE api_keys (
  provider   TEXT PRIMARY KEY,   -- 'groq', 'openai', 'google', 'openrouter', ...
  encrypted  BLOB NOT NULL,      -- Fernet(master).encrypt(token)
  updated_at TEXT NOT NULL
);
```

- **Master key**: `MASTER_SECRET` (urlsafe base64 de 32 bytes) no `.env` → `Fernet(master_secret)`. Se ausente, gerada na 1ª execução e persistida em `backend/data/secret.key` (gitignored) — UX de dev sem configurar nada.
- **Honestidade de ameaça** (para o README): protege contra o leak acidental do `.db` (o nosso C1 da v0.3.1!) e de dumps casuais; **não** protege contra atacante com acesso à máquina (a master key está ao lado). Cofre do SO (keyring) → v1.0. Rotação de master: comando futuro.
- **Runtime**: os adapters passam a ler a chave da cadeia (tabela), mantendo os globais `OPENAI_API_KEY`/`GOOGLE_API_KEY` do `.env` como fallback de compatibilidade.

## 8. Q7 — ROADMAP: **concordo com a reorganização**

- **v0.4 — Fundação de IA (Provider Chain)**: multi-provedor com rotação, chaves criptografadas, LM Studio, UI da cadeia, "Testar cadeia".
- **v0.4.5 — Experiência de IA**: streaming (SSE) com progresso da cadeia, chat com o mapa, geração de mapa inteiro, resumo completo, seleção múltipla.
- **"Configuração de modelo por requisição"**: **subsumido** — cada provedor da cadeia carrega seu próprio modelo na config; o item sai do ROADMAP (não migra).
- Layout (B1/B2 feitos; B3/B4 em andamento no outro branch) permanece v0.5.

## 9. Blocos de execução (futuros)

- **B0 — Criptografia e persistência de chaves**: tabela `api_keys`, Fernet + master secret, endpoints `PUT/DELETE /api/v1/ai/keys/{provider}`, adapters lendo da cadeia. Testes de round-trip + chave ausente.
- **B1 — Adaptadores**: `providers/base.py` (Protocol + helpers do Bloco 2), `openai_compatible.py` (Groq/OpenRouter/Cerebras/DeepSeek/LM Studio), port do Gemini/Ollama nativos para a interface.
- **B2 — Chain executor**: `chain_executor.py` (ordenação, cooldowns, classificação, trilha), integração nos 2 endpoints existentes, resposta com `provider_used`/`fallbacks`.
- **B3 — UI da cadeia**: wireframe do §6, ▲▼/⬤/⚙, Testar cadeia, indicador do header, tratamento do 409/quota no toast (`aiErrorCode` já existe).
- **B4 — Integração + fechamento**: pesquisa e sugestão pela cadeia, E2E (mock de 2 provedores com falha em sequência), CHANGELOG, tag v0.4.0.

## 10. Riscos abertos

- Tabelas de quota free mudam sem aviso (o Groq já mudou 2× em 2025) — os adapters isolam os números; a UI nunca hardcodea "30 RPM".
- `Retry-After` em segundos vs data: normalizar os dois formatos.
- Chain muito longa + timeouts de 60s = pior caso longo; limite prático: 5 provedores ON na v0.4.
- chaves do mesmo provedor em 2 lugares (env + tabela): precedência documentada — tabela vence.
