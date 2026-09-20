# MediVault

A patient-owned personal medical-record organization platform: upload
reports, run OCR extraction, review and correct the results, organize and
search your medical history, and export a PDF summary. MediVault does not
diagnose or interpret medical results.

## Follow-up fix — Export and Image Vault "Invalid query parameters"

Both pages fetch one large page instead of paginating (`FETCH_PAGE_SIZE = 500`
in `Exports.tsx` and `ImageVault.tsx`), by design — they're meant to be a
browsable picker and a browsable grid, not paged lists. The backend's list
schema (`reports.controller.ts`) capped `pageSize` at 100, so every request
from either page failed validation and both screens showed nothing but that
error. Raised the cap to 500 to match, with a comment tying the two together
so they don't drift apart again. Covered by a new test in
`regressions.test.ts`.

## Trends removed

The Trends tab (`/trends`) and its backend (`/api/analytics`) have been
removed entirely, along with everything that only existed to support it:

- `frontend/src/pages/Trends.tsx` and `frontend/src/charts/TrendChart.tsx`
  (the `charts/` folder is now gone)
- `backend/src/modules/analytics/` (routes, controller, service)
- the `/api/analytics` mount in `app.ts`
- the route, nav link, and dashboard quick-action link that pointed at it
- the `chart.js` / `react-chartjs-2` dependencies in `frontend/package.json`
  (nothing else in the app used them)
- the analytics test block in `regressions.test.ts`

`TestValue.confidence` and the rest of the test-value data model are
untouched — only the page that visualized them, and the read-only endpoints
that fed it, are gone. Run `npm install` in `frontend/` after pulling this
to prune `chart.js`/`react-chartjs-2` from `node_modules` and the lockfile.

## OCR hardening pass — making the pipeline survive bad days

The OCR path worked on the happy path and fell apart around it. This pass
went through it failure mode by failure mode.

### Work was lost permanently on restart

The in-process queue holds jobs in memory, so a deploy, a crash, an OOM
kill, or `ts-node-dev` reloading on file save silently destroyed whatever
was queued or mid-flight. A report caught in `PROCESSING` stayed in
`PROCESSING` forever: the upload screen polled it indefinitely, and the
record could never be reviewed, verified or exported. There was no path
back short of editing the database by hand.

`jobs/recovery.ts` now reconciles at startup — reports stuck in
`UPLOADED`/`PROCESSING` are reset and re-enqueued, as are interrupted export
jobs. It is deliberately bounded: a new `Report.ocrAttempts` counter caps
automatic retries at three, so a file that reliably kills the process turns
into one clearly-failed report rather than a boot loop. Shutdown is now
graceful too (drain the queue, then release the Tesseract worker) instead of
calling `process.exit(0)` out from under a running job.

### A timed-out Tesseract worker was kept and reused

`recognize()` was raced against a 45s timeout, but losing that race only
abandoned the promise — the recognition kept running inside the shared
worker, which was then handed to the next page. From the first timeout
onward the whole pipeline could hang behind it or return the previous page's
text. The worker is now torn down and rebuilt after any timeout.

The service also no longer depends on the queue for mutual exclusion. The
old comment said reuse was "safe because OCR jobs are serialized on the
in-process queue" — true at the time, and silently false the moment a second
caller appeared (which the new reprocess endpoint is). `extractText` now
takes its own lock.

### OCR did not work offline

A 5MB `eng.traineddata` ships in `backend/` and nothing used it, so the
first OCR request after any deploy downloaded the language model from a CDN.
On an air-gapped, firewalled or simply offline host, OCR did not work at
all — and the failure surfaced to the user as "no readable text detected".
The worker now looks for local language data (`TESSDATA_DIR`, `./tessdata`,
the backend root) and only falls back to downloading if it finds none.

### A 30-page PDF could take the process down

`rasterizePdfPages` returned every page as a 300-DPI PNG in one array, and
the caller then ran `Promise.all` to preprocess all of them — so a 30-page
document held 30 full-size rasters plus 30 preprocessed copies in memory at
once, comfortably into the hundreds of megabytes. Pages are now rendered and
recognized one at a time (`openPdfPages().renderPage(i)`), density drops to
200 DPI past ten pages, and there are explicit ceilings on input pixels
(decompression bombs) and on the resolution handed to Tesseract — a 50MP
phone photo of an A4 page gains nothing from full resolution and costs
minutes of OCR lane time.

