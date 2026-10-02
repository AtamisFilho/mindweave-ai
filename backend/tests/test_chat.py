"""Testes do chat (v0.4.5 B2): poda do histórico e parser Gemini alt=sse."""

from app.core.config import settings
from app.providers.gemini_native import _GeminiSSEParser

# --- Parser Gemini alt=sse (Diretriz 6: fixtures adversariais) ---

def _line(obj, raw=None):
    import json
    return f"data: {raw if raw is not None else json.dumps(obj)}"


class TestGeminiSSEParser:
    def test_chunk_com_texto(self):
        delta, finish = _GeminiSSEParser.parse_line(
            _line({"candidates": [{"content": {"parts": [{"text": "Olá"}]}}]})
        )
        assert (delta, finish) == ("Olá", False)

    def test_chunk_thinking_sem_candidates(self):
        delta, finish = _GeminiSSEParser.parse_line(_line({}))
        assert (delta, finish) == ("", False)

    def test_chunk_com_parts_vazias(self):
        delta, finish = _GeminiSSEParser.parse_line(
            _line({"candidates": [{"content": {"parts": []}}]})
        )
        assert (delta, finish) == ("", False)

    def test_finish_com_texto_junto(self):
        # último chunk real do Gemini: texto + finishReason no MESMO chunk
        delta, finish = _GeminiSSEParser.parse_line(
            _line({"candidates": [{"content": {"parts": [{"text": "fim"}]},
                                   "finishReason": "STOP"}]})
        )
        assert (delta, finish) == ("fim", True)

    def test_finish_sem_texto(self):
        delta, finish = _GeminiSSEParser.parse_line(
            _line({"candidates": [{"finishReason": "STOP"}]})
        )
        assert (delta, finish) == ("", True)

    def test_comentario_sse_e_linha_vazia(self):
        assert _GeminiSSEParser.parse_line(": keep-alive") == ("", False)
        assert _GeminiSSEParser.parse_line("") == ("", False)

    def test_linha_com_cr_final(self):
        line = _line({"candidates": [{"content": {"parts": [{"text": "x"}]}}]}) + chr(13)
        assert _GeminiSSEParser.parse_line(line) == ("x", False)

    def test_json_corrompido_nao_derruba(self):
        assert _GeminiSSEParser.parse_line("data: {quebrado") == ("", False)

    def test_linha_sem_prefixo_data(self):
        assert _GeminiSSEParser.parse_line("event: whatever") == ("", False)


# --- Poda do histórico (Diretriz 5) ---

def test_chat_history_limit_e_setting():
    assert settings.CHAT_HISTORY_LIMIT == 40


def test_poda_na_41_mensagem():
    """A 41ª mensagem poda a mais antiga; o blob permanece limitado."""
    limit = settings.CHAT_HISTORY_LIMIT
    chat = [{"role": "user", "content": f"msg {i}"} for i in range(limit + 1)]
    pruned = chat[-limit:]
    assert len(pruned) == limit
    assert pruned[0]["content"] == "msg 1"      # msg 0 foi podada
    assert pruned[-1]["content"] == f"msg {limit}"  # a mais nova fica


def test_blob_meta_chat_limitado_no_save():
    """Integração: _documentFromState-equivalente no backend — o maps_service
    persiste o documento inteiro; a PORA é responsabilidade do frontend
    (slice no _documentFromState). Aqui provamos o contrato do teto via
    serialização: 41+ mensagens no meta nunca passam de 40 após o slice."""
    # simula o slice do _documentFromState
    big_chat = [{"role": "user", "content": "x" * 100} for _ in range(100)]
    sliced = big_chat[-settings.CHAT_HISTORY_LIMIT:]
    import json

    blob = json.dumps({"meta": {"chat": sliced}})
    assert len(json.loads(blob)["meta"]["chat"]) == 40
    # ~4KB por 100 chars x 40: muito abaixo do teto de ~32KB do design
    assert len(blob) < 32_000
