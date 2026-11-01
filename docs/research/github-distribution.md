# Firefox signing and GitHub distribution

Historical research for the initial single-browser build. The implemented workflow and current maintainer instructions are documented in [Signing and releasing GH Image Peek](../releasing.md).

Research date: 2026-11-01. Scope: a recommendation for `MohamadJaara/gh-image-peek`, using current Mozilla and GitHub primary documentation. Inspected [`extension/manifest.json`](../../extension/manifest.json), [`package.json`](../../package.json), [`README.md`](../../README.md), and the existing research-note convention. **Only this research document was added.** The manifest, dependencies, installation instructions, workflows, repository settings, and releases have not been changed. No signing, credential creation, or publishing was performed.

## Recommendation — proposed, not enabled

Use **Mozilla-signed, unlisted XPIs distributed through GitHub Releases**, with a Firefox JSON update manifest. This fits direct installation by people who already find the project on GitHub. Keep public AMO listing as an alternative if discovery and Mozilla-managed hosting/updates become more valuable than controlling GitHub distribution. AMO handles updates for publicly listed extensions; unlisted extensions are not publicly installable from AMO. Both channels use Mozilla's signing service and remain subject to its policies. [Mozilla: signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

The checked-in extension is MV3, version `0.3.0`, with ID `gh-image-peek@extensions.local`, desktop minimum `140.0`, Android minimum `142.0`, and an explicit no-data-collection declaration. It has no `update_url`. `package.json` is also `0.3.0`; it provides Playwright tests and a JavaScript syntax check, but does not pin `web-ext`. No `.github` release workflow is present. The README describes unsigned temporary installation and says Android is unverified. These are repository observations, not evidence of any existing AMO registration or GitHub release configuration.

## Signing setup

**Mozilla holds the extension-signing infrastructure.** Do not buy a code-signing certificate, generate a private XPI-signing certificate, or treat a GitHub tag signature as a substitute. Firefox Release requires Mozilla's signature; the AMO API credentials authenticate a submission to Mozilla rather than let the developer sign an installable XPI locally. Mozilla's infrastructure signs the archive contents. Consequently, every released version needs a newly signed package; editing the embedded version or `update_url` after signing invalidates that package's integrity. [Mozilla: signing requirement](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox), [Mozilla: signing infrastructure](https://wiki.mozilla.org/Add-ons/Extension_Signing)

The proposed setup is:

