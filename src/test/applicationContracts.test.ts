import { describe, expect, it } from 'vitest'
import { ApplicationDispatcher, commandHandler } from '../application/dispatcher'
import {
  COMMAND_REGISTRY,
  EVENT_TYPES,
  PROTOCOL_VERSION,
  type CommandRequest,
  type NoteCommandOutput,
  type TimerCommandOutput,
  type TimerStartedEvent,
} from '../application/contracts'
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
        appVersion: '1.7.0-rc.1',
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
        appVersion: '1.7.0-rc.1',
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

  it('publishes a typed registry for status, timer, and note commands', () => {
    expect(COMMAND_REGISTRY.status).toMatchObject({ domain: 'status', mutating: false })
    expect(COMMAND_REGISTRY.timer_start).toMatchObject({ domain: 'timer', mutating: true })
    expect(COMMAND_REGISTRY.timer_stop).toMatchObject({ domain: 'timer', mutating: true })
    expect(COMMAND_REGISTRY.note_get).toMatchObject({ domain: 'note', mutating: false })
    expect(COMMAND_REGISTRY.note_save).toMatchObject({ domain: 'note', mutating: true })
    expect(COMMAND_REGISTRY.note_delete).toMatchObject({ domain: 'note', mutating: true })
  })

  it('keeps request metadata and optimistic concurrency fields on typed commands', async () => {
    const request: CommandRequest<'timer_start'> = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-timer-start',
      actor: 'mcp',
      expectedRevision: 'revision-7',
      idempotencyKey: 'idem-7',
      command: 'timer_start',
      input: { notePath: 'Projects/Note.md', initialElapsedMs: 1_000 },
    }
    const dispatcher = new ApplicationDispatcher({
      timer_start: commandHandler(async (input, context): Promise<TimerCommandOutput> => ({
        timer: {
          id: 'timer-1',
          notePath: input.notePath,
          name: 'Note',
          status: 'RUNNING',
          elapsedMs: input.initialElapsedMs || 0,
          baseElapsedMs: input.initialElapsedMs || 0,
          pausedOffsetMs: input.initialElapsedMs || 0,
        },
        revision: 'revision-8',
        idempotencyKey: context.idempotencyKey,
      })),
    })

    await expect(dispatcher.dispatch(request)).resolves.toMatchObject({
      ok: true,
      requestId: 'req-timer-start',
      data: {
        timer: { notePath: 'Projects/Note.md', status: 'RUNNING', elapsedMs: 1_000 },
        revision: 'revision-8',
        idempotencyKey: 'idem-7',
      },
    })
  })

  it('models note outputs and lifecycle events as explicit discriminated types', () => {
    const noteRequest: CommandRequest<'note_save'> = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-note-save',
      actor: 'cli',
      idempotencyKey: 'idem-note-1',
      command: 'note_save',
      input: { relativePath: 'Projects/Note.md', durationMs: 2_000, reset: false },
    }
    const note: NoteCommandOutput = {
      note: {
        relativePath: 'Projects/Note.md',
        name: 'Note',
        durationMs: 2_000,
        tags: ['work'],
        hasFrontmatter: true,
      },
      revision: 'revision-9',
      operationId: 'operation-9',
    }
    const event: TimerStartedEvent = {
      type: 'timer.started',
      eventId: 'event-1',
      occurredAt: 1_700_000_000_000,
      requestId: 'req-timer-start',
      actor: 'ui',
      revision: 'revision-8',
      timerId: 'timer-1',
      notePath: 'Projects/Note.md',
    }

    expect(note.note.relativePath).toBe('Projects/Note.md')
    expect(noteRequest.input.durationMs).toBe(2_000)
    expect(EVENT_TYPES).toContain(event.type)
    expect(event.revision).toBe('revision-8')
  })
})
