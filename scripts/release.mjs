import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

export const REPOSITORY = 'MohamadJaara/gh-image-peek';
export const ADDON_ID = 'gh-image-peek@extensions.local';
export const UPDATE_URL = `https://github.com/${REPOSITORY}/releases/latest/download/updates.json`;
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const readJSON = async (path) => JSON.parse(await readFile(path, 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function versionFromTag(tag) {
  if (typeof tag !== 'string' || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Release tag must be vX.Y.Z with three numeric components and no leading zeroes.');
  }
  const version = tag.slice(1);
  const parts = version.split('.').map(Number);
  if (parts.some((part) => part > 65535) || parts.every((part) => part === 0)) {
    throw new Error('Release version components must be at most 65535 and not all zero.');
  }
  return version;
}

function safePath(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe package path: ${name}`);
  }
  return name;
}

async function directoryFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const name = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in release sources: ${name}`);
    if (entry.isDirectory()) files.push(...await directoryFiles(resolve(directory, entry.name), `${name}/`));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}

function archiveFiles(bytes) {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).filter(([name]) => {
    if (name.endsWith('/')) return false;
    safePath(name);
    return true;
  }).map(([name, data]) => [name, Buffer.from(data)]));
}

function sameFiles(actual, expected, label, { signatures = false } = {}) {
  for (const [name, bytes] of Object.entries(expected)) {
    assert.ok(actual[name], `${label} is missing ${name}`);
    const message = `${label} differs from the validated source: ${name}`;
    if (signatures && name === 'manifest.json') {
      // AMO can reserialize the manifest (including removing its final newline).
      // Every manifest value must still match; runtime files remain byte-exact.
      assert.deepEqual(JSON.parse(actual[name].toString('utf8')), JSON.parse(bytes.toString('utf8')), message);
    } else {
      assert.ok(actual[name].equals(bytes), message);
    }
  }
  const extra = Object.keys(actual).filter((name) => !Object.hasOwn(expected, name));
  if (signatures) {
    assert.ok(extra.some((name) => /^META-INF\/(?:mozilla\.rsa|cose\.sig)$/i.test(name)), 'XPI is missing Mozilla signature metadata.');
    assert.ok(extra.every((name) => /^META-INF\/[^/]+$/i.test(name)), 'XPI contains unexpected files outside its signature metadata.');
  } else {
    assert.deepEqual(extra, [], `${label} contains unexpected files`);
  }
}

// This verifies the payload and signature metadata, not the cryptographic signature.
// The signing helper obtains the approved file and checksum directly from AMO.
export function validateSignedXpi(bytes, expectedFiles) {
  sameFiles(archiveFiles(bytes), expectedFiles, 'Signed XPI', { signatures: true });
}

export async function checkRelease(tag, { rootDir = projectRoot } = {}) {
  const version = versionFromTag(tag);
  const [pkg, lock, base] = await Promise.all([
    readJSON(resolve(rootDir, 'package.json')),
    readJSON(resolve(rootDir, 'package-lock.json')),
    readJSON(resolve(rootDir, 'manifests/base.json')),
  ]);
  assert.equal(pkg.version, version, 'Tag must match package.json version.');
  assert.equal(lock.version, version, 'Tag must match package-lock.json version.');
  assert.equal(lock.packages[''].version, version, 'Lockfile root package version must match the tag.');
  const builds = {};
  for (const browser of ['firefox', 'chrome']) {
    const override = await readJSON(resolve(rootDir, `manifests/${browser}.json`));
    const manifest = { ...base, version, ...override };
    assert.equal(manifest.version, version, 'Browser overrides must not change the release version.');
    const directory = resolve(rootDir, 'dist', browser);
    const generated = await readJSON(resolve(directory, 'manifest.json'));
    assert.deepEqual(generated, manifest, `Rebuild the stale ${browser} manifest before releasing.`);
    const paths = [...new Set([
      ...manifest.content_scripts.flatMap(({ js = [], css = [] }) => [...js, ...css]),
      ...Object.values(manifest.icons),
    ])].sort();
    const files = { 'manifest.json': Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) };
    for (const name of paths) files[safePath(name)] = await readFile(resolve(rootDir, 'extension', name));
    assert.deepEqual(await directoryFiles(directory), Object.keys(files).sort(), `Unexpected files in ${browser} build.`);
    for (const [name, bytes] of Object.entries(files)) {
      assert.ok((await readFile(resolve(directory, name))).equals(bytes), `Rebuild stale ${browser} file: ${name}`);
    }
    const archive = resolve(rootDir, 'dist', `gh-image-peek-${browser}-${version}.zip`);
    sameFiles(archiveFiles(await readFile(archive)), files, `${browser} ZIP`);
    builds[browser] = { manifest, files, archive };
  }
  const gecko = builds.firefox.manifest.browser_specific_settings?.gecko;
  assert.equal(gecko?.id, ADDON_ID, 'Release must retain the registered Firefox ID.');
  assert.equal(gecko?.update_url, UPDATE_URL, 'Release must retain the stable GitHub update URL.');
  assert.ok(gecko.strict_min_version, 'Declare the Firefox minimum in the update feed.');
  assert.equal(Object.hasOwn(builds.chrome.manifest, 'browser_specific_settings'), false, 'Firefox settings must not enter the Chrome package.');
  assert.equal(Object.hasOwn(builds.chrome.manifest, 'update_url'), false, 'The Firefox updater must not enter the Chrome package.');
  return { version, tag, builds };
}

