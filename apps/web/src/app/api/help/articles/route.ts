// Serves the parsed help articles as JSON. Used by the in-app HelpDrawer,
// which is a client component and can't read from the filesystem directly.
// Also handy if anyone wants to consume help content programmatically.

import { NextResponse } from 'next/server';
import { getAllArticles } from '@/content/help';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json({ articles: getAllArticles() });
}
