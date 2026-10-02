#!/usr/bin/env python3
"""Renews the Sign in with Apple client secret for web sign-in and gives it to Supabase.

Apple's client secret is a JWT signed with the Sign in with Apple key (.p8). It lasts at most
six months, so run this again before it expires (the date is printed and kept in STRATEGY.md).

    scripts/apple-web-secret.py            # sign, then update the Supabase auth config
    scripts/apple-web-secret.py --dry-run  # sign only, print nothing secret

Needs: .secrets/AuthKey_<KEYID>.p8 with Sign in with Apple, and the Supabase CLI's access token
in the macOS keychain (supabase login). The secret is never printed.
"""
import base64, glob, json, os, subprocess, sys, time, urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

TEAM = "4UM3XVUN9Y"
SERVICES_ID = "app.ambernotes.signin"  # web sign-in; must come first in the client id list
BUNDLE_ID = "dev.emilwagman.pane"      # native sign-in on iPhone and Mac
KEY_ID = "P3XCVJ77T9"
PROJECT = "rodegaeruhyybqilrnpn"
LIFETIME = 180 * 24 * 3600

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def client_secret() -> tuple[str, int]:
    with open(os.path.join(root, ".secrets", f"AuthKey_{KEY_ID}.p8"), "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    now = int(time.time())
    exp = now + LIFETIME
    header = b64(json.dumps({"alg": "ES256", "kid": KEY_ID}).encode())
    claims = b64(json.dumps({"iss": TEAM, "iat": now, "exp": exp, "aud": "https://appleid.apple.com",
                             "sub": SERVICES_ID}).encode())
    r, s = decode_dss_signature(key.sign(f"{header}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
    sig = b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"{header}.{claims}.{sig}", exp


def access_token() -> str:
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "access-token", "-w"],
                         capture_output=True, text=True, check=True).stdout.strip()
    prefix = "go-keyring-base64:"
    return base64.b64decode(raw[len(prefix):]).decode() if raw.startswith(prefix) else raw


def main() -> None:
    secret, exp = client_secret()
    expires = time.strftime("%Y-%m-%d", time.gmtime(exp))
    if "--dry-run" in sys.argv:
        print(f"signed a secret for {SERVICES_ID} with key {KEY_ID}; it would expire {expires}")
        return
    body = json.dumps({
        "external_apple_enabled": True,
        "external_apple_client_id": f"{SERVICES_ID},{BUNDLE_ID}",
        "external_apple_secret": secret,
    }).encode()
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{PROJECT}/config/auth", data=body, method="PATCH",
                                 headers={"Authorization": f"Bearer {access_token()}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        conf = json.load(resp)
    print(f"Supabase Apple client ids: {conf.get('external_apple_client_id')}; secret set: {bool(conf.get('external_apple_secret'))}")
    print(f"The secret expires {expires}. Run this again before then.")


main()
