import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTokenFor } from "@/lib/session";

// Owner login gate (SPEC §32 — secure login, minimum viable version).
// When APP_PASSWORD is set, every route except /login requires the signed
// session cookie. When unset (local dev), the gate is disabled.
// Passkeys/Face ID are the planned upgrade — see docs/ROADMAP.md.

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && cookie === (await sessionTokenFor(password))) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/health).*)"],
};
