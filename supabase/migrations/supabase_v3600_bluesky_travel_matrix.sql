-- Nexus v3600.0 — Sovereign Bluesky Traffic Matrix & High-Intent Travel Core.
-- PostgreSQL 17.6 / pgvector 0.8.2. Additive metadata-only release.
--
-- Deployment requires transaction-local nexus.v3600_travel_embeddings_json:
-- 20 genuine gte-small/384 vectors keyed by (country_code,canonical_name).
-- NOTIFY remains a wake-up hint over the LOGGED v1550 outbox; it is not a queue.
-- CDN country is a route hint, never city/timezone/residence/humanity/intent proof.
-- The April-2026 Bluesky shares are dated third-party web-traffic estimates.
-- No URL, redirect, click, placement, fallback, publication or 24/7 daemon is added.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
set local idle_in_transaction_session_timeout='15000ms';

do $preflight$
declare v_persistence "char"; v_rows bigint;
begin
  if current_setting('server_version_num')::integer<170006 then raise exception 'v3600 requires PostgreSQL 17.6+'; end if;
  if (select extversion from pg_extension where extname='vector')<>'0.8.2' then raise exception 'v3600 pgvector drift'; end if;
  if to_regclass('public.nexus_v3340_travel_lexicon') is null then raise exception 'v3340 lexicon absent'; end if;
  select count(*) into v_rows from public.nexus_v3340_travel_lexicon;
  if v_rows not in(92,108) then raise exception 'v3600 refused: lexicon rows %',v_rows; end if;
  select relpersistence into v_persistence from pg_class where oid='public.nexus_v3340_travel_lexicon'::regclass;
  if v_persistence<>'p'::"char" then raise exception 'v3600 lexicon must remain LOGGED'; end if;
  if (select count(*) from public.ads)<>14301 or (select count(*) from public.ads where active)<>12165
     or (select count(*) from public.nexus_v370_keyword_source)<>17605
     or (select count(*) from public.nexus_v380_keyword_vectors)<>11568 then
    raise exception 'v3600 protected catalog drift';
  end if;
  if (select relpersistence from pg_class where oid='public.nexus_v1550_outbox_logged'::regclass)<>'p'::"char" then raise exception 'v3600 LOGGED outbox absent'; end if;
  if not exists(select 1 from cron.job where jobid=60 and active and jobname='v360-tg-flush-10s'
                and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);') then raise exception 'v3600 Job 60 drift'; end if;
  if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active) then raise exception 'v3600 legacy poller reactivated'; end if;
end
$preflight$;

-- Reassert only the catalog-identified legacy pollers; Job 60 is excluded.
select cron.alter_job(jobid,active:=false)
from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active;

create table if not exists public.nexus_v3600_evidence_sources(
  source_key text primary key, source_locator text not null, evidence_scope text not null,
  observed_period text, manifest_sha256 text not null check(manifest_sha256~'^[0-9a-f]{64}$'),
  notes text not null, recorded_at timestamptz not null default clock_timestamp()
);
revoke all on public.nexus_v3600_evidence_sources from public,anon,authenticated,service_role;
insert into public.nexus_v3600_evidence_sources(source_key,source_locator,evidence_scope,observed_period,manifest_sha256,notes) values
 ('booking_awards_2026','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/','official_booking_newsroom','2026','c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943','Most welcoming cities; not a search-volume or conversion ranking.'),
 ('operator_top_search_20_batch_2','operator_request:v3600.0','operator_supplied_not_independently_verified',null,'c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943','Exact official Booking.com global ranking and period were not independently located.'),
 ('bluesky_april_2026_secondary','https://www.socialpilot.co/blog/bluesky-statistics','third_party_estimate_citing_similarweb','2026-04','c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943','Dated bsky.app web-traffic estimate; not official Bluesky user distribution and not a current guarantee.')
on conflict(source_key) do update set source_locator=excluded.source_locator,evidence_scope=excluded.evidence_scope,
 observed_period=excluded.observed_period,manifest_sha256=excluded.manifest_sha256,notes=excluded.notes,recorded_at=clock_timestamp();

create table if not exists public.nexus_v3600_bluesky_traffic_snapshot(
  country_code text primary key check(country_code~'^[A-Z]{2}$'), traffic_rank integer not null unique check(traffic_rank between 1 and 100),
  share_pct numeric(6,3) not null check(share_pct>0 and share_pct<=100), observed_month date not null,
  metric_scope text not null check(metric_scope='third_party_estimated_bsky_app_web_traffic'),
  source_key text not null references public.nexus_v3600_evidence_sources(source_key),
  current_guarantee boolean not null default false check(current_guarantee=false),
  updated_at timestamptz not null default clock_timestamp()
);
revoke all on public.nexus_v3600_bluesky_traffic_snapshot from public,anon,authenticated,service_role;
insert into public.nexus_v3600_bluesky_traffic_snapshot(country_code,traffic_rank,share_pct,observed_month,metric_scope,source_key) values
  ('US',1,48.87,'2026-04-01','third_party_estimated_bsky_app_web_traffic','bluesky_april_2026_secondary'),
  ('GB',2,8.26,'2026-04-01','third_party_estimated_bsky_app_web_traffic','bluesky_april_2026_secondary'),
  ('JP',3,5.54,'2026-04-01','third_party_estimated_bsky_app_web_traffic','bluesky_april_2026_secondary'),
  ('DE',4,5.02,'2026-04-01','third_party_estimated_bsky_app_web_traffic','bluesky_april_2026_secondary'),
  ('CA',5,4.35,'2026-04-01','third_party_estimated_bsky_app_web_traffic','bluesky_april_2026_secondary')
