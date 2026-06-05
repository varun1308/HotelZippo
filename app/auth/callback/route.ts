/* OAuth callback (Phase 4 · specs/04-auth-persistence.md Stage 2).
 * Google redirects here with a `code`; we exchange it for a cookie-based session via
 * @supabase/ssr, then send the user to /chat. On any failure we redirect to / with a
 * NON-BLOCKING error param (the landing reads `?error=auth` and shows a warm message,
 * per spec 14 "warm, human errors / always a clear next action") — never a raw error,
 * never a broken/blank state. */
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/db/ssr';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  // Google may redirect back with its own error (e.g. user cancelled consent).
  const oauthError = searchParams.get('error');

  if (oauthError || !code) {
    return NextResponse.redirect(`${origin}/?error=auth`);
  }

  // The response carries cookies the Supabase client sets during the exchange.
  const response = NextResponse.redirect(`${origin}/chat`);
  const supabase = createSupabaseServerClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookies) => {
      for (const { name, value, options } of cookies) {
        response.cookies.set(name, value, options);
      }
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/?error=auth`);
  }

  return response;
}
