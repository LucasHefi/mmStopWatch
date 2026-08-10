import type { SafeError } from './errors'

export const PROTOCOL_VERSION = '1' as const

export type RequestId = string
export type Revision = string
export type IdempotencyKey = string
export type Actor = 'ui' | 'http' | 'mcp' | 'cli'

export type TimerStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED'

export type StatusInput = Record<string, never>

export interface NoteListInput {
  limit?: number
  cursor?: string
  query?: string
  tags?: string[]
}

export type ProfileListInput = Record<string, never>
export type ConfigGetInput = Record<string, never>

export interface NoteGetInput {
  relativePath: string
}

export interface NoteSaveInput {
  relativePath: string
  durationMs: number
  reset?: boolean
  operationId?: string
}

export interface NoteUpdateInput {
  relativePath: string
  durationMs?: number
  tags?: string[]
  frontmatter?: Record<string, string | number | boolean | string[]>
}

export interface NoteDeleteInput {
  relativePath: string
}

export interface TimerStartInput {
  notePath: string
  name?: string
  initialElapsedMs?: number
}

export interface TimerPauseInput {
  timerId: string
}

export interface TimerResumeInput {
  timerId: string
}

export interface TimerStopInput {
  timerId: string
  save?: boolean
  operationId?: string
}

export interface TimerGetInput {
  timerId?: string
  notePath?: string
}

export interface TimerListInput {
  status?: TimerStatus
}

export interface CommandInput {
  status: StatusInput
  capabilities: Record<string, never>
  list_notes: NoteListInput
  get_stats: {
    from?: string
    to?: string
  }
  preview_report: {
    from?: string
    to?: string
    format?: 'markdown'
  }
  timer_start: TimerStartInput
  timer_pause: TimerPauseInput
  timer_resume: TimerResumeInput
  timer_stop: TimerStopInput
  timer_get: TimerGetInput
  timer_list: TimerListInput
  note_list: NoteListInput
  note_get: NoteGetInput
  note_save: NoteSaveInput
  note_update: NoteUpdateInput
  note_delete: NoteDeleteInput
  profile_list: ProfileListInput
  config_get: ConfigGetInput
}

export const CONFIRM = 'I confirm this mutating operation.' as const

export type CommandName = keyof CommandInput

export interface NoteDto {
  relativePath: string
  name: string
  durationMs: number
  tags: string[]
  hasFrontmatter: boolean
}

export interface ProfileDto {
  id: string
  name: string
  nick?: string
  active: boolean
}

export interface TimerDto {
  id: string
  notePath: string
  name: string
  status: TimerStatus
  elapsedMs: number
  baseElapsedMs: number
  pausedOffsetMs: number
  startedAtMs?: number
  timeEstimateMs?: number
}

export interface StatusDto {
  appVersion: string
  protocolVersion: typeof PROTOCOL_VERSION
  ready: boolean
  activeProfileId?: string
}

export interface CapabilitiesDto {
  protocolVersion: typeof PROTOCOL_VERSION
  readOnly: true
  commands: CommandName[]
}

export interface NoteListOutput {
  notes: NoteDto[]
  nextCursor?: string
  revision?: Revision
}

export interface NoteCommandOutput {
  note: NoteDto
  revision: Revision
  operationId?: string
  idempotencyKey?: IdempotencyKey
}

export interface NoteGetOutput {
  note?: NoteDto
  revision: Revision
}

export interface NoteDeleteOutput {
  relativePath: string
  deleted: true
  revision: Revision
  operationId?: string
  idempotencyKey?: IdempotencyKey
}

export interface TimerCommandOutput {
  timer: TimerDto
  revision: Revision
  operationId?: string
  idempotencyKey?: IdempotencyKey
}

export interface TimerStopOutput extends TimerCommandOutput {
  saved: boolean
}

export interface TimerGetOutput {
  timer?: TimerDto
  revision: Revision
}

export interface TimerListOutput {
  timers: TimerDto[]
  revision: Revision
}

export interface ProfileListOutput {
  profiles: ProfileDto[]
  activeProfileId?: string
}

export interface ConfigMetadataDto {
  activeProfileId?: string
  profileCount: number
  frontmatterKey?: string
  timeEstimateKey?: string
  timeFormat?: string
  language?: string
  dailyGoalMs?: number
  autoRefreshInterval?: number
  notificationsEnabled?: boolean
}

export interface ConfigGetOutput {
  config: ConfigMetadataDto
}

export interface StatsDto {
  from?: string
  to?: string
  totalDurationMs: number
  sessionCount: number
  noteCount: number
}

export interface ReportPreviewDto {
  format: 'markdown'
  content: string
  truncated: boolean
}

