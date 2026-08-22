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


class DocumentExtraction(InvoiceExtraction):
    """One bill, plus which of the uploaded photos it was read from."""

    page_indexes: List[int] = Field(default_factory=list)
    duplicate_page_indexes: List[int] = Field(default_factory=list)
    page_labels: List[Optional[str]] = Field(default_factory=list)
    missing_page_numbers: List[int] = Field(default_factory=list)
    grouping_reason: Optional[str] = None
    grouping_confidence: Optional[float] = None

    @field_validator("page_indexes", "duplicate_page_indexes", "missing_page_numbers", mode="before")
    @classmethod
    def _int_list(cls, v: Any) -> Any:
        # Models return "0", 0.0 and sometimes a bare int here. A page index that
        # fails to parse would silently drop a photo, so coerce rather than 502.
        if v is None:
            return []
        if isinstance(v, (int, float, str)):
            v = [v]
        if not isinstance(v, list):
            return []
        out: List[int] = []
        for x in v:
            try:
                out.append(int(float(x)))
            except (TypeError, ValueError):
                continue
        return out


class BatchExtraction(BaseModel):
    documents: List[DocumentExtraction] = Field(default_factory=list)
    # Photos the model never mentioned. Never silently swallowed: an unread page
    # is line items the distributor paid for and would never receive.
    unassigned_page_indexes: List[int] = Field(default_factory=list)


# A sales invoice is the same table read from the other side of the counter.
# Everything about columns, discounts and totals holds; the only thing that
# inverts is who the counterparty is. Getting that backwards files the
# distributor's own name as the customer on every invoice they import.
SALES_CONTEXT = """
THIS IS A SALES INVOICE THE USER ISSUED, NOT A BILL THEY RECEIVED.
- The seller is the user's own business. Ignore it.
- `supplier_name` and `supplier_gstin` must hold the BUYER — the customer the invoice was made out to,
  usually labelled "Buyer", "Bill To", "Customer" or "M/s". If a separate "Ship To" or "Consignee"
  differs from "Bill To", use Bill To.
- Everything else — line items, quantities, rates, discounts, taxes, totals — is read exactly the same way.
"""


