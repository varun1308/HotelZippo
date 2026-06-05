/* Auth middleware (Phase 4 · specs/04-auth-persistence.md Stage 3).
 *
 * Two jobs on every matched request:
 *   1. Refresh the Supabase session (so the cookie-based session stays alive across
 *      navigations — the @supabase/ssr requirement: call getUser() in middleware).
 *   2. Hard-gate the consumer app: an unauthenticated request to /chat → redirect to /.
 *
 * NOT gated: /admin/* stays no-auth internal for v1 (consistent with the curation tool
 * 12a and the pipeline admin UI 08a-5) — see the matcher below, which never matches it.
 *
 * Env-safe: if Supabase env is missing the helper throws; we treat that as "no session"
 * and let the request through unchanged rather than 500, so the app still renders. The
 * real gate is active wherever env is configured (every real deployment). */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return response; // no auth configured → don't gate, don't crash
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        // Write cookies onto BOTH the request (for any downstream read in this pass)
        // and a fresh response (returned to the browser) — the @supabase/ssr pattern.
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh + read the user. Do not run other logic between createServerClient and this.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = path === '/chat' || path.startsWith('/chat/');
  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  // Run on app routes but skip static assets, image optimisation, the auth callback,
  // and /admin/* (intentionally ungated for v1). /api is also excluded — route handlers
  // do their own auth where needed.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback|admin|api).*)'],
};
