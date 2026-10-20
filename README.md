# n8n-nodes-keeper-secrets-manager

Read and manage Keeper Secrets Manager records in n8n workflows.

**Development status:** this package is not verified by n8n. It implements the Keeper protocol using Node.js cryptography and n8n HTTP helpers, with no external runtime dependencies. The official Keeper SDK is used only for development comparison tests. Credentials and both read operations have passed live testing on n8n 2.10.3. New folder metadata and create/update/delete still need live testing. See [VERIFICATION.md](VERIFICATION.md) for the remaining work.

## Installation

For self-hosted n8n, follow the [community-node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) using the exact beta version below. Unverified packages cannot be installed on n8n Cloud through the verified-node catalog.

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
| Get All Records    | Read all records shared with the application; one output item per record                                |
| Get Records by UID | Read a comma- or whitespace-separated list of record UIDs; fail if any requested record is inaccessible |
| Create a Record    | Create a record in a root shared folder accessible to the application                                   |
| Update a Record    | Update selected fields or apply a Raw JSON patch                                                        |
| Delete Records     | Delete the specified records after enabling Confirm Deletion                                            |

Create, update, and delete require the corresponding Keeper application permissions. Operations run once per input item; avoid feeding multiple items to a write unless you intend multiple writes. Parameter expressions such as `{{ $json.recordUid }}` are evaluated for each input item. Outputs retain their input-item links.

Reads support exclusion by UID. Exclusion filters output after retrieval; it does not prevent Keeper from returning those records to the node.

Enable **Exclude Null Values** to remove top-level keys whose value is null. This option defaults to off and retains `false`, `0`, empty strings, arrays, and nulls nested inside compound values.

## Usage

### Read a record

Connect a Manual Trigger to Keeper Secrets Manager, select **Get Records by UID**, and enter one or more record UIDs or `{{ $json.recordUid }}`. Every read returns flat output. Encryption keys, attachment URLs, and other protocol metadata are omitted. Attachment downloads, Keeper notation, folder management, and one-time token binding are outside this node's scope.

Flat output retains `recordUid`, `title`, `revision`, `login`, `password`, `distinguishedName`, `description`, `id`, and `domain`, and adds `folderUid` and `folderName` for the direct containing folder. Directly shared records without folder metadata have null folder values. Resolving names makes one additional encrypted `get_folders` request, cached for the execution; a failed folder request or malformed metadata fails the read.

All values from both `fields` and `custom` are flattened. Labels take precedence over types; whitespace is removed and names are lowercased, with `distinguishedName` retained for compatibility. Empty values become null, single values become scalars or objects, and multiple values remain arrays. Duplicate names gain `_2`, `_3`, etc.; names conflicting with record metadata use a `field_` prefix. Record keys and protocol metadata never become output columns.

Beta.4 intentionally removes the Raw Record Data output option. Existing read nodes also return flat output; reselect **Get All Records** on nodes previously configured as Get Many. The previous `getAll` operation value still executes.

### Create a record

Choose **Create a Record** and specify the root shared folder UID. This is required: Keeper wraps the new record key using that shared folder's key. **Structured Fields** is the default. Title is the record name displayed in Keeper, separate from its login. Choose a Record Type to populate its default fields, fill the values you need, and optionally enter record-level Notes.

