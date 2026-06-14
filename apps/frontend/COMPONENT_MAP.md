# Component Map — Plenum CMMS Frontend

Quick reference for where every component lives in the repo.

---

## Table of Contents

1. [Pages & Routes](#1-pages--routes)
2. [UI Primitives](#2-ui-primitives)
3. [Layout & Shell](#3-layout--shell)
4. [Data Grid](#4-data-grid)
5. [Common / Shared](#5-common--shared)
6. [Feature — Work Orders](#6-feature--work-orders)
7. [Feature — Assets](#7-feature--assets)
8. [Feature — Locations](#8-feature--locations)
9. [Feature — Vendors](#9-feature--vendors)
10. [Feature — Preventive Maintenance](#10-feature--preventive-maintenance)
11. [Feature — Technicians](#11-feature--technicians)
12. [Feature — Users](#12-feature--users)
13. [Feature — Templates](#13-feature--templates)
14. [Feature — Organizations](#14-feature--organizations)
15. [Feature — Manpower](#15-feature--manpower)
16. [Feature — Import / Wizard](#16-feature--import--wizard)
17. [Feature — Authentication](#17-feature--authentication)
18. [Feature — AI Pipeline](#18-feature--ai-pipeline)

---

## 1. Pages & Routes

All pages live under `src/app/`. The `(app)` folder is a route group (no URL segment).

### Root

| File | Route | Export |
|---|---|---|
| `src/app/page.tsx` | `/` | redirects to `/dashboard` |
| `src/app/login/page.tsx` | `/login` | `LoginPage` |
| `src/app/layout.tsx` | — | `RootLayout` |
| `src/app/(app)/layout.tsx` | — | `AppLayout` |

### Dashboard & AI

| File | Route | Export |
|---|---|---|
| `src/app/(app)/dashboard/page.tsx` | `/dashboard` | `DashboardPage` |
| `src/app/(app)/ai/page.tsx` | `/ai` | `AiPage` |
| `src/app/(app)/ai/ai-chat-client.tsx` | — (client) | `AiChatClient` |

### Work Orders

| File | Route | Export |
|---|---|---|
| `src/app/(app)/work-orders/page.tsx` | `/work-orders` | `WorkOrdersPage` |
| `src/app/(app)/work-orders/new/page.tsx` | `/work-orders/new` | `NewWorkOrderPage` |
| `src/app/(app)/work-orders/[id]/page.tsx` | `/work-orders/:id` | `WorkOrderDetailPage` |
| `src/app/(app)/work-orders/[id]/work-order-details-client.tsx` | — (client) | `WorkOrderDetailsClient` |
| `src/app/(app)/work-orders/[id]/edit/page.tsx` | `/work-orders/:id/edit` | `EditWorkOrderPage` |
| `src/app/(app)/work-orders/email-inbox/page.tsx` | `/work-orders/email-inbox` | `WorkOrderEmailInboxPage` |
| `src/app/(app)/work-orders/email-inbox/email-inbox-client.tsx` | — (client) | `EmailInboxClient` |

### Assets

| File | Route | Export |
|---|---|---|
| `src/app/(app)/assets/page.tsx` | `/assets` | `AssetsPage` |
| `src/app/(app)/assets/new/page.tsx` | `/assets/new` | `NewAssetPage` |
| `src/app/(app)/assets/[id]/page.tsx` | `/assets/:id` | `AssetDetailsPage` |
| `src/app/(app)/assets/[id]/asset-details-client.tsx` | — (client) | `AssetDetailsClient` |
| `src/app/(app)/assets/[id]/edit/page.tsx` | `/assets/:id/edit` | `EditAssetPage` |
| `src/app/(app)/asset-categories/page.tsx` | `/asset-categories` | `AssetCategoriesPage` |

### Locations

| File | Route | Export |
|---|---|---|
| `src/app/(app)/locations/page.tsx` | `/locations` | `LocationsPage` |
| `src/app/(app)/locations/new/page.tsx` | `/locations/new` | `NewLocationPage` |
| `src/app/(app)/locations/[id]/page.tsx` | `/locations/:id` | `LocationDetailsPage` |
| `src/app/(app)/locations/[id]/location-details-client.tsx` | — (client) | `LocationDetailsClient` |
| `src/app/(app)/locations/[id]/edit/page.tsx` | `/locations/:id/edit` | `EditLocationPage` |

### Vendors

| File | Route | Export |
|---|---|---|
| `src/app/(app)/vendors/page.tsx` | `/vendors` | `VendorsPage` |
| `src/app/(app)/vendors/new/page.tsx` | `/vendors/new` | `NewVendorPage` |
| `src/app/(app)/vendors/[id]/page.tsx` | `/vendors/:id` | `VendorDetailsPage` |
| `src/app/(app)/vendors/[id]/vendor-details-client.tsx` | — (client) | `VendorDetailsClient` |
| `src/app/(app)/vendors/[id]/edit/page.tsx` | `/vendors/:id/edit` | `EditVendorPage` |

### Preventive Maintenance

| File | Route | Export |
|---|---|---|
| `src/app/(app)/preventive-maintenance/page.tsx` | `/preventive-maintenance` | `PreventiveMaintenancePage` |
| `src/app/(app)/preventive-maintenance/new/page.tsx` | `/preventive-maintenance/new` | `NewMaintenancePage` |
| `src/app/(app)/preventive-maintenance/[id]/page.tsx` | `/preventive-maintenance/:id` | `MaintenanceDetailsPage` |
| `src/app/(app)/preventive-maintenance/[id]/maintenance-plan-details-client.tsx` | — (client) | `MaintenancePlanDetailsClient` |
| `src/app/(app)/preventive-maintenance/[id]/edit/page.tsx` | `/preventive-maintenance/:id/edit` | `EditMaintenancePage` |

### Technicians

| File | Route | Export |
|---|---|---|
| `src/app/(app)/technicians/page.tsx` | `/technicians` | `TechniciansPage` |
| `src/app/(app)/technicians/new/page.tsx` | `/technicians/new` | `NewTechnicianPage` |
| `src/app/(app)/technicians/[id]/page.tsx` | `/technicians/:id` | `TechnicianDetailsPage` |
| `src/app/(app)/technicians/[id]/technician-details-client.tsx` | — (client) | `TechnicianDetailsClient` |
| `src/app/(app)/technicians/[id]/edit/page.tsx` | `/technicians/:id/edit` | `EditTechnicianPage` |

### Users

| File | Route | Export |
|---|---|---|
| `src/app/(app)/users/page.tsx` | `/users` | `UsersPage` |
| `src/app/(app)/users/new/page.tsx` | `/users/new` | `NewUserPage` |
| `src/app/(app)/users/[id]/page.tsx` | `/users/:id` | `UserDetailsPage` |
| `src/app/(app)/users/[id]/user-details-client.tsx` | — (client) | `UserDetailsClient` |
| `src/app/(app)/users/[id]/edit/page.tsx` | `/users/:id/edit` | `EditUserPage` |

### Organizations

| File | Route | Export |
|---|---|---|
| `src/app/(app)/organizations/page.tsx` | `/organizations` | `OrganizationsPage` |
| `src/app/(app)/organizations/new/page.tsx` | `/organizations/new` | `NewOrganizationPage` |
| `src/app/(app)/organizations/[id]/page.tsx` | `/organizations/:id` | `OrganizationDetailsPage` |
| `src/app/(app)/organizations/[id]/organization-details-client.tsx` | — (client) | `OrganizationDetailsClient` |
| `src/app/(app)/organizations/[id]/edit/page.tsx` | `/organizations/:id/edit` | `EditOrganizationPage` |

### Templates & Import

| File | Route | Export |
|---|---|---|
| `src/app/(app)/templates/page.tsx` | `/templates` | `TemplatesPage` |
| `src/app/(app)/templates/[id]/page.tsx` | `/templates/:id` | `TemplateDetailsPage` |
| `src/app/(app)/import/page.tsx` | `/import` | `ImportPage` |
| `src/app/(app)/import/wizard-client.tsx` | — (client) | `WizardClient` |

---

## 2. UI Primitives

All live under `src/components/ui/` and are re-exported from `src/components/ui/index.ts`.

| File | Exports |
|---|---|
| `badge.tsx` | `Badge` |
| `button.tsx` | `Button`, `buttonVariants` |
| `card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |
| `file-upload.tsx` | `FileUpload` |
| `infinite-select.tsx` | `InfiniteSelect`, `InfiniteSelectItem` |
| `input.tsx` | `Input` |
| `spinner.tsx` | `Spinner` |
| `table.tsx` | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` |
| `toast.tsx` | `toast` (function), `useToastStore` |

---

## 3. Layout & Shell

| File | Export | Purpose |
|---|---|---|
| `src/components/layout/app-shell.tsx` | `AppShell` | Sidebar nav + header shell wrapping all authenticated pages |

---

## 4. Data Grid

| File | Export | Purpose |
|---|---|---|
| `src/components/data-grid/ag-data-grid.tsx` | `AgDataGrid` | Generic AG Grid wrapper used on all list pages |
| `src/components/data-grid/data-import-wizard-modal.tsx` | `DataImportWizardModal` | Modal that opens the import wizard from a grid toolbar |

---

## 5. Common / Shared

| File | Export | Purpose |
|---|---|---|
| `src/components/common/auth-hydrator.tsx` | `AuthHydrator` | Syncs auth token into client state on hydration |
| `src/components/common/confirm-dialog.tsx` | `ConfirmDialog` | Reusable delete / destructive action confirmation dialog |
| `src/components/common/logout-button.tsx` | `LogoutButton` | Button that calls the logout route |
| `src/components/react-query-provider.tsx` | `ReactQueryProvider` | Wraps the app in `QueryClientProvider` |

---

## 6. Feature — Work Orders

**API layer:** `src/features/work-orders/wo-api.ts`  
**Base URL env:** `NEXT_PUBLIC_WO_BASE_URL` → `https://cafm.../work-order`

| File | Export | Purpose |
|---|---|---|
| `wo-api.ts` | `woFetch`, `buildWoSseUrl`, `getWoErrorMessage`, types (`WorkOrderResponse`, `JourneyResponse`, `JourneyHealth`, `StatusHistoryItem`, `DashboardStats`, `SSEEvent`, `OutlookStatus`, `EmailPollResult`) | Fetch helper + all type definitions for the WO microservice |
| `work-orders-grid.tsx` | `WorkOrdersGrid` | List page — KPI cards, status filter tabs, source breakdown, AG Grid table |
| `new-wo-form.tsx` | `NewWoForm` | Create form — asset/location autocomplete from WO API, `POST /api/work-orders/`, inline SSE approval watcher after submit |
| `work-order-form.tsx` | `WorkOrderForm` | Legacy form (used by edit page) — still coupled to old plenum API |

**Client components (under `src/app/`):**

| File | Export | Purpose |
|---|---|---|
| `work-orders/[id]/work-order-details-client.tsx` | `WorkOrderDetailsClient` | Detail page — journey stepper, health badge, status history, approve/prepare/activate/complete/close actions |
| `work-orders/email-inbox/email-inbox-client.tsx` | `EmailInboxClient` | Email inbox — Outlook connection status, poll-now, mock email list, AI extraction panel, `POST /api/work-orders/`, SSE approval watcher |

---

## 7. Feature — Assets

**API layer:** `src/features/assets/plenum-api.ts` (plenum CMMS API)

| File | Export | Purpose |
|---|---|---|
| `assets-grid.tsx` | `AssetsGrid` | List page with AG Grid, status + health score badges |
| `asset-form.tsx` | `AssetForm` | Shared controlled form (fields only, no submit) |
| `create-asset-form.tsx` | `CreateAssetForm` | Wraps `AssetForm`, handles create mutation |
| `edit-asset-form.tsx` | `EditAssetForm` | Wraps `AssetForm`, pre-fills with existing data |
| `asset-documents-panel.tsx` | `AssetDocumentsPanel` | Documents tab on asset detail page |
| `asset-categories-grid.tsx` | `AssetCategoriesGrid` | Categories management list |
| `actions.ts` | `createAssetAction`, `deleteAssetAction`, `updateAssetAction` | Next.js server actions |
| `types.ts` | `Asset`, `AssetStatus` | TypeScript types |

---

## 8. Feature — Locations

**API layer:** `src/features/locations/plenum-api.ts`

| File | Export | Purpose |
|---|---|---|
| `locations-grid.tsx` | `LocationsGrid` | List page with AG Grid |
| `location-form.tsx` | `LocationForm` | Shared controlled form |
| `create-location-form.tsx` | `CreateLocationForm` | Create mutation wrapper |
| `edit-location-form.tsx` | `EditLocationForm` | Edit mutation wrapper |
| `actions.ts` | server actions | — |
| `types.ts` | `PlenumLocation`, `LocationType` | TypeScript types |

---

## 9. Feature — Vendors

**API layer:** `src/features/vendor/plenum-api.ts`

| File | Export | Purpose |
|---|---|---|
| `vendors-grid.tsx` | `VendorsGrid` | List page with AG Grid |
| `vendor-form.tsx` | `VendorForm` | Shared controlled form |
| `create-vendor-form.tsx` | `CreateVendorForm` | Create mutation wrapper |
| `edit-vendor-form.tsx` | `EditVendorForm` | Edit mutation wrapper |
| `plenum-api.ts` | `listVendors`, `getVendor`, `createVendor`, `updateVendor`, `deleteVendor`, vendor contacts & contracts functions | API calls |
| `types.ts` | `Vendor`, `PlenumVendor`, `PlenumVendorContact`, `PlenumVendorContract` | TypeScript types |

---

## 10. Feature — Preventive Maintenance

**API layer:** `src/features/preventive-maintenance/plenum-api.ts`

| File | Export | Purpose |
|---|---|---|
| `maintenance-plans-grid.tsx` | `MaintenancePlansGrid` | List page with AG Grid |
| `maintenance-plan-form.tsx` | `MaintenancePlanForm` | Shared controlled form |
| `create-pm-form.tsx` | `CreatePmForm` | Create mutation wrapper |
| `edit-pm-form.tsx` | `EditPmForm` | Edit mutation wrapper |
| `plenum-api.ts` | `listMaintenancePlans`, `getMaintenancePlan`, `createMaintenancePlan`, `updateMaintenancePlan`, `deleteMaintenancePlan`, history functions | API calls |
| `types.ts` | `PlenumMaintenancePlan`, `PlenumMaintenanceHistory`, `PlenumPage` | TypeScript types |

---

## 11. Feature — Technicians

**API layer:** `src/features/technicians/plenum-api.ts`

| File | Export | Purpose |
|---|---|---|
| `technicians-grid.tsx` | `TechniciansGrid` | List page with AG Grid |
| `technician-form.tsx` | `TechnicianForm` | Shared controlled form |
| `technician-skills-panel.tsx` | `TechnicianSkillsPanel` | Skills tab on technician detail page |
| `plenum-api.ts` | `listTechnicians`, `getTechnician`, `createTechnician`, `updateTechnician`, `deleteTechnician`, `technicianDisplayName` | API calls |
| `types.ts` | `PlenumTechnician` | TypeScript types |

---

## 12. Feature — Users

**API layer:** `src/features/users/plenum-api.ts`

| File | Export | Purpose |
|---|---|---|
| `users-grid.tsx` | `UsersGrid` | List page with AG Grid |
| `user-form.tsx` | `UserForm` | Shared controlled form |
| `plenum-api.ts` | `listUsers`, `getUser`, `createUser`, `updateUser`, `deleteUser` | API calls |
| `types.ts` | `PlenumUser` | TypeScript types |

---

## 13. Feature — Templates

| File | Export | Purpose |
|---|---|---|
| `create-template-form.tsx` | `CreateTemplateForm` | Template creation form |
| `edit-template-form.tsx` | `EditTemplateForm` | Template edit form |
| `actions.ts` | `createTemplateAction`, `deleteTemplateAction`, `updateTemplateAction` | Server actions |
| `types.ts` | `Template` | TypeScript types |

---

## 14. Feature — Organizations

| File | Export | Purpose |
|---|---|---|
| `organizations-grid.tsx` | `OrganizationsGrid` | List page with AG Grid |
| `organization-form.tsx` | `OrganizationForm` | Shared controlled form |
| `plenum-api.ts` | Organization CRUD functions | API calls |

---

## 15. Feature — Manpower

| File | Export | Purpose |
|---|---|---|
| `create-manpower-form.tsx` | `CreateManpowerForm` | Manpower record creation |
| `edit-manpower-form.tsx` | `EditManpowerForm` | Manpower record editing |

---

## 16. Feature — Import / Wizard

| File | Export | Purpose |
|---|---|---|
| `import-uploader.tsx` | `ImportUploader` | File drop zone for data import |
| `wizard/Wizard.tsx` | `ImportWizard` | Multi-step wizard orchestrator |
| `wizard/steps/StepSourceSelect.tsx` | `StepSourceSelect` | Step 1 — choose data source |
| `wizard/steps/StepConnectionForm.tsx` | `StepConnectionForm` | Step 2 — connection credentials |
| `wizard/steps/StepFieldMapping.tsx` | `StepFieldMapping` | Step 3 — map fields |
| `wizard/steps/StepPreview.tsx` | `StepPreview` | Step 4 — preview mapped data |
| `wizard/steps/StepConfig.tsx` | `StepConfig` | Step 5 — final config |
| `wizard/steps/StepProgress.tsx` | `StepProgress` | Step 6 — import progress |
| `types.ts` | `ImportJob`, `ImportRow` | TypeScript types |

---

## 17. Feature — Authentication

| File | Export | Purpose |
|---|---|---|
| `src/features/auth/login-form.tsx` | `LoginForm` | Email + password login form |

---

## 18. Feature — AI Pipeline

All under `src/features/ai/`. Two pipelines: **Schema Mapper** and **Migration Ingestor**.

### Top-level AI components

| File | Export | Purpose |
|---|---|---|
| `unstructured-pipeline-panel.tsx` | `UnstructuredPipelinePanel` | Panel for unstructured doc RAG pipeline |
| `data-mode-decision-panel.tsx` | `DataModeDecisionPanel` | Decides which pipeline mode to use |
| `node-inspector.tsx` | `NodeInspector` | Per-node detail panel (logs, output, timing) |
| `pipeline-command-bar.tsx` | `PipelineCommandBar` | Top bar with pipeline controls |
| `chat-api.ts` | AI chat API helpers | — |

### Schema Mapper pipeline (`pipeline/schema/`)

| File | Export | Purpose |
|---|---|---|
| `schema-content.tsx` | `SchemaContent` | Main orchestrator — polls status, routes to the right gate/step UI |
| `schema-step-pause.tsx` | `SchemaStepPause` | Node step-pause card (shows node output, Next button) |
| `schema-pipeline-tracker.tsx` | `SchemaPipelineTracker` | Pipeline node progress bar |
| `schema-start-panel.tsx` | `SchemaStartPanel` | Start form (Fiix credentials or YAML upload) |
| `schema-results-panel.tsx` | `SchemaResultsPanel` | Completion screen with stats |
| `gates/schema-gate-pre-semantic.tsx` | `SchemaGatePreSemantic` | Gate 1 — approve/semantic for T1 matches |
| `gates/schema-gate-field-mapping.tsx` | `SchemaGateFieldMapping` | Gate 2 — accept/reject/override/custom/skip for low-confidence fields |
| `gates/schema-gate-hierarchy.tsx` | `SchemaGateHierarchy` | Gate 3 — FK relationship confirm/reject |

### Migration Ingestor pipeline (`pipeline/migration/`)

| File | Export | Purpose |
|---|---|---|
| `migration-content.tsx` | `MigrationContent` | Main orchestrator — polls status, routes to gate/step UI |
| `step-pause.tsx` | `MigrationStepPause` | Node step-pause card |
| `pipeline-tracker.tsx` | `MigrationPipelineTracker` | Pipeline node progress bar |
| `upload-panel.tsx` | `MigrationUploadPanel` | File upload / URL start panel |
| `results-panel.tsx` | `MigrationResultsPanel` | Completion screen with download links |
| `gates/gate-pre-semantic.tsx` | `GatePreSemantic` | Gate 0 — T1 mapping approval |
| `gates/gate-semantic-review.tsx` | `GateSemanticReview` | Semantic review gate |
| `gates/gate-field-mapping.tsx` | `GateFieldMapping` | Gate 1 — low-confidence + unmapped field decisions |
| `gates/gate-hierarchy.tsx` | `GateHierarchy` | Gate 2 — FK hierarchy confirm/reject |
| `gates/gate-final.tsx` | `GateFinal` | Gate 3 — final sign-off before output write |

### Doc RAG pipeline (`pipeline/doc-rag/`)

| File | Export | Purpose |
|---|---|---|
| `doc-rag-content.tsx` | `DocRagContent` | Unstructured document RAG pipeline UI |

---

## Config & Services

| File | Purpose |
|---|---|
| `src/config/env.ts` | Reads all `NEXT_PUBLIC_*` env vars; exports `env` object |
| `src/constants/app.ts` | `APP_ROUTES` — all named route paths |
| `src/services/api/client.ts` | `apiFetch` — plenum CMMS API fetch helper |
| `src/features/ai/chat-api.ts` | `aiApiFetch` — AI service fetch helper |
| `src/features/work-orders/wo-api.ts` | `woFetch` — WO microservice fetch helper |
