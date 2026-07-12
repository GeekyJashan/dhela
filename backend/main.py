"""
Purchase Invoice Extraction Service (FastAPI + Google Gemini 2.5 Flash).

Run locally:
    pip install -r requirements.txt
    export GOOGLE_API_KEY=your_key
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Deploy to any container host (Render / Fly / Railway / Cloud Run).
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, List, Optional
import os
import base64
import json

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---------- logging ----------
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("invoice-extractor")

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]

app = FastAPI(title="Invoice Extraction Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logger(request: Request, call_next):
    rid = uuid.uuid4().hex[:8]
    t0 = time.time()
    log.info("→ %s %s %s", rid, request.method, request.url.path)
    try:
        response = await call_next(request)
    except Exception as exc:  # pragma: no cover
        log.exception("✗ %s unhandled %s", rid, exc)
        raise
    log.info(
        "← %s %s %s status=%s %.1fms",
        rid, request.method, request.url.path,
        response.status_code, (time.time() - t0) * 1000,
    )
    return response



# -------- Response schema (mirrors the frontend Zod schema) --------
class InvoiceLine(BaseModel):
    line_no: Optional[int] = None
    raw_description: str = ""
    hsn: Optional[str] = None
    quantity: Optional[float] = None
    free_quantity: Optional[float] = None
    unit: Optional[str] = None
    rate: Optional[float] = None
    mrp: Optional[float] = None
    discount_pct: Optional[float] = None
    gst_rate: Optional[float] = None
    taxable_value: Optional[float] = None
    tax_amount: Optional[float] = None
    line_total: Optional[float] = None
    batch: Optional[str] = None
    mfg_date: Optional[str] = None
    expiry_date: Optional[str] = None
    confidence: Optional[float] = None


class InvoiceExtraction(BaseModel):
    supplier_name: Optional[str] = None
    supplier_gstin: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    subtotal: Optional[float] = None
    tax_total: Optional[float] = None
    grand_total: Optional[float] = None
    overall_confidence: Optional[float] = None
    notes: Optional[str] = None
    lines: List[InvoiceLine] = Field(default_factory=list)


SYSTEM_PROMPT = """You are an expert Indian purchase-invoice parser used by pharma, FMCG, hardware and grocery distributors.
Extract every product line and every header field precisely as printed on the invoice.

Rules:
- Return dates in YYYY-MM-DD format when possible; return null if unreadable.
- Quantities and money are numbers (no currency symbols).
- Detect free schemes (e.g. "10+1", "BUY 100 GET 12 FREE") and record billed qty in quantity, free units in free_quantity.
- Set confidence (0-100) per line based on legibility.
- Prefer null over guessing.
- Extract HSN, batch, expiry, mfg date whenever printed.
Respond ONLY with valid JSON matching the requested schema."""

# JSON schema Gemini will conform to via responseSchema.
RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "supplier_name": {"type": "STRING", "nullable": True},
        "supplier_gstin": {"type": "STRING", "nullable": True},
        "invoice_number": {"type": "STRING", "nullable": True},
        "invoice_date": {"type": "STRING", "nullable": True},
        "subtotal": {"type": "NUMBER", "nullable": True},
        "tax_total": {"type": "NUMBER", "nullable": True},
        "grand_total": {"type": "NUMBER", "nullable": True},
        "overall_confidence": {"type": "NUMBER", "nullable": True},
        "notes": {"type": "STRING", "nullable": True},
        "lines": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "line_no": {"type": "INTEGER", "nullable": True},
                    "raw_description": {"type": "STRING"},
                    "hsn": {"type": "STRING", "nullable": True},
                    "quantity": {"type": "NUMBER", "nullable": True},
                    "free_quantity": {"type": "NUMBER", "nullable": True},
                    "unit": {"type": "STRING", "nullable": True},
                    "rate": {"type": "NUMBER", "nullable": True},
                    "mrp": {"type": "NUMBER", "nullable": True},
                    "discount_pct": {"type": "NUMBER", "nullable": True},
                    "gst_rate": {"type": "NUMBER", "nullable": True},
                    "taxable_value": {"type": "NUMBER", "nullable": True},
                    "tax_amount": {"type": "NUMBER", "nullable": True},
                    "line_total": {"type": "NUMBER", "nullable": True},
                    "batch": {"type": "STRING", "nullable": True},
                    "mfg_date": {"type": "STRING", "nullable": True},
                    "expiry_date": {"type": "STRING", "nullable": True},
                    "confidence": {"type": "NUMBER", "nullable": True},
                },
                "required": ["raw_description"],
            },
        },
    },
    "required": ["lines"],
}


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "model": GEMINI_MODEL, "has_key": bool(GOOGLE_API_KEY)}


# ---------- HSN suggestion ----------
class HsnSuggestRequest(BaseModel):
    name: str
    context: Optional[str] = None  # optional extra info (brand, pack size, etc)


class HsnSuggestion(BaseModel):
    hsn: Optional[str] = None
    gst_rate: Optional[float] = None
    description: Optional[str] = None
    confidence: Optional[float] = None
    reasoning: Optional[str] = None


HSN_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "hsn": {"type": "STRING", "nullable": True, "description": "Indian HSN/SAC code, 4-8 digits"},
        "gst_rate": {"type": "NUMBER", "nullable": True, "description": "GST % (0/5/12/18/28)"},
        "description": {"type": "STRING", "nullable": True},
        "confidence": {"type": "NUMBER", "nullable": True, "description": "0-100"},
        "reasoning": {"type": "STRING", "nullable": True},
    },
    "required": ["hsn", "gst_rate"],
}

HSN_SYSTEM_PROMPT = """You are an expert on the Indian GST HSN/SAC classification system.
Given a product name (and optional context), return the single most appropriate HSN code
and the standard Indian GST rate for that item.