### "Per-page isolation" only covered recognition

The comment promised that one bad page would not sink the rest, but only the
`recognize` call was wrapped. Rasterization and preprocessing both sat
outside, so a single corrupt page threw all the way out and failed the whole
document. Now every stage is contained: preprocessing never throws (it falls
back to the original bytes), a page that will not rasterize contributes an
empty result, and the remaining pages carry on.

Relatedly, average confidence was computed across *all* pages including
failed ones scored as zero — so one blank page in a clean ten-page PDF could
drag the mean under the noise threshold and fail an otherwise perfect
extraction. It now averages only pages that produced a reading.

### A dense lab report could exceed the transaction timeout

The extraction wrote two sequential inserts per test value inside one
interactive transaction. A report with 300 values meant 600+ round trips
against Prisma's 5-second default — and blowing that budget failed a
perfectly good extraction, reported to the user as an OCR error. Rows are
now built outside the transaction and written with `createMany`, with an
explicit 30s timeout.

Output is also capped (300 test values, 200 fields, 500k characters of
extracted text) so a scan of a page border cannot emit thousands of junk
"test values" into the trends chart. When a cap or the page limit is hit,
the new `Report.processingNotice` column records it and the UI says so —
silently returning a partial medical record is worse than returning none.

### The pipeline trusted a client-controlled MIME type

Branch selection used the `Content-Type` the browser attached to the
multipart part, which is derived from the filename. A PDF saved as
`results.png` went down the image branch and produced garbage; a JPEG named
`scan.pdf` went to the rasterizer and failed. `services/file-type.service.ts`
now sniffs magic bytes; uploads are validated and stored by what the file
actually is, and a mismatch is logged.

### Failures were permanent

`POST /api/reports/:id/reprocess` re-runs OCR for a report you own. Transient
failures — a timeout under load, a restart mid-job, the language model still
warming up — previously left a report in `OCR_FAILED` forever, with deleting
and re-uploading the same file as the only remedy. The button appears on the
upload failure screen and on Record Detail.

### The parser degraded super-linearly

`valueAfterLabel` compiled a fresh `RegExp` per label, per line, per field
definition — and again for all ~70 labels on each of up to five lookahead
lines. Both dedupe passes were quadratic. On a long document that is
millions of regex compilations inside the job holding the OCR lane. Patterns
are now cached, the flattened label list is built once, dedupes are
`Set`-based, and line count and length are bounded for pathological input.

### Other pipeline fixes

- Jobs now run on per-name lanes, so a PDF export no longer queues behind
  every pending OCR job. Each job type has its own attempt count, backoff
  and hard timeout, and a failed job can no longer poison its lane.
- Every status write in the OCR job uses `updateMany`, so a report deleted
  mid-job is a no-op rather than an exception thrown from inside an error
  handler and escaping as an unhandled rejection.
- Unreadable stored files, zero-byte files and archived reports are all
  handled explicitly with distinct, honest messages.
- `unhandledRejection` and `uncaughtException` handlers log instead of
  letting the process die silently.
- An invalid parsed date can no longer reach Prisma as `Invalid Date`.

New tests: `src/tests/ocr-robustness.test.ts` (file-type detection,
preprocessing-never-throws, parser bounds) plus reprocess and
upload-validation cases in `src/tests/regressions.test.ts`. These are pure
unit/API tests — they need no Tesseract and no network.

## Second audit pass — issues found by re-reading against the running flows

The first pass fixed real bugs but verified them by reading files in
isolation. This pass traced each feature end to end (route registered? page
routed? header set? status transition reachable?) and found four things the
first pass missed, plus a set of smaller ones.

**Trends was completely unreachable — in both directions.** *(This feature
was later removed entirely — see "Trends removed" above — but the bug is
kept here as a record of what the second audit pass found.)*
- `analytics.routes.ts` was written but never mounted in `app.ts`, so
  `GET /api/analytics/tests` and `/api/analytics/tests/:testName` both 404'd.
  Now mounted at `/api/analytics`.
