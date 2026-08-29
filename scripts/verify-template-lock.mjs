import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const templatePath = resolve(
  root,
  process.argv[3] || 'skills/copado-apps-script-webapp/template.json'
);
const template = JSON.parse(await readFile(templatePath, 'utf8'));

if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(template.repository || '')) {
  throw new Error('Template repository must be an HTTPS GitHub clone URL ending in .git.');
}
if (!/^v\d+\.\d+\.\d+$/.test(template.version || '')) {
  throw new Error('Template version must be a semantic vX.Y.Z tag.');
}
if (!/^[0-9a-f]{40}$/.test(template.commit || '')) {
  throw new Error('Template commit must be a full 40-character SHA.');
}

const tagRef = `refs/tags/${template.version}`;
const peeledRef = `${tagRef}^{}`;
const output = execFileSync(
  'git',
  ['ls-remote', template.repository, peeledRef, tagRef],
  { encoding: 'utf8' }
);
const refs = new Map(
  output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [commit, ref] = line.split(/\s+/);
    return [ref, commit];
  })
);
const resolved = refs.get(peeledRef) || refs.get(tagRef);
if (!resolved) throw new Error(`Template tag not found: ${template.version}`);
if (resolved !== template.commit) {
  throw new Error(
    `Template lock mismatch: ${template.version} resolves to ${resolved}, expected ${template.commit}.`
  );
}

console.log(`Template lock verified: ${template.repository}@${template.version} (${template.commit})`);
