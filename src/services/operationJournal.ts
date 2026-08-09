export type OperationStatus = 'pending' | 'committed' | 'failed' | 'conflict'

export interface OperationRecord {
  id: string
  kind: string
  targetPath?: string
  status: OperationStatus
  createdAt: number
  updatedAt: number
  retryCount: number
  error?: string
}

const KEY = 'mmstopwatch_operations_v1'
const MAX_RECORDS = 200

function isRecord(value: unknown): value is OperationRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<OperationRecord>
  return typeof item.id === 'string' && typeof item.kind === 'string'
    && (item.targetPath === undefined || typeof item.targetPath === 'string')
    && (item.status === 'pending' || item.status === 'committed' || item.status === 'failed' || item.status === 'conflict')
    && typeof item.createdAt === 'number' && typeof item.updatedAt === 'number'
    && typeof item.retryCount === 'number'
}

function readRecords(): OperationRecord[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter(isRecord) : []
  } catch (error) {
    console.error('Failed to read operation journal:', error)
    return []
  }
}

function writeRecords(records: OperationRecord[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(records.slice(-MAX_RECORDS)))
  } catch (error) {
    console.error('Failed to persist operation journal:', error)
  }
}

function makeId(): string {
  return 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export function getOperation(id: string): OperationRecord | undefined {
  return readRecords().find(record => record.id === id)
}

export function beginOperation(kind: string, targetPath?: string, requestedId?: string): OperationRecord {
  const now = Date.now()
  const records = readRecords()
  const existing = requestedId ? records.find(record => record.id === requestedId) : undefined
  // A committed operation is an idempotent success. Callers can skip the write.
  if (existing?.status === 'committed') return existing
  const record: OperationRecord = existing
    ? { ...existing, kind, targetPath: targetPath ?? existing.targetPath, status: 'pending', updatedAt: now, error: undefined }
    : { id: requestedId || makeId(), kind, targetPath, status: 'pending', createdAt: now, updatedAt: now, retryCount: 0 }
  writeRecords([...records.filter(item => item.id !== record.id), record])
  return record
}

export function completeOperation(id: string): void {
  updateOperation(id, { status: 'committed', error: undefined })
}

export function failOperation(id: string, error: unknown, status: OperationStatus = 'failed'): void {
  updateOperation(id, { status, error: error instanceof Error ? error.message : String(error), retryCountDelta: 1 })
}

function updateOperation(id: string, patch: Partial<OperationRecord> & { retryCountDelta?: number }): void {
  const now = Date.now()
  const records = readRecords().map(record => record.id === id
    ? { ...record, ...patch, retryCount: record.retryCount + (patch.retryCountDelta || 0), updatedAt: now }
    : record)
  writeRecords(records.map(record => {
    const next = { ...record } as OperationRecord & { retryCountDelta?: number }
    delete next.retryCountDelta
    return next
  }))
}

export function listPendingOperations(): OperationRecord[] {
  return readRecords().filter(record => record.status === 'pending' || record.status === 'failed' || record.status === 'conflict')
}

export function clearOperationJournal(): void {
  writeRecords([])
}
