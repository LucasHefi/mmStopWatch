// @vitest-environment node

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
import { commandHandler } from '../../src/application/dispatcher'

function request(method: string, params: Record<string, unknown> = {}, id: string | number = 1): McpJsonRpcRequest {
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
        serverInfo: { name: 'mmstopwatch', version: '1.7.0-rc.5' },
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

  it('advertises runtime-enabled read tools from control-plane capabilities', async () => {
    const handler = createMcpRequestHandler({
      fetchImpl: async input => {
        if (String(input).endsWith('/api/v1/capabilities')) {
          return new Response(JSON.stringify({
            ok: true,
            data: { commands: ['status', 'capabilities', 'list_notes', 'get_stats', 'preview_report'] },
          }), { headers: { 'content-type': 'application/json' } })
        }
        return new Response('{}')
      },
      token: 'test-token',
      apiBaseUrl: 'http://127.0.0.1:1234',
    })

    await initialize(handler)
    const response = await handler(request('tools/list'))
    const tools = (response as { result: { tools: McpToolDefinition[] } }).result.tools
    expect(tools.map(toolDefinition => toolDefinition.name)).toEqual([
      'mmstopwatch_status',
      'mmstopwatch_capabilities',
      'mmstopwatch_list_notes',
      'mmstopwatch_get_stats',
      'mmstopwatch_preview_report',
      'mmstopwatch_analytics_stats',
      'mmstopwatch_reports_preview',
    ])
    expect(tools.map(toolDefinition => toolDefinition.name)).not.toContain('mmstopwatch_timer_list')
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

  it('propagates a safe deterministic X-Request-Id header derived from the JSON-RPC request id for read-only tools/call', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers }> = []
    const handler = createMcpRequestHandler({
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), method: init?.method || 'GET', headers: new Headers(init?.headers) })
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
      },
      token: 'test-token',
      apiBaseUrl: 'http://127.0.0.1:1234',
    })

    await initialize(handler)

    await handler(request('tools/call', { name: 'mmstopwatch_status', arguments: {} }, 42))
    expect(calls).toHaveLength(1)
    expect(calls[0].headers.get('x-request-id')).toBe('mcp-42')

    await handler(request('tools/call', { name: 'mmstopwatch_capabilities', arguments: {} }, 'my-session'))
    expect(calls).toHaveLength(2)
    expect(calls[0].headers.get('x-request-id')).toBe('mcp-42')
    expect(calls[1].headers.get('x-request-id')).toBe('mcp-my-session')

    await handler(request('tools/call', { name: 'mmstopwatch_status', arguments: {} }, '\x00ctrl\x1f\x7f'))
    expect(calls).toHaveLength(3)
    expect(calls[2].headers.get('x-request-id')).toBe('mcp-ctrl')

    await handler(request('tools/call', { name: 'mmstopwatch_status', arguments: {} }, 'a'.repeat(120)))
    expect(calls).toHaveLength(4)
    const longId = calls[3].headers.get('x-request-id')
    expect(longId).toMatch(/^mcp-/)
    expect(longId!.length).toBeLessThanOrEqual(100)

    await handler(request('tools/call', { name: 'mmstopwatch_timer_stop', arguments: { confirmed: true } }, 99))
    expect(calls).toHaveLength(4)
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
      expect(JSON.parse(text)).toMatchObject({ ok: true, data: { appVersion: '1.7.0-rc.5', ready: true } })
    } finally {
      await server.close()
    }
  })

  it('discovers and calls runtime read tools through the real localhost control plane', async () => {
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        list_notes: commandHandler(async () => ({ notes: [], revision: 'notes-r1' })),
        note_get: commandHandler(async input => ({
          note: { relativePath: input.relativePath, name: 'Work', durationMs: 100, tags: ['dev'], hasFrontmatter: true },
          revision: 'note-r1',
        })),
        timer_list: commandHandler(async () => ({ timers: [], revision: 'timer-r1' })),
        profile_list: commandHandler(async () => ({ profiles: [{ id: 'vault-a', name: 'Work', nick: 'alice', active: true }], activeProfileId: 'vault-a' })),
        config_get: commandHandler(async () => ({ config: { profileCount: 1, frontmatterKey: 'Timework', notificationsEnabled: true } })),
        notification_status: commandHandler(async () => ({ notifications: { enabled: true, intervalMinutes: 30, soundEnabled: false, notificationsEnabled: true, showOverlay: true } })),
        get_stats: commandHandler(async () => ({ totalDurationMs: 3_600_000, sessionCount: 1, noteCount: 1 })),
        preview_report: commandHandler(async () => ({ format: 'markdown' as const, content: '# Report', truncated: false })),
      },
    })
    try {
      const handler = createMcpRequestHandler({ apiBaseUrl: server.url, token: server.token, retryCount: 0 })
      await initialize(handler)

      const discovery = await handler(request('tools/list', {}, 1))
      const tools = (discovery as { result: { tools: McpToolDefinition[] } }).result.tools
      expect(tools.map(toolDefinition => toolDefinition.name)).toEqual([
        'mmstopwatch_status',
        'mmstopwatch_capabilities',
        'mmstopwatch_list_notes',
        'mmstopwatch_get_stats',
        'mmstopwatch_preview_report',
        'mmstopwatch_timer_list',
        'mmstopwatch_note_get',
        'mmstopwatch_profile_list',
        'mmstopwatch_config_get',
        'mmstopwatch_analytics_stats',
        'mmstopwatch_reports_preview',
        'mmstopwatch_notification_status',
      ])

      const stats = await handler(request('tools/call', {
        name: 'mmstopwatch_get_stats',
        arguments: { from: '2026-01-01T00:00:00.000Z' },
      }, 2))
      const statsText = (stats as { result: { content: [{ text: string }] } }).result.content[0].text
      expect(JSON.parse(statsText)).toMatchObject({ ok: true, data: { totalDurationMs: 3_600_000, sessionCount: 1, noteCount: 1 } })

      const note = await handler(request('tools/call', {
        name: 'mmstopwatch_note_get',
        arguments: { relativePath: 'projects/work.md' },
      }, 3))
      const noteText = (note as { result: { content: [{ text: string }] } }).result.content[0].text
      expect(JSON.parse(noteText)).toMatchObject({ ok: true, data: { note: { relativePath: 'projects/work.md', name: 'Work' }, revision: 'note-r1' } })

      const timers = await handler(request('tools/call', {
        name: 'mmstopwatch_timer_list',
        arguments: {},
      }, 4))
      const timersText = (timers as { result: { content: [{ text: string }] } }).result.content[0].text
      expect(JSON.parse(timersText)).toMatchObject({ ok: true, data: { timers: [], revision: 'timer-r1' } })

      const profiles = await handler(request('tools/call', {
        name: 'mmstopwatch_profile_list',
        arguments: {},
      }, 5))
      const profilesText = (profiles as { result: { content: [{ text: string }] } }).result.content[0].text
      expect(JSON.parse(profilesText)).toMatchObject({ ok: true, data: { profiles: [{ id: 'vault-a', name: 'Work', nick: 'alice', active: true }] } })

      const config = await handler(request('tools/call', {
        name: 'mmstopwatch_config_get',
        arguments: {},
      }, 6))
      const configText = (config as { result: { content: [{ text: string }] } }).result.content[0].text
      expect(JSON.parse(configText)).toMatchObject({ ok: true, data: { config: { profileCount: 1, frontmatterKey: 'Timework', notificationsEnabled: true } } })

      const notifications = await handler(request('tools/call', {
        name: 'mmstopwatch_notification_status',
        arguments: {},
      }, 7))
      const notificationsText = (notifications as { result: { content: [{ text: string }] } }).result.content[0].text
      expect(JSON.parse(notificationsText)).toMatchObject({ ok: true, data: { notifications: { enabled: true, intervalMinutes: 30 } } })

      const report = await handler(request('tools/call', {
        name: 'mmstopwatch_preview_report',
        arguments: { format: 'markdown' },
      }, 8))
      const reportText = (report as { result: { content: [{ text: string }] } }).result.content[0].text
      expect(JSON.parse(reportText)).toMatchObject({ ok: true, data: { format: 'markdown', content: '# Report', truncated: false } })
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