on conflict(country_code) do update set traffic_rank=excluded.traffic_rank,share_pct=excluded.share_pct,
 observed_month=excluded.observed_month,metric_scope=excluded.metric_scope,source_key=excluded.source_key,updated_at=clock_timestamp();

-- Expand only constraints needed for the additive destinations. Existing rows stay unchanged.
alter table public.nexus_v3340_travel_lexicon drop constraint if exists nexus_v3340_country_ck;
alter table public.nexus_v3340_travel_lexicon add constraint nexus_v3340_country_ck check(country_code in
 ('US','CA','ES','FR','IT','GB','TW','AR','BR','NA','JP','AU','LT','AE','GR','PH'));
alter table public.nexus_v3340_travel_lexicon drop constraint if exists nexus_v3340_source_scope_ck;
alter table public.nexus_v3340_travel_lexicon add constraint nexus_v3340_source_scope_ck check(source_claim_scope in
 ('operator_reference_not_independently_verified','official_booking_release_2026','operator_supplied_search_ranking_not_independently_verified'));
alter table public.nexus_v3340_travel_lexicon drop constraint if exists nexus_v3340_release_ck;
alter table public.nexus_v3340_travel_lexicon add constraint nexus_v3340_release_ck check(installed_by_release in('v3340.0','v3600.0'));
alter table public.nexus_v3340_travel_lexicon drop constraint if exists nexus_v3340_disclosure_ck;
alter table public.nexus_v3340_travel_lexicon add constraint nexus_v3340_disclosure_ck check(
 (country_code='BR' and disclosure_tag='#publi') or (country_code<>'BR' and disclosure_tag='#ad'));

