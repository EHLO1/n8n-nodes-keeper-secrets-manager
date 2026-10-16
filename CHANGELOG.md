# Changelog

## Unreleased

- Remove the Example scaffold and npm lockfile; use pinned pnpm and node CLI versions.
- Add node discovery metadata, credential icons and a custom credential connection test.
- Replace the runtime Keeper SDK with a native protocol client using Node.js cryptography and n8n HTTP helpers. Retain the SDK as a development-only test oracle and include Keeper's MIT attribution in the published package.
- Isolate encryption keys per execution; implement signed encrypted requests, authenticated response decryption, owner/folder record-key wrapping, bounded server-key rotation, request timeouts and disabled redirects.
- Validate bound configuration and record patches without exposing credential or record values in validation errors.
- Preserve per-item expression evaluation and output linking; report partial deletion failures as errors by default.
- Add regression tests, pnpm CI, provenance publishing setup, usage documentation and a verification roadmap.
- Keep strict verification checks enabled and add the official scanner's local source and package-tarball checks to CI. Live Keeper/n8n integration testing and provenance verification after publishing remain required.
