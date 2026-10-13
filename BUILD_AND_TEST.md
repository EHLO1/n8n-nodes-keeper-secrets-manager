# Build and test guide

## Status and scope

This guide applies to the revised JSON/Base64-only starter. The package currently has a minimal TypeScript build script. It does not have dev, lint, or test scripts, a lockfile, or automated tests. Instructions below are a proposed development workflow, not evidence that compilation or integration tests passed. No live Keeper access was used to prepare this guide.

## 1. Repository recommendation

Create a new private repository for this integration. Prefer generating a project with the official n8n CLI, or creating a repository from the official starter template. Do not fork the example merely to build an independent integration; reserve a fork for work intended to contribute back to the starter itself. This is a recommendation, not an n8n requirement.

Official scaffold command:

```sh
npm create @n8n/node@latest
```

Select the appropriate programmatic node template and your Keeper package name. Copy these source files from this archive into the generated project:

- credentials/KeeperSecretsManagerApi.credentials.ts
- nodes/KeeperSecretsManager/GenericFunctions.ts
- nodes/KeeperSecretsManager/KeeperSecretsManager.node.ts

Remove generated example nodes/credentials. Keep the scaffold's build/lint/dev tooling and TypeScript configuration instead of overwriting them with this starter's minimal configuration. Merge the Keeper SDK dependency and these package.json registration entries:

```json
{
 "n8n": {
  "n8nNodesApiVersion": 1,
  "credentials": ["dist/credentials/KeeperSecretsManagerApi.credentials.js"],
  "nodes": ["dist/nodes/KeeperSecretsManager/KeeperSecretsManager.node.js"]
 }
}
```

Confirm generated output paths match these entries. Keep the scaffold's other metadata. Add any required codex metadata/icon and resolve lint findings before release. Never commit real Keeper configuration, credentials, execution exports containing secrets, or local n8n databases.

## 2. Build the existing archive directly

Extract the ZIP and open a terminal in its inner n8n-nodes-keeper-secrets-manager directory. Choose one package manager.

pnpm:

```sh
pnpm install
pnpm run build
pnpm pack
```

npm:

```sh
npm install
npm run build
npm pack
```

Expected compiled files include:

- dist/credentials/KeeperSecretsManagerApi.credentials.js
- dist/nodes/KeeperSecretsManager/GenericFunctions.js
- dist/nodes/KeeperSecretsManager/KeeperSecretsManager.node.js

A successful TypeScript build validates type compatibility, not Keeper authentication or operation behavior. If compilation fails, stop and resolve the errors against the installed SDK declarations and your target n8n version. The SDK 17.0.0 pin is inherited from the starter and remains unverified. Pin n8n-workflow to a deployment-compatible version rather than leaving the wildcard for a release.

Commit only the lockfile for your selected manager. For subsequent clean CI installs, use pnpm install --frozen-lockfile or npm ci after committing the corresponding lockfile. Do not publish to npm just to test locally.

## 3. Local n8n testing with official CLI

Recommended: use the scaffold from section 1, which provides CLI scripts. In that generated project:

```sh
npm run build
npm run lint
npm run dev
```

If using pnpm consistently in the scaffold, run the corresponding pnpm run commands. Check generated package.json before running: these scripts belong to the scaffold, not the original minimal ZIP.

Alternatively, to add CLI commands to the existing minimal project, install the official CLI as a development dependency:

```sh
pnpm add -D @n8n/node-cli
pnpm exec n8n-node build
pnpm exec n8n-node lint
pnpm exec n8n-node dev
```

npm equivalent:

```sh
npm install --save-dev @n8n/node-cli
npx n8n-node build
npx n8n-node lint
npx n8n-node dev
```

This is a suggested adaptation of the documented CLI commands. The minimal starter has not been validated against the CLI and may need metadata/configuration fixes; the generated scaffold is the preferred route. Do not interpret installing the CLI as resolving lint findings automatically.

The official dev command builds and links the node, starts local n8n, and rebuilds on changes. It uses its own .n8n-node-cli user folder rather than an existing n8n installation. Open http://localhost:5678, sign in, and search for Keeper Secrets Manager in the node panel. Stop with Ctrl+C. Test locally rather than attaching this development workflow to production.

## 4. Prepare isolated Keeper test data

Suggested test setup:

- A dedicated test KSM application/device and disposable shared folder with permissions for the operations under test.
- Two disposable records with known titles, standard fields, custom fields, and at least one multi-value field.
- One valid UID inaccessible to the test application for negative tests.
- A second read-only configuration for denied-write tests, if available.

Export Base64 from Keeper Add Device > Configuration File > Base64 > Copy. Create a Keeper Secrets Manager credential in local n8n and paste it into the Base64 field. Create a separate JSON-mode credential using the corresponding JSON export. Never paste credentials into workflow parameters, code, logs, test fixtures, or this repository.

