"""Fricção #2 (v0.6.1.1): modelos de raciocínio no LM Studio.

O qwen distill do usuário faz stream de delta.reasoning_content por minutos
(nada de content) — o adapter não gerava token NENHUM: ou estourava o read
timeout de 60s (classificado NETWORK_ERROR → toast "indisponível" com a
probe dizendo "no ar") ou terminava [DONE] sem conteúdo e virava "done"
com resposta vazia.

Fixture com o corpo REAL capturado na máquina do usuário (mock mode
stream-reasoning): reasoning-only + [DONE].
"""
import respx
from httpx import Response

from app.providers import get_provider
from app.providers.base import ProviderCallError


def _sse_reasoning_only() -> str:
    return (
        'data: {"choices":[{"delta":{"reasoning_content":"pensando..."}}]}\n\n'
        'data: {"choices":[{"delta":{"reasoning_content":"ainda pensando"}}]}\n\n'
        "data: [DONE]\n\n"
    )


def _sse_reasoning_then_content() -> str:
    return (
        'data: {"choices":[{"delta":{"reasoning_content":"pensando..."}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"resposta final"}}]}\n\n'
        "data: [DONE]\n\n"
    )


@respx.mock
async def test_reasoning_sem_content_vira_erro_com_mensagem_honesta():
    """[DONE] sem NENHUM content = erro PROVIDER_ERROR com motivo claro —
    não 'done' com resposta vazia, não 'indisponível' genérico."""
    provider = get_provider("lmstudio")
    respx.post("http://localhost:1234/v1/chat/completions").mock(
        return_value=Response(200, text=_sse_reasoning_only(),
                              headers={"Content-Type": "text/event-stream"})
    )
    try:
        deltas = [d async for d in provider.complete_stream("prompt", "qwen3.8-9b-distill", None)]
        raise AssertionError(f"deveria ter falhado; deltas={deltas}")
    except ProviderCallError as exc:
        assert exc.kind.value == "PROVIDER_ERROR"
        assert "sem conteúdo" in str(exc)


@respx.mock
async def test_reasoning_antes_do_content_nao_vaza_resposta():
    """Reasoning não é resposta: só o delta.content é entregue."""
    provider = get_provider("lmstudio")
    respx.post("http://localhost:1234/v1/chat/completions").mock(
        return_value=Response(200, text=_sse_reasoning_then_content(),
                              headers={"Content-Type": "text/event-stream"})
    )
    deltas = [d async for d in provider.complete_stream("prompt", "qwen3.8-9b-distill", None)]
    assert deltas == ["resposta final"]


@respx.mock
async def test_reasoning_timeout_nao_mais_60s_para_local():
    """Local usa timeout generoso (600s): prefill/pensamento longo não vira
    NETWORK_ERROR 'indisponível'."""
    provider = get_provider("lmstudio")
    assert provider.local is True
    assert provider._timeout().read == 600.0

    remoto = get_provider("openai")
    assert remoto.local is False
    assert remoto._timeout().read == 60.0


@respx.mock
async def test_fallback_com_motivo_real_na_trilha(client, monkeypatch):
    """LM Studio raciocina e cala (stream) → cadeia cai para o próximo ANTES
    do commit e a trilha carrega o MOTIVO REAL, não 'indisponível'."""
    import json as _json

    from app.services import chain_executor

    monkeypatch.setattr(chain_executor, "build_chain", lambda preferred=None: ["lmstudio", "ollama"])
    respx.post("http://localhost:1234/v1/chat/completions").mock(
        return_value=Response(200, text=_sse_reasoning_only(),
                              headers={"Content-Type": "text/event-stream"})
    )
    respx.post("http://localhost:11434/api/generate").mock(
        return_value=Response(200, json={"response": "resposta do ollama", "done": True})
    )

    events = []
    async with client.stream("POST", "/api/v1/ai/deep-research/stream", json={
        "nodeId": "n1", "nodeContent": "T",
    }) as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("data: "):
                events.append(_json.loads(line[6:]))

    if not any(e.get("status") == "failed" for e in events):
        raise AssertionError(f"sem failed; events={events}")
    falha = next(e for e in events if e.get("status") == "failed")
    assert falha["provider_label"] == "LM Studio (local)"
    assert "sem conteúdo" in falha["message"]
    assert falha["kind"] == "PROVIDER_ERROR"
    done = next(e for e in events if e.get("event") == "done")
    assert done["provider_used"] == "Ollama (local)"
