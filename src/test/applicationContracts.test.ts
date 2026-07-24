import { describe, expect, it } from 'vitest'
import { ApplicationDispatcher, commandHandler } from '../application/dispatcher'
import { validateRelativeNotePath } from '../application/security/pathPolicy'

describe('application command contracts', () => {
  it('normalizes safe relative note paths without exposing a vault root', () => {
    expect(validateRelativeNotePath('Projects\\Note.md')).toBe('Projects/Note.md')
    expect(validateRelativeNotePath('Projects/Note.md')).toBe('Projects/Note.md')
  })

  it('rejects absolute and traversal paths', () => {
    for (const path of ['/tmp/note.md', 'C:\\vault\\note.md', '\\\\server\\vault\\note.md', '../note.md', 'a/../note.md', 'a/./note.md']) {
      expect(() => validateRelativeNotePath(path)).toThrow()
    }
  })

  it('returns a versioned success envelope from a typed handler', async () => {
    const dispatcher = new ApplicationDispatcher({
      status: commandHandler(async (_input, context) => ({
        appVersion: '1.6.0',
        protocolVersion: '1',
        ready: true,
        activeProfileId: context.actor,
      })),
    })

    await expect(dispatcher.dispatch({
      protocolVersion: '1',
      requestId: 'req-1',
      actor: 'cli',
      command: 'status',
      input: {},
    })).resolves.toEqual({
      ok: true,
      protocolVersion: '1',
      requestId: 'req-1',
      data: {
        appVersion: '1.6.0',
        protocolVersion: '1',
        ready: true,
        activeProfileId: 'cli',
      },
    })
  })

  it('fails closed for missing handlers and handler exceptions', async () => {
    const dispatcher = new ApplicationDispatcher({
      status: commandHandler(() => { throw new Error('/home/private/vault') }),
    })

    await expect(dispatcher.dispatch({
      protocolVersion: '1',
      requestId: 'req-2',
      actor: 'http',
      command: 'list_notes',
      input: {},
    })).resolves.toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } })

    const failed = await dispatcher.dispatch({
      protocolVersion: '1',
      requestId: 'req-3',
      actor: 'ui',
      command: 'status',
      input: {},
    })
    expect(failed).toMatchObject({ ok: false, error: { code: 'INTERNAL', message: 'Command failed' } })
    expect(JSON.stringify(failed)).not.toContain('/home/private/vault')
  })
})
