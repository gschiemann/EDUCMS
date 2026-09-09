# Database TLS — identity verification

## The one-line answer

**Prisma silently ignores libpq's `sslmode=verify-full` and `sslrootcert`.**
Identity verification IS achievable, but only through Prisma's *own* parameter
names: **`sslaccept=strict` + `sslcert=<path to the CA>`**.

Setting `sslmode=verify-full&sslrootcert=…` on a Prisma datasource is the worst
possible outcome — it looks like verification, reads like verification in a code
review, and does nothing at all. That is why this file exists.

## What was proven, and how

Measured 2026-09-08 on **Linux** (`node:20-alpine`, which was the digest-pinned
production base image at the time of the measurement), **Prisma 5.22.0** — the
version `pnpm-lock.yaml` resolves `^5.12.1` to.

> **Base image moved later the same day.** `Dockerfile` now pins
> `node:22-alpine` (Node 20 reached end of life on 2026-04-30). The findings
> below are unchanged by that: what they establish is how **Prisma's Rust
> engine** parses connection-string parameters — that it silently drops libpq
> spellings like `sslmode=verify-full` / `sslrootcert=` and honours
> `sslaccept=strict` + `sslcert=` instead. That is a property of Prisma 5.22.0,
> which did not move. The Node-22 image was booted against a real Postgres and
> applied all 114 migrations, so the engine still loads and connects; the
> WRONG-CA table below was **not** re-run on 22, and if you need it to be
> current for an audit, re-run it rather than assuming.

Harness: a `postgres:16-alpine` with `ssl=on`, serving a certificate whose
CN/SAN is `pgtls.test`, signed by a purpose-built "GOOD" CA. A second,
unrelated "WRONG" CA was generated that provably cannot have signed it. The
container was reachable under three names — `pgtls.test` and
`pgtls-alias.test` (both in the SAN) and `tlsproof-pg` (deliberately *not*).

**A TLS parameter is only honoured if the WRONG-CA case FAILS.** Anything that
connects while trusting a CA that could not have signed the server's
certificate is being ignored. Every row below was run; nothing is inferred.

| Connection parameters | Result |
|---|---|
| `sslmode=disable` | connects, plaintext |
| `sslmode=require` *(what production runs today)* | connects, TLSv1.3, **unverified** |
| `sslmode=verify-full` + `sslrootcert=`**GOOD** | connects |
| `sslmode=verify-full` + `sslrootcert=`**WRONG** | **connects — IGNORED** |
| `sslmode=verify-ca` + `sslrootcert=`**WRONG** | **connects — IGNORED** |
| `sslmode=verify-full`, no CA at all | **connects — IGNORED** |
| `sslaccept=strict` + `sslcert=`**GOOD** | connects |
| `sslaccept=strict` + `sslcert=`**WRONG** | **FAILS** — `certificate verify failed` |
| `sslaccept=strict`, no CA at all | **FAILS** — no trust anchor |
| `sslaccept=strict` + GOOD CA, hostname **not** in SAN | **FAILS** — `(hostname mismatch)` |

The harness was itself controlled: the same four cases run through raw
`node-postgres` with an explicit `ssl` config behaved exactly as expected
(good CA connects, wrong CA fails "unable to verify the first certificate",
hostname outside the SAN fails on the name, `rejectUnauthorized:false`
connects). So a "connect" in the Prisma rows above is a real finding about
Prisma, not a harness that cannot detect anything.

### `sslaccept=strict` is verify-FULL, not verify-ca

Isolated by holding the server, certificate and CA constant and varying *only*
the hostname used to reach it:

| Host | In SAN? | Result |
|---|---|---|
| `pgtls.test` | yes | connects |
| `pgtls-alias.test` | yes | connects |
| `tlsproof-pg` | **no** | **FAILS — `(hostname mismatch)`** |

So `sslaccept=strict` validates the chain **and** the hostname. It is the full
guarantee, not half of it.

## Proven against the real production endpoint

Everything above is a lab. It was then re-run against
`aws-1-us-east-1.pooler.supabase.com:5432` — the real Supavisor session-mode
endpoint — **using a deliberately wrong password, so no credential was needed**.
TLS is negotiated *before* authentication, so the layer the error comes from is
the measurement:

