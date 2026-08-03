# Greg's steps — exact instructions

Three tasks. Each is copy-paste or click-by-click. **Do them in this order.**
Nothing here is reversible-unsafe, but read the "what this does" line before each.

Whenever a step says *run this*, open the **Terminal** app, and unless told otherwise first paste:

```bash
cd "/Users/gschiemann/Desktop/EDU CMS"
```

---

# TASK 1 — Rotate the two production secrets (5 minutes)

**What this does:** the login/session signing keys in production are reportedly still
human-written placeholder text instead of random 64-character keys. Anyone who guesses them can
forge a login as any user. Replacing them fixes that.

**Who it affects:** nobody. Zero customers. It just logs *you* out of the dashboard once.
It does **not** affect screens or players.

### Step 1.1 — Check whether it's actually a problem

1. Go to **https://railway.app** and sign in.
2. Click your **EDU CMS / API** project.
3. Click the **API service** (the box), then the **Variables** tab.
4. Find `JWT_SECRET` and `SESSION_SECRET`. Click the eye icon to reveal each.

**What you're looking at:**
- ✅ **Fine** if the value is 64 characters of random letters/numbers, e.g.
  `4f9c2a...` (long, gibberish, no words).
- 🔴 **Needs fixing** if it looks like words a human typed, e.g. `edu-cms-beta-secret-2026`.

If BOTH are already long gibberish — **skip to Task 2, you're done here.**

### Step 1.2 — Generate two new keys

Run this **twice**, and copy each result somewhere safe for a moment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You'll get something like `8a3f...` — 64 characters. You need **two different ones**.

### Step 1.3 — Replace them in Railway

1. Still on the **Variables** tab, click `JWT_SECRET`.
2. Delete the old value, paste your **first** generated key. Save.
3. Click `SESSION_SECRET`. Delete, paste your **second** key. Save.
4. Railway redeploys automatically (~2 minutes). Wait for the deployment to go green.

### Step 1.4 — Confirm

Go to your dashboard and log in. You'll be asked to sign in again — **that's expected and means
it worked**. If you can log in, you're done.

> ⚠️ Use two DIFFERENT keys. Don't paste the same one into both.
> ⚠️ Don't put these in Slack/email. They're passwords.

---

# TASK 2 — Create the app signing key (15 minutes)

**What this does:** right now the Android app is signed with a key that is **published in our
public GitHub repo**. Anyone can build a fake "VenueOS Player" that Android accepts as a genuine
update to ours. This creates a private key only you have.

**Why now:** doing this later means physically reinstalling the app on every screen. With zero
screens deployed, it costs nothing today. **This is the single most valuable thing on your list.**

### Step 2.1 — Create the key

Run this. It will ask you questions:

```bash
cd "/Users/gschiemann/Desktop/EDU CMS/apps/player"
/opt/homebrew/opt/openjdk@17/bin/keytool -genkeypair -v \
  -keystore venueos-release.jks -keyalg RSA -keysize 4096 -validity 10000 \
  -alias venueos
```

**Answering the prompts:**
- *Enter keystore password* → make up a strong password. **Save it in your password manager now.**
  You will not be able to recover it, and losing it means never updating the app again.
- *Re-enter* → same password.
- *What is your first and last name?* → type `VenueOS`
- *organizational unit / organization* → `VenueOS` (or your company name)
- *City / State / Country code* → your real ones; country is 2 letters, e.g. `US`
- *Is CN=VenueOS... correct?* → type `yes`
- If it asks for a *key password*, just press **Enter** to reuse the keystore password.

You now have a file called `venueos-release.jks`. **This file plus that password is the identity
of your app forever. Back both up somewhere safe and private.**

### Step 2.2 — Turn it into text for GitHub

```bash
cd "/Users/gschiemann/Desktop/EDU CMS/apps/player"
base64 -i venueos-release.jks | pbcopy
```

That copied a long block of text to your clipboard. (Nothing is displayed — that's normal.)

### Step 2.3 — Put it in GitHub

1. Go to **https://github.com/gschiemann/EDUCMS**
2. **Settings** (top right of the repo, not your profile) → left sidebar **Secrets and variables**
   → **Actions**
3. Click **New repository secret**, four times, creating:

| Name | Value |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | paste (Cmd-V) — the text from Step 2.2 |
| `RELEASE_STORE_PASSWORD` | the password you chose in Step 2.1 |
| `RELEASE_KEY_ALIAS` | `venueos` |
| `RELEASE_KEY_PASSWORD` | the same password (unless you set a separate one) |

### Step 2.4 — Tell me

Message me **"keystore done"**. I'll switch the build over to use it and verify the resulting app
is properly signed and no longer debuggable.

> ⚠️ **Never commit `venueos-release.jks` to git.** It's already blocked by a guard I added, but
> don't fight the guard.
> ⚠️ If you lose the file or password, you can never update the installed app again — it has to be
> uninstalled and reinstalled on every screen. Back it up twice.

---

# TASK 3 — Decide about pushing to GitHub (2 minutes, just a decision)

**The situation:** all this security work sits only on your Mac. Our GitHub repo is **public** —
anyone can read it. The commit messages describe, in detail, holes that are still unpatched in
what's currently deployed.

**Now that there are zero customers, the risk is much lower** — there's nothing live to attack.

**Pick one and tell me:**

- **A — Push it.** Simplest. Work is backed up off your Mac and CI runs on it.
  Small downside: the writeups are publicly readable.
- **B — Make the repo private first, then push.** GitHub → Settings → scroll to
  *Danger Zone* → **Change repository visibility** → Private. Then I push. Best of both.
  *(Recommended — it's free and takes 30 seconds.)*
- **C — Keep it local.** No exposure, but the only copy is your laptop, and CI can't run.

---

# What I'm doing meanwhile (no action needed)

- ✅ Android app now compiles — I build it locally, so I no longer need GitHub for that
- ✅ Closed the last realtime replay hole (R-02)
- ⏳ Remaining cleanup: the SSE token, a Redis revocation detail, and a pairing-code leak
- ⏳ Applying two database migrations to the dev database

# One thing to watch when you next test a screen

The player now supports **lock task mode** — it pins itself so a student can't escape into Android
settings. It only activates on screens where the Manager app is the device owner.

When you next set up a screen, please confirm the on-screen **"Exit to device home"** button still
returns you to the Goodview launcher. There are four ways out built in, but that's the one an
operator would actually use, and it's worth seeing with your own eyes once.
