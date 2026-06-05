/* Phase 6 Slice 4 — Review Intelligence Pipeline admin UI (/admin/review-intelligence).
 * Mocks global fetch per-URL (run vs status vs retry vs hotels) and asserts:
 *  (a) Mode A (destination dropdown + Run full destination) + Mode B controls render;
 *  (b) "Run full destination" POSTs run with scope_type='destination';
 *  (c) an active run with a failed hotel renders error_reason + Retry, and Retry POSTs retry;
 *  (d) a 409 run_already_active surfaces the message without crashing. */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewIntelligencePage from '@/app/admin/review-intelligence/page';

const HOTELS = [
  { id: 'h1', name: 'Anantara Mai Khao', destination: 'Phuket' },
  { id: 'h2', name: 'Holiday Inn Resort Karon', destination: 'Phuket' },
];

interface StatusOpts {
  active?: boolean;
  failedHotel?: boolean;
}

function statusBody({ active = false, failedHotel = false }: StatusOpts = {}) {
  return {
    active: active
      ? {
          id: 'run-1',
          scope_type: 'destination',
          scope_value: 'Phuket',
          hotels_total: 2,
          hotels_complete: 1,
          hotels_failed: failedHotel ? 1 : 0,
        }
      : null,
    hotels: active
      ? [
          { hotel_id: 'h1', status: 'complete', error_reason: null, reviews_scraped: 120 },
          failedHotel
            ? {
                hotel_id: 'h2',
                status: 'failed',
                error_reason: 'Actor timeout after 600s',
                reviews_scraped: 0,
              }
            : { hotel_id: 'h2', status: 'scraping', error_reason: null, reviews_scraped: 0 },
        ]
      : [],
    history: [
      {
        id: 'run-0',
        scope_type: 'destination',
        scope_value: 'Phuket',
        status: 'complete',
        hotels_total: 2,
        hotels_complete: 2,
        hotels_failed: 0,
        started_at: '2026-06-01T10:00:00.000Z',
        finished_at: '2026-06-01T10:30:00.000Z',
      },
    ],
    counts: { total: 10, processed: 4 },
  };
}

/** Build a fetch mock that routes by URL + method. `statusOpts` controls the status payload;
 * `runResponse` lets a test override the /run response (e.g. a 409). Returns the jest.fn. */
function mockFetch(opts: {
  statusOpts?: StatusOpts;
  runResponse?: { status: number; body: unknown };
} = {}) {
  const runResponse = opts.runResponse ?? {
    status: 201,
    body: { run_id: 'run-new', status: 'running' },
  };
  const fn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.startsWith('/api/admin/hotels')) {
      return jsonRes(200, { hotels: HOTELS });
    }
    if (url.startsWith('/api/admin/pipeline/status')) {
      return jsonRes(200, statusBody(opts.statusOpts));
    }
    if (url.startsWith('/api/admin/pipeline/run') && method === 'POST') {
      return jsonRes(runResponse.status, runResponse.body);
    }
    if (url.startsWith('/api/admin/pipeline/retry') && method === 'POST') {
      return jsonRes(200, { hotel_id: 'h2', outcome: 'complete' });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  global.fetch = fn as typeof fetch;
  return fn;
}

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Review Intelligence admin page', () => {
  it('(a) renders Mode A (destination dropdown + Run full destination) and Mode B controls', async () => {
    mockFetch();
    render(<ReviewIntelligencePage />);

    expect(screen.getByRole('heading', { name: /review intelligence pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /destination/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run full destination/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /hotel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run this hotel/i })).toBeInTheDocument();

    // counts badge from the status payload
    await waitFor(() => expect(screen.getByText(/4 \/ 10 processed/i)).toBeInTheDocument());
  });

  it('(b) "Run full destination" POSTs run with scope_type=destination', async () => {
    const fetchMock = mockFetch();
    render(<ReviewIntelligencePage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /run full destination/i }));

    await waitFor(() => {
      const runCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).startsWith('/api/admin/pipeline/run') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(runCall).toBeTruthy();
      const body = JSON.parse((runCall![1] as RequestInit).body as string);
      expect(body.scope_type).toBe('destination');
      expect(body.scope_value).toBe('Phuket');
    });
  });

  it('(c) a failed hotel shows its error_reason + Retry, and Retry POSTs to /retry', async () => {
    const fetchMock = mockFetch({ statusOpts: { active: true, failedHotel: true } });
    render(<ReviewIntelligencePage />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText(/actor timeout after 600s/i)).toBeInTheDocument());

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    await user.click(retryBtn);

    await waitFor(() => {
      const retryCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).startsWith('/api/admin/pipeline/retry') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(retryCall).toBeTruthy();
      const body = JSON.parse((retryCall![1] as RequestInit).body as string);
      expect(body.run_id).toBe('run-1');
      expect(body.hotel_id).toBe('h2');
    });

    // The failed hotel's status pill renders the "Failed" label (scope via the error_reason row).
    const failedRow = screen.getByText(/actor timeout after 600s/i).closest('li')!;
    expect(within(failedRow).getByText('Failed')).toBeInTheDocument();
  });

  it('(d) a 409 run_already_active surfaces the message without crashing', async () => {
    mockFetch({
      runResponse: {
        status: 409,
        body: {
          error: 'run_already_active',
          message: 'A pipeline run is already in progress. Wait for it to finish.',
        },
      },
    });
    render(<ReviewIntelligencePage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /run full destination/i }));

    await waitFor(() =>
      expect(screen.getByText(/already in progress/i)).toBeInTheDocument(),
    );
    // Page still rendered (no crash).
    expect(screen.getByRole('heading', { name: /review intelligence pipeline/i })).toBeInTheDocument();
  });
});
