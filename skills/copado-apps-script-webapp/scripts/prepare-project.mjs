import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [rootArg, name] = process.argv.slice(2);
if (!rootArg || !/^[a-z0-9][a-z0-9-]*$/.test(name || '')) {
  throw new Error('Usage: node prepare-project.mjs PROJECT_ROOT lowercase-project-name');
}

const root = resolve(rootArg);
const packagePath = resolve(root, 'package.json');
const lockPath = resolve(root, 'package-lock.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const packageLock = JSON.parse(await readFile(lockPath, 'utf8'));

packageJson.name = name;
packageJson.private = true;
packageLock.name = name;
if (packageLock.packages?.['']) packageLock.packages[''].name = name;

await writeFile(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
await writeFile(lockPath, JSON.stringify(packageLock, null, 2) + '\n');
console.log(`Prepared package metadata for ${name}.`);
