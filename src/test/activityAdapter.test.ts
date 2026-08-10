// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ActivityAdapter, getStats, previewReport } from '../../tools/activityAdapter'
import type { ActivityEntry } from '../types/session'
import type { StatsDto } from '../application/contracts'
import { commandHandler } from '../application/dispatcher'
import { startHttpServer, type ControlPlaneServerHandle } from '../../tools/controlPlaneServer'

let testDir = ''

afterEach(async () => {
  if (testDir) {
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
    testDir = ''
  }
})

async function createTempVault(): Promise<string> {
  testDir = await mkdtemp(join(tmpdir(), 'mmst-activity-'))
  return testDir
}

async function writeActivity(vaultPath: string, nick: string, content: unknown): Promise<void> {
  const dir = join(vaultPath, `.mmST-${nick}`)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'activity.json'), JSON.stringify(content, null, 2))
}

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    timestamp: 1718000000000,
    duration_ms: 3600000,
    notePath: 'projects/note.md',
    noteName: 'note',
    ...overrides,
  }
}

describe('ActivityAdapter', () => {
  it('loads activity.json and exposes validated entries', async () => {
    const vault = await createTempVault()
    const entries = [makeEntry(), makeEntry({ notePath: 'other.md', noteName: 'other' })]
    await writeActivity(vault, 'testnick', { entries })

    const adapter = new ActivityAdapter(vault, 'testnick')
    await adapter.load()
    const result = adapter.getEntries()
    expect(result).toHaveLength(2)
    expect(result[0].timestamp).toBe(1718000000000)
    expect(result[0].duration_ms).toBe(3600000)
    expect(result[0].notePath).toBe('projects/note.md')
    expect(result[0].noteName).toBe('note')
  })

  it('returns empty entries when activity.json does not exist', async () => {
    const vault = await createTempVault()
    const adapter = new ActivityAdapter(vault, 'missingnick')
    await adapter.load()
    expect(adapter.getEntries()).toEqual([])
  })

  it('fails closed on malformed JSON', async () => {
    const vault = await createTempVault()
    const dir = join(vault, '.mmST-badnick')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'activity.json'), '{ broken json ///')

    const adapter = new ActivityAdapter(vault, 'badnick')
    await expect(adapter.load()).rejects.toThrow()
  })

  it('fails closed on non-array entries', async () => {
    const vault = await createTempVault()
    await writeActivity(vault, 'badnick', { entries: 'not-an-array' })

    const adapter = new ActivityAdapter(vault, 'badnick')
    await expect(adapter.load()).rejects.toThrow()
  })

  it('fails closed when entries are missing required fields', async () => {
    const vault = await createTempVault()
    await writeActivity(vault, 'badnick', { entries: [{ timestamp: 1718000000000 }] })

    const adapter = new ActivityAdapter(vault, 'badnick')
    await expect(adapter.load()).rejects.toThrow()
  })

  it('fails closed on invalid timestamp (NaN, negative, non-integer)', async () => {
    const vault = await createTempVault()
    await writeActivity(vault, 'badnick', { entries: [makeEntry({ timestamp: NaN })] })
    const adapter = new ActivityAdapter(vault, 'badnick')
    await expect(adapter.load()).rejects.toThrow()

    testDir = ''
    const vault2 = await createTempVault()
    await writeActivity(vault2, 'badnick', { entries: [makeEntry({ timestamp: -1 })] })
    const adapter2 = new ActivityAdapter(vault2, 'badnick')
    await expect(adapter2.load()).rejects.toThrow()
  })

  it('fails closed on non-integer duration_ms', async () => {
    const vault = await createTempVault()
    await writeActivity(vault, 'badnick', { entries: [makeEntry({ duration_ms: 1.5 })] })
    const adapter = new ActivityAdapter(vault, 'badnick')
    await expect(adapter.load()).rejects.toThrow()
  })

  it('fails closed on negative duration_ms', async () => {
    const vault = await createTempVault()
    await writeActivity(vault, 'badnick', { entries: [makeEntry({ duration_ms: -1 })] })
    const adapter = new ActivityAdapter(vault, 'badnick')
    await expect(adapter.load()).rejects.toThrow()
  })

  it('fails closed when notePath contains traversal', async () => {
    const vault = await createTempVault()
    await writeActivity(vault, 'badnick', { entries: [makeEntry({ notePath: '../escape.md' })] })
    const adapter = new ActivityAdapter(vault, 'badnick')
    await expect(adapter.load()).rejects.toThrow()
  })

  it('fails closed when notePath is absolute', async () => {
    const vault = await createTempVault()
    await writeActivity(vault, 'badnick', { entries: [makeEntry({ notePath: '/etc/passwd' })] })
    const adapter = new ActivityAdapter(vault, 'badnick')
    await expect(adapter.load()).rejects.toThrow()
  })

  it('never exposes absolute paths in stored entries', async () => {
    const vault = await createTempVault()
    await writeActivity(vault, 'testnick', { entries: [makeEntry()] })

    const adapter = new ActivityAdapter(vault, 'testnick')
    await adapter.load()
    const result = adapter.getEntries()
    expect(result).toHaveLength(1)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(vault)
    expect(serialized).not.toContain('.mmST-')
  })

  it('rejects relative vault path', () => {
    expect(() => new ActivityAdapter('relative/path', 'nick')).toThrow()
  })

  it('rejects invalid nick', () => {
    expect(() => new ActivityAdapter('/tmp', '../evil')).toThrow()
  })

  it('does not follow symlinks in vault path', async () => {
    const vault = await createTempVault()
    const realDir = join(vault, 'real')
    await mkdir(realDir)
    await writeActivity(realDir, 'testnick', { entries: [makeEntry()] })
    const linkDir = join(vault, 'link')
    await symlink(realDir, linkDir)

    const adapter = new ActivityAdapter(linkDir, 'testnick')
    await expect(adapter.load()).rejects.toThrow()
  })
})

