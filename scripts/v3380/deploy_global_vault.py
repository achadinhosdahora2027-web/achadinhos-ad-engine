#!/usr/bin/env python3
"""Install, hydrate, seal, and verify the encrypted v3380 CJ global backlog."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path('/home/user/.v3370-protected/runtime.json')
PROTECTED = Path('/home/user/.v3370-protected/cj-links-v3380.json')
MIGRATION = ROOT / 'supabase/migrations/supabase_v3380_cj_global_ingestion.sql'
ROLLBACK = ROOT / 'supabase/migrations/rollback_v3380_cj_global_ingestion.sql'
OUT = ROOT / 'docs/evidencias/v3380-cj-global-production-deploy.json'
REF = 'etbxbaaaspdcoiakifbb'


def load_protected(path: Path) -> dict:
    if not path.is_file() or stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise RuntimeError(f'protected file unavailable or not mode 0600: {path.name}')
    return json.loads(path.read_text())


def credentials() -> tuple[str, str]:
    runtime = load_protected(RUNTIME)
    selected = runtime['supabase_management_selected_for_existing_master']
    return runtime['supabase_management'][selected], runtime['supabase_master_runtime']['legacy_service_role']


def management(token: str, sql: str) -> tuple[object, dict]:
    body = json.dumps({'query': sql}, separators=(',', ':')).encode()
    request = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', data=body, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read()
            return (json.loads(raw) if raw else None), {'http': response.status, 'request_bytes': len(body), 'response_bytes': len(raw), 'duration_ms': round((time.monotonic() - started) * 1000)}
    except urllib.error.HTTPError as error:
        error.read()
        raise RuntimeError(f'management query failed HTTP {error.code}') from error


def rpc(service_role: str, function: str, payload: dict) -> tuple[object, dict]:
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
    request = urllib.request.Request(f'https://{REF}.supabase.co/rest/v1/rpc/{function}', data=body, headers={'apikey': service_role, 'Authorization': 'Bearer ' + service_role, 'Content-Type': 'application/json'}, method='POST')
    started = time.monotonic()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read()
                return (json.loads(raw) if raw else None), {'http': response.status, 'request_bytes': len(body), 'response_bytes': len(raw), 'duration_ms': round((time.monotonic() - started) * 1000)}
        except urllib.error.HTTPError as error:
            error.read()
            if error.code == 404 and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f'protected RPC failed HTTP {error.code}') from error
    raise RuntimeError('protected RPC retry exhaustion')


def iso(value: str | None) -> str | None:
    return value or None


def prepare(protected: dict) -> tuple[str, str, list[dict]]:
    observed = protected['observed_at']
    evidence_sha = hashlib.sha256(PROTECTED.read_bytes()).hexdigest()
    ingestion_id = 'cj-audit-' + evidence_sha[:24]
    active_advertisers = set(protected['active_advertiser_ids'])
    active_contracts = set(protected['active_contract_advertiser_ids'])
    rows = []
    for link in protected['links']:
        if link['relationship_status'].lower() != 'joined' or link['advertiser_id'] not in active_advertisers or link['advertiser_id'] not in active_contracts:
            raise RuntimeError('protected candidate relationship drift')
        tracking = link['tracking_url'].strip()
        destination = link['destination'].strip()
        source = json.dumps(link, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        material = f"{link['country']}|{link['advertiser_id']}|{link['link_id']}".encode()
        rows.append({
            'evidence_key': 'cj-global-' + hashlib.sha256(material).hexdigest()[:32],
            'country_code': link['country'], 'category': link['category'], 'link_language': link['language'],
            'link_type': link['link_type'], 'promotion_type': link['promotion_type'] or 'N/A',
            'promotion_start_at': iso(link['promotion_start_date']), 'promotion_end_at': iso(link['promotion_end_date']),
            'mobile_optimized': link['mobile_optimized'].lower() == 'true', 'relationship_joined': True,
            'advertiser_active': True, 'contract_active': True, 'targeted_countries': link['targeted_countries'],
            'advertiser_id': link['advertiser_id'], 'advertiser_name': link['advertiser_name'],
            'link_id': link['link_id'], 'link_name': link['link_name'], 'description': link['description'],
            'tracking_url': tracking, 'destination_url': destination or None,
            'source_record_sha256': hashlib.sha256(source.encode()).hexdigest(),
        })
    if len({row['evidence_key'] for row in rows}) != len(rows):
        raise RuntimeError('country/link evidence key collision')
    return ingestion_id, evidence_sha, rows


def rollback(token: str) -> dict:
    _, evidence = management(token, ROLLBACK.read_text())
    return evidence


def verify(token: str, ingestion_id: str, expected: int) -> tuple[dict, dict]:
    sql = f"""
with k as(select value kms from public.nexus_growth_secrets where key='nexus_satellites_kms'),
d as(select v.*,extensions.pgp_sym_decrypt(v.tracking_url_enc,k.kms) tracking,
 extensions.pgp_sym_decrypt(v.link_identity_enc,k.kms) identity_value,
 case when v.destination_url_enc is null then null else extensions.pgp_sym_decrypt(v.destination_url_enc,k.kms) end destination_value
 from public.nexus_v3380_cj_global_vault v cross join k where ingestion_id='{ingestion_id}')
