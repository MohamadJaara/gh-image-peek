import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'MohamadJaara/gh-image-peek';
const ADDON_ID = 'gh-image-peek@extensions.local';
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const DOWNLOAD_ROOT = `https://github.com/${REPOSITORY}/releases`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function versionFromTag(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) {
    throw new Error('Expected a stable release tag in the form vX.Y.Z.');
  }
  const version = tag.slice(1);
  if (version.split('.').some((part) => Number(part) > 65535)) {
    throw new Error('Firefox version components must be at most 65535.');
  }
  return version;
}

export function assertNewerVersion(version, previous) {
  const currentParts = versionFromTag(`v${version}`).split('.').map(Number);
  const previousParts = versionFromTag(`v${previous}`).split('.').map(Number);
  for (let index = 0; index < currentParts.length; index += 1) {
    if (currentParts[index] > previousParts[index]) return;
    if (currentParts[index] < previousParts[index]) break;
  }
  throw new Error(`Version ${version} must be newer than distributed version ${previous}.`);
}

export async function readReleaseAssets(tag, directory) {
  const version = versionFromTag(tag);
  const xpiName = `gh-image-peek-firefox-${version}.xpi`;
  const expectedNames = [
    xpiName, `gh-image-peek-chrome-${version}.zip`,
    `gh-image-peek-source-${version}.zip`, 'updates.json', 'SHA256SUMS',
  ].sort();
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())
      || JSON.stringify(entries.map(({ name }) => name).sort()) !== JSON.stringify(expectedNames)) {
    throw new Error('Release directory must contain exactly the signed XPI, Chrome ZIP, source ZIP, updates.json, and SHA256SUMS.');
  }
  const assets = new Map(await Promise.all(expectedNames.map(async (name) => [
    name, await readFile(resolve(directory, name)),
  ])));
  const checksums = new Map();
  for (const line of assets.get('SHA256SUMS').toString('utf8').trim().split('\n')) {
    const match = /^([a-f0-9]{64}) [ *]([^/\\]+)$/.exec(line);
    if (!match || checksums.has(match[2]) || !assets.has(match[2]) || match[2] === 'SHA256SUMS') {
      throw new Error('Invalid release checksum file.');
    }
    checksums.set(match[2], match[1]);
  }
  if (checksums.size !== assets.size - 1) throw new Error('Release checksums are incomplete.');
  for (const [name, hash] of checksums) {
    if (sha256(assets.get(name)) !== hash) throw new Error(`Checksum mismatch for ${name}.`);
  }
  const feed = JSON.parse(assets.get('updates.json').toString('utf8'));
  const updates = feed.addons?.[ADDON_ID]?.updates;
  if (Object.keys(feed.addons ?? {}).length !== 1 || updates?.length !== 1
      || updates[0].version !== version
      || updates[0].update_link !== `${DOWNLOAD_ROOT}/download/${tag}/${xpiName}`
      || updates[0].update_hash !== `sha256:${sha256(assets.get(xpiName))}`) {
    throw new Error('Update feed must identify this release and its exact signed XPI checksum.');
  }
  return { assets, update: updates[0] };
}

