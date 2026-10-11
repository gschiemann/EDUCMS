---
title: REST API and webhooks
category: Integrations
updated: 2026-10-11
excerpt: Connect your own systems to VenueOS with scoped API keys and signed webhooks — authentication, endpoints, rate limits and signature checks.
<!-- Source of truth (2026-10-11): apps/api/src/api-keys/api-key-scopes.ts (scopes), auth/jwt-auth.guard.ts (vos_ keys, emergency deny), api-keys.service.ts (90/365-day expiry), webhooks/webhooks.service.ts + webhook-dispatch.service.ts (events, headers, signature, retries). Document only what an API key can really do; re-check these files before adding an endpoint here. -->
---

# REST API and webhooks

VenueOS has a REST API for your own scripts and systems, plus **webhooks** that tell your systems when something happens. Like other signage platforms, access works with **API keys** you create in the dashboard — each key belongs to one organization, carries a role, and can be limited to just the areas it needs.

This page documents only what an API key can do today.

## Before you start

- Creating API keys and webhooks requires the **Super Admin** role in your organization.
- Everything happens in **Settings → Developer & audit**.
- Every request is made over HTTPS to your API base URL. For VenueOS cloud it is `https://api-production-39a1.up.railway.app/api/v1`. The exact URL for your deployment is shown under **Environment** on the Developer & audit page.

## Create an API key

1. Open **Settings → Developer & audit → API keys** and click to create a key.
2. Give it a **name** (for example "Menu price sync").
3. Choose a **role**: Super Admin, Admin, Editor or Viewer. A key can never do more than its role allows — an endpoint marked *Admin* below needs an Admin or Super Admin key.
4. Choose its **scopes** (below). Tick only what the integration needs.
5. Choose an **expiry**. Keys expire after **90 days** by default and never last longer than **365 days**.
6. Copy the key. It looks like `vos_` followed by 32 characters and is **shown only once** — VenueOS stores only a hash of it.

To rotate a key, create a new one, switch your integration over, then revoke the old one. A revoked or expired key stops working immediately.

## Authenticate

Send the key as a bearer token on every request:

```bash
curl https://api-production-39a1.up.railway.app/api/v1/screens \
  -H "Authorization: Bearer vos_YOUR_KEY"
```

Requests are scoped to the organization the key belongs to — a key can never read or change another organization's data. Every change made with a key is recorded in your **audit log** with the key that made it.

## Scopes

A scope is an area plus an access level. `read` allows GET requests; `write` allows changes and includes `read`. A key with scopes can reach **only** the areas you ticked; anything else returns 403.

| Scope | Covers |
| --- | --- |
| `content:read` / `content:write` | Assets, playlists, templates, schedules, menus and promos |
| `screens:read` / `screens:write` | Screens, screen groups, paired devices, hardware and floor plans |
| `sports:read` / `sports:write` | Scoreboards, game state, rosters and sponsor rotations |
| `integrations:read` / `integrations:write` | POS, data sources, feeds, streaming, music and webhooks |
| `analytics:read` | Dashboard stats, player logs and the audit log (read-only) |

A key created with no scopes at all is **unrestricted** — it can use every endpoint its role allows. Prefer scoped keys.

Some areas are never available to scoped keys: sign-in and sessions, people and roles, API keys themselves, billing, organization settings and security controls.

## Emergency alerts cannot be sent with an API key

This is deliberate. Sending or clearing a lockdown, evacuation, weather or any other emergency alert always requires a **signed-in person** with emergency permissions, so every alert has a named human in the audit log. Every emergency request made with an API key is refused with 403, whatever the key's role or scopes. To *react* to an alert in another system (a PA bridge, a chat channel, a paging tool), use the `emergency.triggered` webhook below.

## Endpoints

All paths are relative to your base URL. Responses are JSON. IDs are strings.

### List screens

`GET /screens` — scope `screens:read`, role Editor or higher.

```json
[
  {
    "id": "cm1screen123",
    "name": "Lobby Left",
    "status": "ONLINE",
    "screenGroupId": "cm1group456",
    "screenGroup": { "id": "cm1group456", "name": "Lobby" },
    "resolution": "3840x2160",
    "lastPingAt": "2026-10-11T15:04:05.000Z",
    "renderHealth": "OK",
    "lastRenderedAt": "2026-10-11T15:04:01.000Z",
    "effectiveLatitude": 41.4993,
    "effectiveLongitude": -81.6944,
    "geoSource": "group"
  }
]
```

