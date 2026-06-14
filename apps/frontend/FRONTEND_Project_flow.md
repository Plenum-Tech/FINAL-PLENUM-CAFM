# Plenum CMMS Frontend - Project  Guide.

## 1) Project Purpose

This project is a `Next.js App Router` based CAFM frontend that includes:
- business module UIs (Assets, Locations, Work Orders, PM, Vendors, Users, Technicians, Organizations)
- secure login and session flow
- AI pipeline integration UI (schema mapping + migration + doc RAG)
- local in-memory API routes for demo/stub mode

Main goal: **a new developer should understand the full module flow quickly and start updating/adding features with confidence**.

---

## 2) Tech Stack Snapshot

- Framework: `next@16`, `react@19`, `typescript`
- State: `zustand`, `@tanstack/react-query`
- UI: Tailwind + reusable components (`src/components/ui`)
- Grid: `ag-grid-react`
- API integration: custom wrappers in `src/services/api`
- Auth: demo token + cookie session (`demo:<base64-email>`)

---

## 3) High-Level Folder Structure (Frontend)

```text
src/
  app/                      -> App Router pages + API route handlers
    (app)/                  -> protected app pages (main business UI)
    api/                    -> BFF/demo APIs (route.ts)
    login/                  -> public login page
    logout/                 -> logout route
    layout.tsx              -> root layout
    page.tsx                -> "/" -> dashboard redirect
  features/                 -> domain-based business modules
  components/               -> shared UI/layout/common components
  services/                 -> API + auth helpers
  store/                    -> zustand stores
  constants/                -> route constants and app constants
  config/                   -> env config
  utils/                    -> helpers (e.g. cn)
```

---

## 4) App Entry and Core Shell Files (Important Files + Why)

### `src/app/page.tsx`
- Why: redirects root URL `/` to main business landing page (`/dashboard`).

### `src/app/layout.tsx`
- Why: global wrapper for the whole app (`ReactQueryProvider`, `Toaster`, global CSS).
- Also sets app-level metadata/title.

### `src/app/(app)/layout.tsx`
- Why: parent layout for protected pages.
- Runs `getCurrentUser()` and injects `AuthHydrator + AppShell`.

### `middleware.ts`
- Why: route protection.
- Behavior:
  - redirects unauthenticated users to `/login?from=<path>`
  - redirects authenticated users away from `/login` to `/dashboard`
  - clears invalid session cookie when needed

### `src/constants/app.ts`
- Why: single source of truth for routes (`APP_ROUTES`) to avoid hardcoded path strings.

### `src/components/layout/app-shell.tsx`
- Why: full application shell (sidebar, topbar, navigation, theme toggle, org selector, AI FAB).
- Nav mapping is defined here, so this is a mandatory file when adding a new module.

---

## 5) UI Routes Map (Page Routes)

Exact frontend page route mapping:

