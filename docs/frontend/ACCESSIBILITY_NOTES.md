# Accessibility (a11y) Notes

SaaS products designed for broad school staff adoption must be immediately usable by individuals with varying abilities, vision, and technical comfort levels.

## Accessible Contrast
- Our slate-based foundational themes (`slate-800/900` vs `white`) must strictly adhere to WCAG 2.1 AA standards, guaranteeing a minimum 4.5:1 contrast ratio for standard text.
- Primary CTA buttons (e.g., white text over `indigo-600`) must be rigorously tested.
- **Emergency Indicators:** Warning states utilize specialized high-contrast pairs (e.g., stark white text on a deep red warning background), carefully avoiding pure red-green combinations to ensure viability for users with color blindness.

## Keyboard Support & Focus Management
- Every interactive control must be cleanly focusable utilizing semantic `<button>` or `<a>` HTML elements.
- Custom interactive overlays—such as Modals, multi-select Dropdowns, and dnd-kit Drag Zones—leverage `shadcn/ui` and Radix UI Primitives underneath to guarantee standards-compliant DOM focus flows.
- **Focus Trapping:** Overlays and Dialogs actively trap keyboard focus when active, preventing hidden navigation bleeding, and elegantly return focus to the initial triggering element when dismissed.
- **Skip Links:** A visually hidden "Skip to main content" mechanism is implemented early in the DOM to serve screen reader efficiency, bypassing redundant sidebar links.

## Screen Reader Semantics (ARIA)
- Polished empty states must include visually hidden `sr-only` text blocks summarizing the empty context for readers.
- Dynamic dashboard updates (e.g., "Device rebooting...", "Template saved") must utilize `aria-live="polite"`. High priority alerts use `aria-live="assertive"` so screen readers interject immediately.
- Decorative Loading skeletons are suppressed via `aria-hidden="true"`, replaced internally with concise screen-reader text explaining the data loading context.

## Cognitive Load Management
- System training requirements are kept to a minimum by maintaining distinct icons paired *with* explicit text labels, actively avoiding obfuscated, deeply nested hover menus.
- **Destructive Friction:** Actions causing deletion or global screen overrides uniformly demand a secondary interactive confirmation step, drastically reducing user anxiety regarding accidental clicks.
