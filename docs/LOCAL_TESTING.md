# Local testing — single-door orchestrator

Two ways to run locally. **Option B** is best while iterating on frontend changes (hot reload).

---

## Prerequisites

1. **Docker Desktop** running (Linux engine).
2. **`apps/backend/.env`** — you already have this (API keys for OpenAI/Anthropic).
3. **`apps/frontend/.env.local`** — you already have this (`/backend/*` paths).
4. **Node 22+** and `npm install` in `apps/frontend` (already done).

---

## Option A — Full stack in Docker (simplest)

Everything on one URL, matches production routing. Rebuilds frontend on code changes.

```powershell
cd C:\Users\init\Documents\GitHub\FINAL-PLENUM-CAFM

docker compose -f docker-compose.single-url.local.yml up --build
```

First run can take **10–20 minutes** (image builds).

Open: **http://localhost:3000**

Health checks:

- http://localhost:3000/healthz → `ok`
- http://localhost:3000/backend/deep-agents/health (or `/docs`) → orchestrator up
- http://localhost:18080/health → work-order service (direct port)

After frontend edits, rebuild only the UI:

```powershell
docker compose -f docker-compose.single-url.local.yml up --build frontend-app gateway-app
```

---

## Option B — Backends in Docker + frontend hot reload (recommended for UI work)

### 1. Start backends (no gateway / no baked frontend)

```powershell
cd C:\Users\init\Documents\GitHub\FINAL-PLENUM-CAFM

docker compose -f docker-compose.single-url.local.yml -f docker-compose.dev-ports.yml up -d `
  postgres redis connector-app backend-app schema-mapper-app svc-udr svc-deepagents
```

Wait until healthy (~1–2 min). Check:

```powershell
docker compose -f docker-compose.single-url.local.yml ps
curl http://127.0.0.1:8008/health
curl http://127.0.0.1:8007/health
```

### 2. Start Next.js dev server with backend proxies

```powershell
cd apps\frontend
$env:LOCAL_DEV = "1"
npm run dev
```

Open: **http://localhost:3000/ai**

`LOCAL_DEV=1` enables `next.config.ts` rewrites so `/backend/*` hits the Docker services on ports 8007, 8003, 8008, etc.

---

## Login

Demo auth — **any email + any password** works (e.g. `fm@test.com` / `test`).

After login you land on **`/ai`**.

---

## Select an organization

The orchestrator banner *“Select an organization in the header”* blocks tool calls until you pick an org in the top header dropdown. Required for chat routing.

---

## Smoke test checklist

| # | Test | Expected |
|---|------|----------|
| 1 | Open `/` | Redirects to `/ai` |
| 2 | Header **Orchestrator** / nav **Work orders** | `/ai` and `/ai?space=work_orders` |
| 3 | LHS **Work orders** | Center **Work orders** tab, stats load |
| 4 | LHS **Documents** | Center **Documents** tab, upload zone |
| 5 | LHS **Unified Data Register** | UDR tab; **Edit mappings & gates** → Migration tab |
| 6 | Chat: *“List open work orders”* | Activity log shows tool calls; assistant reply |
| 7 | Right rail **Activity** | Messages + tools; HITL/approval when triggered |
| 8 | Attach CSV in chat | **Migration** tab appears with pipeline gates |
| 9 | `/work-orders/new` | Redirects to `/ai?space=work_orders` |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `failed to connect to docker API` | Start **Docker Desktop**, wait until green |
| Orchestrator offline banner | `svc-deepagents` not up — check `docker compose ps`, logs: `docker compose logs svc-deepagents -f` |
| **Deep Agents request failed (500)** | Usually **work-order service down**. Check `docker ps` — if `backend-app` is **Restarting**, rebuild: `docker compose -f docker-compose.single-url.local.yml -f docker-compose.dev-ports.yml up -d --build backend-app svc-deepagents` |
| WO panel errors | `backend-app` on 8007 — `curl http://127.0.0.1:8007/health` |
| Doc upload 504/500 | Schema-mapper on 8003 serves doc-rag — check `docker compose logs schema-mapper-app` |
| `/backend/*` 404 in dev | Set `$env:LOCAL_DEV = "1"` before `npm run dev` |
| Port 3000 in use | Stop other apps or `npm run dev -- -p 3001` |
| Org tools blocked | Select organization in header |

---

## Stop

```powershell
docker compose -f docker-compose.single-url.local.yml down
```

Add `-v` only if you want to wipe the local Postgres volume.
