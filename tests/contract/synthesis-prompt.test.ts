/* Contract test for the Review Intelligence Synthesis prompt artifact (spec 02,
 * Notion 08a-1, Phase 6 Slice 1).
 *
 * Validates STRUCTURE/CONTRACT, never live-model content (per spec 15). We assert that
 * the on-disk prompt encodes every load-bearing invariant the synthesis step depends on,
 * so drift in the .md file is caught here rather than at runtime. Mirrors the
 * session-snapshot contract pattern: read the artifact from disk, assert resilient
 * substring/regex evidence for each invariant. No key, no DB, no model call. */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PROMPT_PATH = path.join(
  process.cwd(),
  'prompts/review-intelligence-agent/synthesis.md',
);

describe('synthesis prompt artifact (contract)', () => {
  let prompt: string;
  beforeAll(async () => {
    prompt = await fs.readFile(PROMPT_PATH, 'utf8');
  });

  it('exists and is non-empty', () => {
    expect(prompt.trim().length).toBeGreaterThan(0);
  });

  it('pins the spec and the server-side model', () => {
    expect(prompt).toMatch(/specs\/02-review-intelligence-pipeline\.md/);
    expect(prompt).toMatch(/claude-sonnet-4-20250514/);
  });

  it('encodes the valid-JSON-only rule (no prose, no markdown fences)', () => {
    expect(prompt).toMatch(/valid JSON only/i);
    expect(prompt).toMatch(/no prose/i);
    expect(prompt).toMatch(/no markdown fences/i);
    expect(prompt).toMatch(/Output the JSON object and nothing else/i);
  });

  it('encodes the hard-flag-never-buried primary obligation', () => {
    expect(prompt).toMatch(/Hard flags must never be buried/i);
    expect(prompt).toMatch(/A single credible mention is enough/i);
    expect(prompt).toMatch(/Positive reviews do not suppress a hard flag/i);
    expect(prompt).toMatch(/most important rule/i);
  });

  it('encodes the structural-vs-service distinction', () => {
    // structural issues ARE hard flags
    expect(prompt).toMatch(/Active refurbishment/i);
    expect(prompt).toMatch(/construction noise/i);
    // service complaints are NOT hard flags
    expect(prompt).toMatch(/Not hard flags/i);
    expect(prompt).toMatch(/slow service/i);
    expect(prompt).toMatch(/rude staff/i);
    // food quality goes to food_summary only
    expect(prompt).toMatch(/food_summary only/i);
  });

  it('encodes the severity rules (severe vs moderate)', () => {
    expect(prompt).toMatch(/`severe`\s+—.*3\+/is);
    expect(prompt).toMatch(/habitability/i);
    expect(prompt).toMatch(/`moderate`\s+—.*1[–-]2/is);
    expect(prompt).toMatch(/partial\/temporary/i);
    expect(prompt).toMatch(/One hard flag per distinct issue/i);
  });

  it('encodes the overall confidence gate thresholds (high/medium/low)', () => {
    expect(prompt).toMatch(/`high`\s+—.*strong.*at least 3 of 4/is);
    expect(prompt).toMatch(/`medium`\s+—.*strong.*thin.*at least 2 of 4/is);
    expect(prompt).toMatch(/`low`\s+—.*none.*3 or more.*total reviews < 10/is);
  });

  it('encodes the family signal tiers (10+/3-9/0-2)', () => {
    expect(prompt).toMatch(/`strong`\s+—\s+10 or more/i);
    expect(prompt).toMatch(/`thin`\s+—\s+3 to 9/i);
    expect(prompt).toMatch(/`none`\s+—\s+0 to 2/i);
  });

  it('encodes the indian_food_signal exact no-reviews string and is_indian-only rule', () => {
    expect(prompt).toMatch(/is_indian=true/);
    expect(prompt).toMatch(
      /No reviews from Indian guests found for this hotel\./,
    );
    expect(prompt).toMatch(/Do not infer from general reviews/i);
  });

  it('encodes the low-review-count treat-with-caution string', () => {
    expect(prompt).toMatch(/total reviews < 10/i);
    expect(prompt).toMatch(
      /Based on limited reviews \(\{n\} total\) — treat with caution\./,
    );
  });

  it('encodes the conflicting-signals proportion rule (rounded to 5%)', () => {
    expect(prompt).toMatch(/express the split as a proportion/i);
    expect(prompt).toMatch(/Round to the nearest 5%/i);
  });

  it('encodes the supporting-phrases verbatim max-3 rule', () => {
    expect(prompt).toMatch(/verbatim/i);
    expect(prompt).toMatch(/Maximum 3 phrases per category/i);
  });

  it('encodes the never-average family+general rule', () => {
    expect(prompt).toMatch(/Never average family and general signals together/i);
  });

  it('encodes the input review line format', () => {
    expect(prompt).toMatch(/\[YYYY-MM-DD\] \[rating\/5\] \{review_text\}/);
    expect(prompt).toMatch(/FAMILY REVIEWS/);
    expect(prompt).toMatch(/INDIAN GUEST REVIEWS/);
    expect(prompt).toMatch(/GENERAL REVIEWS/);
  });

  it('declares hard_flags must be [] when none and never fabricated', () => {
    expect(prompt).toMatch(/empty array `\[\]` if no structural issues/i);
    expect(prompt).toMatch(/Never fabricate flags/i);
  });

  it('contains every output schema key', () => {
    const keys: string[] = [
      '"confidence"',
      '"rooms_summary"',
      '"facilities_summary"',
      '"food_summary"',
      '"location_summary"',
      '"hard_flags"',
      '"conflicting_signals"',
      '"family_signal_strength"',
      '"supporting_phrases"',
      '"indian_food_signal"',
      '"review_count_family"',
      '"review_count_total"',
    ];
    for (const key of keys) {
      expect(prompt).toContain(key);
    }
  });

  it('encodes the hard_flags item shape (category enum + severity + evidence count)', () => {
    expect(prompt).toMatch(/"category"/);
    expect(prompt).toMatch(/"severity": "moderate \| severe"/);
    expect(prompt).toMatch(/"review_evidence_count"/);
  });

  it('encodes the decision rules summary as an ordered procedure ending in JSON output', () => {
    expect(prompt).toMatch(/DECISION RULES SUMMARY/i);
    expect(prompt).toMatch(/Scan all reviews for hard flags first/i);
    expect(prompt).toMatch(/Output JSON — nothing else/i);
  });
});