## 5. Manual smoke-test workflow

Use Manual Trigger -> Keeper Secrets Manager. Use one incoming item for initial read tests. Keep automatic retries off for write tests.

| Test | Setup/action | Expected behavior in this implementation |
| --- | --- | --- |
| Credential required | Leave credential unselected | Node requires credential selection |
| Base64 read | Get All, Base64 credential | Accessible records returned |
| JSON read | Repeat with JSON credential | Equivalent record UIDs/data, disregarding order |
| Removed file mode | Open credential editor | Only Base64 and JSON options |
| Raw output | Get All, Raw | UID, revision, data; no full SDK record/key material |
| Flat output | Get All, Flat | Existing flattened shape; first field values used |
| Exclusion | Exclude one known UID | That UID omitted |
| UID lookup | Request two accessible UIDs | Requested records returned |
| Missing access | Include inaccessible UID | Item fails rather than silent partial read |
| Empty result | Application with no records, if available | No output items unless n8n Always Output Data is enabled |
| Create | Use test folder and sample data below | UID/success returned; record visible in Keeper |
| Update title | Patch title only | Title changes; fields/custom remain unchanged |
| Update arrays | Supply complete fields array | Entire fields array replaced; omitted custom preserved |
| Read after update | Fetch UID again | Updated data observed |
| Delete unconfirmed | Leave confirmation off | Error; test record remains |
| Delete confirmed | Confirm and delete disposable UID | Inspect aggregate success and per-UID responseCode; verify actual Keeper state |
| Mixed delete results | Disposable accessible UID plus inaccessible UID | If Keeper returns per-record results, aggregate success false; do not blindly retry batch |
| Malformed config | Invalid Base64/JSON or incomplete config | Sanitized configuration error; no config echoed |
| Invalid data | Create without required properties | Sanitized operation error; no secret echoed |
| Denied write | Use read-only credential | Failure; verify no unintended change |
| Item linking | Two input items, separate UID expressions | Output pairedItem links to correct input |
| Continue on error | Valid config, one failing item then valid item | Error item emitted and later item processed |

Credential-loading errors occur before the per-item loop and abort execution even with Continue on Fail. This is current behavior, not a test failure. Delete partial failures are returned as data, not automatically thrown; branch on success in the workflow.

Create sample (dummy values only):

```json
{
 "type": "login",
 "title": "KSM node disposable test",
 "fields": [
  { "type": "login", "value": ["test-user"] },
  { "type": "password", "value": ["DUMMY-TEST-VALUE"] }
 ],
 "custom": [{ "type": "text", "label": "Domain", "value": ["example.invalid"] }],
 "notes": "Disposable integration test"
}
```

Title-only update:

```json
{ "title": "KSM node updated test" }
```

Do not use a single password field as an update unless you intend to replace the complete fields array. Verify writes in Keeper before retrying any ambiguous failure.

## 6. Automated tests to add before release

There is no pnpm test/npm test script in this package. The manual matrix is not an automated test suite. Suggested future coverage with a test runner and mocked Keeper SDK:

- JSON/Base64 parsing and equivalent configs; whitespace and malformed input.
- Rejection of one-time-token/incomplete configs and unsupported source values.
- Fresh storage per execution and no cross-credential reuse.
- UID parsing/deduplication, missing records, and exclusions.
- Raw output key allowlist; flat normalization, null/empty values, duplicate labels, and multi-value behavior.
- Update preservation of omitted properties and explicit array replacement.
- Deletion confirmation, mixed status results, and missing responses.
- Sanitized errors, continue-on-fail behavior, and item linking.

Mock tests do not replace live CRUD tests against a disposable Keeper application.

## 7. Release gates

- Successful clean build using pinned compatible versions and committed lockfile.
- Resolved lint findings, with any deliberate exceptions documented.
- Both credential modes and all manual smoke tests verified.
- Automated tests implemented and passing before production release.
- Review SDK internal logging, execution retention, credential sharing, and least privilege.
- No actual secrets in Git, packaged files, fixtures, or workflow exports.
- Test the packaged artifact in staging on the same n8n version and deployment topology as production. Install the package/dependencies on every process that executes the node according to your deployment procedure; this guide does not modify your production deployment.

## Official references

- https://docs.n8n.io/connect/create-nodes/build-your-node/using-the-n8n-node-tool/
- https://docs.n8n.io/connect/create-nodes/test-your-node/run-your-node-locally/
- https://docs.n8n.io/connect/create-nodes/test-your-node/
- https://docs.n8n.io/connect/create-nodes/build-your-node/tutorial-build-a-programmatic-style-node/