# Appended when several photos arrive together. Everything in SYSTEM_PROMPT
# still applies to each bill; this only adds the question of which photos are
# the same bill.
#
# The rules below are deliberately lopsided. A wrong merge is silent and
# corrupting — two suppliers fused into one invoice writes wrong stock and a
# wrong weighted-average cost, and it looks entirely plausible on the review
# screen. A missed merge is loud and harmless: the operator sees two half-bills
# and says so. So every ambiguous case is told to split, never to join.
MULTIPAGE_CONTEXT = """

YOU HAVE BEEN GIVEN SEVERAL PHOTOS AT ONCE. THEY ARE NOT NECESSARILY ONE BILL.

They are numbered from 0 in the order given. Decide which photos belong to which
bill, then extract each bill once. Return one entry in `documents` per real bill,
listing its photos in `page_indexes` in READING order — page 1 first — regardless
of the order they were given to you.

WHEN TWO PHOTOS ARE THE SAME BILL
Join two photos only on positive evidence. Any of these is enough:
- They print the same invoice number AND the same supplier (GSTIN, or the name
  if no GSTIN is printed).
- One says "Page 1 of 3" and another "Page 2 of 3" with the same bill identity.
- One photo has no header of its own — it opens straight into a continuing
  line-item table — and its first line number continues where another photo's
  table stopped. A continuation page often carries no supplier and no invoice
  number at all; the line numbers are what tie it to its parent.

WHEN THEY ARE NOT
- Different supplier GSTIN means different bills. Always. Never join across
  suppliers however similar the paper looks.
- Different invoice numbers means different bills, even from the same supplier on
  the same day — distributors receive several bills from one supplier daily.
- The same invoice number from two different suppliers is a coincidence, not one
  bill. Invoice numbers are not unique across suppliers.
- If you cannot find positive evidence, leave the photo as its own bill and say
  why in `grouping_reason`. Splitting a bill that should have been joined is a
  small, visible problem. Joining two bills that are not one corrupts the stock
  ledger silently. Prefer to split.

THE SAME PAGE PHOTOGRAPHED TWICE
Operators re-shoot a page when the first came out blurred, and bills are printed
in Original / Duplicate / Transporter copies that are identical but for a label.
Both look like extra pages and both would double the goods received.
- If two photos show the SAME page — same page label, or the same first and last
  line items — keep the clearer one in `page_indexes` and put the other in
  `duplicate_page_indexes`. Do not extract its rows twice.
- If two photos are each a COMPLETE bill with the same invoice number — each has
  its own header and its own totals block — they are copies of one bill, not two
  pages. Keep one, list the rest as duplicates.
- A real page 2 continues the line numbering. A duplicate repeats it. That is the
  test.

READING A BILL THAT SPANS PAGES
- The header — supplier, GSTIN, invoice number, date — is usually printed only on
  the first page. Use it for the whole bill.
- The totals are usually printed only on the last page. Take `grand_total`,
  `tax_total` and the tax summary from there.
- Many bills print a running carry-forward on every page: "B/F", "C/F", "Carried
  Forward", "Total This Page". THESE ARE NOT EXTRA MONEY AND THEY ARE NOT LINE
  ITEMS. Never add page carry-forwards together, and never put one in `lines`.
  A per-page subtotal is a subset of the final total, not something to add to it.
- `line_count_on_bill` is the number of product rows on the WHOLE bill, across
  every page, and `lines` must hold that many objects.
- Line numbering usually runs unbroken across pages — 1 to 20 on page 1, 21 to 40
  on page 2. Emit them in that order, and use a break in the sequence as a sign
  a page is missing.
- A product row cut in half by the page break is still ONE row. Join it.
- If the pages say "1 of 4" but you were given only three of them, list the
  numbers you did not get in `missing_page_numbers` and say so in `notes`. Extract
  what you have. Do not invent the missing rows, and do not let the printed grand
  total make you believe you read them.

PER BILL, ALSO RETURN
- `page_indexes`: the photos that make up this bill, in reading order.
- `duplicate_page_indexes`: photos of this bill you deliberately did not read
  twice.
- `page_labels`: what each kept page says about itself, e.g. "1 of 3", or null
  where nothing is printed.
- `missing_page_numbers`: pages the bill refers to that you were not given.
- `grouping_reason`: one plain sentence on why these photos are one bill, written
  for the operator checking your work — "same invoice number HIND-4471 and GSTIN
  on both", or "no invoice number on this photo, kept separate".
- `grouping_confidence`: 0-100. Below 60 whenever you joined photos on anything
  weaker than a shared invoice number or a printed page sequence.

EVERY PHOTO MUST BE ACCOUNTED FOR EXACTLY ONCE, in some bill's `page_indexes` or
`duplicate_page_indexes`. A photo you silently drop is a page of stock the
distributor paid for and never receives. If a photo is too dark or blurred to
read at all, still return it as its own bill with empty `lines`, an
`overall_confidence` under 25, and a note saying what went wrong.
"""

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


# Thinking tokens are charged against the SAME output budget as the answer, and
# these models think hard about a 40-row bill: one measured 4,273 thinking
# tokens beside 4,752 of JSON. Left at the default the model runs out mid-answer
# and — because a response schema is in force — Gemini closes the JSON *validly*
# but short. That does not raise: it arrives as a well-formed bill with some of
# the rows missing, which an operator then approves into stock. Hence a generous
# ceiling, and a hard check on why generation stopped.
MAX_OUTPUT_TOKENS = 32768


