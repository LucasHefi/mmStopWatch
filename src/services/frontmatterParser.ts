function parseYamlValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const lines = trimmed.split('\n')
  if (lines.every(l => l.trim().startsWith('-'))) {
    return lines.map(l => l.trim().replace(/^-\s*/, '').replace(/['"]/g, ''))
  }

  return trimmed
}

export function parseFrontmatter(content: string): { data: Record<string, unknown>; content: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/
  const match = content.match(frontmatterRegex)
  if (!match) return { data: {}, content }

  const yaml = match[1]
  const data: Record<string, unknown> = {}
  const lines = yaml.split('\n')

  let currentKey: string | null = null
  let currentValue: string[] = []
  let inMultiline = false
  let inArray = false
  let multilineIndent = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      if (inMultiline) {
        currentValue.push(line)
      }
      continue
    }

    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) {
      if (inMultiline && line.length > multilineIndent) {
        currentValue.push(line.substring(multilineIndent))
      }
      if (inArray && line.length > 0 && trimmed.startsWith('-')) {
        currentValue.push(trimmed.replace(/^-\s*/, '').replace(/['"]/g, ''))
      }
      continue
    }

    if (inMultiline && currentKey) {
      data[currentKey] = parseYamlValue(currentValue.join('\n'))
      inMultiline = false
      currentKey = null
      currentValue = []
    }
    if (inArray && currentKey) {
      data[currentKey] = currentValue.length > 0 ? currentValue : null
      inArray = false
      currentKey = null
      currentValue = []
    }

    const key = trimmed.substring(0, colonIndex).trim()
    let value = trimmed.substring(colonIndex + 1).trim()

    if (value === '|' || value === '>') {
      inMultiline = true
      currentKey = key
      currentValue = []
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]
        multilineIndent = nextLine.length - nextLine.trimStart().length
      }
      continue
    }

    if (value.startsWith('-')) {
      const items = value.split(',').map(v => v.trim().replace(/^-\s*/, '').replace(/['"]/g, ''))
      data[key] = items
      continue
    }

    if (!value) {
      currentKey = key
      currentValue = []
      inArray = true
      continue
    }
    if (value === 'null' || value === '~') {
      data[key] = null
    } else if (value.startsWith('[') && value.endsWith(']')) {
      const items = value.slice(1, -1).trim()
      data[key] = items ? items.split(',').map(v => v.trim().replace(/['"]/g, '')) : []
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      data[key] = value.slice(1, -1)
    } else if (!isNaN(Number(value)) && value !== '') {
      data[key] = Number(value)
    } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      data[key] = value.toLowerCase() === 'true'
    } else {
      data[key] = value
    }
  }

  if (inMultiline && currentKey) {
    data[currentKey] = parseYamlValue(currentValue.join('\n'))
  }
  if (inArray && currentKey) {
    data[currentKey] = currentValue.length > 0 ? currentValue : null
  }

  const restContent = content.substring(match[0].length)
  return { data, content: restContent }
}

export function parseTimeToMs(timeStr: string): { ms: number; error?: string } {
  const trimmed = timeStr.trim()
  if (!trimmed) return { ms: 0, error: 'Empty time value' }
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map(p => p.trim())
    if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) {
      return { ms: 0, error: 'Invalid time format' }
    }
    const nums = parts.map(Number)
    if (nums.some(n => n < 0)) return { ms: 0, error: 'Negative time not allowed' }
    return { ms: ((nums[0] || 0) * 3600 + (nums[1] || 0) * 60 + (nums[2] || 0)) * 1000 }
  }
  const num = Number(trimmed)
  if (isNaN(num) || num < 0) return { ms: 0, error: 'Invalid time format' }
  return { ms: num * 1000 }
}
