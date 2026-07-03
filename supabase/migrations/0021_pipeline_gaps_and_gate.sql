-- 0021_pipeline_gaps_and_gate.sql
-- Persist two pipeline outcomes that were previously computed and dropped (review findings
-- M20 + M22; spec 02 Stage 2 TC-P3 "record the gap" + Stage 5 confidence gate TC-P12).
--
-- pipeline_run_hotels:
--   * scrape_gaps  — jsonb array of { source, error } for sources that FAILED while the hotel
--     still completed from the other source (partial scrape). Null/absent = no gap.
--   * review_queue — true when the synthesis confidence gate returned `medium` (publish +
--     flag for the human review queue). Surfaced by /api/admin/pipeline/status.
--
-- hotel_intelligence:
--   * confidence — the gate's overall input ('high' | 'medium' | 'low') so a published record's
--     gate outcome is inspectable after the run (low_confidence alone can't distinguish
--     high from medium). Nullable: seed-script rows predate the gate.

alter table public.pipeline_run_hotels
  add column if not exists scrape_gaps jsonb,
  add column if not exists review_queue boolean not null default false;

alter table public.hotel_intelligence
  add column if not exists confidence text
    check (confidence is null or confidence in ('high', 'medium', 'low'));
