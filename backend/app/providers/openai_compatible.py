"""Adapter para provedores OpenAI-compatible.

Cobre com UMA classe: Groq, OpenRouter, Cerebras, DeepSeek, OpenAI e
LM Studio (local) — basta base_url + modelo default. LM Studio usa
api_key placeholder (o header Authorization é exigido, o valor não).
"""
import json

import httpx

from app.providers.base import AIProviderBase, ErrorKind, ProviderCallError

_HTTP_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
# Modelos de raciocínio locais (ex.: qwen distill no LM Studio) processam o
# prompt e "pensam" por MINUTOS antes do primeiro token de conteúdo — e podem
# ficar >60s sem emitir NADA (prefill longo). Local não tem quota: timeout
# generoso. (Fricção #2: 60s de read timeout classificava como
# NETWORK_ERROR e o toast dizia "indisponível" com a probe dizendo "no ar".)
_LOCAL_HTTP_TIMEOUT = httpx.Timeout(600.0, connect=10.0)


class OpenAICompatibleProvider(AIProviderBase):
    def __init__(self, *, id: str, label: str, base_url: str, default_model: str,
                 requires_key: bool = True, local: bool = False,
                 daily_quota_markers: tuple[str, ...] = ()):
        self.id = id
        self.label = label
        self.base_url = base_url
        self.default_model = default_model
        self.requires_key = requires_key
        self.local = local
        # 429 cujo corpo contém estes marcadores é COTA DIÁRIA (não RPM)
        self.daily_quota_markers = daily_quota_markers
        self.supports_stream = True

    def _timeout(self) -> httpx.Timeout:
        return _LOCAL_HTTP_TIMEOUT if self.local else _HTTP_TIMEOUT

    async def complete(self, prompt: str, model: str, api_key: str | None = None,
                       base_url: str | None = None) -> str:
        if self.requires_key and not api_key:
            # o chain executor pula provedores sem chave ANTES de chamar;
            # isso é rede de segurança
            raise ProviderCallError(self.id, ErrorKind.UNKNOWN, "api_key ausente")

        headers = {"Authorization": f"Bearer {api_key or 'lm-studio'}"}
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout()) as client:
                response = await client.post(
                    f"{(base_url or self.base_url).rstrip('/')}/chat/completions",
                    json=payload,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                f"{self.label} não respondeu a tempo (timeout).",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                f"Não foi possível conectar ao {self.label}.",
                status_code=503,
            ) from exc

        if response.status_code != 200:
            raise ProviderCallError(
                self.id,
                self.classify(response.status_code, response.text),
                f"{self.label} retornou HTTP {response.status_code}.",
                status_code=self._map_status(response.status_code, response),
                retry_after=self.retry_after_from(response),
            )

        data = response.json()
        message = data["choices"][0].get("message", {})
        content = (message.get("content") or "").strip()
        if not content:
            # modelo de raciocínio: pode vir tudo em reasoning_content com
            # content vazio — devolve o que o modelo de fato produziu
            content = (message.get("reasoning_content") or "").strip()
        return content

    async def complete_stream(self, prompt: str, model: str, api_key: str | None = None,
                              base_url: str | None = None):
        """Streaming SSE do provedor: yields de delta.content.

        Erros ANTES do primeiro token viram ProviderCallError (o chain pode
        cair para o próximo provedor). O stream termina com [DONE]; fim sem
        [DONE] = truncamento → erro (o executor vira PROVIDER_STREAM_INTERRUPTED).
        """
        if self.requires_key and not api_key:
            raise ProviderCallError(self.id, ErrorKind.UNKNOWN, "api_key ausente")

        headers = {"Authorization": f"Bearer {api_key or 'lm-studio'}"}
        payload = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": True}
        saw_done = False

        yielded_any = False
        try:
            async with httpx.AsyncClient(timeout=self._timeout()) as client:
                async with client.stream(
                    "POST", f"{(base_url or self.base_url).rstrip('/')}/chat/completions",
                    json=payload, headers=headers,
                ) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode(errors="replace")
                        raise ProviderCallError(
                            self.id,
                            self.classify(response.status_code, body),
                            f"{self.label} retornou HTTP {response.status_code}.",
                            status_code=self._map_status(response.status_code, response),
                            retry_after=self.retry_after_from(response),
                        )
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[len("data:"):].strip()
                        if data == "[DONE]":
                            saw_done = True
                            break
                        if not data:
                            continue
                        chunk = json.loads(data)
                        delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                        if delta.get("content"):
                            yielded_any = True
                            yield delta["content"]
                        # reasoning_content (modelos de raciocínio) NÃO é resposta:
                        # não vira token — mas mantém a conexão viva e o fluxo
                        # honesto (o done sem NENHUM conteúdo vira erro abaixo)
        except httpx.TimeoutException as exc:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                f"{self.label} não respondeu a tempo (timeout).", status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                f"Não foi possível conectar ao {self.label}.", status_code=503,
            ) from exc

        if not saw_done:
            # conexão fechou sem o sentinel: resposta truncada — NUNCA apresentar como completa
            raise ProviderCallError(
                self.id, ErrorKind.NETWORK_ERROR,
                f"{self.label} interrompeu o stream antes de concluir.",
                status_code=502,
            )
        if not yielded_any:
            # modelo respondeu [DONE] sem NENHUM conteúdo (raciocinou e calou,
            # ou esgotou tokens no thinking) — antes disto virava "done" com
            # texto vazio, ou estourava timeout a montante como "indisponível"
            raise ProviderCallError(
                self.id, ErrorKind.PROVIDER_ERROR,
                f"{self.label} respondeu sem conteúdo (modelo de raciocínio sem resposta final?). "
                "Tente um modelo não-distill ou aumente o limite de tokens no servidor.",
                status_code=502,
            )

    def _map_status(self, status_code: int, response: httpx.Response) -> int:
        """HTTP que o MindWeave devolve ao frontend para o erro do provedor."""
        kind = self.classify(status_code, response.text)
        if kind is ErrorKind.QUOTA_EXHAUSTED or kind is ErrorKind.RATE_LIMIT:
            return 429
        if kind is ErrorKind.NETWORK_ERROR:
            return 503
        if kind in (ErrorKind.INVALID_KEY, ErrorKind.MODEL_NOT_FOUND, ErrorKind.PROVIDER_ERROR):
            return 502
        return 502