`status` is `ONLINE`, `OFFLINE`, `PENDING` (never paired) or `REVOKED`. `renderHealth` is `OK`, `STALE` (the screen is reachable but has not reported a new picture recently) or `UNKNOWN`. Screens include more fields than shown here; treat any field not listed as informational and subject to change.

### List and read playlists

`GET /playlists` and `GET /playlists/{id}` — scope `content:read`, role Editor or higher.

```json
[
  {
    "id": "cm1playlist789",
    "name": "Lunch menu",
    "templateId": null,
    "createdAt": "2026-10-01T12:00:00.000Z",
    "updatedAt": "2026-10-10T09:30:00.000Z",
    "items": [
      {
        "id": "cm1item001",
        "assetId": "cm1asset222",
        "durationMs": 10000,
        "sequenceOrder": 0,
        "transitionType": "FADE",
        "muted": true,
        "asset": {
          "id": "cm1asset222",
          "fileUrl": "https://…/menu.jpg",
          "mimeType": "image/jpeg",
          "originalName": "menu.jpg"
        }
      }
    ],
    "_count": { "schedules": 1 }
  }
]
```

### Create a playlist

`POST /playlists` — scope `content:write`, role Editor or higher.

```json
{ "name": "Weekend specials", "templateId": "optional-template-id" }
```

Returns the new playlist in the same shape as above. A playlist shows on screens once it is published to them from the dashboard.

### Replace a playlist's items

`PUT /playlists/{id}/items` — scope `content:write`. Sends the **complete** list; items not in the list are removed.

```json
{
  "items": [
    { "assetId": "cm1asset222", "durationMs": 10000, "sequenceOrder": 0 },
    { "assetId": "cm1asset333", "durationMs": 15000, "sequenceOrder": 1, "transitionType": "FADE", "muted": true }
  ]
}
```

`assetId`, `durationMs` (milliseconds) and `sequenceOrder` (0, 1, 2…) are required; `transitionType` defaults to `FADE` and `muted` to `true`. Every asset must belong to your organization. Returns the updated playlist. Screens showing the playlist pick up the change automatically.

An **Editor** key cannot change a playlist that is live on screens — that needs approval, exactly like an Editor in the dashboard. Use an Admin key for live content.

### List assets

`GET /assets` — scope `content:read`, role Editor or higher.

Optional query parameters: `take` (default 500, max 1000), `skip`, and `q` (search by name). Without parameters the response is an array of assets; with any of them it is `{ "assets": [...], "total": 42, "take": 50, "skip": 0 }`.

```json
{
  "assets": [
    {
      "id": "cm1asset222",
      "originalName": "menu.jpg",
      "fileUrl": "https://…/menu.jpg",
      "mimeType": "image/jpeg",
      "status": "PUBLISHED",
      "folder": { "id": "cm1folder1", "name": "Menus" },
      "createdAt": "2026-10-01T12:00:00.000Z"
    }
  ],
  "total": 1,
  "take": 50,
  "skip": 0
}
```

Uploading new media is not available to API keys yet — upload in the dashboard, then reference the asset's `id` in a playlist.

### List schedules

`GET /schedules` — scope `content:read`, role Editor or higher. Returns each schedule with its `playlist`, and its target `screen` or `screenGroup` (each `{ id, name }`), plus `startTime`, `endTime`, `isActive` and `priority`.

### Dashboard summary

`GET /stats/overview` — scope `analytics:read`, role Admin or higher.

```json
{
  "totalScreens": 12,
  "onlineScreens": 11,
  "offlineScreens": 1,
  "activePlaylists": 7,
  "emergencyStatus": "CLEAR"
}
```

### Audit log

`GET /audit` — scope `analytics:read`, role Admin or higher. Query parameters: `from` and `to` (ISO dates), `action` (for example `PLAYLIST_ITEMS_REPLACED`), `apiKeyId` (changes made by one key), `limit` (default 50, max 200) and `offset`.

