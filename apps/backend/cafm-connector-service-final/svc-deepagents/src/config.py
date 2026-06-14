from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings

# Walk up from this file's location to find the nearest .env
# Works regardless of which directory uvicorn is launched from.
def _find_env_file() -> str | None:
    here = Path(__file__).resolve().parent
    for _ in range(6):
        candidate = here / ".env"
        if candidate.exists():
            return str(candidate)
        here = here.parent
    return None

_ENV_FILE = _find_env_file()


class Settings(BaseSettings):
    # Database
    db_url: str = Field(..., validation_alias=AliasChoices("DB_URL", "DATABASE_URL", "db_url"))

    # OpenAI — main orchestrator
    openai_api_key: str = Field("", validation_alias=AliasChoices("OPENAI_API_KEY", "openai_api_key"))
    openai_model: str = "gpt-4o-mini"
    openai_api_base: str = Field(
        "",
        validation_alias=AliasChoices("OPENAI_API_BASE", "OPENAI_BASE_URL", "OPENAI_API_BASE_URL"),
    )
    openai_ssl_verify: bool = Field(
        True,
        validation_alias=AliasChoices("OPENAI_SSL_VERIFY"),
    )
    # Cloud provider routing for orchestrator LLM:
    # - auto: use Azure when configured, else Tencent when configured, else OpenAI.
    # - azure: force Azure OpenAI path.
    # - tencent: force Tencent OpenAI-compatible path.
    # - openai: force public/custom OpenAI path.
    cloud_provider: str = Field(
        "auto",
        validation_alias=AliasChoices("CLOUD_PROVIDER"),
    )
    # Azure OpenAI (preferred in enterprise) — when endpoint is set, public api.openai.com is not used
    azure_openai_endpoint: str = Field(
        "",
        validation_alias=AliasChoices("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_BASE"),
    )
    azure_openai_api_key: str = Field(
        "",
        validation_alias=AliasChoices("AZURE_OPENAI_API_KEY"),
    )
    azure_openai_deployment: str = Field(
        "",
        validation_alias=AliasChoices(
            "AZURE_OPENAI_DEPLOYMENT",
            "AZURE_OPENAI_DEPLOYMENT_NAME",
        ),
    )
    azure_openai_api_version: str = Field(
        "2024-08-01-preview",
        validation_alias=AliasChoices("AZURE_OPENAI_API_VERSION", "OPENAI_API_VERSION"),
    )
    # Tencent Cloud (OpenAI-compatible endpoint)
    tencent_openai_base_url: str = Field(
        "",
        validation_alias=AliasChoices(
            "TENCENT_OPENAI_BASE_URL",
            "TENCENT_API_BASE_URL",
        ),
    )
    tencent_openai_api_key: str = Field(
        "",
        validation_alias=AliasChoices(
            "TENCENT_OPENAI_API_KEY",
            "TENCENT_API_KEY",
        ),
    )
    tencent_openai_model: str = Field(
        "hunyuan-lite",
        validation_alias=AliasChoices("TENCENT_OPENAI_MODEL"),
    )

    # Anthropic — available for future subagent use
    anthropic_api_key: str = Field("", validation_alias=AliasChoices("ANTHROPIC_API_KEY", "anthropic_api_key"))

    # Downstream service URLs
    # NOTE: UDR (user/data lookup) uses direct DB access — no HTTP svc-udr needed
    wo_engine_base_url: str = "http://localhost:8001"       # svc-ingestion (legacy alias kept)
    wo_management_base_url: str = "http://localhost:8007"   # svc-work-order-management
    udr_base_url: str = "http://localhost:8006"
    doc_rag_base_url: str = "http://localhost:8004"
    migration_base_url: str = "http://localhost:8003"
    deep_agents_upload_dir: str = "/tmp/deepagents_uploads"
    deep_agents_max_upload_mb: int = Field(
        50,
        validation_alias=AliasChoices("DEEP_AGENTS_MAX_UPLOAD_MB"),
    )
    ingest_batch_inline_threshold: int = Field(
        3,
        validation_alias=AliasChoices("INGEST_BATCH_INLINE_THRESHOLD"),
    )
    ingest_batch_concurrency: int = Field(
        4,
        validation_alias=AliasChoices("INGEST_BATCH_CONCURRENCY"),
    )
    doc_match_confidence_threshold: float = Field(
        0.25,
        validation_alias=AliasChoices("DOC_MATCH_CONFIDENCE_THRESHOLD"),
    )
    doc_match_max_rows_in_report: int = Field(
        20,
        validation_alias=AliasChoices("DOC_MATCH_MAX_ROWS_IN_REPORT"),
    )
    # Phase 6 — optional object-storage connectors (stubs until drivers wired)
    azure_storage_connection_string: str = Field(
        "",
        validation_alias=AliasChoices("AZURE_STORAGE_CONNECTION_STRING"),
    )
    azure_storage_account: str = Field(
        "",
        validation_alias=AliasChoices("AZURE_STORAGE_ACCOUNT"),
    )
    tencent_cos_secret_id: str = Field(
        "",
        validation_alias=AliasChoices("TENCENT_COS_SECRET_ID"),
    )
    tencent_cos_secret_key: str = Field(
        "",
        validation_alias=AliasChoices("TENCENT_COS_SECRET_KEY"),
    )

    # Service config
    port: int = 8008
    debug: bool = False
    # HITL: enables interrupt() gates in migration tools + Postgres checkpointer
    hitl_enabled: bool = True

    # LangSmith tracing (zero-instrumentation — set env vars and LangChain auto-traces)
    langsmith_api_key: str = Field("", validation_alias=AliasChoices("LANGSMITH_API_KEY", "langsmith_api_key"))
    langsmith_project: str = Field("cafm-deepagents", validation_alias=AliasChoices("LANGSMITH_PROJECT", "langsmith_project"))
    langsmith_tracing: bool = Field(False, validation_alias=AliasChoices("LANGSMITH_TRACING", "langsmith_tracing"))

    class Config:
        env_file = _ENV_FILE  # absolute path — works from any working directory
        extra = "ignore"


settings = Settings()
