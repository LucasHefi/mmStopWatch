import { startHttpServer } from './controlPlaneServer'

async function main(): Promise<void> {
  const rawPort = process.env.MMSTOPWATCH_CONTROL_PLANE_PORT || '0'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('MMSTOPWATCH_CONTROL_PLANE_PORT must be an integer between 0 and 65535')
  }

  const server = await startHttpServer({
    port,
    token: process.env.MMSTOPWATCH_CONTROL_PLANE_TOKEN,
    allowedOrigins: (process.env.MMSTOPWATCH_CONTROL_PLANE_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
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
