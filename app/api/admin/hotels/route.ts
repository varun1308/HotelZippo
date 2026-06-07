/* Curation staging CRUD (curation_hotels). Server-side only; service client.
 *   GET   /api/admin/hotels?destination=Phuket   → list staged rows
 *   PATCH /api/admin/hotels  { id, ...fields }    → edit / set status (approve/reject)
 * Approval enforces the >=100-review rule (12a). See specs/12a-curation-tool.md. */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/server';
import { canApprove } from '@/lib/curation/validator';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const destination = searchParams.get('destination');
  const supabase = createServiceClient();
  let query = supabase.from('curation_hotels').select('*').order('tripadvisor_rank', { ascending: true });
  if (destination) query = query.eq('destination', destination);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hotels: data ?? [] });
}

export async function PATCH(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { id, ...rawFields } = body as { id?: string } & Record<string, unknown>;
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  // Whitelist the editable columns rather than passing the body through blindly.
  const ALLOWED = ['status', 'google_place_id', 'latitude', 'longitude', 'address', 'brand', 'price_tier'] as const;
  const fields: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in rawFields) fields[k] = rawFields[k];
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'no_editable_fields' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Guard the approve transition with the review-count rule.
  if (fields.status === 'approved') {
    const { data: row } = await supabase
      .from('curation_hotels')
      .select('review_count')
      .eq('id', id)
      .maybeSingle();
    const check = canApprove({ review_count: (row?.review_count ?? null) as number | null });
    if (!check.ok) {
      return NextResponse.json({ error: 'cannot_approve', reasons: check.errors }, { status: 422 });
    }
  }

  const { data, error } = await supabase
    .from('curation_hotels')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hotel: data });
}
