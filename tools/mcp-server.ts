import { createRequire } from 'node:module'
import { createInterface, type ReadLine } from 'node:readline'
import type { Writable } from 'node:stream'

export const MCP_PROTOCOL_VERSION = '2025-06-18' as const
const packageJson = createRequire(import.meta.url)('../package.json') as { version: string }
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:9376'
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_RETRY_COUNT = 1

type JsonRpcId = string | number
export interface McpJsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: { code: number; message: string; data?: unknown }
}

export type McpJsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    additionalProperties: false
  }
}

function objectSchema(properties: Record<string, unknown> = {}, required: string[] = []): McpToolDefinition['inputSchema'] {
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false }
}

function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): McpToolDefinition {
  return { name, description, inputSchema: objectSchema(properties, required) }
}

const confirmationProperty = { confirmed: { type: 'boolean', const: true, description: 'Required explicit confirmation for a mutation.' } }
const confirmationTools = [
  tool('mmstopwatch_timer_start', 'Start a timer; requires explicit confirmation.', { ...confirmationProperty, notePath: { type: 'string' } }, ['confirmed', 'notePath']),
  tool('mmstopwatch_timer_pause', 'Pause a timer; requires explicit confirmation.', confirmationProperty, ['confirmed']),
  tool('mmstopwatch_timer_resume', 'Resume a timer; requires explicit confirmation.', confirmationProperty, ['confirmed']),
  tool('mmstopwatch_timer_stop', 'Stop a timer; requires explicit confirmation.', confirmationProperty, ['confirmed']),
  tool('mmstopwatch_timer_discard', 'Discard a timer; requires explicit confirmation.', confirmationProperty, ['confirmed']),
  tool('mmstopwatch_note_save', 'Save note data; requires explicit confirmation.', { ...confirmationProperty, relativePath: { type: 'string' } }, ['confirmed', 'relativePath']),
  tool('mmstopwatch_note_update', 'Update note data; requires explicit confirmation.', { ...confirmationProperty, relativePath: { type: 'string' } }, ['confirmed', 'relativePath']),
  tool('mmstopwatch_note_delete', 'Delete a note; requires explicit confirmation.', { ...confirmationProperty, relativePath: { type: 'string' } }, ['confirmed', 'relativePath']),
  tool('mmstopwatch_profile_create', 'Create a profile; requires explicit confirmation.', confirmationProperty, ['confirmed']),
  tool('mmstopwatch_profile_switch', 'Switch profile; requires explicit confirmation.', { ...confirmationProperty, profileId: { type: 'string' } }, ['confirmed', 'profileId']),
  tool('mmstopwatch_profile_delete', 'Delete a profile; requires explicit confirmation.', { ...confirmationProperty, profileId: { type: 'string' } }, ['confirmed', 'profileId']),
  tool('mmstopwatch_config_set', 'Change configuration; requires explicit confirmation.', { ...confirmationProperty, key: { type: 'string' } }, ['confirmed', 'key']),
  tool('mmstopwatch_notification_test', 'Send a test notification; requires explicit confirmation.', confirmationProperty, ['confirmed']),
]

const ALL_MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  tool('mmstopwatch_status', 'Read the authenticated mmStopWatch control-plane status.'),
  tool('mmstopwatch_capabilities', 'Read the currently enabled, read-only mmStopWatch command capabilities.'),
  tool('mmstopwatch_list_notes', 'List Markdown notes exposed by the authenticated mmStopWatch API.', {
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    cursor: { type: 'string' },
    query: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 50 },
  }),
  tool('mmstopwatch_get_stats', 'Read statistics from the authenticated mmStopWatch API.', { from: { type: 'string' }, to: { type: 'string' } }),
  tool('mmstopwatch_preview_report', 'Preview a Markdown report without writing to the vault.', {
    from: { type: 'string' }, to: { type: 'string' }, format: { type: 'string', enum: ['markdown'] },
  }),
  tool('mmstopwatch_timer_list', 'List timers if the control-plane runtime provides timer state.'),
  tool('mmstopwatch_note_get', 'Read a note if the control-plane runtime provides note access.', { relativePath: { type: 'string' } }, ['relativePath']),
  tool('mmstopwatch_profile_list', 'List configured profiles if the control-plane runtime provides profile access.'),
  tool('mmstopwatch_profile_show', 'Read a profile if the control-plane runtime provides profile access.', { profileId: { type: 'string' } }, ['profileId']),
  tool('mmstopwatch_config_get', 'Read safe configuration metadata if the control-plane runtime provides it.'),
  tool('mmstopwatch_analytics_stats', 'Read analytics statistics through the versioned stats endpoint.', { from: { type: 'string' }, to: { type: 'string' } }),
  tool('mmstopwatch_reports_preview', 'Preview a report through the versioned reports endpoint.', { from: { type: 'string' }, to: { type: 'string' }, format: { type: 'string', enum: ['markdown'] } }),
  tool('mmstopwatch_notification_status', 'Read notification capability metadata if available.'),
  ...confirmationTools,
]

