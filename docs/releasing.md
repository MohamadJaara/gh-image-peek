# Signing and releasing GH Image Peek

The release workflow distributes a Mozilla-signed Firefox XPI through this public GitHub repository. Firefox's manifest already points to the permanent feed URL:

```text
https://github.com/MohamadJaara/gh-image-peek/releases/latest/download/updates.json
```

Chrome releases contain an unsigned ZIP for **Load unpacked**. Chrome installation and updates remain manual; this workflow does not publish to the Chrome Web Store. The Firefox add-on ID stays `gh-image-peek@extensions.local` for all releases.

## One-time setup

1. Register the Firefox add-on with Mozilla using **On your own** (unlisted), as in the initial submission. Keep the registered ID above. A submission to Mozilla does not create a GitHub release.
2. Generate the publisher account's [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/). Under this repository's **Settings → Secrets and variables → Actions**, add two repository secrets:
   - `AMO_JWT_ISSUER`: the API key/JWT issuer, usually in the form `user:…:…`.
   - `AMO_JWT_SECRET`: the associated API secret.
3. Ensure GitHub Actions is enabled. The release job uses the repository's automatic `GITHUB_TOKEN` with `contents: write`; no personal GitHub token is needed. An organization policy must permit that job permission.
4. Commit and push the release tooling and the intended extension changes to `main` before creating a version tag. Protect `main` and restrict creation of `v*` tags to trusted maintainers using repository rulesets.
5. Recommended: enable **Settings → General → Releases → Immutable releases** before the first automated release. The workflow attaches every file to a draft before publishing; it never replaces a published asset or moves a tag.

The repository and downloads must remain public so Firefox can fetch updates without credentials. Only the signing step receives the AMO secrets; pull-request checks do not use them. Never put credentials into the extension, repository files, update feed, or release assets.

## Check a release locally

Use Node.js 24+ or Node.js 22.x starting at 22.13; GitHub Actions and Mozilla reviewer build instructions use Node.js 24. Node.js 23 is unsupported by the lint tooling. The exact `web-ext` version is pinned in the lockfile.

```sh
npm ci
npx --no-install playwright install firefox chromium
npm run build
npm run lint
npm run lint:extension
npm test
npm run release:check -- v0.6.0
npm run release:source
```

Replace `v0.6.0` with the version in `package.json`. The tag must be `vX.Y.Z`: three numeric components, no leading zeroes or prerelease suffix, each component at most 65535. Package, lockfile, generated manifests, and ZIP contents must agree. The checker also validates the registered Firefox ID, feed URL, and separation from Chrome settings.

The source archive is `dist/gh-image-peek-source-X.Y.Z.zip`. It includes manifests, readable extension source, checked-in icons, scripts, tests, the lockfile, and `BUILDING.md`; it excludes dependencies, generated packages, and hidden files. It is uploaded to Mozilla with every new automated submission. The shared build now generates browser-specific manifests, so if submitting a new version manually, supply this source archive when asked about generated files. The earlier single-manifest package did not use this build step. [Mozilla source requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/)

## Publish the first automated release

The commands below use `0.6.0` as an example; use an unused tag matching the version in `package.json`. Once all intended changes and the workflow are committed on `main`, push that branch and the matching tag:

```sh
git push origin main
git tag v0.6.0
git push origin v0.6.0
```

Creating the tag starts **Actions → Release**. The workflow checks that its commit is reachable from `main`, rebuilds both packages, runs all checks, packages reviewer sources, and then signs or retrieves the exact Firefox version. Do not create or move a tag for a version that has already been distributed.

If the initial Mozilla submission was an older version such as `0.4.0`, the workflow submits the current version as an update to the same add-on. If Mozilla already approved the exact tagged version, the workflow downloads it instead of resubmitting it. Publication proceeds only when its runtime files match the tagged build byte for byte and every parsed manifest value matches. Mozilla can change manifest JSON formatting, such as removing its final newline, during signing; that alone does not change the extension. The signed XPI is preserved unchanged, and its exact bytes are used for the update hash and release checksums. An old or different signed package cannot be substituted.

