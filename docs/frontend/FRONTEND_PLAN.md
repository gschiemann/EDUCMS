# Frontend Plan: SaaS Admin Dashboard

## Overview
This document outlines the frontend routes, pages, and API integration strategies for the School Digital Signage CMS. The application leverages Next.js (App Router), Tailwind CSS, shadcn/ui, TanStack Query, and Zustand.

## Route & Page Map

### Authentication & Public
- `/login` - Credential or SSO login
- `/forgot-password` - Password recovery flow

### Authenticated Workspace (School-Aware)
- `/[schoolId]/dashboard` - Main overview, device health summary, active emergency alerts.
- `/[schoolId]/screens` - Screen group management, device status.
  - `/[schoolId]/screens/[groupId]` - Detail view, assign playlists, reboot devices.
- `/[schoolId]/playlists` - Playlist builder, schedule configuration.
- `/[schoolId]/templates` - Drag-and-drop template editor.
- `/[schoolId]/assets` - Asset upload flow, media library.
- `/[schoolId]/announcements` - Announcement editor with preview and sanitization.
- `/[schoolId]/emergency` - Emergency override module (Admin only).
- `/[schoolId]/settings` - User and school settings.

## Role-Specific UI Gating

Role-based access control (RBAC) dictates the visibility of UI components to ensure a contributor-safe editing experience.

- **Admin / Principal:**
  - Full access to all routes.
  - Exclusive access to `/emergency` and all-clear workflows.
  - Can manage users, screen groups, and global settings.
- **Contributor / Teacher:**
  - Access to `/assets`, `/playlists`, and `/announcements`.
  - Can create and submit content, but UI for publishing directly to global screens may trigger an approval workflow depending on school settings.
  - Emergency module is completely hidden.

> [!IMPORTANT]
> UI Gating is optimistic for UX, but all authenticated actions must still be gated at the API layer. We use a generic `<RoleGate allowedRoles={['admin']}>` wrapper around sensitive components.

## API Integration Patterns

- **TanStack Query (React Query):** Used for all asynchronous state (fetching screens, uploading assets, getting templates).
  - Queries are keyed by `['schoolId', 'entityType', 'entityId']` to ensure strict tenant boundaries.
- **Next.js Server Actions / API Routes:** Used for secure mutations that need to interface with the protected backend.

## Optimistic vs Pessimistic Updates

- **Optimistic Updates:**
  - *Drag-and-Drop Ordering:* Reordering slides in a playlist instantly updates the UI using `queryClient.setQueryData`, rolling back on server error.
  - *Screen Group Name Changes:* UI updates instantly for a fluid SaaS feel.
- **Pessimistic Updates:**
  - *Emergency Overrides:* Must wait for a confirmed WebSocket or HTTP response before updating the UI to "Active". A loading skeleton/spinner with "Deploying..." is shown.
  - *Asset Uploads:* Real-time progress bars, completion confirmed only on S3/backend success.
  - *Publishing Playlists:* UI waits for backend confirmation to ensure device sync is triggered.
