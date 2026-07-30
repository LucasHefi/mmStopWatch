import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import {
  MCP_PROTOCOL_VERSION,
  createMcpRequestHandler,
  runMcpStdioServer,
  MCP_TOOL_DEFINITIONS,
  MCP_PLANNED_TOOL_DEFINITIONS,
  type McpJsonRpcRequest,
  type McpToolDefinition,
} from '../../tools/mcp-server'
import { startHttpServer } from '../../tools/controlPlaneServer'

function request(method: string, params: Record<string, unknown> = {}, id = 1): McpJsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params }
}

function initializeParams(protocolVersion: string = MCP_PROTOCOL_VERSION): Record<string, unknown> {
  return {
    protocolVersion,
    clientInfo: { name: 'test-client', version: '1.0.0' },
    capabilities: {},
  }
}

async function initialize(handler: (input: unknown) => Promise<unknown>): Promise<void> {
  await handler(request('initialize', initializeParams()))
  await handler({ jsonrpc: '2.0', method: 'notifications/initialized' })
}

describe('mmStopWatch MCP stdio contract', () => {
  it('answers initialize with the negotiated protocol and server capabilities', async () => {
    const handler = createMcpRequestHandler({
      fetchImpl: async () => new Response('{}'),
      token: 'test-token',
      apiBaseUrl: 'http://127.0.0.1:1234',
    })

    await expect(handler(request('initialize', initializeParams()))).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'mmstopwatch', version: '1.7.0-rc.2' },
      },
    })
  })

  it('enforces initialize, initialized notification and duplicate-initialize lifecycle', async () => {
    const handler = createMcpRequestHandler({ token: 'test-token' })

    await expect(handler(request('tools/list'))).resolves.toMatchObject({ error: { code: -32002 } })
    await expect(handler({ jsonrpc: '2.0', method: 'ping' })).resolves.toBeUndefined()
    await expect(handler(request('initialize', initializeParams('unsupported-version')))).resolves.toMatchObject({
      error: { code: -32602 },
    })
    await expect(handler(request('initialize', initializeParams()))).resolves.toMatchObject({ result: { protocolVersion: MCP_PROTOCOL_VERSION } })
    await expect(handler(request('initialize', initializeParams(), 2))).resolves.toMatchObject({ error: { code: -32600 } })
    await expect(handler({ jsonrpc: '2.0', method: 'notifications/initialized' })).resolves.toBeUndefined()
    await expect(handler(request('tools/list', {}, 3))).resolves.toMatchObject({ result: { tools: expect.any(Array) } })
  })

  it('suppresses no-id responses, rejects invalid arguments and closes the session', async () => {
    const handler = createMcpRequestHandler({ token: 'test-token' })
    await initialize(handler)

    await expect(handler({ jsonrpc: '2.0', method: 'tools/list' })).resolves.toBeUndefined()
    await expect(handler({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'unknown', arguments: {} } })).resolves.toMatchObject({ error: { code: -32602 } })
    await expect(handler(request('tools/call', { name: 'mmstopwatch_status', arguments: { extra: true } }, 5))).resolves.toMatchObject({ error: { code: -32602 } })

    handler.close()
    handler.close()
    expect(handler.getState()).toBe('closed')
    await expect(handler(request('ping', {}, 6))).resolves.toMatchObject({ error: { code: -32002 } })
  })

  it('runs stdio EOF cleanup exactly once', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let outputText = ''
    let exitCount = 0
    output.on('data', chunk => { outputText += String(chunk) })
    const running = runMcpStdioServer({
      input,
      output,
      token: 'test-token',
      onExit: () => { exitCount += 1 },
    })
    input.end([
      JSON.stringify(request('initialize', initializeParams())),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify(request('ping', {}, 2)),
    ].join('\n') + '\n')
    await running
    expect(exitCount).toBe(1)
    expect(outputText.split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('advertises only implemented tools and keeps future schemas out of discovery', async () => {
    const handler = createMcpRequestHandler({
      fetchImpl: async () => new Response('{}'),
      token: 'test-token',
      apiBaseUrl: 'http://127.0.0.1:1234',
    })

    await initialize(handler)
    const response = await handler(request('tools/list'))
    expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: MCP_TOOL_DEFINITIONS } })
    expect(MCP_TOOL_DEFINITIONS.map((definition: McpToolDefinition) => definition.name)).toEqual([
      'mmstopwatch_status',
      'mmstopwatch_capabilities',
    ])
    expect(MCP_PLANNED_TOOL_DEFINITIONS.map((definition: McpToolDefinition) => definition.name)).toEqual(expect.arrayContaining([
      'mmstopwatch_timer_list',
      'mmstopwatch_note_get',
      'mmstopwatch_profile_list',
      'mmstopwatch_config_get',
      'mmstopwatch_analytics_stats',
      'mmstopwatch_reports_preview',
      'mmstopwatch_notification_status',
      'mmstopwatch_timer_stop',
      'mmstopwatch_note_delete',
    ]))
    expect(JSON.stringify(MCP_TOOL_DEFINITIONS)).not.toContain('note_delete')
  })

  it('maps a tool call to the authenticated API and returns MCP text content', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers }> = []
    const handler = createMcpRequestHandler({
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), method: init?.method || 'GET', headers: new Headers(init?.headers) })
        return new Response(JSON.stringify({ ok: true, protocolVersion: '1', data: { ready: true } }), {
          headers: { 'content-type': 'application/json' },
        })
      },
      token: 'test-token',
      apiBaseUrl: 'http://127.0.0.1:1234',
    })

    await initialize(handler)
    await expect(handler(request('tools/call', {
      name: 'mmstopwatch_status',
      arguments: {},
    }))).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: '{"ok":true,"protocolVersion":"1","data":{"ready":true}}' }],
        isError: false,
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:1234/api/v1/status')
    expect(calls[0].headers.get('authorization')).toBe('Bearer test-token')
  })

  it('fails closed for unsupported tools and redacts transport details', async () => {
    const handler = createMcpRequestHandler({
      fetchImpl: async () => { throw new Error('connect failed token=redaction-fixture-token') },
      token: 'test-token',
      apiBaseUrl: 'http://127.0.0.1:1234',
      retryCount: 0,
    })

    await initialize(handler)
    await expect(handler(request('tools/call', {
      name: 'mmstopwatch_note_delete',
      arguments: { relativePath: 'private.md' },
    }))).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602 },
    })
    const response = await handler(request('tools/call', { name: 'mmstopwatch_status', arguments: {} }, 2))
    expect(JSON.stringify(response)).not.toContain('redaction-fixture-token')
  })

  it('returns no response for MCP notifications and rejects malformed requests', async () => {
    const handler = createMcpRequestHandler({
      fetchImpl: async () => new Response('{}'),
      token: 'test-token',
      apiBaseUrl: 'http://127.0.0.1:1234',
    })

    await expect(handler({ jsonrpc: '2.0', method: 'notifications/initialized' })).resolves.toBeUndefined()
    await expect(handler({ jsonrpc: '1.0', id: 3, method: 'tools/list' })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32600 },
    })
  })

  it('maps the read-only status tool against the real localhost control plane', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    try {
      const handler = createMcpRequestHandler({ apiBaseUrl: server.url, token: server.token, retryCount: 0 })
      await initialize(handler)
      const result = await handler(request('tools/call', { name: 'mmstopwatch_status', arguments: {} }))
      expect(result).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { isError: false, content: [{ type: 'text' }] },
      })
      const text = (result as { result: { content: [{ text: string }] } }).result.content[0].text
      expect(JSON.parse(text)).toMatchObject({ ok: true, data: { appVersion: '1.7.0-rc.2', ready: true } })
    } finally {
      await server.close()
    }
  })

  it('keeps the stdio stream parseable when launched through npm silently', async () => {
    const isWindows = process.platform === 'win32'
    const executable = isWindows ? (process.env.ComSpec || process.env.COMSPEC || 'cmd.exe') : 'npm'
    const args = isWindows
      ? ['/d', '/s', '/c', 'npm.cmd --silent run mcp:stdio']
      : ['--silent', 'run', 'mcp:stdio']
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: { ...process.env, MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'test-token' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const exit = new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code ?? -1))
    })

    child.stdin.end([
      JSON.stringify(request('initialize', initializeParams())),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify(request('tools/list', {}, 2)),
    ].join('\n') + '\n')

    await expect(exit).resolves.toBe(0)
    const frames = stdout.trim().split('\n').map(line => JSON.parse(line) as { id: number; result?: unknown })
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ id: 1, result: { serverInfo: { name: 'mmstopwatch' } } })
    expect(frames[1]).toMatchObject({ id: 2, result: { tools: expect.any(Array) } })
    expect(stderr).toContain('mmStopWatch MCP stdio adapter')
  })
})
