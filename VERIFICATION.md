# Verification readiness

## Completed locally

- Replaced the runtime SDK with a native Keeper protocol client built from Node.js cryptography and n8n HTTP helpers. The official SDK 17.0.0 is development-only, used as a test oracle.
- Retained Keeper Security's MIT copyright/license in the package's third-party notices.
- Validated already-bound configurations, regional hostnames, P-256 private keys, application keys, owner public keys and supported server key IDs (7-18). Custom keys/IL5 and token binding remain outside scope.
- Implemented signed encrypted requests, authenticated response decryption, direct and shared-folder record reads (including the newer flat folder-shared format), record creation with owner/folder key wrapping, revision-preserving updates, and per-record deletion results.
- Isolated keys per execution. No shared key cache, runtime filesystem access or environment-variable reads.
- Added 30-second request timeouts, disabled redirects, bounded server-key rotation retries, and a 16 MiB response processing limit. This limit applies after n8n buffers the response. Network failures and throttling are not automatically retried.
- Added synthetic encrypted endpoint tests and SDK comparison tests for encryption, key wrapping, request signatures, reads, writes, malformed responses and concurrent clients. Authentication failures stop reads instead of silently returning partial results.
- Added `pnpm scan`: runs the official `@n8n/scan-community-package` static analyzer against both source and the unpacked package tarball. It leaves the scanner's restrictions enabled, including ignoring inline lint suppressions.
- Updated frozen-lockfile pnpm CI and GitHub Actions publishing with provenance support. Publishing has not been performed.

Local checks are useful evidence, not n8n verification or proof of live Keeper interoperability.

## Required before submission

1. Test against a dedicated Keeper application with disposable records: direct sharing, folder sharing, create/read/update/delete, restricted permissions, and a fresh bound configuration containing `appOwnerPublicKey`. Confirm current server responses and create/update behavior against the real service.
2. Load the node into a local n8n instance and test the credential connection check, per-item expressions, output linking, Continue On Fail, and error UI. Establish and document the minimum supported n8n version. The source currently builds against `n8n-workflow` 2.16.0.
3. Review the crypto adaptation and trust-anchor table, particularly updates to Keeper's protocol or public keys. Server keys are pinned in source; unknown suggested keys fail closed and require a package update.
4. Confirm the repository is public and npm author/maintainer information matches it. Configure npm Trusted Publishing for `ehlo1/n8n-nodes-keeper-secrets-manager` and `publish.yml`.
5. Run `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm scan`. Inspect the tarball for registered files, icons and license notices, and ensure no secrets or development tooling are included.
6. Publish via GitHub Actions with provenance, then run `pnpm dlx @n8n/scan-community-package n8n-nodes-keeper-secrets-manager@<version>`. The scanner's registry CLI checks provenance and the attested repository, which the local static scan cannot establish.
7. Submit through the [Creator Portal](https://creators.n8n.io/nodes). Passing automated checks does not guarantee acceptance.

## Scope and behavior

Only the existing five workflow operations are implemented. One-time token binding, attachments, Keeper notation, folder management and custom server-key configurations are excluded. Writes with ambiguous network results must be checked in Keeper before retrying. Partial deletion failures may leave some requested records already deleted.

The native implementation follows the official SDK's wire formats, while deliberately failing closed on malformed/decryption failures and avoiding global key caches and remote payload logging. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and reference versions.

Sources: [verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md), [submission requirements](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md), [Keeper JavaScript source](https://github.com/Keeper-Security/secrets-manager/tree/master/sdk/javascript).
