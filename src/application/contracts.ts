import type { SafeError } from './errors'

export const PROTOCOL_VERSION = '1' as const

export type Actor = 'ui' | 'http' | 'mcp' | 'cli'

export type CommandName = keyof CommandInput

export interface CommandInput {
  status: Record<string, never>
  capabilities: Record<string, never>
  list_notes: {
    limit?: number
    cursor?: string
  }
  get_stats: {
    from?: string
    to?: string
  }
  preview_report: {
    from?: string
    to?: string
    format?: 'markdown'
  }
}

export interface CommandOutput {
  status: StatusDto
  capabilities: CapabilitiesDto
  list_notes: { notes: NoteDto[]; nextCursor?: string }
  get_stats: StatsDto
  preview_report: ReportPreviewDto
}

export interface CommandContext {
  requestId: string
  actor: Actor
  expectedRevision?: string
  idempotencyKey?: string
  confirmation?: string
}

export type CommandRequest<C extends CommandName = CommandName> = CommandContext & {
  protocolVersion: typeof PROTOCOL_VERSION
  command: C
  input: CommandInput[C]
}

export type CommandResult<T> =
  | {
      ok: true
      protocolVersion: typeof PROTOCOL_VERSION
      requestId: string
      data: T
      warnings?: string[]
    }
  | {
      ok: false
      protocolVersion: typeof PROTOCOL_VERSION
      requestId: string
      error: SafeError
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

export interface NoteDto {
  relativePath: string
  name: string
  durationMs: number
  tags: string[]
  hasFrontmatter: boolean
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
