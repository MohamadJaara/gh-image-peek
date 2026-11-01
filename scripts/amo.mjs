import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const AMO_ORIGIN = 'https://addons.mozilla.org';
export const ADDON_ID = 'gh-image-peek@extensions.local';
const downloadHosts = new Set(['addons.mozilla.org', 'addons.cdn.mozilla.net', 'addons.mozilla.net']);
const requestTimeout = 60_000;
const maximumFileSize = 200 * 1024 * 1024;

// AMO API authentication uses a short-lived, HS256-signed request token.
// https://mozilla.github.io/addons-server/topics/api/auth.html
export function createAmoToken({ issuer, secret }, { now = Date.now(), nonce = randomUUID() } = {}) {
  if (typeof issuer !== 'string' || !issuer || typeof secret !== 'string' || !secret) {
    throw new Error('Set AMO_JWT_ISSUER and AMO_JWT_SECRET before signing.');
  }
  const issuedAt = Math.floor(now / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: issuer, jti: nonce, iat: issuedAt, exp: issuedAt + 60,
  })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

async function request(fetchImpl, url, options, description) {
  try {
    return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(requestTimeout) });
  } catch {
    // Do not echo third-party errors, which could include request credentials.
    throw new Error(`${description} failed or timed out. Check AMO before retrying the same release.`);
  }
}

export async function lookupVersion({ version, credentials, fetchImpl = fetch }) {
  const url = `${AMO_ORIGIN}/api/v5/addons/addon/${encodeURIComponent(ADDON_ID)}/versions/${encodeURIComponent(version)}/`;
  const response = await request(fetchImpl, url, {
    headers: { Accept: 'application/json', Authorization: `JWT ${createAmoToken(credentials)}` },
    redirect: 'error',
  }, 'Mozilla version lookup');
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Mozilla version lookup returned HTTP ${response.status}. Check API credentials and add-on ownership; inspect the Developer Hub before retrying.`);
  }
  try {
    const record = await response.json();
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid metadata');
    return record;
  } catch {
    throw new Error('Mozilla returned invalid version metadata; inspect the Developer Hub before retrying.');
  }
}

export function validateApprovedVersion(record, version) {
  if (record.version !== version) throw new Error('Mozilla returned a different version; refusing the download.');
  if (record.channel !== 'unlisted') throw new Error(`Mozilla version ${version} is not in the unlisted channel.`);
  if (record.is_disabled || record.file?.status !== 'public') {
    const status = record.is_disabled ? 'disabled' : record.file?.status || 'unknown';
    throw new Error(`Mozilla version ${version} already exists with status ${status}. Wait for approval or resolve the review in the Developer Hub, then rerun the same tag. Do not resubmit it.`);
  }
  if (!record.file.url || !/^(sha256:[0-9a-f]{64}|sha512:[0-9a-f]{128})$/i.test(record.file.hash || '')) {
    throw new Error('Mozilla did not provide a signed-file URL and supported checksum.');
  }
}

function validateDownloadUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Mozilla provided an invalid download URL.'); }
  if (url.protocol !== 'https:' || !downloadHosts.has(url.hostname)
      || url.username || url.password || url.port) {
    throw new Error('The signed-file download must use HTTPS on an expected Mozilla host.');
  }
  return url;
}

export async function downloadApprovedFile({ record, version, credentials, fetchImpl = fetch }) {
  validateApprovedVersion(record, version);
  let url = validateDownloadUrl(record.file.url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    // Handle redirects explicitly: never forward AMO's Authorization header to a CDN.
    const headers = url.origin === AMO_ORIGIN
      ? { Authorization: `JWT ${createAmoToken(credentials)}` } : {};
    const response = await request(fetchImpl, url.href, { headers, redirect: 'manual' }, 'Mozilla signed-file download');
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Mozilla returned a download redirect without a destination.');
      url = validateDownloadUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`Mozilla signed-file download returned HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length')) > maximumFileSize) {
      throw new Error('Mozilla signed-file download exceeds the 200 MB add-on limit.');
    }
    let data;
    try { data = Buffer.from(await response.arrayBuffer()); } catch {
      throw new Error('Mozilla signed-file download failed or timed out while reading the file.');
    }
    if (!data.length || data.length > maximumFileSize) throw new Error('Mozilla signed-file download has an invalid size.');
    const [algorithm, expected] = record.file.hash.toLowerCase().split(':');
    const actual = createHash(algorithm).update(data).digest();
    if (!timingSafeEqual(actual, Buffer.from(expected, 'hex'))) {
      throw new Error('Downloaded XPI does not match the checksum from Mozilla; refusing to use it.');
    }
    return data;
  }
  throw new Error('Mozilla signed-file download exceeded the redirect limit.');
}

