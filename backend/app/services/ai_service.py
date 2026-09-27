from typing import List, Optional

import httpx
from app.models.ai_models import (
    AIResearchRequest,
    AISuggestNodesRequest,
    AISuggestedNode,
    OllamaConfig,
    NodeContext
)
from app.core.config import settings
import os # For API keys

# --- Gerenciamento de API Keys (Simples - NÃO PARA PRODUÇÃO REAL) ---
# Em produção, use Vault, AWS/GCP Secret Manager, ou variáveis de ambiente seguras.
# Estas são "globais" no módulo de serviço por simplicidade neste exemplo.
_OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") # Para Gemini (Google Generative AI)

def set_openai_api_key(key: str):
    global _OPENAI_API_KEY
    _OPENAI_API_KEY = key
    # Aqui você poderia persistir a chave de forma segura se necessário

def set_google_api_key(key: str):
    global _GOOGLE_API_KEY
    _GOOGLE_API_KEY = key
    # Aqui você poderia persistir a chave de forma segura

def is_openai_key_set() -> bool:
    return bool(_OPENAI_API_KEY)

def is_google_key_set() -> bool:
    return bool(_GOOGLE_API_KEY)
# --- Fim do Gerenciamento de API Keys ---


def get_ancestor_context_string(ancestorContext: list[NodeContext]) -> str:
    """Recebe os ancestrais ordenados do mais próximo ao mais amplo (o frontend
    já faz o BFS sobre o grafo e envia a lista pronta, sem duplicatas)."""
    if not ancestorContext:
        return ""
    return "; ".join(ctx.content for ctx in ancestorContext)

async def ollama_generate(prompt: str, model: str, base_url: str) -> str:
    full_response = ""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False 
            }
            response = await client.post(f"{base_url}/api/generate", json=payload)
            response.raise_for_status()
            response_data = response.json()
            full_response = response_data.get("response", "").strip()
            
    except httpx.RequestError as e:
        print(f"Error contacting Ollama: {e}")
        return "Error: Could not connect to Ollama service."
    except httpx.HTTPStatusError as e:
        print(f"Ollama API request failed: {e.response.status_code} - {e.response.text}")
        return f"Error: Ollama request failed with status {e.response.status_code}."
    except Exception as e:
        print(f"An unexpected error occurred with Ollama: {e}")
        return "Error: An unexpected error occurred while processing your request with Ollama."
    
    return full_response.strip()

async def perform_deep_research_ollama(request: AIResearchRequest, config: OllamaConfig) -> str:
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else ""
    model_to_use = request.model_name or config.model

    prompt = (
        f"Você é um assistente de pesquisa especializado. Por favor, realize uma pesquisa aprofundada sobre o seguinte tópico: '{request.nodeContent}'.\n"
        f"{context_narrative}\n"
        f"O objetivo é obter um resumo conciso e informativo sobre este tópico, levando em conta sua posição na hierarquia do mapa mental. "
        f"Não mencione os nós pais explicitamente na sua resposta, mas use-os para entender o sub-tópico em questão.\n"
        f"Resumo da pesquisa:"
    )
    print(f"--- Ollama Deep Research Prompt (Model: {model_to_use}) ---\n{prompt}\n---------------------------------")
    return await ollama_generate(prompt, model_to_use, config.baseUrl)

async def suggest_new_nodes_ollama(request: AISuggestNodesRequest, config: OllamaConfig) -> List[AISuggestedNode]:
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else ""
    model_to_use = request.model_name or config.model

    prompt = (
        f"Você é um assistente de brainstorming para mapas mentais. O nó atual é '{request.nodeContent}'.\n"
        f"{context_narrative}\n"
        f"Com base neste nó e seu contexto, sugira até 3-5 novos sub-nós ou nós relacionados que poderiam expandir este mapa mental. "
        f"Liste cada sugestão em uma nova linha, sem marcadores ou numeração. Apenas o texto da sugestão.\n"
        f"Exemplo de formato de resposta:\n"
        f"Sugestão 1\n"
        f"Sugestão 2\n"
        f"Sugestão 3\n"
        f"Sugestões:"
    )
    print(f"--- Ollama Suggest Nodes Prompt (Model: {model_to_use}) ---\n{prompt}\n--------------------------------")
    raw_suggestions = await ollama_generate(prompt, model_to_use, config.baseUrl)

    if "Error:" in raw_suggestions:
        return [AISuggestedNode(content=raw_suggestions)]

    suggested_nodes = []
    for line in raw_suggestions.split('\n'):
        cleaned_line = line.strip()
        if cleaned_line:
            suggested_nodes.append(AISuggestedNode(content=cleaned_line))
    
    return suggested_nodes if suggested_nodes else [AISuggestedNode(content="Nenhuma sugestão gerada.")]

