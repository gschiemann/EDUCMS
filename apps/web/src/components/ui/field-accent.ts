/**
 * What "indigo" / "sky" mean to `TimeField` and `DateField`.
 *
 * The schedule sub-form already carries an `accent` prop (`SCHED_ACCENT` in
 * PlaylistCreateWizard) so the wizard and the publish sheet can tint the same
 * markup differently. These fields need the same two accents, and Tailwind
 * only sees class names it can read literally in the source — so the pairs
 * live here rather than being interpolated per call site.
 */
export const FIELD_ACCENT = {
  indigo: {
    /** Focus ring on the field shell. */
    ring: 'focus-within:ring-indigo-500',
    /** The committed value, in the option list / on the calendar. */
    selected: 'bg-indigo-600 text-white',
    /** Hover on an unselected row / day. */
    hover: 'hover:bg-indigo-50 hover:text-indigo-700',
    /** "Today" marker on the calendar — a ring, so it can coexist with selected. */
    today: 'ring-indigo-400',
    /** Text-only accents (footer buttons). */
    text: 'text-indigo-600 hover:text-indigo-800',
  },
  sky: {
    ring: 'focus-within:ring-sky-500',
    selected: 'bg-sky-600 text-white',
    hover: 'hover:bg-sky-50 hover:text-sky-700',
    today: 'ring-sky-400',
    text: 'text-sky-600 hover:text-sky-800',
  },
} as const;

export type FieldAccent = keyof typeof FIELD_ACCENT;
