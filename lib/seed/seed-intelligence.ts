/* Demo Intelligence seeding (12d / specs/12d-seed-script.md). Server-side only.
 *
 * Reads hand-authored JSON files from scripts/seed/demo_intelligence/, validates each
 * with Zod, resolves hotel_id by (hotel_name, destination) against public.hotels, and
 * upserts into public.hotel_intelligence on hotel_id (idempotent), setting
 * low_confidence = false. Returns { written, skipped, details }.
 *
 * Fail-loud contract (12d): if any demo file names a hotel not present in `hotels`
 * (i.e. Publish-to-Hotels has not been run for it), the whole seed ABORTS before any
 * write — it does NOT silently skip. Same for malformed JSON / schema-invalid files.
 * This is all-or-nothing so a partial seed can never leave the demo half-populated. */
import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demoIntelligenceSchema, type DemoIntelligence, type SeedResult } from './types';

export const DEMO_DIR = path.join(process.cwd(), 'scripts', 'seed', 'demo_intelligence');

/** Raised on any fail-loud condition (no files, bad JSON, schema error, missing hotel).
 * `details` carries per-file diagnostics so the admin sees exactly what to fix. */
export class SeedError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'no_files'
      | 'invalid_json'
      | 'schema_invalid'
      | 'hotels_not_published',
    readonly details: Array<{ file: string; reason: string }> = [],
  ) {
    super(message);
    this.name = 'SeedError';
  }
}

interface LoadedFile {
  file: string;
  record: DemoIntelligence;
}

/** Load + Zod-validate every *.json in `dir`. Throws SeedError on any problem. */
export async function loadDemoFiles(dir: string = DEMO_DIR): Promise<LoadedFile[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  } catch {
    throw new SeedError(`demo intelligence directory not found: ${dir}`, 'no_files');
  }
  if (entries.length === 0) {
    throw new SeedError(
      `no demo intelligence files found in ${dir} — founder authors these (see specs/12d).`,
      'no_files',
    );
  }

  const loaded: LoadedFile[] = [];
  const jsonErrors: Array<{ file: string; reason: string }> = [];
  const schemaErrors: Array<{ file: string; reason: string }> = [];

  for (const file of entries) {
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      jsonErrors.push({ file, reason: e instanceof Error ? e.message : 'invalid JSON' });
      continue;
    }
    const result = demoIntelligenceSchema.safeParse(parsed);
    if (!result.success) {
      schemaErrors.push({
        file,
        reason: result.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
      });
      continue;
    }
    loaded.push({ file, record: result.data });
  }

  if (jsonErrors.length > 0) {
    throw new SeedError(`malformed JSON in ${jsonErrors.length} demo file(s)`, 'invalid_json', jsonErrors);
  }
  if (schemaErrors.length > 0) {
    throw new SeedError(
      `schema validation failed for ${schemaErrors.length} demo file(s)`,
      'schema_invalid',
      schemaErrors,
    );
  }
  return loaded;
}

/** Seed demo intelligence. All-or-nothing on the fail-loud conditions above. */
export async function seedIntelligence(
  supabase: SupabaseClient,
  dir: string = DEMO_DIR,
): Promise<SeedResult> {
  const files = await loadDemoFiles(dir);

  // Resolve every (hotel_name, destination) up front so a missing hotel aborts the
  // whole run before any write — the fail-loud requirement in 12d.
  const resolved: Array<{ file: string; record: DemoIntelligence; hotel_id: string }> = [];
  const missing: Array<{ file: string; reason: string }> = [];

  for (const { file, record } of files) {
    const { data, error } = await supabase
      .from('hotels')
      .select('id')
      .eq('name', record.hotel_name)
      .eq('destination', record.destination)
      .maybeSingle();
    if (error) {
      throw new SeedError(`hotel lookup failed for ${file}: ${error.message}`, 'hotels_not_published', [
        { file, reason: error.message },
      ]);
    }
    if (!data) {
      missing.push({
        file,
        reason: `hotel not in public.hotels — Publish-to-Hotels first: "${record.hotel_name}" (${record.destination})`,
      });
      continue;
    }
    resolved.push({ file, record, hotel_id: data.id });
  }

  if (missing.length > 0) {
    throw new SeedError(
      `${missing.length} demo hotel(s) not yet published — run Publish-to-Hotels first`,
      'hotels_not_published',
      missing,
    );
  }

  // All hotels resolved — upsert intelligence rows on hotel_id (idempotent).
  const result: SeedResult = { written: 0, skipped: 0, details: [] };
  for (const { file, record, hotel_id } of resolved) {
    const { hotel_name: _hotel_name, destination: _destination, ...intel } = record;
    const { error } = await supabase
      .from('hotel_intelligence')
      .upsert(
        {
          hotel_id,
          ...intel,
          last_refreshed: new Date().toISOString(),
          low_confidence: false,
        },
        { onConflict: 'hotel_id' },
      );
    if (error) {
      result.skipped += 1;
      result.details.push({
        file,
        hotel_name: record.hotel_name,
        destination: record.destination,
        action: 'skipped',
        reason: error.message,
      });
      continue;
    }
    result.written += 1;
    result.details.push({
      file,
      hotel_name: record.hotel_name,
      destination: record.destination,
      action: 'written',
      hotel_id,
    });
  }

  return result;
}
