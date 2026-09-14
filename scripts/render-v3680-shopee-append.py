#!/usr/bin/env python3
"""Render the ciphertext-only 500-row Shopee source append and rollback."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = Path("/home/user/.v3370-protected/v3680-shopee-additional-encrypted.json")
MAIN = ROOT / "supabase/migrations/supabase_v3680_target_alignment.sql"
OUTPUT = ROOT / "supabase/migrations/supabase_v3680_shopee_source_append.sql"
ROLLBACK = ROOT / "supabase/migrations/rollback_v3680_shopee_source_append.sql"


def q(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def num(value):
    return "null" if value is None else str(value)


def bytea(value):
    return "null" if value is None else f"decode('{value}','hex')"


payload = json.loads(PAYLOAD.read_text())
assert payload["schema_version"] == "v3680-encrypted-shopee-payload-1"
assert payload["row_count"] == 500 and len(payload["rows"]) == 500
values = []
files = sorted({row["source_file"] for row in payload["rows"]})
assert len(files) == 5
for row in payload["rows"]:
    values.append("(" + ",".join([
        q(row["offer_key"]), q(row["source_kind"]), q(row["item_id_sha256"]),
        num(row["commission_rate_pct"]), num(row["commission_ceiling_pct"]),
        num(row["commission_brl"]), num(row["price_brl"]),
        q(row["offer_period_start"]), q(row["offer_period_end"]), q(row["offer_type"]),
        q(row["primary_host"]), q(row["affiliate_host"]), q(row["source_file"]),
        q(row["source_sha256"]), q(row["source_row_sha256"]),
        bytea(row["name_enc"]), bytea(row["merchant_enc"]), bytea(row["sales_label_enc"]),
        bytea(row["primary_url_enc"]), bytea(row["affiliate_url_enc"]),
    ]) + ")")

main = MAIN.read_text()
start = main.index("create or replace function public.nexus_v3680_refresh_network_readiness()")
end_marker = "revoke all on function public.nexus_v3680_refresh_network_readiness() from public,anon,authenticated,service_role;"
end = main.index(end_marker, start) + len(end_marker)
refresh_701 = main[start:end]
refresh_1201 = refresh_701.replace("v_n=701", "v_n=1201")
assert refresh_701 != refresh_1201 and "v_n=701" in refresh_701 and "v_n=1201" in refresh_1201
file_array = "array[" + ",".join(q(name) for name in files) + "]::text[]"

sql = f"""-- Nexus v3680.0 — encrypted append of five resupplied product batches.
-- The 500 rows below contain independent ciphertext envelopes only.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

do $guard$
begin
  if (select count(*) from public.nexus_shopee_offers)<>701 then raise exception 'v3680 append baseline row count';end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.nexus_shopee_offers'::regclass and tgname='trg_v3680_shopee_immutable' and tgenabled='O') then raise exception 'v3680 append immutable trigger absent';end if;
  if exists(select 1 from public.nexus_shopee_offers where source_file=any({file_array})) then raise exception 'v3680 append source already present';end if;
exception when others then raise;
end
$guard$;

drop trigger trg_v3680_shopee_immutable on public.nexus_shopee_offers;
insert into public.nexus_shopee_offers(
 offer_key,source_kind,item_id_sha256,commission_rate_pct,commission_ceiling_pct,commission_brl,price_brl,
 offer_period_start,offer_period_end,offer_type,primary_host,affiliate_host,source_file,source_sha256,source_row_sha256,
 name_enc,merchant_enc,sales_label_enc,primary_url_enc,affiliate_url_enc
) values
{',\n'.join(values)};
create trigger trg_v3680_shopee_immutable before insert or update or delete or truncate on public.nexus_shopee_offers
for each statement execute function public.nexus_v3680_reject_immutable_mutation();

{refresh_1201}
select public.nexus_v3680_refresh_network_readiness();
update public.nexus_v3600_route_readiness set route_ready=true,catalog_rows=1201,
 evidence_scope='v3680_encrypted_immutable_shopee_inventory',
 evidence_expires_at=(select min(evidence_expires_at) from public.nexus_shopee_offers),checked_at=clock_timestamp()
where country_code='BR' and network='shopee';
update public.nexus_v3000_capability_registry set enabled=true,
 evidence=evidence||jsonb_build_object('shopee_inventory_physically_present',true,'encrypted_source_rows',1201,'plaintext_affiliate_urls',false),
 checked_at=clock_timestamp() where capability='v3500_indexed_route_readiness';
insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3680_encrypted_shopee_inventory',true,jsonb_build_object('source_rows',1201,'product_rows',1000,'shop_rows',200,'campaign_rows',1,'unique_item_hashes',940,'plaintext_urls',false,'immutable',true),clock_timestamp()),
 ('v3680_shopee_source_append',true,jsonb_build_object('appended_source_rows',500,'appended_unique_item_hashes',500,'combined_source_rows',1201,'combined_unique_item_hashes',940,'overlapping_item_hashes',23,'plaintext_urls',false,'clicks_performed',false),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
begin
  if (select count(*) from public.nexus_shopee_offers)<>1201
     or (select count(*) from public.nexus_shopee_offers where source_kind='product')<>1000
     or (select count(*) from public.nexus_shopee_offers where source_kind='shop')<>200
     or (select count(*) from public.nexus_shopee_offers where source_kind='campaign')<>1 then raise exception 'v3680 append final source count';end if;
  if (select count(distinct item_id_sha256) from public.nexus_shopee_offers where source_kind='product')<>940 then raise exception 'v3680 append item hash count';end if;
  if (select count(*) from public.nexus_shopee_offers where source_file=any({file_array}))<>500 then raise exception 'v3680 append batch count';end if;
  if exists(select 1 from public.nexus_shopee_offers where affiliate_url_enc is null or affiliate_host<>'s.shopee.com.br' or get_byte(affiliate_url_enc,0)<>1) then raise exception 'v3680 append encryption invariant';end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.nexus_shopee_offers'::regclass and tgname='trg_v3680_shopee_immutable' and tgenabled='O') then raise exception 'v3680 append immutable trigger not restored';end if;
  if not exists(select 1 from public.nexus_v3680_network_readiness where country_code='BR' and network='shopee' and route_ready and route_catalog_rows=1201 and evidence_rows=1201 and evidence_expires_at>clock_timestamp()) then raise exception 'v3680 append readiness mismatch';end if;
  if (select count(*) from public.ads)<>14301 or (select count(*) from public.ads where active)<>12165 or (select count(*) from public.nexus_v370_keyword_source)<>17605 then raise exception 'v3680 append protected catalog changed';end if;
exception when others then raise;
end
$assert$;
commit;
"""
OUTPUT.write_text(sql)

rollback = f"""-- Nexus v3680.0 rollback for the five-batch encrypted source append.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
do $guard$
begin
 if (select count(*) from public.nexus_shopee_offers)<>1201 then raise exception 'v3680 append rollback baseline';end if;
 if (select count(*) from public.nexus_shopee_offers where source_file=any({file_array}))<>500 then raise exception 'v3680 append rollback source mismatch';end if;
exception when others then raise;
end
$guard$;
drop trigger trg_v3680_shopee_immutable on public.nexus_shopee_offers;
delete from public.nexus_shopee_offers where source_file=any({file_array});
create trigger trg_v3680_shopee_immutable before insert or update or delete or truncate on public.nexus_shopee_offers
for each statement execute function public.nexus_v3680_reject_immutable_mutation();
{refresh_701}
select public.nexus_v3680_refresh_network_readiness();
update public.nexus_v3600_route_readiness set route_ready=true,catalog_rows=701,
 evidence_scope='v3680_encrypted_immutable_shopee_inventory',evidence_expires_at=(select min(evidence_expires_at) from public.nexus_shopee_offers),checked_at=clock_timestamp()
where country_code='BR' and network='shopee';
update public.nexus_v3000_capability_registry set evidence=evidence||jsonb_build_object('encrypted_source_rows',701),checked_at=clock_timestamp() where capability='v3500_indexed_route_readiness';
update public.nexus_v3000_capability_registry set enabled=true,evidence=jsonb_build_object('source_rows',701,'product_rows',500,'shop_rows',200,'campaign_rows',1,'unique_item_hashes',463,'plaintext_urls',false,'immutable',true),checked_at=clock_timestamp() where capability='v3680_encrypted_shopee_inventory';
delete from public.nexus_v3000_capability_registry where capability='v3680_shopee_source_append';
do $assert$
begin
 if (select count(*) from public.nexus_shopee_offers)<>701 or (select count(distinct item_id_sha256) from public.nexus_shopee_offers where source_kind='product')<>463 then raise exception 'v3680 append rollback count';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.nexus_shopee_offers'::regclass and tgname='trg_v3680_shopee_immutable' and tgenabled='O') then raise exception 'v3680 append rollback trigger';end if;
exception when others then raise;
end
$assert$;
commit;
"""
ROLLBACK.write_text(rollback)
print(json.dumps({"ok": True, "encrypted_rows": len(values), "source_files": len(files), "plaintext_urls_written": False}))
