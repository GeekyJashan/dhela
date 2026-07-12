# Invoice Extraction Service (FastAPI)

Two engines, one service:
- `POST /extract` — full extraction via Google Gemini 2.5 Flash (higher cost, higher accuracy).
- `POST /extract-ocr` — header-only via Tesseract + pdfplumber + regex (~free).
- `POST /suggest-hsn` — Gemini HSN classifier for a product name.
- `GET /health`.

## Local run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# System deps for OCR (once):
#   macOS:  brew install tesseract poppler
#   Ubuntu: sudo apt-get install -y tesseract-ocr poppler-utils

export GOOGLE_API_KEY=your_google_ai_studio_key   # only needed for AI + HSN
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Get a key at https://aistudio.google.com/apikey (free tier available).

## Background queue (bulk uploads)

Bulk uploads create `invoices` rows with `status='queued'`. Two workers pick them up:

1. The client fires a one-shot POST to `/api/public/hooks/process-invoice-queue` right after enqueue, so users see immediate progress while the tab is open.
2. A `pg_cron` job hits the same endpoint every minute — this is what makes the flow tab-close-safe. Set it up once:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'process-invoice-queue',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://project--c95c083c-3887-434b-a85f-e8bcbe9139e6.lovable.app/api/public/hooks/process-invoice-queue',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"limit": 5}'::jsonb
  );
  $$
);
```

Swap the URL to `project--...-dev.lovable.app` for the preview build.


## Endpoints

- `GET /health` — sanity check.
- `POST /extract` — multipart form with `file` (invoice image or PDF) and
  optional `mime_type`. Returns the extraction JSON.

## Deploy

Any container host works (Render / Fly.io / Railway / Cloud Run).

**Render** (simplest):
1. Push this `backend/` folder to a Git repo.
2. New Web Service → Runtime: Python.
3. Build: `pip install -r requirements.txt`
   Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Env vars: `GOOGLE_API_KEY`, optionally `ALLOWED_ORIGINS=https://your-app.lovable.app`.

**Fly.io**:
```bash
fly launch --no-deploy
fly secrets set GOOGLE_API_KEY=...
fly deploy
```

## Wire the frontend

Set `EXTRACTION_API_URL` in the Lovable Cloud project secrets to the
deployed URL, e.g. `https://invoice-extractor.onrender.com`. The
TanStack server function `extractInvoice` will POST invoice files there.
