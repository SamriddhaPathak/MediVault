<div align="center">

# MediVault

**A patient-owned personal medical-record organizer.**

Upload reports, let OCR pull out the details, review and correct them, then
search, organize, and export your own medical history – all in one private
vault.

</div>

![MediVault dashboard](MediVault.png)

## What it does

MediVault is a single-user web app for keeping your own medical records in
one place instead of scattered across emails, photo galleries, and paper
folders.

- **Upload** a photo or PDF of a lab report, prescription, radiology scan,
  vaccination record, or any other document.
- **OCR extraction** automatically pulls out the report date, category,
  patient/doctor fields, and individual lab test values (with units and
  reference ranges).
- **Review & verify** every extracted value before it's trusted – anything
  OCR got wrong is a click away from being corrected, and the app always
  tracks whether a field came from OCR or from you.
- **Organize & search** your full history by category, date, or free text,
  and browse original documents in a dedicated Image Vault.
- **Export** a clean PDF summary of any set of records, ready to bring to an
  appointment or share with a new provider.

MediVault does not diagnose, interpret, or score your results – it
organizes them. See [Scope](#scope) below.

## Tech stack

| Layer     | Technology |
|-----------|------------|
| Frontend  | React 18, Vite, TypeScript, Tailwind CSS, React Router |
| Backend   | Node.js, Express, TypeScript |
| Database  | SQLite via Prisma ORM (swappable to PostgreSQL) |
| Auth      | JWT access tokens + rotated refresh tokens, Argon2 password hashing |
| OCR       | Tesseract.js, with local language data bundled for offline use |
| Files     | PDFKit (PDF export), Sharp (image preprocessing), local filesystem storage |
| Jobs      | In-process async queue (OCR and PDF export run off the request thread) |

This build is intentionally **dependency-light for local development**: no
Docker, no Postgres server, and no Redis are required to run it. See
[Running this in production](#running-this-in-production) for how each
piece maps onto a hosted deployment.

## Project structure

```text
MediVault/
├── backend/
│   ├── src/
│   │   ├── config/        # env validation, Prisma client, startup schema check
│   │   ├── middleware/     # auth, error handling, rate limiting
│   │   ├── modules/
│   │   │   ├── auth/       # register, login, refresh, logout
│   │   │   ├── users/      # health profile
│   │   │   ├── reports/    # upload, CRUD, review/edit fields
│   │   │   ├── ocr/        # rule-based category/date/test-value parser
│   │   │   ├── files/      # signed-URL file serving
│   │   │   └── exports/    # PDF export jobs
│   │   ├── jobs/           # in-process queue, startup recovery, job handlers
│   │   ├── services/       # storage, OCR, image preprocessing, PDF generation
│   │   └── tests/          # auth, cross-user authorization, OCR, regressions
│   └── prisma/schema.prisma
└── frontend/
    └── src/
        ├── pages/          # Login, Register, Dashboard, Upload, Review,
        │                     Records, RecordDetail, ImageVault, Exports, Profile
        ├── components/     # shared UI: nav, badges, toasts, dialogs, illustrations
        ├── lib/            # display-formatting helpers
        ├── layouts/        # app shell, protected-route guard
        ├── auth/           # auth context (JWT handling)
        └── services/api.ts # axios client with token refresh
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (comes with Node.js)

No PostgreSQL, Redis, or Docker installation is needed for local
development: the SQLite database, job queue, and file storage all run
in-process.

## Getting started

The steps are the same on every platform; only how you copy the environment
file differs.

### 1. Clone and configure the backend

**macOS / Linux:**

```bash
cd backend
cp .env.example .env
```

**Windows (PowerShell):**

```powershell
cd backend
copy .env.example .env
```

**Windows (Command Prompt):**

```cmd
cd backend
copy .env.example .env
```

The defaults in `.env` work out of the box for local development. Before
deploying anywhere real, read the comments in `.env.example` and replace
the placeholder JWT secrets; the server will refuse to start in production
with default or short secrets.

### 2. Install and start the backend

```bash
npm install
npm run prisma:generate
npm run prisma:migrate     # creates dev.db and applies the schema
npm run dev                 # starts the API on http://localhost:5000
```

Tesseract's English language data ships with the repo
(`backend/eng.traineddata`), so OCR works immediately with no network
access. To use a different language, set `OCR_LANGUAGE` in `.env`; if no
local `.traineddata` file is found, `tesseract.js` downloads it on first
use (set `TESSDATA_DIR` to point at your own copy to avoid that).

### 3. Install and start the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev                 # starts the app on http://localhost:5173
```

The Vite dev server proxies `/api` requests to `http://localhost:5000`
(configured in `frontend/vite.config.ts`), so once both servers are
running, just open **http://localhost:5173**.

### 4. Try it out

1. Register an account at `/register`.
2. Fill in your health profile (optional photo and emergency contact).
3. Go to **Upload Report** and add a JPG, PNG, WebP, TIFF, BMP, AVIF, or
   PDF file (or take a photo on mobile).
4. Watch the OCR processing steps, then open **Review Report** to check
   and correct the extracted values, and **Verify** when it looks right.
5. Find it in **Records** or the **Image Vault**, filter or search for it,
   and generate a PDF from **Exports**.

## Running the test suite

```bash
cd backend
npm test
```

Tests cover registration/login/refresh/logout, cross-user authorization
(a user can never view, edit, delete, or export another user's records),
OCR robustness (file-type detection, parser edge cases, preprocessing
failures), duplicate-upload detection, field provenance (OCR vs.
user-edited tracking), and targeted regression tests. These are unit/API
tests that need no Tesseract execution and no network access; test setup
automatically applies Prisma migrations to a disposable SQLite database.

## Building for production

```bash
# Backend
cd backend
npm run build      # compiles TypeScript to dist/
npm start           # runs the compiled server

# Frontend
cd frontend
npm run build       # outputs a static build to dist/
npm run preview      # serve the production build locally to sanity-check it
```

## Environment variables

All backend configuration lives in `backend/.env` (see `.env.example` for
the full list with inline explanations). The essentials:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file path in dev; a PostgreSQL connection string in production |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Sign access/refresh tokens. **Must** be explicit, unique, 32+ characters in production |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Token lifetimes (e.g. `15m`, `7d`) |
| `STORAGE_PROVIDER` / `STORAGE_LOCAL_DIR` | File storage backend; local filesystem by default |
| `MAX_UPLOAD_SIZE_BYTES` | Upload size cap |
| `OCR_LANGUAGE` / `TESSDATA_DIR` | OCR language and where to find its trained data |
| `EXPORT_LOCAL_DIR` / `EXPORT_URL_TTL_MINUTES` | Where generated PDF exports are written and how long their signed links stay valid |

## Updating from a previous checkout

If the Prisma schema has changed since you last pulled, re-run the
migration to pick up new columns:

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
```

The backend also detects a schema/database mismatch at startup and applies
any pending migrations automatically outside of production, so `npm run
dev` should self-heal in most cases.

## Running this in production

This repository ships the **single-container, no-Docker** variant, built
for fast local development without external services. Each piece sits
behind an interface so it can be swapped for the production equivalent
without touching the rest of the app:

| This build | Production equivalent |
|---|---|
| SQLite via Prisma | PostgreSQL: change `provider` in `prisma/schema.prisma` to `"postgresql"` and point `DATABASE_URL` at it |
| In-process job queue (`src/jobs/queue.ts`) | Redis + BullMQ: replace `InProcessQueue` with real `Queue`/`Worker` instances calling the same handler functions in `src/jobs/ocr.job.ts` and `src/jobs/export.job.ts` |
| Local filesystem storage | S3 (or compatible): implement the same `StorageService` interface used by `LocalStorageService` |
| Single Node process | Any container/orchestration setup of your choice; no Docker Compose file is provided, but none of the app's design assumes it can't run in one |

## Security notes

- Every report, field, test value, and export query is scoped to the
  requesting user (`ownerId`), never looked up by id alone.
- Uploaded files are stored privately. The only way to view one is through
  an authenticated endpoint or a short-lived, HMAC-signed URL, never a
  permanent public link, and signatures are compared in constant time.
- JWT secrets must be supplied explicitly in production; the server exits
  on startup if they're missing, short, or left as the development
  placeholder.
- Passwords are hashed with Argon2. Access tokens are short-lived JWTs;
  refresh tokens are opaque, stored server-side, and rotated on every use.
- OCR results are always editable and clearly tagged as OCR-extracted or
  user-edited, both in the database and in the UI.

## Scope

MediVault organizes medical records; it does not interpret them. Out of
scope by design: medical diagnosis, interpretation of abnormal results,
predictive health scoring, hospital or doctor-portal integrations, and
multi-patient/family accounts.

## License

MIT. See [LICENSE](LICENSE).
