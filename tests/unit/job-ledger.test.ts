/* Recommendation-job ledger state machine (lib/recommendations/job-ledger.ts, specs/03c).
 * Key-free: a tiny in-memory fake of the Supabase query builder exercises the lifecycle
 * (create → claim → markStage → markSucceeded/markFailed), the atomic claim guard, the reuse
 * lookup, and computeInputHash stability. */
import { computeInputHash } from '@/lib/recommendations/input-hash';
import {
  createJob,
  claimJob,
  markStage,
  markSucceeded,
  markFailed,
  loadJob,
  findReusable,
  reclaimStale,
  JOB_STATUSES,
  JOB_STAGES,
} from '@/lib/recommendations/job-ledger';

/* ---- a minimal in-memory fake of the chained Supabase client used by the ledger ---- */
interface Row {
  id: string;
  user_id: string | null;
  trip_brief_id: string | null;
  destination: string;
  input_hash: string;
  input: unknown;
  status: string;
  stage: string;
  result: unknown | null;
  error_kind: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function makeFakeClient(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let idc = seed.length;

  // A chainable query object. `from()` returns a fresh builder each call.
  function from() {
    let op: 'insert' | 'update' | 'select' = 'select';
    let payload: Record<string, unknown> = {};
    const filters: Array<{ col: keyof Row; op: 'eq' | 'neq' | 'gte'; val: unknown }> = [];
    let orderDesc = false;
    let limitN = Infinity;

    const builder: Record<string, unknown> = {
      insert(p: Record<string, unknown>) {
        op = 'insert';
        payload = p;
        return builder;
      },
      update(p: Record<string, unknown>) {
        op = 'update';
        payload = p;
        return builder;
      },
      select() {
        return builder;
      },
      eq(col: keyof Row, val: unknown) {
        filters.push({ col, op: 'eq', val });
        return builder;
      },
      neq(col: keyof Row, val: unknown) {
        filters.push({ col, op: 'neq', val });
        return builder;
      },
      gte(col: keyof Row, val: unknown) {
        filters.push({ col, op: 'gte', val });
        return builder;
      },
      order(_col: string, opts: { ascending: boolean }) {
        orderDesc = !opts.ascending;
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      match(rs: Row[]) {
        return rs.filter((r) =>
          filters.every((f) =>
            f.op === 'eq' ? r[f.col] === f.val : f.op === 'neq' ? r[f.col] !== f.val : (r[f.col] as string) >= (f.val as string),
          ),
        );
      },
      run() {
        if (op === 'insert') {
          const row: Row = {
            id: `job-${++idc}`,
            user_id: null,
            trip_brief_id: null,
            destination: '',
            input_hash: '',
            input: {},
            status: 'pending',
            stage: 'queued',
            result: null,
            error_kind: null,
            attempts: 0,
            created_at: new Date(Date.now() - idc).toISOString(),
            started_at: null,
            finished_at: null,
            ...(payload as Partial<Row>),
          };
          rows.push(row);
          return [row];
        }
        if (op === 'update') {
          const matched = (builder.match as (rs: Row[]) => Row[])(rows);
          for (const r of matched) Object.assign(r, payload);
          return matched;
        }
        let matched = (builder.match as (rs: Row[]) => Row[])(rows);
        if (orderDesc) matched = [...matched].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        if (limitN !== Infinity) matched = matched.slice(0, limitN);
        return matched;
      },
      single() {
        const r = (builder.run as () => Row[])();
        return Promise.resolve(r.length ? { data: r[0], error: null } : { data: null, error: new Error('no row') });
      },
      maybeSingle() {
        const r = (builder.run as () => Row[])();
        return Promise.resolve({ data: r[0] ?? null, error: null });
      },
      // a bare `.eq()` chain ending without single() is awaited (update path): resolve the run.
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        resolve({ data: (builder.run as () => Row[])(), error: null });
      },
    };
    return builder;
  }

  return { from, _rows: rows } as unknown as import('@supabase/supabase-js').SupabaseClient & { _rows: Row[] };
}

describe('computeInputHash', () => {
  it('is stable for the same inputs and varies with them', () => {
    const a = computeInputHash({ destination: 'Phuket', budgetTier: 'comfort', food: 'none' });
    const b = computeInputHash({ destination: 'phuket', budgetTier: 'comfort', food: 'none' }); // case-normalised
    const c = computeInputHash({ destination: 'Phuket', budgetTier: 'luxury', food: 'none' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(32);
  });
});

describe('job lifecycle', () => {
  it('create → claim → stage → succeed', async () => {
    const client = makeFakeClient();
    const job = await createJob(client, { destination: 'Phuket', inputHash: 'h1', input: { trip_brief: { destination: 'Phuket' } } });
    expect(job.status).toBe('pending');
    expect(job.stage).toBe('queued');

    const claimed = await claimJob(client, job.id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.stage).toBe('finding_hotels');

    await markStage(client, job.id, 'writing');
    await markSucceeded(client, job.id, { top_pick: { hotel_id: 'x' } });

    const final = await loadJob(client, job.id);
    expect(final?.status).toBe('succeeded');
    expect(final?.stage).toBe('done');
    expect((final?.result as { top_pick: { hotel_id: string } }).top_pick.hotel_id).toBe('x');
    expect(final?.finishedAt).toBeTruthy();
  });

  it('claim is atomic — a second claim of an already-running job returns null', async () => {
    const client = makeFakeClient();
    const job = await createJob(client, { destination: 'Bali', inputHash: 'h2', input: {} });
    const first = await claimJob(client, job.id);
    const second = await claimJob(client, job.id);
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // the conditional eq('status','pending') no longer matches
  });

  it('markFailed records a warm error kind', async () => {
    const client = makeFakeClient();
    const job = await createJob(client, { destination: 'Tokyo', inputHash: 'h3', input: {} });
    await claimJob(client, job.id);
    await markFailed(client, job.id, 'model_failed');
    const final = await loadJob(client, job.id);
    expect(final?.status).toBe('failed');
    expect(final?.errorKind).toBe('model_failed');
  });
});

describe('findReusable (no double-spend guard)', () => {
  it('returns a recent non-failed job for the same input_hash', async () => {
    const client = makeFakeClient();
    const a = await createJob(client, { destination: 'Phuket', inputHash: 'dup', input: {} });
    const found = await findReusable(client, 'dup');
    expect(found?.id).toBe(a.id);
  });

  it('ignores failed jobs', async () => {
    const client = makeFakeClient();
    const a = await createJob(client, { destination: 'Phuket', inputHash: 'dup2', input: {} });
    await claimJob(client, a.id);
    await markFailed(client, a.id, 'unknown');
    const found = await findReusable(client, 'dup2');
    expect(found).toBeNull();
  });
});

describe('reclaimStale (stuck-job recovery)', () => {
  const old = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
  const fresh = new Date().toISOString();

  it('is a no-op on a fresh running job', async () => {
    const client = makeFakeClient();
    const job = await createJob(client, { destination: 'Phuket', inputHash: 's1', input: {} });
    await claimJob(client, job.id);
    const r = await reclaimStale(client, { id: job.id, status: 'running', startedAt: fresh, attempts: 1 });
    expect(r).toBeNull();
  });

  it('flips a stale running job (under the attempts cap) back to pending', async () => {
    const client = makeFakeClient();
    const job = await createJob(client, { destination: 'Bali', inputHash: 's2', input: {} });
    await claimJob(client, job.id);
    const r = await reclaimStale(client, { id: job.id, status: 'running', startedAt: old, attempts: 1 });
    expect(r).toBe('pending');
    expect((await loadJob(client, job.id))?.status).toBe('pending');
  });

  it('fails a stale running job that has hit the attempts cap', async () => {
    const client = makeFakeClient();
    const job = await createJob(client, { destination: 'Tokyo', inputHash: 's3', input: {} });
    await claimJob(client, job.id);
    const r = await reclaimStale(client, { id: job.id, status: 'running', startedAt: old, attempts: 2 });
    expect(r).toBe('failed');
    const final = await loadJob(client, job.id);
    expect(final?.status).toBe('failed');
    expect(final?.errorKind).toBe('timeout');
  });
});

describe('constants', () => {
  it('expose the status + stage vocabularies', () => {
    expect(JOB_STATUSES).toContain('succeeded');
    expect(JOB_STAGES).toContain('writing');
  });
});