- `Trends.tsx` had no `<Route>` in `App.tsx` and no link in either nav, so
  the page could not be opened even if the API had worked. `TrendChart.tsx`
  was dead alongside it. Now routed at `/trends`, linked from the desktop nav
  and the dashboard quick actions.
- Regression tests now assert the analytics endpoints answer (and still
  require auth), so this cannot silently rot again.

**Every image and PDF preview in the app was broken.**
The signed-link route did `res.send(buffer)` with no `Content-Type`, so
Express defaulted to `application/octet-stream` — and `helmet()` sends
`X-Content-Type-Options: nosniff`, which tells the browser not to sniff its
way to the real type. The bytes arrived and the browser refused to render
them. That silently killed the Image Vault grid, the original-document panel
on both Review and Record Detail, and the profile photo. The route now
derives the media type from the stored file key's extension
(`mimeTypeForFileKey`) and sets `Content-Type`, `Content-Disposition: inline`
and `Cache-Control: private, no-store`.

While fixing it, the route moved out of the reports router into its own
`src/modules/files` router mounted at `/api/files`: profile photos are served
through the same signed tokens, and routing a users-module asset through
`/api/reports/file/...` was misleading. Signed URLs are now `/api/files/<token>`.
Token verification also switched to `crypto.timingSafeEqual`.

**The OCR-failure path dead-ended.**
`verify` rejected any report in `OCR_FAILED`, but the upload failure screen
invites the user to "Enter Information Manually" and nothing in the review
save path moved the status off `OCR_FAILED`. So a user could follow the
prompt, type in every value by hand, press Verify, and get an error with no
way forward. Now, applying any field or test-value edit (or correcting the
category/date) promotes an `OCR_FAILED` report to `PENDING_REVIEW` and clears
`failureReason`. Verifying with genuinely nothing entered still refuses, but
with a message that says what to do.

**`env.ts` did not actually require anything.**
Every `required()` call passed a development fallback, including both JWT
secrets — so a production deploy missing `JWT_ACCESS_SECRET` booted happily
on the published placeholder. Since that same secret signs the HMAC
file-access tokens, anyone who knew the default could mint a valid link to
any stored file. Secrets are now validated when `NODE_ENV=production`: present,
not a placeholder, at least 32 characters. Development behaviour is unchanged.

**Smaller fixes:**
- `reports.service.update` stamped `editedByUser: true` unconditionally, so
  Review's save (and save-on-verify) marked a report user-edited with zero
  edits — undoing at report level the provenance discipline `fields.service.ts`
  takes such care with at field level. It now diffs against the stored values
  and no-ops when nothing changed.
- Clearing a test value's unit or reference range was impossible: the empty
  string became `undefined`, which Prisma reads as "leave unchanged". The
  review screen now sends `null`, the Zod schemas accept it, and the service
  normalizes blank-to-`null`. Same fix applied to the report date.
- `removeTestValue` / `removeOtherField` in Review had no error handling — a
  failed delete became an unhandled promise rejection and the row stayed on
  screen unexplained. They now surface a toast and leave the row intact.
- Half-filled rows (a value typed with no test name) were silently dropped at
  save time, which looks identical to a failed save. Review now says so.
- `new-${Date.now()}` temp ids collided for rows added within the same
  millisecond, producing duplicate React keys. Replaced with a counter.
- The review/detail preview chose its viewer from the filename, so a PDF
  uploaded without a `.pdf` extension rendered as a broken image. Both pages
  now share a `DocumentPreview` component that switches on `mimeType`.
- The rate limiter's `hits` map was never pruned — one entry per distinct
  client IP, forever. It now sweeps aged-out keys and sends `Retry-After`.
- An unparseable `recordedDate` reached Prisma as `Invalid Date` and failed
  deep in the driver; it is now rejected with a clear message.

New tests live in `src/tests/regressions.test.ts`, one per issue above.

