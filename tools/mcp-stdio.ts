import { runMcpStdioServer } from './mcp-server'

const apiBaseUrl = process.env.MMSTOPWATCH_CONTROL_PLANE_URL || 'http://127.0.0.1:9376'
const token = process.env.MMSTOPWATCH_CONTROL_PLANE_TOKEN

process.stderr.write(`mmStopWatch MCP stdio adapter for ${apiBaseUrl}\n`)

void runMcpStdioServer({ apiBaseUrl, token }).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'MCP server failed'}\n`)
  process.exitCode = 1
})
