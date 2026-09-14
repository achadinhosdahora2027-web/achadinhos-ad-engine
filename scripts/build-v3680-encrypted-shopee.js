#!/usr/bin/env node
/**
 * Build the v3680 encrypted Shopee migration payload.
 *
 * Plaintext source rows are read only from the protected local payload. The
 * production KMS value is retrieved over the authenticated Management API and
 * is never printed or written. Every variable source field is independently
 * sealed with AES-256-GCM after an HKDF-SHA256 context derivation. Output has
 * ciphertext and non-secret aggregate/verification metadata only.
 */
const fs = require("node:fs");
const crypto = require("node:crypto");

const runtimePath = process.env.NEXUS_RUNTIME_PATH || "/home/user/.v3370-protected/runtime.json";
const payloadPath = process.env.NEXUS_SHOPEE_PAYLOAD || "/home/user/.v3370-protected/v3680-shopee-payload.json";
const outputPath = process.env.NEXUS_SHOPEE_ENCRYPTED || "/home/user/.v3370-protected/v3680-shopee-encrypted.json";
const projectRef = process.env.NEXUS_MASTER_REF || "etbxbaaaspdcoiakifbb";

function managementTokens(runtime) {
  const tokens = [];
  for (const section of ["supabase_management", "supabase_management_v3600_supplied"]) {
    for (const value of Object.values(runtime[section] || {})) {
      if (typeof value === "string" && value.startsWith("sbp_") && !tokens.includes(value)) tokens.push(value);
    }
  }
  return tokens;
}

async function managementToken(tokens) {
  for (const token of tokens) {
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
      });
      if (response.ok) return token;
    } catch (_) { /* try the next protected token */ }
  }
  throw new Error("no_authorized_management_token");
}

async function fetchKms(token) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "select value from public.nexus_growth_secrets where key='nexus_satellites_kms' and length(btrim(value))>=16" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("kms_query_failed");
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].value !== "string" || rows[0].value.length < 16) {
    throw new Error("kms_unavailable");
  }
  return rows[0].value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function seal(value, aad, key) {
  if (value === null || value === undefined || value === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Self-describing binary envelope: version 1 | 12-byte IV | 16-byte tag | ciphertext.
  return Buffer.concat([Buffer.from([1]), iv, tag, encrypted]).toString("hex");
}

async function main() {
  const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  if (payload.schema_version !== "v3680-protected-shopee-payload-1" || !Number.isInteger(payload.row_count) || payload.row_count < 1 || payload.rows?.length !== payload.row_count) {
    throw new Error("protected_payload_invariant_failed");
  }
  const token = await managementToken(managementTokens(runtime));
  let kms = await fetchKms(token);
  let key = Buffer.from(crypto.hkdfSync(
    "sha256", Buffer.from(kms, "utf8"), Buffer.from("nexus-v3680-shopee-v1", "utf8"),
    Buffer.from("protected-source-fields", "utf8"), 32,
  ));
  const encryptedRows = payload.rows.map((row) => {
    const base = row.offer_key;
    return {
      offer_key: base,
      source_kind: row.source_kind,
      item_id_sha256: row.item_id ? sha256(row.item_id) : null,
      commission_rate_pct: row.commission_rate_pct,
      commission_ceiling_pct: row.commission_ceiling_pct,
      commission_brl: row.commission_brl,
      price_brl: row.price_brl,
      offer_period_start: row.offer_period_start,
      offer_period_end: row.offer_period_end,
      offer_type: row.offer_type,
      primary_host: row.primary_host,
      affiliate_host: row.affiliate_host,
      source_file: row.source_file,
      source_sha256: row.source_sha256,
      source_row_sha256: row.source_row_sha256,
      name_enc: seal(row.name, `${base}:name`, key),
      merchant_enc: seal(row.store, `${base}:merchant`, key),
      sales_label_enc: seal(row.sales_label, `${base}:sales_label`, key),
      primary_url_enc: seal(row.primary_url, `${base}:primary_url`, key),
      affiliate_url_enc: seal(row.affiliate_url, `${base}:affiliate_url`, key),
    };
  });
  const unique = new Set(encryptedRows.map((row) => row.offer_key));
  if (unique.size !== payload.row_count || encryptedRows.some((row) => !row.affiliate_url_enc || row.affiliate_host !== "s.shopee.com.br")) {
    throw new Error("encrypted_payload_invariant_failed");
  }
  const output = {
    schema_version: "v3680-encrypted-shopee-payload-1",
    encryption_profile: "AES-256-GCM; HKDF-SHA256; envelope-v1; per-field random IV; authenticated AAD",
    kms_key_name: "nexus_satellites_kms",
    row_count: payload.row_count,
    files: payload.files,
    rows: encryptedRows,
  };
  const descriptor = fs.openSync(outputPath, "w", 0o600);
  fs.writeFileSync(descriptor, JSON.stringify(output));
  fs.closeSync(descriptor);
  fs.chmodSync(outputPath, 0o600);
  key.fill(0);
  kms = "";
  process.stdout.write(JSON.stringify({ ok: true, rows: encryptedRows.length, plaintext_urls_written: false }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`v3680 encrypted payload build failed: ${error.message}\n`);
  process.exit(1);
});
