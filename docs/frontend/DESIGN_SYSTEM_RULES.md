# Design System & Aesthetics

## Core Aesthetic: Modern SaaS
- Break away from default "Bootstrap" utility aesthetics. The interface should feel premium, similar to platforms like Vercel, Linear, or Stripe.
- **Foundation:** `slate-800` and `slate-900` for deep dark mode backgrounds; `slate-50` and `white` for light mode to maintain a crisp feel.
- **Accents:** Use a refined primary color (e.g., `indigo-500` or a technical teal) for CTAs, avoiding overly saturated primary hex codes outside of semantic success/error states.

## Typography Hierarchy
We utilize a modern, highly legible sans-serif font (e.g., Inter, Geist) leveraging Tailwind's tracking defaults.
- `h1`: `text-3xl font-semibold tracking-tight text-slate-900 dark:text-white`
- `h2`: `text-xl font-medium tracking-tight text-slate-800 dark:text-slate-100`
- `body`: `text-sm text-slate-600 dark:text-slate-400`
- `labels`: `text-xs font-semibold uppercase tracking-wider text-slate-500`

## Crisp Spacing System
- Strict adherence to an 8px grid.
- Use `gap-6` and `gap-8` for major compositional sections.
- Use `gap-4` for distinct related elements.
- Use `gap-2` for fine typography stacking.
- Generous padding (`p-6`, `p-8`) inside cards and panels is mandatory to create breathing room.

## Glassmorphism & Depth
- Utilize subtle glassmorphism for Modals, Popovers, and Sticky Headers: `bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800`.
- Shadows should be soft, voluminous, and deep: `shadow-lg shadow-slate-200/50 dark:shadow-none`.

## Polished Micro-Interactions
- **Empty States:** Never render an empty table or blank list. Always provide a high-quality illustration or icon, a clear generic title, a helpful description, and a primary CTA (e.g., "Create your first playlist").
- **Toasts:** Use `sonner` or shadcn's toast component for crisp, animated bottom-right notifications.
- **Loading Skeletons:** Match the exact dimensions of the content they replace via `animate-pulse`, using clean backgrounds `bg-slate-100 dark:bg-slate-800`.
- **Transitions:** All buttons, row hovers, and links must have smooth interactions via `transition-all duration-200 ease-in-out`.
