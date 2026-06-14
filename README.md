# CMMS Monorepo

This monorepo contains the frontend and backend projects in one workspace so deployment, routing, and local testing are easier to manage.

## Layout

- `apps/frontend` - Next.js frontend (`Plenum-CMMS-frontend`)
- `apps/backend` - backend repo copy (`Plenum-CMMS-backend`)
- `infra` - shared infrastructure assets
- `scripts` - helper scripts
- `docs` - deployment and architecture docs

## Single URL model

- `/` -> frontend
- `/backend/*` -> backend

The gateway config and image for this model are in:

- `apps/frontend/infra/single-url/nginx.conf`
- `apps/frontend/infra/single-url/Dockerfile.gateway`

## Local single-URL run

Use:

```bash
docker compose -f docker-compose.single-url.local.yml up --build
```

Then open:

- `http://localhost:8080/`
- `http://localhost:8080/backend/work-order/health`

## Notes

- Original source repos remain unchanged.
- This monorepo is a copy-based consolidation for easier local/prod ops.
