import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const catalog = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8'));
const problems = [];
const names = new Set();
const tags = new Set();

if (!Number.isInteger(catalog.catalogVersion) || catalog.catalogVersion < 1) problems.push('catalogVersion must be a positive integer');
if (!catalog.owner?.github || !catalog.owner?.continuity) problems.push('catalog owner and continuity metadata are required');
if (!Array.isArray(catalog.skills) || !catalog.skills.length) problems.push('catalog must contain at least one skill');

for (const entry of catalog.skills || []) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.name || '')) problems.push(`invalid skill name: ${entry.name}`);
  if (names.has(entry.name)) problems.push(`duplicate skill name: ${entry.name}`);
  names.add(entry.name);
  if (!/^\d+\.\d+\.\d+$/.test(entry.version || '')) problems.push(`${entry.name}: version must be X.Y.Z`);
  const expectedPath = `skills/${entry.name}`;
  if (entry.path !== expectedPath) problems.push(`${entry.name}: path must be ${expectedPath}`);
  const expectedTag = `${entry.name}-v${entry.version}`;
  if (entry.releaseTag !== expectedTag) problems.push(`${entry.name}: releaseTag must be ${expectedTag}`);
  if (tags.has(entry.releaseTag)) problems.push(`duplicate release tag: ${entry.releaseTag}`);
  tags.add(entry.releaseTag);
  if (!entry.owners?.length) problems.push(`${entry.name}: at least one owner is required`);
  if (entry.compatibility?.cursor !== true || entry.compatibility?.claudeCode !== true || entry.compatibility?.agentSkills !== 'portable') {
    problems.push(`${entry.name}: portable Cursor/Claude compatibility metadata is required`);
  }

  const skillDir = resolve(root, entry.path);
  const skillFile = resolve(skillDir, 'SKILL.md');
  try {
    const source = await readFile(skillFile, 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source);
    if (!frontmatter) {
      problems.push(`${entry.name}: SKILL.md needs YAML frontmatter`);
    } else {
      const fields = frontmatter[1].split('\n').filter(Boolean).map((line) => line.split(':', 1)[0].trim());
      if (fields.join(',') !== 'name,description') problems.push(`${entry.name}: portable frontmatter must contain only name and description`);
      if (!frontmatter[1].includes(`name: ${entry.name}`)) problems.push(`${entry.name}: frontmatter name mismatch`);
      const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
      if (!description || description.length > 1024) problems.push(`${entry.name}: description must be 1-1024 characters`);
    }
    if (source.split('\n').length > 500) problems.push(`${entry.name}: SKILL.md exceeds 500 lines`);
    if (/\/Users\/|[A-Za-z]:\\|\.clasprc\.json["']?\s*:\s*[{[]/.test(source)) problems.push(`${entry.name}: machine path or credential content detected`);

    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^[a-z]+:\/\//i.test(link) || link.startsWith('#')) continue;
      if (link.startsWith('/') || link.includes('..')) {
        problems.push(`${entry.name}: non-portable link ${link}`);
        continue;
      }
      try { await access(resolve(skillDir, link), constants.F_OK); } catch { problems.push(`${entry.name}: broken link ${link}`); }
    }
  } catch {
    problems.push(`${entry.name}: missing SKILL.md`);
  }

  try {
    const version = (await readFile(resolve(skillDir, 'VERSION'), 'utf8')).trim();
    if (version !== entry.version) problems.push(`${entry.name}: VERSION does not match catalog`);
  } catch { problems.push(`${entry.name}: missing VERSION`); }

  if (entry.name === 'copado-apps-script-webapp') {
    try {
      const template = JSON.parse(await readFile(resolve(skillDir, 'template.json'), 'utf8'));
      if (template.repository !== 'https://github.com/abhisheksaxena7/copado-apps-script-webapp-template.git') problems.push('unexpected template repository');
      if (!/^v\d+\.\d+\.\d+$/.test(template.version || '')) problems.push('template version must be an immutable vX.Y.Z tag');
    } catch { problems.push('Apps Script skill needs valid template.json'); }
  }

  for (const scriptName of ['preflight.sh', 'scaffold.sh', 'verify-project.sh']) {
    const scriptPath = resolve(skillDir, 'scripts', scriptName);
    try {
      const info = await stat(scriptPath);
      if (!(info.mode & 0o111)) problems.push(`${entry.name}: ${scriptName} must be executable`);
      const script = await readFile(scriptPath, 'utf8');
      if (!script.startsWith('#!/usr/bin/env sh')) problems.push(`${entry.name}: ${scriptName} must use portable POSIX shell`);
    } catch { problems.push(`${entry.name}: missing scripts/${scriptName}`); }
  }
}

if (problems.length) {
  console.error('Catalog validation failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Catalog valid: ${catalog.skills.length} portable skill(s), unique versions/tags, links and scripts verified.`);
