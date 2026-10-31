// Preserve the established public pipeline; only the pinned preview project
// selects the protected settlement review as its primary deployment.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBuildPolicy } from './build-policy.mjs';

export const PUBLIC_BUILD_STEPS = Object.freeze([
  ['python3', 'scripts/build-player-guide.py'],
  ['node', 'scripts/build-guide-site.mjs'],
  ['node', 'scripts/build-prelaunch.mjs'],
  ['node', 'scripts/polish-player-guide.mjs'],
  ['python3', 'scripts/build-public-guide.py'],
  ['python3', 'scripts/build-reward-first.py'],
  ['node', 'scripts/build-season-status.mjs'],
].map(step => Object.freeze(step)));

export function getBuildSteps(env = process.env) {
  return getBuildPolicy(env).dedicatedPreview
    ? [['node', 'settlement-integration/build-review.mjs']]
    : PUBLIC_BUILD_STEPS;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const [executable, script] of getBuildSteps()) {
    const result = spawnSync(executable, [script], { cwd: root, env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
