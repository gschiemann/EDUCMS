---
title: Custom messages and staff SOS
category: Emergency System
updated: 2026-10-26
excerpt: Type your own message and put it on your screens — a banner across the top, or the whole screen — to every screen or only the ones you pick, and learn who can send and end it, what screens show and what the audit log records.
---

# Custom messages and staff SOS

A **custom message** puts your own words on your screens — "All staff report to the main office", "Early dismissal at 1:00 pm", "Parking lot B is closed". It is lighter than an alert such as Lockdown or Fire / Evacuate, which replaces everything on screen with that alert's content. For alerts, see the [emergency system overview](/help/emergency-system).

## Open Custom message

Custom message is a card on the **Emergency** page — the same page as the alert buttons, so there is nothing separate to find:

- **On a phone**, press the red **Emergency** button at the top and tap **Custom message** under **Send to**.
- **On a computer**, press **Emergency** in the sidebar and choose **Custom message** at the bottom of the window. **Settings → Emergency** also has an **Open Custom message** button.

It is shown to everyone who can send. The old address for this page, your workspace followed by `/emergency/broadcast`, still works — it takes you straight to the card — so a bookmark or an old email keeps working. While an alert is active, the red banner on the dashboard has an **Emergency Console** button that opens the Emergency page.

## Send a custom message

1. Choose how it should **appear**: **Info** or **Critical** (what each looks like is below).
2. Type your **message**, up to 500 characters. The preview shows how it will look.
3. Under **Send to**, leave **All screens**, or press **Choose screens** to pick a screen group or particular screens (next section).
4. Choose **Show for**: 5, 15, 30 minutes or 1 hour. The default is 5.
5. Press and hold **Hold 3 seconds to send** until it fills. Letting go early cancels it and nothing is sent. On a keyboard, hold Space or Enter.

A green note confirms that it went out, and the message appears under **On screens now**. If sending fails, a red message says so: nothing went out, so try again. After a send the **Send to** line goes back to **All screens**, so the next message never goes to a narrower audience by accident.

## Choose which screens

**All screens** is the default: every screen at the location you are working in — and, when you work at an organization with locations under it, every screen at those locations too. To send to fewer, press **Choose screens**. The same picker is used for alerts:

- Tap a **group** to send to that screen group.
- Tap **screens** one by one to pick particular screens — you can pick as many as you like. **Search** narrows the list, **Select all** picks every screen it shows, and **Selected: 3 screens** counts them. Press **Done** to confirm.

A double-sided display gets the message on both sides, whichever side you pick. Only the screens you picked show it; every other screen carries on as normal. An organization admin can pick screens at different locations in one message.

## What screens show

| You sent | Screens show |
|---|---|
| **Info** | A banner across the top with your message. Whatever was playing keeps playing beneath it — it moves down and shrinks to fit under the banner, so the banner never covers it — and springs back when the message ends. |
| **Critical** | The whole screen turns red with a flashing border, the word **Broadcast** and your message. |
| A staff SOS | The whole screen: **Staff SOS**, the sender's email and the place they gave. |

A message sent at the older **Warn** level (before 2026-10-26, or through the API) is shown as **Info**. The text shrinks to fit portrait, ribbon and small LED screens instead of being cut off. Screens receive the message within seconds over their live connection; a screen whose live connection is down picks it up on its next check, about every 10 seconds.

## Staff SOS and voice notes

A staff SOS is a full-screen call for help from a member of staff, and it can carry a recorded voice note. Screens can show one, and an active SOS appears under **On screens now** like any other message — but there is no button yet, in the dashboard or on `/panic`, to send an SOS or record a voice note. To raise the alarm from a phone today, open `/panic`, sign in and hold the alert that fits; see the [emergency system overview](/help/emergency-system).

The **Voice on** / **Silent** switch at the top of `/panic` only makes your phone read alert status out loud. It doesn't record or send anything.

## How long a message stays, and ending it early

| Message | Stays on screen for |
|---|---|
| Custom message | The time you chose: 5, 15, 30 or 60 minutes (5 if you don't change it) |
| Staff SOS | 30 minutes |

Screens take a message down on their own when its time runs out. To end one sooner, press **Clear** next to it under **On screens now** — anyone who can send can clear. The list opens at the top of the card whenever something is on screens, so **Clear** is the first thing you see. Clearing a message you sent to particular screens ends it on exactly those screens, and clearing one you sent from an organization also clears it at every location under it. Screens go straight back to what they were playing — no alert screen appears on the way out. If the page says the clear failed, the message may still be on screens — press **Clear** again.

A full alert (Lockdown, Evacuate and the rest) ends differently: type **CLEAR** and press **Terminate Emergency (All Clear)** on the dashboard, or use **Hold to send all-clear** on `/panic`.

## Always live — practice with a drill

Custom message has no **LIVE | DRILL** switch: every message is real, and screens never mark it as a drill, so don't use it for practice. To rehearse, start a drill from the **Emergency** button in the top bar or from `/panic`: flip the switch to **DRILL** (it starts on **LIVE** every time it opens), and screens show your drill content under a "THIS IS A DRILL" banner.

## Who can send

- **Super Admins** and **Admins** can send custom messages.
- **Editors** can send them only when an administrator has turned on their **Emergency alerts** permission — see [delegating panic access](/help/panic-delegation). Without it, sending is refused and the card isn't shown.
- **Viewers** can't send or clear.
- **Clear** is shown to everyone who can send — the same rule the server applies.
- **API keys** can never send or clear a message.

## What the audit log records

Every send and every clear adds a permanent entry to the audit log. Admins open it from **Settings → Emergency → See who did what**, can filter it and can export it as a CSV file. Entries can't be edited or deleted.

| Entry | What it records |
|---|---|
| `BROADCAST_TEXT` | Who sent it and when, the severity, the length of the message, the duration and where it went — for particular screens, the exact screens you picked, every display side that carries it, their names and the locations |
| `MEDIA_ALERT` | Who sent it and when, where it went, the severity, how many media files, whether it had sound and how many locations it reached (sent through the API; the card sends text) |
| `SOS_TRIGGER` | Who sent it and when, the place they typed and whether a voice note was attached |
| `CLEAR_EMERGENCY_MESSAGE` | Who ended which message, and when — for a message sent to particular screens, exactly which screens it ended on |

The log keeps the length of a message, not its words. Alerts and drills have entries of their own: `TRIGGER_EMERGENCY`, `CLEAR_EMERGENCY`, `TRIGGER_EMERGENCY_DRILL` and `CLEAR_EMERGENCY_DRILL`.
