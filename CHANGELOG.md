# Changelog

## 0.1.0-beta.4

- Use flat output for every read, retaining the selected columns and adding custom fields, duplicate values, multi-value arrays, and direct folder UID/name.
- Resolve folder names through Keeper's encrypted folder API, including nested subfolders, with an execution-local cache.
- Label operations using Records, including Get All Records. Existing getAll workflow operations still execute.
- Default create/update to structured fields with text, number, boolean, and JSON-array values. Structured updates preserve unrelated fields; Raw JSON remains available with formatted examples.
- Add JSON validation to the masked configuration input. n8n still renders masked credential inputs on one line.
- Live testing confirmed credentials and both read operations on n8n 2.10.3 with beta.3. New folder metadata and write controls still need live testing.

## 0.1.0-beta.3

- Match Keeper SDK handling of null/empty `encryptedAppKey` response fields. An already-bound configuration is no longer rejected just because that JSON field is present without a binding envelope.
- Add regression cases through the actual n8n 2.10.3 credential-test HTTP helper, retaining rejection of a nonempty binding envelope.

## 0.1.0-beta.2

- Accept authenticated Keeper application responses with no records or with null optional record/folder arrays.
- Report safe HTTP status, network/TLS, and decryption-stage errors in credential tests without exposing remote payloads, configuration or secret values.
- Handle plaintext error responses from n8n's legacy credential-test HTTP adapter while requiring binary success responses.
- Add an integration regression using the exact n8n-core library shipped with n8n 2.10.3, a local HTTP server, and synthetic encrypted Keeper responses.

## 0.1.0-beta.1

Initial prerelease for self-hosted n8n integration testing. Not verified by n8n.

- Remove the Example scaffold and npm lockfile; use pinned pnpm and node CLI versions.
- Add node discovery metadata, credential icons and a custom credential connection test.
- Replace the runtime Keeper SDK with a native protocol client using Node.js cryptography and n8n HTTP helpers. Retain the SDK as a development-only test oracle and include Keeper's MIT attribution in the published package.
- Isolate encryption keys per execution; implement signed encrypted requests, authenticated response decryption, owner/folder record-key wrapping, bounded server-key rotation, request timeouts and disabled redirects.
- Validate bound configuration and record patches without exposing credential or record values in validation errors.
- Preserve per-item expression evaluation and output linking; report partial deletion failures as errors by default.
- Add regression tests, pnpm CI, provenance publishing setup, usage documentation and a verification roadmap.
- Keep strict verification checks enabled and add the official scanner's local source and package-tarball checks to CI. Live Keeper/n8n integration testing and provenance verification after publishing remain required.
