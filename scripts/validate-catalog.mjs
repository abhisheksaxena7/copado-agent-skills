import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import YAML from 'yaml';

const root = resolve(process.argv[2] || '.');
const problems = [];
const officialFields = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools'
]);
const skillNamePattern = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/;

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    problems.push(`${label}: invalid or missing JSON (${error.message})`);
    return null;
  }
}

async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function parseFrontmatter(source, name) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) {
    problems.push(`${name}: SKILL.md needs YAML frontmatter`);
    return null;
  }
  const document = YAML.parseDocument(match[1]);
  if (document.errors.length) {
    problems.push(`${name}: invalid YAML frontmatter (${document.errors.map((error) => error.message).join('; ')})`);
    return null;
  }
  const frontmatter = document.toJS();
  if (!frontmatter || Array.isArray(frontmatter) || typeof frontmatter !== 'object') {
    problems.push(`${name}: frontmatter must be a YAML mapping`);
    return null;
  }
  return frontmatter;
}

function validateFrontmatter(frontmatter, entry) {
  const prefix = entry.name;
  for (const field of Object.keys(frontmatter)) {
    if (!officialFields.has(field)) problems.push(`${prefix}: unsupported Agent Skills field ${field}`);
  }
  if (frontmatter.name !== entry.name || !skillNamePattern.test(frontmatter.name || '')) {
    problems.push(`${prefix}: frontmatter name must match its valid directory name`);
  }
  if (typeof frontmatter.description !== 'string' || frontmatter.description.length < 1 || frontmatter.description.length > 1024) {
    problems.push(`${prefix}: description must be 1-1024 characters`);
  }
  if (frontmatter.license !== undefined && (typeof frontmatter.license !== 'string' || !frontmatter.license.trim())) {
    problems.push(`${prefix}: license must be a non-empty string`);
  }
  if (frontmatter.compatibility !== undefined &&
      (typeof frontmatter.compatibility !== 'string' || frontmatter.compatibility.length < 1 || frontmatter.compatibility.length > 500)) {
    problems.push(`${prefix}: compatibility must be a 1-500 character string`);
  }
  if (frontmatter.metadata !== undefined) {
    if (!frontmatter.metadata || Array.isArray(frontmatter.metadata) || typeof frontmatter.metadata !== 'object') {
      problems.push(`${prefix}: metadata must be a string-to-string mapping`);
    } else {
      for (const [key, value] of Object.entries(frontmatter.metadata)) {
        if (!key || typeof value !== 'string') problems.push(`${prefix}: metadata keys and values must be strings`);
      }
      if (frontmatter.metadata.version !== entry.version) {
        problems.push(`${prefix}: metadata.version must match catalog and VERSION`);
      }
    }
  }
  if (frontmatter['allowed-tools'] !== undefined && typeof frontmatter['allowed-tools'] !== 'string') {
    problems.push(`${prefix}: allowed-tools must be a space-separated string`);
  }
}

