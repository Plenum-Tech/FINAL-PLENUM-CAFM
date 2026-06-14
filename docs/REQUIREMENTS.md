# FINAL-PLENUM-CAFM — Project Requirements (Baseline)

**AI-Powered CAFM/CMMS Platform** · Prepared 2026-06-08
Status: baseline reference for change planning. See `CHANGE_SPEC.md` for the active change backlog.

---

## 1. Executive Summary

FINAL-PLENUM-CAFM is a **monorepo** containing an AI-driven Computer-Aided Facilities
Management / Maintenance Management (CAFM/CMMS) platform for UAE facilities operations.
It combines:

1. **Universal data ingestion & migration** — pulls data from any CMMS (Maximo, Fiix,
   SAP PM, Archibus, custom) or file source (CSV, Excel, PDF, Word) into one canonical
   PostgreSQL schema (`plenum_cafm`).
2. **Multi-agent AI pipeline** — extracts, maps, validates and reasons over facilities
   data with mandatory evaluation gates at every stage (no AI output advances without
   passing an "Evaluation Layer" check).
3. **Single-door AI orchestrator ("DeepAgent")** — one natural-language entry point
   routing to 46 tools across 6 domains.
4. **Intelligent Work Order engine** — 15-step assessment pipeline (criticality, safety,
   compliance, vendor scoring, scheduling) plus conversational creation.
5. **Next.js operations frontend** — assets, locations, work orders, PM, vendors, users,
   plus the AI pipeline UIs.

**Architectural principle:** a strict **7-layer stack** where every layer emits a
validated `IntermediateSchema` and every AI decision is gated, voted (N=3 runs, majority
vote) and audited.

---

## 2. System Architecture — The 7-Layer Stack

| Layer | Name | Responsibility | Service |
|-------|------|----------------|---------|
| 1 | Sources | CSV/Excel/Word/PDF + 12 DB/API connectors | `cafm-connector-service` (8000) |
| 2 | Ingestion Agents | 5 extraction agents → `IntermediateSchema` | `svc-ingestion` (8001) |
| 3 | Schema Mapper | Map raw columns → canonical fields (LangGraph 9-node) | `svc-ai-schema-mapper` (8003) |
| 4 | Unified Store | `plenum_cafm` PostgreSQL (50+ ORM models) | shared DB |
| 5 | Specialist Data Agents | Asset/WO/PM/Parts/Inspection — Bound→Aggregate→Vote→Constrain | `svc-ingestion` |
| 6 | Orchestration | Aggregate 5 agent results → action decision | `svc-deepagents` (8008) |
| 7 | Deterministic Output | Query answers, template fill, doc generation | `svc-query` (8002) |

**Supporting services:** `doc-rag` (8004, document RAG/matching), `svc-udr` (Universal
Data Reader — live DB access), `svc-work-order-management` (8007), `table-editor` (8005).

---

## 3. Service-by-Service Requirements

### 3.1 Connector Service (Layer 1) — port 8000
- Universal connector for 12+ source types: PostgreSQL, MySQL, MSSQL, MongoDB, REST,
  SOAP, OData, Excel, CSV, JSON, XML, Parquet.
- Endpoints: `POST /connectors/test`, `POST /imports/preview` (50-row), `POST /imports/run`
  (202 + WebSocket), `GET /imports/{id}/status`.
- Credential encryption, ARQ background worker, plugin registry (`connectors/plugins/*`).
- Also hosts `plenum_cafm` ORM models + the Plenum CAFM REST API (assets, work_orders,
  vendors, users, RBAC, table-customizer).

### 3.2 Ingestion Service (Layers 2 & 5) — port 8001
- 4-stage pipeline: Ingest (validate / SHA-256 dedup / blob upload) → Extract (5 agents)
  → Eval (EL-2.1/2.2/2.3) → Unify (entity resolution → DB write).
