#!/usr/bin/env python3
"""Render the v3680 migration from the protected ciphertext-only payload."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = Path("/home/user/.v3370-protected/v3680-shopee-encrypted.json")
OUTPUT = ROOT / "supabase/migrations/supabase_v3680_target_alignment.sql"

def q(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"

def num(value):
    return "null" if value is None else str(value)

def arr(values):
    return "array[" + ",".join(q(v) for v in values) + "]::text[]"

def hexbyte(value):
    return "null" if value is None else f"decode('{value}','hex')"

payload = json.loads(PAYLOAD.read_text())
assert payload["schema_version"] == "v3680-encrypted-shopee-payload-1"
assert payload["row_count"] == 701 and len(payload["rows"]) == 701

inventory_values = []
for r in payload["rows"]:
    inventory_values.append("(" + ",".join([
        q(r["offer_key"]), q(r["source_kind"]), q(r["item_id_sha256"]),
        num(r["commission_rate_pct"]), num(r["commission_ceiling_pct"]),
        num(r["commission_brl"]), num(r["price_brl"]),
        q(r["offer_period_start"]), q(r["offer_period_end"]), q(r["offer_type"]),
        q(r["primary_host"]), q(r["affiliate_host"]), q(r["source_file"]),
        q(r["source_sha256"]), q(r["source_row_sha256"]),
        hexbyte(r["name_enc"]), hexbyte(r["merchant_enc"]), hexbyte(r["sales_label_enc"]),
        hexbyte(r["primary_url_enc"]), hexbyte(r["affiliate_url_enc"]),
    ]) + ")")

# category, country, supplied-zone count, native currency, yield context, networks, no-zone reason
policies = [
    ("travel_hotels", "US", 3, "USD", "USD", ["booking_uk"], None),
    ("travel_hotels", "GB", 1, "GBP", "GBP", ["booking_uk"], None),
    ("travel_hotels", "ES", 2, "EUR", "EUR", ["booking_uk"], None),
    ("travel_hotels", "FR", 1, "EUR", "EUR", ["booking_uk"], None),
    ("travel_hotels", "IT", 2, "EUR", "EUR", ["booking_uk"], None),
    ("supplements_gamer_tech", "US", 7, "USD", "USD", ["ebay_epn", "cj_backlog"], None),
    ("supplements_gamer_tech", "CA", 3, "CAD", None, ["ebay_epn", "cj_backlog"], None),
    ("supplements_gamer_tech", "GB", 0, "GBP", "GBP", ["ebay_epn", "cj_backlog"], "no_operator_supplied_zone"),
    ("home_utilities_utensils", "BR", 3, "BRL", "BRL", ["shopee", "mercadolivre"], None),
    ("fashion_style_collectibles", "BR", 5, "BRL", "BRL", ["shein_br"], None),
]
policy_values = ["(" + ",".join([q(c), q(country), str(count), q(native), q(yield_ctx), arr(networks), q(reason)]) + ")"
                 for c, country, count, native, yield_ctx, networks, reason in policies]

# id, category, country, display, canonical evidence, aliases, zone type, exact supplied,
# locale, native currency, yield context, networks, catalog sources, evidence scope, template
zones = []
def add(category, country, display, canonical, aliases, zone_type, exact, locale, native, yield_ctx,
        networks, sources, evidence, template):
    zones.append((len(zones)+1, category, country, display, canonical, aliases, zone_type, exact,
                  locale, native, yield_ctx, networks, sources, evidence, template))
travel_copy = {
    "en-US": "Travel options for %ZONE%. Check current availability, prices, and terms on the partner page.",
    "en-GB": "Travel options for %ZONE%. Check current availability, prices, and terms on the partner page.",
    "es-ES": "Opciones de viaje para %ZONE%. Consulta la disponibilidad, los precios y las condiciones actuales en la página del socio.",
    "fr-FR": "Options de voyage pour %ZONE%. Vérifiez les disponibilités, les prix et les conditions actuelles sur la page du partenaire.",
    "it-IT": "Opzioni di viaggio per %ZONE%. Verifica disponibilità, prezzi e condizioni attuali sulla pagina del partner.",
}
for country, name, canonical, aliases, locale, currency in [
    ("US","Orlando","Orlando",["Orlando"],"en-US","USD"),
    ("US","Miami","Miami",["Miami"],"en-US","USD"),
    ("US","Fredericksburg","Fredericksburg",["Fredericksburg"],"en-US","USD"),
    ("GB","London","London",["London","Londres"],"en-GB","GBP"),
    ("ES","Madrid","Madrid",["Madrid"],"es-ES","EUR"),
    ("ES","Barcelona","Barcelona",["Barcelona"],"es-ES","EUR"),
    ("FR","Paris","Paris",["Paris"],"fr-FR","EUR"),
    ("IT","Rome","Roma",["Rome","Roma"],"it-IT","EUR"),
    ("IT","Milan","Milano",["Milan","Milano"],"it-IT","EUR"),
]:
    add("travel_hotels", country, name, canonical, aliases, "city", True, locale, currency, currency,
        ["booking_uk"], ["nexus_v3340_travel_lexicon"], "cross_checked_existing_catalog", travel_copy[locale])

tech_us = "Current supplements, gaming, and technology options related to %ZONE%. Verify price, availability, and terms on the merchant page."
tech_ca_en = "Current supplements, gaming, and technology options related to %ZONE%. Verify price, availability, currency, and terms on the merchant page."
tech_ca_fr = "Options actuelles de suppléments, de jeux vidéo et de technologie liées à %ZONE%. Vérifiez le prix, la disponibilité, la devise et les conditions sur la page du marchand."
for name, sources, evidence in [
    ("Brooklyn", [], "operator_supplied_zone_not_catalog_cross_checked"),
    ("Manhattan", [], "operator_supplied_zone_not_catalog_cross_checked"),
    ("Queens", [], "operator_supplied_zone_not_catalog_cross_checked"),
    ("Bronx", [], "operator_supplied_zone_not_catalog_cross_checked"),
    ("Los Angeles", ["nexus_v3340_travel_lexicon"], "cross_checked_existing_catalog"),
    ("San Diego", ["nexus_v3340_travel_lexicon"], "cross_checked_existing_catalog"),
    ("San Jose", ["nexus_v3340_travel_lexicon"], "cross_checked_existing_catalog"),
]:
    add("supplements_gamer_tech", "US", name, name, [name], "borough" if name in {"Brooklyn","Manhattan","Queens","Bronx"} else "city", True,
        "en-US", "USD", "USD", ["ebay_epn","cj_backlog"], sources, evidence, tech_us)
for name, aliases, locale, copy in [
    ("Toronto", ["Toronto"], "en-CA", tech_ca_en),
    ("Montreal", ["Montreal","Montréal"], "fr-CA", tech_ca_fr),
    ("Ottawa", ["Ottawa"], "en-CA", tech_ca_en),
]:
    add("supplements_gamer_tech", "CA", name, name, aliases, "city", True, locale, "CAD", None,
        ["ebay_epn","cj_backlog"], ["nexus_v3340_travel_lexicon"], "cross_checked_existing_catalog", copy)

home_copy = "Opções atuais de utilidades domésticas e utensílios relacionadas a %ZONE%. Confira preço, disponibilidade e condições na página do parceiro."
add("home_utilities_utensils", "BR", "Grande São Paulo (bairros metropolitanos)", "Grande São Paulo (bairros metropolitanos)",
    ["Grande São Paulo (bairros metropolitanos)"], "operator_aggregate", False, "pt-BR", "BRL", "BRL",
    ["shopee","mercadolivre"], [], "aggregate_phrase_only_no_neighborhood_list_supplied", home_copy)
for name in ["Santos", "Campinas"]:
    add("home_utilities_utensils", "BR", name, name, [name], "city", True, "pt-BR", "BRL", "BRL",
        ["shopee","mercadolivre"], ["nexus_v3360_city_delta"], "cross_checked_existing_catalog", home_copy)

fashion_copy = "Opções atuais de moda, estilo e colecionáveis relacionadas a %ZONE%. Confira preço, disponibilidade e condições na página do parceiro."
for name, aliases in [
    ("Rio de Janeiro", ["Rio de Janeiro","Rio"]), ("Salvador", ["Salvador"]),
    ("Brasília", ["Brasília","Brasilia"]), ("Fortaleza", ["Fortaleza"]),
    ("Belo Horizonte", ["Belo Horizonte"]),
]:
    sources = ["nexus_v3360_city_delta"] if name != "Rio de Janeiro" else ["nexus_v3340_travel_lexicon","nexus_v3360_city_delta"]
    add("fashion_style_collectibles", "BR", name, name, aliases, "city", True, "pt-BR", "BRL", "BRL",
        ["shein_br"], sources, "cross_checked_existing_catalog", fashion_copy)
assert len(zones) == 27
zone_values = []
for z in zones:
    (idx, category, country, display, canonical, aliases, zone_type, exact, locale, native, yield_ctx,
     networks, sources, evidence, template) = z
    zone_values.append("(" + ",".join([
        str(idx), q(category), q(country), q(display), q(canonical), arr(aliases), q(zone_type),
        "true" if exact else "false", q(locale), q(native), q(yield_ctx), arr(networks), arr(sources),
        q(evidence), q(template), q("#publi" if country == "BR" else "#ad")
    ]) + ")")

sql = f"""-- Nexus v3680.0 — Sovereign Target Alignment & Intent-Driven Yield Matrix
-- Additive, fail-closed, metadata-only routing. No redirect, click, impression,
-- publication, conversion or proof-of-humanity is created by this migration.
-- The 701 Shopee source rows below contain independently sealed ciphertext only;
-- no source URL, title, merchant name, sales label, KMS value or provider secret
-- is versioned in plaintext.

begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

create temp table pg_temp.nexus_v3680_protected_baseline on commit drop as
select (select count(*) from public.ads) ads_rows,
       (select count(*) from public.ads where active) active_ads_rows,
       (select count(*) from public.nexus_v370_keyword_source) keyword_rows,
       (select count(*) from public.nexus_v380_keyword_vectors) vector_rows;

create table public.nexus_shopee_offers(
  offer_key text primary key check(offer_key~'^[0-9a-f]{{64}}$'),
  source_kind text not null check(source_kind in('product','shop','campaign')),
  item_id_sha256 text check(item_id_sha256 is null or item_id_sha256~'^[0-9a-f]{{64}}$'),
  commission_rate_pct numeric(8,2) check(commission_rate_pct is null or commission_rate_pct between 0 and 100),
  commission_ceiling_pct numeric(8,2) check(commission_ceiling_pct is null or commission_ceiling_pct between 0 and 100),
  commission_brl numeric(18,2) check(commission_brl is null or commission_brl>=0),
  price_brl numeric(18,2) check(price_brl is null or price_brl>=0),
  offer_period_start date,
  offer_period_end date,
  offer_type text,
  primary_host text check(primary_host is null or primary_host in('shopee.com.br','www.shopee.com.br')),
  affiliate_host text not null check(affiliate_host='s.shopee.com.br'),
  source_file text not null check(position('/' in source_file)=0 and position(chr(92) in source_file)=0),
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{{64}}$'),
  source_row_sha256 text not null unique check(source_row_sha256~'^[0-9a-f]{{64}}$'),
  name_enc bytea not null check(octet_length(name_enc)>=30 and get_byte(name_enc,0)=1),
  merchant_enc bytea check(merchant_enc is null or (octet_length(merchant_enc)>=30 and get_byte(merchant_enc,0)=1)),
  sales_label_enc bytea check(sales_label_enc is null or (octet_length(sales_label_enc)>=30 and get_byte(sales_label_enc,0)=1)),
  primary_url_enc bytea check(primary_url_enc is null or (octet_length(primary_url_enc)>=30 and get_byte(primary_url_enc,0)=1)),
  affiliate_url_enc bytea not null check(octet_length(affiliate_url_enc)>=30 and get_byte(affiliate_url_enc,0)=1),
  encryption_profile text not null default 'AES-256-GCM; HKDF-SHA256; envelope-v1; per-field random IV; authenticated AAD',
  kms_key_name text not null default 'nexus_satellites_kms' check(kms_key_name='nexus_satellites_kms'),
  aad_profile text not null default 'offer_key:field_name',
  source_current_at_ingest boolean not null default true,
  imported_at timestamptz not null default clock_timestamp(),
  evidence_expires_at timestamptz not null default (clock_timestamp()+interval '7 days'),
  installed_by_release text not null default 'v3680.0' check(installed_by_release='v3680.0'),
  check(offer_period_end is null or offer_period_start is null or offer_period_end>=offer_period_start),
  check((source_kind='campaign' and primary_url_enc is null) or source_kind<>'campaign')
);
comment on table public.nexus_shopee_offers is 'Immutable encrypted Shopee source inventory. No plaintext source URL or descriptive source field is stored.';
create index nexus_shopee_offers_kind_idx on public.nexus_shopee_offers(source_kind,evidence_expires_at);
create index nexus_shopee_offers_item_hash_idx on public.nexus_shopee_offers(item_id_sha256) where item_id_sha256 is not null;
revoke all on table public.nexus_shopee_offers from public,anon,authenticated,service_role;
alter table public.nexus_shopee_offers enable row level security;
alter table public.nexus_shopee_offers force row level security;

