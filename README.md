# MindWeave AI

MindWeave AI é uma aplicação de mapa mental inteligente que se integra com modelos de linguagem grandes (LLMs) para ajudar os usuários a realizar pesquisas profundas, obter sugestões de nós e expandir suas ideias de forma contextual.

## Funcionalidades Principais

*   **Criação de Mapas Mentais:**
    *   Adicione, edite e conecte nós para visualizar suas ideias.
    *   Interface intuitiva de arrastar e soltar.
*   **Integração com IA:**
    *   **Pesquisa Profunda:** Para qualquer nó, utilize a IA para obter um resumo de pesquisa detalhado sobre o tópico, mantendo o contexto dos nós pais.
    *   **Sugerir Novos Nós:** Deixe a IA sugerir sub-nós relevantes com base no nó atual e seu contexto hierárquico.
*   **Múltiplos Provedores de IA:**
    *   Suporte para **Ollama** (execução local de modelos como Llama 3, Mistral, etc.).
    *   Suporte para **OpenAI API** (requer chave de API).
    *   Suporte para **Google Gemini API** (requer chave de API).
    *   Configure facilmente seu provedor preferido.
*   **Interface Moderna:**
    *   Modo Claro e Escuro.
    *   Design limpo e responsivo (básico).

## Tecnologias Utilizadas

*   **Frontend:**
    *   React 19 (com Vite)
    *   @xyflow/react v12 (React Flow, para renderização do mapa mental)
    *   Zustand (para gerenciamento de estado)
    *   Tailwind CSS v4 (para estilização)
    *   Axios (para chamadas HTTP)
*   **Backend:**
    *   Python
    *   FastAPI (framework web de alta performance)
    *   Pydantic (para validação de dados)
    *   HTTPX (para chamadas HTTP assíncronas para os modelos de IA)
*   **IA:**
    *   Ollama API
    *   OpenAI API
    *   Google Gemini API

## Configuração e Execução

### Pré-requisitos

*   Node.js (v20 ou superior recomendado) e npm
*   Python (v3.10 ou superior recomendado) e pip
*   Ollama instalado e em execução (se for usar Ollama).
    *   Baixe modelos para o Ollama, por exemplo: `ollama pull llama3`
*   (Opcional) Chaves de API para OpenAI e/ou Google Gemini.

### 1. Backend

```bash
# Clone o repositório (se ainda não o fez)
# git clone <url-do-repositorio>
# cd <nome-do-repositorio>

cd backend

# Crie um ambiente virtual (recomendado)
python -m venv venv
source venv/bin/activate  # No Windows: venv\Scripts\activate

# Instale as dependências
pip install -r requirements.txt

# (Opcional) Crie um arquivo .env na pasta 'backend' para configurar as chaves de API e Ollama:
# Exemplo de backend/.env:
# OLLAMA_BASE_URL=http://localhost:11434
# DEFAULT_OLLAMA_MODEL=llama3
# OPENAI_API_KEY="sk-sua-chave-openai"
# GOOGLE_API_KEY="sua-chave-google"

# Execute o servidor backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
O backend estará rodando em `http://localhost:8000`. Você pode acessar a documentação da API em `http://localhost:8000/docs`.

### 2. Frontend

```bash
# Em um novo terminal, navegue até a pasta frontend
cd frontend

# Instale as dependências
npm install

# (Opcional) Crie um arquivo .env na pasta 'frontend' se a URL do backend for diferente da padrão:
# Exemplo de frontend/.env:
# VITE_API_BASE_URL=http://localhost:8000/api/v1

# Execute o servidor de desenvolvimento do frontend
npm run dev
```
O frontend estará rodando em um endereço como `http://localhost:5173` (o Vite informará a porta exata).

### 3. Configurando Provedores de IA no Aplicativo

1.  Abra o aplicativo no seu navegador.
2.  No painel lateral, clique em "IA Config".
3.  **Para Ollama:**
    *   Certifique-se que o Ollama está rodando localmente.
    *   A URL base padrão é `http://localhost:11434`. Ajuste se necessário.
    *   Especifique o modelo Ollama que você baixou (ex: `llama3`, `mistral`).
4.  **Para OpenAI / Google:**
    *   Selecione o provedor desejado.
    *   Insira sua chave de API no campo correspondente.
    *   Clique em "Salvar". A chave será enviada ao backend (armazenada em memória para a sessão atual do backend).

## Como Usar

1.  **Adicionar Nós:** Clique em "Adicionar Nó Raiz" ou, se um nó estiver selecionado, use o botão "Adicionar Filho" no próprio nó.
2.  **Editar Texto:** Dê um duplo clique no texto de um nó para editá-lo. Pressione Enter ou clique fora para salvar.
3.  **Conectar Nós:** Clique e arraste de um pequeno círculo (handle) na borda de um nó para o handle de outro nó.
4.  **Ações de IA:**
    *   Selecione um nó. Os botões de ação de IA aparecerão nele.
    *   **Pesquisa IA:** Gera um resumo sobre o tópico do nó, considerando o contexto dos nós pais. O resultado aparece em um modal.
    *   **Sugerir Nós IA:** Adiciona novos nós filhos ao nó selecionado, com sugestões da IA.
5.  **Navegação:** Use o mouse para arrastar o canvas (pan) e a roda do mouse para zoom. Controles de zoom também estão disponíveis.
6.  **Deletar Nós:** Selecione um nó e pressione a tecla `Delete` ou `Backspace`.

## Estrutura do Projeto

```
/
├── backend/        # Código do backend FastAPI (Python)
│   ├── app/
│   ├── .env        # (Opcional) Configurações do backend
│   └── requirements.txt
├── frontend/       # Código do frontend React (Vite)
│   ├── src/
│   ├── .env        # (Opcional) Configurações do frontend
│   └── package.json
└── README.md       # Este arquivo
```

## Próximos Passos e Melhorias Potenciais

Veja o [ROADMAP.md](ROADMAP.md) para o plano de evolução detalhado (robustez, persistência, IA avançada e escala).

## Licença

[MIT](LICENSE)