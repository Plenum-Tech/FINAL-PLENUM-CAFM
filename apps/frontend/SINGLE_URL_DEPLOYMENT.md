# Single URL Deployment (Frontend + Backend)

This setup gives you one public URL with this contract:

- `/` -> `Plenum-CMMS-frontend`
- `/backend/*` -> `Plenum-CMMS-backend`

The repos can stay separate. They do not need to be merged.

## 1) Build and push 3 images

You will run one Azure Container App with three containers:

- `gateway-app` (Nginx path router)
- `frontend-app` (Next.js)
- `backend-app` (your backend unified image)

Suggested image names:

- `<acr>.azurecr.io/plenum-frontend:latest`
- `<acr>.azurecr.io/plenum-backend:latest`
- `<acr>.azurecr.io/plenum-gateway:latest`

### Frontend image

From `Plenum-CMMS-frontend`:

```bash
docker build -t <acr>.azurecr.io/plenum-frontend:latest .
docker push <acr>.azurecr.io/plenum-frontend:latest
```

### Backend image

From `FINAL-PLENUM-CAFM/Plenum-CMMS-backend/cafm-connector-service-final`:

```bash
docker build -t <acr>.azurecr.io/plenum-backend:latest .
docker push <acr>.azurecr.io/plenum-backend:latest
```

### Gateway image

From `Plenum-CMMS-frontend/infra/single-url`:

```bash
docker build -f Dockerfile.gateway -t <acr>.azurecr.io/plenum-gateway:latest .
docker push <acr>.azurecr.io/plenum-gateway:latest
```

## 2) Frontend runtime environment

Set frontend environment variables to relative backend paths (important):

- `NEXT_PUBLIC_API_BASE_URL=/backend/connector`
- `NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL=/backend/schema-mapper`
- `NEXT_PUBLIC_WO_BASE_URL=/backend/work-order`
- `WO_API_SERVER_URL=http://backend-app:8007` (or `http://127.0.0.1:8007` in single-container image) — required for server-side `/api/wo-chat` (email inbox create flow)

Why: browser calls stay same-origin and go through the gateway container.

## 3) Create one Azure Container App with 3 containers

Use one app where ingress targets the gateway container port `8080`.

Container layout:

- `gateway-app`: image `plenum-gateway`, port `8080` (ingress target)
- `frontend-app`: image `plenum-frontend`, port `3000`
- `backend-app`: image `plenum-backend`, port `80`

The gateway config already exists in:

- `infra/single-url/nginx.conf`

It routes:

- `/backend/*` -> `http://backend-app:80/*`
- everything else -> `http://frontend-app:3000`

## 4) Validate after deploy

Run these checks:

```bash
curl -i https://<your-domain>/
curl -i https://<your-domain>/backend/work-order/health
curl -i https://<your-domain>/backend/work-order/docs
```

Then test from browser:

- open `/work-orders`
- open `/work-orders/new`
- run one action that calls work-order API

## 5) Common pitfalls

- If `/backend/work-order/docs` fails, confirm backend container is healthy and named `backend-app`.
- If frontend still calls old absolute URLs, re-check frontend env vars and redeploy.
- If chat or inbox fails, confirm backend secrets and Outlook/env values are set in Container App.

## 6) Important security note

Do not keep real API keys in `.env.local` committed history or shared screenshots.
Rotate exposed keys (for example Anthropic) before production rollout.
