export type KeepAwakeMode = 'on' | 'agent' | 'off'

export const KEEP_AWAKE_MODES: KeepAwakeMode[] = ['on', 'agent', 'off']
export const KEEP_AWAKE_MODE_COPY: Record<KeepAwakeMode, { label: string; detail: string }> = {
  on: { label: 'On', detail: 'Keep the display awake continuously while Agent Halo is open' },
  agent: { label: 'Agent', detail: 'Keep the display awake while an agent is working' },
  off: { label: 'Off', detail: 'Allow normal display idle behavior' },
}
const STORAGE_KEY = 'agent-halo.keep-awake-mode'
const LEGACY_STORAGE_KEY = 'agent-halo.keep-awake-while-working'

export const shouldKeepDisplayAwake = (mode: KeepAwakeMode, hasWorkingActivity: boolean): boolean =>
  mode === 'on' || (mode === 'agent' && hasWorkingActivity)

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
