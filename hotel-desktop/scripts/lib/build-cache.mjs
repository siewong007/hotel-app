import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  '.tanstack',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'target',
  'uploads',
]);

export function formatDuration(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}m ${remainingSeconds}s`;
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path) {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

export function sameFileContent(source, target) {
  if (!existsSync(source) || !existsSync(target)) {
    return false;
  }

  const sourceStat = statSync(source);
  const targetStat = statSync(target);
  if (sourceStat.size !== targetStat.size) {
    return false;
  }

  return readFileSync(source).equals(readFileSync(target));
}

export function collectInputFiles(inputs, options = {}) {
  const baseDir = options.baseDir;
  const ignoredDirs = options.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
  const files = [];

  const visit = (path) => {
    if (!existsSync(path)) {
      return;
    }

    const stat = statSync(path);
    if (stat.isDirectory()) {
      const dirName = path.split(/[\\/]/).at(-1);
      if (ignoredDirs.has(dirName)) {
        return;
      }

      for (const entry of readdirSync(path).sort()) {
        visit(join(path, entry));
      }
      return;
    }

    if (stat.isFile()) {
      files.push(path);
    }
  };

  for (const input of inputs) {
    visit(input);
  }

  return files.sort((left, right) => {
    const leftKey = baseDir ? relative(baseDir, left) : left;
    const rightKey = baseDir ? relative(baseDir, right) : right;
    return leftKey.localeCompare(rightKey);
  });
}

export function hashInputs(inputs, options = {}) {
  const baseDir = options.baseDir;
  const hash = createHash('sha256');
  const files = collectInputFiles(inputs, options);

  for (const extra of options.extra ?? []) {
    hash.update('extra');
    hash.update('\0');
    hash.update(String(extra));
    hash.update('\0');
  }

  for (const file of files) {
    hash.update(baseDir ? relative(baseDir, file) : file);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }

  return {
    digest: hash.digest('hex'),
    fileCount: files.length,
  };
}

export function selectedEnvironment(prefixes) {
  return Object.entries(process.env)
    .filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value ?? ''}`);
}
