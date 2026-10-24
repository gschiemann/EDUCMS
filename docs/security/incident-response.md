# Incident response

**Owner:** VenueOS owner · **Last reviewed:** 2026-10-23 · **Contact:** security@venue-os.app

A security incident is anything that puts customer data, stored credentials, the integrity of an emergency alert, or the availability of the alert path at risk. The cause can be an attacker, a mistake or a vendor. Customers, researchers and staff report one to **security@venue-os.app**; vulnerability reports are covered in [vulnerability-management.md](vulnerability-management.md). Live service health is on the public `/status` page.

## Severity

Severity is set by what an exposure could do, not by whether we have seen it used.

| Level | Meaning | Response starts | First containment step | Customer notice |
|---|---|---|---|---|
| **SEV-1** | Customer data or stored credentials exposed or likely exposed; a forged or suppressed emergency alert; one organization reaching another's data; the alert path down | As soon as seen. Platform alerts email the owner in near real time; there is no overnight rotation | Within 24 hours | No later than 72 hours after we become aware that Customer Data was affected (DPA section 7). Organizations whose alerts could be affected hear as soon as the facts allow |
| **SEV-2** | Exploitable weakness with no sign of use; partial outage with a working fallback | Same business day | Within 3 business days | Only if Customer Data turns out to be involved, which makes it SEV-1 |
| **SEV-3** | Contained problem with limited impact | Within 3 business days | Within 10 business days | Normally none |
| **SEV-4** | No customer impact | Next planning cycle | None | None |

These are targets, not guarantees.

## Roles

Incident commander (declares the incident, sets severity, owns decisions and closes it), technical lead (containment, investigation, recovery), communications lead (notices to customers and vendors, checked against the DPA) and scribe (keeps the dated incident log). The owner holds all four roles today, using AI-assisted tooling. That is a known limit (see Gaps).

## How an incident runs

1. **Declare.** Open a dated incident log and set the severity. Triggers include platform alert emails, a failed workflow (which opens an `ops` issue automatically), error monitoring, and reports from customers, researchers or vendors.
2. **Preserve evidence first.** The audit log is append-only. Hosting logs are short-lived, and database connection logs behind the pooler do not show client addresses, so export what you need before changing anything.
3. **Contain** with the smallest reversible action: revoke a user's sessions or disable the account, revoke a screen's credential or an API key, rotate a secret ([`docs/SECRET-ROTATION.md`](../SECRET-ROTATION.md)), stop a player build being offered, switch off an integration, clear an alert, or roll back a deploy. Never take the alert path down to fix something else.
4. **Recover.** Fix the cause and rotate anything that may have been exposed; if exposure cannot be ruled out, assume it happened. Check `/health`, `/health/ready` and `/health/emergency-path`, and send a test alert in a test organization.
5. **Notify** (below).
6. **Review** within 10 business days of a SEV-1 or SEV-2. The review is written and blameless: timeline, root cause, what worked, what did not, and follow-ups with an owner. These policies are updated if they were wrong.

## Telling customers

- **Contract.** The DPA commits us to tell a customer's administrators without undue delay, and within 72 hours, after we become aware of an incident that leads to destruction, loss, alteration, unauthorized disclosure of or access to Customer Data. The notice says what is known, what we did and what the customer should do, with updates as we learn more.
- **Regulators and individuals.** The customer decides whether to notify them; we supply the facts. For schools we act as a "school official" and tell the school.
- **A vendor event we cannot prove touched customer data.** We still tell customers whose stored credentials could be affected, and say exactly what to rotate.
- A written summary of any SEV-1 is available to affected customers on request.

## Worked example: hosting provider exposes environment variables (2026-10-21)

**What happened.** Railway, which hosts the VenueOS API, disclosed on 2026-10-21 that customers' environment variables may have been read, and paused all deployments. We declared SEV-1 and treated every value in the API and renderer services as exposed, without trying to prove which had really been read.

