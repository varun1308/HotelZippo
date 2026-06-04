/* Unit tests for demo-intelligence loading + validation (12d / 12e).
 * Pure file IO + Zod — no DB. Exercises the fail-loud load paths:
 * no files, malformed JSON, schema-invalid; plus a valid round-trip. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDemoFiles, SeedError } from '@/lib/seed/seed-intelligence';
import { demoIntelligenceSchema } from '@/lib/seed/types';

const validRecord = {
  hotel_name: 'JW Marriott Phuket Resort & Spa',
  destination: 'Phuket',
  rooms_summary: 'Spacious family rooms.',
  facilities_summary: 'Large pools and kids club.',
  food_summary: 'Wide buffet.',
  location_summary: 'Quiet Mai Khao beach.',
  hard_flags: [
    { category: 'refurbishment', description: 'Partial wing refurb', severity: 'moderate', review_evidence_count: 12 },
  ],
  conflicting_signals: { rooms: '', facilities: '', food: '', location: '' },
  family_signal_strength: { rooms: 'strong', facilities: 'strong', food: 'thin', location: 'strong' },
  supporting_phrases: { rooms: ['great for kids'], facilities: [], food: [], location: [] },
  indian_food_signal: 'Indian breakfast options on request.',
  review_count_family: 320,
  review_count_total: 4200,
};

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-intel-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeFile(name: string, content: string) {
  await fs.writeFile(path.join(dir, name), content, 'utf8');
}

describe('demoIntelligenceSchema', () => {
  it('accepts a complete record', () => {
    expect(demoIntelligenceSchema.safeParse(validRecord).success).toBe(true);
  });
  it('rejects an unknown destination', () => {
    expect(demoIntelligenceSchema.safeParse({ ...validRecord, destination: 'Goa' }).success).toBe(false);
  });
  it('rejects an unknown flag severity', () => {
    const bad = { ...validRecord, hard_flags: [{ category: 'x', description: 'y', severity: 'mild' }] };
    expect(demoIntelligenceSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects extra top-level keys (strict)', () => {
    expect(demoIntelligenceSchema.safeParse({ ...validRecord, oops: 1 }).success).toBe(false);
  });
  it('requires all four category keys', () => {
    const bad = { ...validRecord, family_signal_strength: { rooms: 'strong' } };
    expect(demoIntelligenceSchema.safeParse(bad).success).toBe(false);
  });
});

describe('loadDemoFiles — fail-loud', () => {
  it('throws no_files when the directory is empty', async () => {
    await expect(loadDemoFiles(dir)).rejects.toMatchObject({ code: 'no_files' });
  });

  it('throws no_files when the directory does not exist', async () => {
    await expect(loadDemoFiles(path.join(dir, 'nope'))).rejects.toBeInstanceOf(SeedError);
  });

  it('throws invalid_json on malformed JSON, naming the file', async () => {
    await writeFile('broken.json', '{ not valid');
    await expect(loadDemoFiles(dir)).rejects.toMatchObject({
      code: 'invalid_json',
      details: [expect.objectContaining({ file: 'broken.json' })],
    });
  });

  it('throws schema_invalid on a structurally-wrong file', async () => {
    await writeFile('bad.json', JSON.stringify({ hotel_name: 'X', destination: 'Mars' }));
    await expect(loadDemoFiles(dir)).rejects.toMatchObject({ code: 'schema_invalid' });
  });

  it('loads valid files sorted, ignoring non-json', async () => {
    await writeFile('b.json', JSON.stringify({ ...validRecord, hotel_name: 'B' }));
    await writeFile('a.json', JSON.stringify({ ...validRecord, hotel_name: 'A' }));
    await writeFile('notes.txt', 'ignore me');
    const loaded = await loadDemoFiles(dir);
    expect(loaded.map((l) => l.file)).toEqual(['a.json', 'b.json']);
    expect(loaded[0].record.hotel_name).toBe('A');
  });
});
