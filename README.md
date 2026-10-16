# n8n-nodes-keeper-secrets-manager

Read and manage Keeper Secrets Manager records in n8n workflows.

**Development status:** this package is not verified by n8n. It implements the Keeper protocol using Node.js cryptography and n8n HTTP helpers, with no external runtime dependencies. The official Keeper SDK is used only for development comparison tests. Build, unit tests, strict lint and local source/package static analysis pass; live Keeper and n8n integration testing is still required. See [VERIFICATION.md](VERIFICATION.md) for the remaining work.

## Installation

For self-hosted n8n, follow the [community-node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) using `n8n-nodes-keeper-secrets-manager` once a release is published. This repository does not imply that a release is already available. Unverified packages cannot be installed on n8n Cloud through the verified-node catalog.

For local development, use Node.js 24 and pnpm 12.11.2:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm format:check
pnpm lint
pnpm scan
pnpm dev
```

`pnpm scan` runs the official n8n scanner against source and a temporary unpacked tarball (Linux/macOS, including WSL). It checks code statically; npm provenance can be checked only after publishing through GitHub Actions.

## Credentials

1. Create a Keeper Secrets Manager application and share the necessary records or shared folders with it.
2. Add a device and generate a complete, **bound** configuration using Keeper’s supported tooling. A one-time token alone is insufficient: Keeper redeems it on the first read and completes the configuration. Finish binding outside n8n, then export the resulting configuration.
3. Create **Keeper Secrets Manager API** credentials in n8n. Choose Base64 or JSON and paste the bound configuration.
4. Test the credentials. The test reads the application’s accessible records but returns only a connection result.

Required configuration properties are `hostname`, `clientId`, `privateKey`, and `appKey`. `serverPublicKeyId` is optional (supported IDs: 7–18). **Creating records also requires `appOwnerPublicKey`** from the complete bound configuration. Custom server keys and IL5 configurations are not supported. Supported hostnames are `keepersecurity.com`, `keepersecurity.eu`, `keepersecurity.com.au`, `keepersecurity.jp`, `keepersecurity.ca`, and `govcloud.keepersecurity.us`.

Configuration fields contain private keys and are masked in the credential editor. This node keeps its configuration in memory and does not write a configuration file. Each execution has a separate protocol client and key storage. Concurrent workflows do not share encryption keys or a global lock. HTTP requests have a 30-second timeout and do not follow redirects. Responses over 16 MiB are rejected before decryption; n8n buffers them before that check. Only explicit server-key rejections are retried (up to three retries); network errors, throttling and ambiguous writes are not retried automatically.

## Operations

| Operation          | Behavior                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Get Many           | Read all records shared with the application; one output item per record                                |
| Get Secrets by UID | Read a comma- or whitespace-separated list of record UIDs; fail if any requested record is inaccessible |
| Create a Secret    | Create a record in a root shared folder accessible to the application                                   |
| Update a Secret    | Apply a top-level patch to an existing record                                                           |
| Delete Secrets     | Delete the specified records after enabling Confirm Deletion                                            |

Create, update, and delete require the corresponding Keeper application permissions. Operations run once per input item; avoid feeding multiple items to a write unless you intend multiple writes. Parameter expressions such as `{{ $json.recordUid }}` are evaluated for each input item. Outputs retain their input-item links.

Reads support exclusion by UID. Exclusion filters output after retrieval; it does not prevent Keeper from returning those records to the node.

## Usage

### Read a record

Connect a Manual Trigger to Keeper Secrets Manager, select **Get Secrets by UID**, and enter a record UID or `{{ $json.recordUid }}`. Select **Raw Record Data** to receive `recordUid`, `revision`, and `data` with Keeper’s structured fields and custom fields. Encryption keys, attachment URLs, and other protocol metadata are omitted. Attachments, Keeper notation, folder management, and one-time token binding are outside this node's scope.

**Flat (Selected Fields)** provides `recordUid`, `title`, `revision`, `login`, `password`, `distinguishedName`, `description`, `id`, and `domain`. It uses the first value of each matching field; labels take precedence over field types and later duplicate names overwrite earlier ones. Use raw output to retain arrays, duplicate fields, and other record properties.

### Create a record

Choose **Create a Secret**, specify the root shared folder UID, and provide Record Data JSON:

```json
{
	"type": "login",
	"title": "Workflow account",
	"fields": [
		{ "type": "login", "value": ["automation@example.com"] },
		{ "type": "password", "value": ["replace-with-your-secret"] }
	]
}
```

### Update a record

Choose **Update a Secret**, specify its UID, and provide Update Data JSON:

```json
{ "title": "Updated account", "notes": "Managed by n8n" }
```

Omitted properties remain unchanged. Supplied `fields` or `custom` arrays replace the entire existing array, including with an empty array. Empty patches and unsupported top-level properties are rejected.

### Handle failures

Validation errors explain the invalid input without echoing configuration or field values. Protocol and transport errors use a generic message because remote errors may contain sensitive payloads. A write with a network error may already have completed; verify Keeper before retrying, especially for create operations.

Partial deletion failures stop execution by default. With n8n’s Continue On Fail setting, the output contains `success: false`, an error, and per-record status codes, including `missing_response` if Keeper omitted a requested record. Successful deletions are not rolled back.

Record values, including passwords, appear in node output and may be saved in n8n execution history. Set execution retention and workflow access accordingly.

## Compatibility and testing

The package builds against `n8n-workflow` 2.16.0 and uses the n8n node CLI 0.52.3. A minimum compatible n8n application release has not yet been established by live testing. No live Keeper or n8n integration test has been completed in this review. Tests use synthetic configurations, an encrypted mock Keeper endpoint, known-answer cryptographic vectors, and the official SDK as a comparison oracle. They verify protocol formats without accessing a Keeper account; they do not replace live integration testing.

## Publishing

The workflows use pnpm with the frozen lockfile. Configure npm Trusted Publishing for repository `ehlo1/n8n-nodes-keeper-secrets-manager`, workflow `publish.yml`. Once all strict checks and live tests pass, run `pnpm release` from a clean `main` checkout to create and push a version tag. GitHub Actions tests the package, checks the tag version, runs source and tarball static analysis, and runs the n8n release command with provenance. The n8n CLI invokes npm internally for registry publication; project dependency management remains pnpm.

Publishing and Creator Portal submission have not been performed.

## Resources

- [Keeper JavaScript SDK](https://docs.keeper.io/keeperpam/secrets-manager/developer-sdk-library/javascript-sdk)
- [Keeper configuration and binding lifecycle](https://docs.keeper.io/keeperpam/secrets-manager/about/secrets-manager-configuration)
- [n8n verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md)
- [n8n submission and provenance requirements](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md)

## License

MIT. The protocol adaptation retains Keeper Security's copyright and license in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which is included in the published package. This community integration is not an official Keeper or n8n product.
