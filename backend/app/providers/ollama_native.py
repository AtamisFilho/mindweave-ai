"""Adapter nativo do Ollama (localhost — fallback soberano da cadeia)."""
import httpx

from app.providers.base import AIProviderBase, ErrorKind, ProviderCallError

_HTTP_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


class OllamaNativeProvider(AIProviderBase):
    id = "ollama"
    label = "Ollama (local)"
    base_url = "http://localhost:11434"
    default_model = "llama3"
    requires_key = False
    local = True

    async def complete(self, prompt: str, model: str, api_key: str | None = None) -> str:
        payload = {"model": model, "prompt": prompt, "stream": False}
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                response = await client.post(
                    f"{self.base_url.rstrip('/')}/api/generate", json=payload,
                )
        except httpx.TimeoutException as exc:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                "O Ollama não respondeu a tempo (timeout).", status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                "Não foi possível conectar ao Ollama.", status_code=503,
            ) from exc

        if response.status_code != 200:
            raise ProviderCallError(
                self.id,
                self.classify(response.status_code, response.text),
                f"O Ollama retornou HTTP {response.status_code}.",
                status_code=self._response_status(response.status_code, response.text),
                retry_after=self.retry_after_from(response),
            )
        return response.json().get("response", "").strip()

    def _response_status(self, status_code: int, body: str) -> int:
        kind = self.classify(status_code, body)
        if kind is ErrorKind.MODEL_NOT_FOUND:
            return 502
        return 502
