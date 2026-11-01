import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { buildExtensions } from './build.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.join(projectRoot, 'extension');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));

async function temporaryBuild(t) {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'gh-image-peek-build-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  return { outputDir, builds: await buildExtensions({ outputDir }) };
}

async function filesBelow(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix + entry.name;
    if (entry.isDirectory()) {
      files.push(...await filesBelow(path.join(directory, entry.name), relativePath + '/'));
    } else {
      files.push(relativePath);
    }
  }
  return files.sort();
}

test('browser ZIPs contain the root manifest and exactly the declared runtime files', async (t) => {
  const { outputDir, builds } = await temporaryBuild(t);
  assert.deepEqual(builds.map(({ browser }) => browser).sort(), ['chrome', 'firefox']);

  for (const build of builds) {
    assert.equal(build.directory, path.join(outputDir, build.browser));
    assert.equal(build.archive, path.join(outputDir, `gh-image-peek-${build.browser}-${packageJson.version}.zip`));

    const manifestBytes = await readFile(path.join(build.directory, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    assert.deepEqual(manifest, build.manifest);
    const expectedFiles = [...new Set([
      'manifest.json', 'content.js', 'viewer.css', ...Object.values(manifest.icons),
    ])].sort();
    assert.deepEqual(await filesBelow(build.directory), expectedFiles);

    const archive = unzipSync(await readFile(build.archive));
    assert.deepEqual(Object.keys(archive).filter((name) => !name.endsWith('/')).sort(), expectedFiles);
    for (const relativePath of expectedFiles) {
      const packagedBytes = Buffer.from(archive[relativePath]);
      assert.deepEqual(packagedBytes, await readFile(path.join(build.directory, relativePath)));
      if (relativePath !== 'manifest.json') {
        assert.deepEqual(packagedBytes, await readFile(path.join(sourceRoot, relativePath)));
      }
    }
  }
});

test('both manifests retain GitHub-only injection and no extra extension capabilities', async (t) => {
  const { builds } = await temporaryBuild(t);
  for (const { manifest } of builds) {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'GH Image Peek');
    assert.deepEqual(manifest.content_scripts, [{
      matches: ['https://github.com/*'],
      js: ['content.js'],
      css: ['viewer.css'],
      run_at: 'document_idle',
    }]);
    for (const key of ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions', 'background']) {
      assert.equal(Object.hasOwn(manifest, key), false, `${key} must remain unnecessary`);
    }
  }

  const firefox = builds.find(({ browser }) => browser === 'firefox').manifest;
  const chrome = builds.find(({ browser }) => browser === 'chrome').manifest;
  assert.equal(firefox.browser_specific_settings.gecko.id, 'gh-image-peek@extensions.local');
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '140.0');
  assert.equal(firefox.browser_specific_settings.gecko.update_url,
    'https://github.com/MohamadJaara/gh-image-peek/releases/latest/download/updates.json');
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.equal(firefox.browser_specific_settings.gecko_android.strict_min_version, '142.0');
  assert.equal(Object.hasOwn(chrome, 'browser_specific_settings'), false);
  assert.equal(Object.hasOwn(chrome, 'update_url'), false);
});

test('versions come from the package and Chrome icons are real PNGs of the advertised sizes', async (t) => {
  const { builds } = await temporaryBuild(t);
  for (const { manifest } of builds) assert.equal(manifest.version, packageJson.version);

  const chrome = builds.find(({ browser }) => browser === 'chrome');
  assert.deepEqual(Object.keys(chrome.manifest.icons).map(Number).sort((a, b) => a - b), [16, 32, 48, 128]);
  for (const [size, relativePath] of Object.entries(chrome.manifest.icons)) {
    const icon = await readFile(path.join(chrome.directory, relativePath));
    assert.equal(path.extname(relativePath), '.png');
    assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(icon.toString('ascii', 12, 16), 'IHDR');
    assert.equal(icon.readUInt32BE(16), Number(size));
    assert.equal(icon.readUInt32BE(20), Number(size));
  }

  const firefox = builds.find(({ browser }) => browser === 'firefox');
  assert.deepEqual(firefox.manifest.icons, { '48': 'icons/icon.svg', '96': 'icons/icon.svg' });
});

test('rebuilding removes stale browser files, preserves unrelated artifacts, and reproduces the ZIPs', async (t) => {
  const { outputDir, builds } = await temporaryBuild(t);
  const initialArchives = new Map(await Promise.all(builds.map(async (build) => [
    build.browser, await readFile(build.archive),
  ])));
  const unrelatedArtifact = path.join(outputDir, 'keep-this-release.txt');
  await writeFile(unrelatedArtifact, 'previous release artifact');
  for (const build of builds) await writeFile(path.join(build.directory, 'stale.txt'), 'remove me');

  const rebuilt = await buildExtensions({ outputDir });
  assert.equal(await readFile(unrelatedArtifact, 'utf8'), 'previous release artifact');
  for (const build of rebuilt) {
    assert.equal((await filesBelow(build.directory)).includes('stale.txt'), false);
    assert.deepEqual(await readFile(build.archive), initialArchives.get(build.browser));
    assert.equal(Object.hasOwn(unzipSync(await readFile(build.archive)), 'stale.txt'), false);
  }
});
