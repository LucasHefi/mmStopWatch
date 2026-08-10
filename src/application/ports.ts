export interface VaultScope {
  resolveNotePath(relativePath: string, mode: 'read' | 'write'): Promise<string>
}

export interface FileStore {
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  listFiles(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
}

export interface MonotonicClock {
  nowMs(): number
}

export interface AuditEvent {
  requestId: string
  actor: 'ui' | 'http' | 'mcp' | 'cli'
  action: string
  outcome: 'accepted' | 'rejected' | 'failed'
  resource?: string
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>
}

export interface IdempotencyStore {
  get(key: string): Promise<string | undefined>
  set(key: string, result: string): Promise<void>
}

export interface RevisionProvider {
  getCurrentRevision(): Promise<string>
}