def _gemini_text_or_die(data: dict, where: str) -> str:
    """Pull the JSON text out of a Gemini response, refusing a truncated one."""
    try:
        cand = data["candidates"][0]
    except (KeyError, IndexError) as e:
        log.error("%s: no candidate raw=%s", where, str(data)[:800])
        raise HTTPException(502, f"Malformed Gemini response: {e}") from e

    reason = cand.get("finishReason")
    if reason and reason not in ("STOP", "FINISH_REASON_STOP"):
        usage = data.get("usageMetadata", {})
        log.error("%s: generation stopped early reason=%s usage=%s", where, reason, usage)
        if reason == "MAX_TOKENS":
            # Never fall through to parsing this. A short bill that looks whole
            # is worse than a failed upload the operator can retry.
            raise HTTPException(
                502,
                "The bill was too long to read in one pass — the model ran out of room "
                "part-way through. Split it into fewer pages per upload and try again.",
            )
        raise HTTPException(502, f"Extraction stopped early ({reason})")

    try:
        return cand["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as e:
        log.error("%s: no text part raw=%s", where, str(data)[:800])
        raise HTTPException(502, f"Malformed Gemini response: {e}") from e


def _batch_response_schema() -> dict[str, Any]:
    """RESPONSE_SCHEMA, wrapped as a list of bills with their page assignments.

    Built from the single-invoice schema rather than written out again, so the
    two can never drift — a field added for one-page bills is automatically
    asked for on multi-page ones too.
    """
    doc = json.loads(json.dumps(RESPONSE_SCHEMA))  # deep copy
    doc["properties"].update({
        "page_indexes": {
            "type": "ARRAY", "items": {"type": "INTEGER"},
            "description": "0-based photo numbers making up this bill, in reading order",
        },
        "duplicate_page_indexes": {
            "type": "ARRAY", "items": {"type": "INTEGER"},
            "description": "Photos of this same bill that were deliberately not read twice",
        },
        "page_labels": {"type": "ARRAY", "items": {"type": "STRING", "nullable": True}},
        "missing_page_numbers": {"type": "ARRAY", "items": {"type": "INTEGER"}},
        "grouping_reason": {"type": "STRING", "nullable": True},
        "grouping_confidence": {"type": "NUMBER", "nullable": True},
    })
    doc["required"] = ["lines", "page_indexes"]
    return {
        "type": "OBJECT",
        "properties": {"documents": {"type": "ARRAY", "items": doc}},
        "required": ["documents"],
    }


BATCH_RESPONSE_SCHEMA: dict[str, Any] = _batch_response_schema()


# A phone camera produces a 3000-4000px bill photo. The model cannot read
# anything at that scale that it cannot read at 1600, and every extra pixel is
# input tokens and upload time. Kept generously high because the thing being
# read is a dense table of small digits — this is about discarding pixels the
# model never uses, not about compressing the bill.
MAX_IMAGE_EDGE = int(os.environ.get("MAX_IMAGE_EDGE", "1600"))


def _downscale(raw: bytes, mime: str) -> tuple[bytes, str]:
    """Shrink an oversized photo. Never fails an upload over a resize."""
    if not mime.startswith("image/"):
        return raw, mime
    try:
        import io as _io
        from PIL import Image as _Image  # imported here: the module-level one
                                         # is declared further down, in the OCR
                                         # section, and may be absent entirely.
        im = _Image.open(_io.BytesIO(raw))
        if max(im.size) <= MAX_IMAGE_EDGE:
            return raw, mime
        before = im.size
        im.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE), _Image.LANCZOS)
        buf = _io.BytesIO()
        im.convert("RGB").save(buf, "JPEG", quality=88, optimize=True)
        out = buf.getvalue()
        log.info("downscale: %sx%s -> %sx%s, %dKB -> %dKB",
                 *before, *im.size, len(raw) // 1024, len(out) // 1024)
        return out, "image/jpeg"
    except Exception as e:  # noqa: BLE001
        # A bill that reads slowly beats a bill that does not arrive.
        log.warning("downscale: skipped (%s)", e)
        return raw, mime


def _parse_groups(raw: Optional[str], page_count: int) -> Optional[list[list[int]]]:
    """Validate an operator-supplied grouping, or refuse it.

    This overrides the model's own judgement, so it is checked rather than
    trusted: a malformed grouping that silently fell back to auto-grouping would
    look to the operator like their correction had been applied when it had not.
    """
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"groups is not valid JSON: {e}") from e
    if not isinstance(parsed, list) or not parsed:
        raise HTTPException(400, "groups must be a non-empty list of lists")

    seen: set[int] = set()
    out: list[list[int]] = []
    for g in parsed:
        if not isinstance(g, list) or not g:
            raise HTTPException(400, "each group must be a non-empty list of photo numbers")
        page: list[int] = []
        for x in g:
            try:
                i = int(x)
            except (TypeError, ValueError):
                raise HTTPException(400, f"{x!r} is not a photo number") from None
            if i < 0 or i >= page_count:
                raise HTTPException(400, f"photo {i} does not exist (there are {page_count})")
            if i in seen:
                raise HTTPException(400, f"photo {i} is in more than one group")
            seen.add(i)
            page.append(i)
        out.append(page)
    missing = [i for i in range(page_count) if i not in seen]
    if missing:
        raise HTTPException(400, f"photo(s) {missing} are not in any group")
    return out