insert into public.nexus_shopee_offers(
 offer_key,source_kind,item_id_sha256,commission_rate_pct,commission_ceiling_pct,commission_brl,price_brl,
 offer_period_start,offer_period_end,offer_type,primary_host,affiliate_host,source_file,source_sha256,source_row_sha256,
 name_enc,merchant_enc,sales_label_enc,primary_url_enc,affiliate_url_enc
) values
{',\n'.join(inventory_values)};

create table public.nexus_v3680_category_country_policy(
  category_key text not null,
  country_code text not null check(country_code~'^[A-Z]{{2}}$'),
  supplied_zone_count smallint not null check(supplied_zone_count>=0),
  country_native_currency text not null check(country_native_currency~'^[A-Z]{{3}}$'),
  yield_currency_context text check(yield_currency_context is null or yield_currency_context in('BRL','USD','GBP','EUR')),
  requested_networks text[] not null check(cardinality(requested_networks)>0),
  no_zone_reason text,
  installed_by_release text not null default 'v3680.0',
  primary key(category_key,country_code),
  check((supplied_zone_count=0)=(no_zone_reason is not null))
);
insert into public.nexus_v3680_category_country_policy(category_key,country_code,supplied_zone_count,country_native_currency,yield_currency_context,requested_networks,no_zone_reason) values
{',\n'.join(policy_values)};

