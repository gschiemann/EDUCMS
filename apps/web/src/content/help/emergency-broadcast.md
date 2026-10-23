---
title: Emergency broadcasts and staff SOS
category: Emergency System
updated: 2026-10-22
excerpt: Put an urgent message over whatever your screens are showing — text, or pictures, video and sound — and learn who can send and end it, what screens show and what the audit log records.
---

# Emergency broadcasts and staff SOS

An **emergency broadcast** puts an urgent message on top of whatever your screens are playing — "All staff report to the main office", "Early dismissal at 1:00 pm", "Parking lot B is closed". It is lighter than an alert such as Lockdown or Fire / Evacuate, which replaces everything on screen with that alert's content. For alerts, see the [emergency system overview](/help/emergency-system).

## Open the Broadcast page

Open **Broadcast** in the sidebar (on a phone, under **More**) — it is shown to everyone who can send. The page also lives at your workspace address followed by `/emergency/broadcast`: if your dashboard is at `venue-os.app/lincoln-high/dashboard`, open `venue-os.app/lincoln-high/emergency/broadcast` — and bookmark it. While an alert is active, the red banner on the dashboard also has an **Emergency Console** button that opens it.

## Send a text broadcast

1. Choose a **Severity**: **Info**, **Warn** or **Critical** (what each looks like is below).
2. Type the **Message**, up to 2,000 characters. **Preview** shows it in that severity's colors.
3. Set **Duration (min)** — how long screens show it, from 1 to 120 minutes. The default is 5.
4. Press and hold **Hold 3s to Broadcast** until it fills. Letting go early cancels it and nothing is sent. On a keyboard, hold Space or Enter.

**Broadcast dispatched.** confirms that it went out, and the message appears under **Active broadcasts**. If sending fails, a red message says so: nothing went out, so try again.

A broadcast goes to every screen at the location you are working in — and, when you work at an organization with locations under it, to every screen at those locations too. To reach one location's screens only, switch to that location first. There is no screen or group picker on this page.

## Add pictures, video or sound

Tick **Include media (image/video/audio)** to send a **media alert** instead:

1. In **Assets**, open the picture or video and press **Copy link**.
2. Paste the link into the Broadcast page and press **Add**. Screens show up to four pictures or videos.
3. To add sound, paste an audio file's link into **Optional audio URL**.
4. Type your message, then press and hold **Hold 3s to Broadcast**.

A media alert always fills the whole screen and stays up for one hour; there is no duration to set. Links must start with `https://` and point to files stored in VenueOS — links to other websites are refused, so nobody can put an outside page on your screens.

## What screens show

| You sent | Screens show |
|---|---|
| **Info** text | A yellow banner across the top with your message. Whatever was playing keeps playing beneath it. |
| **Warn** text | The same banner in orange. |
| **Critical** text | The whole screen turns red with a flashing border, the word **Broadcast** and your message. |
| A media alert | The whole screen, in the severity's color: **Emergency Alert**, your message, your pictures or videos (videos play muted, on a loop) and an audio player if you added sound. |
| A staff SOS | The whole screen: **Staff SOS**, the sender's email and the place they gave. |

The text shrinks to fit portrait, ribbon and small LED screens instead of being cut off. Screens receive the message within seconds over their live connection; a screen whose live connection is down picks it up on its next check, about every 10 seconds.

## Staff SOS and voice notes

A staff SOS is a full-screen call for help from a member of staff, and it can carry a recorded voice note. Screens can show one, and an active SOS appears under **Active broadcasts** like any other message — but there is no button yet, in the dashboard or on `/panic`, to send an SOS or record a voice note. To raise the alarm from a phone today, open `/panic`, sign in and hold the alert that fits; see the [emergency system overview](/help/emergency-system).

The **Voice on** / **Silent** switch at the top of `/panic` only makes your phone read alert status out loud. It doesn't record or send anything.

## How long a message stays, and ending it early

| Message | Stays on screen for |
|---|---|
| Text broadcast | The duration you chose: 1 to 120 minutes (5 if you don't change it) |
| Media alert | 1 hour |
| Staff SOS | 30 minutes |

Screens take a message down on their own when its time runs out. To end one sooner, press **Clear** next to it under **Active broadcasts** — anyone who can send can clear. Clearing a broadcast you sent from an organization also clears it at every location under it. If the page then says the clear failed, the message may still be on screens — press **Clear** again.

A full alert (Lockdown, Evacuate and the rest) ends differently: type **CLEAR** and press **Terminate Emergency (All Clear)** on the dashboard, or use **Hold to send all-clear** on `/panic`.

## Always live — practice with a drill

The Broadcast page has no **LIVE | DRILL** switch: every broadcast is real, and screens never mark it as a drill, so don't use it for practice. To rehearse, start a drill from the **Emergency** button in the top bar or from `/panic`: flip the switch to **DRILL** (it starts on **LIVE** every time it opens), and screens show your drill content under a "THIS IS A DRILL" banner.

## Who can send

- **Super Admins** and **Admins** can send text broadcasts and media alerts.
- **Editors** can send them only when an administrator has turned on their **Emergency alerts** permission — see [delegating panic access](/help/panic-delegation). Without it, sending is refused.
- **Viewers** can see **Active broadcasts** but can't send.
- **Clear** on this page is shown to everyone who can send — the same rule the server applies.
- **API keys** can never send or clear a broadcast.

## What the audit log records

Every send and every clear adds a permanent entry to the audit log. Admins open it from **Settings → Emergency → Open the audit log**, can filter it and can export it as a CSV file. Entries can't be edited or deleted.

| Entry | What it records |
|---|---|
| `BROADCAST_TEXT` | Who sent it and when, where it went, the severity, the length of the message, the duration and how many locations it reached |
| `MEDIA_ALERT` | Who sent it and when, where it went, the severity, how many media files, whether it had sound and how many locations it reached |
| `SOS_TRIGGER` | Who sent it and when, the place they typed and whether a voice note was attached |
| `CLEAR_EMERGENCY_MESSAGE` | Who ended which message, and when |

The log keeps the length of a text broadcast, not its words. Alerts and drills have entries of their own: `TRIGGER_EMERGENCY`, `CLEAR_EMERGENCY`, `TRIGGER_EMERGENCY_DRILL` and `CLEAR_EMERGENCY_DRILL`.
