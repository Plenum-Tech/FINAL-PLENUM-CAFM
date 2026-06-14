# FINAL-PLENUM-CAFM — Change Specification

**Date 2026-06-08** · Baseline = `REQUIREMENTS.md` + `PropMg_Features.docx` + approved new specs.

**Approved decisions (2026-06-08):**
- Scope: **all four** near-term work packages (WP-1…WP-4).
- Persistence for custom Saved Spaces (WP-3) and UDR versions (WP-4): **backend table
  (cross-device)**.
- Deliverable: Word export + these Markdown docs committed to the repo.

> **Terminology:** the docx uses "UDR / Universal Data Register" for the whole
> ingest→map→hierarchy product. In code, `svc-udr` = Universal Data **Reader** (direct DB
> access) and the editable "UDR script" lives in the frontend (`udr-script-storage.ts`).

---

## PART A — Near-Term Work Packages

### WP-1 · Mixed Upload → Two Independent Tracks

**Requirement:** `2 Excel + 1 CSV + 1 DOC + 1 PDF` in one message →

| Files | Track | Result |
|-------|-------|--------|
| sites.xlsx, assets.xlsx, data.csv | Structured (Migration) | **one** `migration_id`, all sheets/tables merged |
| spec.doc, manual.pdf | Documents (Doc RAG) | indexed separately — one `document_id` each |

Order: structured batch first → then each document. Never call `start_migration` once
per spreadsheet; never put PDF/Word into the migration job.

**Current state (verified in code):**
- `start_migration_multi` does **not** exist; `start_migration(file_path, cmms_name)` is
  one-file-only (`svc-deepagents/.../migration_agent.py`).
- `run_single_door_ingestion_sequence()` (`single_door_flow.py:551`) loops
  `ingest_single_file()` per file independently — 3 spreadsheets = 3 migrations today.
- Classification: `_file_kind()` (`single_door_flow.py:286`) and `classifyUploadFiles()`
  (`single-door-ingest-progress.tsx:7`).
- System prompt has no mixed-upload rule.

**Changes:**
1. **Backend** — add `start_migration_multi(file_paths[], cmms_name)` in
   `migration_agent.py`; in `run_single_door_ingestion_sequence()` group by `_file_kind()`
   → one multi-migration for all structured, then `index_document` per doc, in that order.
2. **System prompt** (`system_prompt.py`) — add the hard mixed-upload rule (TRACK 1 / TRACK 2).
3. **Frontend** — two track headers in `single-door-ingest-progress.tsx`
   ("Structured (Migration)" vs "Documents (Doc RAG)") with separate file lists; process
   log line "Mixed upload — structured batch + documents".
4. Rebuild `svc-deepagents` + `frontend-app` Docker images.

**Open item:** confirm the schema-mapper migration job already accepts multiple source
tables/sheets in one job; if not, extend it.

---

### WP-2 · Center-Chat Intent Menu (5 chips)

**Requirement:** on ambiguous "migration/data" messages, show a 5-option chip menu before
routing. UX router only — **no new pipelines**.

**Main menu (ambiguous text, no files):** title *"What would you like to do?"*,
subtitle *"Choose a pipeline — CSV/Excel and Word/PDF are separate tracks."*

| Chip | Detail |
|------|--------|
| CSV / Excel migration | Spreadsheets merge into one migration job → field mapping → hierarchy → plenum_cafm |
| Word / PDF migration | Doc RAG index → match rows to CMMS tables → grounded search (not the spreadsheet pipeline) |
| Live Fiix data migration | Connect Fiix → fetch live schema → gates → optional Fiix → plenum_cafm sync |
| Work order create / modify | Create, update, transition, approve, close via WO engine |
| Direct database access | Query/update plenum_cafm tables via UDR |

**Scenarios:**
- **A** (text only, ambiguous) → full 5-chip menu → chip sets `pendingIntent` → short
  next-step prompt ("Attach your CSV/Excel files").
- **B** (structured-only files + migration words) → skip menu → 2-chip confirmation
  *"Proceed with CSV / Excel migration for: {files}?"* `[Yes]` `[No → show all options]`.
  Mirror for docs-only.
- **C** (mixed structured + docs, no choice) → 2-chip split *"You attached both
  spreadsheets and documents."* `[Continue with CSV/Excel]` `[Continue with Word/PDF]`
  `[Show all options]`.
- **D** (already picked, then uploads) → skip menu, run that track only.

Chips do **not** call the orchestrator; they set `pendingIntent` (session-persisted).

**Current state:** no intent menu / chips exist; `sendMessage()`
(`use-deep-agent-orchestrator.ts:1007`) goes straight to REST/WS.

