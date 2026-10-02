"""Testes do execute_chain_stream (v0.4.5 B1).

Stub adapters — prova o protocolo de eventos, o commit point (fallback
só ANTES do primeiro token), o abort do cliente fechando o upstream e o
log de TTFT (metadados apenas).
"""
import logging

import pytest

from app.services import chain_config_service, chain_executor


class StubProvider:
    """Adapter fake com generator rastreável (aclose = fechamento do upstream)."""

    def __init__(self, pid, deltas, fail_after=999, error=None, supports_stream=True):
        self.id = pid
        self.label = pid.upper()
        self.base_url = ""
        self.default_model = "stub-model"
        self.requires_key = False
        self.local = False
        self.supports_stream = supports_stream
        self.deltas = deltas
        self.fail_after = fail_after
        self.error = error
        self.closed = False

    async def complete(self, prompt, model, api_key=None):
        return "".join(self.deltas)

    async def complete_stream(self, prompt, model, api_key=None):
        try:
            emitted = 0
            for delta in self.deltas:
                if emitted >= self.fail_after:
                    raise self.error or RuntimeError("upstream morreu")
                emitted += 1
                yield delta
        finally:
            self.closed = True


@pytest.fixture(autouse=True)
def reset_state():
    chain_executor.reset_cooldowns()
    yield
    chain_executor.reset_cooldowns()


def install_providers(monkeypatch, providers):
    monkeypatch.setattr(chain_executor, "PROVIDERS", providers)
    monkeypatch.setattr(
        chain_config_service, "get_chain_config",
        lambda: [{"provider": p, "enabled": True, "order": i, "model": None}
                 for i, p in enumerate(providers)],
    )


async def collect(gen):
    events = []
    async for ev in gen:
        events.append(ev)
    return events


async def test_fallback_antes_do_commit(monkeypatch):
    a = StubProvider("alfa", ["x"], fail_after=0, error=RuntimeError("fora do ar"))
    b = StubProvider("beta", ["ok"])
    install_providers(monkeypatch, {"alfa": a, "beta": b})

    events = await collect(chain_executor.execute_chain_stream("prompt"))

    statuses = [(e["provider_label"], e.get("status")) for e in events if e["event"] == "chain"]
    assert statuses == [("ALFA", "trying"), ("ALFA", "failed"), ("BETA", "trying"), ("BETA", "committed")]
    done = events[-1]
    assert done["event"] == "done"
    assert done["provider_used"] == "BETA"  # label (contrato REST)
    assert done["fallback_trail"][0]["kind"] == "UNKNOWN"  # RuntimeError puro sem kind
    assert a.closed is True  # upstream do alfa foi fechado ao cair para o beta


async def test_commit_point_sem_fallback_depois(monkeypatch):
    a = StubProvider("alfa", ["parcial", "resto-que-nunca-vem"], fail_after=1, error=RuntimeError("morreu no meio"))
    b = StubProvider("beta", ["ok"])
    install_providers(monkeypatch, {"alfa": a, "beta": b})

    events = await collect(chain_executor.execute_chain_stream("prompt"))

    kinds = [e["event"] for e in events]
    assert kinds == ["chain", "chain", "token", "error"]
    err = events[-1]
    assert err["error_code"] == "PROVIDER_STREAM_INTERRUPTED"
    assert err["retryable"] is True
    assert err["fallback_trail"][0]["provider"] == "ALFA"
    # NUNCA caiu para o beta após o commit
    assert all(e.get("provider_label") != "BETA" for e in events if e["event"] == "chain")


async def test_abort_do_cliente_fecha_upstream(monkeypatch):
    a = StubProvider("alfa", ["a", "b", "c"])
    install_providers(monkeypatch, {"alfa": a})

    gen = chain_executor.execute_chain_stream("prompt")
    # consome até o PRIMEIRO TOKEN (upstream aberto) e abandona: simula
    # disconnect com conexão ativa contra o provedor
    ev1 = await gen.__anext__()
    assert ev1["event"] == "chain"
    ev2 = await gen.__anext__()
    assert ev2["event"] == "chain" and ev2["status"] == "committed"
    ev3 = await gen.__anext__()
    assert ev3["event"] == "token"
    await gen.aclose()

    assert a.closed is True  # fechamento propaga até o httpx do adapter


async def test_adapter_sem_stream_vira_um_token(monkeypatch):
    a = StubProvider("alfa", ["texto completo"], supports_stream=False)
    install_providers(monkeypatch, {"alfa": a})

    events = await collect(chain_executor.execute_chain_stream("prompt"))
    kinds = [e["event"] for e in events]
    assert kinds == ["chain", "chain", "token", "done"]
    assert events[-2]["delta"] == "texto completo"


async def test_todos_falham_vira_erro_com_trilha(monkeypatch):
    a = StubProvider("alfa", ["x"], fail_after=0, error=RuntimeError("fora"))
    b = StubProvider("beta", ["x"], fail_after=0, error=RuntimeError("fora"))
    install_providers(monkeypatch, {"alfa": a, "beta": b})

    events = await collect(chain_executor.execute_chain_stream("prompt"))
    err = events[-1]
    assert err["event"] == "error"
    assert err["error_code"] == "ALL_PROVIDERS_FAILED"
    assert len(err["fallback_trail"]) == 2
    assert err["retryable"] is True


async def test_ttft_logado_em_debug_sem_conteudo(monkeypatch, caplog):
    a = StubProvider("alfa", ["delta"])
    install_providers(monkeypatch, {"alfa": a})

    with caplog.at_level(logging.DEBUG, logger="app.chain"):
        await collect(chain_executor.execute_chain_stream("prompt"))

    ttft_lines = [r.getMessage() for r in caplog.records if "TTFT" in r.getMessage()]
    assert ttft_lines, "TTFT deveria estar logado em DEBUG"
    assert "provider=alfa" in ttft_lines[0]
    assert "SEGREDO" not in caplog.text  # metadata apenas