1. Use a Mozilla Account connected to the AMO Developer Hub and accept the applicable developer agreement. Select **On your own** for a manual first submission, or explicitly use the CLI's unlisted channel. A public AMO listing is not required. [Mozilla: submission setup](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
2. Retain **`gh-image-peek@extensions.local`** for the first submission and every update. MV3 requires an explicit ID before signing, and AMO checks uniqueness. IDs identify the extension and its update lineage. The email-like format is an identifier, not a requirement to own a `.local` mailbox or obtain a domain certificate. If AMO reports a collision, resolve ownership or choose a permanent unique ID before the first signed distribution. [Mozilla: extension IDs](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/), [MDN: ID format](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)
3. Obtain an AMO **JWT issuer/API key and JWT secret** from its [API credentials page](https://addons.mozilla.org/developers/addon/api/key/). Store them as separate Actions secrets, proposed names `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. `web-ext` handles the short-lived request JWTs; these credentials are not Mozilla's signing private key. Keep them out of source, artifacts, and logs. [Mozilla: API authentication](https://mozilla.github.io/addons-server/topics/api/auth.html), [GitHub: Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

For later implementation, pin an exact tested `web-ext` version and commit its lockfile. The current v10 command reference requires Node.js 22+, so use Node 22 or a newer supported version for release jobs, even though this project's development README currently allows Node 20+. Map the secrets to `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` only in the signing step. The proposed command is:

```sh
npx --no-install web-ext sign \
  --source-dir extension \
  --artifacts-dir dist/signed \
  --channel=unlisted \
  --timeout=300000 \
  --approval-timeout=900000
```

An unlisted signing success downloads the signed XPI. `--timeout` bounds service-response waiting; `--approval-timeout` bounds approval waiting. These flags do not guarantee approval within that time. [Mozilla: current web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)

The current plain JS/CSS, no-build package should be straightforward to inspect. If future releases introduce bundling, minification, or preprocessing, supply the corresponding source archive and reproducible build instructions for each submission that needs them. [Mozilla: source code requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/)

## Proposed manifest and update feed

Choose a durable feed URL **before the first signed release**:

`https://github.com/MohamadJaara/gh-image-peek/releases/latest/download/updates.json`

GitHub documents this latest-release asset URL form. Attach an asset named exactly `updates.json` to every release eligible to become latest; make only fully signed stable releases latest. Use version-specific URLs for the XPIs referenced inside it. This is a proposed hosting design, not a claim that these URLs exist today. [GitHub: release links](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)

For illustration, make the first signed release `0.3.1`, after confirming it is unused. Merge the following excerpt into the existing manifest **before signing**, preserving its other fields:

```json
{
  "manifest_version": 3,
  "version": "0.3.1",
  "browser_specific_settings": {
    "gecko": {
      "id": "gh-image-peek@extensions.local",
      "strict_min_version": "140.0",
      "update_url": "https://github.com/MohamadJaara/gh-image-peek/releases/latest/download/updates.json",
      "data_collection_permissions": {
        "required": ["none"]
      }
    },
    "gecko_android": {
      "strict_min_version": "142.0"
    }
  }
}
```

Firefox's self-managed URL belongs under `browser_specific_settings.gecko.update_url`, not a Chromium-style top-level `update_url`, and must use HTTPS. Retain the existing privacy declaration and compatibility minima. [MDN: browser-specific settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

The release's proposed `updates.json` is:

```json
{
  "addons": {
    "gh-image-peek@extensions.local": {
      "updates": [
        {
          "version": "0.3.1",
          "update_link": "https://github.com/MohamadJaara/gh-image-peek/releases/download/v0.3.1/gh-image-peek-0.3.1.xpi",
          "update_hash": "sha256:REPLACE_WITH_64_HEX_DIGITS_FROM_THE_SIGNED_XPI",
          "applications": {
            "gecko": {
              "strict_min_version": "140.0"
            }
          }
        }
      ]
    }
  }
}
```

**The hash is a placeholder; this example must not be published unchanged.** Generate it from the final signed XPI bytes, after signing and before uploading. For an Ubuntu release runner:

```sh
sha256sum dist/signed/gh-image-peek-0.3.1.xpi
```

The root is `addons`; its key must exactly match the installed extension ID. Each update declares the XPI's actual version and download link. The optional compatibility object is named `applications.gecko` in this schema. `update_hash` accepts `sha256:` or `sha512:` plus hexadecimal digits. HTTPS is mandatory for the feed; a hash is required for an HTTP XPI link. **Recommendation:** use HTTPS for both and include the hash anyway, binding the feed to the exact signed bytes. A checksum does not replace Mozilla signing or protect a compromised feed publisher. [Mozilla: update-manifest schema](https://extensionworkshop.com/documentation/manage/updating-your-extension/)

Enable GitHub **release immutability** for future releases as part of later setup. It locks published assets and their tags; versioned filenames alone do not enforce that protection. Assemble all assets on a draft, then publish. The latest-release pointer can move while each published release's `updates.json` and XPI remain immutable. [GitHub: immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases), [GitHub: enabling immutability](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)

**Public access is a prerequisite:** Firefox must fetch the JSON and XPI without a GitHub login, cookies, API token, or Actions-artifact authentication. GitHub releases inherit repository read access. The connected GitHub repository metadata confirmed that `MohamadJaara/gh-image-peek` is public on the research date. If it becomes private, use a separate public distribution repository or public HTTPS host, preserving a working update path for existing installations. Do not embed credentials or temporary redirected asset URLs. Verify anonymous downloads through HTTPS redirects return the intended JSON/XPI bytes, rather than HTML or a login page. [GitHub: release access](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

## Proposed GitHub Actions release pipeline

This is a design for later implementation; **no workflow has been created or enabled**.

1. **Validate a trusted release revision.** Trigger on a protected `vX.Y.Z` tag, with a manual recovery entry point for the same tag. Check out the exact tagged SHA. Require equality between the tag without `v`, `package.json`, and `extension/manifest.json`. Require the stable ID, expected HTTPS feed, and a new numeric version higher than previous distributed versions; compare numeric components, not strings. Use three numeric components without leading zeroes and reject prerelease suffixes in this stable pipeline. Mozilla permits one to four numeric components and compares them numerically. [MDN: extension versions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/version)
2. **Run all checks before signing or publication.** With pinned release tooling installed from the lockfile, run the following. Fail the release on test failures, lint errors, or unresolved linter warnings. The Playwright suite checks the injected script, so it does not replace a signed-install/update smoke test.

   ```sh
   npm ci
   npx playwright install --with-deps firefox
   npm run lint
   npm test
   npx --no-install web-ext lint --source-dir extension --self-hosted --warnings-as-errors
   ```

3. **Submit only the validated extension directory.** In a dependent signing job, expose the AMO credentials only to the signing step and run the unlisted command above. Keep submission identifiers, source SHA, version, and input checksum for recovery. Use a clean artifacts directory and require the downloaded signed XPI; never select an arbitrary ZIP as an alternative output.
4. **Validate the returned artifact.** Inspect its root manifest for the expected ID, version, feed URL, and compatibility settings. Compare packaged source files with the validated revision, allowing Mozilla's signature additions. Preserve the signed bytes exactly; renaming the file is fine, unpacking and repackaging it is not part of this pipeline. Calculate its checksum and generate/schema-check `updates.json`, including version, ID, URL, compatibility, and hash checks. Record the source SHA and checksum in release metadata.
5. **Prepare and publish a complete draft.** Upload the signed `gh-image-peek-X.Y.Z.xpi`, `updates.json`, and optionally `SHA256SUMS` to the matching draft release. Require all preceding gates before publication. Publish it and explicitly select it as latest only for the stable channel. Never overwrite published assets or move released tags. Serialize stable publications and recheck version ordering just before publishing so delayed signing of an older release cannot move latest backwards.
6. **Verify distribution.** Fetch the published feed and linked XPI anonymously, verify the hash, and confirm the latest URL reaches this release. For the first release and changes to distribution, smoke-test permanent installation in stock desktop Firefox and updating from an older signed version carrying this feed URL. Before declaring automatic updates supported, test two genuinely signed versions. A post-publication failure needs correction through the recovery process below; it is not permission to replace the signed asset.

Use read-only `GITHUB_TOKEN` permissions for checking/signing and grant `contents: write` only to the release job. Keep AMO secrets out of PR jobs, and pin Actions to full commit SHAs. These are proposed controls applying GitHub's least-privilege and action-pinning guidance. [GitHub: secure Actions use](https://docs.github.com/en/actions/reference/security/secure-use)

## Signing delays and recovery

Mozilla says signing/publication can take up to 24 hours, and longer when selected for manual review; later reviews can also reject or block a version. Therefore, a 15-minute CLI approval timeout is a local waiting budget, not a release SLA. [Mozilla: review timing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

On timeout or an ambiguous network result, **stop before GitHub publication and leave the current latest release unchanged**. Check the existing AMO submission rather than blindly submitting the same version again. Preserve the validated revision and submission details; wait for review, address reviewer requests, and recover the signed file when ready. The Developer Hub sends a signing email and provides a download for the submitted version. [Mozilla: retrieving the signed file](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)

A later manual recovery run should validate the same trusted tag, retrieve the approved XPI, verify its metadata and source contents, and resume at artifact validation. An automated implementation can use the authenticated v5 version-detail endpoint, which exposes the version, channel, approval status, file URL, and hash. Approval status is `public` even for an approved unlisted file; it does not mean a public listing. Merely finding `META-INF` entries is not cryptographic signature verification. Require the expected AMO approval and a real Firefox installation check. [Mozilla: v5 version details](https://mozilla.github.io/addons-server/topics/api/addons.html#version-detail)

If signing fails validation or review, fix the cause and follow AMO's resubmission guidance. **Never publish an unsigned fallback, disable signature enforcement for users, or advertise a version before its signed artifact exists.**

## Installation, update behavior, and rollback

For desktop Firefox, recommend downloading the signed `.xpi`, opening `about:addons`, and using the settings cog's **Install Add-on From File…**, then accepting Firefox's prompt. This is the permanent-install path, rather than the README's temporary `about:debugging` path. A website can trigger installation directly when it serves the correct XPI content type, but do not promise that GitHub's download behavior will do so; the saved-file instructions are dependable. [Mozilla: file installation](https://extensionworkshop.com/documentation/publish/install-self-distributed/), [Mozilla: web-download requirements](https://extensionworkshop.com/documentation/publish/self-distribution/)

With updates enabled, Firefox checks the embedded feed and installs eligible higher versions; signing a new unlisted AMO version alone does not deliver it through GitHub. Without `update_url`, Firefox looks for a higher publicly listed AMO version, so the current manifest does not provide GitHub updates. [Mozilla: self-distributed updates](https://extensionworkshop.com/documentation/publish/self-distribution/)

Mozilla documents a default update interval of about 24 hours. Users can change automatic-update settings and trigger **Check for Updates** in `about:addons`. Compatibility, offline clients, and caching can delay delivery; do not promise an immediate fleet-wide update. Existing installations use their installed `update_url`: adding or moving a feed later requires delivering a new signed build through the old working path or manual installation. Keep this URL durable. [Mozilla: update checks and URL continuity](https://extensionworkshop.com/documentation/manage/updating-your-extension/), [Mozilla: user update controls](https://support.mozilla.org/en-US/kb/how-update-add-ons)

For a bad release, **roll forward with known-good code and a higher version**, for example revert `0.3.2`'s changes into `0.3.3`, obtain a fresh signature, and publish through the same gates. Pointing latest back to `0.3.1` will not automatically downgrade clients already on `0.3.2`. Moving latest temporarily to a known-good release can stop offering the bad version to others, but cached feeds may persist. AMO also has a rollback feature that reissues approved code under a new version; self-distributed results still need downloading and publishing through this update infrastructure. Do not alter the old signed XPI. [Mozilla: rollback and self-distribution](https://extensionworkshop.com/documentation/publish/version-rollback/)

**Android remains unverified for this project.** Mozilla documents installation from a saved signed XPI on Android through its hidden file-install menu, rather than desktop-style direct web installation. The manifest's Android minimum declares eligibility, not tested behavior. Do not claim that this extension's installation, interaction, or GitHub auto-update path has been verified on Android until tested on an actual target browser/device. [Mozilla: Android file installation](https://extensionworkshop.com/documentation/publish/install-self-distributed/)

## Verification boundary

This research checked current documentation, repository contents, and remote repository visibility. It did not check AMO ID availability, provision an account, inspect immutability settings, create secrets, run signing, publish assets, or exercise permanent installation/automatic updates. All version numbers beyond `0.3.0`, download URLs, commands, and pipeline steps above are proposals. The only completed repository change is this cited research note.
