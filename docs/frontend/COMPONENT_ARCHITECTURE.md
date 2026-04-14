# Component Architecture

## Component Tree (High-Level)

```text
<AppRoot>
  <AuthProvider>
    <QueryProvider>
      <SchoolProvider>
        <DashboardLayout>
          <Sidebar Navigation />
          <TopToolbar {SchoolSelector, UserProfile, GlobalStatusIndicator} />
          <MainContentArea>
            {/* Dynamic Page Content */}
            <ScreenManagement />
            <PlaylistBuilder>
              <SlideList (dnd-kit) />
              <SlideEditor />
            </PlaylistBuilder>
            {/* ... */}
          </MainContentArea>
        </DashboardLayout>
      </SchoolProvider>
    </QueryProvider>
  </AuthProvider>
</AppRoot>
```

## Drag-and-Drop Templating Approach
Using `@dnd-kit/core` and `@dnd-kit/sortable` for intuitive list and grid manipulation.
- **Playlists:** Vertical list reordering for slides and scheduled assets.
- **Templates:** Free-form or grid-based droppable zones for widgets (Text, Image, Ticker, Weather).
- State is managed locally via `useState` or `Zustand` during the drag operation to ensure 60fps animations, flushing to `React Query` multi-stage mutations on `onDragEnd`.

## Emergency Override UX (Admin-Only)
The emergency override is the most critical feature. It bypasses all normal scheduling.

### Two-Step Confirmation Workflow
1. **Initiation:** Admin clicks a prominent "Trigger Emergency" button, styled with distinct warning colors (e.g., deep red against the slate foundation) located statically in the TopToolbar.
2. **Action Selection:** A modal slides in offering predefined emergency types (Lockdown, Weather, Custom).
3. **Double Confirmation (The UX Lock):**
   - User must type a confirmation word (e.g., "LOCKDOWN") or hold a button for 3 seconds to prevent accidental triggers.
   - Using a distinct glassmorphic overlay that blurs the background entirely, forcing absolute visual focus.
4. **Execution & Feedback:**
   - Feedback spinner: "Broadcasting to all screens..."
   - Transitions to a stark "EMERGENCY ACTIVE" state overlaying the entire dashboard until the "All-Clear" workflow is enacted.

## All-Clear Workflow
- Visible globally only when an emergency is active.
- Requires a two-step authentication (e.g., entering a PIN or clicking a secured slider) to safely return screens to their scheduled playlists.
