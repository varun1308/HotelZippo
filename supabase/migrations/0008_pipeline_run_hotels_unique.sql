-- 0008_pipeline_run_hotels_unique.sql
-- Enforce the documented "one status row per hotel per run" invariant (specs/02-review-intelligence-pipeline.md
-- Stage 1 + 08a-6 TC-P20/P21), so the worker can upsert(..., { onConflict: 'run_id,hotel_id' }) to set per-hotel
-- status idempotently and a per-hotel RETRY reuses the same row — ON CONFLICT (run_id, hotel_id) needs this.

-- A unique index satisfies ON CONFLICT (run_id, hotel_id) and is idempotent (if not exists) → safe to re-run.
-- Note: fails if duplicate (run_id, hotel_id) rows already exist; on a dev DB this should be clean (do not delete data to force it).
create unique index if not exists pipeline_run_hotels_run_hotel_key on public.pipeline_run_hotels (run_id, hotel_id);