```json
{
  "items": [
    {
      "id": "cm1audit9",
      "action": "PLAYLIST_ITEMS_REPLACED",
      "targetType": "Playlist",
      "targetId": "cm1playlist789",
      "details": "{\"itemCount\":2}",
      "apiKeyId": "cm1key55",
      "createdAt": "2026-10-11T15:00:00.000Z",
      "user": null
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

`GET /audit/export` takes the same filters and returns a CSV file (up to 10,000 rows).

## Errors

Errors return a standard HTTP status with a JSON body containing a `message`, and often a stable `code`.

| Status | Meaning |
| --- | --- |
| 400 | The request body or a parameter is invalid |
| 401 | Missing, invalid, revoked or expired API key |
| 402 | The account is view-only because of billing; reads still work |
| 403 | The key's role or scopes do not allow this request, or it is an emergency action |
| 404 | Not found in your organization |
| 429 | Too many requests — slow down and retry |

## Rate limits

The API allows up to **600 requests per minute** from one client address; some sensitive endpoints allow fewer. Over the limit you get **429** — wait a few seconds and retry with backoff. Poll no more often than you need; for alerts, use a webhook instead of polling.

## Webhooks

Webhooks send an HTTPS `POST` to your server when an event happens.

### Create a webhook

1. Open **Settings → Developer & audit → Webhooks** and add an endpoint.
2. Enter a **name** and your **URL**. It must be publicly reachable on port 443 (or 80); private, local and internal addresses are refused.
3. Pick the **events**.
4. Copy the **signing secret** (`whsec_…`). It is **shown only once**.

### Events

| Event | When it is sent |
| --- | --- |
| `emergency.triggered` | An organization-wide emergency alert (or a drill) starts. A district-wide alert is sent once to each school it reaches. |

`emergency.cleared` appears in the event list but is **not delivered yet** — do not rely on it to end an alert in another system.

### Request format

```http
POST /your/webhook HTTP/1.1
Content-Type: application/json
User-Agent: VenueOS-Webhook/1.0
X-VenueOS-Event: emergency.triggered
X-VenueOS-Delivery-Id: 6f1c2a9e-…
X-VenueOS-Timestamp: 1760195045123
X-VenueOS-Signature: sha256=5d41402abc4b2a76b9719d911017c592…
```

```json
{
  "tenantId": "cm1org123",
  "event": "emergency.triggered",
  "timestamp": 1760195045123,
  "data": {
    "overrideId": "cm1override9",
    "scopeType": "tenant",
    "scopeId": "cm1org123",
    "severity": "CRITICAL",
    "type": "LOCKDOWN",
    "isDrill": false,
    "triggeredAt": "2026-10-11T15:04:05.123Z",
    "triggeredByUserId": "cm1user7",
    "originTenantId": "cm1org123"
  }
}
```

`timestamp` is milliseconds since 1970. `isDrill` is `true` for a drill — always check it before acting. `originTenantId` differs from `scopeId` when the alert was started by a parent organization (for example a district).

### Verify the signature

The signature is an HMAC-SHA256 of the timestamp, a dot, and the **raw** request body, keyed with your signing secret. Compare it in constant time, and reject requests whose timestamp is more than a few minutes old.

```javascript
// Node.js (Express) — keep the raw body for verification
const crypto = require('crypto');

app.post('/venueos', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-VenueOS-Timestamp');
  const sig = req.get('X-VenueOS-Signature') || '';
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.VENUEOS_WEBHOOK_SECRET)
    .update(`${ts}.${req.body.toString('utf8')}`)
    .digest('hex');
  const ok = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok || Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) {
    return res.status(401).end();
  }
  const event = JSON.parse(req.body.toString('utf8'));
  // …handle event.data…
  res.status(200).end();
});
```

```python
# Python (Flask)
import hmac, hashlib, os, time
from flask import request, abort

@app.post("/venueos")
def venueos():
    ts = request.headers.get("X-VenueOS-Timestamp", "")
    sig = request.headers.get("X-VenueOS-Signature", "")
    body = request.get_data()  # raw bytes
    mac = hmac.new(os.environ["VENUEOS_WEBHOOK_SECRET"].encode(),
                   ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, "sha256=" + mac):
        abort(401)
    if abs(time.time() * 1000 - int(ts)) > 5 * 60 * 1000:
        abort(401)
    return "", 200
```

### Delivery and retries

- Respond with any **2xx** status within **8 seconds**. Do slow work after responding.
- A failed delivery (a non-2xx answer, a timeout or a network error) is retried after about **5 seconds, 30 seconds and 2 minutes** — four attempts in total. Retries carry the same body, timestamp and signature.
- Each attempt has its own `X-VenueOS-Delivery-Id`, so use `event` plus `data.overrideId` to ignore a delivery you have already handled.
- The Webhooks list shows each endpoint's last delivery time and status.

## Need help?

Email support@venue-os.app. To report a security issue, email security@venue-os.app.
