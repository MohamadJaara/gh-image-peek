import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { ADDON_ID, UPDATE_URL, checkRelease, createSourceArchive, prepareRelease, validateSignedXpi, versionFromTag } from './release.mjs';

async function fixture(t) {
  const rootDir = await mkdtemp(resolve(tmpdir(), 'gh-image-peek-release-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const write = async (name, bytes) => {
    const location = resolve(rootDir, name);
    await mkdir(resolve(location, '..'), { recursive: true });
    await writeFile(location, typeof bytes === 'object' && !Buffer.isBuffer(bytes) ? `${JSON.stringify(bytes, null, 2)}\n` : bytes);
  };
  const version = '1.2.3';
  await write('package.json', { version });
  await write('package-lock.json', { version, packages: { '': { version } } });
  await write('README.md', 'Fixture build instructions.\n');
  await write('playwright.config.js', 'export default {};\n');
  await write('scripts/build.mjs', '// Build helper source\n');
  await write('tests/fixture.js', '// Test source\n');
  const base = { manifest_version: 3, name: 'GH Image Peek', content_scripts: [{ matches: ['https://github.com/*'], js: ['content.js'], css: ['viewer.css'] }] };
  await write('manifests/base.json', base);
  const runtime = { 'content.js': Buffer.from('console.log("viewer");\n'), 'viewer.css': Buffer.from('body {}\n'), 'icons/icon.svg': Buffer.from('<svg/>\n') };
  for (const [name, bytes] of Object.entries(runtime)) await write(`extension/${name}`, bytes);
  const builds = {};
  for (const browser of ['firefox', 'chrome']) {
    const override = { icons: { 48: 'icons/icon.svg' } };
    if (browser === 'firefox') override.browser_specific_settings = { gecko: { id: ADDON_ID, update_url: UPDATE_URL, strict_min_version: '140.0' } };
    await write(`manifests/${browser}.json`, override);
    const manifest = { ...base, version, ...override };
    const files = { 'manifest.json': Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), ...runtime };
    for (const [name, bytes] of Object.entries(files)) await write(`dist/${browser}/${name}`, bytes);
    await write(`dist/gh-image-peek-${browser}-${version}.zip`, Buffer.from(zipSync(files)));
    builds[browser] = { manifest, files };
  }
  // Deliberately synthetic metadata: these unit tests do not assert real signing.
  const signed = Buffer.from(zipSync({ ...builds.firefox.files, 'META-INF/mozilla.rsa': Buffer.from('fixture signature') }));
  await write('signed.xpi', signed);
  return { rootDir, write, builds, signed, version, tag: `v${version}` };
}

test('release tags reject invalid Firefox versions and shell-like input', () => {
  assert.equal(versionFromTag('v0.6.0'), '0.6.0');
  assert.equal(versionFromTag('v65535.2.3'), '65535.2.3');
  for (const tag of ['0.6.0', 'v1.2', 'v01.2.3', 'v1.2.3-beta', 'v65536.0.0', 'v0.0.0', 'v1.2.3;pwd', 'v1.2.3\n']) {
    assert.throws(() => versionFromTag(tag), /Release/);
  }
});

test('release check detects mismatched tag, lockfile, generated manifest, or ZIP payload', async (t) => {
  const { rootDir, write, tag, builds } = await fixture(t);
  assert.equal((await checkRelease(tag, { rootDir })).version, '1.2.3');
  await assert.rejects(checkRelease('v1.2.4', { rootDir }), /Tag must match package.json/);
  await write('package-lock.json', { version: '1.2.2', packages: { '': { version: '1.2.3' } } });
  await assert.rejects(checkRelease(tag, { rootDir }), /package-lock.json/);
  await write('package-lock.json', { version: '1.2.3', packages: { '': { version: '1.2.3' } } });
  await write('dist/firefox/manifest.json', { ...builds.firefox.manifest, version: '1.2.2' });
  await assert.rejects(checkRelease(tag, { rootDir }), /stale firefox manifest/);
  await write('dist/firefox/manifest.json', builds.firefox.manifest);
  await write('dist/gh-image-peek-chrome-1.2.3.zip', Buffer.from(zipSync({ ...builds.chrome.files, 'content.js': Buffer.from('stale code') })));
  await assert.rejects(checkRelease(tag, { rootDir }), /chrome ZIP differs/);
});