There is one **Fields** section. Standard types and labels fill the selected template's standard slots; extra types, labels, and occurrences become optional custom fields automatically. The templates cover the 18 types in [Keeper's default record type reference](https://docs.keeper.io/keeperpam/secrets-manager/about/field-record-types#default-record-types), with additional current SDK defaults such as login passkeys and one-time codes. File/photo templates only reference existing attachments; uploading attachments is outside scope. Custom tenant schemas can be named explicitly; because the node cannot discover those schemas, use Raw JSON when you need control over their standard/custom arrays.

The value format follows the Keeper field type. Text fields preserve strings such as `001234` and `false` exactly. Date fields accept integer epoch milliseconds; checkbox fields accept `true` or `false`. Compound fields accept a JSON object or an array of objects, for example a host: `{"hostName":"db.example.com","port":"5432"}`. Reference fields such as `fileRef` accept a JSON array of existing UIDs. Blank template values produce empty value arrays on creation. There is no Data Type selector.

Alternatively, choose **Raw JSON** and provide Record Data JSON:

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

Choose **Update a Record** and specify its UID. **Keep Existing Type** is the default; it uses the retrieved record's type when classifying supplied fields. Selecting a specific type displays its default fields and explicitly applies that type to the record. Enter a Title to rename the record and Notes to replace record-level notes; leave either blank to preserve it. **Clear Notes** explicitly removes notes.

Fill only the field values to change. Blank template placeholders are ignored. **Clear Value** (or an empty JSON value array for compound/reference fields) explicitly empties a matching field. Existing fields match by Keeper type and label; other field values and metadata are retained. Extra fields are added to custom. Ambiguous duplicate matches are rejected. Selecting another template displays that template's own fields, so values entered for a different template are not submitted accidentally.

Alternatively, choose **Raw JSON** and provide Update Data JSON:

```json
{ "title": "Updated account", "notes": "Managed by n8n" }
```

For Raw JSON, omitted properties remain unchanged. Supplied `fields` or `custom` arrays replace that array's contents. For a known default record type, missing standard slots are filled with empty value arrays, and fields that do not match the schema are moved into custom without dropping existing custom fields when custom is omitted. An empty fields array clears all standard values. If type is omitted on update, the existing record type is used. Tenant-defined schemas are left in their supplied arrays. Empty patches and unsupported top-level properties are rejected. Examples in the JSON editor are formatted across multiple lines.

Saved beta.4 input containers remain supported for execution but are hidden in the new editor. Reconfigure existing write nodes using the new Fields section before editing their values; do not mix old saved fields with new rows targeting the same field.

### Handle failures

Validation errors explain the invalid input without echoing configuration or field values. Protocol and transport errors use a generic message because remote errors may contain sensitive payloads. A write with a network error may already have completed; verify Keeper before retrying, especially for create operations.

Partial deletion failures stop execution by default. With n8n’s Continue On Fail setting, the output contains `success: false`, an error, and per-record status codes, including `missing_response` if Keeper omitted a requested record. Successful deletions are not rolled back.

Record values, including passwords, appear in node output and may be saved in n8n execution history. Set execution retention and workflow access accordingly.

## Compatibility and testing

The package builds against `n8n-workflow` 2.16.0 and uses the n8n node CLI 0.52.3. A regression test exercises the actual credential-test HTTP helper from `n8n-core` 2.10.1, shipped with n8n 2.10.3, over a local HTTP server with synthetic encrypted Keeper responses. It covers reads, empty applications, HTTP rejection and decryption errors. A minimum compatible n8n application release has not yet been established by live testing. These tests and the SDK comparisons do not replace testing against a real Keeper application in n8n.

## Publishing

### First beta and GUI installation

The first test release is `0.1.0-beta.1`, published under npm's `beta` dist-tag. The publish workflow selects `beta` for versions ending in `-beta.N`, and `latest` for stable versions. npm also assigned `latest` during the initial publication. A post-publish check attempts to remove it if it points to this beta; an existing stable `latest` is preserved. If npm refuses token-based tag removal, the check reports a warning and a maintainer can remove the tag using an interactive npm login. Install the exact beta version shown below regardless of dist-tag state.

For the first publication, create a short-lived npm granular access token with permission to publish this new package and suitable noninteractive publishing/2FA permissions. Add it as the GitHub repository Actions secret `NPM_TOKEN`; never commit it or paste it into an issue or chat. The workflow supplies it to npm only for the publish step. After the package exists, configure Trusted Publishing for owner `EHLO1`, repository `n8n-nodes-keeper-secrets-manager`, workflow `publish.yml`. Verify OIDC publishing on a subsequent release before removing and revoking the bootstrap token.

Commit and push the release changes, then push the matching tag `0.1.0-beta.1`. The tag triggers tests, scans and publication through `n8n-node release` with provenance. Do not publish directly from a local machine.

Once the workflow succeeds, a self-hosted n8n Owner/Admin can open **Settings → Community Nodes → Install** and enter:

```text
n8n-nodes-keeper-secrets-manager@0.1.0-beta.5
```

Accept the unverified community-node notice and install. The Docker host does not need to compile this package. Community-node installation and unverified packages must be enabled by the instance administrator. Ensure the n8n data directory uses persistent storage so the installed package survives container replacement; queue-mode workers must also have the package available.

Use the exact beta version for repeatable tests. The `@beta` tag also works for the initial installation, but n8n resolves it once and does not continuously follow that tag. n8n's update UI may compare against the stale `latest` tag (initially beta.1), making a newer beta appear to be ahead of the advertised latest release. The semantic version order is unchanged: beta.3 is newer than beta.2, which is newer than beta.1. Updates to a specific later beta may require uninstalling and reinstalling the target version; back up test workflows first.

The first beta is intended for testing with a dedicated Keeper application and disposable records. It does not imply n8n verification or completion of live integration testing.

### Subsequent releases

The workflows use pnpm with the frozen lockfile. Once all strict checks and live tests pass, run `pnpm release` from a clean `main` checkout to create and push a version tag. GitHub Actions tests the package, checks the tag version, runs source and tarball static analysis, and runs the n8n release command with provenance. The n8n CLI invokes npm internally for registry publication; project dependency management remains pnpm.

Beta publishing has been performed; Creator Portal submission remains pending.

## Resources

- [Keeper JavaScript SDK](https://docs.keeper.io/keeperpam/secrets-manager/developer-sdk-library/javascript-sdk)
- [Keeper configuration and binding lifecycle](https://docs.keeper.io/keeperpam/secrets-manager/about/secrets-manager-configuration)
- [n8n verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md)
- [n8n submission and provenance requirements](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md)

## License

MIT. The protocol adaptation retains Keeper Security's copyright and license in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which is included in the published package. This community integration is not an official Keeper or n8n product.
