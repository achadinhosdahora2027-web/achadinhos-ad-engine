# Nexus v3680.0 — production release report

**Release:** Sovereign Target Alignment & Intent-Driven Yield Matrix v3680.0  
**Master project:** `etbxbaaaspdcoiakifbb`  
**Production result:** master SQL committed; master Edge function ACTIVE  
**Cross-account reach:** **1/14 verified with v3680**, not 14/14

## What was installed

- Permanent **LOGGED** `public.nexus_v3680_intent_target_matrix`: **27 operator-supplied zones**.
- `public.nexus_v3680_category_country_policy`: **10 category/country policies**.
- `public.nexus_v3680_network_readiness`: **14 country/network evidence rows**, seven currently fresh and ready.
- Physical `public.nexus_shopee_offers`: **701 immutable encrypted source rows**.
- Metadata-only RPC `public.nexus_v3680_resolve_target(...)`.
- Internal Edge function `nexus-target-alignment-v3680`, version 1, ACTIVE on the master.
- Transactional rollback migration and cumulative static tests.

The SQL migration ran inside one transaction with `statement_timeout='4000ms'`, `lock_timeout='1000ms'`, propagating PL/pgSQL exceptions and rollback-on-failure behavior. A full production dry run was executed and rolled back before the committed execution. A subsequent atomic catalog correction marked the resolver and operator-status functions `VOLATILE`, matching their wall-clock freshness semantics; final `pg_proc.provolatile` is `v` for both.

## Deployed target result

| Group | Supplied zones | Fresh route metadata | Fail closed |
|---|---:|---:|---:|
| Travel / hotels | 9 | 1 | 8 |
| Supplements / gamer / tech | 10 | 10 | 0 |
| Home utilities / utensils | 3 | 3 | 0 |
| Fashion / style / collectibles | 5 | 5 | 0 |
| **Total** | **27** | **19** | **8** |

“Fresh route metadata” means a current catalog or encrypted provider-binding check passed. It does **not** mean that a click, impression, publication, product-category selection, sale, city residence, buyer intent, or conversion was proven.

### Truthful provider boundaries

- **Booking UK:** one active, encrypted advertiser-matched catalog row was verified for **GB**. London is ready; Orlando, Miami, Fredericksburg, Madrid, Barcelona, Paris, Rome, and Milan remain fail closed for this requested Booking UK scope.
- **eBay:** 12 active campaign-matched US rows, 12 CA rows, and six GB rows were observed. The ten supplied US/CA tech zones have fresh metadata.
- **CJ:** the encrypted backlog remains evidence-only and contributes **zero approved routes**.
- **Shopee:** 701 encrypted source rows are physically present. This proves inventory storage, not utility-category classification or click readiness.
- **Mercado Livre:** the existing encrypted BR binding is present.
- **Shein BR:** the existing encrypted BR-only OneLink vault is present.
- **GB tech:** the country appeared in scope but no GB zone was supplied. The policy records zero zones and the resolver fails closed; none was invented.
- **Canada:** native currency is truthfully `CAD`. Because the requested yield set omitted CAD, `yield_currency_context` is null rather than falsely using USD.

## Zone evidence

- **22/27** zones were cross-checked against the existing v3340/v3360 catalogs.
- Brooklyn, Manhattan, Queens, and Bronx remain explicitly identified as operator-supplied boroughs that were not present in those catalogs.
- “Grande São Paulo (bairros metropolitanos)” remains one aggregate operator phrase. No neighborhood list was invented.

The full deployed matrix is in [`v3680-deployed-target-matrix.json`](./v3680-deployed-target-matrix.json), with a visual summary in [`v3680-target-alignment.svg`](./v3680-target-alignment.svg).

## Shopee source security

