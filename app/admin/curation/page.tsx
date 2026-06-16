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

/** A page-level notice with a kind so the banner can show success vs. problem distinctly. */
type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

const MIN_REVIEWS = 100; // mirrors lib/curation/types.MIN_REVIEWS (12a Rule #1); kept inline to avoid a server-only import.
const imageCount = (r: Row) => r.images?.length ?? 0;

export default function CurationPage() {
  const [active, setActive] = useState<Destination>('Phuket');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [runs, setRuns] = useState<ApifyRun[]>([]);
  // A succeeded/ingested run found by the reuse guard, awaiting the operator's choice.
  const [reusable, setReusable] = useState<ApifyRun | null>(null);
  // The run we're actively polling (just started).
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // Operator-scale controls (250 hotels ≈ 50/destination): triage the list without endless scroll.
  const [statusFilter, setStatusFilter] = useState<'all' | Row['status']>('pending');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'rank' | 'reviews' | 'attention'>('rank');

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
            ? { kind: 'ok', text: 'Run finished — click Ingest below to stage the results.' }
            : { kind: 'error', text: `Run ${run.status}${run.error ? `: ${run.error}` : ''}.` },
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
    setNotice(null);
    setReusable(null);
    const res = await fetch('/api/admin/curation/run/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: active, force }),
    });
    const json = await res.json();
    if (!res.ok) {
      setNotice({ kind: 'error', text: `Error: ${json.reason ?? json.error}` });
    } else if (json.reusable) {
      // Reuse guard fired — warn, let the operator choose (never auto-skip).
      setReusable(json.reusable);
      setNotice(null);
    } else if (json.run) {
      setActiveRunId(json.run.id);
      setNotice({ kind: 'info', text: 'Run started — polling for completion…' });
    }
    await loadRuns(active);
    setBusy(null);
  }

  async function ingestRun(runId: string) {
    setBusy(`ingest-${runId}`);
    setNotice(null);
    setReusable(null);
    const res = await fetch('/api/admin/curation/run/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    const json = await res.json();
    setNotice(
      res.ok
        ? { kind: 'ok', text: `Ingested ${json.ingested} candidates (${json.items} items).` }
        : { kind: 'error', text: `Error: ${json.reason ?? json.error}` },
    );
    await load(active);
    await loadRuns(active);
    setBusy(null);
  }

  async function setStatus(id: string, status: Row['status']) {
    setBusy(id);
    setNotice(null);
    const res = await fetch('/api/admin/hotels', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    const row = rows.find((r) => r.id === id);
    const label = row ? `"${row.name}"` : 'hotel';
    if (!res.ok) {
      const json = await res.json();
      // "Cannot approve …" — use the verb, not the status value (was "Cannot approved").
      const verb = status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : status;
      setNotice({ kind: 'error', text: `Cannot ${verb} ${label}: ${(json.reasons ?? [json.error]).join(' ')}` });
    } else {
      setNotice({ kind: 'ok', text: `${label} ${status}.` });
    }
    await load(active);
    setBusy(null);
  }

  async function resolvePlaces() {
    setBusy('resolve');
    setNotice(null);
    const res = await fetch('/api/admin/curation/resolve-places', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: active }),
    });
    const json = await res.json();
    setNotice(
      res.ok
        ? {
            kind: 'ok',
            text: `Resolved ${json.resolved}/${json.total} place ids; skipped ${json.skipped?.length ?? 0}${
              json.lowConfidence?.length ? ` · ${json.lowConfidence.length} name-only (check)` : ''
            }.`,
          }
        : { kind: 'error', text: `Error: ${json.reason ?? json.error}` },
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
      setNotice({ kind: 'error', text: `Edit failed: ${json.error ?? ''}` });
    }
    await load(active);
    setBusy(null);
  }

  async function publish() {
    setBusy('publish');
    setNotice(null);
    const res = await fetch('/api/admin/publish-hotels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: active }),
    });
    const json = await res.json();
    if (!res.ok) {
      setNotice({ kind: 'error', text: `Error: ${json.error}` });
    } else {
      const skipped: Array<{ name: string; reasons: string[] }> = json.skipped ?? [];
      // Name WHAT was skipped + why — a bare count hides which hotels failed and for what reason.
      const detail = skipped.length
        ? ` Skipped ${skipped.length}: ${skipped.map((s) => `${s.name} (${s.reasons.join(', ')})`).join('; ')}`
        : '';
      setNotice({
        kind: skipped.length ? 'info' : 'ok',
        text: `Published ${json.published} to Hotels.${detail}`,
      });
    }
    await load(active);
    setBusy(null);
  }

  async function seedIntelligence() {
    setBusy('seed');
    setNotice(null);
    const res = await fetch('/api/admin/seed-intelligence', { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setNotice({ kind: 'ok', text: `Seeded ${json.written ?? 0} intelligence records; skipped ${json.skipped ?? 0}.` });
    } else {
      const fileReasons = (json.details ?? [])
        .map((d: { file: string; reason: string }) => `${d.file}: ${d.reason}`)
        .join(' · ');
      setNotice({
        kind: 'error',
        text: `Seed failed (${json.error ?? res.status}): ${json.message ?? ''}${fileReasons ? ` — ${fileReasons}` : ''}`,
      });
    }
    setBusy(null);
  }

  /** Preview seeding (12i): Claude proposes names → RouteStack verifies → staged as source='preview'.
   * Operator-gated server-side (PREVIEW_SEEDING_ENABLED). Reports proposed → verified → dropped. */
  async function seedPreview() {
    setBusy('preview');
    setNotice(null);
    const res = await fetch('/api/admin/preview/seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: active }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = json.error === 'preview_seeding_disabled' ? 'preview seeding is disabled (set PREVIEW_SEEDING_ENABLED=1)' : json.reason ?? json.error;
      setNotice({ kind: 'error', text: `Preview seed failed: ${why}` });
    } else {
      const dropped = (json.dropped ?? []) as string[];
      const detail = dropped.length ? ` Dropped ${dropped.length} (not found in RouteStack): ${dropped.join(', ')}.` : '';
      setNotice({
        kind: dropped.length ? 'info' : 'ok',
        text: `Preview: proposed ${json.proposed}, verified ${json.verified?.length ?? 0}, staged ${json.staged}.${detail}`,
      });
      await load(active);
    }
    setBusy(null);
  }

  /** A row may be approved if it clears the review threshold (12a Rule #1). Image is a publish-time
   *  gate, not an approve-time one, so it's not checked here. */
  const approveEligible = (r: Row) => (r.review_count ?? 0) >= MIN_REVIEWS && r.status !== 'approved';

  /** Approve every currently-VISIBLE eligible row in one pass — turns N clicks into one. Only the
   *  rows the operator can see (after filter+search) are affected, so it's predictable. */
  async function bulkApproveVisible(targets: Row[]) {
    const eligible = targets.filter(approveEligible);
    if (eligible.length === 0) {
      setNotice({ kind: 'info', text: 'No eligible hotels to approve in the current view (need ≥100 reviews, not already approved).' });
      return;
    }
    setBusy('bulk');
    setNotice(null);
    let ok = 0;
    const failed: string[] = [];
    // Sequential to keep the server-side guard authoritative and avoid hammering the PATCH route.
    for (const r of eligible) {
      const res = await fetch('/api/admin/hotels', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: r.id, status: 'approved' }),
      });
      if (res.ok) ok += 1;
      else failed.push(r.name);
    }
    setNotice({
      kind: failed.length ? 'info' : 'ok',
      text: `Approved ${ok} hotel${ok === 1 ? '' : 's'}.${failed.length ? ` Could not approve ${failed.length}: ${failed.join(', ')}.` : ''}`,
    });
    await load(active);
    setBusy(null);
  }

  const counts = rows.reduce(
    (acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc),
    {} as Record<string, number>,
  );
  const unIngested = runs.filter((r) => r.status === 'succeeded' && !r.ingestedAt);
  const polling = !!activeRunId;

  // Apply status filter → name search → sort. Pure derivation over the loaded rows (≤~50/dest).
  const q = search.trim().toLowerCase();
  const visibleRows = rows
    .filter((r) => (statusFilter === 'all' ? true : r.status === statusFilter))
    .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
    .sort((a, b) => {
      if (sortBy === 'reviews') return (b.review_count ?? 0) - (a.review_count ?? 0);
      if (sortBy === 'attention') {
        // Rows that still need a human decision (no image / sub-100 reviews) float to the top.
        const score = (r: Row) => (imageCount(r) === 0 ? 2 : 0) + ((r.review_count ?? 0) < MIN_REVIEWS ? 1 : 0);
        return score(b) - score(a);
      }
      return (a.tripadvisor_rank ?? 9999) - (b.tripadvisor_rank ?? 9999);
    });
  const eligibleVisible = visibleRows.filter(approveEligible).length;
  const publishable = rows.filter((r) => r.status === 'approved' && imageCount(r) > 0).length;
  const STATUS_TABS: Array<{ key: 'all' | Row['status']; label: string; n: number }> = [
    { key: 'pending', label: 'Pending', n: counts.pending ?? 0 },
    { key: 'approved', label: 'Approved', n: counts.approved ?? 0 },
    { key: 'rejected', label: 'Rejected', n: counts.rejected ?? 0 },
    { key: 'all', label: 'All', n: rows.length },
  ];

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
        <button
          onClick={seedPreview}
          disabled={!!busy}
          title="Claude proposes names → RouteStack verifies → staged as a 'preview' tier (12i). Requires PREVIEW_SEEDING_ENABLED."
          className="rounded-btn border border-border-strong px-4 py-2 text-body-sm text-text disabled:opacity-50"
        >
          {busy === 'preview' ? 'Seeding preview…' : 'Seed preview (Claude + RouteStack)'}
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

      {/* Triage controls — at ~50 hotels/destination a flat list is unworkable; filter to the queue
          that needs a decision, search by name, sort, and bulk-approve the eligible ones. */}
      <p className="mb-2 font-mono text-caption text-text-tertiary">
        {rows.length} staged · {publishable} ready to publish
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            aria-pressed={statusFilter === t.key}
            className={`rounded-pill px-3 py-1 text-caption transition-colors duration-base ${
              statusFilter === t.key ? 'bg-primary text-on-primary' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
            }`}
          >
            {t.label} ({t.n})
          </button>
        ))}
        <input
          aria-label="Search hotels by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name…"
          className="ml-1 w-44 rounded-input border border-border bg-surface-2 px-2 py-1 text-caption text-text"
        />
        <label className="flex items-center gap-1 text-caption text-text-tertiary">
          Sort
          <select
            aria-label="Sort hotels"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-input border border-border bg-surface-2 px-2 py-1 text-caption text-text"
          >
            <option value="rank">TripAdvisor rank</option>
            <option value="reviews">Review count</option>
            <option value="attention">Needs attention</option>
          </select>
        </label>
        <button
          onClick={() => bulkApproveVisible(visibleRows)}
          disabled={!!busy || eligibleVisible === 0}
          title={eligibleVisible === 0 ? 'No eligible hotels in view (need ≥100 reviews, not already approved)' : undefined}
          className="ml-auto rounded-btn border border-border-strong px-3 py-1 text-caption text-text disabled:opacity-50"
        >
          {busy === 'bulk' ? 'Approving…' : `Approve eligible in view (${eligibleVisible})`}
        </button>
      </div>

      {notice && (
        <p
          role="status"
          aria-live="polite"
          className={`mb-4 rounded-input px-4 py-3 text-body-sm ${
            notice.kind === 'ok'
              ? 'bg-success-bg text-success-text'
              : notice.kind === 'error'
                ? 'border border-border-strong bg-surface-2 font-medium text-text'
                : 'bg-surface-2 text-text-secondary'
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* Runs panel (history + un-ingested reuse + refresh). */}
      <section className="mb-6 rounded-card border border-border bg-surface px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-mono text-label uppercase text-text-tertiary">Apify runs · {active}</p>
          {/* "Refresh" starts a NEW paid run — kept visually subordinate so it isn't mistaken for the
              free next step (Ingest). The label says "(paid)" to make the cost explicit. */}
          <button
            onClick={() => startFetch(false)}
            disabled={!!busy || polling}
            className="rounded-btn px-3 py-1 text-caption text-text-tertiary underline-offset-2 hover:underline disabled:opacity-50"
          >
            Refresh — new paid run
          </button>
        </div>
        {/* When a paid run is sitting un-ingested, make INGEST the prominent next step (it's free). */}
        {unIngested.length > 0 && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-input bg-success-bg px-3 py-2">
            <p className="text-caption text-success-text">
              {unIngested.length} succeeded run(s) ready to ingest — free (already paid).
            </p>
            <button
              onClick={() => ingestRun(unIngested[0].id)}
              disabled={!!busy}
              className="shrink-0 rounded-btn bg-primary px-4 py-1.5 text-caption text-on-primary disabled:opacity-50"
            >
              {busy === `ingest-${unIngested[0].id}` ? 'Ingesting…' : 'Ingest now (free)'}
            </button>
          </div>
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
                    className={`shrink-0 rounded-btn px-2 py-0.5 text-caption disabled:opacity-50 ${
                      r.status === 'succeeded'
                        ? 'bg-primary text-on-primary' // un-ingested → the action to take
                        : 'border border-border-strong text-text-secondary' // already ingested → secondary re-pull
                    }`}
                  >
                    {busy === `ingest-${r.id}` ? 'Ingesting…' : r.status === 'ingested' ? 'Re-ingest' : 'Ingest'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {rows.length > 0 && visibleRows.length === 0 && (
        <p className="rounded-input bg-surface-2 px-4 py-3 text-body-sm text-text-secondary">
          No hotels match this filter{q ? ` and "${search.trim()}"` : ''}.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {visibleRows.map((r) => {
          const reviews = r.review_count ?? 0;
          const tooFewReviews = reviews < MIN_REVIEWS;
          const imgs = imageCount(r);
          const noImages = imgs === 0;
          // Mirror the server-side approve guard (12a Rule #1) so the button is disabled with a reason,
          // instead of looking tappable and failing the PATCH after the click.
          const approveBlocked = tooFewReviews;
          const approveTitle = tooFewReviews
            ? `Needs at least ${MIN_REVIEWS} reviews to approve (has ${reviews}).`
            : undefined;
          return (
          <li
            key={r.id}
            className="flex items-center justify-between gap-4 rounded-card border border-border bg-surface px-4 py-3 shadow-card"
          >
            {/* Thumbnail + image count — so the publish-blocking 0-image case is visible BEFORE publish. */}
            <div className="shrink-0">
              {r.images && r.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.images[0]}
                  alt=""
                  className="h-16 w-16 rounded-input border border-border object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-input border border-border bg-surface-2 text-caption text-text-tertiary">
                  no img
                </div>
              )}
              <p
                className={`mt-1 text-center font-mono text-caption ${
                  noImages ? 'text-text' : 'text-text-tertiary'
                }`}
              >
                {imgs} img{imgs === 1 ? '' : 's'}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-body text-text">{r.name}</p>
              <p className="font-mono text-caption text-text-tertiary">
                #{r.tripadvisor_rank ?? '—'} ·{' '}
                <span className={tooFewReviews ? 'font-medium text-text' : undefined}>{reviews} reviews</span> ·{' '}
                {r.star_rating ?? '—'}★ · {r.price_tier ?? '—'} · {r.brand ?? '—'}
              </p>
              {(tooFewReviews || noImages) && (
                <p className="mt-0.5 text-caption text-text-secondary">
                  {tooFewReviews && `Below ${MIN_REVIEWS}-review threshold — can't approve.`}
                  {tooFewReviews && noImages && ' '}
                  {noImages && "No image — won't publish (12g)."}
                </p>
              )}
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
                disabled={busy === r.id || approveBlocked}
                title={approveTitle}
                aria-disabled={approveBlocked}
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
          );
        })}
      </ul>
    </main>
  );
}