# --- OpenAI Service Implementation ---
async def perform_deep_research_openai(request: AIResearchRequest, api_key: Optional[str]) -> str:
    if not api_key:
        return "Error: OpenAI API Key não configurada."
    
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else "Este é um nó raiz."
    model_to_use = request.model_name or "gpt-3.5-turbo"

    messages = [
        {"role": "system", "content": "Você é um assistente de pesquisa especializado. Forneça resumos concisos e informativos."},
        {"role": "user", "content": (
            f"Realize uma pesquisa aprofundada sobre o tópico: '{request.nodeContent}'.\n"
            f"{context_narrative}\n"
            f"O objetivo é obter um resumo sobre este tópico, levando em conta sua posição na hierarquia do mapa mental. "
            f"Não mencione os nós pais explicitamente na sua resposta, mas use-os para entender o sub-tópico em questão.\n"
            f"Resumo da pesquisa:"
        )}
    ]
    print(f"--- OpenAI Deep Research (Model: {model_to_use}) ---\nUser Content: {messages[1]['content']}\n-----------------------------")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            headers = {"Authorization": f"Bearer {api_key}"}
            payload = {"model": model_to_use, "messages": messages}
            response = await client.post("https://api.openai.com/v1/chat/completions", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
    except httpx.RequestError as e:
        print(f"Error contacting OpenAI: {e}")
        return "Error: Could not connect to OpenAI service."
    except httpx.HTTPStatusError as e:
        print(f"OpenAI API request failed: {e.response.status_code} - {e.response.text}")
        return f"Error: OpenAI request failed with status {e.response.status_code}."
    except Exception as e:
        print(f"An unexpected error occurred with OpenAI: {e}")
        return "Error: An unexpected error occurred while processing your request with OpenAI."


async def suggest_new_nodes_openai(request: AISuggestNodesRequest, api_key: Optional[str]) -> List[AISuggestedNode]:
    if not api_key:
        return [AISuggestedNode(content="Error: OpenAI API Key não configurada.")]

    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else "Este é um nó raiz."
    model_to_use = request.model_name or "gpt-3.5-turbo"

    messages = [
        {"role": "system", "content": "Você é um assistente de brainstorming para mapas mentais. Sugira novos nós concisos."},
        {"role": "user", "content": (
            f"O nó atual é '{request.nodeContent}'.\n"
            f"{context_narrative}\n"
            f"Com base neste nó e seu contexto, sugira até 3-5 novos sub-nós ou nós relacionados que poderiam expandir este mapa mental. "
            f"Liste cada sugestão em uma nova linha, sem marcadores ou numeração. Apenas o texto da sugestão."
        )}
    ]
    print(f"--- OpenAI Suggest Nodes (Model: {model_to_use}) ---\nUser Content: {messages[1]['content']}\n---------------------------")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            headers = {"Authorization": f"Bearer {api_key}"}
            payload = {"model": model_to_use, "messages": messages, "max_tokens": 100}
            response = await client.post("https://api.openai.com/v1/chat/completions", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            raw_suggestions = data["choices"][0]["message"]["content"].strip()
            
            suggested_nodes = []
            for line in raw_suggestions.split('\n'):
                cleaned_line = line.strip()
                if cleaned_line:
                    suggested_nodes.append(AISuggestedNode(content=cleaned_line))
            return suggested_nodes if suggested_nodes else [AISuggestedNode(content="Nenhuma sugestão gerada.")]

    except httpx.RequestError as e:
        print(f"Error contacting OpenAI: {e}")
        return [AISuggestedNode(content="Error: Could not connect to OpenAI service.")]
    except httpx.HTTPStatusError as e:
        print(f"OpenAI API request failed: {e.response.status_code} - {e.response.text}")
        return [AISuggestedNode(content=f"Error: OpenAI request failed with status {e.response.status_code}.")]
    except Exception as e:
        print(f"An unexpected error occurred with OpenAI: {e}")
        return [AISuggestedNode(content="Error: An unexpected error occurred with OpenAI.")]

# --- Google Gemini Service Implementation ---
async def perform_deep_research_google(request: AIResearchRequest, api_key: Optional[str]) -> str:
    if not api_key:
        return "Error: Google API Key não configurada."

    # Google Generative AI Python SDK (google-generativeai) é preferível, mas vamos usar httpx por consistência.
    # O endpoint e o formato do payload podem variar dependendo do modelo específico (Gemini Pro, etc.)
    # Este é um exemplo genérico para Gemini via REST API.
    # Você precisará ajustar o `model_name` e o endpoint/formato do payload conforme a documentação do Google.
    
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else "Este é um nó raiz."
    # O usuário pode especificar um modelo como "gemini-1.5-flash-latest" ou "gemini-pro" etc.
    model_to_use = request.model_name or "gemini-1.5-flash-latest" 
    # O endpoint pode variar, verifique a documentação do Google AI Studio / Vertex AI
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_to_use}:generateContent?key={api_key}"

    prompt_text = (
        f"Você é um assistente de pesquisa especializado. Por favor, realize uma pesquisa aprofundada sobre o seguinte tópico: '{request.nodeContent}'.\n"
        f"{context_narrative}\n"
        f"O objetivo é obter um resumo conciso e informativo sobre este tópico, levando em conta sua posição na hierarquia do mapa mental. "
        f"Não mencione os nós pais explicitamente na sua resposta, mas use-os para entender o sub-tópico em questão.\n"
        f"Resumo da pesquisa:"
    )
    print(f"--- Google Gemini Deep Research (Model: {model_to_use}) ---\nPrompt: {prompt_text}\n-----------------------------")

    payload = {"contents": [{"parts": [{"text": prompt_text}]}]}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            headers = {"Content-Type": "application/json"}
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            # O formato da resposta do Gemini pode variar. Ajuste conforme necessário.
            # Exemplo: data['candidates'][0]['content']['parts'][0]['text']
            if data.get('candidates') and data['candidates'][0].get('content') and data['candidates'][0]['content'].get('parts'):
                return data['candidates'][0]['content']['parts'][0]['text'].strip()
            else:
                print("Google API response format not as expected:", data)
                return "Error: Formato de resposta inesperado do Google API."
    except httpx.RequestError as e:
        print(f"Error contacting Google API: {e}")
        return "Error: Could not connect to Google API service."
    except httpx.HTTPStatusError as e:
        print(f"Google API request failed: {e.response.status_code} - {e.response.text}")
        error_details = e.response.json().get('error', {}).get('message', e.response.text)
        return f"Error: Google API request failed with status {e.response.status_code}. Details: {error_details}"
    except Exception as e:
        print(f"An unexpected error occurred with Google API: {e}")
        return "Error: An unexpected error occurred while processing your request with Google API."

async def suggest_new_nodes_google(request: AISuggestNodesRequest, api_key: Optional[str]) -> List[AISuggestedNode]:
    if not api_key:
        return [AISuggestedNode(content="Error: Google API Key não configurada.")]

    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else "Este é um nó raiz."
    model_to_use = request.model_name or "gemini-1.5-flash-latest"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_to_use}:generateContent?key={api_key}"

    prompt_text = (
        f"Você é um assistente de brainstorming para mapas mentais. O nó atual é '{request.nodeContent}'.\n"
        f"{context_narrative}\n"
        f"Com base neste nó e seu contexto, sugira até 3-5 novos sub-nós ou nós relacionados que poderiam expandir este mapa mental. "
        f"Liste cada sugestão em uma nova linha, sem marcadores ou numeração. Apenas o texto da sugestão."
    )
    print(f"--- Google Gemini Suggest Nodes (Model: {model_to_use}) ---\nPrompt: {prompt_text}\n---------------------------")
    
    payload = {"contents": [{"parts": [{"text": prompt_text}]}]}
    # Configurações de geração para controlar a saída (opcional)
    # generation_config = {
    #     "temperature": 0.7,
    #     "topK": 1,
    #     "topP": 1,
    #     "maxOutputTokens": 2048, # Ajuste conforme necessário
    # }
    # payload["generationConfig"] = generation_config


    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            headers = {"Content-Type": "application/json"}
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

            if data.get('candidates') and data['candidates'][0].get('content') and data['candidates'][0]['content'].get('parts'):
                raw_suggestions = data['candidates'][0]['content']['parts'][0]['text'].strip()
                suggested_nodes = []
                for line in raw_suggestions.split('\n'):
                    cleaned_line = line.strip()
                    if cleaned_line:
                        suggested_nodes.append(AISuggestedNode(content=cleaned_line))
                return suggested_nodes if suggested_nodes else [AISuggestedNode(content="Nenhuma sugestão gerada.")]
            else:
                print("Google API response format not as expected for suggestions:", data)
                return [AISuggestedNode(content="Error: Formato de resposta inesperado do Google API para sugestões.")]

    except httpx.RequestError as e:
        print(f"Error contacting Google API: {e}")
        return [AISuggestedNode(content="Error: Could not connect to Google API service.")]
    except httpx.HTTPStatusError as e:
        print(f"Google API request failed: {e.response.status_code} - {e.response.text}")
        error_details = e.response.json().get('error', {}).get('message', e.response.text)
        return [AISuggestedNode(content=f"Error: Google API request failed. {error_details}")]
    except Exception as e:
        print(f"An unexpected error occurred with Google API: {e}")
        return [AISuggestedNode(content="Error: An unexpected error occurred with Google API.")]
