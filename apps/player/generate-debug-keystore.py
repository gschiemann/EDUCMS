"""
Generate a stable debug keystore for the EduCMS Player APK.

WHY: CI's `assembleDebug` previously generated a fresh per-runner debug
keystore on every build, so each release was signed with a different key.
This made automatic OTA installs impossible — Android's PackageInstaller
rejects an upgrade if the new APK's signature doesn't match the installed
one (INSTALL_FAILED_UPDATE_INCOMPATIBLE). Operators had to uninstall +
reinstall via USB on every upgrade, which also wiped pairing.

This script generates a single fixed PKCS12 keystore committed at
apps/player/app/debug.keystore. CI signs every build with the same key
→ OTA installs succeed → pairing survives upgrades.

Run once:
    python apps/player/generate-debug-keystore.py

Reproducible result is NOT a goal — we only run this if the keystore
needs to be regenerated for some reason (key compromise, etc). Once
the keystore exists, every CI build uses it as-is.

The standard Android debug keystore properties:
  - storePassword: "android"
  - keyAlias:      "androiddebugkey"
  - keyPassword:   "android"
  - DN:            CN=Android Debug, O=Android, C=US
  - Validity:      30 years
  - Key:           RSA 2048

Format: PKCS12 (modern, supported by Java 9+ / AGP 8.x). AGP autodetects
format by file content; the .keystore extension doesn't matter.
"""

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12, BestAvailableEncryption
from cryptography.x509.oid import NameOID
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

OUTPUT_PATH = Path(__file__).parent / "app" / "debug.keystore"
PASSWORD = b"android"
ALIAS = "androiddebugkey"


def main() -> None:
    if OUTPUT_PATH.exists():
        print(f"REFUSING — {OUTPUT_PATH} already exists.", file=sys.stderr)
        print("Delete it first if you really want to regenerate the keystore.", file=sys.stderr)
        print("This will invalidate every previously-signed APK.", file=sys.stderr)
        sys.exit(1)

    print(f"Generating RSA-2048 key + self-signed cert (30-year validity)...")
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    name = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Android"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Android Debug"),
    ])

    now = datetime.now(tz=timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)  # self-signed
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=365 * 30))
        .sign(key, hashes.SHA256())
    )

    print(f"Serializing PKCS12 with PBES2/AES-256 (Java 9+ compatible)...")
    p12_bytes = pkcs12.serialize_key_and_certificates(
        name=ALIAS.encode("utf-8"),
        key=key,
        cert=cert,
        cas=None,
        encryption_algorithm=BestAvailableEncryption(PASSWORD),
    )

    OUTPUT_PATH.write_bytes(p12_bytes)
    print(f"Wrote {OUTPUT_PATH} ({len(p12_bytes)} bytes)")
    print()
    print(f"Subject:  CN=Android Debug, O=Android, C=US")
    print(f"Alias:    {ALIAS}")
    print(f"StorePwd: {PASSWORD.decode()}")
    print(f"KeyPwd:   {PASSWORD.decode()}")
    print(f"Valid:    {now.date()} -> {(now + timedelta(days=365 * 30)).date()}")


if __name__ == "__main__":
    main()
