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
import re
import time
import uuid
from typing import Any, List, Optional
import os
import base64
import json

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

try:
    from dotenv import load_dotenv
    load_dotenv()  # backend/.env — holds GOOGLE_API_KEY locally
except ImportError:
    pass

# ---------- logging ----------
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("invoice-extractor")

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
# Benchmarked on a deliberately degraded 13-row bill (rotated, blurred, JPEG
# q42) against known ground truth, two runs each:
#   gemini-2.5-flash  36.7s  amounts correct 5 then 9 of 13   (unstable)
#   gemini-3.5-flash  21.3s  amounts correct 11 and 11        (stable)
#   gemini-3.6-flash  19.0s  amounts correct 11 and 11        (stable)
# Half the latency and it stopped guessing. Override with GEMINI_MODEL.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

# Provider selection: Anthropic (Claude) by default, Gemini kept as fallback.
AI_PROVIDER = os.environ.get("AI_PROVIDER", "anthropic").lower()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")


def _use_anthropic() -> bool:
    """
    Gemini is the default for extraction now, on measured latency: reading a
    bill is the one thing an operator waits on with the phone in their hand.
    Claude stays one env var away (AI_PROVIDER=anthropic) so this is reversible
    without a deploy of the frontend.
    """
    if AI_PROVIDER == "anthropic":
        return bool(ANTHROPIC_API_KEY)
    return False


def _gemini_schema_to_json_schema(s: dict) -> dict:
    """Gemini responseSchema (UPPERCASE types) -> JSON Schema for Claude tool use."""
    out: dict = {}
    t = s.get("type")
    if t:
        out["type"] = t.lower()
    if "description" in s:
        out["description"] = s["description"]
    if "enum" in s:
        out["enum"] = s["enum"]
    if "properties" in s:
        out["properties"] = {
            k: _gemini_schema_to_json_schema(v) for k, v in s["properties"].items()
        }
    if "items" in s:
        out["items"] = _gemini_schema_to_json_schema(s["items"])
    if "required" in s:
        out["required"] = s["required"]
    return out


async def _anthropic_json(system: str, schema: dict, blocks: list) -> dict:
    """Ask Claude to fill `schema` via a forced tool call; return the parsed input."""
    import anthropic  # local import so the service starts without the package on Gemini-only setups

    tool_schema = _gemini_schema_to_json_schema(schema)
    if tool_schema.get("type") != "object":
        tool_schema = {"type": "object", "properties": {"result": tool_schema}, "required": ["result"]}
        wrap = True
    else:
        wrap = False

    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    msg = await client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=8000,
        system=system,
        tools=[{
            "name": "record",
            "description": "Record the extracted structured data.",
            "input_schema": tool_schema,
        }],
        tool_choice={"type": "tool", "name": "record"},
        messages=[{"role": "user", "content": blocks}],
    )
    for block in msg.content:
        if getattr(block, "type", None) == "tool_use":
            data = block.input
            return data["result"] if wrap else data
    raise HTTPException(502, "Claude returned no structured output")


# Web-search tool version matches the current Claude models (Sonnet 5 / Opus 4.x).
ANTHROPIC_WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}


def _find_record_input(content: list) -> Optional[dict]:
    """Pull the `record` tool_use input out of a Claude response, if present."""
    for block in content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "record":
            return block.input
    return None


async def _anthropic_json_grounded(system: str, schema: dict, user_text: str) -> dict:
    """Like _anthropic_json, but lets Claude use live web search to verify facts
    (e.g. the current post-GST-2.0 rate) before recording structured output."""
    import anthropic  # local import so the service starts without the package on Gemini-only setups

    tool_schema = _gemini_schema_to_json_schema(schema)  # HSN_SCHEMA is already an object
    record_tool = {
        "name": "record",
        "description": "Record the final HSN classification and its current GST rate.",
        "input_schema": tool_schema,
    }
    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    grounded_hint = (
        "\n\nIf you are not certain of the CURRENT (post-22-Sep-2025) GST rate for this item, "
        "use the web_search tool to confirm it before answering — do not rely on possibly outdated "
        "memory. Everyday items you are confident about need no search. When ready, call the `record` tool."
    )
    messages: list = [{"role": "user", "content": [{"type": "text", "text": user_text}]}]

    # Server-side web search runs inside this single call; the model then emits
    # a `record` tool_use with its final answer.
    msg = await client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=2000,
        system=system + grounded_hint,
        tools=[ANTHROPIC_WEB_SEARCH_TOOL, record_tool],
        messages=messages,
    )
    rec = _find_record_input(msg.content)
    if rec is not None:
        return rec

    # Fallback: the model answered in prose (or only searched) without recording —
    # force the record tool using everything gathered so far.
    messages.append({"role": "assistant", "content": msg.content})
    messages.append({"role": "user", "content": [{"type": "text", "text": "Record your final answer now via the record tool."}]})
    msg2 = await client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1000,
        system=system,
        tools=[record_tool],
        tool_choice={"type": "tool", "name": "record"},
        messages=messages,
    )
    rec = _find_record_input(msg2.content)
    if rec is None:
        raise HTTPException(502, "Claude returned no structured HSN output")
    return rec

ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]

app = FastAPI(title="Invoice Extraction Service", version="1.0.0")


