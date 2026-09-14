#!/usr/bin/env python3
"""Prepare a protected, local-only v3680 Shopee payload from audited CSVs.

The output contains plaintext source material and therefore is created mode 0600
under the protected store. No link or credential is printed or versioned.
"""
from __future__ import annotations
import csv
import decimal
import hashlib
import io
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(os.environ.get(
    "NEXUS_SHOPEE_MANIFEST", str(ROOT / "data/v3680-shopee-source-manifest.json")
))
SOURCE_DIR = Path(os.environ.get("NEXUS_SHOPEE_SOURCE_DIR", "/home/user/uploads"))
OUTPUT = Path(os.environ.get("NEXUS_SHOPEE_PAYLOAD", "/home/user/.v3370-protected/v3680-shopee-payload.json"))


def numeric(value: object) -> str | None:
    text = str(value or "").strip().replace("R$", "").replace("%", "").replace(" ", "")
    if not text:
        return None
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    found = re.search(r"-?\d+(?:\.\d+)?", text)
    if not found:
        return None
    return str(decimal.Decimal(found.group(0)).quantize(decimal.Decimal("0.01")))


def period(value: object) -> tuple[str | None, str | None]:
    text = str(value or "")
    start = re.search(r"start:\s*(\d{4}-\d{2}-\d{2})", text, re.I)
    end = re.search(r"end:\s*(\d{4}-\d{2}-\d{2})", text, re.I)
    return (start.group(1) if start else None, end.group(1) if end else None)


def main() -> None:
    manifest = json.loads(MANIFEST.read_text())
    if manifest.get("schema_version") != "v3680-shopee-source-manifest-1":
        raise RuntimeError("manifest_schema_invalid")
    protected_rows: list[dict] = []
    observed_files: list[dict] = []
    for expected in manifest["source_files"]:
        source = SOURCE_DIR / expected["file"]
        raw = source.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != expected["sha256"]:
            raise RuntimeError(f"source_hash_mismatch:{source.name}")
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        if len(rows) != expected["rows"]:
            raise RuntimeError(f"source_row_count_mismatch:{source.name}")
        kind = expected["kind"]
        observed_files.append(dict(expected))
        for row in rows:
            canonical = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            row_hash = hashlib.sha256((source.name + "\x1f" + canonical).encode()).hexdigest()
            start, end = period(row.get("Offer Period"))
            if kind == "product":
                primary = str(row.get("Product Link", "")).strip()
                affiliate = str(row.get("Offer Link", "")).strip()
                name = str(row.get("Item Name", "")).strip()
                store = str(row.get("Nome da loja", "")).strip() or None
                item_id = str(row.get("Item Id", "")).strip() or None
                rate, ceiling = numeric(row.get("Commission Rate")), None
                commission, price = numeric(row.get("Commission")), numeric(row.get("Price"))
                sales, offer_type = str(row.get("Sales", "")).strip() or None, None
            elif kind == "shop":
                primary = str(row.get("Offer Link", "")).strip()
                affiliate = str(row.get("Trackable Link_short", "")).strip()
                name = str(row.get("Offer Name", "")).strip()
                store = item_id = rate = commission = price = sales = None
                ceiling, offer_type = numeric(row.get("Commission Rate")), "shop_offer"
            else:
                primary = None
                affiliate = str(row.get("Offer Link", "")).strip()
                name = str(row.get("Offer Name", "")).strip()
                store = item_id = ceiling = commission = price = sales = None
                rate = numeric(row.get("Commission Rate"))
                offer_type = str(row.get("Offer Type", "")).strip() or None
            primary_host = (urlsplit(primary).hostname or "").lower() if primary else None
            affiliate_host = (urlsplit(affiliate).hostname or "").lower()
            if affiliate_host != "s.shopee.com.br" or primary_host not in (None, "shopee.com.br", "www.shopee.com.br"):
                raise RuntimeError(f"source_host_invalid:{source.name}")
            protected_rows.append({
                "offer_key": row_hash, "source_kind": kind, "name": name, "store": store,
                "item_id": item_id, "commission_rate_pct": rate, "commission_ceiling_pct": ceiling,
                "commission_brl": commission, "price_brl": price, "sales_label": sales,
                "primary_url": primary, "primary_host": primary_host,
                "affiliate_url": affiliate, "affiliate_host": affiliate_host,
                "offer_period_start": start, "offer_period_end": end, "offer_type": offer_type,
                "source_file": source.name, "source_sha256": digest, "source_row_sha256": row_hash,
            })
    expected_rows = int(manifest["total_rows"])
    expected_unique_items = int(manifest["unique_product_item_ids"])
    if len(protected_rows) != expected_rows or len({row["offer_key"] for row in protected_rows}) != expected_rows:
        raise RuntimeError("protected_payload_count_invalid")
    if len({row["item_id"] for row in protected_rows if row["source_kind"] == "product"}) != expected_unique_items:
        raise RuntimeError("protected_item_identity_count_invalid")
    payload = {
        "schema_version": "v3680-protected-shopee-payload-1",
        "row_count": expected_rows,
        "files": observed_files,
        "rows": protected_rows,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
    os.chmod(OUTPUT, 0o600)
    print(json.dumps({"ok": True, "rows": expected_rows, "files": len(observed_files), "output_mode": "0600", "plaintext_urls_printed": False}))


if __name__ == "__main__":
    main()