**Changes:**
- **New FE files:** `intent-menu.ts` (definitions, trigger regex, `detectUploadMix`,
  `shouldShowIntentMenu`), `deep-agent-intent-chips.tsx`, `use-intent-clarification.ts`
  (`pendingIntent`, `awaitingConfirmation`, `heldFiles`).
- **Modify FE:** `use-deep-agent-orchestrator.ts` (gate `sendMessage`, extend turn with
  `chips?` / `intentKind?`), `deep-agent-orchestrator-shell.tsx` (render chips, wire
  onClick → forced route), `single-door-ingest-progress.tsx` (reuse classifier),
  `udr-route-context.ts` (forced routes: `csv_excel_migration`, `word_pdf_migration`,
  `fiix_live_migration`, `wo_engine`, `direct_db`).
- **Backend (light):** `session_workspace.py` add `pending_user_intent`; `workflow.py`
  accept optional `user_intent`; `system_prompt.py` "if user_intent sent, don't re-ask".
- **Out of scope:** migration/doc-match panel empty states.

---

### WP-3 · Saved Spaces — per-chat indexing + dynamic customer-named spaces

**Requirement:** (a) each scroll/run in Saved Spaces tied to its respective chat;
(b) dynamically add a new **customer-named** saved space.

**Current state:**
- Spaces are statically defined (7 fixed) in `deep-agent-spaces.ts:47` — **no
  custom-named spaces**.
- Session↔space mapping exists (`DeepAgentSessionMeta`), localStorage-persisted
  (`deep-agent-sessions.ts`), rendered by `DeepAgentSavedSpacesPanel`
  (`deep-agent-saved-spaces-panel.tsx:242`), ≤10 recent sessions/space, no virtualization.

**Changes:**
1. **Backend (approved):** new `saved_spaces` table (id, org_id, name, kind, created_by,
   created_at) + endpoints `GET/POST/PATCH/DELETE /saved-spaces`. Org-level, cross-device.
2. **Frontend:** dynamic space registry merging static catalog + backend custom spaces;
   allow create/rename a customer-named space; `SavedSpaceId` extended to dynamic ids.
3. **Per-chat indexing:** each session row deep-links to its exact `sessionId`; new runs
   append to the correct space list as they stream; assign/move via `setSessionSpaceOverride`.

---

### WP-4 · UDR Run Versioning (BE + FE)

**Requirement:** UDR run not showing a version → show **last 3 versions** (BE + FE), let
user **select** a desired version and **give it a custom name**.

**Current state:**
- FE: `udr-script-storage.ts` stores `UdrScriptRecord` in localStorage with only a single
  one-level `previousSnapshot`. Panel `deep-agent-udr-panel.tsx:276` shows older runs via
  hardcoded `sessionScripts.slice(1,4)` — no version number, no name, no selector.
- BE: **no UDR-run persistence**; `UDROrchestrator.query()` is stateless.

**Changes (approved backend persistence):**
1. **Backend:** new `udr_run_versions` table (run_id, session_id, org_id, version_no,
   custom_name, phase, mapping_status, hierarchy_status, snapshot JSONB, created_at) +
   `POST /udr/runs`, `GET /udr/runs?session_id=&limit=3`.
2. **Frontend:** extend `UdrScriptRecord` to a versions array (keep last 3); replace
   `slice(1,4)` in `deep-agent-udr-panel.tsx` with a **version selector dropdown**
   (version no + custom name + phase badge) + inline rename; wire to BE endpoints.

**Assumption:** keep all versions in BE, display last 3 in FE (confirm if rolling-drop
preferred).

---

### WP-5 · Migration Flow Restructure → Canonical 7 Nodes (Data-Migration / Ingestor)

**Requirement:** present the **data-migration (ingestor)** pipeline as 7 canonical nodes:

1. File ingestion — overall summary
2. Deterministic Mapping — change table/column name — Human review gate (Semantic) —
   create new table/column
3. Semantic Mapping — change table/column name — Human review gate (Table Structure
   Confirmation)
4. Data Pre-processing — check dup / null / empty
5. Hierarchy Detection & Confirmation
6. Data Artifacts — sql, csv, json
7. Write to Target DB — write to plenum_cafm DB

**Scope:** this targets the **data-migration graph** (`graph/migration_graph.py`,
`MigrationState`), NOT the schema-structure graph (`schema_mapping_graph.py`). The schema
graph stays as-is.

**Current data-migration graph (9 internal nodes):**
`START → ingest_node → deterministic_mapper_node → pre_semantic_review_node (gate) →
[semantic_mapper_node → human_review_node (gate)] → preprocess_node → hierarchy_node →
verify_hierarchy_node (gate) → output_generator_node → write_node (gate) → END`
(step-pauses after ingest, deterministic, semantic, preprocess, hierarchy, output.)

