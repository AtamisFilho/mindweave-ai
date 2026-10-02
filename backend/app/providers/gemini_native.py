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
    supports_stream = True

    async def complete(self, prompt: str, model: str, api_key: str | None = None,
                       base_url: str | None = None) -> str:  # noqa: ARG002 — base_url só p/ OpenAI-compatible
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

    async def complete_stream(self, prompt: str, model: str, api_key: str | None = None,
                              base_url: str | None = None):  # noqa: ARG002
        """Streaming alt=sse do Gemini (v0.4.5).

        Parser próprio (_GeminiSSEParser): o formato difere do OpenAI —
        chunks sem candidates/parts são válidos (thinking) e são pulados.
        Fim legítimo: HTTP encerra com finishReason no último chunk — se
        zero texto foi emitido e a conexão caiu, é truncamento.
        """
        if not api_key:
            raise ProviderCallError(self.id, ErrorKind.UNKNOWN, "api_key ausente")

        headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
        payload = {"contents": [{"parts": [{"text": prompt}]}]}
        url = f"{self.base_url}/models/{model}:streamGenerateContent?alt=sse"

        emitted_any = False
        saw_finish = False
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode(errors="replace")
                        raise ProviderCallError(
                            self.id,
                            self.classify(response.status_code, body),
                            f"O Gemini retornou HTTP {response.status_code}.",
                            status_code=self._response_status(response.status_code, body),
                            retry_after=self.retry_after_from(response),
                        )
                    async for line in response.aiter_lines():
                        delta, finish = _GeminiSSEParser.parse_line(line)
                        if finish:
                            saw_finish = True
                        if delta:
                            emitted_any = True
                            yield delta
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

        if not emitted_any and not saw_finish:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                "O Gemini interrompeu o stream antes de concluir.",
                status_code=502,
            )

    def _response_status(self, status_code: int, body: str) -> int:
        kind = self.classify(status_code, body)
        if kind is ErrorKind.QUOTA_EXHAUSTED or kind is ErrorKind.RATE_LIMIT:
            return 429
        return 502


# ---------------------------------------------------------------------------
# Streaming (v0.4.5): streamGenerateContent?alt=sse — parser PRÓPRIO.
# O formato Gemini-SSE difere do OpenAI: cada bloco data: é um chunk de
# candidates; chunks sem parts (thinking/throttling) são válidos e pulamos.
# ---------------------------------------------------------------------------

GEMINI_SENTINEL = "FINISH"


class _GeminiSSEParser:
    """Parser de linha do alt=sse do Gemini (v0.4.5).

    Cada linha 'data: {json}' pode conter texto em
    candidates[0].content.parts[*].text. Retorna (delta, finish):
    - delta: texto do chunk ('' se nenhum)
    - finish: True quando o chunk carrega finishReason (fim legítimo)
    Casos sem texto e sem finish (comentários ':', linhas vazias, chunks de
    thinking sem candidates, JSON corrompido) -> ('', False).
    Feito para aiter_lines() (httpx entrega linhas completas).
    """

    @staticmethod
    def parse_line(line: str) -> tuple[str, bool]:
        line = line.rstrip(chr(13))
        if not line.startswith("data:"):
            return ("", False)
        payload = line[len("data:"):].strip()
        if not payload:
            return ("", False)
        import json as _json

        try:
            chunk = _json.loads(payload)
        except ValueError:
            return ("", False)  # wire corrompido no bloco: ignora, não derruba
        candidates = chunk.get("candidates") or []
        if not candidates:
            return ("", False)  # thinking/throttling: válido, sem texto
        parts = (candidates[0].get("content") or {}).get("parts") or []
        delta = "".join(p.get("text", "") for p in parts)
        finish = bool(candidates[0].get("finishReason"))
        return (delta, finish)