create table public.nexus_v3680_intent_target_matrix(
  target_id smallint primary key,
  category_key text not null,
  country_code text not null check(country_code~'^[A-Z]{{2}}$'),
  target_zone text not null,
  catalog_canonical text not null,
  aliases text[] not null check(cardinality(aliases)>0),
  zone_key text generated always as (public.nexus_v3340_norm(target_zone)) stored,
  zone_type text not null check(zone_type in('city','borough','operator_aggregate')),
  exact_subzone_supplied boolean not null,
  primary_locale text not null,
  country_native_currency text not null,
  yield_currency_context text,
  requested_networks text[] not null check(cardinality(requested_networks)>0),
  catalog_evidence_sources text[] not null,
  zone_evidence_scope text not null,
  neutral_copy_template text not null check(position('%ZONE%' in neutral_copy_template)>0),
  disclosure_token text not null check(disclosure_token in('#ad','#publi')),
  disclosure_own_line_before_link boolean not null default true check(disclosure_own_line_before_link),
  cdn_country_is_routing_hint_only boolean not null default true check(cdn_country_is_routing_hint_only),
  zone_residence_or_humanity_proven boolean not null default false check(not zone_residence_or_humanity_proven),
  installed_by_release text not null default 'v3680.0',
  unique(category_key,country_code,zone_key),
  foreign key(category_key,country_code) references public.nexus_v3680_category_country_policy(category_key,country_code)
);
insert into public.nexus_v3680_intent_target_matrix(
 target_id,category_key,country_code,target_zone,catalog_canonical,aliases,zone_type,exact_subzone_supplied,
 primary_locale,country_native_currency,yield_currency_context,requested_networks,catalog_evidence_sources,
 zone_evidence_scope,neutral_copy_template,disclosure_token
) values
{',\n'.join(zone_values)};
create index nexus_v3680_target_lookup_idx on public.nexus_v3680_intent_target_matrix(category_key,country_code,zone_key)
 include(target_id,primary_locale,country_native_currency,disclosure_token);
revoke all on table public.nexus_v3680_category_country_policy,public.nexus_v3680_intent_target_matrix from public,anon,authenticated,service_role;

create table public.nexus_v3680_network_readiness(
  country_code text not null check(country_code~'^[A-Z]{{2}}$'),
  network text not null,
  route_ready boolean not null,
  route_catalog_rows integer not null check(route_catalog_rows>=0),
  evidence_rows integer not null check(evidence_rows>=0),
  evidence_scope text not null,
  evidence_expires_at timestamptz not null,
  checked_at timestamptz not null default clock_timestamp(),
  primary key(country_code,network)
);
create index nexus_v3680_network_readiness_idx on public.nexus_v3680_network_readiness(country_code,network,evidence_expires_at)
 include(route_ready,route_catalog_rows);
revoke all on table public.nexus_v3680_network_readiness from public,anon,authenticated,service_role;

