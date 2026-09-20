# MediVault

A patient-owned personal medical-record organization platform: upload
reports, run OCR extraction, review and correct the results, organize and
search your medical history, chart selected test trends, and export a PDF
summary. MediVault does not diagnose or interpret medical results.

## Audit pass — what changed and why

This codebase went through a full audit (not a cosmetic pass) that found
and fixed real bugs. In order of impact:

**OCR pipeline (previously unreliable):**
- **PDFs were never actually OCR'd.** Tesseract has no native PDF support,
  and the original code handed it raw PDF bytes — every PDF upload
  silently produced empty/garbage text. Fixed: PDFs are now rasterized
  page-by-page (`services/image-preprocess.service.ts`,
  `rasterizePdfPages`) before OCR runs on each page.
- **No image preprocessing existed** despite `sharp` being a declared
  dependency. Added a conditional pipeline — auto-orient via EXIF,
  grayscale, upscale-if-small, contrast normalization, light sharpen — in
  `preprocessImageForOcr`.
- **No digit-confusion correction.** OCR commonly misreads `I`/`l`/`|` as
  `1`, `O` as `0`, etc. inside numeric medical values (`I2.5` instead of
  `12.5`). Added targeted correction in `modules/ocr/parser.ts` that only
  touches digit-anchored tokens, so units like `IU/L` are left alone.
- **No per-value confidence.** `TestValue` had no `confidence` column —
  the review screen was previously showing a hardcoded fake value. Added
  a real `confidence` field, populated per-extraction, and wired through
  to the UI's low-confidence warnings.
- **Reference ranges weren't captured.** Parser now extracts a trailing
  `(70-110)`-style range into `referenceRangeText`.
- **No duplicate-upload detection.** Uploads are now hashed (SHA-256);
  re-uploading the same file within 30 days surfaces a non-blocking
  warning naming the earlier upload.

**Provenance / data integrity bug:**
- The Review screen re-submits *every* field on every "Save Changes"
  click, even untouched ones. The original `fields.service.ts` stamped
  `source="user"` unconditionally on any submitted field — meaning simply
  opening and saving a report with zero edits silently destroyed the
  OCR-vs-user-edited distinction for every field. Fixed: a field is only
  re-stamped `user` if its value actually changed from what's stored.

**Frontend bugs:**
- `Dashboard`, `Records`, `RecordDetail`, `Trends`, `Exports`, `Profile`
  had no error handling around their data loads — a failed request left
  the page stuck on a loading skeleton forever. All now have retryable
  error states.
- `Review.tsx` fetched extracted fields but never rendered or made them
  editable — only category/date/test-values were editable, so anything
  else OCR extracted (patient name, doctor, etc.) was invisible and
  permanently stuck as OCR's first guess. Added a full editor for these.
- `Records.tsx`'s search had no protection against out-of-order API
  responses — typing quickly could let a slow earlier request overwrite
  a newer one's results with stale data. Fixed with a request-id guard.
- `Upload.tsx`'s status-polling `setInterval` was never cleared on
  unmount — navigating away mid-upload left it running (and hitting the
  API every 1.5s) indefinitely. Fixed.
- `window.confirm()` (blocking, unstyled, poor screen-reader support)
  replaced with an accessible `ConfirmDialog`.
- Added a top-level `ErrorBoundary` — previously any render exception
  blank-screened the whole app with no recovery path.
- Added a toast/notification system for action confirmations (verify,
  delete, archive, save, export) that previously gave no feedback.
- Added `PageHeader` with an explicit back affordance on sub-pages, so
  navigating out of Review/Record Detail doesn't rely solely on the
  browser back button.
- Accessibility: `aria-live` on OCR processing steps and toasts, `role="alert"`
  on error banners, `aria-label`s on icon-only buttons and filter
  controls, focus management in the confirm dialog, `sr-only` status text.
- Logging: request logs now strip query strings, so search terms typed
  into Records/Trends never land in application logs.
- Upload errors now distinguish "file too large" from "wrong file type"
  instead of one generic message.

**A known limitation of this pass:** I audited and fixed this by reading
every file carefully, not by running the app in a browser — this sandbox
has no network access to `npm install` or spin up a live instance. Please
run `npm run build` in both `backend/` and `frontend/`, and `npm test` in
`backend/`, after pulling these changes, and let me know what surfaces.

**One thing to verify on your end:** PDF rasterization depends on the
installed `sharp`/libvips build including PDF support (bundled in recent
sharp prebuilt binaries via PDFium, but this can vary by platform/version).
If a PDF report gets marked `OCR_FAILED` with "We couldn't read this PDF
for processing," that's this dependency missing rather than a crash —
manual entry still works, but let me know and I'll look at fallback options.

## Why this build differs from the original spec

This is the **single-container, no-Docker** variant, built for fast local
testing without external services:

| Original spec              | This build                                         |
|-----------------------------|-----------------------------------------------------|
| PostgreSQL                  | **SQLite** via Prisma (same schema; change one line in `prisma/schema.prisma` to move to Postgres in production) |
| Redis + BullMQ workers       | **In-process job queue** (`src/jobs/queue.ts`) — OCR and PDF export still run asynchronously off the request thread, just on the same Node process instead of separate worker processes |
| Docker Compose               | Not required — run `npm run dev` in each folder |
| S3 object storage            | Local private filesystem storage (`backend/uploads/`), behind the same `StorageService` interface an S3 implementation would use |