**Still not run in a browser.** This environment has no network access, so
`npm install`, `npm run build` and `npm test` could not be executed here —
every backend file was syntax-checked with Node's type stripper, and the
changes were traced by hand, but please run the build and the suite before
trusting them.

## First audit pass — what changed and why

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

**On robustness limits of the in-process queue:** it is not durable, by
design — jobs live in memory. That is survivable only because startup
reconciliation (`src/jobs/recovery.ts`) re-enqueues interrupted work. If you
replace the queue with BullMQ, that reconciliation becomes redundant but
harmless; if you replace it with anything else, keep the contract.

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

Tesseract's language data ships with the repo (`backend/eng.traineddata`)
and is used directly, so OCR works with no network access. If you change
`OCR_LANGUAGE` to a language with no local `.traineddata` file, tesseract.js
downloads it on first use instead — set `TESSDATA_DIR` to point at your own
directory if you prefer to supply it yourself.

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
5. Find it in **Records** or the **Image Vault**, search/filter it, and
   **Export** a PDF summary.

## Running tests

```bash
cd backend
npm test
```

Covers registration/login/refresh/logout, cross-user authorization
(verifying a user can never view, edit, delete, or export another user's
reports), the second-pass regressions (analytics routes reachable, signed
links serving a real Content-Type, manual entry rescuing an OCR_FAILED
report, report-level provenance, clearing optional fields),
duplicate-upload detection, OCR/user provenance preservation
  across saves, and the parser's digit-confusion correction, table separators,
  decimal commas, and date/category extraction (pure unit tests, no Tesseract
  or network needed). Test setup automatically applies Prisma migrations to a
  disposable SQLite database.

## Updating from a previous checkout

The schema changed in these passes (added `TestValue.confidence`,
`Report.fileHash`, `Report.processingNotice`, `Report.ocrAttempts`, and
profile identity/photo fields). If you already have a `backend/prisma/dev.db`
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
│   │   │   ├── files/        # signed-URL file serving (/api/files/:token)
│   │   │   └── exports/      # PDF export jobs
│   │   ├── jobs/             # in-process queue (per-job lanes, retries,
│   │   │                       timeouts), startup recovery, OCR/export
│   │   │                       job handlers
│   │   ├── services/         # StorageService, OCRService, image preprocessing/
│   │   │                       PDF rasterization, file-type sniffing,
│   │   │                       PDF generation
│   │   └── tests/            # auth, cross-user authorization, duplicate-upload,
│   │                           field-provenance, and OCR parser unit tests
│   └── prisma/schema.prisma
└── frontend/
    └── src/
        ├── pages/            # Login, Register, Dashboard, Upload, Review,
        │                       Records, RecordDetail, ImageVault, Exports,
        │                       Profile
        ├── components/       # StatusBadge, ConfidenceBadge, SourceTag, nav,
        │                       ToastProvider, ErrorBoundary, ConfirmDialog,
        │                       PageHeader, Skeleton, ErrorState,
        │                       DocumentPreview
        ├── layouts/          # AppLayout, ProtectedRoute
        ├── auth/             # AuthContext (JWT access/refresh handling)
        └── services/api.ts   # axios client with token refresh
```

## Security notes

- Every report/field/test-value/export query is scoped to
  `(id AND ownerId)` — never by id alone (see `reports.service.ts`,
  `fields.service.ts`, `exports.service.ts`).
- Files are stored privately; the only way to view one is through an
  authenticated endpoint or a short-lived, HMAC-signed URL
  (`storage.service.ts`, served by `modules/files`) — never a permanent
  public link. Token signatures are compared in constant time.
- JWT secrets must be supplied explicitly in production (`config/env.ts`);
  the process refuses to start on a placeholder or a short secret.
- Passwords are hashed with Argon2; access tokens are short-lived JWTs;
  refresh tokens are opaque, stored server-side, and rotated on each use.
- OCR results are always editable and clearly tagged `ocr` vs. `user` in
  the database and UI (`SourceTag`).

## What's intentionally out of scope (per product rules)

No medical diagnosis, no interpretation of abnormal results, no predictive
health scoring, no hospital/doctor-portal integrations, no multi-patient
family accounts. MediVault organizes records; it does not make medical
decisions.
