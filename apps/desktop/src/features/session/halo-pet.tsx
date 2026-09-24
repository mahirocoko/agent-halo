import type { CSSProperties } from 'react'
import {
  DEFAULT_HALO_BOT_LOADOUT,
  getHaloBotLoadout,
  getHaloBotParts,
  HALO_BOT_LAYER_ORDER,
  type HaloBotLoadout,
  type HaloBotPartCategory,
} from './halo-bot'
import {
  DEFAULT_HALO_PET_MOTION_MAPPING,
  type HaloPetMotionMapping,
  type HaloPetSemanticState,
  resolveHaloPetMotion,
} from './pet-motion'
import type { ActivityKind, ISessionSummary } from './types'

export const HALO_PET_ROSTER = ['halo-bot', 'haloform'] as const
export type HaloPetName = (typeof HALO_PET_ROSTER)[number]
export const DEFAULT_HALO_PET: HaloPetName = 'halo-bot'
export type HaloPetSignal =
  | 'none'
  | 'thinking-model'
  | 'shell-tool-skill'
  | 'editing'
  | 'planning-goal'
  | 'delegating'
  | 'visual'
  | 'memory'
  | 'attention-asking'
  | 'done'
  | 'error'

const SIGNAL_BY_ACTIVITY: Record<ActivityKind, HaloPetSignal> = {
  session: 'none',
  bridge: 'none',
  thinking: 'thinking-model',
  model: 'thinking-model',
  planning: 'planning-goal',
  goal: 'planning-goal',
  tool: 'shell-tool-skill',
  shell: 'shell-tool-skill',
  skill: 'shell-tool-skill',
  editing: 'editing',
  delegating: 'delegating',
  visual: 'visual',
  memory: 'memory',
  compact: 'memory',
  asking: 'attention-asking',
  attention: 'attention-asking',
  done: 'done',
  error: 'error',
}

export const isHaloPetName = (value: unknown): value is HaloPetName =>
  typeof value === 'string' && (HALO_PET_ROSTER as readonly string[]).includes(value)

export const getHaloPetName = (value?: string | null): HaloPetName => (isHaloPetName(value) ? value : DEFAULT_HALO_PET)

export const getHaloPetSemanticState = (
  status?: ISessionSummary['status'],
  kind?: ActivityKind,
): HaloPetSemanticState => {
  if (status === 'error' || kind === 'error') return 'error'
  if (status === 'attention' || kind === 'attention' || kind === 'asking') return 'attention'
  if (status === 'done' || kind === 'done') return 'done'
  return status === 'working' ? 'working' : 'idle'
}

export const getHaloPetSignal = (status?: ISessionSummary['status'], kind: ActivityKind = 'session'): HaloPetSignal => {
  if (status === 'error') return 'error'
  if (status === 'attention') return 'attention-asking'
  if (status === 'done') return 'done'
  if (status === 'idle' || status === 'inactive') return 'none'
  return SIGNAL_BY_ACTIVITY[kind]
}

const getStyle = (
  pet: HaloPetName,
  motion: HaloPetSemanticState,
  signal: HaloPetSignal,
  surface: 'ambient' | 'session' | 'completion',
) =>
  ({
    ...(pet === 'haloform'
      ? { '--halo-pet-body': `url("/mascots/agent-halo-roster/body/haloform/${surface}/${motion}.png")` }
      : {}),
    ...(signal === 'none' ? {} : { '--halo-pet-signal': `url("/mascots/agent-halo-roster/signals/${signal}.png")` }),
    ...(pet === 'haloform'
      ? surface === 'ambient'
        ? {
            '--halo-pet-frame-width': '30px',
            '--halo-pet-frame-height': '30px',
            '--halo-pet-three-frame-width': '90px',
            '--halo-pet-done-width': '120px',
            '--halo-pet-frame-1-x': '-30px',
            '--halo-pet-frame-2-x': '-60px',
            '--halo-pet-frame-3-x': '-90px',
            '--halo-pet-signal-left': '34px',
          }
        : surface === 'session'
          ? {
              '--halo-pet-frame-width': '36px',
              '--halo-pet-frame-height': '36px',
              '--halo-pet-three-frame-width': '108px',
              '--halo-pet-done-width': '144px',
              '--halo-pet-frame-1-x': '-36px',
              '--halo-pet-frame-2-x': '-72px',
              '--halo-pet-frame-3-x': '-108px',
              '--halo-pet-signal-left': '40px',
            }
          : {}
      : {}),
    ...(pet === 'halo-bot'
      ? {
          '--halo-pet-hue': '0deg',
          '--halo-pet-saturation': '1',
          '--halo-pet-brightness': '1',
        }
      : {}),
  }) as CSSProperties & { '--halo-pet-body'?: string; '--halo-pet-signal'?: string }

