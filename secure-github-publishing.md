# Secure GitHub Publishing Design for Personaville v2

## Decision summary

Personaville v2 should keep the current downloadable manual publishing package as the default and safest publishing method. Direct authenticated publishing from the browser should not be implemented because a static GitHub Pages app cannot keep a GitHub credential secret: any token placed in repository files, `localStorage`, session storage, IndexedDB, or public JavaScript can be copied and reused outside the app.

If Personaville later needs authenticated publishing, the safest supported architecture is a small server-side publishing service that authenticates maintainers, validates uploaded publishing packages, and uses a narrowly-scoped GitHub App installation token to open a pull request. The browser sends package data to the service, never a GitHub personal access token. GitHub Actions workflow dispatch can be part of that service-backed design, but it should not be called directly from static public JavaScript with a long-lived token.

## Non-negotiable requirements

- Do not store personal access tokens in repository files, browser storage, downloadable packages, or public JavaScript.
- Do not ask maintainers to paste PATs into the browser app.
- Keep the downloadable manual publishing package as the default release path.
- Treat direct publishing as disabled until a server-side trust boundary exists.
- Prefer short-lived, repository-scoped credentials over broad user-scoped OAuth tokens.
- Require pull request review before GitHub Pages receives changed production data.

## Current default: manual publishing package

The current publishing package remains the recommended default because it avoids embedding GitHub credentials in the static app. The browser can generate reviewed artifacts, but a maintainer still applies them through normal Git tooling or GitHub UI review. This preserves the existing safety model:

1. Build the package in the browser after Database Health review.
2. Download the package locally.
3. Review generated JSON, reports, assets, and release notes.
4. Commit changes on a branch.
5. Open a pull request.
6. Merge only after review and checks pass.
7. Let GitHub Pages publish from the repository.

## Evaluated approaches

### 1. GitHub App

**Supported fit:** Best option for future automated publishing, but only from a server-side component or trusted GitHub Actions runner.

A GitHub App can be installed on only the Personaville repository and granted granular repository permissions. The publishing service stores the app private key in server-side secret storage, creates short-lived installation access tokens, and uses those tokens to create a branch, commit package files, and open a pull request. GitHub documents that GitHub App installation tokens are limited to selected repositories and app permissions, while OAuth access tokens are limited by broader OAuth scopes.

**Minimum permissions to investigate for PR-based publishing:**

- Repository `Contents: Read and write` to create/update files on a publishing branch.
- Repository `Pull requests: Read and write` to open or update a pull request.
- Repository `Metadata: Read` is required by GitHub Apps by default.
- Optional `Actions: Write` only if the service will trigger a workflow dispatch instead of committing directly.

**Security risks:**

- The app private key is highly sensitive and must never be shipped to the browser or committed.
- A compromised server could publish malicious data within the app's granted permissions.
- Overbroad permissions could allow unnecessary repository mutation.
- Automated commits could bypass human review unless branch protection requires PR review.

**Risk controls:**

- Store the private key only in server-side secret storage.
- Install the app only on the Personaville repository.
- Use short-lived installation tokens per publish attempt.
- Create PRs, not direct pushes to the protected publishing branch.
- Validate package manifest, expected paths, file sizes, JSON schema, and Database Health status server-side.
- Log publish requests with maintainer identity and package checksum.

### 2. OAuth App or browser OAuth flow

**Supported fit:** Not recommended for Personaville direct publishing.

OAuth can authenticate a maintainer, but GitHub OAuth scopes are user-scoped and can be broader than Personaville needs. GitHub notes that OAuth apps often require the `repo` scope for access to repository-owned resources, and scopes limit token access but do not grant permissions beyond the user's own access. A token obtained in a static browser application is still a bearer credential exposed to the browser runtime.

**Permissions/scopes that would be required if used anyway:**

- Public repository content writes may require `public_repo`; private repository writes generally require `repo`.
- Workflow dispatch through Actions APIs may require Actions write access or a token type accepted by the endpoint.
- Pull request creation via API requires enough repository access to create branches and PRs.

**Security risks:**

- Tokens can be copied from browser memory, devtools, extensions, logs, or accidental storage.
- The `repo` scope can grant access beyond Personaville if the user has access to other repositories.
- Refresh token handling introduces long-lived credential risk.
- User authorization changes can make publishing behavior inconsistent across maintainers.

**Recommendation:** Use OAuth only to authenticate the maintainer to a server-side service, not as the repository write credential exposed to Personaville's static JavaScript. The service should exchange maintainer identity for its own authorization decision and then publish with a GitHub App installation token.

### 3. Server-side publishing service

**Supported fit:** Recommended architecture if direct publishing becomes necessary.

A minimal service creates the required trust boundary that static GitHub Pages cannot provide. The browser remains credential-free; the service handles authentication, package validation, GitHub API calls, audit logging, rate limiting, and error reporting.

**Recommended flow:**

