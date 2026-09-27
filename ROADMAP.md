# MindWeave AI — Roadmap

Estado atual (v0.1): aplicação funcional de ponta a ponta — edição de mapa mental com Pesquisa Profunda e Sugestão de Nós via Ollama/OpenAI/Gemini. Sem persistência: o mapa vive apenas em memória no navegador.

## v0.2 — Robustez

- [ ] **Contexto hierárquico completo**: conexões manuais (drag entre handles) não atualizam `data.parentId` — a IA ignora essas conexões ao montar contexto (`mindMapStore.js`, `getAncestorContext`)
- [ ] **Painel "research"**: o resultado da Pesquisa Profunda hoje só aparece em modal; criar painel lateral dedicado com histórico de pesquisas
- [ ] **Erros estruturados**: substituir o controle de fluxo por strings `"Error:"` no backend (`endpoints_ai.py`, `ai_service.py`) por exceções/`HTTPException` tipadas
- [ ] **Logging**: trocar `print()` de prompts por `logging` (evitar logar conteúdo sensível)
- [ ] **Segurança da chave Gemini**: mover a chave da query string para o header `x-goog-api-key`
- [ ] **Toasts de feedback** no lugar de modais de erro para falhas leves
- [ ] **Undo/redo** do mapa (Command pattern no store)
- [ ] **Testes**: pytest para endpoints/serviços (httpx mock), Vitest + Testing Library para store e componentes
- [ ] **CI**: GitHub Actions (ruff + pytest; eslint + build)

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