function createGitHubClient(token, fetchImpl) {
  async function request(path, { method = 'GET', json, bytes, contentType, allow404 = false, binary = false } = {}) {
    const url = path.startsWith('https://') ? path : `${API_ROOT}${path}`;
    const parsed = new URL(url);
    if (!['api.github.com', 'uploads.github.com'].includes(parsed.hostname)
        || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('Refusing an unexpected authenticated GitHub URL.');
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'gh-image-peek-release',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      ...(bytes === undefined ? {} : { body: bytes }),
      signal: AbortSignal.timeout(30000),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${parsed.pathname} failed (HTTP ${response.status}).`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  return request;
}

async function assertTagCommit(api, tag, commit) {
  let object = (await api(`/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth += 1) {
    object = (await api(`/git/tags/${encodeURIComponent(object.sha)}`)).object;
  }
  if (object?.type !== 'commit' || object.sha !== commit) {
    throw new Error('The remote release tag no longer points to the validated source commit.');
  }
}

async function assertForwardRelease(api, version) {
  const latest = await api('/releases/latest', { allow404: true });
  if (!latest) return;
  assertNewerVersion(version, versionFromTag(latest.tag_name));
  const updateAsset = latest.assets?.find(({ name }) => name === 'updates.json');
  if (!updateAsset) return;
  const feed = JSON.parse((await api(`/releases/assets/${updateAsset.id}`, { binary: true })).toString('utf8'));
  const updates = feed.addons?.[ADDON_ID]?.updates;
  if (!Array.isArray(updates)) throw new Error('The existing update feed has an unexpected format.');
  for (const update of updates) assertNewerVersion(version, update.version);
}

async function findRelease(api, tag) {
  const published = await api(`/releases/tags/${encodeURIComponent(tag)}`, { allow404: true });
  if (published) return published;
  // The by-tag endpoint is documented for published releases. Authenticated
  // release listings also include drafts, so failed uploads can be resumed.
  for (let page = 1; ; page += 1) {
    const releases = await api(`/releases?per_page=100&page=${page}`);
    const matching = releases.filter((release) => release.tag_name === tag);
    if (matching.length > 1) throw new Error('Multiple drafts use this tag; inspect them before retrying.');
    if (matching.length === 1) return matching[0];
    if (releases.length < 100) return null;
  }
}

function releaseNotes(tag, commit) {
  const version = versionFromTag(tag);
  return [
    `Source commit: ${commit}`, '',
    `Firefox: download gh-image-peek-firefox-${version}.xpi and install it through about:addons → Install Add-on From File.`,
    'The Firefox package is Mozilla-signed and includes the GitHub automatic-update feed.', '',
    `Chrome: extract gh-image-peek-chrome-${version}.zip and use Load unpacked in chrome://extensions with Developer mode enabled. Updates are manual.`, '',
    `The gh-image-peek-source-${version}.zip archive contains buildable source for review.`,
  ].join('\n');
}

export async function verifyPublicDownloads(tag, prepared, {
  fetchImpl = fetch, attempts = 3,
  delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
} = {}) {
  let failure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      for (const [url, expected] of [
        [`${DOWNLOAD_ROOT}/latest/download/updates.json`, prepared.assets.get('updates.json')],
        [prepared.update.update_link, prepared.assets.get(`gh-image-peek-firefox-${versionFromTag(tag)}.xpi`)],
      ]) {
        // Deliberately anonymous: Firefox's updater cannot use our Actions token.
        const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Public release download failed (HTTP ${response.status}).`);
        if (sha256(Buffer.from(await response.arrayBuffer())) !== sha256(expected)) {
          throw new Error('Public release bytes do not match the prepared release.');
        }
      }
      return;
    } catch (error) {
      failure = error;
      if (attempt + 1 < attempts) await delay(1000 * (attempt + 1));
    }
  }
  throw new Error(`Release was published, but public download verification failed: ${failure.message}`);
}

export async function publishRelease({
  tag, directory = resolve('dist/release'), token = process.env.GITHUB_TOKEN,
  commit = process.env.RELEASE_COMMIT, repository = process.env.GITHUB_REPOSITORY ?? REPOSITORY,
  fetchImpl = fetch, delay,
} = {}) {
  const version = versionFromTag(tag);
  if (repository !== REPOSITORY) throw new Error(`This publisher is configured only for ${REPOSITORY}.`);
  if (!token) throw new Error('GITHUB_TOKEN is required for release publication.');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('RELEASE_COMMIT must be the validated source SHA.');
  // Validate all local inputs before making any GitHub mutations.
  const prepared = await readReleaseAssets(tag, directory);
  const api = createGitHubClient(token, fetchImpl);
  const repo = await api('');
  if (repo.private || repo.full_name !== REPOSITORY) throw new Error('Firefox distribution requires the expected public repository.');
  await assertTagCommit(api, tag, commit);
  let release = await findRelease(api, tag);
  if (release && (!release.draft || release.prerelease)) {
    throw new Error('This tag already has a published or prerelease release; published assets will not be replaced.');
  }
  await assertForwardRelease(api, version);
  if (!release) {
    release = await api('/releases', { method: 'POST', json: {
      tag_name: tag, target_commitish: commit, name: tag,
      body: releaseNotes(tag, commit), draft: true, prerelease: false, make_latest: 'false',
    } });
  }
  const existingAssets = await api(`/releases/${release.id}/assets?per_page=100`);
  if (existingAssets.some(({ name }) => !prepared.assets.has(name))) {
    throw new Error('The draft contains unexpected assets; inspect the draft before retrying.');
  }
  for (const [name, bytes] of prepared.assets) {
    const existing = existingAssets.find((asset) => asset.name === name);
    if (existing) {
      const previous = await api(`/releases/assets/${existing.id}`, { binary: true });
      if (sha256(previous) !== sha256(bytes)) {
        throw new Error(`Draft asset ${name} has different contents; it will not be overwritten.`);
      }
      continue;
    }
    const uploadURL = new URL(release.upload_url.replace(/\{.*$/, ''));
    uploadURL.searchParams.set('name', name);
    const contentType = name.endsWith('.xpi') ? 'application/x-xpinstall'
      : name.endsWith('.json') ? 'application/json'
        : name.endsWith('.zip') ? 'application/zip' : 'text/plain';
    const uploaded = await api(uploadURL.href, { method: 'POST', bytes, contentType });
    if (uploaded.name !== name || uploaded.state !== 'uploaded' || uploaded.size !== bytes.length
        || (uploaded.digest && uploaded.digest !== `sha256:${sha256(bytes)}`)) {
      throw new Error(`GitHub did not confirm the expected uploaded asset ${name}.`);
    }
  }
  // Catch changes made while signing/uploading, including a newer human release.
  await assertTagCommit(api, tag, commit);
  await assertForwardRelease(api, version);
  const published = await api(`/releases/${release.id}`, {
    method: 'PATCH', json: { draft: false, prerelease: false, make_latest: 'true' },
  });
  if (published.draft || published.tag_name !== tag) throw new Error('GitHub did not confirm publication of the expected release.');
  await verifyPublicDownloads(tag, prepared, { fetchImpl, delay });
  return published.html_url;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, directory = 'dist/release', ...extra] = process.argv.slice(2);
  if (extra.length) {
    console.error('Usage: node scripts/publish-release.mjs vX.Y.Z [asset-directory]');
    process.exitCode = 1;
  } else {
    publishRelease({ tag, directory: resolve(directory) })
      .then((url) => console.log(`Published and verified ${url}`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