/** Planned schemas are kept for future API-backed command groups; only implemented routes are advertised. */
export const MCP_PLANNED_TOOL_DEFINITIONS: McpToolDefinition[] = ALL_MCP_TOOL_DEFINITIONS
const IMPLEMENTED_TOOL_NAMES = new Set(['mmstopwatch_status', 'mmstopwatch_capabilities'])
export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = ALL_MCP_TOOL_DEFINITIONS.filter(definition => IMPLEMENTED_TOOL_NAMES.has(definition.name))

interface FetchOptions {
  fetchImpl?: typeof fetch
  apiBaseUrl?: string
  token?: string
  timeoutMs?: number
  retryCount?: number
  shutdownSignal?: AbortSignal
}

export interface McpRequestHandlerOptions extends FetchOptions {}

interface ToolRoute {
  method: 'GET' | 'POST'
  path: string
}

const TOOL_ROUTES: Record<string, ToolRoute> = {
  mmstopwatch_status: { method: 'GET', path: '/api/v1/status' },
  mmstopwatch_capabilities: { method: 'GET', path: '/api/v1/capabilities' },
  mmstopwatch_list_notes: { method: 'GET', path: '/api/v1/notes' },
  mmstopwatch_get_stats: { method: 'GET', path: '/api/v1/stats' },
  mmstopwatch_preview_report: { method: 'POST', path: '/api/v1/reports/preview' },
  mmstopwatch_analytics_stats: { method: 'GET', path: '/api/v1/stats' },
  mmstopwatch_reports_preview: { method: 'POST', path: '/api/v1/reports/preview' },
}

const MUTATING_TOOL_NAMES = new Set([
  'mmstopwatch_timer_start', 'mmstopwatch_timer_pause', 'mmstopwatch_timer_resume', 'mmstopwatch_timer_stop', 'mmstopwatch_timer_discard',
  'mmstopwatch_note_save', 'mmstopwatch_note_update', 'mmstopwatch_note_delete',
  'mmstopwatch_profile_create', 'mmstopwatch_profile_switch', 'mmstopwatch_profile_delete',
  'mmstopwatch_config_set', 'mmstopwatch_notification_test',
])

