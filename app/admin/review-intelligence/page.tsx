/* Review Intelligence Pipeline Tool — /admin/review-intelligence (spec 02, Stage 1).
 * Internal founder tool, no auth in v1 (consistent with /admin/curation).
 * Mode A: full-destination run · Mode B: single-hotel run · live ~2s status feed
 * (active run progress + per-hotel pills, failed-hotel retry) · run history.
 * Wires to /api/admin/pipeline/{run,status,retry} (already built) and reuses
 * /api/admin/hotels?destination= for the Mode-B hotel picker.
 * Styled with the locked design tokens (specs/05). Amber/red are RESERVED for hard
 * flags; the only sanctioned exception here is the failed-status pill (a genuine alert),
 * which uses the flag-red token. All other neutral states use text/border tokens. */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, AlertCircle } from 'lucide-react';

const DESTINATIONS = ['Phuket', 'Hong Kong', 'Singapore', 'Maldives', 'Bali'] as const;
type Destination = (typeof DESTINATIONS)[number];

type HotelStatus =
  | 'pending'
  | 'scraping'
  | 'processing'
  | 'synthesising'
  | 'complete'
  | 'failed';

interface HotelOption {
  id: string;
  name: string;
  destination: string;
}

interface ActiveRun {
  id: string;
  scope_type: 'destination' | 'hotel';
  scope_value: string;
  hotels_total: number;
  hotels_complete: number;
  hotels_failed: number;
}

interface HotelFeedRow {
  hotel_id: string;
  status: HotelStatus;
  error_reason: string | null;
  reviews_scraped: number | null;
}

interface HistoryRow {
  id: string;
  scope_type: 'destination' | 'hotel';
  scope_value: string;
  status: string;
  hotels_total: number;
  hotels_complete: number;
  hotels_failed: number;
  started_at: string | null;
  finished_at: string | null;
}

interface StatusPayload {
  active: ActiveRun | null;
  hotels: HotelFeedRow[];
  history: HistoryRow[];
  counts?: { total: number; processed: number };
}

const STATUS_LABEL: Record<HotelStatus, string> = {
  pending: 'Pending',
  scraping: 'Scraping',
  processing: 'Processing',
  synthesising: 'Synthesising',
  complete: 'Complete',
  failed: 'Failed',
};

/* Neutral pills use surface/text tokens; the in-flight stages get a quiet primary tint;
 * complete uses the success token; ONLY failed uses the sanctioned flag-red alert token. */
function statusPillClass(status: HotelStatus): string {
  switch (status) {
    case 'complete':
      return 'bg-success-bg text-success-text';
    case 'failed':
      return 'bg-flag-red-bg text-flag-red-text';
    case 'scraping':
    case 'processing':
    case 'synthesising':
      return 'bg-primary-50 text-primary-700';
    default:
      return 'bg-surface-2 text-text-secondary';
  }
}