const SQUARE_PET_BODY_STYLE = {
  imageRendering: 'pixelated',
  filter: 'saturate(var(--halo-pet-saturation)) brightness(var(--halo-pet-brightness))',
} as CSSProperties

const HALO_BOT_PART_LABELS: Record<HaloBotPartCategory, string> = {
  eyes: 'Eyes',
  heads: 'Head',
  body: 'Body',
  top: 'Top',
}

export const HaloBotBody = ({ loadout }: { loadout: HaloBotLoadout }) => {
  const parts = getHaloBotParts(loadout)
  return (
    <span className="halo-pet-body pixabot-body" style={SQUARE_PET_BODY_STYLE}>
      {HALO_BOT_LAYER_ORDER.map((category) => {
        const part = parts[category]
        const style = {
          '--pixabot-frame-count': part.frames,
          '--pixabot-animation-steps': Math.max(1, part.frames - 1),
          '--pixabot-part-duration': `${part.frames * 72}ms`,
          backgroundImage: `url("/mascots/agent-halo-roster/body/halo-bot/parts/${category}/${part.name}.png")`,
          backgroundSize: `${part.frames * 100}% 100%`,
        } as CSSProperties
        return (
          <span
            className="pixabot-layer"
            data-category={category}
            title={`${HALO_BOT_PART_LABELS[category]}: ${part.name}`}
            key={category}
          >
            <span className="pixabot-part" data-part-kind={part.kind} style={style} />
          </span>
        )
      })}
    </span>
  )
}

export interface IHaloPetProps {
  activityKind?: ActivityKind
  className: string
  loadout?: HaloBotLoadout
  motionMapping?: HaloPetMotionMapping
  pet?: HaloPetName
  status?: ISessionSummary['status']
  surface?: 'ambient' | 'session' | 'completion'
}

export const HaloPet = ({
  activityKind,
  className,
  loadout,
  motionMapping = DEFAULT_HALO_PET_MOTION_MAPPING,
  pet = DEFAULT_HALO_PET,
  status,
  surface = 'session',
}: IHaloPetProps) => {
  const state = getHaloPetSemanticState(status, activityKind)
  const motion = resolveHaloPetMotion(state, motionMapping)
  const signal = getHaloPetSignal(status, activityKind)
  const visualStatus = status === 'idle' || status === 'inactive' ? status : state
  const resolvedLoadout = pet === 'halo-bot' ? getHaloBotLoadout(loadout) : DEFAULT_HALO_BOT_LOADOUT
  return (
    <span
      className={`${className} halo-pet`}
      data-status={visualStatus}
      data-session-status={status ?? 'idle'}
      data-kind={activityKind}
      data-state={state}
      data-motion={motion}
      data-signal={signal}
      data-pet={pet}
      data-loadout={pet === 'halo-bot' ? resolvedLoadout : undefined}
      style={getStyle(pet, motion, signal, surface)}
      aria-hidden="true"
    >
      {pet === 'halo-bot' ? (
        <HaloBotBody loadout={resolvedLoadout} />
      ) : (
        <span className="halo-pet-body" style={SQUARE_PET_BODY_STYLE} />
      )}
      {signal === 'none' ? null : <span className="halo-pet-signal" />}
    </span>
  )
}

export const ActivityPet = (props: Omit<IHaloPetProps, 'className' | 'surface'>) => (
  <HaloPet className="activity-pet" surface="ambient" {...props} />
)
export const SessionPet = (props: Omit<IHaloPetProps, 'className' | 'surface'>) => (
  <HaloPet className="session-pet" surface="session" {...props} />
)
