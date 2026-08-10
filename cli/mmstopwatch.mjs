#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const VERSION = packageJson.version
const DEFAULT_API_URL = 'http://127.0.0.1:9376'
const DEFAULT_TIMEOUT_MS = 5_000

const EXIT_CODES = Object.freeze({
  OK: 0,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  CONFLICT: 5,
  UNAVAILABLE: 6,
  INTERNAL: 7,
})

const ROUTES = Object.freeze({
  'status': { method: 'GET', path: '/api/v1/status' },
  'capabilities': { method: 'GET', path: '/api/v1/capabilities' },
  'notes list': { method: 'GET', path: '/api/v1/notes' },
  'notes get': { method: 'GET', path: '/api/v1/notes' },
  'stats': { method: 'GET', path: '/api/v1/stats' },
  'report preview': { method: 'POST', path: '/api/v1/reports/preview' },
})

const SAFE_ERROR_CODES = new Set([
  'INVALID_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
  'CONFLICT', 'NOT_IMPLEMENTED', 'INTERNAL',
])

const MUTATING_COMMANDS = new Set([
  'timers start', 'timers pause', 'timers resume', 'timers stop', 'timers discard',
  'notes save', 'notes update', 'notes delete',
  'profiles create', 'profiles switch', 'profiles delete',
  'config set',
])

class CliError extends Error {
  constructor(code, message, exitCode = EXIT_CODES.USAGE) {
    super(message)
    this.code = code
    this.exitCode = exitCode
  }
}

function usage() {
  return `mmstopwatch ${VERSION}

Usage:
  mmstopwatch status
  mmstopwatch capabilities
  mmstopwatch notes list
  mmstopwatch notes get --path PATH
  mmstopwatch stats
  mmstopwatch report preview
  mmstopwatch timers <list|start|pause|resume|stop|discard>
  mmstopwatch profiles <list|show|create|switch|delete>
  mmstopwatch config <show|set>

Global options:
  --json                 Print a stable JSON envelope
  --yes                  Confirm a mutating command (still subject to API policy)
  --confirm CONFIRM      Equivalent explicit confirmation for automation
  --timeout MS           Request timeout, 100..60000 (default: 5000)
  --request-id ID        Use a caller-supplied request id
  --url URL              Override the local control-plane URL
  --config PATH          Read CLI config from an explicit JSON file
  --version              Print the CLI version
  --help                 Show this help

Environment:
  MMSTOPWATCH_CONTROL_PLANE_URL    Local API base URL
  MMSTOPWATCH_CONTROL_PLANE_TOKEN  Bearer token (never pass secrets on argv)
  MMSTOPWATCH_CONFIG               Explicit JSON config path

Exit codes:
  0 success, 2 usage, 3 auth/permission, 4 not found,
  5 conflict/confirmation, 6 unavailable/not implemented, 7 internal
`
}

function parseArgs(argv) {
  const options = {
    json: false,
    confirmed: false,
    timeout: DEFAULT_TIMEOUT_MS,
    requestId: undefined,
    url: undefined,
    configPath: undefined,
    values: {},
  }
  const command = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--yes') options.confirmed = true
    else if (arg === '--confirm') {
      const value = argv[++index]
      if (value !== 'CONFIRM') throw new CliError('INVALID_REQUEST', '--confirm requires the literal CONFIRM')
      options.confirmed = true
    } else if (arg === '--timeout') {
      const value = Number(argv[++index])
      if (!Number.isInteger(value) || value < 100 || value > 60_000) throw new CliError('INVALID_REQUEST', '--timeout must be an integer between 100 and 60000')
      options.timeout = value
    } else if (arg === '--request-id') {
      const value = argv[++index]
      if (!value || value.length > 100) throw new CliError('INVALID_REQUEST', '--request-id must be 1..100 characters')
      options.requestId = value
    } else if (arg === '--url') {
      const value = argv[++index]
      if (!value) throw new CliError('INVALID_REQUEST', '--url requires a value')
      options.url = value
    } else if (arg === '--config') {
      const value = argv[++index]
      if (!value) throw new CliError('INVALID_REQUEST', '--config requires a path')
      options.configPath = value
    } else if (arg === '--from' || arg === '--to' || arg === '--limit' || arg === '--cursor' || arg === '--query' || arg === '--format' || arg === '--tags' || arg === '--path') {
      const key = arg.slice(2)
      const value = argv[++index]
      if (!value) throw new CliError('INVALID_REQUEST', `${arg} requires a value`)
      options.values[key] = value
    } else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--version' || arg === '-v') options.version = true
    else if (arg.startsWith('-')) throw new CliError('INVALID_REQUEST', `Unknown option: ${arg}`)
    else command.push(arg)
  }

  return { options, command }
}

