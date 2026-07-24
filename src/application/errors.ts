export type SafeErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL'

export interface SafeError {
  code: SafeErrorCode
  message: string
  retryable: boolean
  details?: Record<string, string | number | boolean>
}

export function createSafeError(
  code: SafeErrorCode,
  message: string,
  options: { retryable?: boolean; details?: Record<string, string | number | boolean> } = {},
): SafeError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.details ? { details: options.details } : {}),
  }
}

export function internalError(): SafeError {
  return createSafeError('INTERNAL', 'Command failed', { retryable: true })
}
