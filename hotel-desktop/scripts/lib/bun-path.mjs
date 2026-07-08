import { dirname } from 'node:path';

export function envWithBunOnPath(env = process.env) {
  const bunExecPath = env.npm_execpath;

  if (!bunExecPath || !/bun(?:\.exe)?$/i.test(bunExecPath)) {
    return env;
  }

  const separator = process.platform === 'win32' ? ';' : ':';
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = env[pathKey] ?? '';
  const bunDir = dirname(bunExecPath);

  if (!bunDir || currentPath.split(separator).includes(bunDir)) {
    return env;
  }

  return {
    ...env,
    [pathKey]: `${bunDir}${separator}${currentPath}`,
  };
}
