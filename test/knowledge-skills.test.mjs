import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const catalog = JSON.parse(readFileSync('catalog.json', 'utf8'));
const triggers = JSON.parse(readFileSync('test/fixtures/knowledge-skill-triggers.json', 'utf8'));
const names = Object.keys(triggers);

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

const files = (name) => walk(join('skills', name));
const read = (path) => readFileSync(path, 'utf8');

test('every knowledge skill is catalogued, versioned, and changelogged', () => {
  for (const name of names) {
    const entry = catalog.skills.find((skill) => skill.name === name);
    assert.ok(entry, `${name} is missing from catalog.json`);
    assert.equal(entry.path, `skills/${name}`);
    assert.equal(entry.releaseTag, `${name}-v${entry.version}`);
    assert.equal(read(join('skills', name, 'VERSION')).trim(), entry.version);
    const changelog = read(join('skills', name, 'CHANGELOG.md'));
    assert.match(changelog, /^## Unreleased$/m);
    assert.match(changelog, new RegExp(`^## ${entry.version.replaceAll('.', '\\.')} - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
    assert.ok(read('CODEOWNERS').includes(`/skills/${name}/ @`), `${name} needs a CODEOWNERS entry`);
  }
});

test('trigger fixtures are fictional and represented by the skill description', () => {
  const realOrgHosts = /\.(my\.salesforce|lightning\.force|sandbox\.my\.salesforce)\.com/;
  for (const [name, fixture] of Object.entries(triggers)) {
    assert.ok(fixture.cursor.length > 0 && fixture.claudeCode.length > 0, `${name} needs both agent fixtures`);
    for (const prompt of [...fixture.cursor, ...fixture.claudeCode]) {
      assert.doesNotMatch(prompt, realOrgHosts, `${name} fixture must not name a real org host`);
      assert.doesNotMatch(prompt, /\b(00D|005|001|006)[A-Za-z0-9]{12,15}\b/, `${name} fixture must not carry a record id`);
      assert.doesNotMatch(prompt, /[A-Za-z0-9._%+-]+@(?!example\.(com|invalid))[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, `${name} fixture must not carry an address`);
    }
    const description = /^description:\s*"((?:[^"\\]|\\.)*)"$/m.exec(read(join('skills', name, 'SKILL.md')))?.[1] || '';
    assert.ok(description.length > 0 && description.length <= 1024, `${name} needs a 1-1024 character description`);
  }
});

test('no skill payload carries a credential, a private path, or a real org identifier', () => {
  const forbidden = [
    [/\/Users\/[A-Za-z0-9]|\/home\/[a-z][A-Za-z0-9_-]*\/|[A-Za-z]:\\/, 'an absolute machine path'],
    [/~\/\.(config|claude|sfdx|venvs|ssh)\b/, 'a private dotfile path'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*\n?[A-Za-z0-9+/=]{40}/, 'a private key body'],
    [/\b00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/, 'a Salesforce organization id'],
    [/\b(?:005|001|006|012|02u|06m|0Af|3MV)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/, 'a Salesforce record id'],
    [/\bsid=00D[A-Za-z0-9]/, 'a session id'],
    [/[A-Za-z0-9._%+-]+@(?!example\.(?:com|invalid|org))[A-Za-z0-9.-]+\.(?:com|net|org|io|dev)\b/, 'an email address'],
  ];
  const hostAllowlist = new Set(['sandbox', 'scratch', 'develop', 'trailblaze', 'example', 'test']);

  for (const name of names) {
    for (const path of files(name)) {
      const content = read(path);
      const where = relative('.', path);
      for (const [pattern, what] of forbidden) {
        assert.doesNotMatch(content, pattern, `${where} contains ${what}`);
      }
      for (const [, label] of content.matchAll(/([A-Za-z0-9<>_-]+)\.my\.salesforce(?:-setup)?\.com/g)) {
        assert.ok(
          label.includes('<') || label.includes('>') || hostAllowlist.has(label),
          `${where} names a real Salesforce host: ${label}.my.salesforce.com`
        );
      }
    }
  }
});

test('every knowledge skill stands alone: no wiki links and no out-of-payload references', () => {
  for (const name of names) {
    for (const path of files(name)) {
      const content = read(path);
      const where = relative('.', path);
      assert.doesNotMatch(content, /\[\[[A-Za-z0-9_-]+\]\]/, `${where} contains a wiki-style link`);
      for (const [, link] of content.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^[a-z]+:\/\//i.test(link) || link.startsWith('#')) continue;
        assert.ok(!link.startsWith('/') && !link.includes('..') && link.split('/').length <= 2,
          `${where} links outside the skill payload: ${link}`);
        assert.doesNotThrow(() => statSync(join('skills', name, link)), `${where} has a broken link: ${link}`);
      }
    }
  }
});

test('credential-handling skills keep secrets out of logs and agent context', () => {
  const credentialSkills = [
    'copado-crt-jwt-provisioning',
    'copado-crt-pace-batch-trigger',
    'copado-cicd-object-model',
    'copado-cicd-crt-handoff',
    'copado-ai-dialogue-api',
    'salesforce-named-credential-provisioning',
    'salesforce-url-navigation'
  ];
  const gate = /never (?:print|log|commit|paste|display|hardcode)|do not (?:print|log|commit|paste)|gitignore|SENSITIVE|before printing, logging/i;
  const shipped = credentialSkills.filter((name) => names.includes(name));
  assert.ok(shipped.length > 0, 'at least one credential-handling skill must ship');
  for (const name of shipped) {
    const content = read(join('skills', name, 'SKILL.md'));
    assert.match(content, gate, `${name} handles credentials and must state a no-log/no-commit boundary`);
  }
});

test('no knowledge skill hands a secret to an agent or a shell transcript', () => {
  const leaks = [
    /echo\s+"?\$\{?(?:private_key|client_secret|api_key|sid|loginUrl)/i,
    /Log\s+\$\{(?:private_key|client_secret|loginUrl|sessionId)\}/i,
    /paste (?:your|the) (?:private key|api key|token|secret)/i
  ];
  for (const name of names) {
    for (const path of files(name)) {
      const content = read(path);
      for (const pattern of leaks) {
        assert.doesNotMatch(content, pattern, `${relative('.', path)} would expose a secret`);
      }
    }
  }
});

test('no knowledge skill instructs a destructive or shared-state-clobbering command', () => {
  const destructive = [/\brm\s+-rf\b/, /\bpkill\b/, /sf org logout/, /org list --clean/, /--force\s+delete/];
  for (const name of names) {
    for (const path of files(name)) {
      const content = read(path);
      for (const pattern of destructive) {
        assert.doesNotMatch(content, pattern, `${relative('.', path)} contains a destructive command`);
      }
    }
  }
});
