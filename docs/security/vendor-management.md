# Vendor management

**Owner:** VenueOS owner · **Last reviewed:** 2026-10-23 · **Covers:** every third party that runs VenueOS or receives data from it

## Rules

1. A vendor goes on the sub-processor list in code (`apps/web/src/lib/legal-entity.ts`, which renders Annex B of the public DPA) before it receives any customer data.
2. Customers' administrators get at least 30 days' notice before a sub-processor is added or replaced (DPA section 5).
3. Send the least data that does the job. Prefer scoped, expiring credentials held in the provider's secret store, and keep MFA on the vendor account ([access-control.md](access-control.md)).
4. The owner reviews each vendor once a year: what it still does for us, what it sees, its published security page and any incident notices. A vendor's own security announcement triggers a review the same day.
5. A vendor with a security event is treated as having exposed every secret it held. The worked example is in [incident-response.md](incident-response.md).
6. When a vendor is removed: revoke its keys, ask it to delete any customer data, update the list and notify customers.

## Sub-processors and what each sees

| Vendor | What it does for us | What it sees | Location |
|---|---|---|---|
| Supabase (on Amazon Web Services) | Database and file storage | Everything stored: accounts, settings, content, the audit log, uploaded files, and the encrypted form of stored credentials | US East |
| Railway | API hosting, real-time messaging to screens, cache (Redis), page renderer | API traffic after TLS ends at its edge, application logs, the API's environment variables (which hold our secrets), and the cache contents (sessions, rate-limit counters, signed messages) | US West |
| Vercel | Web dashboard and player hosting; DNS for the domain | Web requests, static files and the web app's server-side variables. It runs the code that holds the durable-session cookie, and it controls DNS for `venue-os.app` | Global edge |
| GitHub | Source code, CI, releases | Source code (public today), CI logs and our CI secrets, and the encrypted database backups. It never holds a backup in plaintext | US |
| Resend | Transactional email | Recipient, subject and body of every email we send: sign-in codes, invitations, password resets, notices | US |
| Sentry | Error monitoring | Error reports with sensitive values removed before they are sent (default personal-data collection is off, and a redaction pass runs) | US |
| Stripe | Subscription billing | Billing contact, subscription and payment status. Card numbers are entered only on Stripe's pages and never reach VenueOS | US |
| OpenAI, Google (Gemini), Anthropic | AI features | Only when a feature uses VenueOS-provided AI: the text or image the user supplies or approves for that request. We do not authorize them to train on it. A customer that connects its own key sends requests to its own provider account, which is not our sub-processor | US |
| Google Maps Platform | Address lookup and the Google Reviews app | The address being looked up; place IDs for Reviews | US |
| OpenStreetMap (Nominatim), US Census geocoder | Fallback address lookup | The address being looked up, only when the primary lookup is down or finds nothing | EU/UK, US |
| Open-Meteo, ipapi.co | Weather widgets | Called by the screen itself: its network address and the widget's location. ipapi.co only when the widget has no location set | Europe, US |
| Pexels | Stock photos for AI-designed boards | Search words only | Global |
| Meta (Instagram, Facebook) | Showing posts from accounts the customer connects | Only when the customer connects an account | US |
| Forward Email | Forwards mail sent to our role addresses (security@, privacy@, support@, sales@) | Whatever is emailed to those addresses | Not recorded |

Services a customer chooses to connect, such as its point-of-sale system, calendar, streaming service, single sign-on provider, Clever roster sync or sports feed, are the customer's own providers and not our sub-processors. The tokens we hold for them are encrypted ([data-handling.md](data-handling.md)).

## Assurance and exit

- Our hosting providers publish their own independent security audit reports, and the annual review checks them. VenueOS does not hold such a report itself.
- The stack uses standard parts: Postgres, a Docker image and Redis. [`docs/SELF-HOSTING-MIGRATION.md`](../SELF-HOSTING-MIGRATION.md) sets out what a move to our own infrastructure involves.
- Vercel serves our DNS, Railway holds the API's secrets, Supabase holds the data and GitHub builds and releases the software. A takeover of any of those accounts is as serious as a breach of our own systems, which is why MFA on every vendor account is a requirement, not a preference.

## Gaps

- Forward Email is not on the public sub-processor list, although support mail can contain customer information. It should be added.
- **Not in place:** a written record of each annual vendor review.
- **Not in place:** a failover provider for hosting, database or storage.
