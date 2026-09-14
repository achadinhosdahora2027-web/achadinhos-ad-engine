-- Nexus v3680.0 rollback for the five-batch encrypted source append.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
do $guard$
begin
 if (select count(*) from public.nexus_shopee_offers)<>1201 then raise exception 'v3680 append rollback baseline';end if;
 if (select count(*) from public.nexus_shopee_offers where source_file=any(array['BatchProductLinks20260912232203-0a35f92c7623406a8d470f803ecf8721.csv','BatchProductLinks20260912232238-371045aa9eb44280884262dd8f28a197.csv','BatchProductLinks20260912232322-f484454c0eac489e828c5e290b1005db.csv','BatchProductLinks20260912232348-4cde5291c9a54e28b7e2c625268a1077.csv','BatchProductLinks20260912232418-f9850050bfdb49b19ff0c96f04cc2dcc.csv']::text[]))<>500 then raise exception 'v3680 append rollback source mismatch';end if;
exception when others then raise;
end
$guard$;
drop trigger trg_v3680_shopee_immutable on public.nexus_shopee_offers;
delete from public.nexus_shopee_offers where source_file=any(array['BatchProductLinks20260912232203-0a35f92c7623406a8d470f803ecf8721.csv','BatchProductLinks20260912232238-371045aa9eb44280884262dd8f28a197.csv','BatchProductLinks20260912232322-f484454c0eac489e828c5e290b1005db.csv','BatchProductLinks20260912232348-4cde5291c9a54e28b7e2c625268a1077.csv','BatchProductLinks20260912232418-f9850050bfdb49b19ff0c96f04cc2dcc.csv']::text[]);
create trigger trg_v3680_shopee_immutable before insert or update or delete or truncate on public.nexus_shopee_offers
for each statement execute function public.nexus_v3680_reject_immutable_mutation();
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
  v_meta:=public.nexus_v3500_route_readiness('{"CF-IPCountry":"BR"}'::jsonb,'mercadolivre','pt-BR','travel');
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
