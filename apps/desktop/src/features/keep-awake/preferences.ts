export type KeepAwakeMode = 'on' | 'agent' | 'off'

export const KEEP_AWAKE_MODES: KeepAwakeMode[] = ['on', 'agent', 'off']
export const KEEP_AWAKE_MODE_COPY: Record<KeepAwakeMode, { label: string; detail: string }> = {
  on: { label: 'On', detail: 'Keep the display awake continuously while Agent Halo is open' },
  agent: { label: 'Agent', detail: 'Keep the display awake while an agent is working' },
  off: { label: 'Off', detail: 'Allow normal display idle behavior' },
}
export const SYSTEM_KEEP_AWAKE_MODE_COPY: typeof KEEP_AWAKE_MODE_COPY = {
  on: { label: 'On', detail: 'Prevent idle system sleep while Agent Halo is open; the display may sleep' },
  agent: { label: 'Agent', detail: 'Prevent idle system sleep while an agent is working; the display may sleep' },
  off: { label: 'Off', detail: 'Allow normal system idle sleep' },
}
const SYSTEM_STORAGE_KEY = 'agent-halo.system-keep-awake-mode'
const STORAGE_KEY = 'agent-halo.keep-awake-mode'
const LEGACY_STORAGE_KEY = 'agent-halo.keep-awake-while-working'

export const shouldKeepDisplayAwake = (mode: KeepAwakeMode, hasWorkingActivity: boolean): boolean =>
  mode === 'on' || (mode === 'agent' && hasWorkingActivity)

export const shouldKeepSystemAwake = shouldKeepDisplayAwake

export const readSystemKeepAwakeMode = (): KeepAwakeMode => {
  try {
    const value = window.localStorage.getItem(SYSTEM_STORAGE_KEY)
    if (value === null) return 'agent'
    return KEEP_AWAKE_MODES.includes(value as KeepAwakeMode) ? (value as KeepAwakeMode) : 'off'
  } catch {
    return 'off'
  }
}

export const writeSystemKeepAwakeMode = (mode: KeepAwakeMode): void => {
  try {
    window.localStorage.setItem(SYSTEM_STORAGE_KEY, mode)
  } catch {
    /* current runtime still owns state */
  }
}

export const readKeepAwakeMode = (): KeepAwakeMode => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (value !== null) return KEEP_AWAKE_MODES.includes(value as KeepAwakeMode) ? (value as KeepAwakeMode) : 'off'
    const mode = window.localStorage.getItem(LEGACY_STORAGE_KEY) === 'true' ? 'agent' : 'off'
    writeKeepAwakeMode(mode)
    return mode
  } catch {
    return 'off'
  }
}

export const writeKeepAwakeMode = (mode: KeepAwakeMode): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* current runtime still owns state */
  }
}
