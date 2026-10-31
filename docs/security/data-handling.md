# Data handling

**Owner:** VenueOS owner · **Last reviewed:** 2026-10-23 · **Covers:** what data VenueOS holds, how it is protected, how long it is kept and how it is deleted

For personal data inside a customer's account, the customer is the controller and VenueOS is its processor; the Data Processing Addendum (DPA) sets out those terms. All customer data is stored in the United States. We do not sell personal data, use customer content for advertising, or use it to train AI models.

## Data classes

| Class | Examples | Handling |
|---|---|---|
| **Secrets and credentials** (highest) | Password hashes, authenticator secrets and backup codes, passkey public keys, customers' own AI keys, point-of-sale, social and streaming connection tokens, kiosk Wi-Fi passphrases, single sign-on client secrets, signing keys, screen credentials | Never in source, logs, email or chat. Passwords are Argon2id hashes. API keys and renewable session credentials are stored only as hashes. Stored third-party credentials are encrypted (next section). Plaintext exists in memory only while it is in use |
| **Personal data** | Names, emails, roles and sign-in records; audit records (person, network address, action); screens' network addresses; optional student information on sports screens; problem-report screenshots | Access by role and organization, with changes audited. Student information follows the default-deny rule below. Screenshots are kept in a private bucket and opened only through links that expire after 30 minutes |
| **Customer content** | Uploaded images, video and documents; templates, playlists, schedules, settings | Scoped to the organization. Media that screens display is served from a public-read storage bucket under random file names, so that screens can cache it. Treat anything uploaded as something that could be shown in public. Uploads are checked by their real content and a type allow-list. Floor plans, design imports, support screenshots and player software sit in private buckets reached through short-lived signed links |
| **Operational data** | Screen health, playback records, error reports | Short retention (below). Error reports have sensitive values removed before they leave our systems |
| **Public** | Marketing pages, help articles, this documentation | No restriction |

Card numbers never reach VenueOS; they are entered only on Stripe's pages. The service is not designed for health, financial or other sensitive personal data, and customers should not upload it. Student records are not required to operate it.

## Encryption

- **In transit:** TLS for every connection, with HSTS on the dashboard and the API (one year, subdomains included). The API's connection to the database verifies the provider's certificate, and so does the backup job. Screens need only outbound HTTPS on port 443, plus a time source. Emergency messages are also signed (HMAC) and verified before they enter the broadcast path.
- **At rest:** the database and file storage are encrypted by the hosting provider. On top of that, stored credentials use envelope encryption: each record has its own AES-256-GCM data key, and a master key held only in the API's secret store wraps that data key. This covers customers' AI keys, authenticator secrets, and the connections to point-of-sale, social, streaming and similar services. Single sign-on secrets are encrypted with AES-256-GCM under their own key. Database backups are AES-256 encrypted before they leave the build runner.
- **Rotation:** the master key can be replaced without downtime and without customers re-entering credentials. A rotation window accepts the old and new key, and a job re-wraps each record's data key in place without decrypting the credential ([`docs/SECRET-ROTATION.md`](../SECRET-ROTATION.md)).

## Retention

| Data | Kept for |
|---|---|
| Content and settings | While the account is active, or until the customer deletes them |
| Playback records for proof-of-play | Detailed records 14 days, never purged ahead of the hourly roll-up that replaces them. Hourly totals 400 days |
| Screen event ledger | 30 days, capped at 2,000 rows per screen |
| Fleet health samples | 7 days |
| AI board design history | 90 days. Failed design jobs 7 days |
| Audit records | The life of the account. They cannot be edited or deleted through the service, and may be kept after the account ends for security, safety or legal reasons |
| Sessions and renewal credentials | Access tokens 1 hour; renewal credentials up to 30 days. Expired rows are purged |
| Emailed one-time codes | Short-lived, and deleted when used |
| Database backups | 30 days |
| Error reports and platform logs | Set by the provider, and short |
| After an account ends | Export available for at least 90 days, then deletion. Backups expire within 30 days of that |

## Student data

VenueOS does not need student records. Some optional features, such as athlete names and photos on sports screens, can show student information. For those:

- On public outputs, student names and photos are **hidden by default**. A school administrator must first confirm the school's directory-information notice. A photo additionally needs the photo-release confirmation and a release on file for that student.
- A family's directory opt-out hides that student's name and photo whatever any other setting says.
- A per-game switch can only make the result stricter, never looser.
- If the policy cannot be read, public outputs show no names or photos. A database blip can hide a name for a second; it cannot show one.
- The rule applies to K-12 organizations and to any organization that says it serves minors. Signed-in staff views are unchanged.
- For schools, VenueOS acts as a "school official" under FERPA. We use student information only to provide the service, and never to build profiles, sell it or train AI models.

## Deletion and requests

- Administrators can delete content, screens and users in the product. Deleting a file that is in use or a published playlist needs an explicit confirmation, and stored files are removed after the database change commits.
- Removing a user blocks sign-in, revokes their sessions and replaces the email on the account row. The audit trail keeps the history, which may include the identifier in force at the time.
- Audit records are append-only and tied to their organization, so an organization with history cannot be hard-deleted. Retiring one means archiving it, which can be reversed, and deleting its content, screens, users and stored credentials on request.
- After an account ends, administrators can export their data for at least 90 days. Deletion then follows, or comes sooner on written request. Today VenueOS carries this out by hand.
- Requests from individuals go to privacy@venue-os.app and are handled together with the customer. Administrators can download uploaded files, and export the audit log and proof-of-play reports as CSV, at any time.

## Gaps

- **Not in place:** an automated end-of-term purge. Deletion after an account ends is a manual procedure.
- **Not in place:** a separate encryption key for each credential type. One master key wraps AI keys, authenticator secrets and connection tokens.
