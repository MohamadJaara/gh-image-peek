import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const readJSON = async (path) => JSON.parse(await readFile(resolve(projectRoot, path), 'utf8'));

export async function buildExtensions({ outputDir = resolve(projectRoot, 'dist') } = {}) {
  const [pkg, base] = await Promise.all([readJSON('package.json'), readJSON('manifests/base.json')]);
  const artifacts = [];

  for (const browser of ['firefox', 'chrome']) {
    const override = await readJSON(`manifests/${browser}.json`);
    const manifest = { ...base, version: pkg.version, ...override };
    const paths = new Set([
      ...manifest.content_scripts.flatMap(({ js = [], css = [] }) => [...js, ...css]),
      ...Object.values(manifest.icons),
    ]);
    const files = { 'manifest.json': Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) };
    for (const path of [...paths].sort()) {
      files[path] = await readFile(resolve(projectRoot, 'extension', path));
    }

    const directory = resolve(outputDir, browser);
    await rm(directory, { recursive: true, force: true });
    for (const [path, data] of Object.entries(files)) {
      const destination = resolve(directory, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
    }

    // Fixed ZIP metadata makes repeated builds of the same source identical.
    const zipped = Object.fromEntries(Object.entries(files).map(([path, data]) => [
      path, [data, { mtime: new Date(2000, 0, 1), os: 3, attrs: 0o100644 << 16 }],
    ]));
    const archive = resolve(outputDir, `gh-image-peek-${browser}-${pkg.version}.zip`);
    await writeFile(archive, zipSync(zipped, { level: 9 }));
    artifacts.push({ browser, directory, archive, manifest });
  }

  return artifacts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { browser, directory, archive } of await buildExtensions()) {
    console.log(`${browser}: ${directory}\n${archive}`);
  }
}
