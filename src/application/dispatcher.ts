import type {
  CommandContext,
  CommandInput,
  CommandName,
  CommandOutput,
  CommandRequest,
  CommandResult,
} from './contracts'
import { createSafeError, internalError } from './errors'

type CommandHandler<C extends CommandName> = (
  input: CommandInput[C],
  context: CommandContext,
) => CommandOutput[C] | Promise<CommandOutput[C]>

type AnyCommandHandler = (input: unknown, context: CommandContext) => unknown

type CommandHandlers = Partial<Record<CommandName, AnyCommandHandler>>

export class ApplicationDispatcher {
  constructor(private readonly handlers: CommandHandlers = {}) {}

  async dispatch<C extends CommandName>(request: CommandRequest<C>): Promise<CommandResult<CommandOutput[C]>> {
    if (request.protocolVersion !== '1' || !request.requestId.trim()) {
      return {
        ok: false,
        protocolVersion: '1',
        requestId: request.requestId || 'unknown',
        error: createSafeError('INVALID_REQUEST', 'Invalid command envelope'),
      }
    }

    const handler = this.handlers[request.command]
    if (!handler) {
      return {
        ok: false,
        protocolVersion: '1',
        requestId: request.requestId,
        error: createSafeError('NOT_IMPLEMENTED', 'Command is not available'),
      }
    }

    try {
      const data = await handler(request.input, request)
      return {
        ok: true,
        protocolVersion: '1',
        requestId: request.requestId,
        data: data as CommandOutput[C],
      }
    } catch {
      return {
        ok: false,
        protocolVersion: '1',
        requestId: request.requestId,
        error: internalError(),
      }
    }
  }
}

export function commandHandler<C extends CommandName>(handler: CommandHandler<C>): AnyCommandHandler {
  return handler as AnyCommandHandler
}