- 5 extraction agents: PDF (Claude Vision + prompt caching), CSV, DOCX, Excel, XML/JSON.
- Evaluation Layers: EL-2.0 pre-validation → EL-2.1 JSON parse → EL-2.2 Pydantic
  conformance → EL-2.3 LLM-as-judge (Haiku, 0–1.0). CSV/Excel skip EL-2.3 but require
  mapping confidence ≥ 0.80.
- Layer 5 determinism cycle: Bound → Aggregate (N=3) → Vote → Constrain (YAML rules +
  confidence gate + audit). Returns typed `AgentResult`.
- Models: Haiku (eval), Sonnet (extraction/orchestration), Opus (legal/handwritten),
  Batch API (bulk, 50% cheaper).

### 3.3 AI Schema Mapper (Layer 3) — port 8003
- 9-node LangGraph with PostgreSQL checkpointer (resumable): Ingest → Deterministic
  Mapper (Tier 1: exact 0.99 / alias / regex / Haiku ≥0.85) → Semantic Mapper (Tier 2:
  OpenAI embeddings, cosine) → GATE 1 (field review) → Preprocess/Validate → Resolve
  Hierarchy (FK + cycle detection, Haiku classification) → GATE 2 (hierarchy) → Output
  Gen (JSON/CSV/SQL/PDF) → GATE 3 (write approval) → POST to svc-ingestion.
- 3 HITL gates via LangGraph interrupts; resumable across browser close.
- Tables: `migration_jobs`, `migration_field_mappings`, `migration_hierarchy`,
  `mapping_templates`.
- APIs: `POST /migration/start`, `GET /{id}/status`, `POST /{id}/advance`,
  `POST /{id}/gate/{type}`, `GET /{id}/mappings`, `WS /ws/migration/{id}`.

### 3.4 DeepAgent Orchestrator (Layer 6) — port 8008
- Single-door NL hub. LangGraph `create_react_agent`, GPT-4o-mini temperature=0,
  AsyncPostgresSaver for HITL.
- 46 tools / 6 domains: Meta (6), UDR (2), WO Engine (21), Migration (6), Doc RAG (6),
  Compliance (2).
- 4 orchestration modes: Direct · Planned+Subagents · Filesystem offload (>50K tokens) ·
  Parallel.
- APIs: `POST /workflow/run`, `/run-stateful`, `/resume/{id}`, `/status/{id}`,
  `WS /ws/{id}`, `GET /tools`.

### 3.5 Query & Output Service (Layer 7) — port 8002
- 3 output types: (A) SQL-grounded query answers; (B) template fill (`{{placeholders}}`
  verified post-fill); (C) document generation (DocumentPlan, Sonnet N=3 vote →
  deterministic render → eval; score <0.85 held for review).
- Formats: DOCX, XLSX, PDF, JSON, text. Every output carries an audit receipt.

### 3.6 Document RAG (`doc-rag`) — port 8004
- Hybrid match: `0.40·semantic + 0.30·BM25 + 0.30·metadata (+0.10 exact-key)`, default
  threshold 0.15.
- Chunker (PDF/DOCX/TXT + GPT-4 Vision tables), OpenAI embedder, pgvector + IVFFlat.
- APIs: `POST /documents/upload`, `POST /documents/{id}/match-rows`,
  `POST /rows/{doc_id}/iterate-rows`, `POST /rag/query`.
- Defaults SQLite dev (`USE_SQLITE_DEV=true`); degrades to BM25+metadata without OpenAI key.

### 3.7 Universal Data Reader (`svc-udr`)
- Zero hardcoded tables — introspects `information_schema` live (~134 tables). New
  Alembic table = instantly queryable, no redeploy.
- 9 DB tools, Claude Haiku tool-use loop (max 10 iterations).
- Security: two-gate identifier validation, parameterized queries only, no DDL, 500-row
  cap, SELECT-only enforcement.

