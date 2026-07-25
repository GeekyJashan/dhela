# Deploying Dhela (free tier)

Three pieces: **Vercel** (web app), **Render** (FastAPI extraction service,
Docker), **Supabase** (already cloud-hosted — nothing to deploy).

## 1. Push to GitHub

```sh
git add -A
git commit -m "Deploy prep"
git push origin main
```

Secrets are safe: `.env` and `backend/.env` are gitignored.

## 2. Backend on Render (deploy this FIRST — Vercel needs its URL)

1. Sign in at https://render.com with GitHub.
2. **New → Web Service** → pick the `invoice-genie` repo.
3. Settings:
   - **Root Directory**: `backend`
   - **Language/Runtime**: Docker (auto-detected from `backend/Dockerfile`)
   - **Instance Type**: Free
4. Environment variables:
   - `GOOGLE_API_KEY` = your Gemini key
   - (optional) `ALLOWED_ORIGINS` = your Vercel URL once you have it
5. Deploy. Note the URL, e.g. `https://invoice-genie-api.onrender.com`.
6. Verify: open `https://<render-url>/docs` — FastAPI docs should load.

Free-tier caveat: the service sleeps after 15 min idle; the first extraction
after a quiet period takes ~60 s while it wakes.

## 3. Web app on Vercel

1. Sign in at https://vercel.com with GitHub.
2. **Add New → Project** → import `invoice-genie`. Framework: Vite (default
   build `npm run build`, output auto-detected via the Vercel preset).
3. Environment variables (Production):

   | Name | Value |
   |---|---|
   | `NITRO_PRESET` | `vercel` |
   | `SUPABASE_URL` | `https://nmggsiitwdkovxrvlazk.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | anon key (from local `.env`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | service-role key (from local `.env`) |
   | `VITE_SUPABASE_URL` | same as `SUPABASE_URL` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | same as anon key |
   | `EXTRACTION_API_URL` | the Render URL from step 2 |

4. Deploy. You get `https://<project>.vercel.app`.

## 4. Supabase auth URLs (one-time)

Dashboard → Authentication → URL Configuration:
- **Site URL**: `https://<project>.vercel.app`
- **Redirect URLs**: add `https://<project>.vercel.app/**`

Without this, sign-up confirmation emails link back to localhost.

## 5. Smoke test

1. Open the Vercel URL, sign in.
2. Upload a purchase invoice (first one may wait ~60 s for Render to wake).
3. Issue a sales invoice, record a payment, open a statement.

## Redeploying

Push to `main` — both Vercel and Render auto-deploy on every push.