describe('getStats', () => {
  it('returns zero stats for empty entries', () => {
    const stats = getStats([], {})
    expect(stats).toEqual<StatsDto>({
      totalDurationMs: 0,
      sessionCount: 0,
      noteCount: 0,
    })
  })

  it('computes totalDurationMs, sessionCount and unique noteCount', () => {
    const entries: ActivityEntry[] = [
      makeEntry({ timestamp: 1718000000000, duration_ms: 3600000, notePath: 'a.md' }),
      makeEntry({ timestamp: 1718000000001, duration_ms: 1800000, notePath: 'a.md' }),
      makeEntry({ timestamp: 1718000000002, duration_ms: 900000, notePath: 'b.md' }),
    ]
    const stats = getStats(entries, {})
    expect(stats.totalDurationMs).toBe(6300000)
    expect(stats.sessionCount).toBe(3)
    expect(stats.noteCount).toBe(2)
  })

  it('filters by from (inclusive) and to (exclusive)', () => {
    const entries: ActivityEntry[] = [
      makeEntry({ timestamp: 1000, duration_ms: 100, notePath: 'old.md' }),
      makeEntry({ timestamp: 2000, duration_ms: 200, notePath: 'mid.md' }),
      makeEntry({ timestamp: 3000, duration_ms: 300, notePath: 'new.md' }),
    ]
    const stats = getStats(entries, { from: '1970-01-01T00:00:02.000Z', to: '1970-01-01T00:00:03.000Z' })
    expect(stats.sessionCount).toBe(1)
    expect(stats.totalDurationMs).toBe(200)
    expect(stats.noteCount).toBe(1)
    expect(stats.from).toBe('1970-01-01T00:00:02.000Z')
    expect(stats.to).toBe('1970-01-01T00:00:03.000Z')
  })

  it('returns zero count when no entries match the range', () => {
    const entries: ActivityEntry[] = [makeEntry({ timestamp: 1000, duration_ms: 100 })]
    const stats = getStats(entries, { from: '2000-01-01T00:00:00.000Z', to: '2000-01-02T00:00:00.000Z' })
    expect(stats.sessionCount).toBe(0)
    expect(stats.totalDurationMs).toBe(0)
    expect(stats.noteCount).toBe(0)
  })

  it('throws on invalid from/to', () => {
    expect(() => getStats([], { from: 'not-a-date' })).toThrow()
    expect(() => getStats([], { to: 'invalid' })).toThrow()
    expect(() => getStats([], { from: '2026-01-01', to: '2025-01-01' })).toThrow()
  })
})