- Eight supplied CSVs remain preserved at mode `0600`; protected copies and their manifest remain in the protected store.
- Imported source identity: 500 product rows, 200 shop rows, one campaign row; 701 unique source rows and 463 unique product item hashes.
- Source URLs, titles, merchant names, and sales labels are independently sealed with **AES-256-GCM**, an HKDF-SHA256 context key, random per-field IVs, and authenticated AAD.
- The table has no plaintext source URL/title/merchant columns, direct client/service-role table reads are revoked, RLS is forced, and an immutable statement trigger rejects later inserts, updates, deletes, and truncation.
- An authenticated decryption round-trip checked all **701 × 5 protected fields** against the protected source; every value matched. No plaintext link or KMS value was written to evidence.
- The migration, repository additions, tests, reports, and status output contain no plaintext Shopee referral URL.

## Resolver and disclosure contract

The resolver requires:

1. one configured category key;
2. a CDN country header used only as a country hint;
3. an explicit zone that exactly normalizes to a supplied category/country zone;
4. the configured locale; and
5. fresh network metadata.

It returns neutral localized copy plus `#ad` outside Brazil or `#publi` in Brazil, with `disclosure_own_line=true`. It returns no affiliate URL and performs no redirect, click, impression, publication, or conversion action.

A CDN country header, `is_bot=false`, event activity, or an explicit category is never reported as proof of city, residence, humanity, or buyer intent.

## Protected runtime invariants

Post-deployment observations:

- `public.ads`: **14,301 rows**, **12,165 active**; no v3680 DML targets this table.
- Logical keywords: **17,605**.
- Stored vectors: **11,568**.
- Job 60: active, every ten seconds, unchanged command.
- Identified legacy polling jobs: zero active.
- Channel outbox remains UNLOGGED; legacy Telegram buffer remains closed; destination separation remains intact.
- `api/ads/go.js`, its correction copy, and `edge/jetstream/compose.ts` are byte-unchanged relative to the v3600 base. Existing Adsterra/Monetag placement wiring and the successful `/api/ads/go` binding-header implementation were not modified.

## Measured latency — no guarantee

| Scope | Samples | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|
| PostgreSQL resolver, one DB session | 200 | 0.282 ms | 0.424 ms | 0.714 ms | 5.873 ms |
| Sandbox → Supabase Edge → DB round trip | 30 | 412.617 ms | 459.260 ms | 669.966 ms | 755.684 ms |

The database sample measured below 0.93 ms at p50, but this is an observation, not a durable SLA. End-to-end behavior is not sub-50 ms. No anti-404 fallback was deployed because there is no verified final merchant URL plus measured fallback behavior.

## 14-account verification

The repeated all-or-nothing preflight reached **10 of 14 configured projects** and could not authenticate to four configured satellites. Satellite deployment was therefore not attempted. Post-deployment verification proves the v3680 database and Edge function only on the master: **1/14**. Continuous 24/7 execution and 14/14 deployment are not proven.

## Tests and rollback

- Full repository test suite: passed.
- v3680 static assertions: 701 encrypted rows, 27 target rows, no plaintext URL in migration, no ads DML, protected runtime files unchanged.
- Production SQL dry run: HTTP 201, transaction rolled back.
- Production SQL execution: HTTP 201, committed.
- Edge checks: GET 200, unauthorized POST 401, ready metadata case 200, fail-closed travel case 422.
- The v3680 Edge secret was rotated after deployment, revalidated with HTTP 200, and preserved only in mode-0600 protected storage.
- Final catalog verification: both wall-clock functions are `VOLATILE`, the Edge function is ACTIVE, and all eight supplied CSVs plus eight protected copies remain mode 0600.
- Rollback: [`rollback_v3680_target_alignment.sql`](../../supabase/migrations/rollback_v3680_target_alignment.sql).

## Radical-truth correction

Before v3680, master had no physical `public.nexus_shopee_offers` and no v3650 capability record. This release does not relabel that absence as prior v3650 completion: the encrypted inventory is recorded as installed by **v3680.0**.
