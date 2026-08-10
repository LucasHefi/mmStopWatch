import { describe, expect, it, vi } from 'vitest'
import { ApplicationDispatcher, commandHandler } from '../application/dispatcher'
import {
  CONFIRM,
  type CommandRequest,
} from '../application/contracts'
import type { AuditSink, IdempotencyStore, MonotonicClock, RevisionProvider } from '../application/ports'

describe('ApplicationDispatcher A0 slice', () => {
  describe('options form', () => {
    it('constructs without options (backward compatible)', () => {
      const d = new ApplicationDispatcher({
        status: commandHandler(async () => ({
          appVersion: '1.0.0',
          protocolVersion: '1',
          ready: true,
        })),
      })
      expect(d).toBeInstanceOf(ApplicationDispatcher)
    })

    it('accepts optional AuditSink, IdempotencyStore, and MonotonicClock', () => {
      const clock: MonotonicClock = { nowMs: () => 1000 }
      const auditSink: AuditSink = { record: vi.fn().mockResolvedValue(undefined) }
      const idempotencyStore: IdempotencyStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      }

      const d = new ApplicationDispatcher(
        {
          status: commandHandler(async () => ({
            appVersion: '1.0.0',
            protocolVersion: '1',
            ready: true,
          })),
        },
        { auditSink, idempotencyStore, monotonicClock: clock },
      )
      expect(d).toBeInstanceOf(ApplicationDispatcher)
    })
  })

  describe('command registry enforcement', () => {
    const dispatcher = new ApplicationDispatcher({
      status: commandHandler(async () => ({
        appVersion: '1.0.0',
        protocolVersion: '1',
        ready: true,
      })),
    })

    it('rejects unknown command not in COMMAND_REGISTRY', async () => {
      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-1',
        actor: 'cli',
        command: 'unknown_cmd' as any,
        input: {},
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST')
        expect(result.error.message).toBe('Unknown command')
      }
    })

    it('still returns NOT_IMPLEMENTED for known command with no registered handler', async () => {
      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-1',
        actor: 'cli',
        command: 'note_save',
        input: { relativePath: 'Projects/Note.md', durationMs: 1000 },
        confirmation: CONFIRM,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_IMPLEMENTED')
      }
    })
  })

  describe('optimistic concurrency', () => {
    it('rejects a stale mutating request before invoking its handler', async () => {
      const handler = vi.fn().mockResolvedValue({
        timer: {
          id: 't1',
          notePath: 'Projects/Note.md',
          name: 'Test',
          status: 'RUNNING',
          elapsedMs: 0,
          baseElapsedMs: 0,
          pausedOffsetMs: 0,
        },
        revision: 'r3',
      })
      const revisionProvider: RevisionProvider = {
        getCurrentRevision: vi.fn().mockResolvedValue('r2'),
      }
      const dispatcher = new ApplicationDispatcher(
        { timer_start: commandHandler(handler) },
        { revisionProvider },
      )

      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-stale-1',
        actor: 'http',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
        expectedRevision: 'r1',
        confirmation: CONFIRM,
      })

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'CONFLICT',
          message: 'Revision is stale',
          retryable: true,
          details: { expectedRevision: 'r1', actualRevision: 'r2' },
        },
      })
      expect(handler).not.toHaveBeenCalled()
    })

    it('serializes concurrent revision-checked mutations so only one can commit', async () => {
      let currentRevision = 'r1'
      const handler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        currentRevision = 'r2'
        return {
          timer: {
            id: 't1',
            notePath: 'Projects/Note.md',
            name: 'Test',
            status: 'RUNNING' as const,
            elapsedMs: 0,
            baseElapsedMs: 0,
            pausedOffsetMs: 0,
          },
          revision: 'r2',
        }
      })
      const dispatcher = new ApplicationDispatcher(
        { timer_start: commandHandler(handler) },
        { revisionProvider: { getCurrentRevision: async () => currentRevision } },
      )
      const request = (requestId: string): CommandRequest<'timer_start'> => ({
        protocolVersion: '1',
        requestId,
        actor: 'http',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
        expectedRevision: 'r1',
        confirmation: CONFIRM,
      })

      const results = await Promise.all([dispatcher.dispatch(request('req-concurrent-1')), dispatcher.dispatch(request('req-concurrent-2'))])
      expect(results.filter(result => result.ok)).toHaveLength(1)
      expect(results.filter(result => !result.ok)).toHaveLength(1)
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('CONFIRM for mutating commands', () => {
    it('defines CONFIRM as a non-empty string', () => {
      expect(CONFIRM).toBeTruthy()
      expect(typeof CONFIRM).toBe('string')
      expect(CONFIRM.length).toBeGreaterThan(0)
    })

    it('rejects mutating command without confirmation', async () => {
      const dispatcher = new ApplicationDispatcher({
        timer_start: commandHandler(async (input) => ({
          timer: {
            id: 't1',
            notePath: input.notePath,
            name: 'Test',
            status: 'RUNNING',
            elapsedMs: 0,
            baseElapsedMs: 0,
            pausedOffsetMs: 0,
          },
          revision: 'r1',
        })),
      })

      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-mut',
        actor: 'cli',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN')
      }
    })

    it('rejects mutating command with wrong confirmation', async () => {
      const dispatcher = new ApplicationDispatcher({
        timer_start: commandHandler(async (input) => ({
          timer: {
            id: 't1',
            notePath: input.notePath,
            name: 'Test',
            status: 'RUNNING',
            elapsedMs: 0,
            baseElapsedMs: 0,
            pausedOffsetMs: 0,
          },
          revision: 'r1',
        })),
      })

      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-mut',
        actor: 'cli',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
        confirmation: 'wrong',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN')
      }
    })

    it('accepts mutating command with correct CONFIRM', async () => {
      const dispatcher = new ApplicationDispatcher({
        timer_start: commandHandler(async (input) => ({
          timer: {
            id: 't1',
            notePath: input.notePath,
            name: 'Test',
            status: 'RUNNING',
            elapsedMs: 0,
            baseElapsedMs: 0,
            pausedOffsetMs: 0,
          },
          revision: 'r1',
        })),
      })

      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-mut',
        actor: 'cli',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
        confirmation: CONFIRM,
      })
      expect(result.ok).toBe(true)
    })

    it('accepts non-mutating command without confirmation', async () => {
      const dispatcher = new ApplicationDispatcher({
        status: commandHandler(async () => ({
          appVersion: '1.0.0',
          protocolVersion: '1',
          ready: true,
        })),
      })

      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-read',
        actor: 'cli',
        command: 'status',
        input: {},
      })
      expect(result.ok).toBe(true)
    })
  })

  describe('idempotency', () => {
    it('calls handler twice when no IdempotencyStore is configured and same idempotencyKey', async () => {
      const handlerSpy = vi.fn().mockResolvedValue({
        timer: {
          id: 't1',
          notePath: 'Projects/Note.md',
          name: 'Test',
          status: 'RUNNING',
          elapsedMs: 0,
          baseElapsedMs: 0,
          pausedOffsetMs: 0,
        },
        revision: 'r1',
      })
      const dispatcher = new ApplicationDispatcher({
        timer_start: commandHandler(handlerSpy),
      })

      const request: CommandRequest<'timer_start'> = {
        protocolVersion: '1',
        requestId: 'req-idem-1',
        actor: 'cli',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
        idempotencyKey: 'idem-1',
        confirmation: CONFIRM,
      }

      await dispatcher.dispatch(request)
      await dispatcher.dispatch(request)

      expect(handlerSpy).toHaveBeenCalledTimes(2)
    })

    it('replays cached result when IdempotencyStore is configured and key exists', async () => {
      const cachedResult = JSON.stringify({
        ok: true,
        protocolVersion: '1',
        requestId: 'req-idem-2',
        data: {
          timer: {
            id: 'cached-timer',
            notePath: 'Projects/Cached.md',
            name: 'Cached',
            status: 'RUNNING',
            elapsedMs: 5000,
            baseElapsedMs: 5000,
            pausedOffsetMs: 5000,
          },
          revision: 'r-cached',
        },
      })

      const handlerSpy = vi.fn()
      const idempotencyStore: IdempotencyStore = {
        get: vi.fn().mockResolvedValue(cachedResult),
        set: vi.fn().mockResolvedValue(undefined),
      }
      const dispatcher = new ApplicationDispatcher(
        { timer_start: commandHandler(handlerSpy) },
        { idempotencyStore },
      )

      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-idem-2',
        actor: 'cli',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
        idempotencyKey: 'idem-2',
        confirmation: CONFIRM,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.timer.id).toBe('cached-timer')
      }
      expect(handlerSpy).not.toHaveBeenCalled()
    })

    it('stores successful result after handling when IdempotencyStore is configured', async () => {
      const handlerResult = {
        timer: {
          id: 'new-timer',
          notePath: 'Projects/New.md',
          name: 'New',
          status: 'RUNNING' as const,
          elapsedMs: 3000,
          baseElapsedMs: 3000,
          pausedOffsetMs: 3000,
        },
        revision: 'r-new',
      }
      const idempotencyStore: IdempotencyStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      }
      const dispatcher = new ApplicationDispatcher(
        { timer_start: commandHandler(async () => handlerResult) },
        { idempotencyStore },
      )

      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-idem-3',
        actor: 'cli',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
        idempotencyKey: 'idem-3',
        confirmation: CONFIRM,
      })

      expect(result.ok).toBe(true)
      expect(idempotencyStore.set).toHaveBeenCalledTimes(1)
      const storedKey = (idempotencyStore.set as any).mock.calls[0][0]
      expect(storedKey).toBe('idem-3')
    })

    it('does not store result when handler fails', async () => {
      const idempotencyStore: IdempotencyStore = {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      }
      const dispatcher = new ApplicationDispatcher(
        {
          status: commandHandler(() => {
            throw new Error('boom')
          }),
        },
        { idempotencyStore },
      )

      await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-idem-4',
        actor: 'cli',
        command: 'status',
        input: {},
        idempotencyKey: 'idem-4',
      })

      expect(idempotencyStore.set).not.toHaveBeenCalled()
    })
  })

  describe('audit', () => {
    it('does not call audit sink when none configured', async () => {
      const dispatcher = new ApplicationDispatcher({
        status: commandHandler(async () => ({
          appVersion: '1.0.0',
          protocolVersion: '1',
          ready: true,
        })),
      })

      await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-audit-1',
        actor: 'cli',
        command: 'status',
        input: {},
      })
      // No audit sink = no explosion
    })

    it('records accepted outcome for successful handler', async () => {
      const recordSpy = vi.fn().mockResolvedValue(undefined)
      const auditSink: AuditSink = { record: recordSpy }
      const dispatcher = new ApplicationDispatcher(
        {
          status: commandHandler(async () => ({
            appVersion: '1.0.0',
            protocolVersion: '1',
            ready: true,
          })),
        },
        { auditSink },
      )

      await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-audit-2',
        actor: 'http',
        command: 'status',
        input: {},
      })

      expect(recordSpy).toHaveBeenCalledTimes(1)
      const event = recordSpy.mock.calls[0][0]
      expect(event.requestId).toBe('req-audit-2')
      expect(event.actor).toBe('http')
      expect(event.action).toBe('status')
      expect(event.outcome).toBe('accepted')
    })

    it('records rejected outcome for invalid command', async () => {
      const recordSpy = vi.fn().mockResolvedValue(undefined)
      const auditSink: AuditSink = { record: recordSpy }
      const dispatcher = new ApplicationDispatcher({}, { auditSink })

      await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-audit-3',
        actor: 'mcp',
        command: 'unknown_cmd' as any,
        input: {},
      })

      expect(recordSpy).toHaveBeenCalledTimes(1)
      const event = recordSpy.mock.calls[0][0]
      expect(event.outcome).toBe('rejected')
    })

    it('records rejected outcome for mutating command without confirmation', async () => {
      const recordSpy = vi.fn().mockResolvedValue(undefined)
      const auditSink: AuditSink = { record: recordSpy }
      const dispatcher = new ApplicationDispatcher(
        {
          timer_start: commandHandler(async (input) => ({
            timer: {
              id: 't1',
              notePath: input.notePath,
              name: 'Test',
              status: 'RUNNING',
              elapsedMs: 0,
              baseElapsedMs: 0,
              pausedOffsetMs: 0,
            },
            revision: 'r1',
          })),
        },
        { auditSink },
      )

      await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-audit-4',
        actor: 'ui',
        command: 'timer_start',
        input: { notePath: 'Projects/Note.md' },
      })

      expect(recordSpy).toHaveBeenCalledTimes(1)
      const event = recordSpy.mock.calls[0][0]
      expect(event.outcome).toBe('rejected')
    })

    it('records failed outcome for handler exception', async () => {
      const recordSpy = vi.fn().mockResolvedValue(undefined)
      const auditSink: AuditSink = { record: recordSpy }
      const dispatcher = new ApplicationDispatcher(
        {
          status: commandHandler(() => {
            throw new Error('internal disaster')
          }),
        },
        { auditSink },
      )

      await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-audit-5',
        actor: 'cli',
        command: 'status',
        input: {},
      })

      expect(recordSpy).toHaveBeenCalledTimes(1)
      const event = recordSpy.mock.calls[0][0]
      expect(event.outcome).toBe('failed')
    })

    it('does not leak audit failure to dispatch result', async () => {
      const auditSink: AuditSink = {
        record: vi.fn().mockRejectedValue(new Error('audit sink down')),
      }
      const dispatcher = new ApplicationDispatcher(
        {
          status: commandHandler(async () => ({
            appVersion: '1.0.0',
            protocolVersion: '1',
            ready: true,
          })),
        },
        { auditSink },
      )

      const result = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-audit-6',
        actor: 'cli',
        command: 'status',
        input: {},
      })

      expect(result.ok).toBe(true)
    })

    it('does not include secrets or input details in audit events', async () => {
      const recordSpy = vi.fn().mockResolvedValue(undefined)
      const auditSink: AuditSink = { record: recordSpy }
      const dispatcher = new ApplicationDispatcher(
        {
          status: commandHandler(() => {
            throw new Error('/home/secret/path')
          }),
        },
        { auditSink },
      )

      await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-audit-7',
        actor: 'cli',
        command: 'status',
        input: {},
      })

      const event = recordSpy.mock.calls[0][0]
      expect(JSON.stringify(event)).not.toContain('secret')
      expect(JSON.stringify(event)).not.toContain('/home')
    })
  })

  describe('preserved behavior', () => {
    it('returns safe error envelope and never leaks exception details', async () => {
      const dispatcher = new ApplicationDispatcher({
        status: commandHandler(() => { throw new Error('/home/private/vault') }),
      })

      const failed = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: 'req-safe',
        actor: 'ui',
        command: 'status',
        input: {},
      })

      expect(failed).toMatchObject({ ok: false, error: { code: 'INTERNAL', message: 'Command failed' } })
      expect(JSON.stringify(failed)).not.toContain('/home/private/vault')
    })

    it('validates request envelope', async () => {
      const dispatcher = new ApplicationDispatcher({
        status: commandHandler(async () => ({
          appVersion: '1.0.0',
          protocolVersion: '1',
          ready: true,
        })),
      })

      const badVersion = await dispatcher.dispatch({
        protocolVersion: '2',
        requestId: 'req-bad-ver',
        actor: 'cli',
        command: 'status',
        input: {},
      } as any)
      expect(badVersion).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })

      const emptyId = await dispatcher.dispatch({
        protocolVersion: '1',
        requestId: '   ',
        actor: 'cli',
        command: 'status',
        input: {},
      })
      expect(emptyId).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    })
  })
})