describe('previewReport', () => {
  it('generates markdown report with bounded content', () => {
    const entries: ActivityEntry[] = [
      makeEntry({ timestamp: 1718000000000, duration_ms: 3600000, notePath: 'work.md', noteName: 'work' }),
      makeEntry({ timestamp: 1718000000001, duration_ms: 1800000, notePath: 'meeting.md', noteName: 'meeting' }),
    ]
    const report = previewReport(entries, { format: 'markdown' })
    expect(report.format).toBe('markdown')
    expect(report.truncated).toBe(false)
    expect(report.content).toContain('# Activity Report')
    expect(report.content).toContain('Total time')
    expect(report.content).toContain('work')
    expect(report.content).toContain('meeting')
    expect(report.content).toContain('1h 0m')
    expect(report.content).toContain('Total entries')
    expect(report.content).toContain('Unique notes')
  })

  it('never contains absolute vault paths', () => {
    const entries: ActivityEntry[] = [makeEntry()]
    const report = previewReport(entries, { format: 'markdown' })
    expect(report.content).not.toContain('/home/')
    expect(report.content).not.toContain('/tmp/')
    expect(report.content).not.toContain('.mmST-')
    expect(report.content).not.toContain('mmst-activity-')
  })

  it('truncates content at 20_000 characters with truthful truncated flag', () => {
    const entries: ActivityEntry[] = []
    const longName = 'x'.repeat(1400)
    for (let i = 0; i < 60; i++) {
      entries.push(makeEntry({
        timestamp: 1718000000000 + i * 60000,
        notePath: `projects/note-${i}.md`,
        noteName: `${longName}-${i}`,
        duration_ms: 60000,
      }))
    }
    const report = previewReport(entries, { format: 'markdown' })
    expect(report.truncated).toBe(true)
    expect(report.content.length).toBeLessThanOrEqual(20000)
    expect(report.content).toContain('...truncated')
  })

  it('filters by from/to bounds', () => {
    const entries: ActivityEntry[] = [
      makeEntry({ timestamp: 1000, duration_ms: 100, notePath: 'old.md', noteName: 'old' }),
      makeEntry({ timestamp: 2000, duration_ms: 200, notePath: 'mid.md', noteName: 'mid' }),
      makeEntry({ timestamp: 3000, duration_ms: 300, notePath: 'new.md', noteName: 'new' }),
    ]
    const report = previewReport(entries, {
      format: 'markdown',
      from: '1970-01-01T00:00:02.000Z',
      to: '1970-01-01T00:00:03.000Z',
    })
    expect(report.content).toContain('mid')
    expect(report.content).not.toContain('old')
    expect(report.content).not.toContain('new')
    expect(report.truncated).toBe(false)
  })
})