def _batch_shortfalls(batch: BatchExtraction) -> list[str]:
    """Reasons to believe this read is incomplete, in the model's own terms.

    Measured on gemini-3.6-flash against a known two-bill batch: the same
    request returns [18, 3] lines across two bills on one attempt and a single
    bill with one line on the next. Nothing distinguishes them in the transport
    — both are HTTP 200, finishReason STOP, schema-valid JSON. The only way to
    tell a lazy answer from a real one is to check it against what the model
    itself said was on the paper, which is exactly what `line_count_on_bill`
    and the page assignment are for.
    """
    bad: list[str] = []
    if batch.unassigned_page_indexes:
        bad.append(f"{len(batch.unassigned_page_indexes)} photo(s) not assigned to any bill")
    if not batch.documents:
        bad.append("no bills returned")
    for doc in batch.documents:
        stated = doc.line_count_on_bill
        got = len(doc.lines)
        if stated and got < stated:
            bad.append(f"bill {doc.invoice_number or '?'}: {got} rows read of {stated} counted")
        elif not stated and got <= 1 and len(doc.page_indexes) > 1:
            # A bill spanning several photos with one row on it is not a bill
            # anyone photographs twice.
            bad.append(f"bill {doc.invoice_number or '?'}: {got} row(s) across {len(doc.page_indexes)} pages")
    return bad


