import { ChevronDown, ChevronRight, Focus, Trash2, X } from 'lucide-react'
import { formatRelativeAge, formatTime, shortModelName } from './activity'
import type { HaloBotLoadout } from './halo-bot'
import type { HaloPetName } from './halo-pet'
import { SessionPet } from './halo-pet'
import type { HaloPetMotionMapping } from './pet-motion'
import type { ISessionDetail, ISessionSummary, IWorkspaceSessionGroup } from './types'

export const StatusGlyph = ({ status }: { status: ISessionSummary['status'] }) => (
  <span className="status-slot">
    {status === 'working' ? (
      <span className="glyph-pulse">✱</span>
    ) : status === 'attention' ? (
      <span className="glyph-attention">!</span>
    ) : status === 'done' ? (
      <span className="glyph-check">✓</span>
    ) : (
      <span className={`status-dot status-${status}`} />
    )}
  </span>
)
const statusLabel = (status: ISessionSummary['status']) =>
  ({ attention: 'Needs input', done: 'Done', error: 'Error', idle: 'Idle', inactive: 'Inactive', working: 'Working' })[
    status
  ]
const shortSessionId = (id: string) => id.replace(/^local-conv-/, '').slice(-8)

export const hasVisibleSessionTasks = (tasks: ISessionSummary['tasks']) =>
  Boolean(tasks && (tasks.availability === 'unavailable' || tasks.tasks.length || tasks.omittedCount))

