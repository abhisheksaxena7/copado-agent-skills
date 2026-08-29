import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

test('catalog and portable skill schema validate', () => {
  execFileSync(process.execPath, ['scripts/validate-catalog.mjs'], { stdio: 'inherit' });
});

test('schema-backed validator accepts an independent second skill and rejects drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'copado-catalog-fixture-'));
  const skillDir = join(root, 'skills', 'copado-example-review');
  mkdirSync(skillDir, { recursive: true });
  copyFileSync('catalog.schema.json', join(root, 'catalog.schema.json'));
  writeFileSync(join(skillDir, 'VERSION'), '0.1.0\n');
  writeFileSync(join(skillDir, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n## 0.1.0 - 2026-08-28\n\n- Initial fixture.\n');
  writeFileSync(join(skillDir, 'SKILL.md'), `---
name: copado-example-review
description: Reviews fictional Copado examples. Use when validating that the catalog supports a second independent skill.
license: MIT
compatibility: Requires no external tools.
metadata:
  author: fixture-owner
  version: "0.1.0"
  domain: copado-example
---

# Copado example review

Review only fictional examples.
`);
  const catalog = {
    $schema: './catalog.schema.json',
    catalogVersion: 1,
    repository: 'https://github.com/example/copado-agent-skills',
    owner: { github: 'example', continuity: 'Test fixture' },
    skills: [{
      name: 'copado-example-review',
      version: '0.1.0',
      path: 'skills/copado-example-review',
      owners: ['fixture-owner'],
      compatibility: { cursor: true, claudeCode: true, agentSkills: 'portable' },
      releaseTag: 'copado-example-review-v0.1.0'
    }]
  };
  writeFileSync(join(root, 'catalog.json'), JSON.stringify(catalog, null, 2));
  execFileSync(process.execPath, ['scripts/validate-catalog.mjs', root], { stdio: 'inherit' });

  writeFileSync(join(root, 'catalog.json'), JSON.stringify({ ...catalog, unexpected: true }, null, 2));
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/validate-catalog.mjs', root], { stdio: 'pipe' }),
    /Command failed/
  );

  writeFileSync(join(root, 'catalog.json'), JSON.stringify(catalog, null, 2));
  writeFileSync(join(skillDir, 'SKILL.md'), readFileSync(join(skillDir, 'SKILL.md'), 'utf8').replace('version: "0.1.0"', 'version: 0.1'));
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/validate-catalog.mjs', root], { stdio: 'pipe' }),
    /Command failed/
  );
});

test('one unchanged payload installs for Cursor and Claude Code', () => {
  const root = mkdtempSync(join(tmpdir(), 'copado-skill-install-'));
  const cursor = join(root, 'cursor');
  const claude = join(root, 'claude');
  execFileSync('sh', ['install.sh', 'copado-apps-script-webapp', '--all'], {
    env: { ...process.env, CURSOR_SKILLS_DIR: cursor, CLAUDE_SKILLS_DIR: claude },
    stdio: 'inherit'
  });
  const cursorSkill = readFileSync(join(cursor, 'copado-apps-script-webapp', 'SKILL.md'));
  const claudeSkill = readFileSync(join(claude, 'copado-apps-script-webapp', 'SKILL.md'));
  assert.equal(createHash('sha256').update(cursorSkill).digest('hex'), createHash('sha256').update(claudeSkill).digest('hex'));
});

test('standard Skills CLI installs one payload for Cursor and Claude Code', () => {
  const root = mkdtempSync(join(tmpdir(), 'copado-standard-install-'));
  const cli = resolve('node_modules/.bin/skills');
  execFileSync(cli, [
    'add',
    resolve('.'),
    '--skill', 'copado-apps-script-webapp',
    '--agent', 'cursor',
    '--agent', 'claude-code',
    '--copy',
    '--yes'
  ], {
    cwd: root,
    env: { ...process.env, DISABLE_TELEMETRY: '1' },
    stdio: 'inherit'
  });
  const canonical = readFileSync(join(root, '.agents', 'skills', 'copado-apps-script-webapp', 'SKILL.md'));
  const claude = readFileSync(join(root, '.claude', 'skills', 'copado-apps-script-webapp', 'SKILL.md'));
  assert.equal(createHash('sha256').update(canonical).digest('hex'), createHash('sha256').update(claude).digest('hex'));
  assert.ok(existsSync(join(root, 'skills-lock.json')));

  const globalRoot = mkdtempSync(join(tmpdir(), 'copado-standard-global-'));
  execFileSync(cli, [
    'add',
    resolve('.'),
    '--skill', 'copado-apps-script-webapp',
    '--agent', 'cursor',
    '--agent', 'claude-code',
    '--copy',
    '--global',
    '--yes'
  ], {
    cwd: globalRoot,
    env: { ...process.env, HOME: globalRoot, DISABLE_TELEMETRY: '1' },
    stdio: 'inherit'
  });
  assert.ok(existsSync(join(globalRoot, '.agents', 'skills', 'copado-apps-script-webapp', 'SKILL.md')));
  assert.ok(existsSync(join(globalRoot, '.claude', 'skills', 'copado-apps-script-webapp', 'SKILL.md')));
});

