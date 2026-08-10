import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { ApplicationDispatcher, commandHandler, type CommandRegistry } from '../src/application/dispatcher'
import {
  COMMAND_REGISTRY,
  PROTOCOL_VERSION,
  type CapabilitiesDto,
  type CommandName,
  type CommandRequest,
  type CommandResult,
  type StatusDto,
} from '../src/application/contracts'
import { createSafeError } from '../src/application/errors'
import { validateRelativeNotePath } from '../src/application/security/pathPolicy'

const LOOPBACK_HOST = '127.0.0.1'
const packageJson = createRequire(`${process.cwd()}/tools/controlPlaneServer.ts`)('../package.json') as { version: string }
const DEFAULT_MAX_BODY_BYTES = 64 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

export interface ControlPlaneServerOptions {
  port?: number
  token?: string
  allowedOrigins?: string[]
  maxBodyBytes?: number
  requestTimeoutMs?: number
  handlers?: CommandRegistry
}

export interface ControlPlaneServerHandle {
  host: typeof LOOPBACK_HOST
  port: number
  token: string
  url: string
  close: () => Promise<void>
}

class RequestFailure extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown, origin?: string): void {
  const body = JSON.stringify(payload)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
  res.end(body)
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(1, hostHeader.indexOf(']'))
    : hostHeader.split(':')[0]
  return host === LOOPBACK_HOST || host === 'localhost'
}

function hasBearerToken(request: IncomingMessage, expectedToken: string): boolean {
  const header = headerValue(request.headers.authorization)
  if (!header?.startsWith('Bearer ')) return false
  const provided = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function requestId(request: IncomingMessage): string {
  const supplied = headerValue(request.headers['x-request-id'])?.trim()
  return supplied && supplied.length <= 100 ? supplied : randomUUID()
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const contentLength = Number(request.headers['content-length'] || 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestFailure(413, 'Request body is too large')
  }

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false

    request.on('data', chunk => {
      size += Buffer.byteLength(chunk)
      if (size > maxBytes) {
        tooLarge = true
      } else if (!tooLarge) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
    })
    request.on('end', () => {
      if (tooLarge) reject(new RequestFailure(413, 'Request body is too large'))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', () => reject(new RequestFailure(400, 'Request body could not be read')))
  })
}

function parseJsonBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object')
    }
    return value as Record<string, unknown>
  } catch {
    throw new RequestFailure(400, 'Request body must be a JSON object')
  }
}

function routeRequest(url: URL, method: string, body: Record<string, unknown>): CommandRequest | undefined {
  const requestIdValue = ''
  if (method === 'GET' && url.pathname === '/api/v1/status') {
    return { protocolVersion: PROTOCOL_VERSION, requestId: requestIdValue, actor: 'http', command: 'status', input: {} }
  }
  if (method === 'GET' && url.pathname === '/api/v1/capabilities') {
    return { protocolVersion: PROTOCOL_VERSION, requestId: requestIdValue, actor: 'http', command: 'capabilities', input: {} }
  }
  if (method === 'GET' && url.pathname === '/api/v1/timers') {
    return { protocolVersion: PROTOCOL_VERSION, requestId: requestIdValue, actor: 'http', command: 'timer_list', input: {} }
  }
  if (method === 'GET' && url.pathname === '/api/v1/profiles') {
    return { protocolVersion: PROTOCOL_VERSION, requestId: requestIdValue, actor: 'http', command: 'profile_list', input: {} }
  }
  if (method === 'GET' && url.pathname === '/api/v1/notes') {
    const rawPath = url.searchParams.get('path')
    if (rawPath !== null) {
      try {
        return {
          protocolVersion: PROTOCOL_VERSION,
          requestId: requestIdValue,
          actor: 'http',
          command: 'note_get',
          input: { relativePath: validateRelativeNotePath(rawPath) },
        }
      } catch (error) {
        throw new RequestFailure(400, error instanceof Error ? error.message : 'Invalid note path')
      }
    }
    const rawLimit = url.searchParams.get('limit')
    const limit = rawLimit === null ? undefined : Number(rawLimit)
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      throw new RequestFailure(400, 'limit must be an integer between 1 and 100')
    }
    const rawTags = url.searchParams.get('tags')
    const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : undefined
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: requestIdValue,
      actor: 'http',
      command: 'list_notes',
      input: {
        limit,
        cursor: url.searchParams.get('cursor') || undefined,
        query: url.searchParams.get('query') || undefined,
        tags,
      },
    }
  }
  if (method === 'GET' && url.pathname === '/api/v1/stats') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: requestIdValue,
      actor: 'http',
      command: 'get_stats',
      input: { from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined },
    }
  }
  if (method === 'POST' && url.pathname === '/api/v1/reports/preview') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: requestIdValue,
      actor: 'http',
      command: 'preview_report',
      input: {
        from: typeof body.from === 'string' ? body.from : undefined,
        to: typeof body.to === 'string' ? body.to : undefined,
        format: body.format === 'markdown' ? 'markdown' : undefined,
      },
    }
  }
  return undefined
}

