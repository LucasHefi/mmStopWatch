import type {
  CommandContext,
  CommandInput,
  CommandName,
  CommandOutput,
  CommandRequest,
  CommandResult,
} from './contracts'
import { COMMAND_REGISTRY, CONFIRM } from './contracts'
import { createSafeError, internalError } from './errors'
import type { AuditSink, IdempotencyStore, MonotonicClock } from './ports'

export type CommandHandler<C extends CommandName> = (
  input: CommandInput[C],
  context: CommandContext,
) => CommandOutput[C] | Promise<CommandOutput[C]>

export type CommandRegistry = Partial<{
  [C in CommandName]: CommandHandler<C>
}>

type AnyCommandHandler = (input: unknown, context: CommandContext) => unknown

export interface ApplicationDispatcherOptions {
  auditSink?: AuditSink
  idempotencyStore?: IdempotencyStore
  monotonicClock?: MonotonicClock
}

export class ApplicationDispatcher {
  constructor(
    private readonly handlers: CommandRegistry = {},
    private readonly options: ApplicationDispatcherOptions = {},
  ) {}

  async dispatch<C extends CommandName>(request: CommandRequest<C>): Promise<CommandResult<CommandOutput[C]>> {
    if (request.protocolVersion !== '1' || !request.requestId.trim()) {
      const envelopeError = this.errorResult(request.requestId || 'unknown', createSafeError('INVALID_REQUEST', 'Invalid command envelope'))
      void this.recordAudit(request, 'rejected')
      return envelopeError
    }

    const def = (COMMAND_REGISTRY as Record<string, { mutating: boolean }>)[request.command]
    if (!def) {
      const err = this.errorResult(request.requestId, createSafeError('INVALID_REQUEST', 'Unknown command'))
      void this.recordAudit(request, 'rejected')
      return err
    }

    if (def.mutating && request.confirmation !== CONFIRM) {
      const err = this.errorResult(request.requestId, createSafeError('FORBIDDEN', 'Mutating commands require explicit confirmation'))
      void this.recordAudit(request, 'rejected')
      return err
    }

    if (request.idempotencyKey && this.options.idempotencyStore) {
      const cached = await this.options.idempotencyStore.get(request.idempotencyKey)
      if (cached) {
        const parsed = JSON.parse(cached) as CommandResult<CommandOutput[C]>
        void this.recordAudit(request, 'accepted')
        return parsed
      }
    }

    const handler = this.handlers[request.command] as AnyCommandHandler | undefined
    if (!handler) {
      const err = this.errorResult(request.requestId, createSafeError('NOT_IMPLEMENTED', 'Command is not available'))
      void this.recordAudit(request, 'rejected')
      return err
    }

    try {
      const data = await handler(request.input, request)
      const result: CommandResult<CommandOutput[C]> = {
        ok: true,
        protocolVersion: '1',
        requestId: request.requestId,
        data: data as CommandOutput[C],
      }
      if (request.idempotencyKey && this.options.idempotencyStore) {
        await this.options.idempotencyStore.set(request.idempotencyKey, JSON.stringify(result))
      }
      void this.recordAudit(request, 'accepted')
      return result
    } catch {
      const err = this.errorResult(request.requestId, internalError())
      void this.recordAudit(request, 'failed')
      return err
    }
  }

  private errorResult(requestId: string, error: ReturnType<typeof createSafeError>): CommandResult<never> {
    return {
      ok: false,
      protocolVersion: '1',
      requestId,
      error,
    }
  }

  private async recordAudit(request: { requestId: string; actor: 'ui' | 'http' | 'mcp' | 'cli'; command: string }, outcome: 'accepted' | 'rejected' | 'failed'): Promise<void> {
    if (!this.options.auditSink) return
    try {
      await this.options.auditSink.record({
        requestId: request.requestId,
        actor: request.actor,
        action: request.command,
        outcome,
      })
    } catch {
      // audit failure must not leak
    }
  }
}

export function commandHandler<C extends CommandName>(handler: CommandHandler<C>): CommandHandler<C> {
  return handler
}
