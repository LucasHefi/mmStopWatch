const strictObject = (required, properties) => ({ type: 'object', required, properties, additionalProperties: false })
const confirmed = { const: true }
export const timerMutationSchema = { ...strictObject(['operation', 'confirmed', 'expectedRevision'], { operation: { enum: ['start', 'pause', 'resume', 'stop'] }, confirmed, expectedRevision: { type: 'string', minLength: 1 }, timerId: { type: 'string', minLength: 1 }, notePath: { type: 'string', minLength: 1 }, operationId: { type: 'string', minLength: 1 } }), allOf: [{ if: { required: ['operation'], properties: { operation: { const: 'start' } } }, then: { required: ['notePath'] } }, { if: { required: ['operation'], properties: { operation: { enum: ['pause', 'resume', 'stop'] } } }, then: { required: ['timerId'] } }] }
export const noteDurationSchema = strictObject(['path', 'durationMs', 'confirmed', 'expectedRevision'], { path: { type: 'string', minLength: 1 }, durationMs: { type: 'integer', minimum: 0, maximum: 2678400000 }, confirmed, expectedRevision: { type: 'string', minLength: 1 }, operationId: { type: 'string', minLength: 1 } })
export const durationMutationSchema = noteDurationSchema
export const noteGetSchema = strictObject(['path'], { path: { type: 'string', minLength: 1 } })
const typeMatches = (value, type) => type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type
const conditionMatches = (value, condition) => validateSchema(value, condition)
export function validateSchema(value, schema) {
  if (schema.type && !typeMatches(value, schema.type)) return false
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) return false
  if (Object.hasOwn(schema, 'const') && !Object.is(schema.const, value)) return false
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) return false
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return false
  if (schema.type === 'object' || (!schema.type && value !== null && typeof value === 'object' && !Array.isArray(value))) {
    if ((schema.required ?? []).some(key => !Object.hasOwn(value, key))) return false
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties ?? {}, key))) return false
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key) && !validateSchema(value[key], propertySchema)) return false
  }
  for (const branch of schema.allOf ?? []) if (branch.if && conditionMatches(value, branch.if) && !validateSchema(value, branch.then ?? {})) return false
  return true
}
export const routes = ['/api/v1/status', '/api/v1/capabilities', '/api/v1/timers', '/api/v1/notes', '/api/v1/notes/get', '/api/v1/profiles', '/api/v1/config', '/api/v1/notifications', '/api/v1/stats', '/api/v1/reports/preview', '/api/v1/timers/mutate', '/api/v1/notes/update-duration']