async function sourceArchiveBytes(rootDir) {
  const names = ['README.md', 'package.json', 'package-lock.json', 'playwright.config.js', 'eslint.config.js'];
  for (const directory of ['extension', 'manifests', 'scripts', 'tests']) {
    names.push(...(await directoryFiles(resolve(rootDir, directory))).map((name) => `${directory}/${name}`));
  }
  const files = {};
  for (const name of names.sort()) files[name] = await readFile(resolve(rootDir, name));
  files['BUILDING.md'] = Buffer.from(
    '# Reproduce GH Image Peek\n\n' +
    'Release environment: Ubuntu GitHub Actions runner, Node.js 24 and npm.\n' +
    'Use the committed package-lock.json and run:\n\n' +
    '```sh\nnpm ci --ignore-scripts\nnpm run build\n```\n\n' +
    'The Firefox package is dist/firefox/ and the matching Firefox ZIP is in dist/.\n' +
    'scripts/build.mjs merges manifests/base.json with manifests/firefox.json and the package version.\n' +
    'JavaScript, CSS, and icons are copied unchanged. No private dependencies, minification, or remote build service is used.\n' +
    'Mozilla signature metadata is added after this build and is not reproduced by the build command.\n',
  );
  const entries = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [
    name, [bytes, { mtime: new Date(2000, 0, 1), os: 3, attrs: 0o100644 << 16 }],
  ]));
  return Buffer.from(zipSync(entries, { level: 9 }));
}

export async function createSourceArchive({ rootDir = projectRoot } = {}) {
  const { version } = await readJSON(resolve(rootDir, 'package.json'));
  versionFromTag(`v${version}`);
  const output = resolve(rootDir, 'dist', `gh-image-peek-source-${version}.zip`);
  await mkdir(resolve(rootDir, 'dist'), { recursive: true });
  await writeFile(output, await sourceArchiveBytes(rootDir));
  return output;
}

export async function prepareRelease(tag, signedPath, { rootDir = projectRoot } = {}) {
  const { version, builds } = await checkRelease(tag, { rootDir });
  const signed = await readFile(signedPath);
  validateSignedXpi(signed, builds.firefox.files);
  const sourceName = `gh-image-peek-source-${version}.zip`;
  const sourceBytes = await readFile(resolve(rootDir, 'dist', sourceName));
  assert.ok(sourceBytes.equals(await sourceArchiveBytes(rootDir)), 'Reviewer source archive is stale; regenerate it before signing.');
  const xpiName = `gh-image-peek-firefox-${version}.xpi`;
  const chromeName = `gh-image-peek-chrome-${version}.zip`;
  const gecko = builds.firefox.manifest.browser_specific_settings.gecko;
  const feed = { addons: { [ADDON_ID]: { updates: [{
    version,
    update_link: `https://github.com/${REPOSITORY}/releases/download/${tag}/${xpiName}`,
    update_hash: `sha256:${sha256(signed)}`,
    applications: { gecko: { strict_min_version: gecko.strict_min_version } },
  }] } } };
  const files = {
    [xpiName]: signed,
    [chromeName]: await readFile(builds.chrome.archive),
    [sourceName]: sourceBytes,
    'updates.json': Buffer.from(`${JSON.stringify(feed, null, 2)}\n`),
  };
  files.SHA256SUMS = Buffer.from(Object.entries(files).map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`).join(''));
  const directory = resolve(rootDir, 'dist/release');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) await writeFile(resolve(directory, name), bytes);
  return { directory, version, files: Object.keys(files), feed };
}

async function main() {
  const [command, tag, signedPath] = process.argv.slice(2);
  if (command === 'check' && tag && !signedPath) {
    const { version } = await checkRelease(tag);
    console.log(`Validated release v${version}.`);
  } else if (command === 'source' && !tag) {
    console.log(await createSourceArchive());
  } else if (command === 'prepare' && tag && signedPath) {
    const result = await prepareRelease(tag, resolve(signedPath));
    console.log(`Prepared ${result.version}: ${result.files.join(', ')}\n${result.directory}`);
  } else {
    throw new Error('Usage: node scripts/release.mjs check TAG | source | prepare TAG SIGNED_XPI');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
