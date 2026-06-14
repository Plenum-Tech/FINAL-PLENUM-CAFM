"""Shared LangChain chat model setup for orchestrator and meta sub-agents."""
from __future__ import annotations

import os
from typing import Any

import httpx
import structlog
from langchain.chat_models import init_chat_model

from .config import settings

log = structlog.get_logger(__name__)


def _normalize_openai_base_url(url: str) -> str:
    """Ensure base URL has a scheme; OpenAI/httpx reject bare hostnames."""
    u = (url or "").strip().rstrip("/")
    if not u:
        return ""
    if not u.startswith(("http://", "https://")):
        u = f"https://{u}"
    return u


def _strip_empty_openai_env() -> None:
    """
    Remove empty OPENAI_* base URL vars from the process environment.

    Docker Compose often injects OPENAI_API_BASE= (empty), which LangChain/OpenAI
    still honor over the default api.openai.com URL and triggers:
    'Request URL is missing an http:// or https:// protocol'.
    """
    for key in ("OPENAI_API_BASE", "OPENAI_BASE_URL", "OPENAI_API_BASE_URL"):
        if not (os.environ.get(key) or "").strip():
            os.environ.pop(key, None)


def friendly_openai_error(exc: Exception) -> str:
    """Map low-level OpenAI/httpx errors to actionable messages."""
    msg = str(exc)
    upper = msg.upper()
    if "MISSING AN 'HTTP://" in upper or "MISSING AN 'HTTPS://" in upper or "UNSUPPORTEDPROTOCOL" in upper:
        return (
            "OpenAI connection failed: invalid API base URL (missing https://). "
            "Remove empty OPENAI_API_BASE / OPENAI_BASE_URL from docker-compose environment, "
            "or set OPENAI_API_BASE=https://api.openai.com/v1 in apps/backend/.env."
        )
    if "CERTIFICATE_VERIFY_FAILED" in upper or "HOSTNAME MISMATCH" in upper:
        return (
            "OpenAI connection failed (SSL certificate hostname mismatch). "
            "This usually means a corporate VPN/proxy is intercepting HTTPS. "
            "For local Docker dev, set OPENAI_SSL_VERIFY=false in apps/backend/.env and "
            "rebuild svc-deepagents. If you use Azure OpenAI, set AZURE_OPENAI_ENDPOINT "
            "and AZURE_OPENAI_DEPLOYMENT instead of public api.openai.com."
        )
    if "APIConnectionError" in type(exc).__name__ or "ConnectError" in type(exc).__name__:
        return f"OpenAI connection failed: {msg}"
    return msg


def _http_clients() -> tuple[httpx.Client | None, httpx.AsyncClient | None]:
    if settings.openai_ssl_verify:
        return None, None
    log.warning(
        "openai.ssl_verify_disabled",
        hint="OPENAI_SSL_VERIFY=false — only use for local dev behind SSL-inspecting proxies",
    )
    return httpx.Client(verify=False), httpx.AsyncClient(verify=False)


def _provider_choice() -> str:
    choice = (settings.cloud_provider or "auto").strip().lower()
    if choice in {"azure", "tencent", "openai"}:
        return choice
    # auto mode
    if settings.azure_openai_endpoint.strip():
        return "azure"
    if settings.tencent_openai_base_url.strip():
        return "tencent"
    return "openai"


def active_provider_snapshot() -> dict[str, Any]:
    """Return active provider info without exposing secrets."""
    provider = _provider_choice()
    info: dict[str, Any] = {"provider": provider, "cloud_provider_setting": settings.cloud_provider}
    if provider == "azure":
        info.update(
            {
                "azure_endpoint_configured": bool(settings.azure_openai_endpoint.strip()),
                "azure_deployment": (settings.azure_openai_deployment or settings.openai_model),
                "azure_api_version": settings.azure_openai_api_version,
            }
        )
    elif provider == "tencent":
        info.update(
            {
                "tencent_base_configured": bool(settings.tencent_openai_base_url.strip()),
                "tencent_model": settings.tencent_openai_model,
            }
        )
    else:
        info.update(
            {
                "openai_model": settings.openai_model,
                "openai_base_configured": bool((settings.openai_api_base or "").strip()),
            }
        )
    return info


def create_chat_model(
    *,
    api_key: str | None = None,
    model: str | None = None,
) -> Any:
    """
    Build the orchestrator LLM from settings.

    Priority:
      1. Azure OpenAI when AZURE_OPENAI_ENDPOINT is set
      2. Public OpenAI with optional OPENAI_API_BASE override
    """
    provider = _provider_choice()
    key = (api_key or settings.openai_api_key or "").strip()
    model_name = (model or settings.openai_model or "gpt-4o-mini").strip()
    sync_client, async_client = _http_clients()
    extra: dict[str, Any] = {"temperature": 0, "api_key": key}
    if sync_client is not None:
        extra["http_client"] = sync_client
    if async_client is not None:
        extra["http_async_client"] = async_client

    if provider == "azure":
        deployment = (settings.azure_openai_deployment or model_name).strip()
        log.info(
            "openai.using_azure",
            endpoint=settings.azure_openai_endpoint[:64],
            deployment=deployment,
        )
        return init_chat_model(
            f"azure_openai:{deployment}",
            azure_endpoint=settings.azure_openai_endpoint.strip().rstrip("/"),
            azure_deployment=deployment,
            api_version=settings.azure_openai_api_version,
            **extra,
        )

    if provider == "tencent":
        tencent_base = _normalize_openai_base_url(settings.tencent_openai_base_url)
        tencent_key = (settings.tencent_openai_api_key or key).strip()
        tencent_model = (model or settings.tencent_openai_model or model_name).strip()
        log.info("openai.using_tencent", base_url=tencent_base[:80], model=tencent_model)
        return init_chat_model(
            f"openai:{tencent_model}",
            api_key=tencent_key,
            base_url=tencent_base,
            temperature=0,
            **({} if sync_client is None else {"http_client": sync_client}),
            **({} if async_client is None else {"http_async_client": async_client}),
        )

    base = _normalize_openai_base_url(settings.openai_api_base)
    if not base:
        env_raw = (
            os.environ.get("OPENAI_BASE_URL", "").strip()
            or os.environ.get("OPENAI_API_BASE", "").strip()
        )
        base = _normalize_openai_base_url(env_raw)

    if base:
        log.info("openai.using_custom_base", base_url=base[:80])
        extra["base_url"] = base

    log.info("openai.using_public_api", model=model_name, ssl_verify=settings.openai_ssl_verify)
    return init_chat_model(f"openai:{model_name}", **extra)
