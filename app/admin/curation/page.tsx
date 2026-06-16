/* Hotel Curation Tool — /admin/curation (12a + 12h). Internal admin tool, no auth in v1.
 * Destination tabs + counts, candidate cards with approve/reject + place-id edit, and the
 * Publish / Seed actions. The hotel FETCH now goes through the Apify Run Ledger (12h):
 *   Start Fetch → async run (no ~5-min block) → poll status → Ingest the dataset → stage.
 * A Runs panel shows history + un-ingested (already-paid) runs to re-pull for free, plus Refresh.
 * State is persisted server-side (curation_hotels + apify_runs), so the flow is resumable.
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

interface ApifyRun {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'ingested';
  itemCount: number | null;
  ingestedAt: string | null;
  costEstimate: number | null;
  error: string | null;
  startedAt: string;
}

const ACTIVE = (s: ApifyRun['status']) => s === 'pending' || s === 'running';

export default function CurationPage() {
  const [active, setActive] = useState<Destination>('Phuket');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [runs, setRuns] = useState<ApifyRun[]>([]);
  // A succeeded/ingested run found by the reuse guard, awaiting the operator's choice.
  const [reusable, setReusable] = useState<ApifyRun | null>(null);
  // The run we're actively polling (just started).
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const load = useCallback(async (dest: Destination) => {
    const res = await fetch(`/api/admin/hotels?destination=${encodeURIComponent(dest)}`);
    const json = await res.json();
    setRows(json.hotels ?? []);
  }, []);

  const loadRuns = useCallback(async (dest: Destination) => {
    const res = await fetch(`/api/admin/curation/runs?destination=${encodeURIComponent(dest)}`);
    const json = await res.json();
    setRuns(json.runs ?? []);
  }, []);

  useEffect(() => {
    void load(active);
    void loadRuns(active);
    setReusable(null);
    setActiveRunId(null);
  }, [active, load, loadRuns]);

  // Poll the active run until it leaves pending/running, then refresh the runs list.
  useEffect(() => {
    if (!activeRunId) return;
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/admin/curation/run/status?runId=${activeRunId}`);
      const json = await res.json();
      const run: ApifyRun | undefined = json.run;
      if (!run) return;
      await loadRuns(active);
      if (!ACTIVE(run.status)) {
        setActiveRunId(null);
        setNotice(
          run.status === 'succeeded'
            ? `Run finished (${run.itemCount ?? '?'} items). Click Ingest to stage them.`
            : `Run ${run.status}${run.error ? `: ${run.error}` : ''}.`,
        );
      }
    };
    const id = setInterval(() => {
      if (!stop) void tick();
    }, 4000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [activeRunId, active, loadRuns]);

  /** Start a fetch run. force=true skips the reuse guard. */
  async function startFetch(force = false) {
    setBusy('fetch');
    setNotice('');
    setReusable(null);
    const res = await fetch('/api/admin/curation/run/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: active, force }),
    });
    const json = await res.json();
    if (!res.ok) {
      setNotice(`Error: ${json.reason ?? json.error}`);
    } else if (json.reusable) {
      // Reuse guard fired — warn, let the operator choose (never auto-skip).
      setReusable(json.reusable);
      setNotice('');
    } else if (json.run) {
      setActiveRunId(json.run.id);
      setNotice('Run started — polling for completion…');
    }
    await loadRuns(active);
    setBusy(null);
  }

  async function ingestRun(runId: string) {
    setBusy(`ingest-${runId}`);
    setNotice('');
    setReusable(null);
    const res = await fetch('/api/admin/curation/run/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    const json = await res.json();
    setNotice(res.ok ? `Ingested ${json.ingested} candidates (${json.items} items).` : `Error: ${json.reason ?? json.error}`);
    await load(active);
    await loadRuns(active);
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
      res.ok ? `Published ${json.published}; skipped ${json.skipped?.length ?? 0}.` : `Error: ${json.error}`,
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
      setNotice(`Seeded ${json.written ?? 0} intelligence records; skipped ${json.skipped ?? 0}.`);
    } else {
      const fileReasons = (json.details ?? [])
        .map((d: { file: string; reason: string }) => `${d.file}: ${d.reason}`)
        .join(' · ');
      setNotice(
        `Seed failed (${json.error ?? res.status}): ${json.message ?? ''}${fileReasons ? ` — ${fileReasons}` : ''}`,
      );
    }
    setBusy(null);
  }

  const counts = rows.reduce(
    (acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc),
    {} as Record<string, number>,
  );
  const unIngested = runs.filter((r) => r.status === 'succeeded' && !r.ingestedAt);
  const polling = !!activeRunId;

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
              active === d ? 'bg-primary text-on-primary' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <button
          onClick={() => startFetch(false)}
          disabled={!!busy || polling}
          className="rounded-btn bg-primary px-4 py-2 text-body-sm text-on-primary disabled:opacity-50"
        >
          {polling ? 'Run in progress…' : busy === 'fetch' ? 'Starting…' : 'Start Fetch'}
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

      {/* Reuse guard — warn, never auto-skip. */}
      {reusable && (
        <div className="mb-4 rounded-card border border-border-strong bg-surface-2 px-4 py-3">
          <p className="text-body-sm text-text">
            {active} was curated{' '}
            {new Date(reusable.startedAt).toLocaleDateString()} ({reusable.itemCount ?? '?'} items
            {reusable.costEstimate != null ? `, ~$${reusable.costEstimate.toFixed(2)}` : ''}). Re-pull that
            dataset for free, or run a fresh (paid) fetch?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => ingestRun(reusable.id)}
              disabled={!!busy}
              className="rounded-btn bg-primary px-3 py-1 text-caption text-on-primary disabled:opacity-50"
            >
              Re-pull free
            </button>
            <button
              onClick={() => startFetch(true)}
              disabled={!!busy}
              className="rounded-btn border border-border-strong px-3 py-1 text-caption text-text-secondary disabled:opacity-50"
            >
              Force fresh fetch
            </button>
            <button
              onClick={() => setReusable(null)}
              disabled={!!busy}
              className="rounded-btn px-3 py-1 text-caption text-text-tertiary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="mb-4 font-mono text-caption text-text-tertiary">
        {rows.length} staged · {counts.approved ?? 0} approved · {counts.pending ?? 0} pending ·{' '}
        {counts.rejected ?? 0} rejected
      </p>

      {notice && (
        <p className="mb-4 rounded-input bg-surface-2 px-4 py-3 text-body-sm text-text-secondary">{notice}</p>
      )}

      {/* Runs panel (history + un-ingested reuse + refresh). */}
      <section className="mb-6 rounded-card border border-border bg-surface px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-mono text-label uppercase text-text-tertiary">Apify runs · {active}</p>
          <button
            onClick={() => startFetch(false)}
            disabled={!!busy || polling}
            className="rounded-btn border border-border-strong px-3 py-1 text-caption text-text-secondary disabled:opacity-50"
          >
            Refresh (new run)
          </button>
        </div>
        {unIngested.length > 0 && (
          <p className="mb-2 rounded-input bg-success-bg px-3 py-2 text-caption text-success-text">
            {unIngested.length} succeeded run(s) not yet ingested — re-pull below for free.
          </p>
        )}
        {runs.length === 0 ? (
          <p className="text-caption text-text-tertiary">No runs yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-caption">
                <span className="font-mono text-text-tertiary">
                  {new Date(r.startedAt).toLocaleString()} · {r.status}
                  {r.itemCount != null ? ` · ${r.itemCount} items` : ''}
                  {r.costEstimate != null ? ` · ~$${r.costEstimate.toFixed(2)}` : ''}
                  {r.error ? ` · ${r.error}` : ''}
                </span>
                {(r.status === 'succeeded' || r.status === 'ingested') && (
                  <button
                    onClick={() => ingestRun(r.id)}
                    disabled={!!busy}
                    className="rounded-btn border border-border-strong px-2 py-0.5 text-caption text-text-secondary disabled:opacity-50"
                  >
                    {busy === `ingest-${r.id}` ? 'Ingesting…' : r.status === 'ingested' ? 'Re-ingest' : 'Ingest'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 shadow-card"
          >
            <div>
              <p className="text-body text-text">{r.name}</p>
              <p className="font-mono text-caption text-text-tertiary">
                #{r.tripadvisor_rank ?? '—'} · {r.review_count ?? 0} reviews · {r.star_rating ?? '—'}★ ·{' '}
                {r.price_tier ?? '—'} · {r.brand ?? '—'}
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