create or replace function public.nexus_v3680_refresh_network_readiness()
returns void language plpgsql security definer set search_path='public','extensions','pg_temp'
as $function$
declare v_kms text;v_campaign text;v_aid text;v_n integer;v_backlog integer;v_meta jsonb;v_exp timestamptz;r record;
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms' and length(btrim(value))>=16;
  select extensions.pgp_sym_decrypt(decode(value,'hex'),v_kms)::jsonb->>'campaign_id' into strict v_campaign from public.nexus_growth_secrets where key='ebay_campaign_id_enc';
  for r in select * from (values('US','www.ebay.com'),('CA','www.ebay.ca'),('GB','www.ebay.co.uk'))x(country_code,host) loop
    select count(*) into v_n from public.ads where active and advertiser ilike '%ebay%'
      and lower(substring(click_url from '^https?://([^/]+)'))=r.host and position(v_campaign in click_url)>0;
    insert into public.nexus_v3680_network_readiness values(r.country_code,'ebay_epn',v_n>0,v_n,v_n,'encrypted_campaign_match_and_active_country_host_catalog_metadata',clock_timestamp()+interval '7 days',clock_timestamp())
    on conflict(country_code,network) do update set route_ready=excluded.route_ready,route_catalog_rows=excluded.route_catalog_rows,evidence_rows=excluded.evidence_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  end loop;
  select extensions.pgp_sym_decrypt(decode(value,'hex'),v_kms)::jsonb->>'aid' into strict v_aid from public.nexus_growth_secrets where key='booking_uk_id_enc';
  for r in select * from (values('US'),('GB'),('ES'),('FR'),('IT'))x(country_code) loop
    if r.country_code='GB' then
      select count(*) into v_n from public.ads where active and advertiser='Booking.com United Kingdom' and cj_link_id=v_aid;
    else v_n:=0; end if;
    insert into public.nexus_v3680_network_readiness values(r.country_code,'booking_uk',v_n>0,v_n,v_n,
      case when r.country_code='GB' then 'encrypted_advertiser_match_and_active_catalog_metadata' else 'booking_uk_not_verified_for_requested_country' end,
      clock_timestamp()+interval '7 days',clock_timestamp())
    on conflict(country_code,network) do update set route_ready=excluded.route_ready,route_catalog_rows=excluded.route_catalog_rows,evidence_rows=excluded.evidence_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  end loop;
  for r in select * from (values('US'),('CA'),('GB'))x(country_code) loop
    select count(*) into v_backlog from public.nexus_v3380_cj_global_vault where backlog_sealed and country_code=r.country_code;
    insert into public.nexus_v3680_network_readiness values(r.country_code,'cj_backlog',false,0,v_backlog,'sealed_backlog_is_not_route_approval',clock_timestamp()+interval '1 day',clock_timestamp())
    on conflict(country_code,network) do update set route_ready=false,route_catalog_rows=0,evidence_rows=excluded.evidence_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  end loop;
  select count(*),min(evidence_expires_at) into v_n,v_exp from public.nexus_shopee_offers where installed_by_release='v3680.0' and affiliate_url_enc is not null;
  insert into public.nexus_v3680_network_readiness values('BR','shopee',v_n=701 and v_exp>clock_timestamp(),case when v_n=701 then v_n else 0 end,v_n,'encrypted_immutable_inventory_source_rows',coalesce(v_exp,clock_timestamp()),clock_timestamp())
  on conflict(country_code,network) do update set route_ready=excluded.route_ready,route_catalog_rows=excluded.route_catalog_rows,evidence_rows=excluded.evidence_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  v_meta:=public.nexus_v3500_route_readiness('{{"CF-IPCountry":"BR"}}'::jsonb,'mercadolivre','pt-BR','travel');
  insert into public.nexus_v3680_network_readiness values('BR','mercadolivre',coalesce((v_meta->>'route_ready')::boolean,false),case when coalesce((v_meta->>'route_ready')::boolean,false) then 1 else 0 end,case when coalesce((v_meta->>'route_ready')::boolean,false) then 1 else 0 end,'v3500_encrypted_br_tracking_binding_metadata',clock_timestamp()+interval '7 days',clock_timestamp())
  on conflict(country_code,network) do update set route_ready=excluded.route_ready,route_catalog_rows=excluded.route_catalog_rows,evidence_rows=excluded.evidence_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  select count(*) into v_n from public.nexus_shein_campaign_vault where referral_url_enc is not null and provisioned_scope='BR_ONLY_UNTIL_REGIONAL_VALIDATION';
  insert into public.nexus_v3680_network_readiness values('BR','shein_br',v_n>0,v_n,v_n,'encrypted_br_only_onelink_vault_metadata',clock_timestamp()+interval '7 days',clock_timestamp())
  on conflict(country_code,network) do update set route_ready=excluded.route_ready,route_catalog_rows=excluded.route_catalog_rows,evidence_rows=excluded.evidence_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  v_kms:=null;v_campaign:=null;v_aid:=null;v_meta:=null;
exception when others then v_kms:=null;v_campaign:=null;v_aid:=null;v_meta:=null;raise;
end
$function$;
revoke all on function public.nexus_v3680_refresh_network_readiness() from public,anon,authenticated,service_role;
select public.nexus_v3680_refresh_network_readiness();