function response(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

function errorResponse(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function textResult(value: unknown, isError = false): { content: [{ type: 'text'; text: string }]; isError: boolean } {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    isError,
  }
}

function toolError(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRequest(value: unknown): value is McpJsonRpcRequest {
  if (!isRecord(value)) return false
  return value.jsonrpc === '2.0' && typeof value.method === 'string'
    && (value.id === undefined || typeof value.id === 'string' || typeof value.id === 'number')
    && (value.params === undefined || isRecord(value.params))
}

function validateInitializeParams(params: unknown): string | undefined {
  if (!isRecord(params)) return 'initialize params must be an object'
  if (params.protocolVersion !== MCP_PROTOCOL_VERSION) return `Unsupported protocol version; supported version is ${MCP_PROTOCOL_VERSION}`
  if (!isRecord(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
    return 'initialize clientInfo.name and clientInfo.version are required'
  }
  if (!isRecord(params.capabilities)) return 'initialize capabilities must be an object'
  return undefined
}

function validateToolArguments(name: string, args: unknown): string | undefined {
  if (!isRecord(args)) return 'tools/call arguments must be an object'
  const definition = MCP_TOOL_DEFINITIONS.find(toolDefinition => toolDefinition.name === name)
  if (!definition) return 'Unknown tool'
  const properties = definition.inputSchema.properties || {}
  const propertyNames = new Set(Object.keys(properties))
  const unknownProperty = Object.keys(args).find(key => !propertyNames.has(key))
  if (unknownProperty) return `Unknown tool argument: ${unknownProperty}`
  for (const required of definition.inputSchema.required || []) {
    if (!(required in args)) return `Missing required tool argument: ${required}`
  }
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key]
    if (!isRecord(schema)) continue
    if ('const' in schema && value !== schema.const) return `Invalid tool argument: ${key}`
    if (schema.type === 'string' && typeof value !== 'string') return `Invalid tool argument: ${key}`
    if (schema.type === 'integer' && (!Number.isInteger(value) || (typeof schema.minimum === 'number' && (value as number) < schema.minimum) || (typeof schema.maximum === 'number' && (value as number) > schema.maximum))) return `Invalid tool argument: ${key}`
    if (schema.type === 'boolean' && typeof value !== 'boolean') return `Invalid tool argument: ${key}`
    if (schema.type === 'array') {
      if (!Array.isArray(value) || (typeof schema.maxItems === 'number' && value.length > schema.maxItems)) return `Invalid tool argument: ${key}`
      const itemSchema = isRecord(schema.items) ? schema.items : undefined
      if (itemSchema?.type === 'string' && value.some(item => typeof item !== 'string')) return `Invalid tool argument: ${key}`
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `Invalid tool argument: ${key}`
    if (typeof value === 'string' && value.length > 200) return `Invalid tool argument: ${key}`
  }
  return undefined
}

function buildRequestUrl(baseUrl: string, path: string, args: Record<string, unknown>): string {
  const url = new URL(path, `${baseUrl.replace(/\/$/, '')}/`)
  if (path === '/api/v1/notes') {
    for (const key of ['limit', 'cursor', 'query']) {
      const value = args[key]
      if (typeof value === 'string' || typeof value === 'number') url.searchParams.set(key, String(value))
    }
    const tags = args.tags
    if (Array.isArray(tags) && tags.every(tag => typeof tag === 'string')) url.searchParams.set('tags', tags.join(','))
  }
  if (path === '/api/v1/stats') {
    for (const key of ['from', 'to']) {
      const value = args[key]
      if (typeof value === 'string') url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function redactError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Control plane request failed'
  return raw
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/(token|secret|password|api[_-]?key)=[^\s&]+/gi, '$1=[REDACTED]')
    .replace(/[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
}

async function fetchWithRetry(url: string, init: RequestInit, options: FetchOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl || fetch
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT
  let lastError: unknown

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController()
    const abortFromShutdown = () => controller.abort()
    if (options.shutdownSignal?.aborted) controller.abort()
    else options.shutdownSignal?.addEventListener('abort', abortFromShutdown, { once: true })
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal })
      if (response.status >= 500 && attempt < retryCount) continue
      return response
    } catch (error) {
      lastError = error
      if (attempt >= retryCount) throw error
    } finally {
      clearTimeout(timeout)
      options.shutdownSignal?.removeEventListener('abort', abortFromShutdown)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Control plane request failed')
}

async function callTool(name: string, args: Record<string, unknown>, options: FetchOptions): Promise<ReturnType<typeof textResult>> {
  if (!MCP_TOOL_DEFINITIONS.some(toolDefinition => toolDefinition.name === name)) return toolError('Tool is not available')
  if (MUTATING_TOOL_NAMES.has(name) && args.confirmed !== true) return toolError('Confirmation required for this mutation')
  const route = TOOL_ROUTES[name]
  if (!route) return toolError('Tool is not available in the current control-plane API')
  if (!options.token?.trim()) return toolError('Control plane token is required')

  const url = buildRequestUrl(options.apiBaseUrl || DEFAULT_API_BASE_URL, route.path, args)
  const init: RequestInit = {
    method: route.method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/json',
      ...(route.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
  }
  if (route.method === 'POST') {
    init.body = JSON.stringify({
      from: typeof args.from === 'string' ? args.from : undefined,
      to: typeof args.to === 'string' ? args.to : undefined,
      format: args.format === 'markdown' ? 'markdown' : undefined,
    })
  }

  try {
    const apiResponse = await fetchWithRetry(url, init, options)
    const raw = await apiResponse.text()
    let payload: unknown
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      return toolError('Control plane returned invalid JSON')
    }
    return textResult(payload, !apiResponse.ok || (typeof payload === 'object' && payload !== null && (payload as { ok?: unknown }).ok === false))
  } catch (error) {
    return toolError(`Control plane request failed: ${redactError(error)}`)
  }
}

export type McpSessionState = 'new' | 'awaiting_initialized' | 'ready' | 'closed'

export interface McpRequestHandler {
  (input: unknown): Promise<McpJsonRpcResponse | undefined>
  close: () => void
  isClosed: () => boolean
  getState: () => McpSessionState
}

export function createMcpRequestHandler(options: McpRequestHandlerOptions = {}): McpRequestHandler {
  let state: McpSessionState = 'new'
  const shutdownController = new AbortController()
  const requestOptions: McpRequestHandlerOptions = { ...options, shutdownSignal: shutdownController.signal }
  const handler = (async (input: unknown): Promise<McpJsonRpcResponse | undefined> => {
    if (!isRequest(input)) {
      const hasId = isRecord(input) && Object.prototype.hasOwnProperty.call(input, 'id')
      const rawId = hasId ? input.id : null
      return hasId ? errorResponse(typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null, -32600, 'Invalid Request') : undefined
    }

    const hasId = Object.prototype.hasOwnProperty.call(input, 'id')
    if (input.method === 'notifications/initialized') {
      if (hasId) return errorResponse(input.id as JsonRpcId, -32600, 'initialized notification must not include an id')
      if (state === 'awaiting_initialized') state = 'ready'
      return undefined
    }
    if (!hasId) return undefined

    const id = input.id as JsonRpcId
    if (state === 'closed') return errorResponse(id, -32002, 'MCP session is closed')
    if (input.method === 'initialize') {
      if (state !== 'new') return errorResponse(id, -32600, 'MCP session is already initialized')
      const validationError = validateInitializeParams(input.params)
      if (validationError) return errorResponse(id, -32602, validationError, { supportedProtocolVersion: MCP_PROTOCOL_VERSION })
      state = 'awaiting_initialized'
      return response(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'mmstopwatch', version: packageJson.version },
      })
    }
    if (state !== 'ready') return errorResponse(id, -32002, 'MCP session is not initialized')
    if (input.method === 'ping') return response(id, {})
    if (input.method === 'tools/list') {
      if (input.params !== undefined && !isRecord(input.params)) return errorResponse(id, -32602, 'tools/list params must be an object')
      return response(id, { tools: MCP_TOOL_DEFINITIONS })
    }
    if (input.method === 'tools/call') {
      const params = input.params
      if (!isRecord(params)) return errorResponse(id, -32602, 'tools/call params must be an object')
      const name = params.name
      if (typeof name !== 'string') return errorResponse(id, -32602, 'Tool name is required')
      if (!MCP_TOOL_DEFINITIONS.some(toolDefinition => toolDefinition.name === name)) return errorResponse(id, -32602, 'Unknown tool')
      const args = params.arguments === undefined ? {} : params.arguments
      const validationError = validateToolArguments(name, args)
      if (validationError) return errorResponse(id, -32602, validationError)
      return response(id, await callTool(name, args as Record<string, unknown>, requestOptions))
    }
    return errorResponse(id, -32601, 'Method not found')
  }) as McpRequestHandler

  handler.close = () => {
    if (state === 'closed') return
    state = 'closed'
    shutdownController.abort()
  }
  handler.isClosed = () => state === 'closed'
  handler.getState = () => state
  return handler
}

export interface McpStdioServerOptions extends McpRequestHandlerOptions {
  input?: NodeJS.ReadableStream
  output?: Writable
  onExit?: () => void | Promise<void>
}

export async function runMcpStdioServer(options: McpStdioServerOptions = {}): Promise<void> {
  const input = options.input || process.stdin
  const output = options.output || process.stdout
  const handler = createMcpRequestHandler(options)
  const readline: ReadLine = createInterface({ input })

  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closePromise) return closePromise
    closePromise = (async () => {
      handler.close()
      readline.close()
      await options.onExit?.()
    })()
    return closePromise
  }
  const onSignal = () => { void close() }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    for await (const line of readline) {
      if (!line.trim()) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        output.write(`${JSON.stringify(errorResponse(null, -32700, 'Parse error'))}\n`)
        continue
      }
      const result = await handler(message)
      if (result && !handler.isClosed()) output.write(`${JSON.stringify(result)}\n`)
    }
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    await close()
  }
}
