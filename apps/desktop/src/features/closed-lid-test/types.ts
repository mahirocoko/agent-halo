export const CLOSED_LID_TEST_PHASES = ['ready', 'starting', 'active', 'restoring', 'unavailable'] as const

export type ClosedLidTestPhase = (typeof CLOSED_LID_TEST_PHASES)[number]

/** Checks whether an unknown native response is a valid closed-lid test phase. */
export const isClosedLidTestPhase = (value: unknown): value is ClosedLidTestPhase =>
  typeof value === 'string' && (CLOSED_LID_TEST_PHASES as readonly string[]).includes(value)

/** Returns true for nonterminal phases that require serialized status polling. */
export const isClosedLidTestTransientPhase = (phase: ClosedLidTestPhase | null): boolean =>
  phase === 'starting' || phase === 'active' || phase === 'restoring'
