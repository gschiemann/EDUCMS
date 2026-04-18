---
title: Uploading and organizing assets
category: Templates
updated: 2026-04-16
excerpt: Manage images, videos, and documents with folders, approval workflows, and file-size best practices.
---

# Uploading and organizing assets

Assets are the images, videos, and documents that fill your templates and playlists.

## Uploading

From **Assets → Upload**, drag-and-drop files or pick them from your computer. Supported formats:

- **Images**: JPG, PNG, WebP, SVG (up to 20 MB each)
- **Videos**: MP4 (H.264), WebM (up to 500 MB each)
- **Documents**: PDF (we render the first page, up to 50 MB)

We automatically generate thumbnails and multiple sizes for performance. Originals are retained for 90 days in case you need to re-export.

## Folders

Organize with folders (**Assets → New folder**). Folders can be nested up to 5 levels deep. A few common patterns:

- `/Announcements/2026-Spring/`
- `/Photos/Graduation/`
- `/Logos/District-Brand/`
- `/Staff-Spotlights/`

Permissions are inherited — anyone with access to a folder can access everything in it.

## Approval workflow

Enabled by default on District plan. Non-admin users upload assets in **Pending Approval** state. An admin reviews them under **Assets → Pending** and either approves or rejects with a reason. Approved assets appear in template and playlist pickers; pending ones are hidden.

This workflow exists because student-facing content in a public hallway deserves a second set of eyes.

## Size + performance tips

- Target image files **under 500 KB** for hallway displays. A 5 MB hero photo will drop frame rate on older Chromeboxes.
- Videos should be **1080p max** and encoded with a target bitrate of 4–8 Mbps for H.264.
- **SVGs** are great for logos and line art — they scale forever without quality loss.
- **PNG with transparency** beats JPG when you need to layer content over a background.

## Bulk download / export

For audits or migration, **Settings → Data Export → Assets** generates a ZIP of every asset in your tenant. Large exports are emailed as a download link when ready (usually within 10 minutes).

## Deleting

Deleting an asset that's used in a live playlist or schedule shows a confirmation dialog listing every reference. You can either:

- Cancel and remove the references first, or
- **Hard delete** — removes the asset and creates fallback placeholders in any playlist item that used it (so screens don't go blank).

Deleted assets move to **Trash** for 30 days before permanent removal.
