#!/usr/bin/env python3
"""
Validação completa do OAuth2 do Twitter/X (on-demand):
  A) client_credentials — prova o par Client ID + Client Secret
  B) refresh_token (com pedido de escopo de escrita) — prova a renovação e revela os escopos reais
  C) se renovado — persiste o par novo nos 4 repositórios via ROTATION_PAT
Nunca imprime tokens — apenas status HTTP, escopos e erros.
"""
import os, json, base64, urllib.request, urllib.parse, urllib.error

RT   = os.environ.get("TWITTER_OAUTH2_REFRESH_TOKEN", "")
CID  = os.environ.get("TWITTER_OAUTH2_CLIENT_ID", "")
CSEC = os.environ.get("TWITTER_OAUTH2_CLIENT_SECRET", "")
PAT  = os.environ.get("GITHUB_PAT", "")
REPOS = [
    "achadinhosdahora2027-web/aquitemachadinhos",
    "achadinhosdahora2027-web/achadinhos-ad-engine",
    "achadinhosdahora2027-web/nexus-ai-v2",
    "achadinhosdahora2027-web/solvegrid",
]
WRITE_SCOPE = "tweet.write tweet.read users.read offline.access"


def call(url, method="GET", headers=None, data=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


print("=" * 70)
print("A) CLIENT_CREDENTIALS — prova do par Client ID + Client Secret")
auth = base64.b64encode(f"{CID}:{CSEC}".encode()).decode()
st, body = call(
    "https://api.twitter.com/2/oauth2/token", "POST",
    {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
    urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": CID,
                            "client_secret": CSEC, "client_type": "third_party_app",
                            "scope": "tweet.read users.read"}).encode())
try:
    d = json.loads(body)
except Exception:
    d = {}
if st == 200:
    print(f"  ✓ HTTP {st} — PAR OAUTH2 VÁLIDO (bearer app-only emitido; escopos: {d.get('scope', '?')})")
else:
    print(f"  ✗ HTTP {st} — {(d.get('error_description') or body)[:170]}")

print("B) REFRESH_TOKEN — prova da renovação + escopos reais da conta")
st, body = call(
    "https://api.twitter.com/2/oauth2/token", "POST",
    {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
    urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": RT,
                            "client_id": CID, "client_secret": CSEC,
                            "scope": WRITE_SCOPE}).encode())
try:
    d = json.loads(body)
except Exception:
    d = {}
if st != 200:
    print(f"  escopo de escrita recusado (HTTP {st}: {(d.get('error_description') or body)[:130]})")
    print("  → tentando renovação simples (escopos originais)...")
    st, body = call(
        "https://api.twitter.com/2/oauth2/token", "POST",
        {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": RT,
                                "client_id": CID, "client_secret": CSEC}).encode())
    try:
        d = json.loads(body)
    except Exception:
        d = {}

if st == 200 and "access_token" in d:
    scope = d.get("scope", "?")
    print(f"  ✓ HTTP {st} — RENOVAÇÃO OK! Escopos concedidos: {scope}")
    print(f"  tweet.write presente: {'SIM — postagem autorizada no token' if 'tweet.write' in scope else 'NÃO → app precisa de permissão Read+Write no Developer Portal'}")
    new_at, new_rt = d["access_token"], d.get("refresh_token", RT)
else:
    print(f"  ✗ HTTP {st} — {(d.get('error_description') or body)[:170]}")
    raise SystemExit(0)

print("C) PERSISTINDO PAR RENOVADO NOS 4 REPOS (ROTATION_PAT)")
from nacl import encoding, public as npub

ok = fail = 0
for repo in REPOS:
    st2, pk_body = call(f"https://api.github.com/repos/{repo}/actions/secrets/public-key",
                        headers={"Authorization": f"Bearer {PAT}", "Accept": "application/vnd.github+json"})
    if st2 != 200:
        print(f"  {repo}: public-key HTTP {st2}")
        fail += 2
        continue
    pk = json.loads(pk_body)
    box = npub.SealedBox(npub.PublicKey(pk["key"].encode(), encoding.Base64Encoder()))
    for name, val in [("TWITTER_OAUTH2_ACCESS_TOKEN", new_at), ("TWITTER_OAUTH2_REFRESH_TOKEN", new_rt)]:
        enc = base64.b64encode(box.encrypt(val.encode())).decode()
        st3, _ = call(f"https://api.github.com/repos/{repo}/actions/secrets/{name}", "PUT",
                      {"Authorization": f"Bearer {PAT}", "Accept": "application/vnd.github+json",
                       "Content-Type": "application/json"},
                      json.dumps({"encrypted_value": enc, "key_id": pk["key_id"]}).encode())
        ok += (st3 in (201, 204))
        fail += (st3 not in (201, 204))
print(f"  secrets atualizados: {ok} ok, {fail} falhas")
print("=" * 70)