### 3.8 Work Order Management — port 8007
- Intelligent 15-step engine: Source ID → Data Collection → AI Criticality → Safety →
  Compliance → Location → Asset Intelligence → Site Clearance → Warranty/Inspection →
  Spare Parts → Vendor Scoring → Resource Allocation → Smart Scheduling → Workspace Pin →
  Journey Log.
- Intake: email (Outlook/Graph), PPM scheduler (hourly), manual, tenant, remediation.
- Approval workflows: preparation / simple / full; SSE approval streams.
- State machine: pending_approval → preparing → prepared → active → completed → closed.
- Conversational layer: GPT-4o-mini chat agent with 13 tools.

### 3.9 Frontend (Next.js)
- Stack: Next.js 16 + React 19 + TS, Zustand + TanStack Query, Tailwind, AG Grid.
- Modules: Dashboard, Assets, Locations, Work Orders, PM, Vendors, Users, Technicians,
  Organizations + AI pipeline UIs.
- Single-door AI shell at `/ai`: center tabs, left = saved spaces, right rail = activity log.
- Auth: demo token (base64 email) + cookie session + middleware gate.

---

## 4. Data Model Highlights (`plenum_cafm`)

- Core: assets (MOB-* codes), work_orders, spare_parts, scheduled_pm, inspections
  (findings JSONB), vendors, locations, technicians, users, RBAC.
- Fiix expansion (14): BOM groups, schedule triggers, POs/receipts, asset meters,
  downtime logs, RCA, WO labor.
- Ingestion tracking (9): `ingestion_documents`, `ingestion_audit_log`,
  `prompt_templates`, `prompt_ab_tests`, `review_queue`, `corrections_log`,
  `query_audit_log`, `claude_api_usage`, `claude_budget_config`.
- Migration (4): see §3.3.
- Conventions: UUID PKs; JSONB for extracted/validated payloads.

---

## 5. Cross-Cutting Requirements

- Observability: LangSmith (every LLM call), Prometheus + Grafana, Tempo, structlog.
- Security: no hardcoded secrets, SQL-injection guards, upload whitelisting + page caps,
  HITL signature validation.
- Resilience: tools return `{error}` dicts, 3× exponential backoff, circuit breakers.
- Cost control: `claude_budget_config` ($500/mo, alert 80%, auto-pause), prompt caching,
  Batch API.

---

## 6. Deployment

- Local: `docker compose -f docker-compose.single-url.local.yml up --build` → nginx on :8080.
- Prod: Azure Container Apps, single-app image, nginx routes `/` → Next.js,
  `/backend/{connector|work-order|schema-mapper|doc-rag}/*` → services.
- Infra: PostgreSQL 16 (asyncpg), Redis (cache + ARQ), Azure Blob, pgvector.

---

## 7. Known Gaps (candidate change areas)

1. Layer 5 specialist agents — per-domain prompt templates + YAML rules incomplete.
2. Layer 6 orchestrator — action voting + confidence gate (0.85 vs 0.80 mismatch).
3. Layer 7 doc generation — DocumentPlan validator/renderer + templates have gaps.
4. Review queue UI — low-confidence HITL approval flow not fully wired.
5. Entity resolution — unifier is Tier-1 (exact match) only.
6. Service consolidation — `svc-udr` & `svc-work-order-management` internal agents should
   route through DeepAgent only.
7. Object-storage source connectors (Azure Blob / Tencent COS) stubbed.
8. doc-rag — production Postgres switch, configurable weights, audit logging, RBAC.
9. Frontend — demo-vs-live API ambiguity; reports, bulk ops, advanced filtering missing.

---

## 8. Source Documentation Index

Synthesized from ~70 markdown files plus `PropMg_Features.docx` and the existing
graphify knowledge graph (`graphify-out/`). Key sources: root `README.md`,
`docs/SINGLE_*`, `cafm-connector-service-final/CLAUDE.md`, `svc-ai-schema-mapper/*`,
`svc-deepagents/src/docs/*`, `svc-work-order-management/docs/*`, `svc-udr/docs/*`,
`doc-rag-main/*`, `apps/frontend/*`.
