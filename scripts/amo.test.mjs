import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ADDON_ID, createAmoToken, downloadApprovedFile, ensureSignedVersion, lookupVersion } from './amo.mjs';

const credentials = { issuer: 'user:test:1', secret: 'test-secret-not-for-production' };
const version = '0.6.0';
const xpi = Buffer.from('Example signed artifact; archive validation belongs to release.mjs.');
const hash = (algorithm = 'sha256') => `${algorithm}:${createHash(algorithm).update(xpi).digest('hex')}`;
const approved = (overrides = {}) => ({
  version, channel: 'unlisted', is_disabled: false,
  file: { status: 'public', url: 'https://addons.mozilla.org/firefox/downloads/file/123/example.xpi', hash: hash() },
  ...overrides,
});
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'gh-image-peek-amo-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceDir = join(directory, 'firefox');
  const sourceArchive = join(directory, 'source.zip');
  const output = join(directory, 'signed.xpi');
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, 'manifest.json'), JSON.stringify({
    version, browser_specific_settings: { gecko: { id: ADDON_ID } },
  }));
  await writeFile(sourceArchive, 'source package fixture');
  return { tag: `v${version}`, sourceDir, sourceArchive, output, credentials };
}

test('AMO JWT is HS256 signed with a unique nonce and a one-minute lifetime', () => {
  const token = createAmoToken(credentials, { now: 1_750_000_000_000, nonce: 'unique-test-nonce' });
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    iss: credentials.issuer, jti: 'unique-test-nonce', iat: 1_750_000_000, exp: 1_750_000_060,
  });
  assert.equal(signature, createHmac('sha256', credentials.secret).update(`${header}.${payload}`).digest('base64url'));
  assert.notEqual(createAmoToken(credentials), createAmoToken(credentials));
  assert.throws(() => createAmoToken({ issuer: credentials.issuer }), /Set AMO_JWT_ISSUER and AMO_JWT_SECRET/);
});

test('an existing approved unlisted version is downloaded without resubmission', async (t) => {
  const options = await fixture(t);
  let calls = 0;
  const result = await ensureSignedVersion({
    ...options,
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.match(init.headers.Authorization, /^JWT /);
      assert.ok(init.signal instanceof AbortSignal);
      if (calls === 1) {
        assert.equal(url, `https://addons.mozilla.org/api/v5/addons/addon/gh-image-peek%40extensions.local/versions/${version}/`);
        assert.equal(init.redirect, 'error');
        return json(approved());
      }
      assert.equal(url, approved().file.url);
      return new Response(xpi);
    },
    signImpl: async () => assert.fail('approved versions must not be submitted again'),
  });
  assert.equal(result.reused, true);
  assert.equal(result.version, version);
  assert.equal(result.hash, hash());
  assert.deepEqual(await readFile(options.output), xpi);
  assert.equal(calls, 2);
});

test('a missing version is submitted once, then downloaded from approved AMO metadata', async (t) => {
  const options = await fixture(t);
  let calls = 0;
  let submissions = 0;
  const result = await ensureSignedVersion({
    ...options,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 404 });
      if (calls === 2) return json(approved());
      return new Response(xpi);
    },
    signImpl: async (input) => {
      submissions += 1;
      assert.deepEqual(input, { sourceDir: options.sourceDir, sourceArchive: options.sourceArchive, credentials });
    },
  });
  assert.equal(submissions, 1);
  assert.equal(calls, 3);
  assert.equal(result.reused, false);
  assert.deepEqual(await readFile(options.output), xpi);
});

test('a signing timeout can recover a version Mozilla already approved', async (t) => {
  const options = await fixture(t);
  let calls = 0;
  await ensureSignedVersion({
    ...options,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 404 }) : calls === 2 ? json(approved()) : new Response(xpi);
    },
    signImpl: async () => { throw new Error('subprocess timed out'); },
  });
  assert.equal(calls, 3);
  assert.deepEqual(await readFile(options.output), xpi);
});

for (const [description, record, message] of [
  ['awaiting review', approved({ file: { status: 'unreviewed' } }), /already exists with status unreviewed/],
  ['rejected', approved({ file: { status: 'disabled' } }), /already exists with status disabled/],
  ['disabled by author', approved({ is_disabled: true }), /already exists with status disabled/],
  ['listed channel', approved({ channel: 'listed' }), /not in the unlisted channel/],
  ['different version', approved({ version: '0.5.0' }), /different version/],
]) {
  test(`existing ${description} versions are neither submitted nor downloaded`, async (t) => {
    const options = await fixture(t);
    let calls = 0;
    await assert.rejects(ensureSignedVersion({
      ...options,
      fetchImpl: async () => { calls += 1; return json(record); },
      signImpl: async () => assert.fail('existing versions must not be resubmitted'),
    }), message);
    assert.equal(calls, 1);
    await assert.rejects(access(options.output), { code: 'ENOENT' });
  });
}

for (const status of [401, 403, 429, 500]) {
  test(`AMO HTTP ${status} fails closed instead of attempting signing`, async (t) => {
    const options = await fixture(t);
    await assert.rejects(ensureSignedVersion({
      ...options,
      fetchImpl: async () => new Response('untrusted error body containing no useful release data', { status }),
      signImpl: async () => assert.fail('lookup errors must not trigger submission'),
    }), new RegExp(`HTTP ${status}`));
  });
}

