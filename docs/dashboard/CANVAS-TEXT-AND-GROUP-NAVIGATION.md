# Canvas text, group navigation and demo handoff — October 1, 2026

## Individual text on native homebuilder boards

The 28 new native carousel boards expose their visible text fields through the existing opaque-origin EXTERNAL_HTML iframe. `homebuilder-text-layout.ts` adds selection, drag after a four-pixel threshold, canvas bounds, authored-pixel offsets, keyboard nudges and Delete. `ExternalBoardFieldBridge.tsx` accepts messages only from actual board windows in this builder, checks advertised field keys and finite bounded offsets, and writes through the existing zone/history store. Locked boards and Preview reject edits. The iframe remains `sandbox="allow-scripts"`; no same-origin access is added.

Offsets are persisted in `_styles[field].offsetX/offsetY` and transported with the existing text style contract. Authored transforms are preserved; zero offsets restore the original position. A completed drag is one Undo step. Delete hides the text field, preserving the scene and allowing Restore. The existing bottom toolbar and Properties controls are reused; hidden theme configuration has no Delete control. Undo, Redo, Save/reload, Restore and Reset position use the existing save API. Actual rendered boards in both orientations were tested.

## Location navigation and complete logos

Dashboard Sites links carry `?group=<id>` (or `__ungrouped__`). Screens consumes the intent after groups load, clears list filters, opens that group, scrolls it into view and focuses its heading. The desktop Dashboard row and responsive deep link are exercised in real Chrome/WebKit. The compact Mobile Dashboard does not have a Sites table.

`ScreenMap.tsx` retains circular health rings but pads the full logo inside them and removes the image's own circular clip. A real click failure was also reproduced: Leaflet focused the map on mousedown, scrolling the dashboard's nested container 188 pixels before mouseup and missing the marker. Capturing focus with `preventScroll: true` preserves the pointer target and keyboard controls. Natural marker clicks now open the location panel without moving its position.

## Emergency content card presentation

Orientation tabs use two bounded grid columns. Content-card grids choose their column count from available content width rather than viewport width, keeping labels readable even within the narrower Settings shell. Headers wrap instead of overflowing. This changes presentation only: trigger, all-clear, asset bindings, upload/delete handlers, delivery, authentication and audit behavior are unchanged.

## Template → screen handoff

`usePutOnScreen` still creates a playlist referencing the chosen template. It now opens that playlist's Content workspace directly with `?addScreens=1`. After the actual playlist and signed-in user load, the route consumes the intent and opens the existing Add screens picker above the loaded template. Navigation writes no schedule. Cancel leaves the template playlist selected for review/editing; actual screen selection continues through the existing checked publishing flow. Legacy `?publishPlaylist=` links reach the same Content/picker flow. Read-only and protected playlists do not automatically open it.

Release/CI evidence, screenshots and remaining physical validations are kept in the task checklist. No new Android APK is needed for these hosted dashboard/API changes.

## Local verification receipt

62 production-build Chrome/WebKit browser cases passed without retries. 76 editor/map unit suites (890 assertions), 31 additional route/settings assertions and 18 API image/publication assertions passed. The rendered screenshots were reviewed, including the narrow Settings shell and the template picker handoff. The final pre-push preflight and CI/deployment are recorded separately after publication.