Everything else — auth, ownership scoping, OCR pipeline, review/verify
workflow, provenance tracking, search/filter, trends, PDF export — is real,
working code, not a mockup.

**To move toward the original production spec later:** swap
`provider = "sqlite"` for `"postgresql"` in `prisma/schema.prisma`, point
`DATABASE_URL` at Postgres, and replace `InProcessQueue` (`src/jobs/queue.ts`)
with real BullMQ `Queue`/`Worker` instances that call the same job handler
functions in `src/jobs/ocr.job.ts` and `src/jobs/export.job.ts` — no other
application code needs to change, since both are already written behind
that interface. Swap `LocalStorageService` for an S3-backed implementation
of the same `StorageService` interface for production file storage.

## Prerequisites

- Node.js 18+
- npm

No Postgres, Redis, or Docker installation needed for local dev.

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate     # creates dev.db and applies the schema
npm run dev                 # starts the API on http://localhost:5000
```

The first OCR run downloads Tesseract's language data automatically the
first time `tesseract.js` is used; this requires network access on that
first request only (subsequent runs are cached locally).

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev                 # starts the app on http://localhost:5173
```

The Vite dev server proxies `/api` requests to `http://localhost:5000`
(see `frontend/vite.config.ts`), so just open http://localhost:5173.

### 3. Try it out

1. Register an account at `/register`.
3. Fill in your health profile, including an optional photo and emergency
  contact.
4. Go to **Upload Report**, choose a JPG/PNG/WebP/TIFF/BMP/AVIF/PDF (or take
  a photo on mobile).
4. Watch the OCR processing steps, then **Review Report** — correct any
   extracted test values, then **Verify**.
5. Find it in **Records**, search/filter it, view **Trends** for any
   numeric test values, and **Export** a PDF summary.

## Running tests

```bash
cd backend
npm test
```

Covers registration/login/refresh/logout, cross-user authorization
(verifying a user can never view, edit, delete, or export another user's
reports), duplicate-upload detection, OCR/user provenance preservation
  across saves, and the parser's digit-confusion correction, table separators,
  decimal commas, and date/category extraction (pure unit tests, no Tesseract
  or network needed). Test setup automatically applies Prisma migrations to a
  disposable SQLite database.

## Updating from a previous checkout

The schema changed in this pass (added `TestValue.confidence`, `Report.fileHash`,
and profile identity/photo fields). If you already have a `backend/prisma/dev.db`
from before, re-run the migration to pick up the new columns:

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
```

Prisma will detect the schema diff and create a new migration; accept the
prompt to apply it. Existing reports/test-values keep their data — the new
columns are added as nullable, so nothing is lost.

## Project structure

```text
MediVault/
├── backend/
│   ├── src/
│   │   ├── config/           # env, Prisma client
│   │   ├── middleware/       # auth, error handling, rate limiting
│   │   ├── types/enums.ts    # ReportStatus/Category/FieldSource/ExportStatus union types
│   │   ├── modules/
│   │   │   ├── auth/         # register, login, refresh, logout
│   │   │   ├── users/        # health profile
│   │   │   ├── reports/      # upload, CRUD, review/edit fields, file access
│   │   │   ├── ocr/          # rule-based category/date/test-value parser
│   │   │   ├── analytics/    # test trend history
│   │   │   └── exports/      # PDF export jobs
│   │   ├── jobs/             # in-process queue + OCR/export job handlers
│   │   ├── services/         # StorageService, OCRService, image preprocessing/
│   │   │                       PDF rasterization, PDF generation
│   │   └── tests/            # auth, cross-user authorization, duplicate-upload,
│   │                           field-provenance, and OCR parser unit tests
│   └── prisma/schema.prisma
└── frontend/
    └── src/
        ├── pages/            # Login, Register, Dashboard, Upload, Review,
        │                       Records, RecordDetail, Trends, Exports, Profile
        ├── components/       # StatusBadge, ConfidenceBadge, SourceTag, nav,
        │                       ToastProvider, ErrorBoundary, ConfirmDialog,
        │                       PageHeader, Skeleton, ErrorState
        ├── layouts/          # AppLayout, ProtectedRoute
        ├── auth/             # AuthContext (JWT access/refresh handling)
        ├── charts/           # Chart.js trend chart
        └── services/api.ts   # axios client with token refresh
```

## Security notes

- Every report/field/test-value/export query is scoped to
  `(id AND ownerId)` — never by id alone (see `reports.service.ts`,
  `fields.service.ts`, `exports.service.ts`).
- Files are stored privately; the only way to view one is through an
  authenticated endpoint or a short-lived, HMAC-signed URL
  (`storage.service.ts`) — never a permanent public link.
- Passwords are hashed with Argon2; access tokens are short-lived JWTs;
  refresh tokens are opaque, stored server-side, and rotated on each use.
- OCR results are always editable and clearly tagged `ocr` vs. `user` in
  the database and UI (`SourceTag`).

## What's intentionally out of scope (per product rules)

No medical diagnosis, no interpretation of abnormal results, no predictive
health scoring, no hospital/doctor-portal integrations, no multi-patient
family accounts. MediVault organizes records; it does not make medical
decisions.
