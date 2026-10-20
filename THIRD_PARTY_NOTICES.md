# Third-party notices

The Keeper protocol implementation and server public keys in
`nodes/KeeperSecretsManager/KeeperCrypto.ts`, `KeeperClient.ts`, and
`KeeperServerKeys.ts` are adapted from or based on Keeper Security's JavaScript
Secrets Manager SDK:

- https://github.com/Keeper-Security/secrets-manager/tree/master/sdk/javascript
- Wire-format reference and test oracle: `@keeper-security/secrets-manager-core` 17.0.0 (development dependency only).
- Server key ID 18, bounded rotation, and flat folder-shared record handling were checked against upstream `sdk/javascript/packages/core/src/keeper.ts` on October 16, 2026.
- The application uses its own n8n HTTP adapters, per-client key storage, strict input checks and error handling. It does not vendor the SDK's storage, networking, logging, or global cache implementation.
- `RecordSchemas.ts` adapts the documented default record definitions and labels from `sdk/python/helper/keeper_secrets_manager_helper/v3/default_record_types.yml`, checked October 20, 2026: https://github.com/Keeper-Security/secrets-manager/blob/master/sdk/python/helper/keeper_secrets_manager_helper/v3/default_record_types.yml. It covers the 18 default types in Keeper's field/record documentation. Tenant-defined and PAM-specific schemas are preserved as supplied rather than guessed.

Upstream license: https://github.com/Keeper-Security/secrets-manager/blob/master/LICENSE

MIT License

Copyright (c) 2021 Keeper Security

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
