---
title: Signing in, passkeys and two-step sign-in
category: IT & Security
updated: 2026-10-22
excerpt: Your first sign-in, passkeys on a Mac, iPhone or Windows PC, authenticator apps and backup codes, signing in on a new device, and what to do if you are locked out.
---

# Signing in, passkeys and two-step sign-in

Sign in at **venue-os.app/login** with your work email. This page covers your first sign-in, the ways VenueOS checks that it is really you, and how to get back in when something goes wrong.

## How sign-in works

1. Type your work email and press **Continue**.
2. VenueOS shows only what applies to that address: a password field, or **Continue with single sign-on** when your organization uses single sign-on (see [Setting up single sign-on](/help/sso)).
3. If your account uses two-step sign-in, you then confirm with your passkey or a code.

If this device already has a passkey for your account, press **Sign in with a passkey** on the first screen instead — no password and no code.

**Keep me signed in**, next to the password, keeps you signed in on that browser for up to 30 days; without it a sign-in lasts up to 12 hours. Tick it only on a device that is yours. Changing your password signs you out everywhere else.

## Your first sign-in

How you start depends on how your administrator added you (administrators: see [Inviting staff and assigning roles](/help/invite-users)).

### From an email invitation

Open the link in the invitation email — it works for 7 days. Choose a password of at least 8 characters, type it again and press **Join workspace**. If your organization requires two-step sign-in, VenueOS then asks you to sign in once more and set it up.

### From a setup link or a starter password

Organizations that set up many locations at once create each account before they know who will run it, with a temporary email and a starter password or a one-time setup link. Open the setup link and press **Continue**, or sign in with the temporary email and starter password you were given. VenueOS then shows **Finish setting up your account**:

1. Enter **Your work email**, then type it again below. Use a mailbox you can open: sign-in codes and password resets go there, and you can't change it yourself later.
2. Choose a **New password** of at least 8 characters — not the starter password — and confirm it.
3. Press **Save and continue**.
4. If VenueOS asks for a code, open the email it just sent to that address, type the 6-digit code and press **Verify and finish**. A code works for 10 minutes, and 5 wrong tries cancel it. If no email arrives, check your spam folder, then press **Send a new code**. Typed the address wrong? Press **Use a different email**.

A setup link works once and expires after 7 days. If it says it has expired or was already used, ask your administrator for a new one. If your account must use two-step sign-in, VenueOS takes you straight on to set it up, under the email you just chose.

### With single sign-on

Sign in with your organization's own account. There is no separate VenueOS password to choose.

## Two-step sign-in

With two-step sign-in, a password alone is not enough: you also confirm with something only you have — a passkey, or a code from an authenticator app.

**Who must use it.** When a Super Admin sets the organization to **Two-factor required** (**Settings → People & access → MFA policy**), every Super Admin, every Admin and everyone allowed to send emergency alerts must set it up before they can sign in. An administrator can also require it for one person with **Require 2FA** on that person's row. Anyone can turn it on for themselves under **Settings → My security**.

**Setting it up when it is required.** After your password, the sign-in page shows **Set up two-factor**. Choose one:

- **Use Face ID, Touch ID or a security key** — makes a passkey on this device. Nothing to install.
- **Use an authenticator app instead** — scan the QR code with an app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy (or type the key shown), enter the 6-digit code it displays and press **Finish sign-in**.

Then save your backup codes (below) and press **I've saved them — continue**.

## Passkeys

A passkey lets you sign in with your face, your fingerprint or your device's PIN instead of a password and a code. It is the fastest way in, and it can't be phished: a passkey works only on the real VenueOS address.

| Device | You confirm with |
|---|---|
| Mac | Touch ID, or your Mac's login password |
| iPhone or iPad | Face ID or Touch ID |
| Windows PC | Windows Hello — your face, fingerprint or PIN |
| Android phone | Your fingerprint, face or screen lock |
| Security key (USB or NFC) | A touch of the key |