## Normal releases

After merging the intended changes, increment the package version and update its lockfile:

```sh
npm version patch --no-git-tag-version
```

Use `minor` or `major` when appropriate. Run the local checks with the new version, commit the version files, push `main`, and create/push the matching tag. Version ordering is numeric, so `0.10.0` correctly follows `0.9.0`.

Each successful release contains exactly:

| Asset | Purpose |
| --- | --- |
| `gh-image-peek-firefox-X.Y.Z.xpi` | Mozilla-signed Firefox package; install this file |
| `gh-image-peek-chrome-X.Y.Z.zip` | Chrome package for manual unpacked installation |
| `gh-image-peek-source-X.Y.Z.zip` | Matching source and reviewer build instructions |
| `updates.json` | Firefox update feed with a version-specific XPI URL and SHA-256 hash |
| `SHA256SUMS` | Checksums of the other four assets |

GitHub's automatically generated **Source code** archives are not installable extension packages. The temporary unsigned Firefox ZIP is a local build artifact and is not published as the permanent installer.

Publication uses a separate job with write permission. It checks the public repository, remote tag commit, complete asset set, checksums, and forward-only version ordering before publishing the draft as latest. It then downloads the latest feed and versioned XPI **without authentication** and compares their bytes with the prepared assets. Stable runs are serialized so an older delayed signing job cannot move latest backwards.

## Signing delays and reruns

Mozilla approval is external to CI and may take longer than a workflow's waiting budget. An existing pending, rejected, disabled, or listed-channel version stops the release with an explanation; it is not submitted again. No unsigned fallback is published. Check **AMO Developer Hub → your add-on → Manage Status & Versions** and resolve the review there. [Mozilla signing and review](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

After Mozilla approves the unlisted version, rerun the failed GitHub workflow or use **Actions → Release → Run workflow**, choose `main`, and enter the same existing tag. Only tags containing this release tooling can run this workflow. The helper retrieves the approved XPI from AMO using its authenticated version API, checks its AMO-provided checksum, and validates its payload against the tagged build before preparing assets.

If validation fails after signing succeeds, the workflow retains the signed XPI and original generated manifest in a `signed-package-diagnostics` Actions artifact for three days. Compare them before changing validation rules. A tag containing a broken release helper still runs that helper on rerun; commit the fix and use a higher version rather than moving the existing tag.

If the version is absent after an upload/network timeout, inspect AMO first: the upload may still be processing. Wait for a version record before retrying; do not blindly submit the same version twice. Authentication failures require fixing the Actions secrets or add-on ownership.

If uploading a draft failed, rerunning can fill in missing assets when existing draft bytes match. A conflicting draft asset is never overwritten: inspect it and remove only the incorrect unpublished draft through GitHub before retrying. A published release is never rewritten, and a rerun reports that it already exists. If publication succeeded but the anonymous-download check failed, check the public URLs and latest pointer before deciding whether another release is necessary.

## Installation and update smoke test

On stock desktop Firefox, download the signed XPI from the release, open `about:addons`, choose **Install Add-on From File…**, and accept the prompt. Confirm it survives a restart. Refresh existing GitHub tabs. For Android, follow [Mozilla's saved-file installation instructions](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-add-on-from-file-on-android); signed installation and automatic updates on Android still need a device check.

To validate the whole updater, install an older genuinely signed version containing the same feed URL, publish a higher signed version, and choose **Check for Updates** in `about:addons`. Confirm the installed version and GitHub viewer behavior afterward. The automated suite covers build/release logic and browser interactions; it does not replace this stock Firefox signed-install/update check.

Firefox checks periodically and user update preferences apply. Keep the feed URL working for existing installations; signing an AMO version alone does not deliver a GitHub update. [Mozilla update feeds](https://extensionworkshop.com/documentation/manage/updating-your-extension/)

For a bad release, revert to known-good code under a **higher version**, sign it, and publish normally. Moving latest backwards cannot automatically downgrade users who already installed the bad version. Keep published versions and their signed bytes intact.
