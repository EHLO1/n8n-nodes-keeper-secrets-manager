# Changelog

## 0.1.0

First stable release, published under npm's latest tag after beta.6 user testing.

- Fields as Array now returns separate `fields` and `custom` arrays using Keeper's classification. Both preserve labels, duplicate entries, and value arrays; null exclusion applies independently to each.
- Flat output remains the default. Array-mode output intentionally changes from beta.6's combined fields array.

## 0.1.0-beta.6

- Show default field items with friendly fixed titles and value inputs. Standard field types/labels are no longer editable; added fields retain their type/label controls.
- Populate only the fields listed in Keeper's default-record tables. Extra SDK-supported fields remain available through Add Field instead of appearing by default.
- Support n8n's native Delete Item control. Removed structured-create inputs are not restored as empty schema slots. On update, omitted inputs preserve stored values.
- Keep Clear Value exclusively for updates; creation ignores saved clear flags.
- Add Fields as Array to read operations. Standard and custom fields share a single array, while record metadata stays at the top level. Null exclusion also omits empty/all-null array entries while retaining false, zero, and empty strings.
- Preserve saved beta.5 generic input rows as Additional Field items.

## 0.1.0-beta.5

- Add Keeper's 18 documented default record templates, including standard field labels and the current SDK's additional default fields. Selecting a record type populates its Fields section.
- Combine standard and custom field entry into one section. Automatically move extra field types, labels, and occurrences to custom for known record types, for both structured input and Raw JSON. Unknown tenant schemas retain their explicit arrays.
- Infer structured value formats from Keeper field types; preserve textual secrets exactly. Remove the Data Type selector. Blank placeholders preserve existing values; Clear Value explicitly empties a field.
- Replace Additional Properties and Update Fields containers with direct Title, Notes, and Clear Notes controls. Add explanatory tooltips, Keeper documentation links, and a fuller Raw JSON update example.
- Add Exclude Null Values to both read operations, preserving false, zero, empty strings, and nested values.
- Retain support for saved beta.4 input containers without displaying them in the new editor.

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
