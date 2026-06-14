"""Documents router — upload, list, inspect, delete."""
from __future__ import annotations

import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import logger
from app.db.models import Document, DocumentChunk
from app.db.session import SessionLocal, get_db
from app.schemas import ChunkPreview, DocumentOut, DocumentUploadResponse
from app.services.chunker import chunker
from app.services.document_classifier import document_classifier
from app.db.embedding_utils import coerce_embedding
from app.services.embedding_service import embedding_service
from app.services.extraction_service import extraction_service

router = APIRouter(prefix="/documents", tags=["documents"])


def _run_ingestion_pipeline(document_id: str, dest_path: Path, filename: str) -> None:
    """Run extract → classify → chunk → embed in a background thread.

    Keeps the upload HTTP request short so gateways (Azure ACA ~240s, nginx) do not 504.
    """
    start = time.time()
    db = SessionLocal()
    try:
        doc_row = db.query(Document).filter(Document.id == document_id).first()
        if not doc_row:
            logger.error("Ingestion background: document not found | id={}", document_id)
            return

        extracted = extraction_service.extract(dest_path, document_id=doc_row.id)
        logger.info(
            "Ingestion stage=extract | doc_id={} | pages={} | images={} | chars={} | ms={}",
            doc_row.id,
            extracted.num_pages,
            extracted.num_images,
            len(extracted.full_text),
            int((time.time() - start) * 1000),
        )

        doc_type, doc_confidence = document_classifier.classify(extracted)
        logger.info(
            "Ingestion stage=classify | doc_id={} | type={} | confidence={:.3f}",
            doc_row.id,
            doc_type,
            doc_confidence,
        )

        doc_row.mime_type = extracted.mime_type
        doc_row.document_type = doc_type
        doc_row.num_pages = extracted.num_pages
        doc_row.status = "processing"
        db.commit()

        chunks = chunker.chunk(extracted)
        texts = [c.text_content for c in chunks]
        embeddings = embedding_service.embed_batch(texts) if texts else []

        for ch, emb in zip(chunks, embeddings, strict=False):
            db.add(
                DocumentChunk(
                    document_id=doc_row.id,
                    page_start=ch.page_start,
                    page_end=ch.page_end,
                    chunk_index=ch.chunk_index,
                    block_type=ch.block_type,
                    section_label=ch.section_label,
                    text_content=ch.text_content,
                    normalized_text=ch.normalized_text,
                    meta=ch.meta,
                    embedding=coerce_embedding(emb),
                    embedding_model=embedding_service.model
                    if not embedding_service.mock
                    else "mock",
                )
            )

        doc_row.status = "indexed"
        db.commit()
        elapsed_ms = int((time.time() - start) * 1000)
        logger.info(
            "Ingestion complete | doc_id={} | file={} | pages={} | chunks={} | total_ms={}",
            doc_row.id,
            filename,
            extracted.num_pages,
            len(chunks),
            elapsed_ms,
        )
    except Exception as e:
        db.rollback()
        logger.exception("Ingestion failed for {} (doc_id={}): {}", filename, document_id, e)
        try:
            doc_row = db.query(Document).filter(Document.id == document_id).first()
            if doc_row:
                doc_row.status = "error"
                db.commit()
        except Exception:
            logger.exception("Failed to mark document error | id={}", document_id)
    finally:
        db.close()


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Accept a file, enqueue ingestion, and return immediately.

    Poll GET /documents/{document_id} until status is ``indexed`` or ``error``.
    """
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    if ext not in extraction_service.SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. "
            f"Supported: {sorted(extraction_service.SUPPORTED_EXTENSIONS)}",
        )

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = upload_dir / unique_name
    try:
        with dest_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        logger.exception("Failed to write upload: {}", e)
        raise HTTPException(status_code=500, detail="Failed to save upload")
    finally:
        await file.close()

    logger.info("File saved | name={} | path={}", filename, dest_path)

    doc_row = Document(
        file_name=filename,
        mime_type=None,
        document_type=None,
        source_uri=str(dest_path),
        status="extracting",
        num_pages=0,
    )
    db.add(doc_row)
    db.commit()
    db.refresh(doc_row)

    background_tasks.add_task(_run_ingestion_pipeline, doc_row.id, dest_path, filename)
    logger.info("Ingestion queued | doc_id={} | file={}", doc_row.id, filename)

    return DocumentUploadResponse(
        document_id=doc_row.id,
        status=doc_row.status,
        file_name=filename,
        num_pages=0,
        num_chunks=0,
        document_type=None,
        processing_time_ms=0,
    )


@router.get("", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).order_by(Document.created_at.desc()).all()
    results: list[DocumentOut] = []
    for d in docs:
        n = db.query(DocumentChunk).filter(DocumentChunk.document_id == d.id).count()
        results.append(DocumentOut(
            id=d.id, file_name=d.file_name, mime_type=d.mime_type,
            document_type=d.document_type, status=d.status,
            num_pages=d.num_pages, num_chunks=n, created_at=d.created_at,
        ))
    return results


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: str, db: Session = Depends(get_db)):
    d = db.query(Document).filter(Document.id == document_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    n = db.query(DocumentChunk).filter(DocumentChunk.document_id == d.id).count()
    return DocumentOut(
        id=d.id, file_name=d.file_name, mime_type=d.mime_type,
        document_type=d.document_type, status=d.status,
        num_pages=d.num_pages, num_chunks=n, created_at=d.created_at,
    )


@router.get("/{document_id}/chunks", response_model=list[ChunkPreview])
def get_document_chunks(document_id: str, limit: int = 50, db: Session = Depends(get_db)):
    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.chunk_index)
        .limit(limit)
        .all()
    )
    return [
        ChunkPreview(
            chunk_index=c.chunk_index,
            page_start=c.page_start,
            page_end=c.page_end,
            block_type=c.block_type,
            section_label=c.section_label,
            text_content=c.text_content,
            meta=c.meta,
        )
        for c in chunks
    ]


@router.get("/{document_id}/pages/{page}/debug")
def debug_page(document_id: str, page: int, db: Session = Depends(get_db)):
    """Everything the extractor saw for one page.

    Use this when a query returns poor citations for a specific page.
    It shows every chunk on that page grouped by block_type, and for
    image chunks it exposes the RAW vision response — so you can tell
    whether the model saw the page, whether it classified it as a
    table, whether it returned structured rows, and if not, why.

    Typical debug flow:
      1. Run a query, note a bad citation's document_id and page.
      2. GET /documents/{doc_id}/pages/{page}/debug
      3. If `image_chunks[].vision_image_type == "table"` and
         `vision_injected_table_count == 0`, the vision prompt failed —
         inspect `vision_raw_response` to see what the model actually
         returned.
      4. If there are no image_chunks at all, the image was not
         extracted from the PDF — likely a compressed / flattened PDF
         and the page needs full-page rendering.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    chunks = (
        db.query(DocumentChunk)
        .filter(
            DocumentChunk.document_id == document_id,
            DocumentChunk.page_start == page,
        )
        .order_by(DocumentChunk.chunk_index)
        .all()
    )

    def to_dict(c: DocumentChunk) -> dict:
        return {
            "chunk_id": c.id,
            "chunk_index": c.chunk_index,
            "block_type": c.block_type,
            "section_label": c.section_label,
            "text_content": c.text_content,
            "text_length": len(c.text_content or ""),
            "meta": c.meta,
        }

    by_type: dict[str, list[dict]] = {}
    for c in chunks:
        by_type.setdefault(c.block_type, []).append(to_dict(c))

    image_chunks = by_type.get("image", [])
    table_row_chunks = by_type.get("table_row", [])

    # Diagnose: was vision asked to extract tables, and did it succeed?
    diagnosis = []
    if not image_chunks and not table_row_chunks:
        diagnosis.append(
            "No image or table_row chunks on this page. Either the page "
            "contained no images / tables, or the image was not surfaced "
            "by pypdf (likely a compressed/flattened PDF). Consider "
            "re-ingesting with full-page rendering enabled."
        )
    for ic in image_chunks:
        m = ic.get("meta") or {}
        vtype = m.get("vision_image_type") or ""
        injected = m.get("vision_injected_table_count", 0)
        if vtype == "table" and injected == 0:
            diagnosis.append(
                f"Image chunk_index={ic['chunk_index']}: vision classified "
                f"the image as TABLE but returned no structured rows. "
                f"This is a vision prompt failure. See vision_raw_response "
                f"in the chunk's meta to inspect what the model returned."
            )
        elif vtype == "" and m.get("extraction_method") == "vision":
            diagnosis.append(
                f"Image chunk_index={ic['chunk_index']}: vision was called "
                f"but returned no image_type classification — possibly an "
                f"older response that pre-dates the structured prompt."
            )

    return {
        "document_id": document_id,
        "file_name": doc.file_name,
        "document_type": doc.document_type,
        "page": page,
        "chunk_count": len(chunks),
        "chunk_counts_by_type": {k: len(v) for k, v in by_type.items()},
        "chunks_by_type": by_type,
        "diagnosis": diagnosis or ["No obvious problems detected on this page."],
    }


@router.delete("/{document_id}")
def delete_document(document_id: str, db: Session = Depends(get_db)):
    d = db.query(Document).filter(Document.id == document_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(d)
    db.commit()
    logger.info("Document deleted | id={}", document_id)
    return {"status": "deleted", "document_id": document_id}