do $install$
declare v_payload jsonb; v_inserted integer;
begin
  v_payload:=nullif(current_setting('nexus.v3600_travel_embeddings_json',true),'')::jsonb;
  if v_payload is null or v_payload->>'schema_version'<>'v3600-protected-embeddings-1'
     or v_payload->>'model'<>'gte-small' or (v_payload->>'dimensions')::integer<>384
     or v_payload->>'manifest_sha256'<>'c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943'
     or jsonb_array_length(v_payload->'rows')<>20 then raise exception 'v3600 embedding payload absent or invalid'; end if;
  begin
    insert into public.nexus_v3340_travel_lexicon(
      country_code,primary_locale,locale_codes,admin_area,destination_name,aliases,intent_terms,
      eligible_networks,verified_networks,source_documents,source_sha256,source_claim_scope,
      embedding_source,embedding,embedding_model,cosine_threshold,disclosure_tag,installed_by_release,updated_at)
    select s.country_code,s.primary_locale,s.locale_codes,s.admin_area,s.destination_name,s.aliases,s.intent_terms,
      s.eligible_networks,s.verified_networks,s.source_documents,s.source_sha256,s.source_claim_scope,
      s.embedding_source,(e.embedding::text)::public.halfvec(384),'gte-small',0.8000,
      case when s.country_code='BR' then '#publi' else '#ad' end,'v3600.0',clock_timestamp()
    from (values
      ('IT','it-IT',array['it-IT']::text[],'Tuscany','Montepulciano',array['Montepulciano']::text[],array['viaggio','hotel','alloggio','volo','prenotazione','vacanza','turismo']::text[],array['ebay_epn']::text[],array['ebay_epn']::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Montepulciano'),
      ('TW','zh-TW',array['zh-TW']::text[],'Penghu','Magong',array['Magong','Makung']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','tourism']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Magong'),
      ('AR','es-AR',array['es-AR']::text[],'Neuquén','San Martín de los Andes',array['San Martín de los Andes','San Martin de los Andes']::text[],array['viaje','hotel','alojamiento','vuelo','reserva','vacaciones','turismo']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: San Martín de los Andes'),
      ('GB','en-GB',array['en-GB']::text[],'England','Harrogate',array['Harrogate']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','holiday']::text[],array['booking_uk','ebay_epn']::text[],array['booking_uk','ebay_epn']::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Harrogate'),
      ('US','en-US',array['en-US']::text[],'Texas','Fredericksburg',array['Fredericksburg','Fredericksburg Texas']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','holiday']::text[],array['ebay_epn']::text[],array['ebay_epn']::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Fredericksburg'),
      ('BR','pt-BR',array['pt-BR']::text[],'Goiás','Pirenópolis',array['Pirenópolis','Pirenopolis']::text[],array['viagem','hotel','hospedagem','voo','reserva','ferias','turismo']::text[],array['mercadolivre','shopee']::text[],array['mercadolivre']::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Pirenópolis'),
      ('NA','en-NA',array['en-NA']::text[],'Erongo','Swakopmund',array['Swakopmund']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','holiday']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Swakopmund'),
      ('JP','ja-JP',array['ja-JP']::text[],'Gifu','Takayama',array['Takayama']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','tourism']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Takayama'),
      ('AU','en-AU',array['en-AU']::text[],'Queensland','Noosa Heads',array['Noosa Heads','Noosa']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','holiday']::text[],array['ebay_epn']::text[],array['ebay_epn']::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Noosa Heads'),
      ('LT','lt-LT',array['lt-LT']::text[],'Klaipėda County','Klaipėda',array['Klaipėda','Klaipeda']::text[],array['kelione','viesbutis','apgyvendinimas','skrydis','rezervacija','atostogos','turizmas']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json','https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'official_booking_release_2026','Supabase.ai gte-small release text: Klaipėda'),
      ('IT','it-IT',array['it-IT']::text[],'Lazio','Roma',array['Roma','Rome']::text[],array['viaggio','hotel','alloggio','volo','prenotazione','vacanza','turismo']::text[],array['ebay_epn']::text[],array['ebay_epn']::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: Roma'),
      ('GB','en-GB',array['en-GB']::text[],'England','London',array['London','Londres']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','holiday']::text[],array['booking_uk','ebay_epn']::text[],array['booking_uk','ebay_epn']::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: London'),
      ('AE','ar-AE',array['ar-AE']::text[],'Dubai','Dubai',array['Dubai']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','tourism']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: Dubai'),
      ('FR','fr-FR',array['fr-FR']::text[],'Île-de-France','Paris',array['Paris']::text[],array['voyage','hotel','hebergement','vol','reservation','vacances','sejour','tourisme']::text[],array['ebay_epn']::text[],array['ebay_epn']::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: Paris'),
      ('BR','pt-BR',array['pt-BR']::text[],'São Paulo','São Paulo',array['São Paulo','Sao Paulo']::text[],array['viagem','hotel','hospedagem','voo','reserva','ferias','turismo']::text[],array['mercadolivre','shopee']::text[],array['mercadolivre']::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: São Paulo'),
      ('JP','ja-JP',array['ja-JP']::text[],'Tokyo','Tokyo',array['Tokyo','Tóquio']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','tourism']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: Tokyo'),
      ('IT','it-IT',array['it-IT']::text[],'Lombardy','Milano',array['Milano','Milan','Milão']::text[],array['viaggio','hotel','alloggio','volo','prenotazione','vacanza','turismo']::text[],array['ebay_epn']::text[],array['ebay_epn']::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: Milano'),
      ('GR','el-GR',array['el-GR']::text[],'Attica','Athens',array['Athens','Atenas']::text[],array['travel','trip','hotel','accommodation','flight','booking','vacation','tourism']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: Athens'),
      ('PH','fil-PH',array['fil-PH']::text[],'Metro Manila','Manila',array['Manila','Maynila']::text[],array['biyahe','hotel','tuluyan','lipad','reserbasyon','bakasyon','turismo']::text[],array[]::text[],array[]::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: Manila'),
      ('BR','pt-BR',array['pt-BR']::text[],'Rio de Janeiro','Rio de Janeiro',array['Rio de Janeiro','Rio']::text[],array['viagem','hotel','hospedagem','voo','reserva','ferias','turismo']::text[],array['mercadolivre','shopee']::text[],array['mercadolivre']::text[],array['data/v3600-travel-matrix.json']::text[],array['c1725cbee5dcf90c47cc2c1370879b26421dc60221c790e44537af40ac77e943']::text[],'operator_supplied_search_ranking_not_independently_verified','Supabase.ai gte-small release text: Rio de Janeiro')
    )s(country_code,primary_locale,locale_codes,admin_area,destination_name,aliases,intent_terms,
       eligible_networks,verified_networks,source_documents,source_sha256,source_claim_scope,embedding_source)
    join jsonb_to_recordset(v_payload->'rows')e(country_code text,canonical_name text,embedding jsonb)
      on e.country_code=s.country_code and e.canonical_name=s.destination_name
    on conflict(country_code,destination_key) do nothing;
    get diagnostics v_inserted=row_count;
    if v_inserted not in(0,16) then raise exception 'v3600 expected 16 new canonical rows or idempotent 0, got %',v_inserted; end if;
    perform set_config('nexus.v3600_travel_embeddings_json','',true); v_payload:=null;
  exception when others then
    perform set_config('nexus.v3600_travel_embeddings_json','',true); v_payload:=null; raise;
  end;
end
$install$;

create table if not exists public.nexus_v3600_destination_matrix(
  matrix_id bigint generated always as identity primary key,
  source_batch integer not null check(source_batch in(1,2)), source_rank integer not null check(source_rank between 1 and 10),
  display_name text not null, country_code text not null, destination_key text not null,
  aliases text[] not null, primary_locale text not null, country_currency text not null check(country_currency~'^[A-Z]{3}$'),
  eligible_networks text[] not null, verified_networks text[] not null check(verified_networks<@eligible_networks),
  evidence_scope text not null, installed_at timestamptz not null default clock_timestamp(),
  unique(source_batch,source_rank), unique(country_code,destination_key),
  foreign key(country_code,destination_key) references public.nexus_v3340_travel_lexicon(country_code,destination_key)
);
create index if not exists nexus_v3600_destination_alias_idx on public.nexus_v3600_destination_matrix(country_code,destination_key);
revoke all on public.nexus_v3600_destination_matrix from public,anon,authenticated,service_role;
revoke all on sequence public.nexus_v3600_destination_matrix_matrix_id_seq from public,anon,authenticated,service_role;
insert into public.nexus_v3600_destination_matrix(source_batch,source_rank,display_name,country_code,destination_key,aliases,
 primary_locale,country_currency,eligible_networks,verified_networks,evidence_scope) values
  (1,1,'Montepulciano','IT',public.nexus_v3340_norm('Montepulciano'),array['Montepulciano']::text[],'it-IT','EUR',array['ebay_epn']::text[],array['ebay_epn']::text[],'official_booking_release_2026'),
  (1,2,'Magong','TW',public.nexus_v3340_norm('Magong'),array['Magong','Makung']::text[],'zh-TW','TWD',array[]::text[],array[]::text[],'official_booking_release_2026'),
  (1,3,'San Martín de los Andes','AR',public.nexus_v3340_norm('San Martín de los Andes'),array['San Martín de los Andes','San Martin de los Andes']::text[],'es-AR','ARS',array[]::text[],array[]::text[],'official_booking_release_2026'),
  (1,4,'Harrogate','GB',public.nexus_v3340_norm('Harrogate'),array['Harrogate']::text[],'en-GB','GBP',array['booking_uk','ebay_epn']::text[],array['booking_uk','ebay_epn']::text[],'official_booking_release_2026'),
  (1,5,'Fredericksburg','US',public.nexus_v3340_norm('Fredericksburg'),array['Fredericksburg','Fredericksburg Texas']::text[],'en-US','USD',array['ebay_epn']::text[],array['ebay_epn']::text[],'official_booking_release_2026'),
  (1,6,'Pirenópolis','BR',public.nexus_v3340_norm('Pirenópolis'),array['Pirenópolis','Pirenopolis']::text[],'pt-BR','BRL',array['mercadolivre','shopee']::text[],array['mercadolivre']::text[],'official_booking_release_2026'),
  (1,7,'Swakopmund','NA',public.nexus_v3340_norm('Swakopmund'),array['Swakopmund']::text[],'en-NA','NAD',array[]::text[],array[]::text[],'official_booking_release_2026'),
  (1,8,'Takayama','JP',public.nexus_v3340_norm('Takayama'),array['Takayama']::text[],'ja-JP','JPY',array[]::text[],array[]::text[],'official_booking_release_2026'),
  (1,9,'Noosa Heads','AU',public.nexus_v3340_norm('Noosa Heads'),array['Noosa Heads','Noosa']::text[],'en-AU','AUD',array['ebay_epn']::text[],array['ebay_epn']::text[],'official_booking_release_2026'),
  (1,10,'Klaipėda','LT',public.nexus_v3340_norm('Klaipėda'),array['Klaipėda','Klaipeda']::text[],'lt-LT','EUR',array[]::text[],array[]::text[],'official_booking_release_2026'),
  (2,1,'Roma','IT',public.nexus_v3340_norm('Roma'),array['Roma','Rome']::text[],'it-IT','EUR',array['ebay_epn']::text[],array['ebay_epn']::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,2,'Londres','GB',public.nexus_v3340_norm('London'),array['London','Londres']::text[],'en-GB','GBP',array['booking_uk','ebay_epn']::text[],array['booking_uk','ebay_epn']::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,3,'Dubai','AE',public.nexus_v3340_norm('Dubai'),array['Dubai']::text[],'ar-AE','AED',array[]::text[],array[]::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,4,'Paris','FR',public.nexus_v3340_norm('Paris'),array['Paris']::text[],'fr-FR','EUR',array['ebay_epn']::text[],array['ebay_epn']::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,5,'São Paulo','BR',public.nexus_v3340_norm('São Paulo'),array['São Paulo','Sao Paulo']::text[],'pt-BR','BRL',array['mercadolivre','shopee']::text[],array['mercadolivre']::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,6,'Tóquio','JP',public.nexus_v3340_norm('Tokyo'),array['Tokyo','Tóquio']::text[],'ja-JP','JPY',array[]::text[],array[]::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,7,'Milão','IT',public.nexus_v3340_norm('Milano'),array['Milano','Milan','Milão']::text[],'it-IT','EUR',array['ebay_epn']::text[],array['ebay_epn']::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,8,'Atenas','GR',public.nexus_v3340_norm('Athens'),array['Athens','Atenas']::text[],'el-GR','EUR',array[]::text[],array[]::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,9,'Manila','PH',public.nexus_v3340_norm('Manila'),array['Manila','Maynila']::text[],'fil-PH','PHP',array[]::text[],array[]::text[],'operator_supplied_search_ranking_not_independently_verified'),
  (2,10,'Rio de Janeiro','BR',public.nexus_v3340_norm('Rio de Janeiro'),array['Rio de Janeiro','Rio']::text[],'pt-BR','BRL',array['mercadolivre','shopee']::text[],array['mercadolivre']::text[],'operator_supplied_search_ranking_not_independently_verified')
on conflict(source_batch,source_rank) do nothing;

create table if not exists public.nexus_v3600_route_readiness(
  country_code text not null, network text not null,
  route_ready boolean not null, catalog_rows integer not null check(catalog_rows>=0),
  evidence_scope text not null, evidence_expires_at timestamptz not null,
  checked_at timestamptz not null default clock_timestamp(), primary key(country_code,network)
);
create index if not exists nexus_v3600_route_readiness_idx
 on public.nexus_v3600_route_readiness(country_code,network,evidence_expires_at) include(route_ready,catalog_rows);
revoke all on public.nexus_v3600_route_readiness from public,anon,authenticated,service_role;
do $readiness$
declare v_kms text; v_campaign text; v_aid text; r record; v_n integer; v_meta jsonb;
begin
  select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms';
  select extensions.pgp_sym_decrypt(decode(value,'hex'),v_kms)::jsonb->>'campaign_id' into strict v_campaign from public.nexus_growth_secrets where key='ebay_campaign_id_enc';
  for r in select * from (values('US','www.ebay.com'),('GB','www.ebay.co.uk'),('ES','www.ebay.es'),('FR','www.ebay.fr'),('IT','www.ebay.it'),('AU','www.ebay.com.au'))x(country_code,host)
  loop
    select count(*) into v_n from public.ads where active and advertiser ilike '%ebay%'
      and lower(substring(click_url from '^https?://([^/]+)'))=r.host and position(v_campaign in click_url)>0;
    insert into public.nexus_v3600_route_readiness values(r.country_code,'ebay_epn',v_n>0,v_n,'encrypted_campaign_and_active_catalog_metadata',clock_timestamp()+interval '7 days',clock_timestamp())
    on conflict(country_code,network) do update set route_ready=excluded.route_ready,catalog_rows=excluded.catalog_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  end loop;
  select extensions.pgp_sym_decrypt(decode(value,'hex'),v_kms)::jsonb->>'aid' into strict v_aid from public.nexus_growth_secrets where key='booking_uk_id_enc';
  select count(*) into v_n from public.ads where active and advertiser='Booking.com United Kingdom' and cj_link_id=v_aid;
  insert into public.nexus_v3600_route_readiness values('GB','booking_uk',v_n>0,v_n,'encrypted_aid_and_active_catalog_metadata',clock_timestamp()+interval '7 days',clock_timestamp())
  on conflict(country_code,network) do update set route_ready=excluded.route_ready,catalog_rows=excluded.catalog_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  v_meta:=public.nexus_v3500_route_readiness('{"CF-IPCountry":"BR"}'::jsonb,'mercadolivre','pt-BR','travel');
  insert into public.nexus_v3600_route_readiness values('BR','mercadolivre',coalesce((v_meta->>'route_ready')::boolean,false),case when coalesce((v_meta->>'route_ready')::boolean,false) then 1 else 0 end,'v3500_encrypted_credential_metadata',clock_timestamp()+interval '7 days',clock_timestamp())
  on conflict(country_code,network) do update set route_ready=excluded.route_ready,catalog_rows=excluded.catalog_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  v_meta:=public.nexus_v3500_route_readiness('{"CF-IPCountry":"BR"}'::jsonb,'shopee','pt-BR','travel');
  insert into public.nexus_v3600_route_readiness values('BR','shopee',coalesce((v_meta->>'route_ready')::boolean,false),case when coalesce((v_meta->>'route_ready')::boolean,false) then 1 else 0 end,'v3500_physical_inventory_evidence',clock_timestamp()+interval '7 days',clock_timestamp())
  on conflict(country_code,network) do update set route_ready=excluded.route_ready,catalog_rows=excluded.catalog_rows,evidence_scope=excluded.evidence_scope,evidence_expires_at=excluded.evidence_expires_at,checked_at=excluded.checked_at;
  v_campaign:=null;v_aid:=null;v_kms:=null;v_meta:=null;
exception when others then v_campaign:=null;v_aid:=null;v_kms:=null;v_meta:=null;raise;
end
$readiness$;

create or replace function public.nexus_v3600_resolve_travel(
  p_headers jsonb,p_destination text,p_intent_text text,p_intent_embedding text,
  p_locale text default null,p_preferred_network text default null
) returns jsonb language plpgsql security definer
set search_path='public','extensions','pg_temp' as $function$
declare
  v_country text; v_source text; v_count integer; v_dest_key text; v_intent_key text; v_locale text;
  v_network text; v_host text; v_kms text; v_campaign text; v_aid text; v_route_ready boolean:=false;
  v_route_rows integer:=0; v_similarity numeric; v_query public.halfvec(384); v_copy text;
  v_traffic numeric; v_traffic_month date; r public.nexus_v3340_travel_lexicon%rowtype; m public.nexus_v3600_destination_matrix%rowtype;
begin
  perform set_config('statement_timeout','4000',true); perform set_config('lock_timeout','1000',true);
  begin
    if p_headers is null or jsonb_typeof(p_headers)<>'object' then return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','headers_invalid','affiliate_url',null); end if;
    select count(distinct upper(btrim(value))),min(upper(btrim(value))),min(lower(key))
      into v_count,v_country,v_source from jsonb_each_text(p_headers)
      where lower(key) in('cf-ipcountry','x-vercel-ip-country') and btrim(value)<>'';
    if v_count>1 then return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','country_headers_conflict','affiliate_url',null,'timezone_proven',false,'human_or_residential_proven',false); end if;
    if v_country is null or v_country!~'^[A-Z]{2}$' or v_country in('XX','T1') then return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','cdn_country_unavailable','affiliate_url',null); end if;
    if p_destination is null or length(btrim(p_destination)) not between 2 and 100 or p_intent_text is null or length(btrim(p_intent_text)) not between 3 and 500 or p_intent_embedding is null or length(p_intent_embedding)>12000 then
      return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','payload_invalid','country',v_country,'affiliate_url',null); end if;
    v_dest_key:=public.nexus_v3340_norm(p_destination); v_intent_key:=public.nexus_v3340_norm(p_intent_text);
    select x.* into m from public.nexus_v3600_destination_matrix x where x.country_code=v_country
      and exists(select 1 from unnest(x.aliases)a where public.nexus_v3340_norm(a)=v_dest_key) limit 1;
    if not found then return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','destination_not_in_country_matrix','country',v_country,'affiliate_url',null); end if;
    select l.* into strict r from public.nexus_v3340_travel_lexicon l where l.country_code=m.country_code and l.destination_key=m.destination_key;
    v_locale:=coalesce(nullif(btrim(p_locale),''),m.primary_locale);
    if lower(v_locale)<>lower(m.primary_locale) and not exists(select 1 from unnest(r.locale_codes)x where lower(x)=lower(v_locale)) then
      return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','locale_not_supported_for_destination','country',v_country,'destination',m.display_name,'affiliate_url',null); end if;
    if not exists(select 1 from unnest(m.aliases)a where v_intent_key~('(^| )'||public.nexus_v3340_norm(a)||'( |$)')) then
      return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','destination_absent_from_intent','country',v_country,'destination',m.display_name,'affiliate_url',null); end if;
    if not exists(select 1 from unnest(r.intent_terms)t where v_intent_key~('(^| )'||public.nexus_v3340_norm(t)||'( |$)')) then
      return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','travel_intent_not_explicit','country',v_country,'destination',m.display_name,'affiliate_url',null); end if;
    begin v_query:=p_intent_embedding::public.halfvec(384); exception when others then return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','embedding_invalid','country',v_country,'affiliate_url',null); end;
    v_similarity:=1-(r.embedding<=>v_query);
    if v_similarity is null or v_similarity<r.cosine_threshold then return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','cosine_threshold_not_met','country',v_country,'destination',m.display_name,'cosine_similarity',round(v_similarity,6),'affiliate_url',null); end if;
    v_network:=lower(coalesce(nullif(btrim(p_preferred_network),''),case when v_country='BR' then 'mercadolivre' when v_country='GB' then 'booking_uk' when v_country in('US','ES','FR','IT','AU') then 'ebay_epn' else '' end));
    if v_network<>'' and not v_network=any(m.eligible_networks) then return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','network_not_eligible','country',v_country,'destination',m.display_name,'affiliate_url',null); end if;
    if v_network<>'' then
      select q.route_ready,q.catalog_rows into v_route_ready,v_route_rows
        from public.nexus_v3600_route_readiness q
       where q.country_code=v_country and q.network=v_network and q.evidence_expires_at>clock_timestamp();
      if not found then v_route_ready:=false;v_route_rows:=0; end if;
    end if;
    select share_pct,observed_month into v_traffic,v_traffic_month from public.nexus_v3600_bluesky_traffic_snapshot where country_code=v_country;
    v_copy:=case lower(split_part(v_locale,'-',1))
      when 'pt' then 'Opções de viagem para '||m.display_name||'. Confira disponibilidade e condições atuais na página do parceiro.'
      when 'es' then 'Opciones de viaje para '||m.display_name||'. Consulta disponibilidad y condiciones actuales en la página del socio.'
      when 'fr' then 'Options de voyage pour '||m.display_name||'. Vérifiez les disponibilités et les conditions actuelles sur la page du partenaire.'
      when 'it' then 'Opzioni di viaggio per '||m.display_name||'. Verifica disponibilità e condizioni attuali sulla pagina del partner.'
      when 'ja' then m.display_name||'の旅行オプションです。提携先ページで現在の空き状況と条件をご確認ください。'
      when 'zh' then m.display_name||'的旅行選項。請在合作夥伴頁面確認目前的供應情況與條款。'
      when 'lt' then 'Kelionių į '||m.display_name||' variantai. Partnerio puslapyje patikrinkite dabartinį prieinamumą ir sąlygas.'
      when 'ar' then 'خيارات السفر إلى '||m.display_name||'. تحقق من التوفر والشروط الحالية في صفحة الشريك.'
      when 'el' then 'Επιλογές ταξιδιού για '||m.display_name||'. Ελέγξτε την τρέχουσα διαθεσιμότητα και τους όρους στη σελίδα του συνεργάτη.'
      when 'fil' then 'Mga opsyon sa paglalakbay para sa '||m.display_name||'. Tingnan ang kasalukuyang availability at mga tuntunin sa pahina ng partner.'
      else 'Travel options for '||m.display_name||'. Check current availability and terms on the partner page.' end;
    return jsonb_build_object('version','v3600.0','estado',case when v_route_ready then 'ok' else 'Sintonizado em Análise' end,
      'motivo',case when v_route_ready then 'verified_catalog_route_available' else 'verified_route_unavailable' end,
      'country',v_country,'geo_source',v_source,'destination',m.display_name,'locale',v_locale,
      'country_currency',m.country_currency,'yield_currency_context',case when v_country='BR' then 'BRL' when v_country='US' then 'USD' when v_country='GB' then 'GBP' when v_country in('ES','FR','IT','LT','GR') then 'EUR' end,
      'selected_network',nullif(v_network,''),'catalog_route_ready',v_route_ready,'catalog_route_rows',v_route_rows,
      'traffic_share_hint_pct',v_traffic,'traffic_share_observed_month',v_traffic_month,'traffic_share_is_current_guarantee',false,
      'content_copy',v_copy,'disclosure_required_before_link',case when v_country='BR' then '#publi' else '#ad' end,'disclosure_own_line',true,
      'cosine_operator','<=>','cosine_similarity',round(v_similarity,6),'embedding_model',r.embedding_model,
      'affiliate_url',null,'shortener_path',null,'redirect_performed',false,'click_recorded',false,'publication_claimed',false,
      'cdn_country_is_routing_hint',true,'timezone_proven',false,'human_or_residential_proven',false,
      'continuous_24x7_proven',false,'sub_1ms_guaranteed',false,'fallback_deployed',false,'sub_50ms_fallback_guaranteed',false,'commission_lossless_guaranteed',false);
  exception when others then
    begin perform public.nexus_v420_sintonizado('v3600-travel-route',coalesce(v_country,'unknown'),sqlstate||': '||left(sqlerrm,220)); exception when others then null; end;
    return jsonb_build_object('version','v3600.0','estado','Sintonizado em Análise','motivo','resolver_error','affiliate_url',null);
  end;
end
$function$;
revoke all on function public.nexus_v3600_resolve_travel(jsonb,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3600_resolve_travel(jsonb,text,text,text,text,text) to service_role;

create or replace function public.nexus_v3600_operator_status() returns jsonb language plpgsql security definer
set search_path='public','pg_catalog','pg_temp' as $function$
begin
  perform set_config('statement_timeout','4000',true); perform set_config('lock_timeout','1000',true);
  return jsonb_build_object('version','v3600.0','observed_at',clock_timestamp(),
   'matrix_destinations',(select count(*) from public.nexus_v3600_destination_matrix),
   'lexicon_rows',(select count(*) from public.nexus_v3340_travel_lexicon),
   'new_lexicon_rows',(select count(*) from public.nexus_v3340_travel_lexicon where installed_by_release='v3600.0'),'route_readiness_rows',(select count(*) from public.nexus_v3600_route_readiness),
   'keyword_mappings',(select count(*) from public.nexus_v370_keyword_source),'local_vectors',(select count(*) from public.nexus_v380_keyword_vectors),
   'traffic_snapshot',(select jsonb_agg(jsonb_build_object('country',country_code,'rank',traffic_rank,'share_pct',share_pct,'observed_month',observed_month,'current_guarantee',false) order by traffic_rank) from public.nexus_v3600_bluesky_traffic_snapshot),
   'job_60',(select jsonb_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobid=60),
   'legacy_pollers_active',(select count(*) from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active),
   'telegram',jsonb_build_object('legacy_buffer_closed',exists(select 1 from pg_trigger where tgrelid='public.nexus_telegram_message_buffer'::regclass and tgname='trg_v420_legacy_buffer_closed' and tgenabled='O'),'channel_outbox_unlogged',(select relpersistence='u' from pg_class where oid='public.nexus_v420_channel_outbox'::regclass),'pacing','max 3/min and 40/hour per destination'),
   'claims',jsonb_build_object('cdn_country_proves_timezone',false,'human_or_residential_proven',false,'continuous_24x7_proven',false,'all_14_accounts_active',false,'sub_1ms_guaranteed',false,'fallback_deployed',false,'sub_50ms_guaranteed',false,'publication_performed',false,'placements_modified',false));
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3600_operator_status() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3600_operator_status() to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3600_destination_matrix',true,jsonb_build_object('matrix_rows',20,'new_lexicon_rows',16,'existing_canonical_rows_reused',4,'embedding_model','gte-small','dimensions',384),clock_timestamp()),
 ('v3600_bluesky_traffic_snapshot',true,jsonb_build_object('scope','dated third-party bsky.app web-traffic estimate','observed_month','2026-04','official_bluesky_distribution',false,'current_guarantee',false),clock_timestamp()),
 ('v3600_route_metadata_only',true,jsonb_build_object('affiliate_url_returned',false,'redirect_deployed',false,'click_performed',false,'indexed_readiness_rows',9),clock_timestamp()),
 ('v3600_continuous_runtime',false,jsonb_build_object('reason','no resident execution platform proven','edge_sessions_are_bounded',true),clock_timestamp()),
 ('v3600_all_14_accounts_active',false,jsonb_build_object('reason','current management credentials reach 10 of the 14 configured master-plus-satellite projects; one additional non-catalog project is accessible'),clock_timestamp()),
 ('v3600_fallback',false,jsonb_build_object('kv_binding_verified',false,'direct_destination_fallback_deployed',false,'sub_50ms_guaranteed',false),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare v_p "char";
begin
  if (select count(*) from public.nexus_v3600_destination_matrix)<>20 then raise exception 'v3600 matrix count'; end if;
  if (select count(*) from public.nexus_v3600_route_readiness)<>9 or (select count(*) from public.nexus_v3600_route_readiness where route_ready)<>8 then raise exception 'v3600 readiness count'; end if;
  if (select count(*) from public.nexus_v3340_travel_lexicon)<>108 or (select count(*) from public.nexus_v3340_travel_lexicon where installed_by_release='v3600.0')<>16 then raise exception 'v3600 lexicon additive count'; end if;
  if exists(select 1 from public.nexus_v3340_travel_lexicon where vector_dims(embedding)<>384 or embedding_model<>'gte-small') then raise exception 'v3600 vector invariant'; end if;
  if (select count(*) from public.ads)<>14301 or (select count(*) from public.ads where active)<>12165 or (select count(*) from public.nexus_v370_keyword_source)<>17605 or (select count(*) from public.nexus_v380_keyword_vectors)<>11568 then raise exception 'v3600 protected catalog changed'; end if;
  if has_table_privilege('anon','public.nexus_v3600_destination_matrix','select') or has_table_privilege('authenticated','public.nexus_v3600_destination_matrix','select') or has_table_privilege('service_role','public.nexus_v3600_destination_matrix','select') then raise exception 'v3600 matrix exposed'; end if;
  if has_function_privilege('anon','public.nexus_v3600_resolve_travel(jsonb,text,text,text,text,text)','execute') or has_function_privilege('authenticated','public.nexus_v3600_resolve_travel(jsonb,text,text,text,text,text)','execute') or not has_function_privilege('service_role','public.nexus_v3600_resolve_travel(jsonb,text,text,text,text,text)','execute') then raise exception 'v3600 resolver ACL'; end if;
  if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);') then raise exception 'v3600 Job 60 changed'; end if;
  if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active) then raise exception 'v3600 poller active'; end if;
  select relpersistence into v_p from pg_class where oid='public.nexus_v420_channel_outbox'::regclass; if v_p<>'u'::"char" then raise exception 'v3600 channel outbox not UNLOGGED'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.nexus_telegram_message_buffer'::regclass and tgname='trg_v420_legacy_buffer_closed' and tgenabled='O') then raise exception 'v3600 legacy Telegram buffer unexpectedly open'; end if;
  if not exists(select 1 from public.nexus_v420_channel_routes where channel_key='grupo_cliques' and chat_id=-1004417007577 and enabled) or not exists(select 1 from public.nexus_v420_channel_routes where channel_key='atendimento' and chat_id=-1003951454560 and enabled) then raise exception 'v3600 channel separation drift'; end if;
end
$assert$;
notify pgrst,'reload schema';
commit;
