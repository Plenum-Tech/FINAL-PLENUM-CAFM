"""Application configuration loaded from environment variables."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    app_name: str = "rag-platform"
    app_env: str = "development"
    log_level: str = "INFO"

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # Dev mode — set USE_SQLITE_DEV=false to use PostgreSQL.
    # When DB_URL is set, PostgreSQL is used automatically (plenum_cafm row-index APIs).
    use_sqlite_dev: bool = True

    # CMMS schema for raw table import / document_id writes (default plenum_cafm).
    plenum_cmms_schema: str = "plenum_cafm"

    # DB_URL takes priority when set (same convention as every other service).
    # Use the psycopg (sync) driver variant, e.g.:
    #   postgresql+psycopg://user:pass@host:5432/db?sslmode=require
    # The asyncpg variant (postgresql+asyncpg://...) will be rewritten automatically.
    db_url: str = ""

    # SQLite
    sqlite_path: str = "./data/rag_platform.db"

    # Anthropic (PDF extraction)
    anthropic_api_key: str = ""
    claude_pdf_model: str = "claude-sonnet-4-6"

    # OpenAI (embeddings)
    openai_api_key: str = ""
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dim: int = 1536
    openai_llm_model: str = "gpt-4o-mini"

    # Storage
    upload_dir: str = "./data/uploads"

    # Retrieval tuning
    chunk_size_tokens: int = 500
    chunk_overlap_tokens: int = 80
    top_k_vector: int = 20
    top_k_bm25: int = 20
    top_k_final: int = 8
    hybrid_vector_weight: float = 0.6
    hybrid_bm25_weight: float = 0.4

    @property
    def effective_use_sqlite_dev(self) -> bool:
        """Use Postgres when DB_URL is configured (same DB as schema mapper / plenum_cafm)."""
        if (self.db_url or "").strip():
            return False
        return self.use_sqlite_dev

    @property
    def database_url(self) -> str:
        if self.effective_use_sqlite_dev:
            Path(self.sqlite_path).parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{self.sqlite_path}"
        if not self.db_url:
            raise RuntimeError(
                "DB_URL must be set when USE_SQLITE_DEV=false. "
                "Example: postgresql+psycopg://user:pass@host:5432/db?sslmode=require"
            )
        # Other services use asyncpg; doc-rag needs the sync psycopg driver.
        return self.db_url.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)

    @property
    def is_mock_mode(self) -> bool:
        """True when OpenAI key is missing — pipeline runs with stub LLM/embeddings."""
        return not bool(self.openai_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