function buildDispatcher(injectedHandlers: CommandRegistry = {}): ApplicationDispatcher {
  const readOnlyCommands: CommandName[] = ['status', 'capabilities']
  const mergedHandlers: CommandRegistry = {}

  for (const command of Object.keys(injectedHandlers) as CommandName[]) {
    if (command === 'status' || command === 'capabilities') continue
    const handler = injectedHandlers[command]
    if (!handler) continue
    const def = COMMAND_REGISTRY[command]
    if (def && !def.mutating) {
      (mergedHandlers as Record<string, unknown>)[command] = handler
      readOnlyCommands.push(command)
    }
  }

  return new ApplicationDispatcher({
    ...mergedHandlers,
    status: commandHandler((): StatusDto => ({
      appVersion: packageJson.version,
      protocolVersion: PROTOCOL_VERSION,
      ready: true,
    })),
    capabilities: commandHandler((): CapabilitiesDto => ({
      protocolVersion: PROTOCOL_VERSION,
      readOnly: true,
      commands: readOnlyCommands,
    })),
  })
}

function resultStatus(result: CommandResult<unknown>): number {
  if (result.ok) return 200
  const code = (result as Extract<CommandResult<unknown>, { ok: false }>).error.code
  if (code === 'NOT_IMPLEMENTED') return 501
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'FORBIDDEN') return 403
  return 400
}

export async function startHttpServer(options: ControlPlaneServerOptions = {}): Promise<ControlPlaneServerHandle> {
  const token = options.token || randomBytes(32).toString('hex')
  const allowedOrigins = new Set(options.allowedOrigins || [])
  const maxBodyBytes = options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES
  const injectedHandlers = options.handlers || {}
  const server: Server = createServer(async (request, response) => {
    const origin = headerValue(request.headers.origin)
    try {
      if (!isLoopbackHost(headerValue(request.headers.host))) {
        throw new RequestFailure(400, 'Loopback Host header required')
      }
      if (origin && !allowedOrigins.has(origin)) {
        throw new RequestFailure(403, 'Origin is not allowed')
      }
      if (!hasBearerToken(request, token)) {
        throw new RequestFailure(401, 'Bearer token required')
      }

      const url = new URL(request.url || '/', `http://${LOOPBACK_HOST}`)
      const body = request.method === 'POST' ? parseJsonBody(await readBody(request, maxBodyBytes)) : {}
      const routed = routeRequest(url, request.method || 'GET', body)
      if (!routed) {
        throw new RequestFailure(404, 'Route not found')
      }

      const requestEnvelope = { ...routed, requestId: requestId(request) } as CommandRequest
      const result = await buildDispatcher(injectedHandlers).dispatch(requestEnvelope)
      sendJson(response, resultStatus(result), result, origin)
    } catch (error) {
      if (error instanceof RequestFailure) {
        sendJson(response, error.statusCode, {
          ok: false,
          protocolVersion: PROTOCOL_VERSION,
          requestId: requestId(request),
          error: createSafeError(
            error.statusCode === 401 ? 'UNAUTHORIZED' : error.statusCode === 403 ? 'FORBIDDEN' : 'INVALID_REQUEST',
            error.message,
          ),
        }, origin)
      } else {
        sendJson(response, 500, {
          ok: false,
          protocolVersion: PROTOCOL_VERSION,
          requestId: requestId(request),
          error: createSafeError('INTERNAL', 'Request failed', { retryable: true }),
        }, origin)
      }
    }
  })

  server.requestTimeout = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port || 0, LOOPBACK_HOST, () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()))
    throw new Error('Control plane did not expose a TCP port')
  }

  return {
    host: LOOPBACK_HOST,
    port: address.port,
    token,
    url: `http://${LOOPBACK_HOST}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}
