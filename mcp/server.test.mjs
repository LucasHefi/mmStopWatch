import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { createHandler, PROTOCOL_VERSION, run } from './server.mjs'

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: 'test', version: '1' }, capabilities: {} } }
const ready = async handler => { await handler(init); await handler({ jsonrpc: '2.0', method: 'notifications/initialized' }) }

test('id-less initialize stays silent and cannot unlock the session', async () => {
  const handler = createHandler({ sessionToken: 'test-token' })
  const idlessInit = { ...init }
  delete idlessInit.id
  assert.equal(await handler(idlessInit), undefined)
  assert.equal(await handler({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
  assert.equal((await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).error.code, -32002)
})

test('MCP lifecycle gates requests, suppresses notifications, and exposes only real tools', async () => {
  const handler = createHandler({ sessionToken: 'test-token' })
  assert.equal((await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).error.code, -32002)
  assert.deepEqual(await handler(init), { jsonrpc: '2.0', id: 1, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'mmstopwatch', version: '1.7.6' } } })
  assert.equal(await handler({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
  assert.equal((await handler({ ...init, id: 3 })).error.code, -32600)
  const list = await handler({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} })
  assert.deepEqual(list.result.tools.map(tool => tool.name), ['mmstopwatch_status', 'mmstopwatch_capabilities', 'mmstopwatch_notes_list', 'mmstopwatch_note_get', 'mmstopwatch_timers_list', 'mmstopwatch_profiles_list', 'mmstopwatch_config', 'mmstopwatch_notifications', 'mmstopwatch_stats', 'mmstopwatch_report_preview', 'mmstopwatch_timer_mutate', 'mmstopwatch_note_update_duration'])
  assert.equal(await handler({ jsonrpc: '2.0', method: 'ping' }), undefined)
  assert.equal((await handler({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'mmstopwatch_status', arguments: {} } })).result.isError, true)
})

test('negotiates the Hermes initialize protocol version while rejecting unsupported versions', async () => {
  const hermesInit = { ...init, params: { ...init.params, protocolVersion: '2025-11-25' } }
  const handler = createHandler({ sessionToken: 'test-token' })
  assert.equal((await handler(hermesInit)).result.protocolVersion, PROTOCOL_VERSION)

  const unsupported = createHandler({ sessionToken: 'test-token' })
  assert.equal((await unsupported({ ...init, params: { ...init.params, protocolVersion: '2099-01-01' } })).error.code, -32602)
})

test('malformed requests, auth failures, and oversized frames fail closed', async () => {
  const handler = createHandler({ sessionToken: '' })
  assert.equal((await handler({ jsonrpc: '1.0', id: 1, method: 'ping' })).error.code, -32600)
  await ready(handler)
  assert.equal((await handler({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'unknown', arguments: {} } })).error.code, -32602)
  assert.equal((await handler({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mmstopwatch_status', arguments: {} } })).result.isError, true)
  const input = new PassThrough(); const output = new PassThrough(); let text = ''
  output.on('data', chunk => { text += chunk })
  const running = run({ input, output, diagnostic: new PassThrough() })
  input.end(`${'x'.repeat(1024 * 1024 + 1)}\n`)
  await running
  assert.equal(JSON.parse(text).error.message, 'Frame exceeds 1 MiB limit')
})

test('real child process keeps stdout JSON-RPC-pure and exits cleanly at EOF', async () => {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('.', import.meta.url), env: { ...process.env, MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'smoke-token' }, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdin.end(`${JSON.stringify(init)}\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mmstopwatch_status', arguments: {} } })}\n{bad}\n`)
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
  const frames = stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(frames.map(frame => frame.id), [1, 2, 3, null])
  assert.match(stderr, /MCP stdio adapter/)
  assert.doesNotMatch(stdout, /MCP stdio adapter/)
})

test('invalid params never throw and malformed EOF becomes a parse error', async () => {
  const handler = createHandler({ sessionToken: 'test-token' })
  assert.equal(await handler({ jsonrpc: '2.0', method: 'notifications/initialized', params: null }), undefined)
  assert.equal((await handler({ jsonrpc: '2.0', id: 9, method: 'initialize', params: null })).error.code, -32600)
  await ready(handler)
  assert.equal((await handler({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: null })).error.code, -32600)
  const input = new PassThrough(); const output = new PassThrough(); let text = ''
  output.on('data', chunk => { text += chunk })
  const running = run({ input, output, diagnostic: new PassThrough() })
  input.end('{bad')
  await running
  assert.equal(JSON.parse(text).error.code, -32700)
})

test('invalid UTF-8 emits a parse error and no-id invalid requests stay silent', async () => {
  const input = new PassThrough(); const output = new PassThrough(); let text = ''
  output.on('data', chunk => { text += chunk })
  const running = run({ input, output, diagnostic: new PassThrough() })
  input.end(Buffer.from([0x7b, 0x22, 0xff, 0x7d, 0x0a]))
  await running
  assert.equal(JSON.parse(text).error.code, -32700)
  const handler = createHandler({ sessionToken: 'test-token' })
  assert.equal(await handler({ jsonrpc: '2.0', method: 'notifications/initialized', params: null }), undefined)
})

test('MCP tool arguments are validated before service invocation', async () => {
  let calls = 0
  const service = new Proxy({}, { get: () => async () => { calls += 1; return { ok: true, data: {} } } })
  const handler = createHandler({ sessionToken: 'test-token', service })
  await ready(handler)
  const invalid = [
    { name: 'mmstopwatch_note_get', arguments: { path: 7 } },
    { name: 'mmstopwatch_timer_mutate', arguments: { operation: 'unknown', confirmed: true, expectedRevision: 'r' } },
    { name: 'mmstopwatch_timer_mutate', arguments: { operation: 'start', confirmed: true, expectedRevision: 'r' } },
    { name: 'mmstopwatch_note_update_duration', arguments: { path: 'x.md', durationMs: '1', confirmed: true, expectedRevision: 'r' } },
    { name: 'mmstopwatch_status', arguments: { unexpected: true } },
  ]
  for (const [index, params] of invalid.entries()) assert.equal((await handler({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params })).error.code, -32602)
  assert.equal(calls, 0)
})