function StatusPill({ status }: { status: HotelStatus }) {
  return (
    <span className={`rounded-pill px-3 py-1 text-caption ${statusPillClass(status)}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function ReviewIntelligencePage() {
  const [destination, setDestination] = useState<Destination>('Phuket');
  const [hotels, setHotels] = useState<HotelOption[]>([]);
  const [selectedHotel, setSelectedHotel] = useState<string>('');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [blocked, setBlocked] = useState(false);

  // Keep the polled destination current without re-arming the interval each render.
  const destRef = useRef<Destination>(destination);
  destRef.current = destination;

  const loadStatus = useCallback(async () => {
    const res = await fetch(
      `/api/admin/pipeline/status?destination=${encodeURIComponent(destRef.current)}`,
    );
    if (!res.ok) return;
    const json = (await res.json()) as StatusPayload;
    setStatus(json);
  }, []);

  const loadHotels = useCallback(async (dest: Destination) => {
    const res = await fetch(`/api/admin/hotels?destination=${encodeURIComponent(dest)}`);
    if (!res.ok) return;
    const json = (await res.json()) as { hotels?: HotelOption[] };
    setHotels(json.hotels ?? []);
    setSelectedHotel((prev) => (json.hotels?.some((h) => h.id === prev) ? prev : ''));
  }, []);

  // Reload hotels + status when the destination changes.
  useEffect(() => {
    void loadHotels(destination);
    void loadStatus();
  }, [destination, loadHotels, loadStatus]);

  // Live feed: poll the status endpoint ~every 2s while mounted; clear on unmount.
  useEffect(() => {
    const id = setInterval(() => {
      void loadStatus();
    }, 2000);
    return () => clearInterval(id);
  }, [loadStatus]);

  const runActive = !!status?.active;

  async function startRun(scopeType: 'destination' | 'hotel', scopeValue: string) {
    setBusy(scopeType);
    setNotice('');
    setBlocked(false);
    const res = await fetch('/api/admin/pipeline/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope_type: scopeType, scope_value: scopeValue }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409 && json.error === 'run_already_active') {
      // Surface the message; do not crash. Re-poll so the feed shows the live run.
      setBlocked(true);
      setNotice(json.message ?? 'A pipeline run is already in progress.');
    } else if (res.ok) {
      setNotice(`Run started (${scopeType}): ${json.run_id}.`);
    } else {
      setNotice(`Error: ${json.message ?? json.error ?? res.status}`);
    }
    await loadStatus();
    setBusy(null);
  }

  async function retryHotel(runId: string, hotelId: string) {
    setBusy(`retry:${hotelId}`);
    setNotice('');
    const res = await fetch('/api/admin/pipeline/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: runId, hotel_id: hotelId }),
    });
    const json = await res.json().catch(() => ({}));
    setNotice(
      res.ok
        ? `Retried ${hotelId}: ${json.outcome ?? 'done'}.`
        : `Retry failed: ${json.reason ?? json.error ?? res.status}`,
    );
    await loadStatus();
    setBusy(null);
  }

  const hotelName = useCallback(
    (id: string) => hotels.find((h) => h.id === id)?.name ?? id,
    [hotels],
  );

  const counts = status?.counts;
  const active = status?.active ?? null;
  const feed = status?.hotels ?? [];
  const history = status?.history ?? [];

  // The selected hotel's last-processed state (Mode B), if the active run touched it.
  const selectedFeed = selectedHotel ? feed.find((h) => h.hotel_id === selectedHotel) : undefined;

  return (
    <main className="mx-auto max-w-card px-6 py-10">
      <p className="font-mono text-label uppercase text-primary-600">
        Admin · Review Intelligence
      </p>
      <h1 className="mb-2 font-serif text-h1 text-text">Review Intelligence Pipeline</h1>
      <p className="mb-8 text-body-sm text-text-secondary">
        Internal founder tool — scrape, tag &amp; synthesise hotel reviews. Runs are processed
        sequentially by the worker; exactly one run is active at a time.
      </p>

      {notice && (
        <p className="mb-6 flex items-start gap-2 rounded-input bg-surface-2 px-4 py-3 text-body-sm text-text-secondary">
          {blocked && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span>{notice}</span>
        </p>
      )}

      {/* ---------- Mode A — Full destination run ---------- */}
      <section className="mb-6 rounded-card border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-serif text-h3 text-text">Mode A · Full destination run</h2>
        <p className="mb-4 text-caption text-text-tertiary">
          Process every hotel in a destination, in sequence.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-body-sm text-text-secondary" htmlFor="dest-select">
            Destination
          </label>
          <select
            id="dest-select"
            aria-label="Destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value as Destination)}
            className="rounded-input border border-border-strong bg-surface px-3 py-2 text-body-sm text-text"
          >
            {DESTINATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          {counts && (
            <span className="rounded-pill bg-surface-2 px-3 py-1 font-mono text-caption text-text-secondary">
              {counts.processed} / {counts.total} processed
            </span>
          )}

          <button
            onClick={() => startRun('destination', destination)}
            disabled={!!busy || runActive}
            className="ml-auto flex items-center gap-2 rounded-btn bg-primary px-4 py-2 text-body-sm text-on-primary disabled:opacity-50"
          >
            <Play className="h-4 w-4" aria-hidden />
            {busy === 'destination' ? 'Starting…' : 'Run full destination'}
          </button>
        </div>

        {runActive && (
          <p className="mt-3 text-caption text-text-tertiary">
            A run is already active — wait for it to finish before starting another.
          </p>
        )}
      </section>

      {/* ---------- Mode B — Single hotel run ---------- */}
      <section className="mb-6 rounded-card border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-serif text-h3 text-text">Mode B · Single hotel run</h2>
        <p className="mb-4 text-caption text-text-tertiary">
          Re-run one changed hotel or recover a failure.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-body-sm text-text-secondary" htmlFor="hotel-select">
            Hotel
          </label>
          <select
            id="hotel-select"
            aria-label="Hotel"
            value={selectedHotel}
            onChange={(e) => setSelectedHotel(e.target.value)}
            className="min-w-[14rem] rounded-input border border-border-strong bg-surface px-3 py-2 text-body-sm text-text"
          >
            <option value="">Select a hotel…</option>
            {hotels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>

          {selectedFeed && (
            <span className="flex items-center gap-2 text-caption text-text-tertiary">
              Last state: <StatusPill status={selectedFeed.status} />
            </span>
          )}

          <button
            onClick={() => startRun('hotel', selectedHotel)}
            disabled={!!busy || runActive || !selectedHotel}
            className="ml-auto flex items-center gap-2 rounded-btn border border-border-strong px-4 py-2 text-body-sm text-text disabled:opacity-50"
          >
            <Play className="h-4 w-4" aria-hidden />
            {busy === 'hotel' ? 'Starting…' : 'Run this hotel'}
          </button>
        </div>
      </section>

      {/* ---------- Live status feed ---------- */}
      <section className="mb-6 rounded-card border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-3 font-serif text-h3 text-text">Live status</h2>

        {active ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="rounded-pill bg-primary-50 px-3 py-1 text-caption text-primary-700">
                Active · {active.scope_type === 'destination' ? active.scope_value : 'single hotel'}
              </span>
              <span className="font-mono text-caption text-text-secondary">
                {active.hotels_complete} / {active.hotels_total} complete
              </span>
              {active.hotels_failed > 0 && (
                <span className="font-mono text-caption text-text-secondary">
                  {active.hotels_failed} failed
                </span>
              )}
            </div>

            <ul className="flex flex-col gap-2">
              {feed.map((h) => (
                <li
                  key={h.hotel_id}
                  className="flex flex-col gap-2 rounded-input border border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body-sm text-text">{hotelName(h.hotel_id)}</p>
                    {h.status === 'failed' && h.error_reason ? (
                      <p className="text-caption text-flag-red-text">{h.error_reason}</p>
                    ) : (
                      <p className="font-mono text-caption text-text-tertiary">
                        {h.reviews_scraped ?? 0} reviews
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={h.status} />
                    {h.status === 'failed' && (
                      <button
                        onClick={() => retryHotel(active.id, h.hotel_id)}
                        disabled={busy === `retry:${h.hotel_id}`}
                        className="flex items-center gap-1 rounded-btn border border-border-strong px-3 py-1 text-caption text-text-secondary disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        {busy === `retry:${h.hotel_id}` ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-body-sm text-text-secondary">
            No active run. Start one above to see the live feed.
          </p>
        )}
      </section>

      {/* ---------- Run history ---------- */}
      <section className="rounded-card border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-3 font-serif text-h3 text-text">Run history</h2>
        {history.length === 0 ? (
          <p className="text-body-sm text-text-secondary">No past runs yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 rounded-input border border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-body-sm text-text">
                    {r.scope_type === 'destination' ? r.scope_value : 'Single hotel'}
                  </p>
                  <p className="font-mono text-caption text-text-tertiary">
                    {fmtTime(r.started_at)} → {fmtTime(r.finished_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-caption text-text-secondary">
                    {r.hotels_complete}/{r.hotels_total} done
                    {r.hotels_failed > 0 ? ` · ${r.hotels_failed} failed` : ''}
                  </span>
                  <span
                    className={`rounded-pill px-3 py-1 text-caption ${
                      r.status === 'complete'
                        ? 'bg-success-bg text-success-text'
                        : r.status === 'failed'
                          ? 'bg-flag-red-bg text-flag-red-text'
                          : 'bg-surface-2 text-text-secondary'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