# Which model is actually reading bills is the single most consequential thing
# about this service, and it is decided by environment variables that outlive
# any deploy. A default changed in code is invisible when the variable is
# already set — which is how ANTHROPIC_MODEL=claude-haiku-4-5 kept running long
# after the code stopped recommending it. Say it out loud at startup.
log.info(
    "extraction engine: provider=%s model=%s (anthropic_key=%s gemini_key=%s)",
    "anthropic" if _use_anthropic() else "gemini",
    ANTHROPIC_MODEL if _use_anthropic() else GEMINI_MODEL,
    bool(ANTHROPIC_API_KEY), bool(GOOGLE_API_KEY),
)
if _use_anthropic() and "haiku" in ANTHROPIC_MODEL.lower():
    # Measured on a real 13-row bill: Haiku 4.5 returned 12 lines and read the
    # GST-rate column as quantity on every one of them. Sonnet and Gemini 3.6
    # Flash both read the same image exactly right.
    log.warning(
        "ANTHROPIC_MODEL=%s reads dense invoice tables badly — it misassigns columns. "
        "Use claude-sonnet-5, or unset AI_PROVIDER to use Gemini.",
        ANTHROPIC_MODEL,
    )
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
# Words a model reaches for when a figure is not on the page. The prompt asks
# for null and Claude wrote the string "null" into a number field, which
# pydantic rejected and turned into a 502 — the whole bill failed to upload
# because one total was legitimately absent. Numbers also come back wearing
# thousands separators, rupee signs and trailing percent marks.
_NULLISH = {"", "-", "--", "—", "null", "none", "nil", "n/a", "na", "nan",
            "not available", "not printed", "not visible", "unknown"}


def _coerce_number(value: Any) -> Any:
    """Best-effort string -> number, and absent -> None, for model output."""
    if value is None or isinstance(value, (int, float)):
        return value
    if not isinstance(value, str):
        return value

    text = value.strip()
    if text.lower() in _NULLISH:
        return None
    # Case-insensitive: bills and models write "Rs", "rs.", "INR" and "₹".
    text = re.sub(r"(?i)\b(?:rs\.?|inr)\b|[\u20b9,%]", "", text).strip()
    # "1234.56 NOS" — a quantity that kept its unit.
    head = text.split()[0] if text.split() else ""
    try:
        return float(head)
    except ValueError:
        # Unparseable is closer to "not read" than to zero. Zero would post
        # into stock and cost as a real figure.
        return None


_LINE_NUMBERS = ("quantity", "free_quantity", "rate", "mrp", "discount_pct",
                 "gst_rate", "taxable_value", "tax_amount", "line_total", "confidence")
_HEADER_NUMBERS = ("subtotal", "other_charges", "tax_total", "grand_total",
                   "overall_confidence", "line_count_on_bill")


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
    # Set by the server when a line fails its own arithmetic, so the review
    # screen can put the operator in front of it instead of hoping they spot it.
    needs_review: Optional[bool] = None

    @field_validator(*_LINE_NUMBERS, mode="before")
    @classmethod
    def _numbers(cls, v: Any) -> Any:
        return _coerce_number(v)


class InvoiceExtraction(BaseModel):
    # Asked for so the server can tell "read 9 rows" from "there were 9 rows".
    line_count_on_bill: Optional[int] = None
    column_order: Optional[str] = None
    supplier_name: Optional[str] = None
    supplier_gstin: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    subtotal: Optional[float] = None
    other_charges: Optional[float] = None
    tax_total: Optional[float] = None
    grand_total: Optional[float] = None
    overall_confidence: Optional[float] = None
    notes: Optional[str] = None
    lines: List[InvoiceLine] = Field(default_factory=list)

    @field_validator("lines", mode="before")
    @classmethod
    def _lines(cls, v: Any) -> Any:
        # Claude Haiku has been seen returning something other than a list here.
        # A malformed shape must not 502 the upload — an empty extraction the
        # operator can key over is recoverable; a failed upload is not.
        if v is None:
            return []
        if isinstance(v, dict):
            return [v]
        if not isinstance(v, list):
            log.error("extract: 'lines' arrived as %s, discarding", type(v).__name__)
            return []
        return [x for x in v if isinstance(x, dict)]

    @field_validator(*_HEADER_NUMBERS, mode="before")
    @classmethod
    def _numbers(cls, v: Any) -> Any:
        return _coerce_number(v)

    @field_validator("invoice_date", "invoice_number", "supplier_gstin", mode="before")
    @classmethod
    def _strings(cls, v: Any) -> Any:
        # Same problem in the other direction: "null" as a date is a string
        # pydantic accepts and the app then shows to an operator.
        if isinstance(v, str) and v.strip().lower() in _NULLISH:
            return None
        return v