1. Maintainer builds the publishing package in Personaville.
2. Maintainer signs in to the publishing service with approved identity provider or GitHub login.
3. Browser uploads the package to the service over HTTPS.
4. Service validates the package:
   - expected manifest exists;
   - only approved paths are present (`database/persona-db.json`, approved assets, reports, release notes);
   - JSON parses and matches expected table structure;
   - Database Health review metadata is present;
   - blocked health statuses require explicit maintainer override;
   - package size and asset file types are within policy.
5. Service creates a short-lived GitHub App installation token.
6. Service creates a new branch, commits the package files, and opens a pull request.
7. Branch protection, checks, and human review gate the merge.

**Service permissions:**

- Identity provider: authenticate approved maintainers.
- GitHub App: `Contents: Read and write`, `Pull requests: Read and write`, `Metadata: Read`.
- Optional GitHub App `Actions: Write` if the service triggers a workflow after upload.

**Security risks:**

- The service becomes sensitive infrastructure and must be patched and monitored.
- Package upload handling can be abused without size limits and content validation.
- Audit gaps can make it hard to reconstruct who published what.
- Direct commits to `main` could bypass review if branch protection is weak.

**Risk controls:**

- Enforce HTTPS, authentication, authorization allowlists, rate limits, CSRF protection where applicable, and upload size limits.
- Keep secrets out of repository files and browser-delivered code.
- Use branch-per-publish PRs, not direct pushes to `main`.
- Require protected branch review and checks.
- Store append-only audit records containing user, timestamp, package hash, PR URL, and validation result.

### 4. GitHub Actions workflow dispatch

**Supported fit:** Viable only when dispatched by a trusted service or maintainer using GitHub UI/CLI; not safe as direct static-browser publishing with embedded tokens.

GitHub's workflow dispatch API can manually trigger a workflow run. In 2026 GitHub also added run details to workflow dispatch API responses, which can simplify tracking a service-triggered publish run. However, the caller still needs an authenticated credential accepted by the endpoint. Putting that credential in static JavaScript would violate Personaville's requirements.

**Safe patterns:**

- Maintainer manually runs a workflow from GitHub's UI after uploading/committing package files.
- Server-side publishing service validates the package and dispatches a workflow with a short-lived GitHub App token that has `Actions: Write`.
- Workflow uses the built-in `GITHUB_TOKEN` with least permissions for repository writes, if repository policy allows it, and opens a PR rather than pushing to `main`.

**Unsafe patterns:**

- Store a PAT or OAuth token in `localStorage` and call workflow dispatch from Personaville.
- Commit a token into JavaScript config.
- Accept arbitrary file paths as workflow inputs and write them without validation.

**Permissions:**

- Dispatch caller: `Actions: Write` for the repository, using a GitHub App installation token or another trusted server-side credential.
- Workflow job: explicitly set minimal `permissions`, such as `contents: write` and `pull-requests: write` only when creating a branch and PR.

## Architecture recommendation

Do not implement direct publishing code in the static Personaville app now. The secure architecture is available only if a server-side publishing service or trusted GitHub Actions workflow is added outside the static app. Until that exists, the product should continue to present the manual package as the default and label authenticated direct publishing as a future service-backed enhancement.

When the project is ready to implement authenticated publishing, use this target architecture:

```text
Personaville static app
  - builds publishing package
  - stores no GitHub secrets
  - uploads package over HTTPS
        |
        v
Server-side publishing service
  - authenticates maintainer
  - validates package and health metadata
  - mints short-lived GitHub App installation token
  - creates branch + commit + pull request
        |
        v
GitHub repository
  - protected main branch
  - CI/data validation checks
  - human PR review
  - GitHub Pages publishes after merge
```

## Implementation guardrails for future work

- Add direct publishing UI only after the server-side service endpoint exists.
- The browser may hold an ordinary logged-in session cookie for the service, but not a GitHub repository write token.
- Do not persist GitHub tokens in `localStorage`, IndexedDB, cookies readable by JavaScript, repository files, package files, or build artifacts.
- Any service session cookie should be `HttpOnly`, `Secure`, and `SameSite=Lax` or stricter.
- The service must reject package entries outside approved repository paths.
- All automated publish attempts should open PRs by default.
- Keep manual download available even after service-backed publishing is added.

## Source references

- GitHub Docs: GitHub Apps can use installation access tokens limited to selected repositories and app permissions, unlike broader OAuth scopes: <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps>
- GitHub Docs: OAuth scopes limit access but do not grant permissions beyond the user's own access: <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
- GitHub Docs: repository contents API creates, modifies, and deletes Base64 encoded repository content: <https://docs.github.com/en/rest/repos/contents>
- GitHub Docs: workflow dispatch API manually triggers a workflow run: <https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event>
- GitHub Changelog, February 19, 2026: workflow dispatch API can return workflow run IDs/details: <https://github.blog/changelog/2026-02-19-workflow-dispatch-api-now-returns-run-ids/>