**Target → current mapping & delta:**

| Target node | Current node(s) | Delta |
|-------------|-----------------|-------|
| 1. File ingestion — overall summary | `ingest_node` | **NEW:** emit overall summary (tables, columns, row counts, dup/null stats) |
| 2. Deterministic + gate (Semantic) + create new table/col | `deterministic_mapper_node` + `pre_semantic_review_node` | **NEW backend:** this gate is approve/reject only today — port the DDL edit payload (`target_table`, `custom_column_name`, `data_type`, `is_new_table`, `new_table_pk`) from `human_review_node`; rename gate label → "Semantic review" |
| 3. Semantic + gate (Table Structure Confirmation) + change name | `semantic_mapper_node` + `human_review_node` | Backend payload already supports rename + create-new. **Delta = frontend unlock (B-5 bug) + rename gate label** → "Table Structure Confirmation" |
| 4. Data Pre-processing — dup/null/empty | `preprocess_node` | **Already implemented** (dedup exact rows, drop 100%-null cols, null-fill, EL-M.5 ≥80%). Delta = surface as an explicit node/summary in UI |
| 5. Hierarchy Detection & Confirmation | `hierarchy_node` + `verify_hierarchy_node` (gate) | Present detect + confirm as one logical node (already sequential) |
| 6. Data Artifacts — sql/csv/json | `output_generator_node` | Verify all three formats are emitted/downloadable |
| 7. Write to Target DB | `write_node` | Writes to plenum_cafm — exists |

**Net work:**
1. `ingest_node` — add overall-summary output. *(new, small)*
2. `pre_semantic_review_node` — add table/column rename + create-new-table/column DDL
   payload (reuse `ExtraFieldConfig` logic from `human_review_node`). *(new, medium)*
3. **B-5 fix** — unlock table-name / new-column fields in the frontend gate UI for both
   gate 2 and gate 3 (backend already supports it). *(bug fix)*
4. Relabel gates: pre-semantic → "Semantic review"; human-review → "Table Structure
   Confirmation". Consolidate hierarchy detect+confirm presentation. *(labels/UX)*
5. Confirm `output_generator_node` emits SQL + CSV + JSON. *(verify)*

**Note:** the heavy lifting (dup/null/empty cleaning, create-table backend) already exists;
WP-5 is mostly a **gate-capability port + frontend unlock + relabel/consolidation**, not a
rewrite.

---

## PART B — Vision Roadmap (PropMg_Features.docx)

Larger/strategic items; sequenced after Part A. Several overlap with `REQUIREMENTS.md` §7.

| # | Feature | Maps to | Status / Gap |
|---|---------|---------|--------------|
| B-1 | Single-Door Orchestrator + semantic intent clarification | DeepAgent | Mostly exists; WP-2 is a concrete slice |
| B-2 | Saved Spaces auto-index chats as WO/documents/UDR/certificates | `deep-agent-spaces` | Partial; WP-3 extends; entity-derived spaces new |
| B-3 | Pinned Runs 3–5 visible, semantic match, custom-pin | `deep-agent-pinned-runs.ts` | Largely exists; tune cap + semantic match |
| B-4 | Saved UDR Script: edit tables/columns/add docs → re-run mapping/hierarchy | `udr-script-storage.ts` | Storage exists; edit+re-run incomplete (ties WP-4) |
| B-5 | **BUG**: semantic review — table name & new column not editable | schema-mapper gate UI | Confirmed; fix pre-semantic/field-mapping gate |
| B-6 | Activity Log: chain-of-action + chain-of-thought + inline actionable/approval buttons; summary; refinement/follow-ups; FAQ links | right-rail activity log | Log exists; CoT trace + inline editable actions + approvals new |
| B-7 | UDR mapping mechanics: separate table/columns, unique values, deterministic cutoff 95%, semantic RAG+NLP, top-3 confidence, datatype/sample shown | schema-mapper | Tiered mapping exists; top-3 + datatype/sample surfacing new |
| B-8 | Hierarchy Mapping = 3 layers (relational + vector + relationship graph) + LLM jobs (semantic relationship discovery, sanctity checking) | hierarchy node + doc-rag | L1+L2 exist; relationship graph + LLM inference/QA = major new work |
| B-9 | Cloud-stack connectors (AWS, Huawei, Tencent, Azure) as sources | connector plugins | Object-storage connectors stubbed |

---

## Build / Deploy note

After WP-1 and WP-2 backend changes: rebuild `svc-deepagents` and `frontend-app` Docker
images to pick up the system-prompt and routing changes.
