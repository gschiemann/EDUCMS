# State Management Plan

## State Ownership Map

### Server State (TanStack Query)
Handles all data that inherently lives on the server.
- Screen groups & individual screen statuses (online, health, sync state).
- Playlists, media items, schedules.
- Asset libraries and multipart uploads.
- **Why:** Delivers automatic background refetching (crucial for live device health), built-in caching, and optimistic capability.

### Global App State (Zustand)
Handles transient UI state accessed across diverse component trees, disconnected from direct server entities.
- **School Context:** `activeSchoolId`, `currentUserRole`. Allows instant namespace switching across the app.
- **Emergency Overlay Status:** Boolean tracking if the global "Emergency Active" warning banner is visible across the entire dashboard.
- **Sidebar & Layout State:** `isSidebarCollapsed`, `activePanel`.

### Local Component State (React `useState` / `useReducer`)
- Drag-and-drop in-flight coordinate mapping coordinates.
- Simple, unmapped Modal open/close states.
- Minor view toggles (e.g., List vs. Grid view for media).

### Form State (React Hook Form)
- Managed entirely within uncontrolled inputs via RHF to eliminate unnecessary render cycles on complex forms.

## School-Aware Dashboard Context
The application structure is strictly multi-tenant.
Zustand captures and holds the `currentSchoolId` right from the layout. This ID is subsequently injected into every TanStack Query key: e.g., `['screens', currentSchoolId]`. If the ID changes via a top-level dropdown, query scopes are naturally isolated, and the UI transitions smoothly to the new data context.

## Playlist Builder State
Building a playlist is the most complex state interaction, assembling assets, text, and timeline data.
- **Drafting (Zustand/Local):** The draft playlist logic is held in a local `usePlaylistStore` to support deep undo/redo history and high-frequency timeline modifications without hammering API endpoints.
- **Saving (React Query):** On "Save", the compiled state object is passed to a TanStack Query mutation to persist against the backend.
