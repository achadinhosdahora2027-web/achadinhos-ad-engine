#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/supabase_v3680_target_alignment.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "supabase/migrations/rollback_v3680_target_alignment.sql"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase/functions/nexus-target-alignment-v3680/index.ts"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/v3680-shopee-source-manifest.json"), "utf8"));

assert.match(migration, /^begin;/m);
assert.match(migration, /set local statement_timeout='4000ms';/);
assert.match(migration, /set local lock_timeout='1000ms';/);
assert.match(migration, /exception when others then raise;/i);
assert.match(migration, /commit;\s*$/);
assert.match(rollback, /^begin;/m);
assert.match(rollback, /commit;\s*$/);

assert.match(migration, /create table public\.nexus_v3680_intent_target_matrix/);
assert.match(migration, /nexus_v3680_resolve_target\([\s\S]*?returns jsonb language plpgsql volatile security definer/);
assert.match(migration, /nexus_v3680_operator_status\(\)[\s\S]*?returns jsonb language plpgsql volatile security definer/);
assert.match(migration, /create table public\.nexus_shopee_offers/);
assert.match(migration, /alter table public\.nexus_shopee_offers force row level security/);
assert.match(migration, /trg_v3680_shopee_immutable/);
assert.match(migration, /AES-256-GCM; HKDF-SHA256/);
assert.doesNotMatch(migration, /https?:\/\//i, "migration must not contain a plaintext URL");
assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ads\b/i, "ads must remain read-only");
assert.doesNotMatch(migration, /\b(product_link|offer_link|trackable_link_short|affiliate_url|destination_url)\s+text\b/i);

const inventoryBlock = migration.match(/\) values\n([\s\S]+?);\n\ncreate table public\.nexus_v3680_category_country_policy/);
assert.ok(inventoryBlock, "encrypted inventory block missing");
assert.equal((inventoryBlock[1].match(/^\('/gm) || []).length, 701);
assert.doesNotMatch(inventoryBlock[1], /https?:\/\//i);
const matrixBlock = migration.match(/zone_evidence_scope,neutral_copy_template,disclosure_token\n\) values\n([\s\S]+?);\ncreate index nexus_v3680_target_lookup_idx/);
assert.ok(matrixBlock, "target matrix block missing");
assert.equal((matrixBlock[1].match(/^\(/gm) || []).length, 27);

assert.equal(manifest.total_rows, 701);
assert.equal(manifest.rows_by_kind.product, 500);
assert.equal(manifest.rows_by_kind.shop, 200);
assert.equal(manifest.rows_by_kind.campaign, 1);
assert.equal(manifest.unique_product_item_ids, 463);
assert.equal(manifest.plaintext_urls_versioned, false);
assert.equal(manifest.clicks_performed, false);

assert.match(migration, /'supplements_gamer_tech','GB',0,'GBP','GBP'/);
assert.doesNotMatch(matrixBlock[1], /'supplements_gamer_tech','GB'/);
assert.match(migration, /'CA','Toronto'.*'CAD',null/);
assert.match(migration, /'explicit_zone_required'/);
assert.match(migration, /'country_header_proves_city',false/);
assert.match(migration, /'is_bot_false_is_humanity_proof',false/);
assert.match(migration, /'fallback_deployed',false/);
assert.match(migration, /'projects_verified_with_v3680',1/);
assert.match(migration, /'#publi'/);
assert.match(migration, /'#ad'/);

assert.match(edge, /NEXUS_V3680_EDGE_SECRET/);
assert.match(edge, /NEXUS_MASTER_URL/);
assert.match(edge, /NEXUS_MASTER_SERVICE_ROLE_KEY/);
assert.match(edge, /single_master_no_catalog_replication/);
assert.match(edge, /explicit_category_and_zone_required/);
assert.match(edge, /delete route\.affiliate_url/);
assert.match(edge, /affiliate_url: null/);
assert.match(edge, /cdn_country_is_routing_hint_only: true/);
assert.match(edge, /is_bot_false_is_humanity_proof: false/);
assert.match(edge, /fallback_deployed: false/);
assert.doesNotMatch(edge, /headers:\s*\{[^}]*location\s*:/is, "Edge function must not redirect");

for (const protectedPath of ["api/ads/go.js", "correcoes/clique-comprovado/api/ads/go.js", "edge/jetstream/compose.ts"]) {
  cp.execFileSync("git", ["diff", "--quiet", "HEAD", "--", protectedPath], { cwd: root });
}

console.log(JSON.stringify({
  ok: true,
  release: "v3680.0",
  encrypted_inventory_rows: 701,
  target_rows: 27,
  protected_runtime_files_modified: false,
  plaintext_urls_in_migration: false,
  ads_dml_in_migration: false,
}));
