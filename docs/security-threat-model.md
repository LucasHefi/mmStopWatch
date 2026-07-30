# mmStopWatch AI control-plane threat model

Status: development/pre-release contract
Scope: desktop UI, localhost HTTP control plane, MCP stdio adapter, CLI client and selected Markdown vault.

## Trust boundaries

| Boundary | Trust level | Required controls |
| --- | --- | --- |
| Tauri UI → application services | local application | runtime-selected vault scope, validated relative paths, typed command envelope |
| MCP/CLI → localhost API | local external client | loopback bind, Bearer token, constant-time comparison, request ID, timeout, safe error envelope |
| MCP/CLI process → API token | sensitive | environment/config secret store only; never argv, stdout, MCP tool result or diagnostics |
| API → vault | user data | no static home/drive glob, selected directory only, fail-closed path validation |
| API/MCP/CLI → mutation | high impact | capability check, explicit confirmation, idempotency/revision handling before write support |
| Remote network → API | disabled by default | reject non-loopback Host; no remote bind or CORS origin unless explicitly configured |

## Permission matrix

| Operation | UI | HTTP | MCP | CLI | Current release state |
| --- | ---: | ---: | ---: | ---: | --- |
| Status/capabilities | read | read | read | read | implemented |
| Notes/stats/report read | read | declared read | only status/capabilities advertised; other schemas planned but not exposed | declared client route | backend handlers remain explicit 501 until implemented |
| Timer read | read | not exposed | planned schema, not advertised | schema, fail-closed | open |
| Timer mutation | local UI | not exposed | not advertised; no backend call path | confirmation flag, fail-closed | open |
| Note/profile/config mutation | local UI | not exposed | not advertised; no backend call path | confirmation flag, fail-closed | open |
| Notifications | local UI | not exposed | status/test schema, fail-closed | not exposed | open |

## Security invariants

1. The HTTP server binds to `127.0.0.1` only and rejects non-loopback Host headers.
2. Every HTTP request requires a Bearer token compared in constant time.
3. Origins are denied unless explicitly allow-listed.
4. MCP stdout contains only JSON-RPC frames; diagnostics go to stderr.
5. CLI tokens are accepted only from environment/config and are never command-line arguments.
6. MCP/CLI transport failures redact bearer/token/secret-like values.
7. Unknown or currently unsupported commands return explicit errors; they never become silent success or an empty fallback.
8. Mutating MCP/CLI commands require an explicit confirmation signal before any backend call.
9. The current read-only API does not grant vault access and does not expose write endpoints.
10. Network, build and local test evidence do not prove production updater/signing/install readiness.

## Release follow-ups

- Bind the control plane lifecycle to the desktop process or a separately supervised local process.
- Implement the declared read-only resource handlers and shared application-service adapters.
- Add stale revision/idempotency enforcement before enabling mutations.
- Add matching-host Windows/macOS install, startup, uninstall, signing and updater smoke evidence.
- Keep remote access, production updater metadata and owner approval as separate gates.
