# EDU CMS Pilot — Your First Demo

Welcome! This guide walks you through your first end-to-end demo of EDU CMS. No technical background needed — we explain every click. Take your time; each step is designed to give you a working feel for the product in about 20 minutes.

---

## Your Pilot Accounts

Two accounts are ready for you. Either works for everything in this guide — pick whichever you like.

| Email | Password |
|---|---|
| `chuck@agceducation.com` | `12345678` |
| `larry@agceducation.com` | `12345678` |

Both sign in at **https://educms-five.vercel.app/login**.

> Keep this guide open on one side of your screen and the browser on the other. You'll be flipping between tabs, so a little screen real estate helps.

---

## Before You Start

A 60-second checklist. Knock these out now and the rest of the demo is smooth:

- [ ] **Google Chrome is open** on your computer (any modern browser works, but we test against Chrome).
- [ ] **Your phone is within reach** with a web browser (Safari on iPhone or Chrome on Android — both fine).
- [ ] **2 or 3 sample images** are saved to your desktop. A school logo, a flyer, an event photo — anything you'd show on a hallway TV. JPG or PNG, under 10 MB each.
- [ ] **You're on WiFi** that's not blocking Vercel or Railway (most school guest networks are fine — if you're on a locked-down district network, try a hotspot).

---

## What You're Going to See

In about 20 minutes you'll sign in, turn a second browser tab into a pretend "hallway TV," upload some of your own content, build a custom school template, assemble it into a playlist, publish it to that pretend screen, then trigger a real emergency alert from your phone and watch the TV switch to lockdown mode in seconds. Finally you'll clear the alert from the dashboard and watch the screen return to normal. This is the exact same flow your staff will run the day this goes live in your building.

---

## Step 1 — Sign In

1. In Chrome, go to **https://educms-five.vercel.app/login**.
2. In the **Email** field, type `chuck@agceducation.com` (or `larry@…`).
3. In the **Password** field, type `12345678`.
4. **Check the box labeled "Remember me"** before clicking sign in. This keeps you logged in for the full demo so you don't have to retype the password on every tab.
5. Click the **Sign In** button.

[SCREENSHOT: Login page with email/password filled and "Remember me" checked]

**You should see:** the main dashboard load with your school name in the top-left corner and a left-hand navigation menu (Screens, Playlists, Templates, Assets, etc.).

> **About "Remember me":** when checked, your session stays active across browser restarts for up to 8 hours of idle time, and rolls forward every time you use the app. You won't get surprise sign-outs mid-demo.

[SCREENSHOT: Dashboard home after login]

---

## Step 2 — Add Your Browser as a Sample Screen

Every hallway TV, lobby monitor, or cafeteria board is called a **Screen** in this system. To show you how it feels without buying hardware, we're going to turn a second browser tab into a pretend screen.

1. In the left nav, click **Screens**.
2. Click the **Add Screen** button (top-right of the page).
3. A dialog opens showing a **6-character pairing code** (example: `A7K-9QR`). Click the **Copy** icon next to it.

[SCREENSHOT: Add Screen dialog with pairing code visible]

4. Open a **new browser tab** (Ctrl+T / Cmd+T) and go to **https://educms-five.vercel.app/pair**.
5. Paste the pairing code into the box. Click **Pair this Device**.
6. Flip back to your first tab (the dashboard). The Screens list now shows your new screen with a green **ONLINE** badge.

[SCREENSHOT: Screens list with new ONLINE screen row]

**You should see:** two tabs — one showing the dashboard with an ONLINE screen, the other showing a gray "waiting for content" message. That second tab IS what a lobby TV looks like the moment it's plugged in at your school. Same code, same behavior, just running in a browser tab so you can feel it before ordering hardware.

---

## Step 3 — Upload Your Content

Now let's give it something to display.

1. Left nav → **Assets**.
2. Click **New Folder**. Name it `Demo Content`. Click **Create**.

[SCREENSHOT: Asset folder creation dialog]

3. Click the blue **Upload to...** button at the top-right.
4. A folder picker opens with a search box at the top. Type `demo` — the `Demo Content` folder you just made filters to the top. Click it.
5. Drag 2 or 3 images from your desktop into the drop zone (or click **Browse** to pick them).
6. Wait about 5 seconds for each upload to finish. You'll see checkmarks next to each file name.

[SCREENSHOT: Upload dialog with files uploaded to Demo Content folder]

**You should see:** your images appear as thumbnails inside the `Demo Content` folder. The folder tree on the left shows the new folder nested correctly. The search box at the top of the Assets page filters folders by name — handy when you have dozens.

---

## Step 4 — Build a Custom Template

A **Template** is the visual layout — where the clock sits, where the school name goes, what the background looks like. We ship 17 pre-made templates; you're going to customize one and save it as yours.

1. Left nav → **Templates**.
2. Scroll to find a high-school themed template (look for **Varsity**, **Broadcast**, or **Yearbook**). Click its thumbnail.
3. Click **Use This Template**. The template builder opens with your chosen layout on the canvas in the middle.

[SCREENSHOT: Template builder opened on a Varsity template]

4. Click any widget on the canvas — the clock, the announcement box, the countdown. A **blue highlight** appears around it, and the **left toolbar** swaps to show that widget's editor.
5. For each widget, configure it:
    - **School name / title widget** → type your real school name.
    - **Announcement text** → type a welcome message (e.g., "Welcome back, Eagles! Homecoming is Friday.").
    - **Teacher Spotlight** → pick a teacher name, add a short bio line.
    - **Countdown** → click the date picker, set it to your next game or event.

[SCREENSHOT: Widget being edited with the left-toolbar editor open]

> **Important:** every widget you can drop on the canvas can also be edited. Click the widget, the toolbar opens. There are no "locked" or orphan widgets — if it's on the screen, you can configure it.

6. When you're happy with it, click **Save As Custom Template** (top-right). Name it `My Demo Template`. Click **Save**.

[SCREENSHOT: Save custom template dialog]

**You should see:** a confirmation banner ("Template saved") and your new `My Demo Template` appearing in the **Custom** tab of the Templates page.

---

## Step 5 — Create a Playlist

A **Playlist** is the sequence of content that rotates on a screen. We'll mix your custom template with the images you uploaded.

1. Left nav → **Playlists**.
2. Click **New Playlist**. Name it `Demo Rotation`. Click **Create**.
3. Click **Add Item** → **Template** → pick `My Demo Template`. Set **Duration** to `30` seconds. Click **Add**.
4. Click **Add Item** → **Asset** → pick one of your uploaded images. Set **Duration** to `15` seconds. Click **Add**.
5. Repeat step 4 for a second image (15 seconds).
6. Your playlist now has 3 items. Click **Save**.

[SCREENSHOT: Playlist editor showing 3 items in order]

**You should see:** a clean playlist list with your 3 items in order, total run time around 60 seconds.

---

## Step 6 — Publish It to Your Sample Screen

1. Left nav → **Screens**.
2. Click the row for your paired screen (the one with the ONLINE badge).
3. On the screen detail page, find **Assigned Playlist**. Click the dropdown.
4. Pick `Demo Rotation`. Click **Save**.

[SCREENSHOT: Screen detail with playlist assignment dropdown open]

5. **Flip to your pretend-screen tab** (the one still showing the gray "waiting" message).

**You should see:** within 2 to 5 seconds, your custom template appears on that tab, then rotates through your images and back to the template. It's live. This is exactly what a physical hallway TV would show.

[SCREENSHOT: Pretend-screen tab rendering the custom template]

---

## Step 7 — Trigger an Emergency from Your Phone

This is the heart of what makes EDU CMS different. If something happens at your school, any authorized staff member can lock down every screen in seconds from their phone.

1. On your **phone**, open a browser and go to **https://educms-five.vercel.app/panic**.
2. Sign in with the same account (`chuck@agceducation.com` / `12345678`).
3. **Check the box labeled "Keep me logged in"** before submitting.

> **Why this box matters:** in a real emergency — an active intruder, a severe weather warning — you do not want to be fumbling with passwords while running. This check keeps your phone pre-authenticated so the panic button is a single long-press away whenever you need it. Treat it the same way you'd treat a fire alarm pull — always ready.

[SCREENSHOT: Phone panic login screen with "Keep me logged in" checked]

4. After sign-in, you'll see a short list of emergency types: **Lockdown**, **Shelter in Place**, **Evacuate**, **Severe Weather**. Tap **Lockdown** (or whichever you want to demo).
5. A large red button appears with the instruction **Hold for 3 seconds**. Press and hold it. A ring fills in around the button as you hold.
6. When the ring completes, the button flashes confirming the alert was sent.

[SCREENSHOT: Phone panic button mid-hold with progress ring]

**You should see:** a confirmation message on your phone ("Emergency triggered — all screens updating") and a log entry with your name and a timestamp.

> The 3-second hold is deliberate. It prevents a pocket tap from locking down your school.

---

## Step 8 — Watch the Screen Switch

1. Flip back to your pretend-screen browser tab.

**You should see:** within 2 to 3 seconds, the playlist content is replaced by the emergency display — a red full-screen alert with the lockdown instructions. This is signed, verified, and delivered through the same pipeline that will protect your real buildings.

[SCREENSHOT: Pretend-screen tab showing full-screen Lockdown emergency]

If the screen is slow to change, give it up to 10 seconds. Very slow networks fall back to HTTP polling, which is still safe but not as instant.

---

## Step 9 — Clear the Alert from the Dashboard

Clearing an emergency happens on the **dashboard**, not the phone. This is intentional: the person who clears the alert should be at a keyboard where they can see the full situation, not on a phone in the middle of it.

1. Flip to your main dashboard tab (the one where you've been working). A **red banner across the top** says "EMERGENCY ACTIVE — Lockdown" with an **All Clear** button.

[SCREENSHOT: Dashboard showing red active-emergency banner with All Clear button]

2. Click **All Clear**.
3. A confirmation dialog appears asking you to type the word `CLEAR` (all caps) into a text box. This prevents an accidental clear. Type `CLEAR`.
4. Click **Confirm All Clear**.

[SCREENSHOT: All Clear confirmation dialog with CLEAR typed]

5. Flip back to your pretend-screen tab.

**You should see:** the red emergency screen disappears and your `Demo Rotation` playlist resumes exactly where it left off. An audit log entry is written so you have a record of who triggered and who cleared.

---

## You Did It

You just ran the full life cycle: sign-in, screen pairing, content upload, custom template, playlist, publish, mobile emergency trigger, and all-clear. That is the entire product in 20 minutes. In a real deployment, the only difference is that the screens are on walls instead of browser tabs, and the accounts are assigned to your real staff.

---

## Troubleshooting

A few things that occasionally trip people up.

**Screen says "Waiting for pairing" and the dashboard never shows it as ONLINE.**
Double-check the pairing code — the letter `O` and the number `0` look alike in some fonts. Click **Cancel** on the dashboard dialog, click **Add Screen** again for a fresh code, and retry. Pairing codes expire after 10 minutes.

**Emergency alert fires on my phone but the screen doesn't change.**
Give it 10 full seconds — slow WiFi falls back to a slower polling mode. If still nothing, refresh the pretend-screen tab. If you refresh and see "Not paired," the sample screen's session expired; redo Step 2 to repair.

**I clicked All Clear on the phone instead of the dashboard.**
The phone doesn't show an All Clear button — it's deliberately a trigger-only device. Clearing always happens from the dashboard. If you can't find the red banner, make sure you're signed in to the same account that triggered the alert, then refresh the dashboard page.

**Uploaded images aren't showing in the playlist editor.**
Refresh the Playlists page. New assets take a second to finish processing after upload. If they still don't appear, check the Assets page and confirm the files show a green "Ready" status — if they say "Processing," wait 10 seconds and try again.

---

## Need a Hand?

If anything in this guide doesn't behave as described, reach out — don't wrestle with it. We want the friction points in *your* hands so we can fix them before go-live.

**Integration Lead — EDU CMS Pilot**
- Name: [TODO: contact info]
- Email: [TODO: contact info]
- Phone / SMS: [TODO: contact info]
- Best hours: [TODO: contact info]

Welcome to the pilot. We're excited to have you.
