# Saved Spaces — navigation model (v1)

## UDR: session bucket vs persistent view

**Decision (v1):** UDR is a **session-based LHS space**, not a separate persistent orchestrator view.

| Surface | Role |
|--------|------|
| **LHS “Unified Data Register”** | Indexes orchestrator **chat sessions** that touched UDR tools/routes (ingest, export, run mapping). |
| **`/import` (Open in app →)** | Live UDR operations UI — tables, mapping, hierarchy. FM daily work happens here. |
| **Orchestrator chat** | Single door: natural language + pins route to UDR agents; workspace status pills show mapping/hierarchy progress. |

**Not in v1:** Embedding full UDR as a fourth center column or replacing the chat with a permanent UDR dashboard inside the orchestrator. That would duplicate `/import` and blur the “saved spaces = indexed runs” model.

**Future option:** A top-level app nav item “Data Register” alongside Work Orders / Assets (outside orchestrator LHS) if product wants UDR always one click away without opening orchestrator.

## Session vs artifact counts (LHS)

- Plain number = **sessions** indexed in that space (multi-domain sessions may increment more than one space).
- **`· N↗`** = **artifacts created** (successful tool outputs with ids only).

## Classification

- **primarySpace** — dominant weighted activity (frontend weighted classifier).
- **secondarySpaces** — ≥45% of top weight; shown as compact **“also here”** chips, not full duplicate rows.

### Tie-break (Option A — v1)

When `GET /workspace/{session_id}` or `workspace_status` on a workflow response includes `saved_space`, **backend `infer_saved_space()` wins** for `primarySpace` unless the FM set `userOverrideSpace` in localStorage.

Frontend still accumulates weights and `secondarySpaces`; only the canonical primary bucket is anchored from the API.