def _settle_page_assignment(batch: BatchExtraction, page_count: int) -> BatchExtraction:
    """Make the model's page assignment actually true.

    The prompt asks for every photo exactly once. Models mostly comply, but the
    two ways they fail both cost real money: a page claimed by two bills doubles
    those goods into stock, and a page claimed by none is a page of stock that
    was paid for and never arrives. Neither is visible on the review screen,
    because each bill looks internally consistent.

    So the assignment is repaired here rather than trusted:
      - an index out of range is dropped (it refers to no photo),
      - a repeat keeps its first claimant, which is the bill that also carries
        the surrounding pages,
      - anything left over is reported, not swallowed.
    """
    seen: set[int] = set()
    for doc in batch.documents:
        kept: List[int] = []
        for idx in doc.page_indexes:
            if idx < 0 or idx >= page_count:
                log.warning("batch: dropping out-of-range page_index=%s (have %d photos)", idx, page_count)
                continue
            if idx in seen:
                log.warning("batch: page %d claimed twice, leaving it with the first bill", idx)
                continue
            seen.add(idx)
            kept.append(idx)
        doc.page_indexes = kept
        # Duplicates count as accounted-for — they were looked at and rejected —
        # but their rows are never read a second time.
        dupes: List[int] = []
        for idx in doc.duplicate_page_indexes:
            if idx < 0 or idx >= page_count or idx in seen:
                continue
            seen.add(idx)
            dupes.append(idx)
        doc.duplicate_page_indexes = dupes

    # A bill left with no pages at all is not a bill.
    batch.documents = [d for d in batch.documents if d.page_indexes]

    batch.unassigned_page_indexes = [i for i in range(page_count) if i not in seen]
    if batch.unassigned_page_indexes:
        log.error("batch: %d photo(s) unaccounted for: %s",
                  len(batch.unassigned_page_indexes), batch.unassigned_page_indexes)
    return batch


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

    # Infer a trade discount the reader did not record.
    #
    # Indian distributor bills price off a list rate and knock 50-70% off it, and
    # not every bill labels that column the same way. When quantity x rate
    # overshoots the printed amount by the same proportion on row after row,
    # that is a discount column, not a misread — and treating it as a misread
    # condemns a perfectly good extraction. One row could be a coincidence;
    # agreement across most of the bill is the supplier's pricing.
    implied: list[float] = []
    for line in result.lines or []:
        if line.discount_pct or not (line.quantity and line.rate and line.taxable_value):
            continue
        gross = float(line.quantity) * float(line.rate)
        if gross <= 0:
            continue
        pct = (1 - float(line.taxable_value) / gross) * 100
        if 0.5 <= pct <= 95:            # a real discount, not noise or nonsense
            implied.append(round(pct, 2))

    if len(implied) >= 3:
        common = max(set(implied), key=implied.count)
        if implied.count(common) * 2 >= len(implied):
            filled = 0
            for line in result.lines or []:
                if line.discount_pct or not (line.quantity and line.rate and line.taxable_value):
                    continue
                gross = float(line.quantity) * float(line.rate)
                if gross > 0 and abs((1 - float(line.taxable_value) / gross) * 100 - common) < 0.5:
                    line.discount_pct = common
                    filled += 1
            if filled:
                note = (f"A {common:g}% trade discount was not labelled on the bill but is consistent "
                        f"across {filled} lines — applied so the amounts reconcile.")
                result.notes = f"{result.notes}; {note}" if result.notes else note

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


# One call for the whole batch, not one per photo. Beyond reading a bill that
# runs to several pages, this is what lets the model see that photo 2 continues
# photo 1 — a per-file loop cannot know that, and it also costs N requests where
# this costs one, which matters against a per-minute rate limit.
#
# Six, because that is where it was measured to still work. Reading many photos
# together is superlinear in both thinking and answer length, and against these
# same bills: six photos take ~90s, ten exceed the 300s ceiling and fail
# outright. A bill long enough to need more than six photos is rare; a batch
# that never returns is not something to ship for it.
MAX_BATCH_PAGES = int(os.environ.get("MAX_BATCH_PAGES", "6"))