async function existingFile(path) {
  try {
    await access(path)
    return path
  } catch {
    return undefined
  }
}

function defaultConfigPaths() {
  const paths = []
  if (process.env.APPDATA) paths.push(join(process.env.APPDATA, 'mmstopwatch', 'config.json'))
  if (process.env.LOCALAPPDATA) paths.push(join(process.env.LOCALAPPDATA, 'mmstopwatch', 'config.json'))
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  paths.push(join(configHome, 'mmstopwatch', 'config.json'))
  return [...new Set(paths)]
}

async function loadConfig(path) {
  const candidates = path ? [path] : process.env.MMSTOPWATCH_CONFIG ? [process.env.MMSTOPWATCH_CONFIG] : defaultConfigPaths()
  for (const candidate of candidates) {
    const found = await existingFile(candidate)
    if (!found) continue
    try {
      const parsed = JSON.parse(await readFile(found, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required')
      return parsed
    } catch {
      throw new CliError('INVALID_CONFIG', `Invalid CLI config: ${dirname(candidate)}/${candidate.split('/').pop()}`)
    }
  }
  return {}
}

function buildError(requestId, code, message) {
  return { ok: false, protocolVersion: '1', requestId, error: { code, message } }
}

function errorFromHttpStatus(status) {
  if (status === 401) return ['UNAUTHORIZED', 'auth']
  if (status === 403) return ['FORBIDDEN', 'auth']
  if (status === 404) return ['NOT_FOUND', 'notFound']
  if (status === 409) return ['CONFLICT', 'conflict']
  if (status === 501) return ['NOT_IMPLEMENTED', 'unavailable']
  if (status >= 500) return ['INTERNAL', 'internal']
  return ['INVALID_REQUEST', 'usage']
}

function exitCodeForError(code) {
  if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return EXIT_CODES.AUTH
  if (code === 'NOT_FOUND') return EXIT_CODES.NOT_FOUND
  if (code === 'CONFLICT' || code === 'CONFIRMATION_REQUIRED') return EXIT_CODES.CONFLICT
  if (code === 'NOT_IMPLEMENTED' || code === 'CONTROL_PLANE_UNAVAILABLE' || code === 'TIMEOUT') return EXIT_CODES.UNAVAILABLE
  if (code === 'INTERNAL') return EXIT_CODES.INTERNAL
  return EXIT_CODES.USAGE
}

function redactMessage(error) {
  return String(error)
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/(token|secret|password|api[_-]?key)=[^\s&]+/gi, '$1=[REDACTED]')
}

function makeUrl(base, path, values) {
  const url = new URL(path, `${base.replace(/\/$/, '')}/`)
  if (path === '/api/v1/notes') {
    if (values.path !== undefined) url.searchParams.set('path', values.path)
    for (const key of ['limit', 'cursor', 'query']) if (values[key] !== undefined) url.searchParams.set(key, values[key])
    if (values.tags) url.searchParams.set('tags', values.tags)
  }
  if (path === '/api/v1/stats') for (const key of ['from', 'to']) if (values[key] !== undefined) url.searchParams.set(key, values[key])
  return url
}

async function callApi(route, config, options, requestId) {
  if (!config.token || typeof config.token !== 'string' || !config.token.trim()) {
    throw new CliError('UNAUTHORIZED', 'Control-plane token is required', EXIT_CODES.AUTH)
  }
  const url = makeUrl(config.url, route.path, options.values)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeout)
  const init = {
    method: route.method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
      'X-Request-Id': requestId,
      ...(route.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: controller.signal,
  }
  if (route.method === 'POST') init.body = JSON.stringify({
    from: typeof options.values.from === 'string' ? options.values.from : undefined,
    to: typeof options.values.to === 'string' ? options.values.to : undefined,
    format: options.values.format === 'markdown' ? 'markdown' : undefined,
  })

  try {
    let response
    try {
      response = await fetch(url, init)
    } catch (error) {
      if (error?.name === 'AbortError') throw new CliError('TIMEOUT', 'Control-plane request timed out', EXIT_CODES.UNAVAILABLE)
      throw new CliError('CONTROL_PLANE_UNAVAILABLE', `Control-plane request failed: ${redactMessage(error?.message || 'transport error')}`, EXIT_CODES.UNAVAILABLE)
    }
    const raw = await response.text()
    let payload
    try {
      payload = raw ? JSON.parse(raw) : buildError(requestId, 'INTERNAL', 'Control plane returned an empty response')
    } catch {
      throw new CliError('INTERNAL', 'Control plane returned invalid JSON', EXIT_CODES.INTERNAL)
    }
    if (!response.ok) {
      const apiCode = payload?.error?.code
      const code = apiCode && SAFE_ERROR_CODES.has(apiCode) ? apiCode : errorFromHttpStatus(response.status)[0]
      const message = payload?.error?.message || `Control plane returned HTTP ${response.status}`
      throw new CliError(code, message, exitCodeForError(code))
    }
    return payload
  } finally {
    clearTimeout(timeout)
  }
}

function commandKey(command) {
  if (command[0] === 'notes' || command[0] === 'report' || command[0] === 'timers' || command[0] === 'profiles' || command[0] === 'config') return command.slice(0, 2).join(' ')
  return command[0] || ''
}

function humanOutput(payload) {
  const data = payload?.data
  if (data?.appVersion) return `mmStopWatch ${data.appVersion} — ${data.ready ? 'ready' : 'not ready'} (protocol ${data.protocolVersion})`
  if (data?.commands) return [`Protocol ${data.protocolVersion}`, `Read-only: ${data.readOnly ? 'yes' : 'no'}`, `Commands: ${data.commands.join(', ')}`].join('\n')
  return JSON.stringify(data ?? payload)
}

function printError(error, requestId, json) {
  const envelope = buildError(requestId, error.code || 'INTERNAL', error.message || 'Command failed')
  if (json) process.stdout.write(`${JSON.stringify(envelope)}\n`)
  else process.stderr.write(`${envelope.error.message}\n`)
  return error.exitCode ?? exitCodeForError(envelope.error.code)
}

async function main(argv) {
  const { options, command } = parseArgs(argv)
  if (options.version) {
    process.stdout.write(`${VERSION}\n`)
    return EXIT_CODES.OK
  }
  if (options.help || command.length === 0) {
    process.stderr.write(usage())
    return options.help ? EXIT_CODES.OK : EXIT_CODES.USAGE
  }

  const requestId = options.requestId || randomUUID()
  const key = commandKey(command)
  if (MUTATING_COMMANDS.has(key) && !options.confirmed) {
    throw new CliError('CONFIRMATION_REQUIRED', 'Confirmation required for mutating commands; use --yes or --confirm CONFIRM', EXIT_CODES.CONFLICT)
  }
  const route = ROUTES[key]
  if (!route) throw new CliError('NOT_IMPLEMENTED', `Command group '${key || command[0]}' is not available in the current read-only control plane`, EXIT_CODES.UNAVAILABLE)

  const fileConfig = await loadConfig(options.configPath)
  const config = {
    url: options.url || process.env.MMSTOPWATCH_CONTROL_PLANE_URL || fileConfig.controlPlaneUrl || DEFAULT_API_URL,
    token: process.env.MMSTOPWATCH_CONTROL_PLANE_TOKEN || fileConfig.token,
  }
  try {
    const payload = await callApi(route, config, options, requestId)
    if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`)
    else process.stdout.write(`${humanOutput(payload)}\n`)
    return payload?.ok === false ? exitCodeForError(payload.error?.code) : EXIT_CODES.OK
  } catch (error) {
    return printError(error instanceof CliError ? error : new CliError('INTERNAL', 'CLI failed', EXIT_CODES.INTERNAL), requestId, options.json)
  }
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  process.exitCode = printError(error instanceof CliError ? error : new CliError('INTERNAL', 'CLI failed', EXIT_CODES.INTERNAL), randomUUID(), process.argv.includes('--json'))
}
