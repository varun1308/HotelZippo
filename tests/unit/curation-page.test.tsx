/* Admin Curation UI (/admin/curation) — the ledger-driven flow (12h PR 2/3) that previously had no
 * React-level test. Mocks global fetch per-URL and asserts:
 *  (a) the page renders (tabs + the Start Fetch / Publish / Seed actions + Runs panel);
 *  (b) Start Fetch POSTs run/start and begins polling, the Runs panel reflects run/status, and a
 *      succeeded run offers Ingest;
 *  (c) Ingest POSTs run/ingest and reloads candidates;
 *  (d) the reuse guard: run/start → { reusable } renders the warning + its 3 buttons, and
 *      "Re-pull free" POSTs run/ingest for that run. */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CurationPage from '@/app/admin/curation/page';

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

interface MockOpts {
  /** sequence of run/status payloads returned on successive polls (last one repeats). */
  statusSequence?: Array<{ status: string; itemCount?: number | null }>;
  /** override the run/start response (e.g. the reuse-guard branch). */
  startResponse?: { status: number; body: unknown };
  /** candidate rows returned by /api/admin/hotels. */
  hotels?: unknown[];
  /** runs returned by /api/admin/curation/runs. */
  runs?: unknown[];
}

function mockFetch(opts: MockOpts = {}) {
  const statusSeq = opts.statusSequence ?? [{ status: 'running' }, { status: 'succeeded', itemCount: 12 }];
  let statusIdx = 0;
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];

  const fn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });

    if (url.startsWith('/api/admin/hotels')) return jsonRes(200, { hotels: opts.hotels ?? [] });
    if (url.startsWith('/api/admin/curation/runs')) return jsonRes(200, { runs: opts.runs ?? [] });
    if (url.startsWith('/api/admin/curation/run/start') && method === 'POST') {
      return jsonRes(opts.startResponse?.status ?? 200, opts.startResponse?.body ?? { run: { id: 'run-A', status: 'running' } });
    }
    if (url.startsWith('/api/admin/curation/run/status')) {
      const s = statusSeq[Math.min(statusIdx, statusSeq.length - 1)];
      statusIdx += 1;
      return jsonRes(200, { run: { id: 'run-A', ingestedAt: null, ...s } });
    }
    if (url.startsWith('/api/admin/curation/run/ingest') && method === 'POST') {
      return jsonRes(200, { ingested: 3, items: 12 });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  global.fetch = fn as typeof fetch;
  return { fn, calls };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Admin Curation page', () => {
  it('(a) renders tabs, actions, and the Runs panel', async () => {
    mockFetch();
    render(<CurationPage />);
    expect(screen.getByRole('heading', { name: /hotel curation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start fetch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish to hotels/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /seed demo intelligence/i })).toBeInTheDocument();
    // Runs panel header
    await waitFor(() => expect(screen.getByText(/apify runs ·/i)).toBeInTheDocument());
  });

  it('(b+c) Start Fetch → run/start, polls run/status to succeeded, then Ingest → run/ingest', async () => {
    jest.useFakeTimers();
    const { calls } = mockFetch({
      statusSequence: [{ status: 'running' }, { status: 'succeeded', itemCount: 12 }],
      // After the run succeeds, the runs list shows a succeeded, un-ingested run with an Ingest button.
      runs: [{ id: 'run-A', status: 'succeeded', itemCount: 12, ingestedAt: null, costEstimate: 0.4, error: null, startedAt: '2026-06-16T10:00:00Z' }],
    });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<CurationPage />);

    await user.click(screen.getByRole('button', { name: /start fetch/i }));
    // run/start was POSTed
    await waitFor(() => expect(calls.some((c) => c.url.includes('/run/start') && c.method === 'POST')).toBe(true));

    // Advance through the 4s poll loop → run/status polled.
    await jest.advanceTimersByTimeAsync(4500);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/run/status'))).toBe(true));

    // A succeeded run in the Runs panel offers Ingest; click it.
    const ingestBtn = await screen.findByRole('button', { name: /^ingest$/i });
    await user.click(ingestBtn);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/run/ingest') && c.method === 'POST')).toBe(true));
  });

  it('(d) reuse guard: run/start → { reusable } renders the warning + Re-pull free posts ingest', async () => {
    const { calls } = mockFetch({
      startResponse: {
        status: 200,
        body: { reusable: { id: 'run-old', status: 'succeeded', itemCount: 10, startedAt: '2026-06-13T10:00:00Z', costEstimate: 0.5 } },
      },
    });
    const user = userEvent.setup();
    render(<CurationPage />);

    await user.click(screen.getByRole('button', { name: /start fetch/i }));

    // The reuse-guard warning + its three choices render.
    expect(await screen.findByRole('button', { name: /re-pull free/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /force fresh fetch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    // "Re-pull free" ingests the existing run (no new paid fetch).
    await user.click(screen.getByRole('button', { name: /re-pull free/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/run/ingest') && c.method === 'POST' && c.body?.runId === 'run-old')).toBe(true),
    );
  });

  it('(e) Approve is disabled with a reason for a sub-100-review hotel; enabled for a strong one', async () => {
    mockFetch({
      hotels: [
        { id: 'h-weak', name: 'Tiny Inn', destination: 'Phuket', review_count: 40, images: ['http://img/1.jpg'], status: 'pending' },
        { id: 'h-strong', name: 'Grand Resort', destination: 'Phuket', review_count: 820, images: ['http://img/2.jpg'], status: 'pending' },
      ],
    });
    render(<CurationPage />);

    const weakCard = (await screen.findByText('Tiny Inn')).closest('li') as HTMLElement;
    const strongCard = screen.getByText('Grand Resort').closest('li') as HTMLElement;

    // The weak hotel's Approve is disabled and carries the reason; the inline hint is shown.
    const weakApprove = within(weakCard).getByRole('button', { name: /approve/i });
    expect(weakApprove).toBeDisabled();
    expect(weakApprove).toHaveAttribute('title', expect.stringContaining('100'));
    expect(within(weakCard).getByText(/below 100-review threshold/i)).toBeInTheDocument();

    // The strong hotel's Approve is enabled.
    expect(within(strongCard).getByRole('button', { name: /approve/i })).toBeEnabled();
  });

  it('(f) a 0-image card shows the no-image placeholder + count + a won\'t-publish hint', async () => {
    mockFetch({
      hotels: [
        { id: 'h-noimg', name: 'Imageless Hotel', destination: 'Phuket', review_count: 500, images: [], status: 'pending' },
      ],
    });
    render(<CurationPage />);
    const card = (await screen.findByText('Imageless Hotel')).closest('li') as HTMLElement;
    expect(within(card).getByText(/no img/i)).toBeInTheDocument();
    expect(within(card).getByText(/0 imgs/i)).toBeInTheDocument();
    expect(within(card).getByText(/won't publish/i)).toBeInTheDocument();
  });

  it('(g) publish surfaces WHICH hotels were skipped and why (not just a count)', async () => {
    const fn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/api/admin/hotels')) return jsonRes(200, { hotels: [] });
      if (url.startsWith('/api/admin/curation/runs')) return jsonRes(200, { runs: [] });
      if (url.startsWith('/api/admin/publish-hotels') && method === 'POST') {
        return jsonRes(200, { published: 2, skipped: [{ name: 'No Pic Hotel', reasons: ['Needs at least one image (see 12g).'] }] });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fn as typeof fetch;

    const user = userEvent.setup();
    render(<CurationPage />);
    await user.click(screen.getByRole('button', { name: /publish to hotels/i }));

    // The notice names the skipped hotel + its reason, not just "skipped 1".
    await waitFor(() => expect(screen.getByText(/published 2 to hotels/i)).toBeInTheDocument());
    expect(screen.getByText(/No Pic Hotel/)).toBeInTheDocument();
    expect(screen.getByText(/Needs at least one image/)).toBeInTheDocument();
  });

  it('(d2) reuse guard: Force fresh fetch POSTs run/start with force:true', async () => {
    // First call → reusable; once forced, return a normal run.
    let started = 0;
    const fn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      if (url.startsWith('/api/admin/hotels')) return jsonRes(200, { hotels: [] });
      if (url.startsWith('/api/admin/curation/runs')) return jsonRes(200, { runs: [] });
      if (url.startsWith('/api/admin/curation/run/start') && method === 'POST') {
        started += 1;
        if (!body?.force) return jsonRes(200, { reusable: { id: 'run-old', status: 'succeeded', startedAt: '2026-06-13T10:00:00Z', itemCount: 1 } });
        return jsonRes(200, { run: { id: 'run-fresh', status: 'running' } });
      }
      if (url.startsWith('/api/admin/curation/run/status')) return jsonRes(200, { run: { id: 'run-fresh', status: 'running', ingestedAt: null } });
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fn as typeof fetch;

    const user = userEvent.setup();
    render(<CurationPage />);
    await user.click(screen.getByRole('button', { name: /start fetch/i }));
    await user.click(await screen.findByRole('button', { name: /force fresh fetch/i }));

    await waitFor(() => expect(started).toBe(2));
    // The forced call carried force:true.
    const forcedCall = fn.mock.calls.find(
      ([u, i]) => String(u).includes('/run/start') && i?.body && JSON.parse(i.body as string).force === true,
    );
    expect(forcedCall).toBeTruthy();
  });
});