SYSTEM_PROMPT = """You are an expert Indian purchase-invoice parser used by pharma, FMCG, hardware and grocery distributors.
Extract every product line and every header field exactly as printed. Never calculate a figure that is not on the page.

The input is usually a handheld phone photo of a paper bill — often a faint carbon or dot-matrix print,
skewed, shadowed or creased. Read only what you can actually see. Where a figure is obscured, return null.
A null is useful to the operator reviewing this; a confident wrong number is worse than nothing,
because it gets approved into their stock and cost.

THE TWO MISTAKES THAT MATTER MOST

1. Numbers inside the description are not quantities.
   Product names on these bills are full of numbers: "PVC R ELBOW 160 MM X 110 MM 4 KG", "SWR Y-TEE 110 MM",
   "ELBOW 90 MM X 45". Sizes, bores, degrees and pack weights all live in the description text.
   quantity, rate, discount and amount come ONLY from their own numeric columns, never from the
   description. If a row's description ends in "6 KG" and the Quantity column says 50, the quantity is 50.

2. Do not skip rows.
   Count the printed product rows first and put that number in `line_count_on_bill`, then emit exactly
   that many objects in `lines`. Faint rows, tightly-spaced rows and rows near the bottom of the table are
   the ones that get lost. A description that wraps onto a second visual line is still ONE row. If your
   `lines` array is shorter than `line_count_on_bill`, you have dropped rows — go back and find them.

READING THE COLUMNS
- Read the column header row first, left to right, and record it in `column_order` exactly as printed.
  Identify every number by which column it sits in, not by how large or plausible it looks.
- A quantity cell often carries its unit in the same cell ("50.00 NOS", "12 PCS", "5 BOX"). Put the number
  in quantity and the unit in unit. "NOS" is a unit, not a quantity.
- Indian bills frequently carry a large trade discount (50-70%) and print the amount AFTER it. So the test
  for every row is: quantity x rate x (1 - discount_pct/100) should equal the amount printed on that row.
  Use that to confirm you took each number from the right column. If it does not hold, you have picked up
  a neighbouring column — look along the row for the numbers that do make it hold.
- A column whose values only ever INCREASE down the page is a running total, never a line amount.
- MRP is a printed retail price, normally well above rate. Rate is what this supplier charged.

FIELD RULES
- Dates in YYYY-MM-DD when possible; null if unreadable.
- Quantities and money are plain numbers — no currency symbols, no thousands separators, no unit words.
- Free schemes ("10+1", "BUY 100 GET 12 FREE"): billed units in quantity, free units in free_quantity.
  A blank Free column means 0.
- Extract HSN, batch, expiry and mfg date whenever printed.
- Rows printed below the product table are not products. Cartage, freight, insurance, packing, loading,
  round-off, and the tax lines themselves (CGST/SGST/IGST/CESS Output) all belong out of `lines`. A row
  with no HSN, no quantity and no rate is a charge, not something that goes into stock.
- Prefer null over guessing, everywhere. Never invent a row to make a total reconcile.

HEADER TOTALS, AND PAGES YOU CANNOT SEE
- The per-line amounts should sum to subtotal, and subtotal + tax_total should equal grand_total.
  If they do not, re-read before answering; if they still do not, return the figures as printed and say
  in `notes` exactly which ones disagree.
- Report the parts, not the sum. Put the line-item total in `subtotal`, cartage/freight/packing in
  `other_charges`, and the tax in `tax_total`. If a grand total is printed on the page, copy it into
  `grand_total`; if it is not printed, leave `grand_total` null. Do not add the numbers up yourself —
  asked to, models get this arithmetic wrong, and the server totals it exactly.
- Many bills run to more than one page. If the page says "continued to page 2", say so in `notes` so the
  operator knows to check whether more line items follow.
- `notes` is read by the operator reviewing this bill, so write it for them: what is missing, what you
  could not see, and what to check. One or two plain sentences.

CONFIDENCE MEANS CORRECTNESS, NOT LEGIBILITY
- confidence (per line): 90+ only when every field is clearly readable AND that line's own
  quantity x rate x (1 - discount) reconciles with its amount. Below 50 whenever you are inferring
  a column or a digit.
- overall_confidence: always return a number, never null — the operator is shown this and a blank reads
  as "no idea". Below 50 if the totals do not reconcile, or if len(lines) does not equal
  line_count_on_bill, however sharp the image is.
- If the image is too poor to parse reliably, return only the lines you are sure of, set
  overall_confidence below 25, and explain what went wrong in `notes`.

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
        # Self-checks. Counting the rows and then emitting that many is what
        # stopped rows going missing; asking for the header order is what stops
        # numbers being taken from the wrong column.
        "other_charges": {"type": "NUMBER", "nullable": True,
                          "description": "Cartage, freight, packing etc. charged on the bill, excluding tax"},
        "line_count_on_bill": {"type": "INTEGER", "nullable": True},
        "column_order": {"type": "STRING", "nullable": True},
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
    provider = "anthropic" if _use_anthropic() else "gemini"
    return {
        "ok": True,
        "provider": provider,
        "model": ANTHROPIC_MODEL if provider == "anthropic" else GEMINI_MODEL,
        "has_anthropic_key": bool(ANTHROPIC_API_KEY),
        "has_gemini_key": bool(GOOGLE_API_KEY),
    }


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
        "gst_rate": {"type": "NUMBER", "nullable": True, "description": "Current Indian GST % under GST 2.0 (effective 22 Sep 2025): one of 0, 0.25, 3, 5, 18, 40. Never 12 or 28 (those slabs were removed)."},
        "description": {"type": "STRING", "nullable": True},
        "confidence": {"type": "NUMBER", "nullable": True, "description": "0-100"},
        "reasoning": {"type": "STRING", "nullable": True},
    },
    "required": ["hsn", "gst_rate"],
}

HSN_SYSTEM_PROMPT = """You are an expert on the Indian GST HSN/SAC classification system, fully up to date with the GST 2.0 rate rationalisation that took effect on 22 September 2025.

Given a product name (and optional context), return the single most appropriate HSN/SAC code and the CURRENT Indian GST rate for that item.

Current GST slabs (from 22 September 2025):
- Standard slabs are 0% (exempt / nil-rated essentials), 5%, 18%, and 40%.
- 40% is the demerit slab for luxury / sin goods — large cars and SUVs, tobacco and pan masala, aerated and sugary drinks, etc. There is no separate compensation cess anymore; it is folded into the 40% rate.
- Special rates: 3% (gold, silver, other precious metals and jewellery) and 0.25% (rough diamonds).
- The old 12% and 28% slabs have been REMOVED. Most former 12% items are now 5%, most former 28% items are now 18%, and former 28%-plus-cess luxury/sin items are now 40%.