@app.post("/extract-batch", response_model=BatchExtraction)
async def extract_batch(
    files: List[UploadFile] = File(...),
    doc_type: Optional[str] = Form(None),
    # JSON like [[0,1],[2]] — the operator has corrected the grouping and this
    # is now a fact, not a question. Sent when they regroup on the review panel.
    # Line items cannot be moved between bills after the fact, because nothing
    # records which photo a given row was read from, so a corrected grouping
    # means a fresh read rather than a patched one.
    groups: Optional[str] = Form(None),
) -> BatchExtraction:
    if not files:
        raise HTTPException(400, "No files")
    if len(files) > MAX_BATCH_PAGES:
        raise HTTPException(
            400,
            f"{len(files)} photos is more than this reads in one go "
            f"(limit {MAX_BATCH_PAGES}). Upload the pages of one bill together, "
            f"and other bills separately.",
        )

    blobs: list[tuple[bytes, str]] = []
    for f in files:
        raw = await f.read()
        if not raw:
            raise HTTPException(400, f"Empty file: {f.filename}")
        mime = f.content_type or "application/octet-stream"
        if not (mime.startswith("image/") or mime == "application/pdf"):
            raise HTTPException(400, f"Unsupported type {mime} for {f.filename}")
        blobs.append(_downscale(raw, mime))

    log.info("extract_batch: %d file(s) mimes=%s", len(blobs), [m for _, m in blobs])
    prompt = (
        SYSTEM_PROMPT
        + (SALES_CONTEXT if (doc_type or "").lower() == "sales" else "")
        + MULTIPAGE_CONTEXT
    )
    # The model is told which photo is which by position, so the label goes in
    # front of each image and the order here is the order of page_indexes.
    instruction = (
        f"There are {len(blobs)} photos, numbered 0 to {len(blobs) - 1} in the order given. "
        "Group them into bills and extract each bill once."
    )

    forced = _parse_groups(groups, len(blobs))
    if forced is not None:
        instruction = (
            f"There are {len(blobs)} photos, numbered 0 to {len(blobs) - 1} in the order given.\n"
            "The operator has already told you which photos are which bill. Do NOT regroup them:\n"
            + "\n".join(
                f"  bill {i + 1}: photos {g}" for i, g in enumerate(forced)
            )
            + "\nReturn exactly one entry in `documents` per bill above, with page_indexes exactly "
              "as listed, and extract each bill from those photos. If two of a bill's photos turn "
              "out to be the same page, still keep the grouping and put the repeat in "
              "duplicate_page_indexes."
        )
        log.info("extract_batch: operator-supplied grouping %s", forced)

    async def attempt(nudge: str = "") -> BatchExtraction:
        return await _run_batch(blobs, prompt, instruction + nudge)

    batch = await attempt()
    shortfalls = _batch_shortfalls(batch)
    if shortfalls:
        # One retry, and only ever one: a second lazy answer is information, a
        # third request is just spending the operator's rate limit. The retry is
        # told what was wrong the first time, because "you missed a page" is a
        # far stronger instruction than repeating the original ask.
        log.warning("extract_batch: incomplete read (%s) — retrying once", "; ".join(shortfalls))
        retry = await attempt(
            "\n\nA previous attempt at these same photos came back incomplete: "
            + "; ".join(shortfalls)
            + ". Read every photo and every product row this time, and make sure each photo "
              "appears in exactly one bill's page_indexes or duplicate_page_indexes."
        )
        if not _batch_shortfalls(retry) or len(retry.documents) > len(batch.documents):
            batch = retry
        else:
            log.error("extract_batch: retry no better, returning the first read")

    # Each bill goes through exactly the same arithmetic checking a single-page
    # upload gets. Multi-page changes which photos a bill came from, not what
    # makes its numbers trustworthy.
    #
    # _reconcile_lines mutates in place, and DocumentExtraction is an
    # InvoiceExtraction, so the page fields ride along untouched.
    for doc in batch.documents:
        _reconcile_lines(doc)

    remaining = _batch_shortfalls(batch)
    if remaining:
        # Said out loud on the bill rather than buried in a log. The operator is
        # the last line of defence against a short bill being approved.
        note = "Automatic check: " + "; ".join(remaining) + ". Please compare against the paper."
        for doc in batch.documents:
            doc.notes = f"{doc.notes}; {note}" if doc.notes else note
            if doc.overall_confidence is None or doc.overall_confidence > 45:
                doc.overall_confidence = 45

    log.info(
        "extract_batch: %d photo(s) -> %d bill(s) pages=%s dupes=%s unassigned=%s",
        len(blobs), len(batch.documents),
        [d.page_indexes for d in batch.documents],
        [d.duplicate_page_indexes for d in batch.documents],
        batch.unassigned_page_indexes,
    )
    return batch


