/**
 * /[schoolId]/settings/integrations/ai — §8 alias for /settings/ai.
 *
 * Both routes render the SAME page component. The old URL is preserved
 * (bookmarks, support links) rather than redirected; this nested path is
 * the new canonical destination the Integrations catalog links to.
 */
export { default } from '../../ai/page';
