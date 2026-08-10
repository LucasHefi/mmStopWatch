// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const children: ChildProcess[] = []
const tempDirs: string[] = []

function startControlPlane(vaultPath: string): { child: ChildProcess; ready: Promise<string> } {
  const isWindows = process.platform === 'win32'
  const executable = isWindows ? (process.env.ComSpec || process.env.COMSPEC || 'cmd.exe') : 'npm'
  const args = isWindows
    ? ['/d', '/s', '/c', 'npm.cmd --silent run control-plane:dev']
    : ['--silent', 'run', 'control-plane:dev']
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MMSTOPWATCH_VAULT_PATH: vaultPath,
      MMSTOPWATCH_NICK: 'alice',
      MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'e2e-control-plane-token',
      MMSTOPWATCH_CONTROL_PLANE_PORT: '0',
    },
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.push(child)

  let stderr = ''
  const ready = new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(`control plane readiness timeout: ${stderr}`))
      }
    }, 10_000)
    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
      const match = stderr.match(/mmStopWatch control plane listening on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match && !settled) {
        settled = true
        clearTimeout(timeout)
        resolve(match[1])
      }
    })
    child.once('error', error => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
    })
    child.once('exit', code => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(new Error(`control plane exited before readiness: ${code}; ${stderr}`))
      }
    })
  })

  return { child, ready }
}

async function stopControlPlane(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  } else {
    child.kill()
  }
  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => resolve(), 2_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

function runMcpSession(baseUrl: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const isWindows = process.platform === 'win32'
  const executable = isWindows ? (process.env.ComSpec || process.env.COMSPEC || 'cmd.exe') : 'npm'
  const args = isWindows
    ? ['/d', '/s', '/c', 'npm.cmd --silent run mcp:stdio']
    : ['--silent', 'run', 'mcp:stdio']
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MMSTOPWATCH_CONTROL_PLANE_URL: baseUrl,
      MMSTOPWATCH_CONTROL_PLANE_TOKEN: 'e2e-control-plane-token',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.push(child)

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout += String(chunk) })
  child.stderr?.on('data', chunk => { stderr += String(chunk) })
  const exit = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? -1))
  })
  child.stdin?.end([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'control-plane-e2e-client', version: '1.0.0' },
      capabilities: {},
    } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mmstopwatch_profile_list', arguments: {} } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mmstopwatch_config_get', arguments: {} } }),
    JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'mmstopwatch_notification_status', arguments: {} } }),
  ].join('\n') + '\n')

  return exit.then(code => ({ code, stdout, stderr }))
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopControlPlane))
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('control-plane-http wrapper', () => {
  it('serves safe profile/config/notification reads through the real wrapper process', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-control-plane-e2e-'))
    tempDirs.push(vault)
    await mkdir(join(vault, '.mmST-alice'))
    await writeFile(join(vault, '.mmST-alice', 'config.json'), JSON.stringify({
      activeProfileId: 'vault-a',
      profiles: [{ id: 'vault-a', name: 'Work', nick: 'alice', notesFolder: '/secret/work' }],
      frontmatterKey: 'Timework',
      notifications: { enabled: true, intervalMinutes: 30 },
      timerLimitAlert: { soundEnabled: false, notificationsEnabled: true, showOverlay: true, soundPath: '/secret/sound.wav' },
      token: 'must-not-leak',
    }))

    const { child, ready } = startControlPlane(vault)
    const baseUrl = await ready
    const headers = { Authorization: 'Bearer e2e-control-plane-token' }

    const capabilities = await fetch(`${baseUrl}/api/v1/capabilities`, { headers })
    expect(capabilities.status).toBe(200)
    const capabilityBody = await capabilities.json() as { data: { commands: string[] } }
    expect(capabilityBody.data.commands).toEqual(expect.arrayContaining(['profile_list', 'config_get', 'notification_status']))

    const profiles = await fetch(`${baseUrl}/api/v1/profiles`, { headers })
    expect(profiles.status).toBe(200)
    const profileBody = await profiles.json()
    expect(profileBody).toMatchObject({ ok: true, data: { profiles: [{ id: 'vault-a', name: 'Work', nick: 'alice', active: true }] } })

    const config = await fetch(`${baseUrl}/api/v1/config`, { headers })
    expect(config.status).toBe(200)
    const configBody = await config.json()
    expect(configBody).toMatchObject({ ok: true, data: { config: { activeProfileId: 'vault-a', profileCount: 1, frontmatterKey: 'Timework' } } })

    const notifications = await fetch(`${baseUrl}/api/v1/notifications`, { headers })
    expect(notifications.status).toBe(200)
    const notificationBody = await notifications.json()
    expect(notificationBody).toMatchObject({ ok: true, data: { notifications: { enabled: true, intervalMinutes: 30, soundEnabled: false, notificationsEnabled: true, showOverlay: true } } })

    const serialized = JSON.stringify({ profileBody, configBody, notificationBody })
    expect(serialized).not.toContain('/secret')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('soundPath')

    await stopControlPlane(child)
    await expect(fetch(`${baseUrl}/api/v1/status`)).rejects.toThrow()
  })

  it('serves the same reads through a real MCP stdio process and closes on EOF', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-mcp-e2e-'))
    tempDirs.push(vault)
    await mkdir(join(vault, '.mmST-alice'))
    await writeFile(join(vault, '.mmST-alice', 'config.json'), JSON.stringify({
      activeProfileId: 'vault-a',
      profiles: [{ id: 'vault-a', name: 'Work', nick: 'alice' }],
      frontmatterKey: 'Timework',
      notifications: { enabled: true, intervalMinutes: 30 },
      timerLimitAlert: { soundEnabled: false, notificationsEnabled: true, showOverlay: true },
    }))

    const { ready } = startControlPlane(vault)
    const baseUrl = await ready
    const session = await runMcpSession(baseUrl)
    expect(session.code).toBe(0)
    expect(session.stderr).toContain(`mmStopWatch MCP stdio adapter for ${baseUrl}`)

    const frames = session.stdout.trim().split('\n').map(line => JSON.parse(line) as { id: number; result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean } })
    expect(frames).toHaveLength(5)
    expect(frames.map(frame => frame.id)).toEqual([1, 2, 3, 4, 5])
    expect(frames[1].result?.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'mmstopwatch_profile_list',
      'mmstopwatch_config_get',
      'mmstopwatch_notification_status',
    ]))

    for (const frame of frames.slice(2)) {
      expect(frame.result?.isError).toBe(false)
      const text = frame.result?.content?.[0]?.text
      expect(text).toBeDefined()
      expect(JSON.parse(text || '{}')).toMatchObject({ ok: true })
    }
  })
})
