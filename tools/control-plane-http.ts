import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { startHttpServer } from './controlPlaneServer'
import { commandHandler } from '../src/application/dispatcher'
import { VaultAdapter } from './vaultAdapter'
import { ActivityAdapter, getStats, previewReport } from './activityAdapter'
import { validateAbsoluteVaultPath } from '../src/services/pathSecurity'

async function main(): Promise<void> {
  const rawPort = process.env.MMSTOPWATCH_CONTROL_PLANE_PORT || '9376'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('MMSTOPWATCH_CONTROL_PLANE_PORT must be an integer between 0 and 65535')
  }

  const injectedHandlers: Record<string, unknown> = {}

  const vaultEnv = process.env.MMSTOPWATCH_VAULT_PATH
  if (vaultEnv && vaultEnv.trim()) {
    try {
      const vaultPath = validateAbsoluteVaultPath(vaultEnv)
      const resolvedPath = resolve(vaultPath)
      if (!existsSync(resolvedPath)) {
        throw new Error('MMSTOPWATCH_VAULT_PATH does not exist')
      }

      const frontmatterKey = (process.env.MMSTOPWATCH_FRONTMATTER_KEY || 'Timework').trim()
      const timeEstimateKey = process.env.MMSTOPWATCH_TIME_ESTIMATE_KEY?.trim() || undefined
      const statsFieldKeys = (process.env.MMSTOPWATCH_STATS_FIELD_KEYS || '')
        .split(',')
        .map(k => k.trim())
        .filter(Boolean)

      const adapter = new VaultAdapter({
        vaultPath: resolvedPath,
        frontmatterKey,
        timeEstimateKey,
        statsFieldKeys: statsFieldKeys.length > 0 ? statsFieldKeys : undefined,
      })
      await adapter.load()

      injectedHandlers.list_notes = commandHandler(async (input) => {
        return adapter.listNotes(input)
      })

      const nick = (process.env.MMSTOPWATCH_NICK || '').trim()
      if (nick) {
        const activityAdapter = new ActivityAdapter(resolvedPath, nick)
        await activityAdapter.load()

        injectedHandlers.get_stats = commandHandler(async (input) => {
          return getStats(activityAdapter.getEntries(), input as { from?: string; to?: string })
        })

        injectedHandlers.preview_report = commandHandler(async (input) => {
          return previewReport(activityAdapter.getEntries(), input as { from?: string; to?: string; format?: 'markdown' })
        })
      }
    } catch (error) {
      throw new Error(`Vault adapter init failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  const server = await startHttpServer({
    port,
    token: process.env.MMSTOPWATCH_CONTROL_PLANE_TOKEN,
    allowedOrigins: (process.env.MMSTOPWATCH_CONTROL_PLANE_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    handlers: injectedHandlers as Record<string, unknown> as Parameters<typeof startHttpServer>[0]['handlers'],
  })

  process.stderr.write(`mmStopWatch control plane listening on ${server.url}\n`)
  process.stderr.write(`Authorization: Bearer ${server.token}\n`)

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Control plane failed'}\n`)
  process.exitCode = 1
})