test('fallback installer verifies a released archive checksum', () => {
  const root = mkdtempSync(join(tmpdir(), 'copado-release-install-'));
  const version = '9.9.9';
  const tag = `copado-apps-script-webapp-v${version}`;
  const archiveName = `${tag}.tar.gz`;
  const releaseDir = join(root, 'releases', tag);
  const payloadRoot = join(root, 'payload');
  const payload = join(payloadRoot, 'copado-apps-script-webapp');
  mkdirSync(releaseDir, { recursive: true });
  mkdirSync(payloadRoot, { recursive: true });
  cpSync('skills/copado-apps-script-webapp', payload, { recursive: true });
  writeFileSync(join(payload, 'VERSION'), `${version}\n`);
  writeFileSync(
    join(payload, 'SKILL.md'),
    readFileSync(join(payload, 'SKILL.md'), 'utf8').replace('version: "0.2.0"', `version: "${version}"`)
  );
  execFileSync('tar', ['-czf', join(releaseDir, archiveName), '-C', payloadRoot, 'copado-apps-script-webapp']);
  const archive = readFileSync(join(releaseDir, archiveName));
  const digest = createHash('sha256').update(archive).digest('hex');
  writeFileSync(join(releaseDir, `${archiveName}.sha256`), `${digest}  ${archiveName}\n`);

  const cursor = join(root, 'cursor');
  execFileSync('sh', ['install.sh', 'copado-apps-script-webapp', '--version', version, '--cursor'], {
    env: {
      ...process.env,
      COPADO_SKILLS_RELEASE_BASE_URL: pathToFileURL(join(root, 'releases')).href,
      CURSOR_SKILLS_DIR: cursor
    },
    stdio: 'inherit'
  });
  assert.equal(readFileSync(join(cursor, 'copado-apps-script-webapp', 'VERSION'), 'utf8').trim(), version);

  writeFileSync(join(releaseDir, `${archiveName}.sha256`), `${'0'.repeat(64)}  ${archiveName}\n`);
  assert.throws(
    () => execFileSync('sh', ['install.sh', 'copado-apps-script-webapp', '--version', version, '--claude'], {
      env: {
        ...process.env,
        COPADO_SKILLS_RELEASE_BASE_URL: pathToFileURL(join(root, 'releases')).href,
        CLAUDE_SKILLS_DIR: join(root, 'claude')
      },
      stdio: 'pipe'
    }),
    /Command failed/
  );
});

test('all profile scaffold dry-runs avoid GitHub and Google mutations', () => {
  const fixtures = JSON.parse(readFileSync('test/fixtures/profiles.json', 'utf8'));
  for (const fixture of fixtures) {
    const destination = resolve(tmpdir(), `${fixture.name}-must-not-exist`);
    const output = execFileSync('sh', [
      'skills/copado-apps-script-webapp/scripts/scaffold.sh',
      '--dry-run',
      '--profile', fixture.profile,
      '--name', fixture.name,
      '--title', fixture.title,
      '--destination', destination
    ], { encoding: 'utf8' });
    assert.match(output, /Dry run complete; no files, repositories, credentials, or deployments were changed/);
    assert.match(output, /8b7ade2f4019ae64b1b82244cbb64bd4c7955bb0/);
    assert.equal(existsSync(destination), false);
  }
});

test('scripts keep repository creation private and deployment human-gated', () => {
  const scaffold = readFileSync('skills/copado-apps-script-webapp/scripts/scaffold.sh', 'utf8');
  assert.match(scaffold, /gh repo create "\$github_repo" --private/);
  assert.match(scaffold, /\(cd "\$destination" && npm ci\)/);
  assert.doesNotMatch(scaffold, /--public/);
  assert.doesNotMatch(scaffold, /npm --prefix/);
  assert.doesNotMatch(scaffold, /clasp (login|push|deploy|redeploy)/);
  assert.match(scaffold, /git -C "\$destination" rev-parse HEAD/);
  assert.match(scaffold, /\[ "\$resolved_commit" = "\$template_commit" \]/);
  const skill = readFileSync('skills/copado-apps-script-webapp/SKILL.md', 'utf8');
  assert.match(skill, /Stop at human gates/);
  assert.match(skill, /Never ask the user to paste `CLASPRC_JSON`/);
});

test('scaffold preparation keeps package-lock metadata in sync', () => {
  const root = mkdtempSync(join(tmpdir(), 'copado-package-lock-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'template-name', version: '0.1.0' }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    name: 'template-name',
    version: '0.1.0',
    lockfileVersion: 3,
    packages: { '': { name: 'template-name', version: '0.1.0' } }
  }));
  execFileSync(process.execPath, [
    'skills/copado-apps-script-webapp/scripts/prepare-project.mjs',
    root,
    'generated-project'
  ]);
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  assert.equal(packageJson.name, 'generated-project');
  assert.equal(packageJson.private, true);
  assert.equal(packageLock.name, 'generated-project');
  assert.equal(packageLock.packages[''].name, 'generated-project');
});

test('trigger fixture is represented by portable description terms', () => {
  const skill = readFileSync('skills/copado-apps-script-webapp/SKILL.md', 'utf8');
  const description = /^description:\s*(.+)$/m.exec(skill)?.[1] || '';
  for (const term of ['Copado', 'Apps Script', 'Sheet', 'Canvas', '/exec', 'iframe']) {
    assert.match(description, new RegExp(term.replace('/', '\\/'), 'i'));
  }
  const triggers = JSON.parse(readFileSync('test/fixtures/triggers.json', 'utf8'));
  assert.ok(triggers.cursor.length > 0 && triggers.claudeCode.length > 0);
});

test('skill package contains only the self-contained skill directory', () => {
  execFileSync('sh', ['scripts/package-skill.sh', 'copado-apps-script-webapp'], { stdio: 'inherit' });
  const archive = 'dist/copado-apps-script-webapp-v0.2.0.tar.gz';
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(files.length > 5);
  assert.ok(files.every((file) => file.startsWith('copado-apps-script-webapp/')));
  assert.ok(files.includes('copado-apps-script-webapp/SKILL.md'));
  assert.ok(files.includes('copado-apps-script-webapp/template.json'));
  assert.ok(files.includes('copado-apps-script-webapp/CHANGELOG.md'));
});
