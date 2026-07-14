export const STALE_AFTER_MS = 30_000;
export const TRANSITION_STALE_AFTER_MS = 2 * 60_000;
export const LLM_STALE_AFTER_MS = 10 * 60_000;
export const TOOL_STALE_AFTER_MS = 30 * 60_000;
export const COMPACT_STALE_AFTER_MS = 10 * 60_000;
export const DONE_SIGNAL_MS = 8_000;

export const MAX_RECENT_EVENTS = 80;
export const MAX_SESSION_EVENTS_PER_SESSION = 32;

export const DISMISSED_SESSIONS_STORAGE_KEY = "agent-halo.dismissed-sessions";
export const DELETED_SESSIONS_STORAGE_KEY = "agent-halo.deleted-sessions";
export const SESSION_EVENTS_STORAGE_KEY = "agent-halo.session-events";