create or replace function public.nexus_v3680_resolve_target(
  p_headers jsonb,p_category text,p_explicit_zone text,p_locale text default null
) returns jsonb language plpgsql volatile security definer set search_path='public','pg_temp'
as $function$
declare v_country text;v_count integer;v_category text;v_zone_key text;v_locale text;v_ready_networks text[];v_route_rows integer;v_exp timestamptz;v_copy text;m public.nexus_v3680_intent_target_matrix%rowtype;p public.nexus_v3680_category_country_policy%rowtype;
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  begin
    if p_headers is null or jsonb_typeof(p_headers)<>'object' then
      return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','headers_invalid','affiliate_url',null);
    end if;
    select count(distinct upper(btrim(value))),min(upper(btrim(value))) into v_count,v_country from jsonb_each_text(p_headers)
      where lower(key) in('cf-ipcountry','x-vercel-ip-country') and btrim(value)<>'';
    if v_count>1 then return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','country_headers_conflict','affiliate_url',null,'human_or_residential_proven',false);end if;
    if v_country is null or v_country!~'^[A-Z]{{2}}$' or v_country in('XX','T1') then return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','cdn_country_unavailable','affiliate_url',null);end if;
    v_category:=lower(btrim(coalesce(p_category,'')));
    if v_category not in('travel_hotels','supplements_gamer_tech','home_utilities_utensils','fashion_style_collectibles') then
      return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','explicit_supported_category_required','country',v_country,'affiliate_url',null);
    end if;
    select * into p from public.nexus_v3680_category_country_policy where category_key=v_category and country_code=v_country;
    if not found then return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','category_country_not_supplied','country',v_country,'affiliate_url',null);end if;
    if p.supplied_zone_count=0 then return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo',p.no_zone_reason,'country',v_country,'category',v_category,'affiliate_url',null);end if;
    if p_explicit_zone is null or length(btrim(p_explicit_zone)) not between 2 and 120 then return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','explicit_zone_required','country',v_country,'affiliate_url',null);end if;
    v_zone_key:=public.nexus_v3340_norm(p_explicit_zone);
    select x.* into m from public.nexus_v3680_intent_target_matrix x where x.category_key=v_category and x.country_code=v_country
      and exists(select 1 from unnest(x.aliases)a where public.nexus_v3340_norm(a)=v_zone_key) limit 1;
    if not found then return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','zone_not_in_supplied_category_country_matrix','country',v_country,'category',v_category,'affiliate_url',null);end if;
    v_locale:=coalesce(nullif(btrim(p_locale),''),m.primary_locale);
    if lower(v_locale)<>lower(m.primary_locale) then return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','locale_not_configured_for_target','country',v_country,'target_zone',m.target_zone,'affiliate_url',null);end if;
    select coalesce(array_agg(n.network order by array_position(m.requested_networks,n.network))filter(where n.route_ready and n.evidence_expires_at>clock_timestamp()),array[]::text[]),
           coalesce(sum(n.route_catalog_rows)filter(where n.route_ready and n.evidence_expires_at>clock_timestamp()),0)::integer,
           min(n.evidence_expires_at)filter(where n.route_ready and n.evidence_expires_at>clock_timestamp())
      into v_ready_networks,v_route_rows,v_exp from public.nexus_v3680_network_readiness n
      where n.country_code=m.country_code and n.network=any(m.requested_networks);
    v_copy:=replace(m.neutral_copy_template,'%ZONE%',m.target_zone);
    return jsonb_build_object('version','v3680.0','estado',case when cardinality(v_ready_networks)>0 then 'ok' else 'Sintonizado em Análise' end,
      'motivo',case when cardinality(v_ready_networks)>0 then 'explicit_zone_and_fresh_network_metadata' else 'verified_route_unavailable' end,
      'category',m.category_key,'country',m.country_code,'target_zone',m.target_zone,'zone_type',m.zone_type,
      'zone_evidence_scope',m.zone_evidence_scope,'zone_catalog_cross_checked',cardinality(m.catalog_evidence_sources)>0,
      'locale',v_locale,'country_native_currency',m.country_native_currency,'yield_currency_context',m.yield_currency_context,
      'available_networks',v_ready_networks,'route_catalog_rows',v_route_rows,'network_evidence_expires_at',v_exp,
      'content_copy',v_copy,'disclosure_required_before_link',m.disclosure_token,'disclosure_own_line',true,
      'affiliate_url',null,'redirect_performed',false,'click_recorded',false,'impression_recorded',false,'publication_claimed',false,
      'sale_or_conversion_claimed',false,'yield_estimate',null,'fallback_deployed',false,'final_merchant_url_verified_for_fallback',false,
      'behavior_measured_for_fallback',false,'cdn_country_is_routing_hint',true,'country_header_proves_city',false,
      'explicit_category_is_buyer_intent_proof',false,'zone_residence_proven',false,'human_or_residential_proven',false,
      'is_bot_false_is_humanity_proof',false,'continuous_24x7_proven',false,'sub_1ms_guaranteed',false,'sub_50ms_fallback_guaranteed',false);
  exception when others then
    return jsonb_build_object('version','v3680.0','estado','Sintonizado em Análise','motivo','resolver_exception','affiliate_url',null,'human_or_residential_proven',false);
  end;
