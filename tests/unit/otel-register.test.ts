/* Dash0 OTLP auth-header mapping (lib/otel/dash0-headers.ts). Pure env transform — the part of the
 * Dash0 wiring we can verify without a live collector: DASH0_API_KEY → the OTLP Authorization: Bearer
 * header, with an operator-provided OTEL_EXPORTER_OTLP_HEADERS winning. Imported from the pure module
 * (not register.ts) so the test stays free of the server-only @vercel/otel import. */
import { applyDash0Headers } from '@/lib/otel/dash0-headers';

describe('applyDash0Headers', () => {
  it('maps DASH0_API_KEY → OTEL_EXPORTER_OTLP_HEADERS as an Authorization: Bearer header', () => {
    const env: Record<string, string | undefined> = { DASH0_API_KEY: 'dash0_tok_123' };
    const applied = applyDash0Headers(env);
    expect(applied).toBe('Authorization=Bearer dash0_tok_123');
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe('Authorization=Bearer dash0_tok_123');
  });

  it('adds the Dash0-Dataset routing header when DASH0_DATASET is set', () => {
    const env: Record<string, string | undefined> = { DASH0_API_KEY: 'dash0_tok_123', DASH0_DATASET: 'dev' };
    const applied = applyDash0Headers(env);
    expect(applied).toBe('Authorization=Bearer dash0_tok_123,Dash0-Dataset=dev');
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe('Authorization=Bearer dash0_tok_123,Dash0-Dataset=dev');
  });

  it('omits the Dash0-Dataset header when DASH0_DATASET is absent', () => {
    const env: Record<string, string | undefined> = { DASH0_API_KEY: 'dash0_tok_123' };
    applyDash0Headers(env);
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).not.toContain('Dash0-Dataset');
  });

  it('does NOT overwrite an operator-provided OTEL_EXPORTER_OTLP_HEADERS', () => {
    const env: Record<string, string | undefined> = {
      DASH0_API_KEY: 'dash0_tok_123',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer operator_value',
    };
    const applied = applyDash0Headers(env);
    expect(applied).toBeNull(); // nothing applied — theirs wins
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe('Authorization=Bearer operator_value');
  });

  it('is a no-op when DASH0_API_KEY is absent (no headers invented)', () => {
    const env: Record<string, string | undefined> = {};
    const applied = applyDash0Headers(env);
    expect(applied).toBeNull();
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
  });
});
