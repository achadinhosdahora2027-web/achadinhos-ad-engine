#!/usr/bin/env python3
"""
Auto-refresh do token OAuth 2.0 do Twitter/X para os workflows.
1. Testa o access token atual (GET /2/users/me — gratuito)
2. Se expirado/inválido: renova via refresh_token (rotação completa)
3. Persiste o novo par nos GitHub Secrets do próprio repositório (via GITHUB_PAT)
"""
import os, json, base64, urllib.request, urllib.parse, urllib.error

AT = os.environ.get("TWITTER_OAUTH2_ACCESS_TOKEN", "")
RT = os.environ.get("TWITTER_OAUTH2_REFRESH_TOKEN", "")
CID = os.environ.get("TWITTER_OAUTH2_CLIENT_ID", "")
CSEC = os.environ.get("TWITTER_OAUTH2_CLIENT_SECRET", "")
PAT = os.environ.get("GITHUB_PAT", "")
REPO = os.environ.get("GITHUB_REPOSITORY", "")


def api(url, method="GET", headers=None, data=None):
    h = dict(headers or {})
    req = urllib.request.Request(url, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


if not AT:
    print("sem OAuth2 AT configurado — pulando refresh (publisher usara OAuth1)")
    raise SystemExit(0)

st, _ = api("https://api.twitter.com/2/users/me", headers={"Authorization": f"Bearer {AT}"})
if st == 200:
    print("✓ access token OAuth2 ainda válido — nada a fazer")
    raise SystemExit(0)

print(f"access token inválido (HTTP {st}) — renovando via refresh_token...")
if not (RT and CID and CSEC):
    print("✗ refresh indisponível: TWITTER_OAUTH2_REFRESH_TOKEN/CLIENT_ID/CLIENT_SECRET ausentes")
    raise SystemExit(0)

auth = base64.b64encode(f"{CID}:{CSEC}".encode()).decode()
st, body = api(
    "https://api.twitter.com/2/oauth2/token",
    "POST",
    {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
    urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": RT,
                            "client_id": CID, "client_secret": CSEC,
                            "client_type": "third_party_app"}).encode(),
)
try:
    d = json.loads(body)
except Exception:
    d = {}
if st != 200 or "access_token" not in d:
    print(f"✗ refresh falhou (HTTP {st}): {body[:180]}")
    raise SystemExit(0)

new_at = d["access_token"]
new_rt = d.get("refresh_token", RT)
print("✓ tokens renovados com sucesso — atualizando GitHub Secrets...")

st, body = api(
    f"https://api.github.com/repos/{REPO}/actions/secrets/public-key",
    headers={"Authorization": f"Bearer {PAT}", "Accept": "application/vnd.github+json"},
)
pk = json.loads(body)

from nacl import encoding, public as npub  # pip install pynacl (no workflow)

box = npub.SealedBox(npub.PublicKey(pk["key"].encode(), encoding.Base64Encoder()))


def put_secret(name, val):
    enc = box.encrypt(val.encode())
    st, _ = api(
        f"https://api.github.com/repos/{REPO}/actions/secrets/{name}",
        "PUT",
        {"Authorization": f"Bearer {PAT}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"},
        json.dumps({"encrypted_value": base64.b64encode(enc).decode(), "key_id": pk["key_id"]}).encode(),
    )
    print(f"  secret {name}: HTTP {st}")


put_secret("TWITTER_OAUTH2_ACCESS_TOKEN", new_at)
put_secret("TWITTER_OAUTH2_REFRESH_TOKEN", new_rt)
print("✓ par renovado persistido — próximo ciclo já nasce atualizado")
