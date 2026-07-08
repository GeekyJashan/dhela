# Invoice Extraction Service (FastAPI + Gemini 2.5 Flash)

A standalone Python service that receives an invoice file and returns
structured JSON extracted by Google Gemini 2.5 Flash. The frontend
(TanStack Start app) calls this service via the `EXTRACTION_API_URL`
env var.

## Local run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GOOGLE_API_KEY=your_google_ai_studio_key
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Get a key at https://aistudio.google.com/apikey (free tier available).

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
