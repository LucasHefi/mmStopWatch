import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, readDir, BaseDirectory } from '@tauri-apps/plugin-fs';
import type { Session } from '../types/session';

export interface FolderSelectionResult {
  folder: string;
  vaultName: string | null;
}

export async function selectNotesFolder(): Promise<FolderSelectionResult | null> {
  const selected = await open({ directory: true });
  if (!selected) return null;
  
  const vaultName = await detectObsidianVaultName(selected);
  return { folder: selected as string, vaultName };
}

async function detectObsidianVaultName(folderPath: string): Promise<string | null> {
  try {
    const appJsonPath = `${folderPath}/.obsidian/app.json`;
    const content = await readTextFile(appJsonPath, { baseDir: BaseDirectory.AppData });
    const data = JSON.parse(content);
    return data.vaultName || data.vault || null;
  } catch {
    return null;
  }
}

export function parseFrontmatter(content: string): { data: Record<string, unknown>; content: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);
  if (!match) return { data: {}, content };
  
  const yaml = match[1];
  const data: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  
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
    
    // If we were in a multiline value, save it
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
    
    // Check for multiline string (| or >)
    if (value === '|' || value === '>') {
      inMultiline = true
      currentKey = key
      currentValue = []
      // Find indent of next line
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]
        multilineIndent = nextLine.length - nextLine.trimStart().length
      }
      continue
    }
    
    // Check for array continuation (lines starting with -)
    if (value.startsWith('-')) {
      // This is an inline array or first item of multiline array
      const items = value.split(',').map(v => v.trim().replace(/^-\s*/, '').replace(/['"]/g, ''))
      data[key] = items
      continue
    }
    
    // Handle empty values (defer for potential multiline array)
    if (!value) {
      currentKey = key
      currentValue = []
      inArray = true
      continue
    }
    if (value === 'null' || value === '~') {
      data[key] = null
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Inline array
      const items = value.slice(1, -1).trim()
      data[key] = items ? items.split(',').map(v => v.trim().replace(/['"]/g, '')) : []
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      // Quoted string
      data[key] = value.slice(1, -1)
    } else if (!isNaN(Number(value)) && value !== '') {
      // Number (but not empty string)
      data[key] = Number(value)
    } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      // Boolean
      data[key] = value.toLowerCase() === 'true'
    } else {
      // Plain string
      data[key] = value
    }
  }
  
  // Save any remaining multiline value
  if (inMultiline && currentKey) {
    data[currentKey] = parseYamlValue(currentValue.join('\n'))
  }
  if (inArray && currentKey) {
    data[currentKey] = currentValue.length > 0 ? currentValue : null
  }
  
  const restContent = content.substring(match[0].length)
  return { data, content: restContent }
}

function parseYamlValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  
  // Try to parse as array (lines starting with -)
  const lines = trimmed.split('\n')
  if (lines.every(l => l.trim().startsWith('-'))) {
    return lines.map(l => l.trim().replace(/^-\s*/, '').replace(/['"]/g, ''))
  }
  
  // Return as string
  return trimmed
}

export function updateFrontmatter(content: string, key: string, value: string | number | string[] | number[]): string {
  // Handle number values (timeEstimate)
  if (typeof value === 'number') {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = content.match(frontmatterRegex);
    if (!match) {
      return `---\n${key}: ${value}\n---\n` + content;
    }
    const yamlBlock = match[1];
    const rest = content.substring(match[0].length);
    const lines = yamlBlock.split('\n');
    let found = false;
    const newLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith(key + ':')) {
        found = true;
        return `${key}: ${value}`;
      }
      return line;
    });
    if (!found) {
      newLines.push(`${key}: ${value}`);
    }
    const newYaml = '---\n' + newLines.join('\n') + '\n---\n';
    return newYaml + rest;
  }
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);
  if (!match) {
    const val = Array.isArray(value) ? `[${value.join(', ')}]` : value;
    return `---\n${key}: ${val}\n---\n` + content;
  }
  const yamlBlock = match[1];
  const rest = content.substring(match[0].length);
  const lines = yamlBlock.split('\n');
  let found = false;
  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith(key + ':')) {
      found = true;
      const val = Array.isArray(value) ? `[${value.join(', ')}]` : value;
      return `${key}: ${val}`;
    }
    return line;
  });
  if (!found) {
    const val = Array.isArray(value) ? `[${value.join(', ')}]` : value;
    newLines.push(`${key}: ${val}`);
  }
  const newYaml = '---\n' + newLines.join('\n') + '\n---\n';
  return newYaml + rest;
}

