#!/usr/bin/env python3
"""
Validação completa do OAuth2 do Twitter/X (on-demand):
  A) client_credentials — prova o par Client ID + Client Secret
  B) refresh_token (com pedido de escopo de escrita) — prova a renovação e revela os escopos reais
  C) persiste nos 4 repositórios: credenciais provadas + tokens renovados (via ROTATION_PAT)
Nunca imprime tokens — apenas status HTTP, escopos e erros.
"""
import os, json, base64, urllib.request, urllib.parse, urllib.error

RT   = os.environ.get("TWITTER_OAUTH2_REFRESH_TOKEN", "")
CID  = os.environ.get("TEST_CLIENT_ID") or os.environ.get("TWITTER_OAUTH2_CLIENT_ID", "")
CSEC = os.environ.get("TEST_CLIENT_SECRET") or os.environ.get("TWITTER_OAUTH2_CLIENT_SECRET", "")
VAULTED_CID   = os.environ.get("VAULTED_TWITTER_OAUTH2_CLIENT_ID", "")
VAULTED_CSEC  = os.environ.get("VAULTED_TWITTER_OAUTH2_CLIENT_SECRET", "")
PAT  = os.environ.get("GITHUB_PAT", "")
REPOS = [
    "achadinhosdahora2027-web/aquitemachadinhos",
    "achadinhosdahora2027-web/achadinhos-ad-engine",
    "achadinhosdahora2027-web/nexus-ai-v2",
    "achadinhosdahora2027-web/solvegrid",
]
WRITE_SCOPE = "tweet.write tweet.read users.read offline.access"

if os.environ.get("TEST_CLIENT_ID"):
    print(f"modo teste: id={CID[:16]}… ({len(CID)}), secret ({len(CSEC)} chars)")


def call(url, method="GET", headers=None, data=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def token_grant(body_extra):
    auth = base64.b64encode(f"{CID}:{CSEC}".encode()).decode()
    body_extra.update({"client_id": CID, "client_secret": CSEC, "client_type": "third_party_app"})
    return call(
        "https://api.twitter.com/2/oauth2/token", "POST",
        {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        urllib.parse.urlencode(body_extra).encode())


proven = False
print("=" * 70)
print("A) CLIENT_CREDENTIALS — prova do par Client ID + Client Secret")
st, body = token_grant({"grant_type": "client_credentials", "scope": "tweet.read users.read"})
try:
    d = json.loads(body)
except Exception:
    d = {}
if st == 200:
    proven = True
    print(f"  ✓ HTTP {st} — PAR OAUTH2 VÁLIDO (escopos: {d.get('scope', '?')})")
else:
    print(f"  ✗ HTTP {st} — {(d.get('error_description') or body)[:170]}")

new_at = new_rt = None
print("B) REFRESH_TOKEN — renovação + escopos reais")
if RT:
    st, body = token_grant({"grant_type": "refresh_token", "refresh_token": RT, "scope": WRITE_SCOPE})
    try:
        d = json.loads(body)
    except Exception:
        d = {}
    if st != 200:
        print(f"  escopo de escrita recusado (HTTP {st}: {(d.get('error_description') or body)[:120]})")
        print("  → tentando renovação simples (escopos originais)...")
        st, body = token_grant({"grant_type": "refresh_token", "refresh_token": RT})
        try:
            d = json.loads(body)
        except Exception:
            d = {}
    if st == 200 and "access_token" in d:
        scope = d.get("scope", "?")
        new_at, new_rt = d["access_token"], d.get("refresh_token", RT)
        print(f"  ✓ HTTP {st} — RENOVAÇÃO OK! Escopos: {scope}")
        print(f"  tweet.write: {'SIM — postagem autorizada' if 'tweet.write' in scope else 'NÃO → app precisa de permissão Read+Write no portal'}")
    else:
        print(f"  ✗ HTTP {st} — {(d.get('error_description') or body)[:170]}")
else:
    print("  (sem refresh token no ambiente)")
print("=" * 70)

to_persist = []
if proven:
    if CID != VAULTED_CID:
        to_persist.append(("TWITTER_OAUTH2_CLIENT_ID", CID))
    if CSEC != VAULTED_CSEC:
        to_persist.append(("TWITTER_OAUTH2_CLIENT_SECRET", CSEC))
if new_at:
    to_persist.append(("TWITTER_OAUTH2_ACCESS_TOKEN", new_at))
    to_persist.append(("TWITTER_OAUTH2_REFRESH_TOKEN", new_rt))

if not to_persist:
    print("C) nada a persistir (par não provado e/ou sem mudanças)")
else:
    print(f"C) PERSISTINDO {len(to_persist)} SECRET(S) NOS 4 REPOS (ROTATION_PAT)")
    from nacl import encoding, public as npub
    ok = fail = 0
    for repo in REPOS:
        st2, pk_body = call(f"https://api.github.com/repos/{repo}/actions/secrets/public-key",
                            headers={"Authorization": f"Bearer {PAT}", "Accept": "application/vnd.github+json"})
        if st2 != 200:
            print(f"  {repo}: public-key HTTP {st2}")
            fail += len(to_persist)
            continue
        pk = json.loads(pk_body)
        box = npub.SealedBox(npub.PublicKey(pk["key"].encode(), encoding.Base64Encoder()))
        for name, val in to_persist:
            enc = base64.b64encode(box.encrypt(val.encode())).decode()
            st3, _ = call(f"https://api.github.com/repos/{repo}/actions/secrets/{name}", "PUT",
                          {"Authorization": f"Bearer {PAT}", "Accept": "application/vnd.github+json",
                           "Content-Type": "application/json"},
                          json.dumps({"encrypted_value": enc, "key_id": pk["key_id"]}).encode())
            ok += (st3 in (201, 204))
            fail += (st3 not in (201, 204))
        print(f"  {repo.split('/')[1]}: ✓")
    print(f"  total: {ok} ok, {fail} falhas")
print("=" * 70)