**Why it mattered.** The same environment held the database credentials and the master key that seals stored third-party credentials: customers' own AI keys, point-of-sale and social connections, authenticator secrets and kiosk Wi-Fi passphrases. Together they would be enough to read them.

**First checks found no sign of misuse.** The audit log for the previous two days showed no new users and sign-ins only from our own CI test and the owner. Hosting usage matched earlier weeks with no unknown services, and payment, AI, email, maps and storage dashboards showed nothing unusual. Database connection logs do not record client addresses, so a direct login could not be ruled out independently. That is one reason the database password was rotated anyway.

**Order of response, and why.**

1. **Contain without redeploying.** Revoke the tokens kept beside the app's variables that production did not need, such as usage-dashboard tokens and a repository token.
2. **Build before you rotate.** Swapping the device-token signing secret would sign out every screen, and swapping the master key would make every stored credential unreadable at once. So we first shipped a key ring (merged and deployed 2026-10-22). During a rotation window it signs and encrypts with the new key only, and accepts both keys when verifying or decrypting.
3. **Database password and storage service key, with proof.** Each new credential is proven before use: the storage key against storage, and the database password with a fresh login through the pooler, restoring the old password automatically if that fails. The new values are staged in the hosting platform without deploying, and the GitHub secrets used by the nightly backup and release publishing are updated in the same step. One deploy and a health check follow, and the old storage key is deleted last.
4. **The two device-side secrets, through the window.** New values go in as primary and the old ones stay as "previous", in one change and one deploy. A leader-only job re-wraps each stored credential's data-key envelope under the new master key without decrypting the credential. When it reports nothing left and at least 2 hours have passed (a device token lives 1 hour), the previous values are removed and deployed, and the old secrets stop working everywhere.
5. **Everything else the environment held:** payment keys and webhook secret (with overlap where the provider allows two live keys), AI, email, maps and photo-search keys, OAuth client secrets, session and token-signing secrets, the secrets shared by web and API, and the cache password. Each is changed at the provider and in the hosting platform in one step. Each needs a deploy to take effect, so rotating at the provider first would have broken production while deploys were paused.

**How screens stay online.**

- The pause stopped deployments, not the running service. The API stayed healthy on its last version, so screens saw no change.
- Screens keep playing without the cloud. They hold their last content and the emergency content locally.
- No step is a swap. Screens renew their 1-hour tokens about every 10 minutes, so a powered-on screen moves to the new key by itself within the hour. No one is re-paired, and this step signs no operator out.
- Alert messages are signed, and during the window they verify with either key. A lockdown signed by a container on the old key is still delivered by one on the new key while a deploy briefly runs both.
- A screen that was powered off for the whole window returns on the normal expired-credential path: one controlled re-registration, content keeps playing, and the dashboard flags it for re-pairing.

**Customer guidance.** Customers whose stored credentials could be affected (their own AI keys, point-of-sale, social or single sign-on connections, or authenticator-app secrets) are told what to rotate or re-enroll and why: re-wrapping under a new master key does not make an already-exposed secret safe. Everyone else needs to do nothing.

**Where it stands (dates are US Pacific).** The key ring is live. The database password and the storage service key were replaced on 2026-10-22 and the API redeployed healthy on them. The remaining steps are being closed out and recorded in the internal rotation log, and this section is updated with the close-out date. Follow-ups: keep account-level tokens out of application environments, and add a soft usage alert on the hosting account (a hard limit would stop production).

## Gaps

- **Not in place:** an overnight on-call or paging rotation, and a second responder.
- **Not in place:** an annual tabletop exercise and a scheduled rehearsal of the secret rotation. The 2026-10-21 event is the only full-scale exercise so far.
- **Not in place:** durable log retention outside the hosting platform, and database connection logs that show the client address.
- **Not in place:** a scheduled synthetic emergency drill. The emergency-path health check is run by hand.