select
 (select count(*) from d) encrypted_rows,
 (select count(distinct country_code) from d) candidate_countries,
 (select count(*) from d where backlog_sealed) sealed_rows,
 (select count(*) from d where evidence_expires_at>clock_timestamp()) fresh_rows,
 (select count(*) from d where encode(extensions.digest(lower(substring(tracking from '^https://([^/:?#]+)')),'sha256'),'hex')=tracking_host_sha256) tracking_host_matches,
 (select count(*) from d where identity_value is not null) decrypted_identity_rows,
 (select count(*) from d where destination_url_enc is not null and destination_value is not null) decrypted_destination_rows,
 (select count(*) from d where targeted_country_declared) explicitly_declared_country_rows,
 (select count(*) from d where route_approved or routing_activated) bulk_routes_activated,
 (select count(*) from public.nexus_v3380_cj_placement_policy where route_enabled and affiliate_url_enc is not null and evidence_expires_at>clock_timestamp()) selected_fresh_routes,
 (select count(*) from public.nexus_v370_keyword_source) keyword_rows,
 (select count(*) from cron.job where jobid=60 and active and schedule='10 seconds') job60_ok,
 (select count(*) from cron.job where jobid in(15,16,64) and active) protected_jobs_active,
 (select count(*) from information_schema.columns where table_schema='public' and table_name='nexus_v3380_cj_global_vault' and column_name in('tracking_url','destination_url','advertiser_id','advertiser_name','link_id','link_name','description','token','pid')) plaintext_sensitive_columns,
 has_table_privilege('anon','public.nexus_v3380_cj_global_vault','select') anon_vault_select,
 has_table_privilege('service_role','public.nexus_v3380_cj_global_vault','select') service_vault_select,
 (select enabled from public.nexus_v3000_capability_registry where capability='v3380_cj_global_encrypted_backlog') backlog_capability,
 (select enabled from public.nexus_v3000_capability_registry where capability='v3380_cj_global_bulk_routing') bulk_routing_capability;
"""
    result, evidence = management(token, sql)
    if not isinstance(result, list) or len(result) != 1:
        raise RuntimeError('verification response shape')
    row = result[0]
    integers = ('encrypted_rows','candidate_countries','sealed_rows','fresh_rows','tracking_host_matches','decrypted_identity_rows','decrypted_destination_rows','explicitly_declared_country_rows','bulk_routes_activated','selected_fresh_routes','keyword_rows','job60_ok','protected_jobs_active','plaintext_sensitive_columns')
    for key in integers:
        row[key] = int(row[key])
    required = {
        'encrypted_rows': expected, 'sealed_rows': expected, 'fresh_rows': expected,
        'tracking_host_matches': expected, 'decrypted_identity_rows': expected,
        'bulk_routes_activated': 0, 'selected_fresh_routes': 19, 'keyword_rows': 17605,
        'job60_ok': 1, 'protected_jobs_active': 0, 'plaintext_sensitive_columns': 0,
        'anon_vault_select': False, 'service_vault_select': False,
        'backlog_capability': True, 'bulk_routing_capability': False,
    }
    drift = [key for key, value in required.items() if row.get(key) != value]
    if drift:
        raise RuntimeError('production verification drift: ' + ','.join(drift))
    return row, evidence


def main() -> None:
    token, service_role = credentials()
    protected = load_protected(PROTECTED)
    ingestion_id, evidence_sha, rows = prepare(protected)
    migration_sha = hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    report = {
        'schema_version': 'v3380-cj-global-production-deploy-1', 'observed_at': datetime.now(timezone.utc).isoformat(),
        'migration_sha256': migration_sha, 'protected_payload_sha256': evidence_sha,
        'ingestion_id': ingestion_id, 'candidate_rows': len(rows),
        'plaintext_credentials_recorded': False, 'affiliate_urls_recorded': False,
        'affiliate_urls_followed': False, 'clicks_performed': False, 'impressions_created': False, 'sales_claimed': False,
    }
    try:
        _, schema = management(token, MIGRATION.read_text())
        management(token, "notify pgrst,'reload schema';")
        report['schema_install'] = {'result': 'pass', **schema}
        batches = []
        for index in range(0, len(rows), 100):
            batch = rows[index:index + 100]
            result, transport = rpc(service_role, 'nexus_v3380_hydrate_cj_global', {
                'p_ingestion_id': ingestion_id, 'p_evidence_observed_at': protected['observed_at'],
                'p_expected_rows': len(rows), 'p_evidence_sha256': evidence_sha, 'p_payload': batch,
            })
            if result != len(batch):
                raise RuntimeError('hydration batch count drift')
            batches.append({'batch': index // 100 + 1, 'rows': len(batch), **transport})
        sealed, seal_transport = rpc(service_role, 'nexus_v3380_finalize_cj_global', {
            'p_ingestion_id': ingestion_id, 'p_expected_rows': len(rows), 'p_evidence_sha256': evidence_sha,
        })
        if not sealed.get('sealed') or sealed.get('encrypted_backlog_rows') != len(rows) or sealed.get('bulk_routes_activated') != 0:
            raise RuntimeError('global backlog seal failed')
        report['hydration'] = {'result': 'pass', 'batches': batches, 'installed_rows': len(rows), 'sealed': True, 'bulk_routes_activated': 0, 'transport': seal_transport}
        checks, verification_transport = verify(token, ingestion_id, len(rows))
        report['production_verification'] = {'result': 'pass', 'checks': checks, 'transport': verification_transport}
        report['result'] = 'pass'
    except Exception:
        try:
            report['rollback'] = rollback(token)
        finally:
            report['result'] = 'rolled_back_after_failure'
            OUT.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
        raise
    OUT.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
    print(json.dumps({'result': 'pass', 'encrypted_backlog_rows': len(rows), 'countries_with_candidates': checks['candidate_countries'], 'bulk_routes_activated': 0, 'selected_fresh_routes': checks['selected_fresh_routes']}, sort_keys=True))


if __name__ == '__main__':
    main()
