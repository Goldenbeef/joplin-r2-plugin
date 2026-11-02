import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// 1. Bundle the official Joplin API proxy with the AWS SDK; built-ins remain provided by desktop Node.
await mkdir('dist', { recursive: true });
await mkdir('publish', { recursive: true });
await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'node', target: 'node20', format: 'cjs', outfile: 'dist/index.js' });
await copyFile('src/manifest.json', 'dist/manifest.json');
// 2. JPL is a tar archive with index.js and manifest.json at its root, matching the official generator format.
const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
const archive = `publish/${manifest.id}.jpl`;
execFileSync('tar', ['-cf', archive, '-C', 'dist', 'index.js', 'manifest.json']);
// 3. Publish a checksum for the exact local artifact; no credentials are included in the archive.
const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(archive + '.sha256', `${hash}  ${manifest.id}.jpl\n`);
console.log(`Built ${archive}\nSHA256 ${hash}`);
