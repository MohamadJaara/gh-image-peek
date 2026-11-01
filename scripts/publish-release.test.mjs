import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  REPOSITORY, assertNewerVersion, publishRelease, readReleaseAssets,
  verifyPublicDownloads, versionFromTag,
} from './publish-release.mjs';

const commit = 'a'.repeat(40);
const tag = 'v0.6.0';
const prefix = `/repos/${REPOSITORY}`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'gh-image-peek-publish-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const xpi = Buffer.from('signed bytes supplied by the validated signing job');
  const feed = {
    addons: { 'gh-image-peek@extensions.local': { updates: [{
      version: '0.6.0',
      update_link: `https://github.com/${REPOSITORY}/releases/download/${tag}/gh-image-peek-firefox-0.6.0.xpi`,
      update_hash: `sha256:${hash(xpi)}`,
    }] } },
  };
  const assets = new Map([
    ['gh-image-peek-firefox-0.6.0.xpi', xpi],
    ['gh-image-peek-chrome-0.6.0.zip', Buffer.from('Chrome package')],
    ['gh-image-peek-source-0.6.0.zip', Buffer.from('reviewable source')],
    ['updates.json', Buffer.from(`${JSON.stringify(feed, null, 2)}\n`)],
  ]);
  assets.set('SHA256SUMS', Buffer.from([...assets].map(([name, bytes]) => `${hash(bytes)}  ${name}\n`).join('')));
  await Promise.all([...assets].map(([name, bytes]) => writeFile(join(directory, name), bytes)));
  return { directory, assets, feed };
}

function githubMock(fixtureData, options = {}) {
  const calls = [];
  const remoteAssets = new Map(options.existingAssets ?? []);
  const draft = {
    id: 12, tag_name: tag, draft: true, prerelease: false,
    upload_url: `https://uploads.github.com${prefix}/releases/12/assets{?name,label}`,
    html_url: `https://github.com/${REPOSITORY}/releases/tag/${tag}`,
  };
  let latestReads = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push({ url: url.href, path: url.pathname, method, init });
    if (url.hostname === 'github.com') {
      assert.equal(init.headers?.Authorization, undefined, 'public verification must be anonymous');
      const name = url.pathname.endsWith('/updates.json') ? 'updates.json' : url.pathname.split('/').at(-1);
      return new Response(options.publicMismatch ? 'incorrect download' : fixtureData.assets.get(name));
    }
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    if (options.apiStatus) return json({ message: 'failure' }, options.apiStatus);
    if (url.pathname === prefix) return json({ full_name: REPOSITORY, private: options.private ?? false });
    if (url.pathname === `${prefix}/git/ref/tags/${tag}`) {
      return json({ object: options.annotated
        ? { type: 'tag', sha: 'b'.repeat(40) }
        : { type: 'commit', sha: options.tagCommit ?? commit } });
    }
    if (url.pathname === `${prefix}/git/tags/${'b'.repeat(40)}`) {
      return json({ object: { type: 'commit', sha: options.tagCommit ?? commit } });
    }
    if (url.pathname === `${prefix}/releases/tags/${tag}`) {
      return options.published ? json({ ...draft, draft: false }) : json({}, 404);
    }
    if (url.pathname === `${prefix}/releases/latest`) {
      latestReads += 1;
      const latest = Array.isArray(options.latest)
        ? options.latest[Math.min(latestReads - 1, options.latest.length - 1)] : options.latest;
      return latest ? json(latest) : json({}, 404);
    }
    if (url.pathname === `${prefix}/releases` && method === 'GET') {
      return json(options.draft ? [draft] : []);
    }
    if (url.pathname === `${prefix}/releases` && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.tag_name, tag);
      assert.equal(body.target_commitish, commit);
      assert.equal(body.draft, true);
      assert.equal(body.make_latest, 'false');
      return json(draft, 201);
    }
    if (url.pathname === `${prefix}/releases/12/assets` && method === 'GET') {
      return json([...remoteAssets].map(([name, bytes], index) => ({
        id: index + 100, name, size: bytes.length, state: 'uploaded', digest: `sha256:${hash(bytes)}`,
      })));
    }
    if (url.hostname === 'uploads.github.com') {
      const name = url.searchParams.get('name');
      if (options.failedUpload === name) return json({}, 502);
      assert.equal(remoteAssets.has(name), false, 'never overwrite an existing asset');
      assert.deepEqual(init.body, fixtureData.assets.get(name));
      remoteAssets.set(name, init.body);
      return json({ name, state: 'uploaded', size: init.body.length, digest: `sha256:${hash(init.body)}` }, 201);
    }
    if (url.pathname.startsWith(`${prefix}/releases/assets/`)) {
      const id = Number(url.pathname.split('/').at(-1));
      if (id === 999) return new Response(JSON.stringify(options.oldFeed));
      return new Response([...remoteAssets.values()][id - 100]);
    }
    if (url.pathname === `${prefix}/releases/12` && method === 'PATCH') {
      assert.equal(remoteAssets.size, fixtureData.assets.size, 'all assets must exist before publication');
      assert.deepEqual(JSON.parse(init.body), { draft: false, prerelease: false, make_latest: 'true' });
      if (options.failedPublication) return json({}, 500);
      return json({ ...draft, draft: false });
    }
    throw new Error(`Unexpected mock request: ${method} ${url.href}`);
  };
  return { fetchImpl, calls, remoteAssets };
}

