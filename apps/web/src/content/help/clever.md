---
title: Connecting Clever for rostering
category: Clever
updated: 2026-04-16
excerpt: Auto-sync staff, classrooms, and bell schedules from your SIS via Clever's secure data API.
---

# Connecting Clever for rostering

Clever is the most common way US K-12 districts share SIS data with edtech vendors. EduSignage uses Clever to keep staff accounts, classrooms, and bell schedules in sync — so you don't have to re-enter them every August.

## What we sync

- **Staff users** — email, name, role (mapped from Clever's job title)
- **Schools** — each Clever school becomes a child tenant of your district
- **Sections / classrooms** — powers the Class Schedule Board template
- **Bell schedules** — where available in Clever; otherwise we use your manually entered schedule
- **Terms / grading periods** — for countdowns and term-based scheduling

We do **not** sync student PII. Student data is scoped to the Clever `students` endpoint and we intentionally do not request it. See our [FERPA statement](/ferpa) for details.

## Connecting your district

1. In the EduSignage dashboard, go to **Settings → Integrations → Clever**.
2. Click **Connect via Clever OAuth**.
3. A Clever-hosted consent screen opens. Log in as a Clever district admin and approve the data scopes we request.
4. You'll be redirected back and the first sync kicks off automatically. Initial syncs for a 10-school district take about 5 minutes.

## Ongoing sync

Clever pushes deltas to us via webhook as changes happen, plus a full reconciliation nightly. You can force a manual sync from the integrations page if you've just made a big change in your SIS.

## Mapping Clever roles to EduSignage roles

| Clever job title | EduSignage role |
|---|---|
| District Administrator | DISTRICT_ADMIN |
| School Administrator / Principal | SCHOOL_ADMIN |
| Teacher, Staff | CONTRIBUTOR |
| (anything else) | RESTRICTED_VIEWER |

You can override individual users after they're created — the sync won't overwrite manual role changes.

## Disconnecting

Disconnect from **Settings → Integrations → Clever → Disconnect**. Existing users and classrooms stay put; they just stop receiving updates. You can re-connect later and a full sync will reconcile any changes.

## Security + privacy

- We receive only the scopes you approve in the Clever consent screen
- Data is stored encrypted at rest
- We never redistribute Clever-sourced data to third parties
- You can request a full data deletion by contacting privacy@edusignage.app — see our [privacy policy](/privacy)