Rules:
- HSN must be a real Indian HSN/SAC code (typically 4, 6 or 8 digits).
- gst_rate must be one of 0, 5, 12, 18, 28.
- If the product is clearly a service, use the appropriate SAC code.
- If genuinely ambiguous, pick the most common classification for that product in Indian retail/distribution and lower the confidence.
- Never invent codes. If you truly cannot classify, return null hsn with a short reasoning.
Respond ONLY with valid JSON matching the schema."""


@app.post("/suggest-hsn", response_model=HsnSuggestion)
async def suggest_hsn(req: HsnSuggestRequest) -> HsnSuggestion:
    if not GOOGLE_API_KEY:
        log.error("suggest-hsn: GOOGLE_API_KEY missing")
        raise HTTPException(500, "GOOGLE_API_KEY not configured on the service")

    name = (req.name or "").strip()
    if len(name) < 2:
        raise HTTPException(400, "Product name too short")

    user_text = f"Product name: {name}"
    if req.context:
        user_text += f"\nContext: {req.context}"

    payload = {
        "systemInstruction": {"parts": [{"text": HSN_SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_text}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": HSN_SCHEMA,
            "temperature": 0.1,
        },
    }

    log.info("suggest-hsn: calling Gemini name=%r", name)
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GEMINI_ENDPOINT, params={"key": GOOGLE_API_KEY}, json=payload,
            )
    except httpx.HTTPError as e:
        log.exception("suggest-hsn: HTTP error")
        raise HTTPException(502, f"Gemini transport error: {e}") from e

    log.info("suggest-hsn: status=%s in %.1fms", resp.status_code, (time.time() - t0) * 1000)
    if resp.status_code >= 400:
        log.error("suggest-hsn: Gemini error body=%s", resp.text[:500])
        raise HTTPException(resp.status_code, f"Gemini error: {resp.text[:300]}")

    data = resp.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        log.exception("suggest-hsn: malformed response raw=%s", str(data)[:600])
        raise HTTPException(502, f"Malformed Gemini response: {e}") from e

    result = HsnSuggestion.model_validate(parsed)
    log.info("suggest-hsn: → hsn=%s gst=%s conf=%s", result.hsn, result.gst_rate, result.confidence)
    return result


@app.post("/extract", response_model=InvoiceExtraction)
async def extract(
    file: UploadFile = File(...),
    mime_type: Optional[str] = Form(None),
) -> InvoiceExtraction:
    if not GOOGLE_API_KEY:
        log.error("extract: GOOGLE_API_KEY missing")
        raise HTTPException(500, "GOOGLE_API_KEY not configured on the service")

    raw = await file.read()
    if not raw:
        log.warning("extract: empty file received filename=%s", file.filename)
        raise HTTPException(400, "Empty file")

    mime = mime_type or file.content_type or "application/octet-stream"
    log.info(
        "extract: file received filename=%s bytes=%d mime=%s",
        file.filename, len(raw), mime,
    )
    b64 = base64.b64encode(raw).decode("ascii")

    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": "Extract the full purchase invoice as structured JSON."},
                    {"inlineData": {"mimeType": mime, "data": b64}},
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
            "temperature": 0.1,
        },
    }

    log.info("extract: calling Gemini model=%s", GEMINI_MODEL)
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                GEMINI_ENDPOINT, params={"key": GOOGLE_API_KEY}, json=payload,
            )
    except httpx.HTTPError as e:
        log.exception("extract: HTTP error calling Gemini")
        raise HTTPException(502, f"Gemini transport error: {e}") from e

    dt_ms = (time.time() - t0) * 1000
    log.info("extract: Gemini responded status=%s in %.1fms", resp.status_code, dt_ms)

    if resp.status_code >= 400:
        log.error("extract: Gemini error body=%s", resp.text[:1000])
        raise HTTPException(resp.status_code, f"Gemini error: {resp.text[:500]}")

    data = resp.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        log.exception("extract: malformed Gemini response raw=%s", str(data)[:800])
        raise HTTPException(502, f"Malformed Gemini response: {e}") from e

    try:
        result = InvoiceExtraction.model_validate(parsed)
    except Exception as e:
        log.exception("extract: schema validation failed parsed=%s", str(parsed)[:800])
        raise HTTPException(502, f"Schema validation failed: {e}") from e

    log.info(
        "extract: done lines=%d supplier=%s",
        len(result.lines), result.supplier_name,
    )
    return result


# ---------- OCR extraction (cheap, header only) ----------
import io
import re

try:
    import pytesseract  # type: ignore
    from PIL import Image  # type: ignore
except Exception as _e:  # pragma: no cover
    pytesseract = None
    Image = None

try:
    import pdfplumber  # type: ignore
except Exception:  # pragma: no cover
    pdfplumber = None

try:
    from pdf2image import convert_from_bytes  # type: ignore
except Exception:  # pragma: no cover
    convert_from_bytes = None


_DATE_PATTERNS = [
    (re.compile(r"\b(\d{2})[/-](\d{2})[/-](\d{4})\b"), "%d-%m-%Y"),
    (re.compile(r"\b(\d{4})[/-](\d{2})[/-](\d{2})\b"), "%Y-%m-%d"),
    (re.compile(r"\b(\d{2})[/-](\d{2})[/-](\d{2})\b"), "%d-%m-%y"),
]

_GSTIN_RE = re.compile(r"\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b")
_INV_NO_RE = re.compile(r"(?:invoice|bill|inv)[\s\-#:no.]*([A-Z0-9][A-Z0-9/\-]{2,20})", re.I)
_TOTAL_RE = re.compile(r"(?:grand\s*total|total\s*amount|net\s*amount|amount\s*payable|invoice\s*total)[^\d]{0,10}([\d,]+\.\d{2}|[\d,]+)", re.I)
_TAX_RE = re.compile(r"(?:total\s*tax|tax\s*amount|cgst\s*\+\s*sgst|igst)[^\d]{0,10}([\d,]+\.\d{2}|[\d,]+)", re.I)
_SUBTOTAL_RE = re.compile(r"(?:sub\s*total|taxable\s*value|taxable\s*amount)[^\d]{0,10}([\d,]+\.\d{2}|[\d,]+)", re.I)
_DATE_LINE_RE = re.compile(r"(?:invoice\s*date|bill\s*date|dated)[^\d]{0,10}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", re.I)


def _to_number(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    try:
        return float(s.replace(",", "").strip())
    except ValueError:
        return None


def _normalise_date(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    from datetime import datetime
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d-%m-%y", "%d/%m/%y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _guess_supplier(text: str) -> Optional[str]:
    # First non-empty line that isn't obviously a heading like "TAX INVOICE"
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        low = s.lower()
        if any(k in low for k in ("tax invoice", "invoice", "gstin", "bill of")):
            continue
        if len(s) < 3 or len(s) > 80:
            continue
        return s
    return None


def _ocr_pdf_bytes(raw: bytes) -> str:
    text_parts: list[str] = []
    if pdfplumber is not None:
        try:
            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                for page in pdf.pages[:5]:
                    t = page.extract_text() or ""
                    if t.strip():
                        text_parts.append(t)
        except Exception as e:
            log.warning("ocr: pdfplumber failed: %s", e)
    joined = "\n".join(text_parts).strip()
    if joined:
        return joined
    # Fallback: rasterise + tesseract
    if convert_from_bytes is None or pytesseract is None:
        return ""
    try:
        images = convert_from_bytes(raw, dpi=200, first_page=1, last_page=3)
        return "\n".join(pytesseract.image_to_string(img) for img in images)
    except Exception as e:
        log.warning("ocr: pdf raster failed: %s", e)
        return ""


def _ocr_image_bytes(raw: bytes) -> str:
    if pytesseract is None or Image is None:
        return ""
    try:
        img = Image.open(io.BytesIO(raw))
        return pytesseract.image_to_string(img)
    except Exception as e:
        log.warning("ocr: image failed: %s", e)
        return ""


def _parse_header_from_text(text: str) -> InvoiceExtraction:
    supplier_gstin = None
    m = _GSTIN_RE.search(text)
    if m:
        supplier_gstin = m.group(1)

    inv_no = None
    m = _INV_NO_RE.search(text)
    if m:
        inv_no = m.group(1).strip(" .:#")

    inv_date = None
    m = _DATE_LINE_RE.search(text)
    if m:
        inv_date = _normalise_date(m.group(1))
    if not inv_date:
        m = re.search(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b", text)
        if m:
            inv_date = _normalise_date(m.group(1))

    grand_total = None
    m = _TOTAL_RE.search(text)
    if m:
        grand_total = _to_number(m.group(1))

    tax_total = None
    m = _TAX_RE.search(text)
    if m:
        tax_total = _to_number(m.group(1))

    subtotal = None
    m = _SUBTOTAL_RE.search(text)
    if m:
        subtotal = _to_number(m.group(1))
    if subtotal is None and grand_total is not None and tax_total is not None:
        subtotal = round(grand_total - tax_total, 2)

    supplier = _guess_supplier(text)

    # Confidence heuristic: how many key fields we found
    found = sum(x is not None for x in [supplier, supplier_gstin, inv_no, inv_date, grand_total])
    conf = round(found / 5.0 * 100.0, 1)

    return InvoiceExtraction(
        supplier_name=supplier,
        supplier_gstin=supplier_gstin,
        invoice_number=inv_no,
        invoice_date=inv_date,
        subtotal=subtotal,
        tax_total=tax_total,
        grand_total=grand_total,
        overall_confidence=conf,
        notes="Extracted via OCR (header only). Line items must be entered manually.",
        lines=[],
    )


@app.post("/extract-ocr", response_model=InvoiceExtraction)
async def extract_ocr(
    file: UploadFile = File(...),
    mime_type: Optional[str] = Form(None),
) -> InvoiceExtraction:
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    mime = (mime_type or file.content_type or "").lower()
    log.info("ocr: file=%s bytes=%d mime=%s", file.filename, len(raw), mime)

    t0 = time.time()
    if "pdf" in mime or (file.filename or "").lower().endswith(".pdf"):
        text = _ocr_pdf_bytes(raw)
    else:
        text = _ocr_image_bytes(raw)
    log.info("ocr: text extracted chars=%d in %.1fms", len(text), (time.time() - t0) * 1000)

    if not text.strip():
        raise HTTPException(422, "OCR could not read any text from the file. Try the AI engine.")

    result = _parse_header_from_text(text)
    log.info(
        "ocr: parsed supplier=%s inv=%s date=%s total=%s conf=%s",
        result.supplier_name, result.invoice_number, result.invoice_date,
        result.grand_total, result.overall_confidence,
    )
    return result

