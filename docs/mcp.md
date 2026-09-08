# mmStopWatch MCP and localhost boundary

This is a standalone Node 22 adapter for the native Slint/Rust product. It is
not the GUI process and never claims access to live in-memory GUI timers.
It reads the selected Markdown vault and `.mmST-{profile}` files through an
explicit, path-safe file adapter.

## Configuration and launch

Both transports fail closed unless `MMSTOPWATCH_VAULT_PATH` is an absolute
vault directory. `MMSTOPWATCH_PROFILE` is optional and defaults to `default`.
Mutating calls also require `MMSTOPWATCH_CONTROL_PLANE_TOKEN`.

Hermes/client configuration uses Node and an absolute path directly:

```json
{"mcpServers":{"mmstopwatch":{"command":"node","args":["/absolute/path/to/mmStopWatch/mcp/server.mjs"],"env":{"MMSTOPWATCH_VAULT_PATH":"/absolute/vault","MMSTOPWATCH_PROFILE":"work","MMSTOPWATCH_CONTROL_PLANE_TOKEN":"set-out-of-band"}}}}
```

Direct commands:

```sh
MMSTOPWATCH_VAULT_PATH=/absolute/vault MMSTOPWATCH_PROFILE=work \
  MMSTOPWATCH_CONTROL_PLANE_TOKEN="$TOKEN" node /absolute/path/to/mmStopWatch/mcp/server.mjs
MMSTOPWATCH_VAULT_PATH=/absolute/vault MMSTOPWATCH_PROFILE=work \
  MMSTOPWATCH_CONTROL_PLANE_TOKEN="$TOKEN" node /absolute/path/to/mmStopWatch/mcp/http.mjs
```

The stdio protocol is MCP `2025-06-18`, newline-delimited JSON-RPC, with a
1 MiB frame limit and JSON-RPC-only stdout. Diagnostics go to stderr. EOF and
SIGINT/SIGTERM are idempotent. HTTP binds only to `127.0.0.1:9376` (port 0 is
reserved for explicit tests), requires Bearer authentication on every API
request, rejects non-allowlisted Origin values, and limits bodies/timeouts.
Reads use `GET`; mutations use `POST`; note metadata uses the safe query route
`GET /api/v1/notes/get?path=relative%2Fnote.md`.

## Supported contract

Tools are `mmstopwatch_status`, `mmstopwatch_capabilities`,
`mmstopwatch_notes_list`, `mmstopwatch_note_get`, `mmstopwatch_timers_list`,
`mmstopwatch_profiles_list`, `mmstopwatch_config`, `mmstopwatch_notifications`,
`mmstopwatch_stats`, `mmstopwatch_report_preview`, `mmstopwatch_timer_mutate`,
and `mmstopwatch_note_update_duration`. All results use `{ok,data,revision}`
or a structured `{ok:false,error:{code,message}}` envelope. Machine-readable
schemas and route declarations are in `mcp/schema.mjs`.

Notes expose only bounded Markdown frontmatter allowlists. Scans exclude
`.obsidian`, `.git`, `.mmST-*`, and hidden implementation directories.
Timers are persistent **external MCP timers** in the selected profile, not GUI
timers. Mutations require `confirmed:true` and an expected revision; stop and
duration update allowlist only the Timework frontmatter field and one
idempotent activity entry.

Note deletion, arbitrary note writes, and config mutation are unavailable:
they are intentionally not implemented. Measurement workflow and telemetry
are explicitly deferred and are not included.

Verification: `npm --prefix mcp test`, `node --check mcp/server.mjs`,
`node --check mcp/http.mjs`, and the repository native Rust gates.
