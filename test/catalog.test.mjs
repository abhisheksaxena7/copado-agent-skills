import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('catalog and portable skill schema validate', () => {
  execFileSync(process.execPath, ['scripts/validate-catalog.mjs'], { stdio: 'inherit' });
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
  const archive = 'dist/copado-apps-script-webapp-v0.1.2.tar.gz';
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(files.length > 5);
  assert.ok(files.every((file) => file.startsWith('copado-apps-script-webapp/')));
  assert.ok(files.includes('copado-apps-script-webapp/SKILL.md'));
  assert.ok(files.includes('copado-apps-script-webapp/template.json'));
});