test('redirects do not forward AMO Authorization headers to the Mozilla CDN', async () => {
  let calls = 0;
  const bytes = await downloadApprovedFile({
    record: approved(), version, credentials,
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(init.redirect, 'manual');
      if (calls === 1) {
        assert.match(init.headers.Authorization, /^JWT /);
        return new Response(null, { status: 302, headers: { location: 'https://addons.cdn.mozilla.net/user-media/addons/123/example.xpi' } });
      }
      assert.equal(url, 'https://addons.cdn.mozilla.net/user-media/addons/123/example.xpi');
      assert.equal(init.headers.Authorization, undefined);
      return new Response(xpi);
    },
  });
  assert.deepEqual(bytes, xpi);
  assert.equal(calls, 2);
});

test('hash mismatches never produce an output file', async (t) => {
  const options = await fixture(t);
  let calls = 0;
  await assert.rejects(ensureSignedVersion({
    ...options,
    fetchImpl: async () => ++calls === 1 ? json(approved()) : new Response('not the signed file'),
    signImpl: async () => assert.fail('must reuse the existing version'),
  }), /does not match the checksum/);
  await assert.rejects(access(options.output), { code: 'ENOENT' });
});

test('SHA-512 metadata is supported', async () => {
  const bytes = await downloadApprovedFile({
    record: approved({ file: { ...approved().file, hash: hash('sha512') } }), version, credentials,
    fetchImpl: async () => new Response(xpi),
  });
  assert.deepEqual(bytes, xpi);
});

for (const url of [
  'http://addons.mozilla.org/file.xpi', 'https://example.com/file.xpi',
  'https://addons.mozilla.org.example.com/file.xpi', 'https://user:password@addons.mozilla.org/file.xpi',
  'https://addons.mozilla.org:8443/file.xpi', 'file:///tmp/addon.xpi',
]) {
  test(`download rejects unexpected URL ${url}`, async () => {
    await assert.rejects(downloadApprovedFile({
      record: approved({ file: { ...approved().file, url } }), version, credentials,
      fetchImpl: async () => assert.fail('unsafe URL must not be fetched'),
    }), /HTTPS on an expected Mozilla host/);
  });
}

test('a redirect to a non-Mozilla host is rejected before making the next request', async () => {
  let calls = 0;
  await assert.rejects(downloadApprovedFile({
    record: approved(), version, credentials,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'https://example.com/file.xpi' } });
    },
  }), /expected Mozilla host/);
  assert.equal(calls, 1);
});

test('invalid checksum metadata is rejected before downloading', async () => {
  await assert.rejects(downloadApprovedFile({
    record: approved({ file: { ...approved().file, hash: 'md5:abc123' } }), version, credentials,
    fetchImpl: async () => assert.fail('invalid checksum must not trigger a download'),
  }), /supported checksum/);
});

test('network failures and invalid JSON do not expose third-party response text or credentials', async () => {
  await assert.rejects(lookupVersion({
    version, credentials, fetchImpl: async () => { throw new Error(credentials.secret); },
  }), (error) => {
    assert.doesNotMatch(error.message, new RegExp(credentials.secret));
    assert.match(error.message, /failed or timed out/);
    return true;
  });
  await assert.rejects(lookupVersion({
    version, credentials, fetchImpl: async () => new Response(credentials.secret),
  }), /invalid version metadata/);
  for (const value of [null, false, 0, []]) {
    await assert.rejects(lookupVersion({
      version, credentials, fetchImpl: async () => json(value),
    }), /invalid version metadata/);
  }
});

test('invalid tags or mismatched source manifests fail before contacting Mozilla', async (t) => {
  const options = await fixture(t);
  const fetchImpl = async () => assert.fail('invalid inputs must not contact Mozilla');
  for (const tag of ['0.6.0', 'v0.6.0-beta', 'v00.6.0', 'v65536.0.0']) {
    await assert.rejects(ensureSignedVersion({ ...options, tag, fetchImpl }), /stable version tag/);
  }
  await assert.rejects(ensureSignedVersion({ ...options, tag: 'v0.7.0', fetchImpl }), /manifest must match/);
});

test('missing credentials fail before contacting Mozilla', async (t) => {
  const options = await fixture(t);
  await assert.rejects(ensureSignedVersion({
    ...options, credentials: {}, fetchImpl: async () => assert.fail('missing credentials must not contact Mozilla'),
  }), /Set AMO_JWT_ISSUER and AMO_JWT_SECRET/);
});

test('a missing source archive cannot start a new submission', async (t) => {
  const options = await fixture(t);
  await rm(options.sourceArchive);
  await assert.rejects(ensureSignedVersion({
    ...options, fetchImpl: async () => new Response(null, { status: 404 }),
    signImpl: async () => assert.fail('a source archive is required before submission'),
  }), { code: 'ENOENT' });
});

test('failed signing with no version record leaves a recoverable error and no artifact', async (t) => {
  const options = await fixture(t);
  let submissions = 0;
  await assert.rejects(ensureSignedVersion({
    ...options, fetchImpl: async () => new Response(null, { status: 404 }),
    signImpl: async () => { submissions += 1; throw new Error(credentials.secret); },
  }), /Inspect the Developer Hub before retrying/);
  assert.equal(submissions, 1);
  await assert.rejects(access(options.output), { code: 'ENOENT' });
});