| Route | File |
|---|---|
| `/` | `src/app/page.tsx` |
| `/login` | `src/app/login/page.tsx` |
| `/dashboard` | `src/app/(app)/dashboard/page.tsx` |
| `/ai` | `src/app/(app)/ai/page.tsx` |
| `/asset-categories` | `src/app/(app)/asset-categories/page.tsx` |
| `/assets` | `src/app/(app)/assets/page.tsx` |
| `/assets/new` | `src/app/(app)/assets/new/page.tsx` |
| `/assets/[id]` | `src/app/(app)/assets/[id]/page.tsx` |
| `/assets/[id]/edit` | `src/app/(app)/assets/[id]/edit/page.tsx` |
| `/locations` | `src/app/(app)/locations/page.tsx` |
| `/locations/new` | `src/app/(app)/locations/new/page.tsx` |
| `/locations/[id]` | `src/app/(app)/locations/[id]/page.tsx` |
| `/locations/[id]/edit` | `src/app/(app)/locations/[id]/edit/page.tsx` |
| `/work-orders` | `src/app/(app)/work-orders/page.tsx` |
| `/work-orders/new` | `src/app/(app)/work-orders/new/page.tsx` |
| `/work-orders/[id]` | `src/app/(app)/work-orders/[id]/page.tsx` |
| `/work-orders/[id]/edit` | `src/app/(app)/work-orders/[id]/edit/page.tsx` |
| `/preventive-maintenance` | `src/app/(app)/preventive-maintenance/page.tsx` |
| `/preventive-maintenance/new` | `src/app/(app)/preventive-maintenance/new/page.tsx` |
| `/preventive-maintenance/[id]` | `src/app/(app)/preventive-maintenance/[id]/page.tsx` |
| `/preventive-maintenance/[id]/edit` | `src/app/(app)/preventive-maintenance/[id]/edit/page.tsx` |
| `/templates` | `src/app/(app)/templates/page.tsx` |
| `/templates/[id]` | `src/app/(app)/templates/[id]/page.tsx` |
| `/vendors` | `src/app/(app)/vendors/page.tsx` |
| `/vendors/new` | `src/app/(app)/vendors/new/page.tsx` |
| `/vendors/[id]` | `src/app/(app)/vendors/[id]/page.tsx` |
| `/vendors/[id]/edit` | `src/app/(app)/vendors/[id]/edit/page.tsx` |
| `/users` | `src/app/(app)/users/page.tsx` |
| `/users/new` | `src/app/(app)/users/new/page.tsx` |
| `/users/[id]` | `src/app/(app)/users/[id]/page.tsx` |
| `/users/[id]/edit` | `src/app/(app)/users/[id]/edit/page.tsx` |
| `/technicians` | `src/app/(app)/technicians/page.tsx` |
| `/technicians/new` | `src/app/(app)/technicians/new/page.tsx` |
| `/technicians/[id]` | `src/app/(app)/technicians/[id]/page.tsx` |
| `/technicians/[id]/edit` | `src/app/(app)/technicians/[id]/edit/page.tsx` |
| `/manpower` | `src/app/(app)/manpower/page.tsx` |
| `/manpower/[id]` | `src/app/(app)/manpower/[id]/page.tsx` |
| `/organizations` | `src/app/(app)/organizations/page.tsx` |
| `/organizations/new` | `src/app/(app)/organizations/new/page.tsx` |
| `/organizations/[id]` | `src/app/(app)/organizations/[id]/page.tsx` |
| `/organizations/[id]/edit` | `src/app/(app)/organizations/[id]/edit/page.tsx` |

Special route:
- `/logout` -> `src/app/logout/route.ts`

---

## 6) API Routes Map (App Router `route.ts`)

| Endpoint | Methods | File |
|---|---|---|
| `/api/auth/login` | `POST` | `src/app/api/auth/login/route.ts` |
| `/api/auth/logout` | `GET, POST` | `src/app/api/auth/logout/route.ts` |
| `/api/auth/me` | `GET` | `src/app/api/auth/me/route.ts` |
| `/api/assets` | `GET, POST` | `src/app/api/assets/route.ts` |
| `/api/assets/[id]` | `GET, PATCH, DELETE` | `src/app/api/assets/[id]/route.ts` |
| `/api/locations` | `GET, POST` | `src/app/api/locations/route.ts` |
| `/api/locations/[id]` | `GET, PATCH, DELETE` | `src/app/api/locations/[id]/route.ts` |
| `/api/work-orders` | `GET, POST` | `src/app/api/work-orders/route.ts` |
| `/api/work-orders/[id]` | `GET, PATCH, DELETE` | `src/app/api/work-orders/[id]/route.ts` |
| `/api/preventive-maintenance` | `GET, POST` | `src/app/api/preventive-maintenance/route.ts` |
| `/api/preventive-maintenance/[id]` | `GET, PATCH, DELETE` | `src/app/api/preventive-maintenance/[id]/route.ts` |
| `/api/vendors` | `GET, POST` | `src/app/api/vendors/route.ts` |
| `/api/vendors/[id]` | `GET, PATCH, DELETE` | `src/app/api/vendors/[id]/route.ts` |
| `/api/templates` | `GET, POST` | `src/app/api/templates/route.ts` |
| `/api/templates/[id]` | `GET, PATCH, DELETE` | `src/app/api/templates/[id]/route.ts` |
| `/api/manpower` | `GET, POST` | `src/app/api/manpower/route.ts` |
| `/api/manpower/[id]` | `GET, PATCH, DELETE` | `src/app/api/manpower/[id]/route.ts` |
| `/api/import` | `GET, POST` | `src/app/api/import/route.ts` |
| `/api/ai/schema-mapper` | `GET, POST` | `src/app/api/ai/schema-mapper/route.ts` |
| `/api/ai/schema-mapper/[...path]` | `GET, POST, PUT, DELETE` | `src/app/api/ai/schema-mapper/[...path]/route.ts` |

