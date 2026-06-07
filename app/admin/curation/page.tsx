/* Hotel Curation Tool — /admin/curation (12a). Internal admin tool, no auth in v1.
 * Destination tabs + counts, Fetch / Publish / Seed buttons, editable candidate cards
 * with approve/reject. State is persisted server-side in curation_hotels (resumable).
 * Styled with the locked design tokens (specs/05). */
'use client';

import { useCallback, useEffect, useState } from 'react';

const DESTINATIONS = ['Phuket', 'Hong Kong', 'Singapore', 'Maldives', 'Bali'] as const;
type Destination = (typeof DESTINATIONS)[number];

interface Row {
  id: string;
  name: string;
  destination: string;
  review_count: number | null;
  tripadvisor_rank: number | null;
  brand: string | null;
  price_tier: string | null;
  star_rating: number | null;
  images: string[] | null;
  google_place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  status: 'pending' | 'approved' | 'rejected';
}

export default function CurationPage() {
  const [active, setActive] = useState<Destination>('Phuket');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');

  const load = useCallback(async (dest: Destination) => {
    const res = await fetch(`/api/admin/hotels?destination=${encodeURIComponent(dest)}`);
    const json = await res.json();
    setRows(json.hotels ?? []);
  }, []);

  useEffect(() => {
    void load(active);
  }, [active, load]);

  async function fetchHotels() {
    setBusy('fetch');
    setNotice('');
    const res = await fetch('/api/admin/fetch-hotels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: active }),
    });
    const json = await res.json();
    setNotice(res.ok ? `Fetched ${json.staged} via ${json.source}.` : `Error: ${json.error}`);
    await load(active);
    setBusy(null);
  }

  async function setStatus(id: string, status: Row['status']) {
    setBusy(id);
    const res = await fetch('/api/admin/hotels', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) {
      const json = await res.json();
      setNotice(`Cannot ${status}: ${(json.reasons ?? [json.error]).join(' ')}`);
    }
    await load(active);
    setBusy(null);
  }

  async function resolvePlaces() {
    setBusy('resolve');
    setNotice('');
    const res = await fetch('/api/admin/curation/resolve-places', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: active }),
    });
    const json = await res.json();
    setNotice(
      res.ok
        ? `Resolved ${json.resolved}/${json.total} place ids; skipped ${json.skipped?.length ?? 0}${
            json.lowConfidence?.length ? ` · ${json.lowConfidence.length} name-only (check)` : ''
          }.`
        : `Error: ${json.reason ?? json.error}`,
    );
    await load(active);
    setBusy(null);
  }

  /** Inline edit of a single editable field (e.g. a manually-entered google_place_id). */
  async function setField(id: string, field: string, value: string) {
    setBusy(id);
    const res = await fetch('/api/admin/hotels', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, [field]: value === '' ? null : value }),
    });
    if (!res.ok) {
      const json = await res.json();
      setNotice(`Edit failed: ${json.error ?? ''}`);
    }
    await load(active);
    setBusy(null);
  }

  async function publish() {
    setBusy('publish');
    setNotice('');
    const res = await fetch('/api/admin/publish-hotels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: active }),
    });
    const json = await res.json();
    setNotice(
      res.ok
        ? `Published ${json.published}; skipped ${json.skipped?.length ?? 0}.`
        : `Error: ${json.error}`,
    );
    await load(active);
    setBusy(null);
  }

  async function seedIntelligence() {
    setBusy('seed');
    setNotice('');
    const res = await fetch('/api/admin/seed-intelligence', { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setNotice(
        `Seeded ${json.written ?? 0} intelligence records; skipped ${json.skipped ?? 0}.`,
      );
    } else {
      // Fail-loud: surface the message + the per-file reasons (which hotels to publish).
      const fileReasons = (json.details ?? [])
        .map((d: { file: string; reason: string }) => `${d.file}: ${d.reason}`)
        .join(' · ');
      setNotice(
        `Seed failed (${json.error ?? res.status}): ${json.message ?? ''}${
          fileReasons ? ` — ${fileReasons}` : ''
        }`,
      );
    }
    setBusy(null);
  }

  const counts = rows.reduce(
    (acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc),
    {} as Record<string, number>,
  );

  return (
    <main className="mx-auto max-w-card px-6 py-10">
      <p className="font-mono text-label uppercase text-primary-600">Admin · Curation</p>
      <h1 className="mb-6 font-serif text-h1 text-text">Hotel Curation</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        {DESTINATIONS.map((d) => (
          <button
            key={d}
            onClick={() => setActive(d)}
            className={`rounded-pill px-4 py-2 text-body-sm transition-colors duration-base ${
              active === d
                ? 'bg-primary text-on-primary'
                : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <button
          onClick={fetchHotels}
          disabled={!!busy}
          className="rounded-btn bg-primary px-4 py-2 text-body-sm text-on-primary disabled:opacity-50"
        >
          {busy === 'fetch' ? 'Fetching…' : 'Fetch Hotels'}
        </button>
        <button
          onClick={resolvePlaces}
          disabled={!!busy}
          className="rounded-btn border border-border-strong px-4 py-2 text-body-sm text-text disabled:opacity-50"
        >
          {busy === 'resolve' ? 'Resolving…' : 'Resolve Place IDs'}
        </button>
        <button
          onClick={publish}
          disabled={!!busy}
          className="rounded-btn border border-border-strong px-4 py-2 text-body-sm text-text disabled:opacity-50"
        >
          {busy === 'publish' ? 'Publishing…' : 'Publish to Hotels'}
        </button>
        <button
          onClick={seedIntelligence}
          disabled={!!busy}
          className="rounded-btn border border-border-strong px-4 py-2 text-body-sm text-text disabled:opacity-50"
        >
          {busy === 'seed' ? 'Seeding…' : 'Seed Demo Intelligence'}
        </button>
      </div>

      <p className="mb-4 font-mono text-caption text-text-tertiary">
        {rows.length} staged · {counts.approved ?? 0} approved · {counts.pending ?? 0} pending ·{' '}
        {counts.rejected ?? 0} rejected
      </p>

      {notice && (
        <p className="mb-4 rounded-input bg-surface-2 px-4 py-3 text-body-sm text-text-secondary">
          {notice}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 shadow-card"
          >
            <div>
              <p className="text-body text-text">{r.name}</p>
              <p className="font-mono text-caption text-text-tertiary">
                #{r.tripadvisor_rank ?? '—'} · {r.review_count ?? 0} reviews ·{' '}
                {r.star_rating ?? '—'}★ · {r.price_tier ?? '—'} · {r.brand ?? '—'}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`font-mono text-caption ${
                    r.google_place_id ? 'text-success-text' : 'text-text-tertiary'
                  }`}
                >
                  place: {r.google_place_id ? `${r.google_place_id} ✓` : '— unresolved'}
                </span>
                <input
                  aria-label={`Google place id for ${r.name}`}
                  defaultValue={r.google_place_id ?? ''}
                  placeholder="paste place id"
                  disabled={busy === r.id}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (r.google_place_id ?? '')) void setField(r.id, 'google_place_id', v);
                  }}
                  className="w-48 rounded-input border border-border bg-surface-2 px-2 py-0.5 font-mono text-caption text-text"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-pill px-3 py-1 text-caption ${
                  r.status === 'approved'
                    ? 'bg-success-bg text-success-text'
                    : r.status === 'rejected'
                      ? 'bg-surface-3 text-text-tertiary'
                      : 'bg-surface-2 text-text-secondary'
                }`}
              >
                {r.status}
              </span>
              <button
                onClick={() => setStatus(r.id, 'approved')}
                disabled={busy === r.id}
                className="rounded-btn bg-primary px-3 py-1 text-caption text-on-primary disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => setStatus(r.id, 'rejected')}
                disabled={busy === r.id}
                className="rounded-btn border border-border-strong px-3 py-1 text-caption text-text-secondary disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