export async function runWebExt({ sourceDir, sourceArchive, credentials }) {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'gh-image-peek-sign-'));
  // Ignore ambient web-ext configuration and overrides. Credentials are environment
  // variables rather than CLI arguments, and subprocess output is not echoed.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WEB_EXT_')));
  Object.assign(env, { WEB_EXT_API_KEY: credentials.issuer, WEB_EXT_API_SECRET: credentials.secret });
  try {
    // web-ext writes upload bookkeeping into its source directory. Keep that
    // state outside the validated build so subsequent payload checks stay exact.
    const signingSource = join(artifactsDir, 'extension');
    await cp(resolve(sourceDir), signingSource, { recursive: true });
    const args = [
      resolve(projectRoot, 'node_modules/web-ext/bin/web-ext.js'), 'sign',
      '--source-dir', signingSource, '--channel=unlisted',
      '--upload-source-code', resolve(sourceArchive), '--artifacts-dir', join(artifactsDir, 'signed'),
      '--amo-base-url', `${AMO_ORIGIN}/api/v5/`, '--approval-timeout=900000',
      '--timeout=300000', '--no-config-discovery', '--no-input',
    ];
    await new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, args, { cwd: projectRoot, env, stdio: 'ignore' });
      child.once('error', () => reject(new Error('Unable to launch the locally installed web-ext. Run npm ci.')));
      child.once('exit', (code) => code === 0 ? resolveExit() : reject(new Error('web-ext signing did not complete.')));
    });
  } finally {
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

export async function ensureSignedVersion({
  tag, sourceDir, sourceArchive, output,
  credentials = { issuer: process.env.AMO_JWT_ISSUER, secret: process.env.AMO_JWT_SECRET },
  fetchImpl = fetch, signImpl = runWebExt,
}) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag || '');
  if (!match || match.slice(1).some((part) => Number(part) > 65535)) {
    throw new Error('Use a stable version tag in the form vX.Y.Z (numeric components 0–65535).');
  }
  const version = tag.slice(1);
  const manifest = JSON.parse(await readFile(resolve(sourceDir, 'manifest.json'), 'utf8'));
  if (manifest.version !== version || manifest.browser_specific_settings?.gecko?.id !== ADDON_ID) {
    throw new Error('The generated Firefox manifest must match the requested tag and add-on ID.');
  }
  createAmoToken(credentials); // Fail before any network or subprocess work if credentials are absent.
  let record = await lookupVersion({ version, credentials, fetchImpl });
  const reused = record !== null;
  if (!record) {
    // Check this before invoking web-ext; a missing source archive must not result
    // in a partial submission without the build inputs needed for review.
    await readFile(sourceArchive);
    let signingFailed = false;
    try {
      await signImpl({ sourceDir, sourceArchive, credentials });
    } catch {
      signingFailed = true;
    }
    // Even a timeout can leave an approved submission behind. Always recover from
    // AMO metadata, rather than picking an arbitrary web-ext output ZIP.
    record = await lookupVersion({ version, credentials, fetchImpl });
    if (!record) {
      throw new Error(signingFailed
        ? 'Signing did not complete and Mozilla has no version record yet. Inspect the Developer Hub before retrying; an upload may still be processing.'
        : 'Mozilla has not made the signed version available yet. Inspect the Developer Hub, then rerun the same tag after approval.');
    }
  }
  const data = await downloadApprovedFile({ record, version, credentials, fetchImpl });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, data);
  return { version, output: resolve(output), reused, hash: record.file.hash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      tag: { type: 'string' }, 'source-dir': { type: 'string' },
      'source-archive': { type: 'string' }, output: { type: 'string' },
    } });
    if (!values.tag || !values['source-dir'] || !values['source-archive'] || !values.output) {
      throw new Error('Usage: node scripts/amo.mjs --tag vX.Y.Z --source-dir dist/firefox --source-archive SOURCE.zip --output dist/signed.xpi');
    }
    const result = await ensureSignedVersion({
      tag: values.tag, sourceDir: values['source-dir'], sourceArchive: values['source-archive'], output: values.output,
    });
    console.log(`${result.reused ? 'Retrieved existing' : 'Retrieved newly submitted'} Mozilla-approved unlisted version ${result.version}: ${result.output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