---

## 7) Features Folder Detailed KT (Which File Was Created and Why)

## `src/features/auth`
- `login-form.tsx`: core login form UI + action wiring.
- `actions.ts`: auth server actions (handles form submit to backend).
- `index.ts`: barrel export.

## `src/features/assets`
- `assets-grid.tsx`: assets list table.
- `asset-form.tsx`: shared create/edit form structure.
- `create-asset-form.tsx`: create page wrapper with validation.
- `edit-asset-form.tsx`: edit page wrapper.
- `asset-documents-panel.tsx`: asset documents/attachments UI.
- `asset-categories-grid.tsx`: category listing UI.
- `actions.ts`: create/update/delete server actions.
- `types.ts`: domain type contracts.

## `src/features/locations`
- `locations-grid.tsx`: location list.
- `location-form.tsx`: reusable form.
- `create-location-form.tsx`, `edit-location-form.tsx`: create/edit wrappers.
- `actions.ts`, `types.ts`: mutation logic + types.

## `src/features/work-orders`
- `work-orders-grid.tsx`: work order list.
- `work-order-form.tsx`: shared work order form.
- `create-work-order-form.tsx`, `edit-work-order-form.tsx`: specific create/edit flows.
- `work-order-tasks-panel.tsx`: task sub-panel for work orders.
- `actions.ts`, `types.ts`: server mutations + types.

## `src/features/preventive-maintenance`
- `maintenance-plans-grid.tsx`: PM plans list.
- `maintenance-plan-form.tsx`: reusable PM form.
- `create-pm-form.tsx`, `edit-pm-form.tsx`: lifecycle pages.
- `actions.ts`, `plenum-api.ts`, `types.ts`: mutations, API bridge, and contracts.

## `src/features/vendor`
- `vendors-grid.tsx`, `vendor-form.tsx`, `create-vendor-form.tsx`, `edit-vendor-form.tsx`.
- `actions.ts`, `plenum-api.ts`, `types.ts`.
- Why: keeps vendor CRUD in an isolated module pattern.

## `src/features/templates`
- `create-template-form.tsx`, `edit-template-form.tsx`, `actions.ts`, `types.ts`.
- Why: keeps template management modular.

## `src/features/users`
- `users-grid.tsx`, `user-form.tsx`, `plenum-api.ts`.
- Why: separate domain layer for user list/detail/edit.

## `src/features/technicians`
- `technicians-grid.tsx`, `technician-form.tsx`, `technician-skills-panel.tsx`, `plenum-api.ts`.
- Why: dedicated UI for technician resource + skill management.

## `src/features/manpower`
- `create-manpower-form.tsx`, `edit-manpower-form.tsx`, `actions.ts`, `plenum-api.ts`, `types.ts`.
- Why: manpower module CRUD + API contracts.

## `src/features/organizations`
- `organizations-grid.tsx`, `organization-form.tsx`, `plenum-api.ts`.
- Why: supports multi-organization selector and organization flows.

## `src/features/import`
- `import-uploader.tsx`: entry for file upload.
- `wizard/*`: multi-step import wizard (`StepSourceSelect`, `StepConnectionForm`, `StepFieldMapping`, `StepPreview`, `StepProgress`).
- Why: converts onboarding into a guided step-by-step flow.

## `src/features/ai`
- `chat-api.ts`, `doc-rag-api.ts`: AI backend API wrappers.
- `pipeline/*`: schema + migration pipeline screens, gates, tracker, results.
- `unstructured-pipeline-panel.tsx`, `node-inspector.tsx`, `pipeline-command-bar.tsx`: pipeline observability and control UI.
- `api-response-snapshots/*`: API payload snapshots for development/testing/reference.
- Why: breaks HITL AI workflow into clear deterministic UI states.

---

## 8) Components Folder KT (Shared Building Blocks)

## `src/components/layout`
- `app-shell.tsx`: app frame, navigation, header, theme, and user/org controls.

## `src/components/common`
- `auth-hydrator.tsx`: hydrates server user into client zustand store.
- `logout-button.tsx`: logout trigger.
- `confirm-dialog.tsx`: reusable confirmation modal.