function runPublish(data, mock, overrides = {}) {
  return publishRelease({
    tag, directory: data.directory, token: 'test-token', commit, repository: REPOSITORY,
    fetchImpl: mock.fetchImpl, delay: async () => {}, ...overrides,
  });
}

const mutations = (calls) => calls.filter(({ method }) => method !== 'GET');

test('stable versions are canonical Firefox-compatible numeric versions and compare numerically', () => {
  assert.equal(versionFromTag('v1.12.0'), '1.12.0');
  assert.doesNotThrow(() => assertNewerVersion('1.10.0', '1.9.0'));
  for (const invalid of ['1.0.0', 'v01.0.0', 'v1.0.0-beta', 'v1.0', 'v65536.0.0', 'v1.0.0\n']) {
    assert.throws(() => versionFromTag(invalid));
  }
  assert.throws(() => assertNewerVersion('1.0.0', '1.0.0'), /newer/);
  assert.throws(() => assertNewerVersion('1.9.0', '1.10.0'), /newer/);
});

test('first release uploads every validated asset to a draft before publishing and verifies anonymously', async (t) => {
  const data = await fixture(t);
  const mock = githubMock(data, { annotated: true });
  assert.equal(await runPublish(data, mock), `https://github.com/${REPOSITORY}/releases/tag/${tag}`);
  const writes = mutations(mock.calls);
  assert.deepEqual(writes.map(({ method }) => method), ['POST', ...Array(5).fill('POST'), 'PATCH']);
  assert.equal(mock.calls.filter(({ path }) => path.endsWith('/releases/latest')).length, 2);
  assert.equal(mock.calls.filter(({ url }) => new URL(url).hostname === 'github.com').length, 2);
  assert.equal(writes.find(({ url }) => url.includes('name=gh-image-peek-firefox')).init.headers['Content-Type'], 'application/x-xpinstall');
});

test('a resumed draft keeps identical assets and only uploads missing ones', async (t) => {
  const data = await fixture(t);
  const existing = [...data.assets].slice(0, 2);
  const mock = githubMock(data, { draft: true, existingAssets: existing });
  await runPublish(data, mock);
  assert.equal(mock.calls.filter(({ method, url }) => method === 'POST' && url.includes('uploads.github.com')).length, 3);
  assert.equal(mock.calls.filter(({ method, path }) => method === 'POST' && path === `${prefix}/releases`).length, 0);
});

test('a draft with changed assets fails without overwriting or publishing', async (t) => {
  const data = await fixture(t);
  const mock = githubMock(data, { draft: true, existingAssets: [['SHA256SUMS', Buffer.from('different bytes')]] });
  await assert.rejects(runPublish(data, mock), /will not be overwritten/);
  assert.equal(mock.calls.some(({ method }) => method === 'PATCH' || method === 'DELETE'), false);
});

test('a published release is never overwritten', async (t) => {
  const data = await fixture(t);
  const mock = githubMock(data, { published: true });
  await assert.rejects(runPublish(data, mock), /already has a published/);
  assert.deepEqual(mutations(mock.calls), []);
});

test('an older tag or a newer existing feed cannot move latest backwards', async (t) => {
  const data = await fixture(t);
  for (const latestTag of ['v0.6.0', 'v0.7.0']) {
    const mock = githubMock(data, { latest: { tag_name: latestTag } });
    await assert.rejects(runPublish(data, mock), /must be newer/);
    assert.deepEqual(mutations(mock.calls), []);
  }
  const mock = githubMock(data, {
    latest: { tag_name: 'v0.5.0', assets: [{ id: 999, name: 'updates.json' }] },
    oldFeed: { addons: { 'gh-image-peek@extensions.local': { updates: [{ version: '0.7.0' }] } } },
  });
  await assert.rejects(runPublish(data, mock), /must be newer/);
  assert.deepEqual(mutations(mock.calls), []);
});

