#!/usr/bin/env python3
"""Read-only CJ discovery for the v3380 encrypted global backlog.

The repository receives aggregate evidence only. IDs, destinations, and tracking
URLs are kept in a mode-0600 payload outside the repository. Country-targeted
Link Search evidence is never interpreted as city-level serviceability.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path('/home/user/.v3370-protected/runtime.json')
COUNTRIES = ROOT / 'docs/evidencias/v3380-country-codes.json'
PROTECTED_OUT = Path('/home/user/.v3370-protected/cj-links-v3380.json')
CHECKPOINT = Path('/home/user/.v3370-protected/cj-links-v3380.checkpoint.json')
EVIDENCE_OUT = ROOT / 'docs/evidencias/v3380-cj-global-discovery.json'

rate_lock = threading.Lock()
next_slot = 0.0


def protected_write(path: Path, payload: dict) -> None:
    old = os.umask(0o177)
    try:
        path.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
        os.chmod(path, 0o600)
    finally:
        os.umask(old)


def request(url: str, token: str, *, data: bytes | None = None) -> bytes:
    global next_slot
    with rate_lock:
        wait = next_slot - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        next_slot = time.monotonic() + 2.65
    req = urllib.request.Request(url, data=data, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/xml' if data is None else 'application/json',
        **({'Content-Type': 'application/json'} if data is not None else {}),
    }, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read()


def xml_text(node: ET.Element, name: str) -> str:
    found = node.find(name)
    return (found.text or '').strip() if found is not None else ''


def advertisers(token: str, company_id: str) -> tuple[set[str], dict]:
    rows, page, total = [], 1, None
    while total is None or len(rows) < total:
        query = urllib.parse.urlencode({'requestor-cid': company_id, 'advertiser-ids': 'joined', 'records-per-page': 100, 'page-number': page})
        root = ET.fromstring(request('https://advertiser-lookup.api.cj.com/v3/advertiser-lookup?' + query, token))
        container = root.find('.//advertisers')
        if container is None:
            raise RuntimeError('CJ advertiser response missing container')
        total = int(container.attrib.get('total-matched', '0'))
        current = container.findall('advertiser')
        rows.extend(current)
        if not current:
            break
        page += 1
    active = {xml_text(row, 'advertiser-id') for row in rows if xml_text(row, 'account-status').lower() == 'active' and xml_text(row, 'relationship-status').lower() == 'joined'}
    return active, {'total_joined': len(rows), 'active_joined': len(active), 'pages': page - 1, 'status': 'ok'}


def contracts(token: str, company_id: str) -> tuple[set[str], dict]:
    query = 'query($publisherId:ID!,$limit:Int!,$offset:Int!){publisher{contracts(publisherId:$publisherId,limit:$limit,offset:$offset){totalCount count resultList{advertiserId status startTime endTime}}}}'
    rows, offset, total = [], 0, None
    while total is None or offset < total:
        body = json.dumps({'query': query, 'variables': {'publisherId': company_id, 'limit': 100, 'offset': offset}}, separators=(',', ':')).encode()
        payload = json.loads(request('https://programs.api.cj.com/query', token, data=body))
        if payload.get('errors'):
            raise RuntimeError('CJ contracts GraphQL returned errors')
        container = payload['data']['publisher']['contracts']
        total = int(container['totalCount'])
        current = container['resultList']
        rows.extend(current)
        if not current:
            break
        offset += len(current)
    now = datetime.now(timezone.utc)
    active = set()
    for row in rows:
        end = row.get('endTime')
        end_at = datetime.fromisoformat(end.replace('Z', '+00:00')) if end else None
        if row.get('status') == 'ACTIVE' and (end_at is None or end_at > now):
            active.add(str(row['advertiserId']))
    return active, {'total_contracts': len(rows), 'active_contract_advertisers': len(active), 'pages': (len(rows) + 99) // 100, 'status': 'ok'}


def properties(token: str, company_id: str, configured: set[str]) -> tuple[set[str], dict]:
    query = 'query($publisherId:ID!,$limit:Int!,$offset:Int!){promotionalProperties(publisherId:$publisherId,status:ACTIVE,limit:$limit,offset:$offset){totalCount resultList{id status isPrimary}}}'
    rows, offset, total = [], 0, None
    while total is None or offset < total:
        body = json.dumps({'query': query, 'variables': {'publisherId': company_id, 'limit': 100, 'offset': offset}}, separators=(',', ':')).encode()
        payload = json.loads(request('https://accounts.api.cj.com/graphql', token, data=body))
        if payload.get('errors'):
            raise RuntimeError('CJ properties GraphQL returned errors')
        container = payload['data']['promotionalProperties']
        total = int(container['totalCount'])
        current = container['resultList']
        rows.extend(current)
        if not current:
            break
        offset += len(current)
    active = {str(row['id']) for row in rows if row.get('status') == 'ACTIVE'}
    return active, {'active_properties': len(active), 'configured_active': len(active & configured), 'pages': (len(rows) + 99) // 100, 'status': 'ok'}


def tracking_url(link: ET.Element) -> str:
    for name in ('clickUrl', 'click-url'):
        value = xml_text(link, name)
        if value:
            return value
    return ''


def link_search(token: str, property_id: str, country: str) -> tuple[list[dict], dict]:
    page, records, errors, api_returned, total = 1, [], 0, 0, 0
    while True:
        query = urllib.parse.urlencode({
            'website-id': property_id, 'advertiser-ids': 'joined', 'targeted-country': country,
            'records-per-page': 1000, 'page-number': page,
        })
        try:
            root = ET.fromstring(request('https://link-search.api.cj.com/v2/link-search?' + query, token))
            container = root.find('.//links')
            if container is None:
                raise ValueError('links container unavailable')
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ET.ParseError, ValueError):
            errors += 1
            if errors <= 2:
                time.sleep(8 * errors)
                continue
            return [], {'status': 'api_error', 'pages': page, 'errors': errors}
        total = int(container.attrib.get('total-matched', '0'))
        links = container.findall('link')
        api_returned += len(links)
        for link in links:
            records.append({
                'country': country,
                'advertiser_id': xml_text(link, 'advertiser-id'),
                'advertiser_name': xml_text(link, 'advertiser-name'),
                'category': xml_text(link, 'category'),
                'language': xml_text(link, 'language'),
                'link_id': xml_text(link, 'link-id'),
                'link_name': xml_text(link, 'link-name'),
                'description': xml_text(link, 'description'),
                'link_type': xml_text(link, 'link-type'),
                'allow_deep_linking': xml_text(link, 'allow-deep-linking'),
                'promotion_start_date': xml_text(link, 'promotion-start-date') or None,
                'promotion_end_date': xml_text(link, 'promotion-end-date') or None,
                'promotion_type': xml_text(link, 'promotion-type'),
                'relationship_status': xml_text(link, 'relationship-status'),
                'mobile_optimized': xml_text(link, 'mobile-optimized'),
                'targeted_countries': xml_text(link, 'targeted-countries'),
                'destination': xml_text(link, 'destination'),
                'tracking_url': tracking_url(link),
            })
        if api_returned >= total or not links:
            break
        page += 1
    unique = {(row['advertiser_id'], row['link_id']): row for row in records}
    return list(unique.values()), {'status': 'ok', 'total_matched': total, 'api_records_returned': api_returned, 'unique_records': len(unique), 'duplicates': len(records) - len(unique), 'pages': page, 'errors': errors}


def candidate(row: dict, active_advertisers: set[str], active_contracts: set[str]) -> bool:
    text = ' '.join((row['advertiser_name'], row['category'], row['link_name'], row['description'], row['promotion_type'])).lower()
    travel = ('travel', 'trip', 'vacation', 'holiday', 'hotel', 'resort', 'accommodation', 'lodging', 'flight', 'airline', 'airfare', 'car rental', 'rent a car', 'attraction', 'activity', 'tour', 'ticket')
    legal = ('privacy policy', 'terms and conditions', 'cookie policy', 'legal notice', 'gdpr')
    return bool(row['relationship_status'].lower() == 'joined' and row['advertiser_id'] in active_advertisers and row['advertiser_id'] in active_contracts and row['tracking_url'] and row['link_type'].lower() == 'text link' and any(term in text for term in travel) and not any(term in text for term in legal))


def main() -> None:
    if not RUNTIME.is_file() or (RUNTIME.stat().st_mode & 0o777) != 0o600:
        raise SystemExit('protected runtime missing or not mode 0600')
    runtime = json.loads(RUNTIME.read_text())
    token, company_id = runtime['cj']['personal_access_token'], str(runtime['cj']['company_id'])
    configured = {str(value) for value in runtime['cj']['property_ids']}
    property_id = str(runtime['cj']['primary_property_id'])
    country_codes = json.loads(COUNTRIES.read_text())['country_codes']
    if len(country_codes) != 196 or len(set(country_codes)) != 196:
        raise SystemExit('country scope drift')

    active_advertisers, advertiser_evidence = advertisers(token, company_id)
    active_contracts, contract_evidence = contracts(token, company_id)
    active_properties, property_evidence = properties(token, company_id, configured)
    if property_id not in active_properties:
        raise SystemExit('primary CJ property is not currently active')

    links, country_evidence = [], {}
    if CHECKPOINT.is_file() and (CHECKPOINT.stat().st_mode & 0o777) == 0o600:
        checkpoint = json.loads(CHECKPOINT.read_text())
        if checkpoint.get('schema_version') == 'v3380-cj-global-checkpoint-1':
            links = checkpoint.get('candidate_links', [])
            country_evidence = checkpoint.get('country_evidence', {})
    pending = [country for country in country_codes if country not in country_evidence]
    completed = len(country_evidence)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(link_search, token, property_id, country): country for country in pending}
        for future in as_completed(futures):
            country = futures[future]
            rows, evidence = future.result()
            kept = [row for row in rows if candidate(row, active_advertisers, active_contracts)]
            links.extend(kept)
            country_evidence[country] = {
                **evidence,
                'language_counts': dict(sorted(Counter(row['language'] or 'unspecified' for row in rows).items())),
                'link_type_counts': dict(sorted(Counter(row['link_type'] or 'unspecified' for row in rows).items())),
                'active_joined_contract_records': sum(row['relationship_status'].lower() == 'joined' and row['advertiser_id'] in active_advertisers and row['advertiser_id'] in active_contracts for row in rows),
                'tracking_urls_present': sum(bool(row['tracking_url']) for row in rows),
                'protected_travel_candidates': len(kept),
            }
            completed += 1
            if completed % 10 == 0 or completed == len(country_codes):
                protected_write(CHECKPOINT, {'schema_version': 'v3380-cj-global-checkpoint-1', 'country_evidence': country_evidence, 'candidate_links': links})
            print(f'{completed}/{len(country_codes)} {country} records={len(rows)} status={evidence["status"]}', flush=True)

    observed = datetime.now(timezone.utc).isoformat()
    protected_write(PROTECTED_OUT, {
        'schema_version': 'v3380-cj-global-protected-2', 'observed_at': observed,
        'property_id': property_id, 'active_advertiser_ids': sorted(active_advertisers),
        'active_contract_advertiser_ids': sorted(active_contracts), 'links': links,
    })
    if CHECKPOINT.exists():
        CHECKPOINT.unlink()
    evidence = {
        'schema_version': 'v3380-cj-global-discovery-2', 'observed_at': observed, 'read_only': True,
        'delta_countries_queried': len(country_codes), 'advertisers': advertiser_evidence,
        'contracts': contract_evidence, 'properties': property_evidence, 'country_link_search': country_evidence,
        'summary': {
            'countries_ok': sum(row['status'] == 'ok' for row in country_evidence.values()),
            'countries_api_error': sum(row['status'] != 'ok' for row in country_evidence.values()),
            'total_api_records': sum(row.get('api_records_returned', 0) for row in country_evidence.values()),
            'total_unique_country_link_records': sum(row.get('unique_records', 0) for row in country_evidence.values()),
            'protected_active_joined_travel_candidates': len(links),
            'countries_with_protected_candidates': len({row['country'] for row in links}),
            'affiliate_urls_recorded_in_evidence': False, 'affiliate_urls_followed': False,
            'clicks_performed': False, 'impressions_created': False, 'sales_claimed': False,
            'country_target_is_city_serviceability_proof': False,
        },
        'protected_payload': {'path_not_recorded': True, 'mode': '0600', 'plaintext_in_repository': False},
    }
    EVIDENCE_OUT.write_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
    print(json.dumps(evidence['summary'], sort_keys=True))


if __name__ == '__main__':
    main()
