import { COMMAND_REGISTRY, type CommandName } from './contracts'

/** Runtime capability registry: only commands with an actual handler belong here. */
export const IMPLEMENTED_COMMANDS = ['status', 'capabilities'] as const satisfies readonly CommandName[]
export type ImplementedCommandName = typeof IMPLEMENTED_COMMANDS[number]

export function isImplementedCommand(command: CommandName): command is ImplementedCommandName {
  return (IMPLEMENTED_COMMANDS as readonly string[]).includes(command)
}

export function commandDefinitions() {
  return IMPLEMENTED_COMMANDS.map(command => ({ name: command, ...COMMAND_REGISTRY[command] }))
}