test('version order is checked again after uploading to catch a newly published release', async (t) => {
  const data = await fixture(t);
  const mock = githubMock(data, { latest: [null, { tag_name: 'v0.7.0' }] });
  await assert.rejects(runPublish(data, mock), /must be newer/);
  assert.equal(mock.calls.some(({ method }) => method === 'PATCH'), false);
});

test('a moved tag or a private/wrong repository is rejected before mutations', async (t) => {
  const data = await fixture(t);
  for (const options of [{ tagCommit: 'c'.repeat(40) }, { private: true }]) {
    const mock = githubMock(data, options);
    await assert.rejects(runPublish(data, mock));
    assert.deepEqual(mutations(mock.calls), []);
  }
  const mock = githubMock(data);
  await assert.rejects(runPublish(data, mock, { repository: 'someone/fork' }), /configured only/);
  assert.deepEqual(mock.calls, []);
});

test('missing signed XPI, tampered checksums, or a mismatched update feed never reach GitHub', async (t) => {
  const data = await fixture(t);
  const xpiPath = join(data.directory, 'gh-image-peek-firefox-0.6.0.xpi');
  await rm(xpiPath);
  let mock = githubMock(data);
  await assert.rejects(runPublish(data, mock), /exactly the signed XPI/);
  assert.deepEqual(mock.calls, []);
  await writeFile(xpiPath, 'tampered');
  mock = githubMock(data);
  await assert.rejects(runPublish(data, mock), /Checksum mismatch/);
  assert.deepEqual(mock.calls, []);

  const other = await fixture(t);
  other.feed.addons['gh-image-peek@extensions.local'].updates[0].update_link = 'https://example.com/wrong.xpi';
  other.assets.set('updates.json', Buffer.from(JSON.stringify(other.feed)));
  await writeFile(join(other.directory, 'updates.json'), other.assets.get('updates.json'));
  await writeFile(join(other.directory, 'SHA256SUMS'), [...other.assets]
    .filter(([name]) => name !== 'SHA256SUMS')
    .map(([name, bytes]) => `${hash(bytes)}  ${name}\n`).join(''));
  mock = githubMock(other);
  await assert.rejects(runPublish(other, mock), /Update feed must identify/);
  assert.deepEqual(mock.calls, []);
});

test('API authentication failures and failed uploads cannot publish a fallback', async (t) => {
  const data = await fixture(t);
  const unauthorized = githubMock(data, { apiStatus: 401 });
  await assert.rejects(runPublish(data, unauthorized), /HTTP 401/);
  assert.deepEqual(mutations(unauthorized.calls), []);
  const failed = githubMock(data, { failedUpload: 'gh-image-peek-firefox-0.6.0.xpi' });
  await assert.rejects(runPublish(data, failed), /HTTP 502/);
  assert.equal(failed.calls.some(({ method }) => method === 'PATCH' || method === 'DELETE'), false);
});

test('a publication error leaves the complete draft without rewriting assets', async (t) => {
  const data = await fixture(t);
  const mock = githubMock(data, { failedPublication: true });
  await assert.rejects(runPublish(data, mock), /HTTP 500/);
  assert.equal(mock.remoteAssets.size, 5);
  assert.equal(mock.calls.some(({ method }) => method === 'DELETE'), false);
});

test('public verification retries propagation errors and rejects incorrect bytes without credentials', async (t) => {
  const data = await fixture(t);
  const prepared = await readReleaseAssets(tag, data.directory);
  let calls = 0;
  let delays = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers, undefined);
    calls += 1;
    if (calls === 1) return new Response('not yet available', { status: 404 });
    return new Response(data.assets.get(new URL(url).pathname.split('/').at(-1)));
  };
  await verifyPublicDownloads(tag, prepared, { fetchImpl, delay: async () => { delays += 1; } });
  assert.equal(calls, 3);
  assert.equal(delays, 1);
  await assert.rejects(verifyPublicDownloads(tag, prepared, {
    fetchImpl: async () => new Response('wrong bytes'), attempts: 1,
  }), /public download verification failed/);
});
