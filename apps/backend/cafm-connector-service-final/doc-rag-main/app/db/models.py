"""SQLAlchemy ORM models.



Mirrors the schema described in project.md section 17. When running in

`USE_SQLITE_DEV=true` mode, the pgvector column is replaced with a JSON

column that stores the embedding list — so the same ORM works for both

Postgres and SQLite dev backends.

"""

from __future__ import annotations



import uuid

from datetime import datetime

from typing import Any



from sqlalchemy import (

    JSON,

    Column,

    DateTime,

    ForeignKey,

    Integer,

    Numeric,

    String,

    Text,

)

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship



from app.core.config import settings





def _uuid_str() -> str:

    return str(uuid.uuid4())





class Base(DeclarativeBase):

    pass





def _embedding_column():

    """Postgres: native pgvector column. SQLite dev: JSON list[float]."""

    if settings.effective_use_sqlite_dev:

        return Column("embedding", JSON, nullable=True)

    from pgvector.sqlalchemy import Vector



    return Column("embedding", Vector(settings.openai_embedding_dim), nullable=True)





# ---------- Documents ----------

class Document(Base):

    __tablename__ = "documents"



    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)

    file_name: Mapped[str] = mapped_column(String(512), nullable=False)

    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)

    document_type: Mapped[str | None] = mapped_column(String(64), nullable=True)

    source_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)

    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploaded")

    num_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    updated_at: Mapped[datetime] = mapped_column(

        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow

    )



    chunks: Mapped[list[DocumentChunk]] = relationship(

        back_populates="document", cascade="all, delete-orphan"

    )





class DocumentChunk(Base):

    __tablename__ = "document_chunks"



    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)

    document_id: Mapped[str] = mapped_column(

        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False

    )

    page_start: Mapped[int | None] = mapped_column(Integer, nullable=True)

    page_end: Mapped[int | None] = mapped_column(Integer, nullable=True)

    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)

    block_type: Mapped[str] = mapped_column(String(32), nullable=False, default="paragraph")

    section_label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    text_content: Mapped[str] = mapped_column(Text, nullable=False)

    normalized_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)

    embedding = _embedding_column()

    embedding_model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)



    document: Mapped[Document] = relationship(back_populates="chunks")





# ---------- Row semantic index (for DB row grounding) ----------

class RowSemanticIndex(Base):

    __tablename__ = "row_semantic_index"



    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)

    source_table: Mapped[str] = mapped_column(String(128), nullable=False)

    row_pk: Mapped[str] = mapped_column(String(128), nullable=False)

    pk_column: Mapped[str | None] = mapped_column(String(128), nullable=True)

    semantic_text: Mapped[str] = mapped_column(Text, nullable=False)

    normalized_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)

    embedding = _embedding_column()

    embedding_model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)





# ---------- Query audit + feedback ----------

class RagQuery(Base):

    __tablename__ = "rag_queries"



    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)

    user_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    query_text: Mapped[str] = mapped_column(Text, nullable=False)

    query_type: Mapped[str | None] = mapped_column(String(64), nullable=True)

    filters: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)





class RagAnswer(Base):

    __tablename__ = "rag_answers"



    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)

    query_id: Mapped[str] = mapped_column(

        String(36), ForeignKey("rag_queries.id", ondelete="CASCADE"), nullable=False

    )

    answer_text: Mapped[str] = mapped_column(Text, nullable=False)

    answer_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)

    highlights: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)

    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)





class RagFeedback(Base):

    __tablename__ = "rag_feedback"



    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)

    query_id: Mapped[str] = mapped_column(

        String(36), ForeignKey("rag_queries.id", ondelete="CASCADE"), nullable=False

    )

    answer_id: Mapped[str] = mapped_column(

        String(36), ForeignKey("rag_answers.id", ondelete="CASCADE"), nullable=False

    )

    feedback_type: Mapped[str] = mapped_column(String(64), nullable=False)

    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)

    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    correction: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


