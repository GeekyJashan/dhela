# Dhela (invoice-genie)

AI purchase-invoice automation for Indian distributors. Fully self-hosted — no
Lovable dependency.

- **Frontend/server**: TanStack Start (React 19, Vite 8) at `src/`. Dev: `npm run dev` (port 8080).
- **Extraction service**: FastAPI at `backend/` (port 8000). Engines: `/extract` (Gemini, paid) and `/extract-ocr` (Tesseract, free).
- **Database/auth/storage**: Supabase (project `nmggsiitwdkovxrvlazk`, free tier). Migrations in `supabase/migrations/`.
- **Env**: `.env` (gitignored) — see `.env.example`. Server functions read `process.env`; vite.config.ts loads `.env` into it.
- **Bulk uploads**: client uploads to the `invoices` storage bucket → `enqueueInvoices` inserts `status='queued'` rows → `/api/public/hooks/process-invoice-queue` drains the queue (nudged by the client; no pg_cron needed on localhost).