test('signed payload validation rejects unsigned, modified, and extra runtime files', async (t) => {
  const { builds, signed } = await fixture(t);
  validateSignedXpi(signed, builds.firefox.files);
  assert.throws(() => validateSignedXpi(Buffer.from(zipSync(builds.firefox.files)), builds.firefox.files), /signature metadata/);
  const changed = { ...builds.firefox.files, 'content.js': Buffer.from('different code'), 'META-INF/mozilla.rsa': Buffer.from('sig') };
  assert.throws(() => validateSignedXpi(Buffer.from(zipSync(changed)), builds.firefox.files), /differs from the validated source/);
  const extra = { ...builds.firefox.files, 'hidden.js': Buffer.from('unexpected code'), 'META-INF/mozilla.rsa': Buffer.from('sig') };
  assert.throws(() => validateSignedXpi(Buffer.from(zipSync(extra)), builds.firefox.files), /unexpected files/);
});

test('source archive includes build inputs and instructions, excluding secrets, artifacts, and dependencies', async (t) => {
  const { rootDir, write } = await fixture(t);
  await write('.env', 'NOT_A_REAL_SECRET=fixture');
  await write('scripts/.env', 'NOT_A_REAL_SECRET=fixture');
  await write('node_modules/unwanted.js', 'dependency fixture');
  const archive = await createSourceArchive({ rootDir });
  const first = await readFile(archive);
  const files = unzipSync(first);
  for (const name of ['BUILDING.md', 'package-lock.json', 'scripts/build.mjs', 'manifests/firefox.json', 'extension/content.js']) {
    assert.ok(files[name], `Missing reviewer input ${name}`);
  }
  assert.match(Buffer.from(files['BUILDING.md']).toString(), /npm ci --ignore-scripts/);
  assert.ok(Object.keys(files).every((name) => !name.includes('.env') && !name.startsWith('dist/') && !name.startsWith('node_modules/')));
  assert.deepEqual(await readFile(await createSourceArchive({ rootDir })), first);
});

test('prepared feed and checksums bind versioned assets to the unchanged signed bytes', async (t) => {
  const { rootDir, tag, signed } = await fixture(t);
  await createSourceArchive({ rootDir });
  const result = await prepareRelease(tag, resolve(rootDir, 'signed.xpi'), { rootDir });
  assert.deepEqual((await readdir(result.directory)).sort(), [
    'SHA256SUMS', 'gh-image-peek-chrome-1.2.3.zip', 'gh-image-peek-firefox-1.2.3.xpi', 'gh-image-peek-source-1.2.3.zip', 'updates.json',
  ].sort());
  assert.deepEqual(await readFile(resolve(result.directory, 'gh-image-peek-firefox-1.2.3.xpi')), signed);
  const feed = JSON.parse(await readFile(resolve(result.directory, 'updates.json'), 'utf8'));
  const [update] = feed.addons[ADDON_ID].updates;
  assert.equal(update.version, '1.2.3');
  assert.equal(update.update_link, 'https://github.com/MohamadJaara/gh-image-peek/releases/download/v1.2.3/gh-image-peek-firefox-1.2.3.xpi');
  assert.equal(update.update_hash, `sha256:${createHash('sha256').update(signed).digest('hex')}`);
  assert.deepEqual(update.applications, { gecko: { strict_min_version: '140.0' } });
  for (const line of (await readFile(resolve(result.directory, 'SHA256SUMS'), 'utf8')).trim().split('\n')) {
    const [hash, name] = line.split('  ');
    assert.equal(hash, createHash('sha256').update(await readFile(resolve(result.directory, name))).digest('hex'));
  }
});

test('a stale reviewer archive fails before replacing any staged release', async (t) => {
  const { rootDir, tag, write } = await fixture(t);
  await createSourceArchive({ rootDir });
  await write('dist/release/keep.txt', 'previous staged output');
  await write('README.md', 'Changed after the reviewer archive was generated.');
  await assert.rejects(prepareRelease(tag, resolve(rootDir, 'signed.xpi'), { rootDir }), /Reviewer source archive is stale/);
  assert.equal(await readFile(resolve(rootDir, 'dist/release/keep.txt'), 'utf8'), 'previous staged output');
});