describe('control-plane HTTP stats & report endpoints', () => {
  const servers: ControlPlaneServerHandle[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(s => s.close()))
  })

  it('advertises get_stats and preview_report only when activity adapter is configured', async () => {
    const serverWithActivity = await startHttpServer({
      token: 'test-token',
      handlers: {
        get_stats: commandHandler(async () => ({
          totalDurationMs: 0,
          sessionCount: 0,
          noteCount: 0,
        })),
        preview_report: commandHandler(async () => ({
          format: 'markdown' as const,
          content: '# Test',
          truncated: false,
        })),
      },
    })
    servers.push(serverWithActivity)
    const headers = { Authorization: 'Bearer test-token' }

    const caps = await fetch(`${serverWithActivity.url}/api/v1/capabilities`, { headers })
    expect(caps.status).toBe(200)
    const capBody = await caps.json()
    expect(capBody.data.commands).toContain('get_stats')
    expect(capBody.data.commands).toContain('preview_report')
    expect(capBody.data.commands).toContain('status')
    expect(capBody.data.commands).toContain('capabilities')
  })

  it('does not advertise get_stats/preview_report when not injected', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    servers.push(server)
    const caps = await fetch(`${server.url}/api/v1/capabilities`, {
      headers: { Authorization: 'Bearer test-token' },
    })
    const capBody = await caps.json()
    expect(capBody.data.commands).toEqual(['status', 'capabilities'])
    expect(capBody.data.commands).not.toContain('get_stats')
    expect(capBody.data.commands).not.toContain('preview_report')
  })

  it('GET /api/v1/stats returns stats via injected get_stats handler', async () => {
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        get_stats: commandHandler(async (input) => {
          const entries: ActivityEntry[] = [
            makeEntry({ timestamp: 1718000000000, duration_ms: 3600000, notePath: 'a.md' }),
            makeEntry({ timestamp: 1718000000001, duration_ms: 1800000, notePath: 'b.md' }),
          ]
          return getStats(entries, input as { from?: string; to?: string })
        }),
      },
    })
    servers.push(server)
    const headers = { Authorization: 'Bearer test-token' }

    const res = await fetch(`${server.url}/api/v1/stats`, { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.totalDurationMs).toBe(5400000)
    expect(body.data.sessionCount).toBe(2)
    expect(body.data.noteCount).toBe(2)
  })

  it('GET /api/v1/stats with from/to filtering', async () => {
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        get_stats: commandHandler(async (input) => {
          const entries: ActivityEntry[] = [
            makeEntry({ timestamp: 1000, duration_ms: 100, notePath: 'old.md' }),
            makeEntry({ timestamp: 2000, duration_ms: 200, notePath: 'mid.md' }),
            makeEntry({ timestamp: 3000, duration_ms: 300, notePath: 'new.md' }),
          ]
          return getStats(entries, input as { from?: string; to?: string })
        }),
      },
    })
    servers.push(server)
    const headers = { Authorization: 'Bearer test-token' }

    const res = await fetch(
      `${server.url}/api/v1/stats?from=1970-01-01T00:00:02.000Z&to=1970-01-01T00:00:03.000Z`,
      { headers },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.sessionCount).toBe(1)
    expect(body.data.from).toBe('1970-01-01T00:00:02.000Z')
    expect(body.data.to).toBe('1970-01-01T00:00:03.000Z')
  })

  it('POST /api/v1/reports/preview returns report via injected handler', async () => {
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        preview_report: commandHandler(async (input) => {
          const entries: ActivityEntry[] = [
            makeEntry({ timestamp: 1718000000000, duration_ms: 3600000, notePath: 'work.md', noteName: 'Work' }),
          ]
          return previewReport(entries, input as { from?: string; to?: string; format?: 'markdown' })
        }),
      },
    })
    servers.push(server)
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }

    const res = await fetch(`${server.url}/api/v1/reports/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ format: 'markdown' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.format).toBe('markdown')
    expect(body.data.truncated).toBe(false)
    expect(body.data.content).toContain('Work')
    expect(body.data.content).not.toContain('/tmp/')
  })

  it('POST /api/v1/reports/preview respects from/to bounds', async () => {
    const server = await startHttpServer({
      token: 'test-token',
      handlers: {
        preview_report: commandHandler(async (input) => {
          const entries: ActivityEntry[] = [
            makeEntry({ timestamp: 1000, duration_ms: 100, notePath: 'old.md', noteName: 'old' }),
            makeEntry({ timestamp: 2000, duration_ms: 200, notePath: 'mid.md', noteName: 'mid' }),
          ]
          return previewReport(entries, input as { from?: string; to?: string; format?: 'markdown' })
        }),
      },
    })
    servers.push(server)
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }

    const res = await fetch(`${server.url}/api/v1/reports/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        format: 'markdown',
        from: '1970-01-01T00:00:02.000Z',
        to: '1970-01-01T00:00:03.000Z',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.content).toContain('mid')
    expect(body.data.content).not.toContain('old')
  })
})
