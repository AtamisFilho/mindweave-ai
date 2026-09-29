# MindWeave AI

Mapa mental inteligente com **IA sempre-disponível**: organize ideias num canvas de grafo (DAG com cross-links), pesquise tópicos com LLMs considerando o contexto hierárquico, gere sub-nós automaticamente e nunca perca trabalho — autosave contínuo com persistência em SQLite e resiliência offline.

## Funcionalidades

### 🧠 IA sempre-disponível (Provider Chain)
- **8 provedores** integrados: Groq, Google Gemini, OpenRouter, Cerebras, DeepSeek, OpenAI, Ollama (local) e LM Studio (local)
- **Fallback automático**: o backend tenta a cadeia na ordem que você definir; quota/rate-limit → próximo provedor, com cooldown inteligente (respeita `Retry-After`)
- **Chaves criptografadas em repouso** (Fernet no SQLite) — configuráveis pela UI, com "Testar conexão" por provedor
- **Classificação fina de erros**: quota esgotada ≠ rate limit ≠ chave inválida ≠ contexto estourado — cada caso com ação clara na UI
- **Pesquisa Profunda** com contexto hierárquico (o grafo é um DAG: cross-links contam) e **Sugestão de Nós** inseridos automaticamente

### 🗺️ Editor de mapas
- Canvas React Flow: criar/editar/conectar nós (drag entre handles), cross-links com múltiplos pais, rejeição de ciclos
- **Layout Engine**: 4 direções + **balanceado Left-Right/Up-Down** (estilo XMind/niMind) via dagre, determinístico, com animação, presets visuais (curva/reta/cantos × árvore/lista) e modo Auto
- Undo escopado de layout e exclusões (toast de 5s)

### 💾 Persistência
- **Autosave silencioso** (debounce 1s) + `Ctrl/Cmd+S` imediato
- **Múltiplos mapas** com Fricção Zero: abre no último editado, sem tela de lista
- **Busca global de nós** (FTS5, caixa/acento-insensível) no menu de Mapas
- **Resiliência offline**: falha de rede → snapshot em localStorage + sincronização automática com detecção de conflito entre abas (409 versionado)

## Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 19 · Vite · @xyflow/react v12 · Zustand · Tailwind v4 · sonner · react-markdown |
| Backend | Python · FastAPI · SQLAlchemy 2 · SQLite (WAL + FTS5) · httpx · cryptography (Fernet) |
| IA | Adaptadores próprios (OpenAI-compatible p/ 6 provedores + Gemini/Ollama nativos) |

## Configuração e execução

### Pré-requisitos
- Node.js 20+, Python 3.10+
- Ollama (opcional, fallback local): `ollama pull llama3`

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API docs: `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### Chaves de API

Configure pela **UI**: aba `IA Config` → *Cadeia de Provedores* → botão "Testar" valida cada provedor. As chaves são criptografadas (Fernet) na tabela `api_keys` do SQLite — nunca em texto plano, nunca em logs.

O `.env` do backend é **só para segredos de infraestrutura** (veja `backend/.env.example`):

```env
ENCRYPTION_SECRET=minha-frase-secreta   # master key da criptografia (default: auto-gerada em backend/data/)
ALLOWED_ORIGINS=http://localhost:5173   # CORS
LOG_PROMPTS=false                       # jamais habilitar em produção
SECURITY_HSTS=false                     # só com HTTPS
```

Chaves antigas em `OPENAI_API_KEY`/`GOOGLE_API_KEY` (.env) são **migradas automaticamente** para o banco criptografado no primeiro boot.

## Estrutura do projeto

```
/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # endpoints (ai, maps, keys, chain, test)
│   │   ├── core/            # config (pydantic-settings), erros, crypto (Fernet)
│   │   ├── providers/       # adaptadores: base + openai_compatible + gemini/ollama nativos
│   │   ├── services/        # ai_service (prompts), chain_executor, chain_config,
│   │   │                    #   keys_service, maps_service
│   │   ├── db.py            # engine SQLite (WAL, FKs) + FTS5
│   │   └── models_db.py     # maps, api_keys, provider_chain
│   └── tests/               # pytest + respx (upstreams mockados) + mock_upstream.py
├── frontend/
│   ├── src/
│   │   ├── components/      # MindMap, Maps (menu/autosave), Research, AISettings (cadeia)
│   │   ├── layout/          # engine.js (dagre) + balance.js (LR/UD particionado)
│   │   ├── store/           # Zustand (grafo, persistência, IA, UI)
│   │   └── services/        # api.js (axios), notify.js (toasts por error_code)
│   └── e2e/                 # Playwright (app, persistência, layout, provider_chain, chain_ui)
├── docs/design/             # design docs dos épicos
└── .github/workflows/       # CI: ruff+pytest · eslint+vitest+build · Playwright
```

## Desenvolvimento

```bash
# backend: testes e lint
cd backend && pytest -q && ruff check .

# frontend: testes, lint, build, e2e
cd frontend && npm run test && npm run lint && npm run build && npm run e2e
```

Os E2Es de persistência/cadeia sobem backend e upstreams mockados automaticamente (Playwright `webServer`).

## Roadmap

Veja [ROADMAP.md](ROADMAP.md) (próximo: **v0.4.5 — Experiência de IA**: streaming, chat com o mapa, geração de mapa inteiro) e o histórico em [CHANGELOG.md](CHANGELOG.md).

## Licença

[MIT](LICENSE)
