// @vitest-environment node

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { request as httpRequest } from 'node:http'
import { commandHandler } from '../../src/application/dispatcher'
import { startHttpServer, type ControlPlaneServerHandle } from '../../tools/controlPlaneServer'
import { VaultAdapter } from '../../tools/vaultAdapter'

const servers: ControlPlaneServerHandle[] = []
const tempDirs: string[] = []

function requestStatus(server: ControlPlaneServerHandle, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: server.host,
      port: server.port,
      path: '/api/v1/status',
      headers,
    }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode || 0))
    })
    request.on('error', reject)
    request.end()
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
  await Promise.all(tempDirs.splice(0).map(d => rm(d, { recursive: true, force: true }).catch(() => {})))
})

describe('localhost control plane HTTP boundary', () => {
  it('requires a bearer token and serves versioned status', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    servers.push(server)

    const unauthorized = await fetch(`${server.url}/api/v1/status`)
    expect(unauthorized.status).toBe(401)

    const response = await fetch(`${server.url}/api/v1/status`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      protocolVersion: '1',
      data: { appVersion: '1.7.0-rc.5', ready: true },
    })
  })

  it('exposes read-only capabilities and keeps unimplemented mutations absent', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const capabilities = await fetch(`${server.url}/api/v1/capabilities`, { headers })
    expect(capabilities.status).toBe(200)
    await expect(capabilities.json()).resolves.toMatchObject({
      ok: true,
      data: { readOnly: true, commands: ['status', 'capabilities'] },
    })

    const notes = await fetch(`${server.url}/api/v1/notes`, { headers })
    expect(notes.status).toBe(501)
    await expect(notes.json()).resolves.toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } })
  })

  it('rejects oversized request bodies before command dispatch and preserves request correlation', async () => {
    const server = await startHttpServer({ token: 'test-token', maxBodyBytes: 16 })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}`, 'X-Request-Id': 'boundary-test-1' }

    const status = await fetch(`${server.url}/api/v1/status`, { headers })
    expect(status.headers.get('cache-control')).toBe('no-store')
    await expect(status.json()).resolves.toMatchObject({ requestId: 'boundary-test-1' })

    const oversized = await fetch(`${server.url}/api/v1/reports/preview`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '2026-01-01', to: '2026-12-31', format: 'markdown' }),
    })
    expect(oversized.status).toBe(413)
    await expect(oversized.json()).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })

  it('rejects non-loopback hosts and unapproved origins', async () => {
    const server = await startHttpServer({ token: 'test-token', allowedOrigins: ['http://tauri.localhost'] })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const badHost = await requestStatus(server, { ...headers, Host: 'evil.example' })
    expect(badHost).toBe(400)

    const badOrigin = await fetch(`${server.url}/api/v1/status`, { headers: { ...headers, Origin: 'http://evil.example' } })
    expect(badOrigin.status).toBe(403)
  })

  it('serves injected list_notes handler and advertises it in capabilities', async () => {
    const mockNotes = [
      { relativePath: 'test.md', name: 'Test', durationMs: 100, tags: [], hasFrontmatter: false },
    ]
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        list_notes: commandHandler(async () => ({
          notes: mockNotes,
        })),
      },
    })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const capabilities = await fetch(`${server.url}/api/v1/capabilities`, { headers })
    expect(capabilities.status).toBe(200)
    const capBody = await capabilities.json()
    expect(capBody).toMatchObject({
      ok: true,
      data: { readOnly: true, commands: expect.arrayContaining(['list_notes']) },
    })
    expect(capBody.data.commands).not.toContain('timer_start')

    const notes = await fetch(`${server.url}/api/v1/notes`, { headers })
    expect(notes.status).toBe(200)
    await expect(notes.json()).resolves.toMatchObject({
      ok: true,
      data: { notes: mockNotes },
    })
  })

  it('serves injected note_get handler through a validated path query', async () => {
    let receivedPath = ''
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        note_get: commandHandler(async input => {
          receivedPath = input.relativePath
          return {
            note: { relativePath: input.relativePath, name: 'Work', durationMs: 100, tags: ['dev'], hasFrontmatter: true },
            revision: 'note-r1',
          }
        }),
      },
    })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const response = await fetch(`${server.url}/api/v1/notes?path=${encodeURIComponent('projects/work.md')}`, { headers })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { note: { relativePath: 'projects/work.md', name: 'Work' }, revision: 'note-r1' },
    })
    expect(receivedPath).toBe('projects/work.md')

    const unsafe = await fetch(`${server.url}/api/v1/notes?path=${encodeURIComponent('../escape.md')}`, { headers })
    expect(unsafe.status).toBe(400)
    await expect(unsafe.json()).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })

  it('serves an injected read-only timer_list handler and advertises it', async () => {
    const timers = [{ id: 'timer-1', notePath: 'projects/work.md', name: 'Work', status: 'RUNNING' as const, elapsedMs: 100, baseElapsedMs: 100, pausedOffsetMs: 0 }]
    const server = await startHttpServer({
      token: 'test-token',
      handlers: { timer_list: commandHandler(async () => ({ timers, revision: 'timer-r1' })) },
    })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const capabilities = await fetch(`${server.url}/api/v1/capabilities`, { headers })
    expect(capabilities.status).toBe(200)
    await expect(capabilities.json()).resolves.toMatchObject({ ok: true, data: { commands: expect.arrayContaining(['timer_list']) } })

    const response = await fetch(`${server.url}/api/v1/timers`, { headers })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { timers, revision: 'timer-r1' } })
  })

  it('serves an injected read-only profile_list handler without exposing vault paths', async () => {
    const profiles = [{ id: 'vault-a', name: 'Work', nick: 'alice', active: true }]
    const server = await startHttpServer({
      token: 'test-token',
      handlers: { profile_list: commandHandler(async () => ({ profiles, activeProfileId: 'vault-a' })) },
    })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const capabilities = await fetch(`${server.url}/api/v1/capabilities`, { headers })
    await expect(capabilities.json()).resolves.toMatchObject({ ok: true, data: { commands: expect.arrayContaining(['profile_list']) } })

    const response = await fetch(`${server.url}/api/v1/profiles`, { headers })
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: { profiles: Array<Record<string, unknown>> } }
    expect(payload.data.profiles).toEqual(profiles)
    expect(JSON.stringify(payload)).not.toContain('notesFolder')
  })

  it('serves an injected read-only config_get handler without exposing secrets', async () => {
    const config = { profileCount: 1, frontmatterKey: 'Timework', notificationsEnabled: true }
    const server = await startHttpServer({
      token: 'test-token',
      handlers: { config_get: commandHandler(async () => ({ config })) },
    })
    servers.push(server)
    const response = await fetch(`${server.url}/api/v1/config`, { headers: { Authorization: `Bearer ${server.token}` } })
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: { config: Record<string, unknown> } }
    expect(payload.data.config).toEqual(config)
    expect(JSON.stringify(payload)).not.toContain('notesFolder')
    expect(JSON.stringify(payload)).not.toContain('token')
  })

  it('serves an injected read-only notification_status handler without exposing sound paths', async () => {
    const notifications = { enabled: true, intervalMinutes: 30, soundEnabled: false, notificationsEnabled: true, showOverlay: true }
    const server = await startHttpServer({
      token: 'test-token',
      handlers: { notification_status: commandHandler(async () => ({ notifications })) },
    })
    servers.push(server)
    const response = await fetch(`${server.url}/api/v1/notifications`, { headers: { Authorization: `Bearer ${server.token}` } })
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: { notifications: Record<string, unknown> } }
    expect(payload.data.notifications).toEqual(notifications)
    expect(JSON.stringify(payload)).not.toContain('soundPath')
  })

  it('does not advertise or dispatch injected mutating handlers', async () => {
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        timer_start: commandHandler(async () => ({
          timer: { id: 't1', notePath: 'test.md', name: 'Test', status: 'RUNNING' as const, elapsedMs: 0, baseElapsedMs: 0, pausedOffsetMs: 0 },
          revision: 'r1',
        })),
      },
    })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const capabilities = await fetch(`${server.url}/api/v1/capabilities`, { headers })
    expect(capabilities.status).toBe(200)
    const capBody = await capabilities.json()
    expect(capBody).toMatchObject({
      ok: true,
      data: { readOnly: true },
    })
    expect(capBody.data.commands).not.toContain('timer_start')
    expect(capBody.data.commands).toEqual(['status', 'capabilities'])
  })

  it('serves real vault notes with query and tag filtering via HTTP GET /api/v1/notes', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mmst-test-vault-'))
    tempDirs.push(vault)

    await mkdir(join(vault, 'src'), { recursive: true })
    await writeFile(join(vault, 'src', 'work.md'), '---\nTimework: 01:30:00\ntags: [dev, billing]\n---\n\nWork log')
    await writeFile(join(vault, 'src', 'notes.md'), '---\nTimework: 00:15:00\ntags: [dev]\n---\n\nDev notes')
    await writeFile(join(vault, 'readme.md'), '# No frontmatter\nJust a readme')
    await mkdir(join(vault, '.hidden'))
    await writeFile(join(vault, '.hidden', 'secret.md'), '---\nTimework: 99:00:00\n---\n\nsecret')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        list_notes: commandHandler(async (input) => adapter.listNotes(input)),
      },
    })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const caps = await fetch(`${server.url}/api/v1/capabilities`, { headers })
    expect(caps.status).toBe(200)
    const capBody = await caps.json()
    expect(capBody.data.commands).toContain('list_notes')

    const res = await fetch(`${server.url}/api/v1/notes`, { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.notes).toHaveLength(3)

    const work = body.data.notes.find((n: { name: string }) => n.name === 'work')
    expect(work).toBeDefined()
    expect(work.durationMs).toBe(90 * 60_000)
    expect(work.tags).toEqual(['dev', 'billing'])
    expect(work.hasFrontmatter).toBe(true)

    const readme = body.data.notes.find((n: { name: string }) => n.name === 'readme')
    expect(readme).toBeDefined()
    expect(readme.durationMs).toBe(0)
    expect(readme.hasFrontmatter).toBe(false)

    const tagFilter = await fetch(`${server.url}/api/v1/notes?tags=dev,billing`, { headers })
    expect(tagFilter.status).toBe(200)
    const tagBody = await tagFilter.json()
    expect(tagBody.data.notes).toHaveLength(1)
    expect(tagBody.data.notes[0].name).toBe('work')

    const queryFilter = await fetch(`${server.url}/api/v1/notes?query=work`, { headers })
    expect(queryFilter.status).toBe(200)
    const queryBody = await queryFilter.json()
    expect(queryBody.data.notes).toHaveLength(1)
    expect(queryBody.data.notes[0].name).toBe('work')

    const srcQuery = await fetch(`${server.url}/api/v1/notes?query=src`, { headers })
    expect(srcQuery.status).toBe(200)
    const srcBody = await srcQuery.json()
    expect(srcBody.data.notes).toHaveLength(2)

    const bodyStr = JSON.stringify(body)
    expect(bodyStr).not.toContain(vault)
  })

  it('returns safe error envelope for invalid cursor instead of unrelated notes', async () => {
    const mockNotes = [
      { relativePath: 'test.md', name: 'Test', durationMs: 100, tags: [], hasFrontmatter: false },
    ]
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        list_notes: commandHandler(async (input) => {
          if (input.cursor !== undefined) {
            const parsed = Number(input.cursor)
            if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
              throw new Error('Invalid cursor')
            }
          }
          return { notes: mockNotes }
        }),
      },
    })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const negRes = await fetch(`${server.url}/api/v1/notes?cursor=-1`, { headers })
    expect(negRes.status).toBeGreaterThanOrEqual(400)
    const negBody = await negRes.json()
    expect(negBody.ok).toBe(false)
    expect(negBody.error).toBeDefined()
    expect(JSON.stringify(negBody)).not.toContain('relativePath')

    const nanRes = await fetch(`${server.url}/api/v1/notes?cursor=NaN`, { headers })
    expect(nanRes.status).toBeGreaterThanOrEqual(400)
    const nanBody = await nanRes.json()
    expect(nanBody.ok).toBe(false)
    expect(nanBody.error).toBeDefined()

    const strRes = await fetch(`${server.url}/api/v1/notes?cursor=invalid`, { headers })
    expect(strRes.status).toBeGreaterThanOrEqual(400)
    const strBody = await strRes.json()
    expect(strBody.ok).toBe(false)
    expect(strBody.error).toBeDefined()
  })
})
