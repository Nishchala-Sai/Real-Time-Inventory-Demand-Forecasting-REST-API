import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { listRoutes } from './helpers.js';

function documentedRoutes() {
  const yaml = readFileSync(new URL('../../docs/openapi.yaml', import.meta.url), 'utf8');
  const routes = [];
  let inPaths = false;
  let path = null;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPaths = line.startsWith('paths:');
    if (!inPaths) continue;
    const pathMatch = line.match(/^ {2}(\/\S*):/);
    if (pathMatch) path = pathMatch[1];
    const methodMatch = line.match(/^ {4}(get|post|patch|put|delete):/);
    if (methodMatch) routes.push(`${methodMatch[1]} /api/v1${path}`);
  }
  return routes.sort();
}

describe('openapi.yaml', () => {
  it('documents exactly the routes the app serves', () => {
    const served = listRoutes(createApp())
      .map(({ method, path }) => `${method} ${path.replace(/:(\w+)/g, '{$1}')}`)
      .sort();
    expect(documentedRoutes()).toEqual(served);
  });
});
