import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { project } from '../public/project.js';

const root = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
assert.equal(resolve(git('rev-parse', '--show-toplevel').trim()), root, 'Run this check inside the separate public repository.');
git('diff', '--quiet');
assert.equal(git('ls-files', '--others', '--exclude-standard', '-z'), '', 'Stage all public files before checking the release.');
const entries = git('ls-files', '--stage', '-z').split('\0').filter(Boolean);
const files = entries.map(entry => {
  const [metadata, file] = entry.split('\t');
  assert.match(metadata, /^100644 [a-f0-9]+ 0$/, `${file}: unexpected file mode or unresolved conflict`);
  return file;
});
const staged = new Map(files.map(file => [file, git('show', `:${file}`)]));
const read = file => { assert.ok(staged.has(file), `${file}: missing from Git index`); return staged.get(file); };
assert.ok(files.length > 50, 'Public sources are missing.');
const forbiddenFiles = /(^|\/)(node_modules|\.wrangler|\.credentials|output|private|legacy|\.claude|\.codex)(\/|$)|(^|\/)\.dev\.vars$|\.local\.|\.(db|sqlite|pem|key)$/i;
for (const file of files) {
  assert.doesNotMatch(file, forbiddenFiles, `${file}: local or operational file included`);
  const source = read(file);
  if (file !== '.dev.vars.example' && file !== '.env.example') assert.doesNotMatch(file, /(^|\/)\.(?:env|dev\.vars)(?:\.|$)/i, `${file}: environment file included`);
  assert.doesNotMatch(source, /[a-z0-9._%+-]+@(?:gmail|yahoo|outlook)\.com|https:\/\/wa\.me\/\d+/i, `${file}: operational identity remains`);
  if (file.startsWith('migrations/')) {
    assert.doesNotMatch(source, /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(users|reporters|routine_sources|villages|posyandu)\b/i, `${file}: institution/account seed remains`);
  }
  if (file.startsWith('public/')) {
    assert.doesNotMatch(source, /SURV360|Puskesmas Kesugihan|puskesmas-kesugihan-building|drive\.google\.com/, `${file}: institution content remains`);
  }
  assert.doesNotMatch(source, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[a-zA-Z0-9]{30,}/, `${file}: possible credential`);
  assert.doesNotMatch(source, /\bgithub_pat_[A-Za-z0-9_]{40,}|\bAKIA[A-Z0-9]{16}|\bsk-[A-Za-z0-9_-]{30,}/, `${file}: possible access token`);
  assert.doesNotMatch(source, /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}|\b\d{8,12}:[A-Za-z0-9_-]{32,40}\b/, `${file}: possible JWT or bot token`);
  assert.doesNotMatch(source, /[A-Za-z]:[\\/](?:Users|Git)[\\/]/, `${file}: machine-specific path`);
}
const profile = JSON.parse(read('branding/profiles/umum.json'));
assert.equal(profile.projectName, project.name);
assert.equal(profile.displayName, 'Survantara');
assert.deepEqual(profile.contacts, { emergency: null, information: null });
for (const field of ['favicon', 'logo', 'heroImage', 'serviceAreaShapes']) assert.equal(profile.assets[field], null);
const generated = read('public/branding.js');
assert.ok(generated.includes(JSON.stringify(profile, null, 2)), 'Build the umum profile before the public commit.');
const license = read('LICENSE');
assert.ok(license.includes(project.author));
assert.equal(read('public/LICENSE.txt'), license, 'Published license differs from source.');
const packageJson = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.equal(packageJson.author, project.author);
assert.equal(lock.name, packageJson.name);
assert.equal(lock.packages[''].license, packageJson.license);
assert.match(read('wrangler.toml'), /database_id\s*=\s*"00000000-0000-0000-0000-000000000000"/, 'Public template includes a configured D1 database ID.');
console.log(`Public release checks OK: ${files.length} staged files, generic active profile, no flagged operational seeds/identities/tokens, matching credit and license.`);