Rules:
- HSN must be a real Indian HSN/SAC code (typically 4, 6 or 8 digits). For a passenger car or SUV use heading 8703 (transport of persons), NOT 8704 (goods vehicles).
- gst_rate must reflect the CURRENT rate: one of 0, 0.25, 3, 5, 18, 40. Do NOT return 12 or 28.
- If the product is clearly a service, use the appropriate SAC code.
- If genuinely ambiguous, pick the most common classification for that product in Indian retail/distribution and lower the confidence.
- Never invent codes. If you truly cannot classify, return null hsn with a short reasoning."""


@app.post("/suggest-hsn", response_model=HsnSuggestion)
async def suggest_hsn(req: HsnSuggestRequest) -> HsnSuggestion:
    name = (req.name or "").strip()
    if len(name) < 2:
        raise HTTPException(400, "Product name too short")

    user_text = f"Product name: {name}"
    if req.context:
        user_text += f"\nContext: {req.context}"

    if _use_anthropic():
        log.info("suggest-hsn: calling Claude (web-grounded) name=%r", name)
        try:
            parsed = await _anthropic_json_grounded(HSN_SYSTEM_PROMPT, HSN_SCHEMA, user_text)
        except Exception:
            # Web search may be unavailable (e.g. older model / tool version) —
            # degrade to a plain structured call, still on the GST 2.0 slabs.
            log.exception("suggest-hsn: grounded call failed, falling back to plain")
            parsed = await _anthropic_json(HSN_SYSTEM_PROMPT, HSN_SCHEMA, [{"type": "text", "text": user_text}])
        result = HsnSuggestion.model_validate(parsed)
        log.info("suggest-hsn(claude): → hsn=%s gst=%s", result.hsn, result.gst_rate)
        return result

    if not GOOGLE_API_KEY:
        log.error("suggest-hsn: GOOGLE_API_KEY missing")
        raise HTTPException(500, "No AI provider configured (set ANTHROPIC_API_KEY or GOOGLE_API_KEY)")

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


def _reconcile_lines(result: "InvoiceExtraction") -> "InvoiceExtraction":
    """
    Flag lines whose own arithmetic does not hold.

    The failure that actually hurts is not a missing figure — the operator sees
    a blank and fills it in. It is a number lifted from the neighbouring
    column, which looks perfectly reasonable on screen and gets approved into
    stock and cost. quantity x rate less discount is the cheapest test that
    catches exactly that, and it costs nothing to run on every line.

    Nothing is rewritten. A wrong figure silently corrected is worse than a
    wrong figure clearly marked, because only one of them gets looked at.
    """
    # The model counted the rows before extracting them. If it then emitted
    # fewer, rows went missing — which is invisible on the review screen,
    # because nine plausible lines look exactly like a nine-line bill.
    claimed = result.line_count_on_bill
    if claimed and claimed > len(result.lines or []):
        note = f"bill appears to have {claimed} rows, {len(result.lines or [])} were read"
        result.notes = f"{result.notes}; {note}" if result.notes else note
        if result.overall_confidence is None or result.overall_confidence > 40:
            result.overall_confidence = 40

    for line in result.lines or []:
        # Models disagree about where the row's amount belongs. Gemini fills
        # taxable_value; Claude fills line_total and leaves taxable_value null,
        # which lands as null in the database and silently strips the figure
        # that stock cost and the GST papers are built from.
        #
        # Only copied across when the row's own arithmetic says the two are the
        # same number — on a bill whose amount column is tax-inclusive they are
        # not, and copying would overstate the taxable value.
        if line.taxable_value is None and line.line_total is not None \
                and line.quantity is not None and line.rate is not None:
            expected = float(line.quantity) * float(line.rate)
            if line.discount_pct:
                expected *= 1 - float(line.discount_pct) / 100.0
            if abs(expected - float(line.line_total)) <= max(1.0, abs(expected) * 0.01):
                line.taxable_value = line.line_total

        qty, rate, taxable = line.quantity, line.rate, line.taxable_value
        if qty is None or rate is None or taxable is None:
            continue
        expected = float(qty) * float(rate)
        if line.discount_pct:
            expected *= 1 - float(line.discount_pct) / 100.0
        # One rupee or one percent, whichever is larger — bills round per line
        # and we are looking for wrong columns, not rounding.
        tolerance = max(1.0, abs(expected) * 0.01)
        if abs(expected - float(taxable)) > tolerance:
            line.needs_review = True
            if line.confidence is None or line.confidence > 40:
                line.confidence = 40
            note = f"line {line.line_no or '?'}: {qty} x {rate} = {expected:.2f}, printed {taxable}"
            result.notes = f"{result.notes}; {note}" if result.notes else note

    # Derive the grand total when the supplier did not print one, from parts
    # that were read rather than parts that were guessed.
    #
    # This is deliberately done here and not by the model. Asked to total the
    # same bill, one model returned 77,547.20 while its own note said
    # 77,552.20, and another returned 75,914.20; the correct figure is
    # 77,552.20. Addition is the one part of this job a computer should not be
    # delegating.
    if result.grand_total is None and result.subtotal is not None:
        charges = result.other_charges or 0.0
        tax = result.tax_total or 0.0
        result.grand_total = round(float(result.subtotal) + float(charges) + tax, 2)
        note = (f"Grand total not printed on this page — computed as "
                f"{result.subtotal:,.2f}"
                + (f" + {charges:,.2f} charges" if charges else "")
                + (f" + {tax:,.2f} tax" if tax else "")
                + f" = {result.grand_total:,.2f}.")
        result.notes = f"{result.notes}; {note}" if result.notes else note

    # A tax figure that matches the taxable base at the rate the lines carry is
    # strong evidence the totals block was read correctly. Worth saying, since
    # the operator is deciding whether to trust a number nobody printed.
    if result.tax_total and result.subtotal is not None:
        base = float(result.subtotal) + float(result.other_charges or 0.0)
        rates = [float(l.gst_rate) for l in (result.lines or []) if l.gst_rate]
        if base > 0 and rates:
            implied = max(set(rates), key=rates.count)
            if abs(base * implied / 100.0 - float(result.tax_total)) <= max(1.0, base * 0.001):
                note = f"Tax reconciles: {implied:g}% of {base:,.2f} = {result.tax_total:,.2f}."
                result.notes = f"{result.notes}; {note}" if result.notes else note

    # One bad row is a misread digit. Most rows bad means the columns were
    # misidentified for the whole table, and every figure on the page is
    # suspect — including the ones that happen to look right.
    #
    # This is the case that matters: a bill came back with twelve rows whose
    # quantity x rate could not possibly produce the printed amount, and the
    # screen still called it 72% accurate, because the model's own confidence
    # was never contradicted by anything the server checked. A read this wrong
    # must not be presentable as a read that mostly worked.
    checkable = [l for l in (result.lines or [])
                 if l.quantity is not None and l.rate is not None and l.taxable_value is not None]
    failed = [l for l in checkable if l.needs_review]
    if checkable and len(failed) * 2 >= len(checkable):
        result.overall_confidence = min(result.overall_confidence or 100, 10)
        headline = (f"{len(failed)} of {len(checkable)} lines do not add up — quantity x rate does not "
                    f"produce the printed amount on any of them, so the columns were most likely read in "
                    f"the wrong order. Do not approve this; re-extract or key it in.")
        result.notes = f"{headline} {result.notes}" if result.notes else headline

    return result


@app.post("/extract", response_model=InvoiceExtraction)
async def extract(
    file: UploadFile = File(...),
    mime_type: Optional[str] = Form(None),
) -> InvoiceExtraction:
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

    if _use_anthropic():
        log.info("extract: calling Claude model=%s mime=%s", ANTHROPIC_MODEL, mime)
        if mime == "application/pdf":
            doc_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
        elif mime.startswith("image/"):
            doc_block = {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
        else:
            raise HTTPException(400, f"Claude extraction supports PDF and images, not {mime}")
        parsed = await _anthropic_json(
            SYSTEM_PROMPT, RESPONSE_SCHEMA,
            [doc_block, {"type": "text", "text": "Extract the full purchase invoice as structured JSON."}],
        )
        try:
            result = InvoiceExtraction.model_validate(parsed)
        except Exception as e:  # noqa: BLE001
            log.exception("extract(claude): validation failed raw=%s", str(parsed)[:800])
            raise HTTPException(502, f"Malformed Claude response: {e}") from e
        result = _reconcile_lines(result)
        log.info("extract(claude): supplier=%s lines=%d flagged=%d",
                 result.supplier_name, len(result.lines),
                 sum(1 for l in result.lines if l.needs_review))
        return result

    if not GOOGLE_API_KEY:
        log.error("extract: GOOGLE_API_KEY missing")
        raise HTTPException(500, "No AI provider configured (set ANTHROPIC_API_KEY or GOOGLE_API_KEY)")

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

    result = _reconcile_lines(result)
    log.info(
        "extract: done lines=%d supplier=%s flagged=%d",
        len(result.lines), result.supplier_name,
        sum(1 for l in result.lines if l.needs_review),
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
# Labelled form first ("Invoice No.: X"); loose form only as a fallback.
# The gap class must not contain letters — "INV" + "O(ICE)" once turned
# "TAX INVOICE/BILL OF SUPPLY" into invoice number "ICE/BILL".
_INV_NO_LABELLED_RE = re.compile(r"(?:invoice|bill|inv)\s*(?:no|num(?:ber)?|#)\s*[.:\-#]*\s*([A-Z0-9][A-Z0-9/\-]{2,24})", re.I)
_INV_NO_LOOSE_RE = re.compile(r"(?:invoice|bill|inv)[\s\-#:.]*([A-Z0-9][A-Z0-9/\-]{2,24})", re.I)
_TOTAL_RE = re.compile(r"(?:grand\s*total|total\s*amount|net\s*amount|amount\s*payable|amount\s*due|invoice\s*total|invoice\s*value|bill\s*amount|total\s*payable)[^\d]{0,10}([\d,]+\.\d{2}|[\d,]+)", re.I)
_TAX_RE = re.compile(r"(?:total\s*tax|tax\s*amount|cgst\s*\+\s*sgst|igst)[^\d]{0,10}([\d,]+\.\d{2}|[\d,]+)", re.I)
_SUBTOTAL_RE = re.compile(r"(?:sub\s*total|taxable\s*value|taxable\s*amount|item\s*total)[^\d]{0,10}([\d,]+\.\d{2}|[\d,]+)", re.I)
_DATE_LINE_RE = re.compile(r"(?:invoice\s*date|bill\s*date|dated|date)[^\d]{0,10}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", re.I)
_DATE_TEXT_RE = re.compile(r"(?:invoice\s*date|date\s*of\s*issue|bill\s*date|dated|date)\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})", re.I)
# Bare "Total" is only trusted when no labelled total matched, and never a
# quantity line ("Total Qty: 24").
_TOTAL_BARE_RE = re.compile(r"\btotal\b(?!\s*(?:qty|quantity|items?|nos))[^\d]{0,10}([\d,]+\.\d{2}|[\d,]+)", re.I)
_SUPPLIER_LABEL_RE = re.compile(r"^(?:seller\s*name|sold\s*by|supplier|billed\s*by|from)\s*[:\-]\s*", re.I)


def _find_invoice_number(text: str) -> Optional[str]:
    """Prefer an explicitly labelled invoice number; always require a digit."""
    for pattern in (_INV_NO_LABELLED_RE, _INV_NO_LOOSE_RE):
        for m in pattern.finditer(text):
            candidate = m.group(1).strip(" .:#")
            if re.search(r"\d", candidate):
                return candidate
    return None


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
    cleaned = raw.strip().replace(".", "").replace(",", "")
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d-%m-%y", "%d/%m/%y", "%Y-%m-%d", "%Y/%m/%d",
                "%B %d %Y", "%b %d %Y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _guess_supplier(text: str) -> Optional[str]:
    # First non-empty line that isn't obviously a heading like "TAX INVOICE",
    # a label line, or an address fragment.
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        low = s.lower()
        if any(k in low for k in ("tax invoice", "invoice", "gstin", "bill of", "bill to", "ship to", "fssai", "amount due")):
            continue
        if low.startswith(("date", "due", "vat", "pay", "order", "phone", "email", "www", "plot no")):
            continue
        if s[0].isdigit():  # addresses, GST/registration codes
            continue
        if len(s) < 3 or len(s) > 80:
            continue
        # Drop a "Seller Name:" / "Sold by:" style label prefix.
        return _SUPPLIER_LABEL_RE.sub("", s).strip() or None
    return None


# ---------- line-item extraction (heuristic, free) ----------
# Maps table-header cells to InvoiceLine fields. Order matters: specific
# keywords ("taxable") must match before generic ones ("value"/"total").
_COLUMN_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("hsn", ("hsn", "sac")),
    ("batch", ("batch", "b.no", "btno")),
    ("expiry_date", ("exp",)),
    ("mfg_date", ("mfg",)),
    ("free_quantity", ("free", "scheme", "fr qty")),
    ("quantity", ("qty", "quantity", "nos", "pcs")),
    # mrp before unit: "Unit MRP/RSP" style headers are MRP columns.
    ("mrp", ("mrp",)),
    ("unit", ("unit", "uom", "pack", "pkg")),
    ("discount_pct", ("disc", "dis%", "d%")),
    ("tax_amount", ("tax amt", "tax amount", "taxamt", "gst amt")),
    ("gst_rate", ("gst", "igst", "cgst", "sgst", "tax %", "tax%")),
    ("taxable_value", ("taxable",)),
    ("rate", ("rate", "price", "ptr", "p.rate")),
    # Within a field, earlier keywords are more specific — a later column
    # matching a more specific keyword steals the field (so "Total Amt."
    # beats a "Cess Amt." that only matched "amt").
    ("line_total", ("total", "amount", "net", "amt", "value")),
    ("raw_description", ("description", "particular", "item", "product", "goods", "name")),
]

_NUMERIC_FIELDS = {
    "quantity", "free_quantity", "rate", "mrp", "discount_pct", "gst_rate",
    "taxable_value", "tax_amount", "line_total",
}
_TOTALS_ROW_RE = re.compile(r"^\s*(sub\s*-?\s*total|grand\s*total|total|round\s*off|cgst|sgst|igst|freight|less|add)\b", re.I)


def _classify_header_cell(cell: str) -> Optional[tuple[str, int]]:
    """Field plus keyword rank (lower = more specific match)."""
    low = " ".join(cell.lower().split())
    if not low:
        return None
    if "cess" in low:  # cess columns have no field and shadow "amt"/"total"
        return None
    for field, keywords in _COLUMN_KEYWORDS:
        for rank, k in enumerate(keywords):
            if k in low:
                return field, rank
    return None


def _find_header_row(grid: list[list[str]]) -> tuple[int, dict[int, str], bool]:
    """Line-items header: (row index, {column index: field}, gst column is a
    half-rate CGST/SGST column). (-1, {}, False) when not found."""
    for i, row in enumerate(grid[:15]):
        best: dict[str, tuple[int, int]] = {}  # field -> (col, rank)
        gst_is_half = False
        for j, cell in enumerate(row):
            hit = _classify_header_cell(cell or "")
            if not hit:
                continue
            field, rank = hit
            if field not in best or rank < best[field][1]:
                best[field] = (j, rank)
                if field == "gst_rate":
                    low = (cell or "").lower()
                    gst_is_half = ("cgst" in low or "sgst" in low or "s/ut" in low) and "igst" not in low
        seen = set(best)
        # A real items header names at least a description plus two value columns.
        if "raw_description" in seen and len(seen & (_NUMERIC_FIELDS | {"hsn"})) >= 2:
            return i, {col: field for field, (col, _rank) in best.items()}, gst_is_half
    return -1, {}, False


def _row_to_line(fields: dict[str, str], line_no: int) -> Optional[InvoiceLine]:
    desc = " ".join((fields.get("raw_description") or "").split())
    if not desc or len(desc) < 2 or _TOTALS_ROW_RE.match(desc):
        return None
    values: dict[str, Any] = {"raw_description": desc, "line_no": line_no}
    found = 0
    for field, raw in fields.items():
        if field == "raw_description" or raw is None:
            continue
        raw = raw.strip()
        if not raw:
            continue
        if field in _NUMERIC_FIELDS:
            num = _to_number(raw.replace("%", "").replace("₹", ""))
            if num is not None:
                values[field] = num
                found += 1
        elif field in ("expiry_date", "mfg_date"):
            values[field] = _normalise_date(raw) or raw
            found += 1
        else:
            values[field] = raw
            found += 1
    if found == 0:
        return None
    # Heuristic parse — confidence grows with how many columns resolved.
    values["confidence"] = min(85.0, 45.0 + found * 8.0)
    return InvoiceLine(**values)


def _grid_to_lines(grid: list[list[str]]) -> list[InvoiceLine]:
    header_idx, colmap, gst_is_half = _find_header_row(grid)
    if header_idx < 0:
        return []
    lines: list[InvoiceLine] = []
    for row in grid[header_idx + 1:]:
        cells = [(c or "").strip() for c in row]
        joined = " ".join(c for c in cells if c)
        if not joined:
            continue
        if _TOTALS_ROW_RE.match(joined):
            break
        fields = {field: cells[j] for j, field in colmap.items() if j < len(cells)}
        line = _row_to_line(fields, len(lines) + 1)
        if line:
            # CGST/SGST columns hold half the GST rate each.
            if gst_is_half and line.gst_rate:
                line.gst_rate = round(line.gst_rate * 2, 2)
            lines.append(line)
        elif lines and fields.get("raw_description") and not any(
            (fields.get(f) or "").strip() for f in _NUMERIC_FIELDS if f in fields
        ):
            # Description wrapped onto a continuation row.
            lines[-1].raw_description += " " + " ".join(fields["raw_description"].split())
    return lines


def _lines_from_pdf_tables(raw: bytes) -> list[InvoiceLine]:
    if pdfplumber is None:
        return []
    lines: list[InvoiceLine] = []
    try:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            for page in pdf.pages[:5]:
                for table in page.extract_tables():
                    parsed = _grid_to_lines([[c or "" for c in r] for r in table])
                    if parsed:
                        for l in parsed:
                            l.line_no = len(lines) + l.line_no if lines else l.line_no
                        lines.extend(parsed)
    except Exception as e:
        log.warning("ocr-lines: pdf table extraction failed: %s", e)
    return lines


_TEXT_COL_SPLIT_RE = re.compile(r"\s{2,}")


def _lines_from_layout_text(text: str) -> list[InvoiceLine]:
    """Fallback for column-aligned text (pdfplumber layout mode): split rows on 2+ spaces."""
    grid = [_TEXT_COL_SPLIT_RE.split(l.strip()) for l in text.splitlines() if l.strip()]
    return _grid_to_lines(grid)


def _line_fields_found(lines: list[InvoiceLine]) -> int:
    fields = ("quantity", "rate", "gst_rate", "line_total", "hsn", "mrp", "taxable_value")
    return sum(sum(getattr(l, f) is not None for f in fields) for l in lines)


def _lines_from_image(img: "Image.Image") -> list[InvoiceLine]:
    """Try tesseract in table-friendly psm 6 first, then default segmentation,
    and keep whichever parse resolves more columns. Default psm often drops
    sparse table columns (e.g. a lone Qty column) entirely."""
    best: list[InvoiceLine] = []
    for config in ("--psm 6", ""):
        parsed = _lines_from_image_once(img, config)
        if _line_fields_found(parsed) > _line_fields_found(best):
            best = parsed
    return best


def _lines_from_image_once(img: "Image.Image", config: str) -> list[InvoiceLine]:
    """Positional parsing: locate the header row via tesseract word boxes, derive
    column x-spans from the header words, then bucket each data word into the
    column it overlaps most."""
    if pytesseract is None:
        return []
    try:
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, config=config)
    except Exception as e:
        log.warning("ocr-lines: image_to_data failed: %s", e)
        return []

    # Group words into visual rows by y-position. Tesseract's own line ids are
    # useless here: widely-spaced table columns get segmented into separate
    # blocks, so the same visual row spans several (block, par, line) keys.
    words: list[tuple[float, int, int, str]] = []  # (y_centre, left, right, text)
    heights: list[int] = []
    for i in range(len(data["text"])):
        word = (data["text"][i] or "").strip()
        if not word:
            continue
        top, height = data["top"][i], data["height"][i]
        words.append((top + height / 2, data["left"][i], data["left"][i] + data["width"][i], word))
        heights.append(height)
    if not words:
        return []
    heights.sort()
    row_tol = max(8.0, heights[len(heights) // 2] * 0.7)

    words.sort(key=lambda w: w[0])
    clusters: list[list[tuple[float, int, int, str]]] = []
    for w in words:
        if clusters and w[0] - clusters[-1][-1][0] <= row_tol:
            clusters[-1].append(w)
        else:
            clusters.append([w])
    ordered = [sorted((left, right, text) for _, left, right, text in c) for c in clusters]

    def merge_cells(words: list[tuple[int, int, str]], gap: int) -> list[tuple[int, int, str]]:
        cells: list[tuple[int, int, str]] = []
        for left, right, word in words:
            if cells and left - cells[-1][1] <= gap:
                pl, pr, pt = cells[-1]
                cells[-1] = (pl, max(pr, right), f"{pt} {word}")
            else:
                cells.append((left, right, word))
        return cells

    # Word gap tolerance scales with image width (~1.2% ≈ one space at 200dpi).
    gap = max(15, img.width // 80)

    header_cols: list[tuple[int, int, str]] = []  # (left, right, field)
    header_row_idx = -1
    for idx, words in enumerate(ordered):
        cells = merge_cells(words, gap)
        fields = [(l, r, _classify_header_cell(t)) for l, r, t in cells]
        named = [f for _, _, f in fields if f]
        if "raw_description" in named and len(set(named) & (_NUMERIC_FIELDS | {"hsn"})) >= 2:
            seen: set[str] = set()
            for l, r, f in fields:
                if f and f not in seen:
                    header_cols.append((l, r, f))
                    seen.add(f)
            header_row_idx = idx
            break
    if header_row_idx < 0:
        return []

    def column_for(left: int, right: int) -> Optional[str]:
        best, best_overlap = None, 0
        for cl, cr, field in header_cols:
            overlap = min(right, cr) - max(left, cl)
            if overlap > best_overlap:
                best, best_overlap = field, overlap
        if best:
            return best
        # No overlap — snap to the nearest column centre.
        centre = (left + right) / 2
        return min(header_cols, key=lambda c: abs((c[0] + c[1]) / 2 - centre))[2]

    lines: list[InvoiceLine] = []
    for words in ordered[header_row_idx + 1:]:
        cells = merge_cells(words, gap)
        joined = " ".join(t for _, _, t in cells)
        if _TOTALS_ROW_RE.match(joined):
            break
        fields: dict[str, str] = {}
        for left, right, text in cells:
            field = column_for(left, right)
            if field:
                fields[field] = f"{fields[field]} {text}" if field in fields else text
        line = _row_to_line(fields, len(lines) + 1)
        if line:
            lines.append(line)
    return lines


def _lines_from_scanned_pdf(raw: bytes) -> list[InvoiceLine]:
    if convert_from_bytes is None:
        return []
    lines: list[InvoiceLine] = []
    try:
        for img in convert_from_bytes(raw, dpi=250, first_page=1, last_page=3):
            parsed = _lines_from_image(img)
            for l in parsed:
                l.line_no = len(lines) + (l.line_no or 1)
            lines.extend(parsed)
    except Exception as e:
        log.warning("ocr-lines: scanned pdf failed: %s", e)
    return lines


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
    # Some PDFs map dash glyphs to NUL in their text layer ("CIRAKDL7\x000006"
    # for CIRAKDL7-0006); a hyphen is the least-wrong replacement.
    joined = "\n".join(text_parts).strip().replace("\x00", "-")
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

    inv_no = _find_invoice_number(text)

    inv_date = None
    m = _DATE_LINE_RE.search(text)
    if m:
        inv_date = _normalise_date(m.group(1))
    if not inv_date:
        m = _DATE_TEXT_RE.search(text)
        if m:
            inv_date = _normalise_date(m.group(1))
    if not inv_date:
        m = re.search(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b", text)
        if m:
            inv_date = _normalise_date(m.group(1))

    grand_total = None
    m = _TOTAL_RE.search(text) or _TOTAL_BARE_RE.search(text)
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
        lines=[],
    )


def _extract_lines(raw: bytes, is_pdf: bool, pdf_has_text: bool) -> list[InvoiceLine]:
    """Try strategies from most to least structured."""
    if is_pdf:
        lines = _lines_from_pdf_tables(raw)
        if lines:
            return lines
        if pdf_has_text and pdfplumber is not None:
            # No ruled table — retry on column-aligned layout text.
            try:
                with pdfplumber.open(io.BytesIO(raw)) as pdf:
                    layout_text = "\n".join(
                        (p.extract_text(layout=True) or "") for p in pdf.pages[:5]
                    )
                lines = _lines_from_layout_text(layout_text)
                if lines:
                    return lines
            except Exception as e:
                log.warning("ocr-lines: layout text failed: %s", e)
        if not pdf_has_text:
            return _lines_from_scanned_pdf(raw)
        return []
    if Image is None:
        return []
    try:
        img = Image.open(io.BytesIO(raw))
    except Exception:
        return []
    return _lines_from_image(img)


def _pdf_has_text(raw: bytes) -> bool:
    if pdfplumber is None:
        return False
    try:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            return any((p.extract_text() or "").strip() for p in pdf.pages[:5])
    except Exception:
        return False


@app.post("/extract-ocr", response_model=InvoiceExtraction)
async def extract_ocr(
    file: UploadFile = File(...),
    mime_type: Optional[str] = Form(None),
) -> InvoiceExtraction:
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    mime = (mime_type or file.content_type or "").lower()
    is_pdf = "pdf" in mime or (file.filename or "").lower().endswith(".pdf")
    log.info("ocr: file=%s bytes=%d mime=%s", file.filename, len(raw), mime)

    t0 = time.time()
    text = _ocr_pdf_bytes(raw) if is_pdf else _ocr_image_bytes(raw)
    log.info("ocr: text extracted chars=%d in %.1fms", len(text), (time.time() - t0) * 1000)

    if not text.strip():
        raise HTTPException(422, "OCR could not read any text from the file. Try the AI engine.")

    result = _parse_header_from_text(text)

    t1 = time.time()
    result.lines = _extract_lines(raw, is_pdf, pdf_has_text=is_pdf and _pdf_has_text(raw))
    log.info("ocr: lines parsed count=%d in %.1fms", len(result.lines), (time.time() - t1) * 1000)

    if result.lines:
        result.notes = (
            f"Extracted via OCR: header + {len(result.lines)} line item(s) parsed "
            "heuristically. Verify quantities and amounts before approving."
        )
    else:
        result.notes = (
            "Extracted via OCR (header only — no line-item table detected). "
            "Enter line items manually or retry with the AI engine."
        )
    log.info(
        "ocr: parsed supplier=%s inv=%s date=%s total=%s lines=%d conf=%s",
        result.supplier_name, result.invoice_number, result.invoice_date,
        result.grand_total, len(result.lines), result.overall_confidence,
    )
    return result