export const SessionTasks = ({
  tasks,
  tasksObservedAt,
  status,
}: Pick<ISessionSummary, 'tasks' | 'tasksObservedAt' | 'status'>) => {
  if (!tasks || !hasVisibleSessionTasks(tasks)) return null
  return (
    <section className="session-tasks" aria-label="Pi subagent tasks">
      <span className="session-context-eyebrow">Subagent tasks</span>
      <span title={tasksObservedAt ?? undefined}>
        Last observed {tasksObservedAt ? formatTime(tasksObservedAt) : 'time unavailable'} · not a live heartbeat
      </span>
      {status === 'inactive' ? <span>Parent inactive · task state is historical</span> : null}
      {tasks.omittedCount ? <span>{tasks.omittedCount} older tasks omitted</span> : null}
      {tasks.availability === 'unavailable' ? (
        <span>Unavailable · owner-scoped service not ready</span>
      ) : (
        <ul>
          {tasks.tasks.map((task) => (
            <li key={task.id}>
              <span>
                {task.role} · <code>{task.id}</code>
              </span>
              <span data-status={task.status}>{task.status}</span>
              <span title={task.startedAt ? new Date(task.startedAt).toISOString() : undefined}>
                {task.startedAt ? `Started ${formatTime(new Date(task.startedAt).toISOString())}` : 'Start unavailable'}
                {task.completedAt ? ` · Ended ${formatTime(new Date(task.completedAt).toISOString())}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export const SessionContextSummary = ({
  loadout,
  motionMapping,
  pet,
  session,
}: {
  loadout: HaloBotLoadout
  motionMapping: HaloPetMotionMapping
  pet: HaloPetName
  session: ISessionDetail
}) => {
  const latest = session.events[0]
  const kind = latest?.type === 'attention_requested' ? latest.data.kind : null
  const [eyebrow, title, detail = session.detail] =
    session.status === 'working'
      ? [
          'Current activity',
          session.activityKind === 'thinking' || session.activityKind === 'model' ? 'Model is working' : 'Working',
        ]
      : session.status === 'attention'
        ? [
            'Needs input',
            kind === 'question' || session.activityKind === 'asking' ? 'Question requested' : 'Approval requested',
          ]
        : session.status === 'done'
          ? ['Completed', 'Turn completed']
          : session.status === 'error'
            ? ['Error', 'Activity failed']
            : session.status === 'inactive'
              ? ['Inactive', 'Activity paused', 'No recent terminal event']
              : ['Idle', 'Ready']
  return (
    <>
      <section
        className="session-context-summary"
        data-status={session.status}
        aria-labelledby="session-context-title"
        data-panel-focus-target
        tabIndex={-1}
      >
        <SessionPet
          activityKind={session.activityKind}
          loadout={loadout}
          motionMapping={motionMapping}
          pet={pet}
          status={session.status}
        />
        <span className="session-context-copy">
          <span className="session-context-eyebrow">{eyebrow}</span>
          <span className="session-context-title" id="session-context-title">
            {title}
          </span>
          <span className="session-context-detail">{detail}</span>
        </span>
        <span className="session-context-meta">
          <span className="session-model">{shortModelName(session.model)}</span>
          <span className="session-age" title={formatTime(session.lastActivityAt)}>
            {formatRelativeAge(session.lastActivityAt)}
          </span>
        </span>
      </section>
      <SessionTasks tasks={session.tasks} tasksObservedAt={session.tasksObservedAt} status={session.status} />
    </>
  )
}

export interface ISessionListRowProps {
  child?: boolean
  loadout: HaloBotLoadout
  motionMapping: HaloPetMotionMapping
  pet: HaloPetName
  onClear: (id: string) => void
  onFocus: (session: ISessionSummary) => void
  onOpen: (id: string) => void
  session: ISessionSummary
}
export const SessionListRow = ({
  child = false,
  loadout,
  motionMapping,
  pet,
  onClear,
  onFocus,
  onOpen,
  session,
}: ISessionListRowProps) => (
  <li
    className={`session-row ${hasVisibleSessionTasks(session.tasks) ? 'has-tasks' : ''} ${child ? 'session-child-row' : ''} ${session.status === 'done' ? 'ended' : ''}`}
    data-status={session.status}
  >
    <button
      className="session-row-main"
      type="button"
      onClick={() => onOpen(session.conversationId)}
      data-session-id={session.conversationId}
      data-tauri-drag-region="false"
      aria-label={`Open ${session.project} session details`}
    >
      {child ? (
        <StatusGlyph status={session.status} />
      ) : (
        <SessionPet
          activityKind={session.activityKind}
          loadout={loadout}
          motionMapping={motionMapping}
          pet={pet}
          status={session.status}
        />
      )}
      <span className="session-label">
        <span className="session-title-line">
          <span className="session-project">{child ? shortSessionId(session.conversationId) : session.project}</span>
          <span className={`session-inline-status status-text-${session.status}`}>{statusLabel(session.status)}</span>
        </span>
        <span className="session-activity">{session.detail}</span>
        <span className="session-folder">{child ? session.project : session.workspace}</span>
      </span>
      <span className="session-row-metadata" title={formatTime(session.lastActivityAt)}>
        <span className="session-model">{shortModelName(session.model)}</span>
        <span className="session-age">{formatRelativeAge(session.lastActivityAt)}</span>
      </span>
    </button>
    <div className="session-row-actions">
      <button
        className="row-btn row-focus"
        type="button"
        onClick={() => onFocus(session)}
        data-tauri-drag-region="false"
        aria-label={`Focus ${session.project} session in ${session.herdrTarget ? 'Herdr' : 'Ghostty'}`}
        title={session.herdrTarget ? 'Focus exact Herdr pane' : 'Focus matching Ghostty terminal'}
      >
        <Focus size={11} strokeWidth={2.4} />
      </button>
      {session.status === 'done' ? (
        <button
          className="row-btn row-clear"
          type="button"
          onClick={() => onClear(session.conversationId)}
          data-tauri-drag-region="false"
          aria-label={`Clear completed ${session.project} session`}
          title="Hide this completed session until it has fresh activity"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
    <SessionTasks tasks={session.tasks} tasksObservedAt={session.tasksObservedAt} status={session.status} />
  </li>
)

export interface IWorkspaceSessionGroupItemProps {
  expanded: boolean
  group: IWorkspaceSessionGroup
  groupKey: string
  loadout: HaloBotLoadout
  motionMapping: HaloPetMotionMapping
  pet: HaloPetName
  removeGroupArmed: boolean
  onClear: (id: string) => void
  onFocus: (session: ISessionSummary) => void
  onGroupAction: (groupKey: string, group: IWorkspaceSessionGroup) => void
  onOpen: (id: string) => void
  onToggle: (key: string) => void
}
export const WorkspaceSessionGroupItem = ({
  expanded,
  group,
  groupKey,
  loadout,
  motionMapping,
  pet,
  removeGroupArmed,
  onClear,
  onFocus,
  onGroupAction,
  onOpen,
  onToggle,
}: IWorkspaceSessionGroupItemProps) => {
  if (group.sessions.length === 1)
    return (
      <SessionListRow
        loadout={loadout}
        motionMapping={motionMapping}
        pet={pet}
        session={group.sessions[0]}
        onClear={onClear}
        onFocus={onFocus}
        onOpen={onOpen}
      />
    )
  const allDone = group.sessions.every((session) => session.status === 'done')
  const canRemoveInactiveGroup = group.sessions.every((session) => session.status === 'inactive')
  return (
    <li className="session-group-block" data-status={group.status}>
      <div className="session-row session-group" data-status={group.status}>
        <button
          className="session-row-main session-group-main"
          type="button"
          onClick={() => onToggle(groupKey)}
          data-tauri-drag-region="false"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.project}, ${group.sessions.length} sessions`}
        >
          <span className="session-disclosure" aria-hidden="true">
            {expanded ? <ChevronDown size={12} strokeWidth={2.4} /> : <ChevronRight size={12} strokeWidth={2.4} />}
          </span>
          <SessionPet
            activityKind={group.activityKind}
            loadout={loadout}
            motionMapping={motionMapping}
            pet={pet}
            status={group.status}
          />
          <span className="session-label">
            <span className="session-title-line">
              <span className="session-project">{group.project}</span>
              <span className="session-group-count">×{group.sessions.length}</span>
              <span className={`session-inline-status status-text-${group.status}`}>{statusLabel(group.status)}</span>
            </span>
            <span className="session-activity">{group.detail}</span>
            <span className="session-folder">{group.workspace}</span>
          </span>
          <span className="session-row-metadata" title={formatTime(group.lastActivityAt)}>
            <span className="session-model">{shortModelName(group.primarySession.model)}</span>
            <span className="session-age">{formatRelativeAge(group.lastActivityAt)}</span>
          </span>
        </button>
        {allDone || canRemoveInactiveGroup ? (
          <div className="session-row-actions">
            {allDone ? (
              <button
                className="row-btn row-clear"
                type="button"
                onClick={() => onGroupAction(groupKey, group)}
                data-tauri-drag-region="false"
                aria-label={`Clear completed ${group.project} group`}
                title="Hide every completed session in this group until it has fresh activity"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            ) : (
              <button
                className={`row-btn danger row-remove-group ${removeGroupArmed ? 'is-armed' : ''}`}
                type="button"
                onClick={() => onGroupAction(groupKey, group)}
                data-tauri-drag-region="false"
                aria-label={`${removeGroupArmed ? 'Confirm remove' : 'Remove'} ${group.sessions.length} inactive ${group.project} sessions`}
                title="Remove inactive group from local history"
              >
                <Trash2 size={11} strokeWidth={2.3} />
                {removeGroupArmed ? <span>Remove {group.sessions.length}</span> : null}
              </button>
            )}
          </div>
        ) : null}
      </div>
      {expanded ? (
        <ul className="session-child-list" aria-label={`${group.project} sessions`}>
          {group.sessions.map((session) => (
            <SessionListRow
              child
              loadout={loadout}
              motionMapping={motionMapping}
              pet={pet}
              session={session}
              onClear={onClear}
              onFocus={onFocus}
              onOpen={onOpen}
              key={session.conversationId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