end
$function$;
revoke all on function public.nexus_v3680_resolve_target(jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3680_resolve_target(jsonb,text,text,text) to service_role;

create or replace function public.nexus_v3680_operator_status()
returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp'
as $function$
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  return jsonb_build_object('version','v3680.0','observed_at',clock_timestamp(),
    'target_matrix_rows',(select count(*) from public.nexus_v3680_intent_target_matrix),
    'category_country_policies',(select count(*) from public.nexus_v3680_category_country_policy),
    'catalog_cross_checked_zones',(select count(*) from public.nexus_v3680_intent_target_matrix where cardinality(catalog_evidence_sources)>0),
    'operator_only_or_aggregate_zones',(select count(*) from public.nexus_v3680_intent_target_matrix where cardinality(catalog_evidence_sources)=0),
    'targets_with_fresh_route',(select count(*) from public.nexus_v3680_intent_target_matrix m where exists(select 1 from public.nexus_v3680_network_readiness n where n.country_code=m.country_code and n.network=any(m.requested_networks) and n.route_ready and n.evidence_expires_at>clock_timestamp())),
    'encrypted_shopee_rows',(select count(*) from public.nexus_shopee_offers),'plaintext_source_columns',0,
    'ads_rows',(select count(*) from public.ads),'active_ads_rows',(select count(*) from public.ads where active),
    'keyword_rows',(select count(*) from public.nexus_v370_keyword_source),'vector_rows',(select count(*) from public.nexus_v380_keyword_vectors),
    'job_60',(select jsonb_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobid=60),
    'deployment_reach',jsonb_build_object('configured_projects',14,'projects_verified_with_v3680',1,'master_database_deployed',true,'all_14_proven',false),
    'claims',jsonb_build_object('placements_modified',false,'go_js_modified',false,'compose_or_copywriter_modified',false,
      'affiliate_url_returned',false,'redirect_deployed',false,'programmatic_clicks',false,'fallback_deployed',false,
      'cdn_country_proves_city',false,'is_bot_false_proves_humanity',false,'continuous_24x7_proven',false,
      'sub_1ms_guaranteed',false,'sub_50ms_fallback_guaranteed',false,'sales_claimed',false));
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3680_operator_status() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3680_operator_status() to service_role;

create or replace function public.nexus_v3680_reject_immutable_mutation()
returns trigger language plpgsql set search_path='public','pg_temp' as $function$
begin raise exception 'v3680 immutable relation % rejects %',tg_table_name,tg_op using errcode='55000';end
$function$;
revoke all on function public.nexus_v3680_reject_immutable_mutation() from public,anon,authenticated,service_role;
create trigger trg_v3680_shopee_immutable before insert or update or delete or truncate on public.nexus_shopee_offers
for each statement execute function public.nexus_v3680_reject_immutable_mutation();
create trigger trg_v3680_matrix_immutable before insert or update or delete or truncate on public.nexus_v3680_intent_target_matrix
for each statement execute function public.nexus_v3680_reject_immutable_mutation();
create trigger trg_v3680_policy_immutable before insert or update or delete or truncate on public.nexus_v3680_category_country_policy
for each statement execute function public.nexus_v3680_reject_immutable_mutation();

update public.nexus_v3600_route_readiness set route_ready=true,catalog_rows=701,evidence_scope='v3680_encrypted_immutable_shopee_inventory',
 evidence_expires_at=(select min(evidence_expires_at) from public.nexus_shopee_offers),checked_at=clock_timestamp()
where country_code='BR' and network='shopee';
update public.nexus_v3000_capability_registry set enabled=true,
 evidence=evidence||jsonb_build_object('shopee_inventory_physically_present',true,'encrypted_source_rows',701,'plaintext_affiliate_urls',false),checked_at=clock_timestamp()
where capability='v3500_indexed_route_readiness';
insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3680_intent_target_matrix',true,jsonb_build_object('zones',27,'catalog_cross_checked',22,'operator_only_or_aggregate',5,'gb_tech_supplied_zones',0),clock_timestamp()),
 ('v3680_encrypted_shopee_inventory',true,jsonb_build_object('source_rows',701,'product_rows',500,'shop_rows',200,'campaign_rows',1,'unique_item_hashes',463,'plaintext_urls',false,'immutable',true),clock_timestamp()),
 ('v3680_metadata_only_resolver',true,jsonb_build_object('affiliate_url_returned',false,'redirect_performed',false,'country_header_is_hint_only',true,'explicit_zone_required',true),clock_timestamp()),
 ('v3680_predecessor_premise_correction',true,jsonb_build_object('v3650_capability_found_before_install',false,'v3650_physical_shopee_table_found_before_install',false,'inventory_installed_by','v3680.0'),clock_timestamp()),
 ('v3680_verified_fallback',false,jsonb_build_object('reason','no verified final merchant URL plus measured behavior','sub_50ms_guaranteed',false),clock_timestamp()),
 ('v3680_all_14_accounts_active',false,jsonb_build_object('configured_projects',14,'projects_verified_with_v3680',1,'master_only',true),clock_timestamp()),
 ('v3680_continuous_runtime',false,jsonb_build_object('reason','bounded Edge invocation is not continuous execution'),clock_timestamp()),
 ('v3680_programmatic_affiliate_clicks',false,jsonb_build_object('clicks_performed',false,'simulated_clicks',false),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare v_p "char";v_ads integer;v_active integer;v_route_targets integer;
begin
  select ads_rows,active_ads_rows into v_ads,v_active from pg_temp.nexus_v3680_protected_baseline;
  if v_ads<>14301 or v_active<>12165 or (select count(*) from public.ads)<>v_ads or (select count(*) from public.ads where active)<>v_active then raise exception 'v3680 protected ads invariant';end if;
  if (select count(*) from public.nexus_v370_keyword_source)<>(select keyword_rows from pg_temp.nexus_v3680_protected_baseline) or (select count(*) from public.nexus_v370_keyword_source)<>17605 then raise exception 'v3680 keyword invariant';end if;
  if (select count(*) from public.nexus_v380_keyword_vectors)<>(select vector_rows from pg_temp.nexus_v3680_protected_baseline) or (select count(*) from public.nexus_v380_keyword_vectors)<>11568 then raise exception 'v3680 vector invariant';end if;
  if (select count(*) from public.nexus_shopee_offers)<>701 or (select count(*) from public.nexus_shopee_offers where source_kind='product')<>500 or (select count(*) from public.nexus_shopee_offers where source_kind='shop')<>200 or (select count(*) from public.nexus_shopee_offers where source_kind='campaign')<>1 then raise exception 'v3680 Shopee source count';end if;
  if (select count(distinct item_id_sha256) from public.nexus_shopee_offers where source_kind='product')<>463 then raise exception 'v3680 Shopee item hash count';end if;
  if exists(select 1 from public.nexus_shopee_offers where affiliate_url_enc is null or affiliate_host<>'s.shopee.com.br' or get_byte(affiliate_url_enc,0)<>1) then raise exception 'v3680 Shopee encryption invariant';end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='nexus_shopee_offers' and column_name in('product_link','offer_link','trackable_link_short','affiliate_url','destination_url','item_name','merchant_name')) then raise exception 'v3680 plaintext source column';end if;
  if (select count(*) from public.nexus_v3680_intent_target_matrix)<>27 or (select count(*) from public.nexus_v3680_category_country_policy)<>10 then raise exception 'v3680 target count';end if;
  if (select count(*) from public.nexus_v3680_intent_target_matrix where cardinality(catalog_evidence_sources)>0)<>22 or (select count(*) from public.nexus_v3680_intent_target_matrix where cardinality(catalog_evidence_sources)=0)<>5 then raise exception 'v3680 zone evidence count';end if;
  if not exists(select 1 from public.nexus_v3680_category_country_policy where category_key='supplements_gamer_tech' and country_code='GB' and supplied_zone_count=0 and no_zone_reason='no_operator_supplied_zone') or exists(select 1 from public.nexus_v3680_intent_target_matrix where category_key='supplements_gamer_tech' and country_code='GB') then raise exception 'v3680 GB tech zone invention';end if;
  if (select count(*) from public.nexus_v3680_network_readiness)<>14 or (select count(*) from public.nexus_v3680_network_readiness where route_ready and evidence_expires_at>clock_timestamp())<>7 then raise exception 'v3680 network readiness count';end if;
  select count(*) into v_route_targets from public.nexus_v3680_intent_target_matrix m where exists(select 1 from public.nexus_v3680_network_readiness n where n.country_code=m.country_code and n.network=any(m.requested_networks) and n.route_ready and n.evidence_expires_at>clock_timestamp());
  if v_route_targets<>19 then raise exception 'v3680 route target count %',v_route_targets;end if;
  select relpersistence into v_p from pg_class where oid='public.nexus_v3680_intent_target_matrix'::regclass;if v_p<>'p'::"char" then raise exception 'v3680 matrix not LOGGED';end if;
  select relpersistence into v_p from pg_class where oid='public.nexus_shopee_offers'::regclass;if v_p<>'p'::"char" then raise exception 'v3680 inventory not LOGGED';end if;
  if has_table_privilege('anon','public.nexus_shopee_offers','select') or has_table_privilege('authenticated','public.nexus_shopee_offers','select') or has_table_privilege('service_role','public.nexus_shopee_offers','select') then raise exception 'v3680 inventory exposed';end if;
  if has_function_privilege('anon','public.nexus_v3680_resolve_target(jsonb,text,text,text)','execute') or has_function_privilege('authenticated','public.nexus_v3680_resolve_target(jsonb,text,text,text)','execute') or not has_function_privilege('service_role','public.nexus_v3680_resolve_target(jsonb,text,text,text)','execute') then raise exception 'v3680 resolver ACL';end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.nexus_shopee_offers'::regclass and tgname='trg_v3680_shopee_immutable' and tgenabled='O') then raise exception 'v3680 inventory immutability trigger';end if;
  if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);') then raise exception 'v3680 Job 60 changed';end if;
  if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active) then raise exception 'v3680 legacy poller active';end if;
  select relpersistence into v_p from pg_class where oid='public.nexus_v420_channel_outbox'::regclass;if v_p<>'u'::"char" then raise exception 'v3680 channel outbox changed';end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.nexus_telegram_message_buffer'::regclass and tgname='trg_v420_legacy_buffer_closed' and tgenabled='O') then raise exception 'v3680 legacy buffer open';end if;
  if not exists(select 1 from public.nexus_v420_channel_routes where channel_key='grupo_cliques' and chat_id=-1004417007577 and enabled) or not exists(select 1 from public.nexus_v420_channel_routes where channel_key='atendimento' and chat_id=-1003951454560 and enabled) then raise exception 'v3680 channel separation drift';end if;
exception when others then raise;
end
$assert$;

commit;
"""
OUTPUT.write_text(sql)
print(json.dumps({"ok": True, "migration": str(OUTPUT.relative_to(ROOT)), "encrypted_rows": len(inventory_values), "target_rows": len(zone_values), "plaintext_urls_written": False}))
