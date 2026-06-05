/* Pure system-prompt assembly (08b-1 context injection). No imports → safe to unit-test
 * in any environment (the agent module pulls in the AI SDK, which needs web-stream
 * globals). The server injects <family_profile> and <session_snapshot> before session
 * init; both are ALWAYS present, and EMPTY blocks signal a brand-new user. */
export function buildSystem(
  base: string,
  ctx: { familyProfile?: unknown; sessionSnapshot?: string | null },
): string {
  const fp = ctx.familyProfile ? JSON.stringify(ctx.familyProfile, null, 2) : '';
  const ss = ctx.sessionSnapshot ?? '';
  return `${base}\n\n<family_profile>\n${fp}\n</family_profile>\n\n<session_snapshot>\n${ss}\n</session_snapshot>`;
}