const catalog = await readJson(resolve(root, 'catalog.json'), 'catalog.json');
const schema = await readJson(resolve(root, 'catalog.schema.json'), 'catalog.schema.json');
if (!catalog || !schema) {
  console.error('Catalog validation failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);
if (!validateSchema(catalog)) {
  for (const error of validateSchema.errors || []) {
    problems.push(`catalog.json${error.instancePath || '/'} ${error.message}`);
  }
}

const names = new Set();
const tags = new Set();
for (const entry of catalog.skills || []) {
  if (names.has(entry.name)) problems.push(`duplicate skill name: ${entry.name}`);
  names.add(entry.name);
  if (tags.has(entry.releaseTag)) problems.push(`duplicate release tag: ${entry.releaseTag}`);
  tags.add(entry.releaseTag);

  const expectedPath = `skills/${entry.name}`;
  if (entry.path !== expectedPath) problems.push(`${entry.name}: path must be ${expectedPath}`);
  const expectedTag = `${entry.name}-v${entry.version}`;
  if (entry.releaseTag !== expectedTag) problems.push(`${entry.name}: releaseTag must be ${expectedTag}`);
  if (entry.compatibility?.cursor !== true || entry.compatibility?.claudeCode !== true || entry.compatibility?.agentSkills !== 'portable') {
    problems.push(`${entry.name}: portable Cursor/Claude compatibility metadata is required`);
  }

  const skillDir = resolve(root, entry.path);
  const skillFile = resolve(skillDir, 'SKILL.md');
  try {
    const source = await readFile(skillFile, 'utf8');
    const frontmatter = parseFrontmatter(source, entry.name);
    if (frontmatter) validateFrontmatter(frontmatter, entry);
    if (source.split(/\r?\n/).length > 500) problems.push(`${entry.name}: SKILL.md exceeds 500 lines`);

    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^[a-z]+:\/\//i.test(link) || link.startsWith('#')) continue;
      if (link.startsWith('/') || link.includes('..') || link.split('/').length > 2) {
        problems.push(`${entry.name}: non-portable or deeply nested link ${link}`);
        continue;
      }
      try {
        await access(resolve(skillDir, link), constants.F_OK);
      } catch {
        problems.push(`${entry.name}: broken link ${link}`);
      }
    }
  } catch {
    problems.push(`${entry.name}: missing SKILL.md`);
  }

  try {
    const version = (await readFile(resolve(skillDir, 'VERSION'), 'utf8')).trim();
    if (version !== entry.version) problems.push(`${entry.name}: VERSION does not match catalog`);
  } catch {
    problems.push(`${entry.name}: missing VERSION`);
  }
  try {
    const changelog = await readFile(resolve(skillDir, 'CHANGELOG.md'), 'utf8');
    if (!/^## Unreleased\s*$/m.test(changelog)) problems.push(`${entry.name}: CHANGELOG.md needs an Unreleased section`);
    if (!new RegExp(`^## ${entry.version.replaceAll('.', '\\.')} - \\d{4}-\\d{2}-\\d{2}\\s*$`, 'm').test(changelog)) {
      problems.push(`${entry.name}: CHANGELOG.md needs a dated ${entry.version} section`);
    }
  } catch {
    problems.push(`${entry.name}: missing CHANGELOG.md`);
  }

  try {
    for (const file of await walkFiles(skillDir)) {
      const content = await readFile(file, 'utf8');
      if (/\/Users\/|[A-Za-z]:\\|script\.google\.com\/(?:macros\/s|d)\/|AKfy[A-Za-z0-9_-]+|\.clasprc\.json["']?\s*:\s*[{[]/.test(content)) {
        problems.push(`${entry.name}: sensitive content detected in ${relative(skillDir, file).split(sep).join('/')}`);
      }
      if (file.endsWith('.sh')) {
        const info = await stat(file);
        const scriptName = relative(skillDir, file).split(sep).join('/');
        if (!(info.mode & 0o111)) problems.push(`${entry.name}: ${scriptName} must be executable`);
        if (!content.startsWith('#!/usr/bin/env sh')) problems.push(`${entry.name}: ${scriptName} must use portable POSIX shell`);
      }
    }
  } catch (error) {
    problems.push(`${entry.name}: unable to inspect skill files (${error.message})`);
  }

  if (entry.name === 'copado-apps-script-webapp') {
    const template = await readJson(resolve(skillDir, 'template.json'), `${entry.name}/template.json`);
    if (template) {
      if (template.repository !== 'https://github.com/abhisheksaxena7/copado-apps-script-webapp-template.git') {
        problems.push(`${entry.name}: unexpected template repository`);
      }
      if (!/^v\d+\.\d+\.\d+$/.test(template.version || '')) {
        problems.push(`${entry.name}: template version must be an immutable vX.Y.Z tag`);
      }
      if (!/^[0-9a-f]{40}$/.test(template.commit || '')) {
        problems.push(`${entry.name}: template commit must be a full 40-character SHA`);
      }
    }

    for (const scriptName of ['preflight.sh', 'scaffold.sh', 'verify-project.sh']) {
      try {
        await access(resolve(skillDir, 'scripts', scriptName), constants.X_OK);
      } catch {
        problems.push(`${entry.name}: missing executable scripts/${scriptName}`);
      }
    }
    try {
      const helper = await readFile(resolve(skillDir, 'scripts/prepare-project.mjs'), 'utf8');
      if (!helper.includes('package-lock.json') || !helper.includes("packages?.['']")) {
        problems.push(`${entry.name}: prepare-project.mjs must synchronize package-lock metadata`);
      }
    } catch {
      problems.push(`${entry.name}: missing scripts/prepare-project.mjs`);
    }
  }
}

try {
  const workflowDir = resolve(root, '.github', 'workflows');
  for (const entry of await readdir(workflowDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const workflow = await readFile(resolve(workflowDir, entry.name), 'utf8');
    const document = YAML.parseDocument(workflow);
    if (document.errors.length) {
      problems.push(`${entry.name}: invalid workflow YAML (${document.errors.map((error) => error.message).join('; ')})`);
    }
    for (const match of workflow.matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/g)) {
      if (!/^[0-9a-f]{40}$/.test(match[2])) {
        problems.push(`${entry.name}: third-party action ${match[1]} must be pinned to a full commit SHA`);
      }
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') problems.push(`unable to inspect GitHub workflows (${error.message})`);
}

if (problems.length) {
  console.error('Catalog validation failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Catalog valid: ${catalog.skills.length} portable skill(s), schema, frontmatter, versions, links, and scripts verified.`);