async def _run_batch(
    blobs: list[tuple[bytes, str]], prompt: str, instruction: str,
) -> BatchExtraction:
    """One grouping-and-extraction pass over the whole batch."""
    if _use_anthropic():
        blocks: list[dict] = [{"type": "text", "text": instruction}]
        for i, (raw, mime) in enumerate(blobs):
            b64 = base64.b64encode(raw).decode("ascii")
            blocks.append({"type": "text", "text": f"Photo {i}:"})
            blocks.append(
                {"type": "document", "source": {"type": "base64", "media_type": mime, "data": b64}}
                if mime == "application/pdf"
                else {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
            )
        parsed = await _anthropic_json(prompt, BATCH_RESPONSE_SCHEMA, blocks)
    else:
        if not GOOGLE_API_KEY:
            raise HTTPException(500, "No AI provider configured (set ANTHROPIC_API_KEY or GOOGLE_API_KEY)")
        parts: list[dict] = [{"text": instruction}]
        for i, (raw, mime) in enumerate(blobs):
            parts.append({"text": f"Photo {i}:"})
            parts.append({"inlineData": {"mimeType": mime, "data": base64.b64encode(raw).decode("ascii")}})
        payload = {
            "systemInstruction": {"parts": [{"text": prompt}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": BATCH_RESPONSE_SCHEMA,
                "temperature": 0.1,
                "maxOutputTokens": MAX_OUTPUT_TOKENS,
            },
        }
        t0 = time.time()
        try:
            # Longer than the single-file timeout: this is several photos and a
            # grouping decision in one pass.
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(GEMINI_ENDPOINT, params={"key": GOOGLE_API_KEY}, json=payload)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Gemini transport error: {e}") from e
        log.info("extract_batch: Gemini status=%s in %.1fms", resp.status_code, (time.time() - t0) * 1000)
        if resp.status_code >= 400:
            log.error("extract_batch: Gemini error body=%s", resp.text[:1000])
            raise HTTPException(resp.status_code, f"Gemini error: {resp.text[:500]}")
        data = resp.json()
        try:
            parsed = json.loads(_gemini_text_or_die(data, "extract_batch"))
        except json.JSONDecodeError as e:
            log.exception("extract_batch: malformed response raw=%s", str(data)[:800])
            raise HTTPException(502, f"Malformed Gemini response: {e}") from e

    try:
        batch = BatchExtraction.model_validate(parsed)
    except Exception as e:  # noqa: BLE001
        log.exception("extract_batch: validation failed raw=%s", str(parsed)[:800])
        raise HTTPException(502, f"Malformed batch response: {e}") from e

    # Reconciliation deliberately does NOT happen here — a retry compares two
    # raw reads, and arithmetic repair would make a lazy answer look tidier
    # than it is. The caller reconciles whichever read it keeps.
    return _settle_page_assignment(batch, len(blobs))


@app.post("/extract", response_model=InvoiceExtraction)
async def extract(
    file: UploadFile = File(...),
    mime_type: Optional[str] = Form(None),
    # "purchase" (default) or "sales". Only changes which party is captured.
    doc_type: Optional[str] = Form(None),
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
    prompt = SYSTEM_PROMPT + (SALES_CONTEXT if (doc_type or "").lower() == "sales" else "")

    if _use_anthropic():
        log.info("extract: calling Claude model=%s mime=%s", ANTHROPIC_MODEL, mime)
        if mime == "application/pdf":
            doc_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
        elif mime.startswith("image/"):
            doc_block = {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
        else:
            raise HTTPException(400, f"Claude extraction supports PDF and images, not {mime}")
        parsed = await _anthropic_json(
            prompt, RESPONSE_SCHEMA,
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
        "systemInstruction": {"parts": [{"text": prompt}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": "Extract the full invoice as structured JSON."},
                    {"inlineData": {"mimeType": mime, "data": b64}},
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
            "temperature": 0.1,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
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
        parsed = json.loads(_gemini_text_or_die(data, "extract"))
    except json.JSONDecodeError as e:
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