## `src/components/ui`
- Basic primitives (`button`, `input`, `card`, `badge`, `table`, `toast`, `spinner`).
- `infinite-select.tsx`: server-driven searchable dropdown (used in org picker type cases).
- `file-upload.tsx`: upload helper UI.

## `src/components/data-grid`
- `ag-data-grid.tsx`: AG Grid wrapper with standard behavior.
- `data-import-wizard-modal.tsx`: modal integration for import UX.

---

## 9) Services and Store KT (Core Infrastructure Files)

## API Layer (`src/services/api`)
- `client.ts`: browser-side `apiFetch` wrapper; JSON handling + error normalization.
- `server.ts`: server-side fetch with auth token injection.
- `internal.server.ts`: internal app API fetch helper with cookie forwarding.
- `errors.ts`: common `ApiError` type.

## Auth Layer (`src/services/auth`)
- `demo.ts`: `createDemoToken` and `decodeDemoToken`.
- `session.server.ts`: cookie read/write/delete.
- `user.server.ts`: resolves current user from session token.
- `constants.ts`: cookie name constants.

## Zustand Stores (`src/store`)
- `authStore.ts`: user + hydration state.
- `uiStore.ts`: theme/sidebar/mobile shell state.
- `organizationStore.ts`: selected organization context.
- `importWizard.ts`, `aiPlatformStore.ts`: module-specific UI state.

---

## 10) Demo In-Memory API Stores (Very Important for KT)

These files hold stub/demo data, and API routes use them to simulate CRUD:

- `src/app/api/assets/store.ts` -> `globalThis.__cafmAssetStore`
- `src/app/api/locations/store.ts` -> `globalThis.__cafmLocationStore`
- `src/app/api/work-orders/store.ts` -> `globalThis.__cafmWorkOrderStore`
- `src/app/api/preventive-maintenance/store.ts` -> `globalThis.__cafmPmStore`

Pattern:
1. `getStore()` creates default seed data on first call.
2. `requireUser()` validates cookie token.
3. Route handlers (`GET/POST/PATCH/DELETE`) mutate store and return JSON.

Use cases:
- continue frontend development when backend is unavailable
- reliable demo data for QA and UI validation

---

## 11) Auth and Navigation Flow (Step-by-Step)

1. User opens `/login`.
2. `POST /api/auth/login` validates email/password and sets demo cookie.
3. Middleware validates cookie on protected routes.
4. `src/app/(app)/layout.tsx` fetches current user server-side.
5. `AuthHydrator` injects user into client store.
6. `AppShell` renders navigation and module routes.

Logout:
- `/logout` or `/api/auth/logout` clears the cookie.

---

## 12) "Add New Module" Developer Checklist

1. In `src/features/<module>` add:
   - `types.ts`
   - `*-grid.tsx`
   - `*-form.tsx`
   - `create-*.tsx`, `edit-*.tsx`
   - `actions.ts`
2. Add route pages in `src/app/(app)/<module>`.
3. If demo API is needed, add `src/app/api/<module>/route.ts` + `[id]/route.ts`.
4. Add route constant in `APP_ROUTES`.
5. Add navigation item in `app-shell.tsx`.
6. Update barrel exports (`index.ts`).

---

## 13) Known Notes / Residual Risks

- `middleware.ts` matcher currently covers only selected paths; if you add a new protected route, update matcher config.
- Some modules use demo API routes while others use real backend calls (`/api/v1/plenum/...`); keep integration mode clear.
- AI module API behavior depends on external service config (`NEXT_PUBLIC_API_BASE_URL` + `SCHEMA_MAPPER_PATH`).

---

## 14) Quick File Landmarks (Fast Onboarding)

- Routing constants: `src/constants/app.ts`
- Main shell/navigation: `src/components/layout/app-shell.tsx`
- Auth flow: `src/services/auth/*`, `middleware.ts`, `src/app/api/auth/*`
- App pages: `src/app/(app)/*`
- API handlers: `src/app/api/*`
- Domain logic: `src/features/*`
- Shared UI: `src/components/ui/*`
- Global state: `src/store/*`

---

## 15) Existing Related Docs

- `FRONTEND_API_FLOW.md`: detailed integration document for AI schema mapper/migration API flow.
