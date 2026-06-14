# Single App Image (Azure / one FQDN)

This image runs **one nginx on :80** with:

- **`/`** → Next.js standalone (`127.0.0.1:3000`)
- **`/backend/work-order/*`** → work-order FastAPI (`8007`)
- **`/backend/connector/*`** → CAFM connector (`8000`)
- **`/backend/schema-mapper/*`** → schema-mapper (`8003`)
- **`/backend/doc-rag/*`** → doc-rag (`8004`)

Legacy paths **`/work-order/`**, **`/connector/`**, **`/schema-mapper/`**, **`/doc-rag/`** also proxy to the same processes.

Previously, nginx sent connector/schema-mapper to the **same public Azure URL**, which caused a **proxy loop (504)** and **Next.js 404** for `/schema-mapper/`. All of these services are now **embedded in this image** and reached via `127.0.0.1`, matching how `/backend/work-order/` already worked.

## Build and push

```bash
az acr login --name agentapi

cd "C:\Users\init\Documents\GitHub\cmms_mono_repo"

docker build -f Dockerfile.single-app -t agentapi.azurecr.io/finalplenumcafm:latest .
docker push agentapi.azurecr.io/finalplenumcafm:latest
```

## Runtime environment (Container App)

Set at least:

- **`DATABASE_URL`** — primary Postgres (asyncpg). Used by **work-order** and, after the connector fix, **Plenum CRUD** (`/api/v1/plenum/*`) when `DB_URL` / `PLENUM_DB_URL` are not set. Example: `postgresql+asyncpg://user:pass@host:5432/db`
- **`DB_URL`** — optional; overrides connector + schema-mapper DB when you want them separate from `DATABASE_URL`
- **`PLENUM_DB_URL`** — optional; overrides only Plenum CRUD / org bootstrap when set
- **`REDIS_URL`** — connector jobs / WebSocket relay (use a reachable Redis in Azure)
- **`OPENAI_API_KEY`**, **`ANTHROPIC_API_KEY`** — schema-mapper / doc-rag (placeholders may limit features)
- **`OUTLOOK_ACCESS_TOKEN`**, **`OUTLOOK_USER_EMAIL`** — work-order placeholders if not using inbox
- **`SEED_DEFAULT_PLENUM_ORG=true`** — optional; inserts one default org when the organizations table is empty

Doc-rag defaults to **SQLite** under its working directory when `USE_SQLITE_DEV=true` (default). Set **`USE_SQLITE_DEV=false`** and **`DB_URL`** or **`DATABASE_URL`** if you want Postgres for RAG.

## Optional versioned tag

```bash
docker build -f Dockerfile.single-app -t agentapi.azurecr.io/finalplenumcafm:20260512-1 -t agentapi.azurecr.io/finalplenumcafm:latest .
docker push agentapi.azurecr.io/finalplenumcafm:20260512-1
docker push agentapi.azurecr.io/finalplenumcafm:latest
```