export interface CommandOutput {
  status: StatusDto
  capabilities: CapabilitiesDto
  list_notes: NoteListOutput
  get_stats: StatsDto
  preview_report: ReportPreviewDto
  timer_start: TimerCommandOutput
  timer_pause: TimerCommandOutput
  timer_resume: TimerCommandOutput
  timer_stop: TimerStopOutput
  timer_get: TimerGetOutput
  timer_list: TimerListOutput
  note_list: NoteListOutput
  note_get: NoteGetOutput
  note_save: NoteCommandOutput
  note_update: NoteCommandOutput
  note_delete: NoteDeleteOutput
  profile_list: ProfileListOutput
  config_get: ConfigGetOutput
}

export interface CommandContext {
  requestId: RequestId
  actor: Actor
  expectedRevision?: Revision
  idempotencyKey?: IdempotencyKey
  confirmation?: string
}

export type CommandRequest<C extends CommandName = CommandName> = C extends CommandName
  ? CommandContext & {
      protocolVersion: typeof PROTOCOL_VERSION
      command: C
      input: CommandInput[C]
    }
  : never

export interface SuccessEnvelope<T> {
  ok: true
  protocolVersion: typeof PROTOCOL_VERSION
  requestId: RequestId
  data: T
  revision?: Revision
  idempotencyKey?: IdempotencyKey
  warnings?: string[]
}

export interface ErrorEnvelope {
  ok: false
  protocolVersion: typeof PROTOCOL_VERSION
  requestId: RequestId
  error: SafeError
  revision?: Revision
}

export type CommandResult<T> = SuccessEnvelope<T> | ErrorEnvelope
export type CommandSuccessEnvelope<T> = SuccessEnvelope<T>
export type CommandErrorEnvelope = ErrorEnvelope

export type CommandDomain = 'status' | 'timer' | 'note' | 'report' | 'profile' | 'config'

export interface CommandDefinition {
  domain: CommandDomain
  mutating: boolean
}

export const COMMAND_REGISTRY = {
  status: { domain: 'status', mutating: false },
  capabilities: { domain: 'status', mutating: false },
  list_notes: { domain: 'note', mutating: false },
  get_stats: { domain: 'report', mutating: false },
  preview_report: { domain: 'report', mutating: false },
  timer_start: { domain: 'timer', mutating: true },
  timer_pause: { domain: 'timer', mutating: true },
  timer_resume: { domain: 'timer', mutating: true },
  timer_stop: { domain: 'timer', mutating: true },
  timer_get: { domain: 'timer', mutating: false },
  timer_list: { domain: 'timer', mutating: false },
  note_list: { domain: 'note', mutating: false },
  note_get: { domain: 'note', mutating: false },
  note_save: { domain: 'note', mutating: true },
  note_update: { domain: 'note', mutating: true },
  note_delete: { domain: 'note', mutating: true },
  profile_list: { domain: 'profile', mutating: false },
  config_get: { domain: 'config', mutating: false },
} as const satisfies Record<CommandName, CommandDefinition>

export type RegisteredCommandName = keyof typeof COMMAND_REGISTRY
export type CommandRegistry = typeof COMMAND_REGISTRY

export const EVENT_TYPES = [
  'timer.started',
  'timer.paused',
  'timer.resumed',
  'timer.stopped',
  'note.saved',
  'note.updated',
  'note.deleted',
  'session.recorded',
] as const

export type EventType = typeof EVENT_TYPES[number]

export interface DomainEventBase<T extends EventType = EventType> {
  type: T
  eventId: string
  occurredAt: number
  requestId: RequestId
  actor: Actor
  revision: Revision
  idempotencyKey?: IdempotencyKey
}

export interface TimerStartedEvent extends DomainEventBase<'timer.started'> {
  timerId: string
  notePath: string
}

export interface TimerPausedEvent extends DomainEventBase<'timer.paused'> {
  timerId: string
  elapsedMs: number
}

export interface TimerResumedEvent extends DomainEventBase<'timer.resumed'> {
  timerId: string
}

export interface TimerStoppedEvent extends DomainEventBase<'timer.stopped'> {
  timerId: string
  elapsedMs: number
}

export interface NoteSavedEvent extends DomainEventBase<'note.saved'> {
  relativePath: string
  durationMs: number
}

export interface NoteUpdatedEvent extends DomainEventBase<'note.updated'> {
  relativePath: string
}

export interface NoteDeletedEvent extends DomainEventBase<'note.deleted'> {
  relativePath: string
}

export interface SessionRecordedEvent extends DomainEventBase<'session.recorded'> {
  relativePath: string
  durationMs: number
  operationId?: string
}

export type ApplicationEvent =
  | TimerStartedEvent
  | TimerPausedEvent
  | TimerResumedEvent
  | TimerStoppedEvent
  | NoteSavedEvent
  | NoteUpdatedEvent
  | NoteDeletedEvent
  | SessionRecordedEvent