Passkeys saved in iCloud Keychain (Apple devices) or Google Password Manager also appear on your other devices signed in to the same account. A Windows Hello passkey normally stays on that PC. You can have up to 10 passkeys, so add one on each device you use.

**Add a passkey.** Right after you sign in, VenueOS may ask **Sign in with Face ID or Touch ID next time?** (on Windows, Windows Hello). Press the button that names your device — for example **Add a passkey for this Mac** — and follow your device's prompt. **Not now** asks again another time; **Don't ask on this device** stops asking. Or, at any time, open **Settings → My security**, go to **Passkeys**, press **Add a passkey for this …**, confirm your password and follow the prompt. Rename or remove passkeys in the same list; removing one asks for your password. If a passkey is your first way to confirm, VenueOS also shows backup codes — save them.

**Sign in with a passkey.** Press **Sign in with a passkey** on the first screen, or **Use your passkey** after your password, and confirm on your device. On a computer, your browser can also show a QR code: scan it with the phone that holds your passkey (Bluetooth must be on for both).

## Authenticator app and backup codes

To use an authenticator app, open **Settings → My security**, go to **Two-factor authentication** and press **Enable 2FA**. Scan the QR code (or type the setup key), enter the 6-digit code and press **Verify & turn on**.

**Backup codes.** When you first set up two-step sign-in, VenueOS shows 10 backup codes — once, and never again. Each code signs you in a single time if you lose your phone or can't use your passkey. Copy or download them and keep them somewhere safe: a password manager, or printed and locked away. **Regenerate backup codes** (it asks for your password) makes a new set, and the old unused codes stop working.

To stop using the app, press **Disable 2FA** and confirm your password. When your account requires two-step sign-in, VenueOS won't let you remove your last method — add a passkey first.

## Signing in on a new device

- **Your passkey syncs to it** (iCloud Keychain or Google Password Manager): press **Sign in with a passkey**.
- **Your passkey is on another device:** enter your email and password, press **Use another way** and pick **Enter a code from your authenticator app**, **Use a backup code** or, when it is offered, **Email me a code** — a 6-digit code sent to your sign-in email that works once, for 10 minutes.
- **On a phone** you may also see **Set up a passkey on this iPhone** (or Android phone): VenueOS emails you a code first, then turns on Face ID, Touch ID, fingerprint or screen-lock sign-in for that phone.
- **Once you are in**, VenueOS offers to add a passkey for the new device, so next time it is one tap.

A sign-in with an emailed code also sends you a "new sign-in" email, so you will know if it wasn't you. The emailed code is not offered for 7 days after a password reset — use your passkey, your authenticator app or a backup code instead.

## If you can't sign in

| What happened | What to do |
|---|---|
| You forgot your password | On the password step, press **Forgot password?** and enter your email. The reset link works for one hour. A new password signs you out on every device, and two-step sign-in still applies. |
| "Too many sign-in attempts for this email" | VenueOS slows down sign-in after repeated wrong passwords and, after 20 in 15 minutes, pauses that email for 15 minutes — even with the right password. Wait, or reset your password. |
| Too many wrong codes | After 5 wrong codes in a minute, wait 5 minutes before trying again. |
| You lost your phone, your passkeys and your backup codes | Ask an administrator with a higher role than yours to open **Settings → People & access** and press **Reset 2FA** on your row. It removes your authenticator app and passkeys and signs you out. Your password stays the same, and you set up two-step sign-in again at your next sign-in. |
| The email on your account is wrong | An administrator can fix it with **Change email** on your row in **Settings → People & access**. |
| An invitation or setup link has expired or was already used | Ask your administrator for a new one. |
| Your organization uses single sign-on | Your password and its rules live with your organization's identity provider — contact your IT team. |
| Your account was disabled | Only an administrator can turn it back on. |

If nobody in your organization can reset your sign-in — for example, you are the only Super Admin — email support@venue-os.app from your work address.
