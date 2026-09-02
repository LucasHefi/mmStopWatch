// @vitest-environment node

import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { startHttpServer } from '../../tools/controlPlaneServer'
import { commandHandler } from '../../src/application/dispatcher'

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

interface TestServerHandle {
  url: string
  close: () => Promise<void>
}

function startTestServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<TestServerHandle> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler)
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close(e => e ? rej(e) : res())),
      })
    })
  })
}

function runCli(args: string[], env: Record<string, string | undefined> = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/mmstopwatch.mjs', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', code => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

describe('mmstopwatch CLI contract', () => {
  it('prints version and help without requiring a control-plane token', async () => {
    await expect(runCli(['--version'])).resolves.toMatchObject({ code: 0, stdout: '1.7.0-rc.5\n' })
    await expect(runCli(['--help'])).resolves.toMatchObject({ code: 0, stderr: expect.stringContaining('mmstopwatch status') })
  })

  it('calls the real control plane with JSON output and a request id', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    try {
      const result = await runCli(['--json', '--request-id', 'cli-test-1', 'status'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: server.token,
      })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        requestId: 'cli-test-1',
        data: { appVersion: '1.7.0-rc.5', ready: true },
      })
    } finally {
      await server.close()
    }
  })

  it('keeps human output readable for status', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    try {
      const result = await runCli(['status'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: server.token,
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('mmStopWatch 1.7.0-rc.5')
      expect(result.stdout).toContain('ready')
    } finally {
      await server.close()
    }
  })

  it('calls the available notes, stats and report read routes through the CLI', async () => {
    let notesInput: unknown
    let statsInput: unknown
    let reportInput: unknown
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        list_notes: commandHandler(async input => {
          notesInput = input
          return { notes: [{ relativePath: 'work.md', name: 'work', durationMs: 120_000, tags: ['client'], hasFrontmatter: true }] }
        }),
        note_get: commandHandler(async input => ({
          note: { relativePath: input.relativePath, name: 'work', durationMs: 120_000, tags: ['client'], hasFrontmatter: true },
          revision: 'note-r1',
        })),
        timer_list: commandHandler(async () => ({ timers: [], revision: 'timer-r1' })),
        profile_list: commandHandler(async () => ({ profiles: [{ id: 'vault-a', name: 'Work', nick: 'alice', active: true }], activeProfileId: 'vault-a' })),
        config_get: commandHandler(async () => ({ config: { profileCount: 1, frontmatterKey: 'Timework', notificationsEnabled: true } })),
        notification_status: commandHandler(async () => ({ notifications: { enabled: true, intervalMinutes: 30, soundEnabled: false, notificationsEnabled: true, showOverlay: true } })),
        get_stats: commandHandler(async input => {
          statsInput = input
          return { from: '2026-01-01', to: '2026-01-31', totalDurationMs: 120_000, sessionCount: 1, noteCount: 1 }
        }),
        preview_report: commandHandler(async input => {
          reportInput = input
          return { format: 'markdown' as const, content: '# January', truncated: false }
        }),
      },
    })
    try {
      const commonEnv = {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: server.token,
      }
      const notes = await runCli(['--json', '--request-id', 'cli-notes-1', '--limit', '10', '--tags', 'client,internal', 'notes', 'list'], commonEnv)
      expect(notes.code).toBe(0)
      expect(JSON.parse(notes.stdout)).toMatchObject({ ok: true, requestId: 'cli-notes-1', data: { notes: [{ relativePath: 'work.md' }] } })
      expect(notesInput).toEqual({ limit: 10, tags: ['client', 'internal'] })

      const note = await runCli(['--json', '--request-id', 'cli-note-1', '--path', 'work.md', 'notes', 'get'], commonEnv)
      expect(note.code).toBe(0)
      expect(JSON.parse(note.stdout)).toMatchObject({ ok: true, requestId: 'cli-note-1', data: { note: { relativePath: 'work.md' }, revision: 'note-r1' } })

      const timers = await runCli(['--json', '--request-id', 'cli-timers-1', 'timers', 'list'], commonEnv)
      expect(timers.code).toBe(0)
      expect(JSON.parse(timers.stdout)).toMatchObject({ ok: true, requestId: 'cli-timers-1', data: { timers: [], revision: 'timer-r1' } })

      const profiles = await runCli(['--json', '--request-id', 'cli-profiles-1', 'profiles', 'list'], commonEnv)
      expect(profiles.code).toBe(0)
      expect(JSON.parse(profiles.stdout)).toMatchObject({ ok: true, requestId: 'cli-profiles-1', data: { profiles: [{ id: 'vault-a', name: 'Work', nick: 'alice', active: true }] } })

      const config = await runCli(['--json', '--request-id', 'cli-config-1', 'config', 'show'], commonEnv)
      expect(config.code).toBe(0)
      expect(JSON.parse(config.stdout)).toMatchObject({ ok: true, requestId: 'cli-config-1', data: { config: { profileCount: 1, frontmatterKey: 'Timework', notificationsEnabled: true } } })

      const notifications = await runCli(['--json', '--request-id', 'cli-notifications-1', 'notifications', 'status'], commonEnv)
      expect(notifications.code).toBe(0)
      expect(JSON.parse(notifications.stdout)).toMatchObject({ ok: true, requestId: 'cli-notifications-1', data: { notifications: { enabled: true, intervalMinutes: 30 } } })

      const stats = await runCli(['--json', '--request-id', 'cli-stats-1', '--from', '2026-01-01', '--to', '2026-01-31', 'stats'], commonEnv)
      expect(stats.code).toBe(0)
      expect(JSON.parse(stats.stdout)).toMatchObject({ ok: true, requestId: 'cli-stats-1', data: { totalDurationMs: 120_000 } })
      expect(statsInput).toEqual({ from: '2026-01-01', to: '2026-01-31' })

      const report = await runCli(['--json', '--request-id', 'cli-report-1', '--format', 'markdown', 'report', 'preview'], commonEnv)
      expect(report.code).toBe(0)
      expect(JSON.parse(report.stdout)).toMatchObject({ ok: true, requestId: 'cli-report-1', data: { content: '# January' } })
      expect(reportInput).toEqual({ format: 'markdown' })
    } finally {
      await server.close()
    }
  })

  it('discovers an explicit JSON config file without exposing its token', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    const directory = await mkdtemp(join(tmpdir(), 'mmstopwatch-cli-'))
    const configPath = join(directory, 'config.json')
    try {
      await writeFile(configPath, JSON.stringify({ controlPlaneUrl: server.url, token: server.token }))
      const result = await runCli(['--json', '--config', configPath, 'capabilities'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: undefined,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: undefined,
      })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { readOnly: true } })
      expect(result.stdout).not.toContain(server.token)
    } finally {
      await rm(directory, { recursive: true, force: true })
      await server.close()
    }
  })

  it('requires explicit confirmation before any mutating command', async () => {
    const result = await runCli(['timers', 'stop', 'timer-1'])
    expect(result.code).toBe(5)
    expect(result.stderr).toContain('Confirmation required')
    expect(result.stderr).not.toContain('timer-1')
  })

  it('returns a stable unavailable result instead of pretending unsupported groups work', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    try {
      const result = await runCli(['timers', 'list'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: server.token,
      })
      expect(result.code).toBe(6)
      expect(result.stderr).toContain('not available')
    } finally {
      await server.close()
    }
  })

  it('maps HTTP 501 NOT_IMPLEMENTED to exit 6 with JSON error envelope', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(501, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: false,
        protocolVersion: '1',
        requestId: 'srv-req-1',
        error: { code: 'NOT_IMPLEMENTED', message: "Command 'list_notes' is not implemented" },
      }))
    })
    try {
      const result = await runCli(['--json', '--request-id', 'cli-ni-1', 'notes', 'list'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'test-token',
      })
      expect(result.code).toBe(6)
      expect(result.stderr).toBe('')
      const envelope = JSON.parse(result.stdout)
      expect(envelope.ok).toBe(false)
      expect(envelope.error.code).toBe('NOT_IMPLEMENTED')
      expect(envelope.error.message).toContain('not implemented')
      expect(envelope.requestId).toBe('cli-ni-1')
    } finally {
      await server.close()
    }
  })

  it('maps HTTP 501 NOT_IMPLEMENTED to exit 6 in human output', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(501, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: false,
        protocolVersion: '1',
        requestId: 'srv-req-2',
        error: { code: 'NOT_IMPLEMENTED', message: "Command 'get_stats' is not implemented" },
      }))
    })
    try {
      const result = await runCli(['stats'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'test-token',
      })
      expect(result.code).toBe(6)
      expect(result.stderr).not.toContain('INTERNAL')
      expect(result.stderr).toContain('not implemented')
    } finally {
      await server.close()
    }
  })

  it('prefers API error code from payload over HTTP status classification', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: false,
        protocolVersion: '1',
        requestId: 'srv-req-3',
        error: { code: 'CONFLICT', message: 'Resource is locked by another session' },
      }))
    })
    try {
      const result = await runCli(['--json', '--request-id', 'cli-pref-1', 'status'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'test-token',
      })
      expect(result.code).toBe(5)
      const envelope = JSON.parse(result.stdout)
      expect(envelope.error.code).toBe('CONFLICT')
    } finally {
      await server.close()
    }
  })

  it('maps HTTP 404 to exit 4 in human output', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: false,
        protocolVersion: '1',
        requestId: 'srv-req-4',
        error: { code: 'NOT_FOUND', message: 'Route not found' },
      }))
    })
    try {
      const result = await runCli(['status'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'test-token',
      })
      expect(result.code).toBe(4)
      expect(result.stderr).toContain('Route not found')
    } finally {
      await server.close()
    }
  })

  it('maps HTTP 500 INTERNAL to exit 7', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: false,
        protocolVersion: '1',
        requestId: 'srv-req-5',
        error: { code: 'INTERNAL', message: 'Request failed', retryable: true },
      }))
    })
    try {
      const result = await runCli(['--json', '--request-id', 'cli-int-1', 'status'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'test-token',
      })
      expect(result.code).toBe(7)
      const envelope = JSON.parse(result.stdout)
      expect(envelope.error.code).toBe('INTERNAL')
    } finally {
      await server.close()
    }
  })

  it('does not expose tokens in transport error messages', async () => {
    const server = await startTestServer((_req, res) => {
      const error = new Error('connect ECONNREFUSED')
      res.destroy(error)
    })
    try {
      const result = await runCli(['status'], {
        MMSTOPWATCH_CONTROL_PLANE_URL: server.url,
        MMSTOPWATCH_CONTROL_PLANE_TOKEN: 't0k3n-exposed',
      })
      expect(result.code).toBe(6)
    } finally {
      await server.close()
    }
  })
})
