"""Adapter nativo do Google Gemini (REST — não é OpenAI-compatible)."""
import httpx

from app.providers.base import AIProviderBase, ErrorKind, ProviderCallError

_HTTP_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
# 429 do Gemini: 'per day' = cota diária; sem isso = RPM
DAILY_MARKERS = ("per day", "perday", "resourcedaily")


class GeminiNativeProvider(AIProviderBase):
    id = "gemini"
    label = "Google Gemini"
    base_url = "https://generativelanguage.googleapis.com/v1beta"
    default_model = "gemini-1.5-flash-latest"
    daily_quota_markers = DAILY_MARKERS

    async def complete(self, prompt: str, model: str, api_key: str | None = None) -> str:
        if not api_key:
            raise ProviderCallError(self.id, ErrorKind.UNKNOWN, "api_key ausente")

        # chave vai no HEADER (nunca na query string — v0.3.1)
        headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
        payload = {"contents": [{"parts": [{"text": prompt}]}]}
        url = f"{self.base_url}/models/{model}:generateContent"

        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                response = await client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                "O Gemini não respondeu a tempo (timeout).", status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                "Não foi possível conectar ao Google Gemini.", status_code=503,
            ) from exc

        if response.status_code != 200:
            raise ProviderCallError(
                self.id,
                self.classify(response.status_code, response.text),
                f"O Gemini retornou HTTP {response.status_code}.",
                status_code=self._response_status(response.status_code, response.text),
                retry_after=self.retry_after_from(response),
            )

        data = response.json()
        candidates = data.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts") if candidates else None
        if parts:
            return parts[0]["text"].strip()
        raise ProviderCallError(
            self.id, ErrorKind.PROVIDER_ERROR,
            "O Gemini retornou uma resposta em formato inesperado.", status_code=502,
        )

    def _response_status(self, status_code: int, body: str) -> int:
        kind = self.classify(status_code, body)
        if kind is ErrorKind.QUOTA_EXHAUSTED or kind is ErrorKind.RATE_LIMIT:
            return 429
        return 502
