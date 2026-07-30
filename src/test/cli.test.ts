import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { startHttpServer } from '../../tools/controlPlaneServer'

interface CliResult {
  code: number
  stdout: string
  stderr: string
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
    await expect(runCli(['--version'])).resolves.toMatchObject({ code: 0, stdout: '1.7.0-rc.1\n' })
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
        data: { appVersion: '1.7.0-rc.1', ready: true },
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
      expect(result.stdout).toContain('mmStopWatch 1.7.0-rc.1')
      expect(result.stdout).toContain('ready')
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
    const result = await runCli(['timers', 'list'], { MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'test-token' })
    expect(result.code).toBe(6)
    expect(result.stderr).toContain('not available')
  })
})
