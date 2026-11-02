# Repository maintenance

## Local checks

Use Node.js 24 (`nvm use` reads `.nvmrc`) and install dependencies with `npm ci`.

```sh
npm run lint
npm run build
npm run lint:extension
npm run test:unit
```

ESLint checks the extension, tooling, Playwright configuration, and tests with the recommended correctness rules. `npm run lint:fix` applies available automatic fixes. Browser globals belong to the extension; Node globals belong to scripts. Playwright tests can use both because their `page.evaluate` callbacks run inside the browser. Generated packages and reports are excluded.

For changes to viewer behavior, install the Playwright browsers and run `npm run test:browser`, as described in the README. `.editorconfig` and `.gitattributes` keep indentation and line endings consistent without imposing a repository-wide reformat.

## Workflow checks

The workflow-checking workflow runs on pull requests, pushes to `main`, manual requests, and weekly:

- **zizmor** audits GitHub Actions security, with findings shown as annotations and a failing check. It uses read-only repository permissions and does not need code-scanning upload permissions.
- **actionlint** checks workflow syntax, expressions, and embedded shell scripts using its pinned official container image.

A separate pull-request **dependency review** check rejects newly introduced dependencies with high or critical known vulnerabilities. This compares the dependency changes in a PR; it is not a full audit of every existing dependency. It requires GitHub's dependency graph to be enabled. [GitHub dependency review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review)

Workflow actions and the actionlint container are pinned to immutable revisions. The release signing job does not share the PR-populated npm cache; the publishing job has write permission but installs no npm dependencies. Keep signing credentials restricted to the signing step.

## Renovate

`renovate.json` uses Renovate's `config:best-practices` preset and a weekly schedule in `Europe/Berlin`. It maintains exact development dependency versions, action/container digests, and the npm lockfile. Non-major npm updates and non-major Action updates are grouped; major updates remain separate. PRs require review and are not automatically merged. At most three Renovate PRs remain open concurrently. [Renovate presets](https://docs.renovatebot.com/presets-config/#configbest-practices)

To activate it, install or configure the [Renovate GitHub App](https://github.com/apps/renovate) and grant access to this repository, then merge the repository configuration onto the default branch. Review any onboarding PR or Dependency Dashboard warnings. The hosted app does not need a Renovate token in this repository's Actions secrets. [Renovate onboarding](https://docs.renovatebot.com/getting-started/installing-onboarding/)

Avoid adding a second dependency-update bot for the same package ecosystem. GitHub vulnerability alerts can remain enabled alongside Renovate; they serve a different purpose from routine update PRs.

## GitHub settings to finish manually

After the workflows run successfully on GitHub:

1. Protect `main` with a ruleset requiring **Test and lint**, **zizmor security audit**, **actionlint workflow validation**, and **Review dependency vulnerabilities**. Block force pushes and deletion. Set review requirements to match the number of maintainers; requiring someone else's approval on a solo repository can block your own work.
2. Restrict `v*` release tags to trusted maintainers, and enable release immutability as described in [releasing](releasing.md).
3. Enable dependency graph/vulnerability alerts, secret scanning/push protection where available, and private vulnerability reporting in repository security settings. The reporting policy is [SECURITY.md](../SECURITY.md).
4. Choose and add a `LICENSE` before presenting the repository as open source. No license has been selected automatically.

These GitHub settings and the Renovate App installation are account/repository configuration, separate from the committed files. No GitHub settings are changed by adding this maintenance configuration.