export async function loadNotesFromFolder(folderPath: string, frontmatterKey: string, timeEstimateKey?: string, statsFieldKeys?: string[]): Promise<Session[]> {
  const sessions: Session[] = [];
  await collectMdFiles(folderPath, folderPath, sessions, frontmatterKey, timeEstimateKey, statsFieldKeys);
  return sessions;
}

async function collectMdFiles(root: string, dir: string, sessions: Session[], frontmatterKey: string, timeEstimateKey?: string, statsFieldKeys?: string[]) {
  const entries = await readDir(dir);
  for (const entry of entries) {
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      await collectMdFiles(root, fullPath, sessions, frontmatterKey, timeEstimateKey, statsFieldKeys);
    } else if (entry.isFile && entry.name?.endsWith('.md')) {
      try {
        const content = await readTextFile(fullPath);
        const { data, content: rest } = parseFrontmatter(content);
        const timeValue = data[frontmatterKey];
        let duration = 0;
        let parseError: string | undefined;
        if (timeValue != null) {
          const res = parseTimeToMs(String(timeValue));
          duration = res.ms;
          parseError = res.error;
        }
        const relativePath = fullPath.startsWith(root + '/') ? fullPath.substring(root.length + 1) : entry.name;
        const previewLines = rest.trim().split('\n').slice(0, 3).join(' ').trim();
        const preview = previewLines.length > 120 ? previewLines.substring(0, 117) + '...' : previewLines || undefined;
        const ek = timeEstimateKey || 'timeEstimate'
        const timeEstimate = data[ek] != null ? Number(data[ek]) : undefined;

        const frontmatterFields: Record<string, string | string[]> = {}
        if (statsFieldKeys) {
          for (const key of statsFieldKeys) {
            if (data[key] != null) {
              frontmatterFields[key] = data[key] as string | string[]
            }
          }
        }
        
        const session: Session = {
          id: fullPath,
          name: entry.name.replace('.md', ''),
          started_at: Date.now(),
          ended_at: Date.now(),
          duration_ms: duration,
          created_at: Date.now(),
          tags: Array.isArray(data.tags) ? data.tags : (data.tags && typeof data.tags === 'string' ? [data.tags] : []),
          notePath: fullPath,
          frontmatterKey,
          parseError,
          relativePath,
          preview,
          frontmatterFields: Object.keys(frontmatterFields).length > 0 ? frontmatterFields : undefined,
        };
        // Store timeEstimate in frontmatter data for later access
        session.timeEstimate = timeEstimate;
        sessions.push(session);
      } catch (e) {
        console.error(`Failed to parse ${entry.name}`, e);
      }
    }
  }
}

export function parseTimeToMs(timeStr: string): { ms: number; error?: string } {
  const trimmed = timeStr.trim();
  if (!trimmed) return { ms: 0, error: 'Empty time value' };
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map(p => p.trim());
    if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) {
      return { ms: 0, error: 'Invalid time format' };
    }
    const nums = parts.map(Number);
    if (nums.some(n => n < 0)) return { ms: 0, error: 'Negative time not allowed' };
    return { ms: ((nums[0] || 0) * 3600 + (nums[1] || 0) * 60 + (nums[2] || 0)) * 1000 };
  }
  const num = Number(trimmed);
  if (isNaN(num) || num < 0) return { ms: 0, error: 'Invalid time format' };
  return { ms: num * 1000 };
}

