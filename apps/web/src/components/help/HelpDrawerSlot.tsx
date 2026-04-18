// Thin re-export retained to keep the module graph stable. The drawer is now
// fully client-side and fetches articles lazily via /api/help/articles.
export { HelpDrawer as HelpDrawerSlot } from './HelpDrawer';