| Against production | Result | Means |
|---|---|---|
| `sslmode=require` | `FATAL … tenant/user … not found` | reached auth; cert never verified |
| `sslaccept=strict` + this CA | `FATAL … tenant/user … not found` | **TLS fully verified**, reached auth |
| `sslaccept=strict` + WRONG CA | `error:0A000086 … certificate verify failed` | negative control fires |
| `sslmode=verify-full` + WRONG `sslrootcert` | `FATAL … tenant/user … not found` | **ignored on production too** |

The certificate that endpoint actually presents:

```
leaf   CN=*.pooler.supabase.com   SAN: *.pooler.supabase.com, *.pooler.supabase.co
       valid 2025-03-12 .. 2030-03-11
  ^--  CN=Supabase Intermediate 2021 CA
  ^--  CN=Supabase Root 2021 CA   (self-signed, valid 2021-04-28 .. 2031-04-26)
```

Two consequences worth stating plainly:

1. The wildcard SAN `*.pooler.supabase.com` **does** cover
   `aws-1-us-east-1.pooler.supabase.com`, so turning on hostname verification
   will not break the current host.
2. This chain is **not** in the public WebPKI — verifying it against the system
   CA bundle fails with `self-signed certificate in certificate chain`. The root
   must be pinned. That is what this directory is for.

## The file in this directory

`supabase-prod-ca-2021.crt` — Supabase's public root CA.

* `sha256` of the DER encoding: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`
* Asserted at image build time by the `Dockerfile`, which also copies it to
  `/etc/ssl/venueos/supabase-prod-ca-2021.crt` mode `0644` (readable by
  `USER node`).
* Bootstrapped out-of-band, not simply scraped off the wire: the copy published
  at `https://supabase-downloads.s3.amazonaws.com/prod/ssl/prod-ca-2021.crt`
  (fetched over WebPKI-validated HTTPS) and the root the server presents have
  **the same DER sha256**. Trusting the wire alone would have been circular.

The DER digest is pinned rather than the digest of the PEM file, because the
DER is the certificate's canonical identity — reformatting or re-wrapping the
PEM changes the file's hash but not the certificate's.

## The exact configuration

Append to **both** `DATABASE_URL` and `DIRECT_URL` in the Railway environment:

```
sslmode=require&sslaccept=strict&sslcert=/etc/ssl/venueos/supabase-prod-ca-2021.crt
```

Full values (note `connection_limit` / `pool_timeout` stay exactly as CLAUDE.md
requires — session mode, port 5432, low pool):

```
DATABASE_URL=postgresql://USER:PASS@aws-1-us-east-1.pooler.supabase.com:5432/postgres?connection_limit=10&pool_timeout=20&sslmode=require&sslaccept=strict&sslcert=/etc/ssl/venueos/supabase-prod-ca-2021.crt
DIRECT_URL=postgresql://USER:PASS@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&sslaccept=strict&sslcert=/etc/ssl/venueos/supabase-prod-ca-2021.crt
```

`sslmode=require` is kept alongside `sslaccept=strict` deliberately: `sslmode`
still controls *whether* TLS is demanded, and `sslaccept` controls whether the
peer is *verified*. Dropping `sslmode` would leave the former at its default.

### Before you set it

* **The path only exists inside the production image.** A developer laptop or a
  CI job that copies this URL verbatim will fail to connect — there is no
  `/etc/ssl/venueos/` there. Local `.env` keeps `sslmode=require`.
* `DIRECT_URL` is what `prisma migrate deploy` uses in `scripts/railway-start.sh`,
  so a mistake here fails the boot, not just a query. Change one variable, deploy,
  confirm `/api/v1/health` reports `db:"ok"`, then change the other.

### The failure mode you are accepting

Pinning a root means a Supabase root-CA rotation breaks every connection at
once rather than degrading. The current root runs to **2031-04-26** and the leaf
to **2030-03-11**, so this is a long-dated risk, not an imminent one — but it is
real, and the recovery is to drop `sslaccept=strict&sslcert=…` from both URLs
(reverting to today's encrypted-but-unverified behaviour) while the new root is
added here.

## If you are tempted to "fix" this with libpq syntax

Don't. It is not a typo and it is not a Prisma version that is too old — 5.22.0
is what production runs, and it was measured on production's own base image.
Prisma's Rust engine parses its own parameter vocabulary (`sslaccept`,
`sslcert`, `sslidentity`, `sslpassword`) and drops libpq spellings it does not
recognise instead of rejecting them. If a future Prisma release starts honouring
`sslmode=verify-full`, re-run the table above before believing it — and keep the
wrong-CA row, because that is the only row that can tell the difference.
