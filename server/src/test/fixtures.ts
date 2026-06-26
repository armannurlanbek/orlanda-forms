// Fixture loader for tests. vitest runs with cwd = server/, so fixtures live at
// <cwd>/fixtures. No network access.
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures');

export function fixturePath(...parts: string[]): string {
  return path.join(FIXTURE_DIR, ...parts);
}

export function loadJsonFixture<T = unknown>(name: string): T {
  return JSON.parse(fs.readFileSync(fixturePath(name), 'utf8')) as T;
}

export function loadFileFixture(...parts: string[]): Buffer {
  return fs.readFileSync(fixturePath(...parts));
}
