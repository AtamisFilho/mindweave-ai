"""Endpoint de geração de mapa (v0.4.5 B3): cadeia + parse robusto + retry.

Fluxo por provedor da cadeia: complete() -> parse; falha de parse -> 1 retry
no MESMO provedor; falha de novo -> próximo da cadeia. Se todos falharem
(chamada ou parse) -> erro estruturado com a trilha.
"""
from fastapi import APIRouter, Body, HTTPException

from app.core.errors import AIProviderError, ErrorCode, ErrorKind
from app.providers import PROVIDERS
from app.services import keys_service
from app.services.chain_executor import _apply_cooldown, build_chain, provider_in_cooldown
from app.services.generation_service import (
    build_generation_prompt,
    parse_generated_tree,
)

router = APIRouter()


@router.post("/generate")
async def generate_map(request: dict = Body(...)):
    topic = str(request.get("topic") or "").strip()
    depth = int(request.get("depth") or 3)
    breadth = int(request.get("breadth") or 5)
    if not topic:
        raise AIProviderError(
            ErrorCode.UNKNOWN_PROVIDER,
            "Tópico é obrigatório.", "chain", status_code=400,
            kind=ErrorKind.UNKNOWN,
        )
    depth = max(2, min(depth, 3))
    breadth = max(2, min(breadth, 5))

    chain = build_chain()
    if not chain:
        raise AIProviderError(
            ErrorCode.KEY_NOT_CONFIGURED,
            "Nenhum provedor configurado na cadeia.", "chain",
            status_code=400, kind=ErrorKind.KEY_NOT_CONFIGURED,
        )

    trail: list[dict] = []
    last_message = "Nenhum provedor tentado."
    prompt = build_generation_prompt(topic, depth, breadth)
    retry_prompt = (
        f"{prompt}\n\nSua resposta anterior não era JSON válido. "
        "Responda NOVAMENTE, apenas com o JSON válido, sem nenhum outro texto."
    )

    last_message = "Nenhum provedor tentado."
    for provider_id in chain:
        provider = PROVIDERS[provider_id]
        if provider_in_cooldown(provider_id):
            trail.append({"provider": provider.label, "kind": "RATE_LIMIT",
                          "message": "cooldown", "skipped": True})
            continue
        api_key = keys_service.get_key(provider_id) if provider.requires_key else None

        for attempt in (1, 2):  # 1 tentativa + 1 retry de parse no mesmo provedor
            use_prompt = prompt if attempt == 1 else retry_prompt
            try:
                content = await provider.complete(use_prompt, provider.default_model, api_key)
            except Exception as exc:  # noqa: BLE001
                kind = getattr(exc, "kind", None) or ErrorKind.NETWORK_ERROR
                last_message = str(exc)[:200]
                trail.append({"provider": provider.label, "kind": kind.value,
                              "message": str(exc)[:200]})
                _apply_cooldown(provider_id, kind, getattr(exc, "retry_after", None))
                break  # falha de chamada: pula para o próximo provedor
            try:
                tree = parse_generated_tree(
                    content, max_depth=depth, max_breadth=breadth,
                )
            except Exception as exc:  # noqa: BLE001 — parse falhou: 1 retry no mesmo provedor
                last_message = str(exc)[:200]
                trail.append({"provider": provider.label, "kind": "GENERATION_PARSE_FAILED",
                              "message": str(exc)[:200], "attempt": attempt})
                if attempt == 1:
                    continue  # retry de parse no mesmo provedor
                break
            return {"title": topic, "tree": tree, "provider_used": provider.label,
                    "fallback_trail": trail}

    raise HTTPException(status_code=503, detail={
        "error_code": "ALL_PROVIDERS_FAILED",
        "message": f"Todos os provedores falharam ao gerar o mapa sobre '{topic}'. Último motivo: {last_message}",
        "fallback_trail": trail,
    })
