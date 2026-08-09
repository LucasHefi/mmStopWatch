import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, readDir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { parseFrontmatter, parseTimeToMs } from './frontmatterParser';
import type { Session } from '../types/session';

export { parseFrontmatter, parseTimeToMs };

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

function isIgnoredNotesDirectory(name: string): boolean {
  const normalized = name
  return normalized.startsWith('.') || normalized === 'node_modules'
}

function isSafeNotesEntryName(name: string): boolean {
  return Boolean(name)
    && name !== '.'
    && name !== '..'
    && !/[\u0000-\u001f\u007f/\\]/.test(name)
}

export async function loadNotesFromFolder(folderPath: string, frontmatterKey: string, timeEstimateKey?: string, statsFieldKeys?: string[]): Promise<Session[]> {
  const sessions: Session[] = []
  await collectMdFiles(folderPath, folderPath, sessions, frontmatterKey, timeEstimateKey, statsFieldKeys, true)
  return sessions
}

async function collectMdFiles(root: string, dir: string, sessions: Session[], frontmatterKey: string, timeEstimateKey?: string, statsFieldKeys?: string[], isRoot = false) {
  let entries
  try {
    entries = await readDir(dir)
  } catch (error) {
    if (isRoot) throw error
    console.warn('Skipping inaccessible notes directory', dir, error)
    return
  }

  for (const entry of entries) {
    const name = entry.name || ''
    if (!isSafeNotesEntryName(name)) continue
    const fullPath = dir + '/' + name
    if (!fullPath.startsWith(root === '/' ? '/' : root + '/')) continue
    if (entry.isDirectory && !entry.isSymlink) {
      if (!isIgnoredNotesDirectory(name)) {
        await collectMdFiles(root, fullPath, sessions, frontmatterKey, timeEstimateKey, statsFieldKeys)
      }
    } else if (entry.isFile && !entry.isSymlink && name.toLowerCase().endsWith('.md')) {
      try {
        const content = await readTextFile(fullPath)
        const { data, content: rest } = parseFrontmatter(content)
        const timeValue = data[frontmatterKey]
        let duration = 0
        let parseError: string | undefined
        if (timeValue != null) {
          const res = parseTimeToMs(String(timeValue))
          duration = res.ms
          parseError = res.error
        }
        const relativePath = fullPath.startsWith(root + '/') ? fullPath.substring(root.length + 1) : name
        const previewLines = rest.trim().split('\n').slice(0, 3).join(' ').trim()
        const preview = previewLines.length > 120 ? previewLines.substring(0, 117) + '...' : previewLines || undefined
        const ek = timeEstimateKey || 'timeEstimate'
        const timeEstimate = data[ek] != null ? Number(data[ek]) : undefined
        const frontmatterFields: Record<string, string | string[]> = {}
        if (statsFieldKeys) {
          for (const key of statsFieldKeys) if (data[key] != null) frontmatterFields[key] = data[key] as string | string[]
        }
        const session: Session = {
          id: fullPath,
          name,
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
          timeEstimate,
        }
        sessions.push(session)
      } catch (error) {
        console.warn('Skipping unreadable Markdown note', fullPath, error)
      }
    }
  }
}
