const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sdk = require('@keeper-security/secrets-manager-core');
const wire = require('../dist/nodes/KeeperSecretsManager/KeeperCrypto');
const keys = require('../dist/nodes/KeeperSecretsManager/KeeperServerKeys');
const { KeeperClient } = require('../dist/nodes/KeeperSecretsManager/KeeperClient');
const {
	KeeperSecretsManager,
} = require('../dist/nodes/KeeperSecretsManager/KeeperSecretsManager.node');
const { keeperOptions } = require('../dist/nodes/KeeperSecretsManager/GenericFunctions');
const {
	executionTransport,
	credentialTransport,
} = require('../dist/nodes/KeeperSecretsManager/KeeperTransport');
const {
	configuration,
	decrypt,
	encryptedJson,
	encoded,
	openEcies,
	fakeKeeper,
} = require('./fixtures.cjs');

const originalServerKey = keys.serverKey;

test('safe diagnostics distinguish network errors without echoing arbitrary error details', () => {
	for (const [code, expected] of [
		['ENOTFOUND', 'resolve'],
		['ETIMEDOUT', 'timed out'],
		['SELF_SIGNED_CERT_IN_CHAIN', 'self-signed'],
	]) {
		assert.match(
			wire.keeperFailureMessage(Object.assign(new Error('private payload'), { code })),
			new RegExp(expected),
		);
	}
	for (const error of [new Error('private payload'), { code: 'private payload' }, null]) {
		assert.equal(wire.keeperFailureMessage(error).includes('private payload'), false);
	}
});
afterEach(() => {
	keys.serverKey = originalServerKey;
	sdk.platform.cleanKeyCache();
});
function clientServer(fixture, handler) {
	const server = fakeKeeper(fixture, handler);
	keys.serverKey = (id) =>
		Number.isInteger(id) && id >= 7 && id <= 18 ? server.server.getPublicKey() : undefined;
	return {
		...server,
		client: new KeeperClient(keeperOptions(fixture.credentials), server.transport),
	};
}

async function recordFixture(fixture) {
	const appKey = Buffer.from(fixture.config.appKey, 'base64');
	const folderKey = crypto.randomBytes(32);
	const recordKey = crypto.randomBytes(32);
	const folderRecordKey = crypto.randomBytes(32);
	const flatKey = crypto.randomBytes(32);
	const data = {
		type: 'login',
		title: 'Fixture',
		fields: [{ type: 'password', value: ['synthetic-secret'] }],
		notes: 'Keep',
	};
	const response = {
		records: [
			{
				recordUid: 'direct',
				revision: 11,
				recordKey: await encoded(recordKey, appKey),
				data: await encryptedJson(data, recordKey),
			},
			{
				recordUid: 'flat',
				revision: 7,
				innerFolderUid: 'folder',
				recordKey: await encoded(flatKey, folderKey),
				data: await encryptedJson(data, flatKey),
			},
		],
		folders: [
			{
				folderUid: 'folder',
				folderKey: await encoded(folderKey, appKey),
				records: [
					{
						recordUid: 'nested',
						revision: 3,
						recordKey: await encoded(folderRecordKey, folderKey),
						data: await encryptedJson(data, folderRecordKey),
					},
				],
			},
		],
	};
	return { appKey, folderKey, recordKey, data, response };
}

test('AES-256-GCM accepts the NIST empty-message vector and rejects tampering', async () => {
	const key = Buffer.alloc(32);
	const known = Buffer.from('000000000000000000000000530f8afbc74536b9a963b4f1c4cb738b', 'hex');
	assert.deepEqual(wire.decrypt(known, key), Buffer.alloc(0));
	const data = Buffer.from('known synthetic data');
	const native = wire.encrypt(data, key);
	assert.deepEqual(await decrypt(native, key), data);
	const oracle = Buffer.from(await sdk.platform.encryptWithKey(data, key));
	assert.deepEqual(wire.decrypt(oracle, key), data);
	oracle[oracle.length - 1] ^= 1;
	assert.throws(() => wire.decrypt(oracle, key));
	assert.throws(() => wire.decrypt(Buffer.alloc(27), key));
	assert.throws(() => wire.decrypt(native, crypto.randomBytes(32)));
});

test('ECIES envelopes interoperate with SDK encryption and decryption', async () => {
	const fixture = configuration();
	const value = crypto.randomBytes(32);
	const native = wire.publicEncrypt(value, fixture.owner.getPublicKey());
	assert.deepEqual(await openEcies(native, fixture.owner), value);
	const reference = Buffer.from(
		await sdk.platform.publicEncrypt(value, fixture.owner.getPublicKey()),
	);
	const secret = fixture.owner.computeSecret(reference.subarray(0, 65));
	assert.deepEqual(
		wire.decrypt(reference.subarray(65), crypto.createHash('sha256').update(secret).digest()),
		value,
	);
	native[70] ^= 1;
	await assert.rejects(openEcies(native, fixture.owner));
});

test('all server points are valid and keys 7–17 exactly match the pinned SDK', async () => {
	const original = sdk.platform.publicEncrypt;
	try {
		let captured;
		sdk.platform.publicEncrypt = async (_data, key) => {
			captured = Buffer.from(key);
			return Buffer.alloc(0);
		};
		for (let id = 7; id <= 18; id++) {
			const point = keys.serverKey(id);
			assert.equal(point.length, 65);
			assert.equal(crypto.ECDH.convertKey(point, 'prime256v1').length, 65);
			if (id <= 17) {
				await sdk.generateTransmissionKey(
					sdk.loadJsonConfig(JSON.stringify({ serverPublicKeyId: String(id) })),
				);
				assert.deepEqual(point, captured);
			}
		}
	} finally {
		sdk.platform.publicEncrypt = original;
	}
	assert.equal(keys.serverKey(19), undefined);
});

test('base64 decoding rejects malformed and noncanonical encodings', () => {
	for (const value of ['A', 'A===', 'AB', '!!!!', '', null])
		assert.throws(() => wire.decodeBase64(value));
	assert.deepEqual(wire.decodeBase64('_w'), Buffer.from([255]));
	for (let i = 0; i < 100; i++) {
		const uid = wire.createUid();
		assert.match(uid, /^[A-Za-z0-9_-]{22}$/);
		assert.notEqual(Buffer.from(uid, 'base64url')[0] & 0xf8, 0xf8);
	}
});

test('credential key validation rejects incorrect sizes, curves and custom trust anchors', () => {
	const { config } = configuration();
	const wrongCurve = crypto
		.generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
		.privateKey.export({ format: 'der', type: 'pkcs8' })
		.toString('base64');
	for (const patch of [
		{ appKey: crypto.randomBytes(31).toString('base64') },
		{ clientId: crypto.randomBytes(32).toString('base64') },
		{ privateKey: wrongCurve },
		{ appOwnerPublicKey: Buffer.alloc(65).toString('base64') },
		{ privateKey: 'malformed-secret' },
		{ serverPublicKeyId: 99 },
		{ serverPublicKeyId: [7] },
		{ serverPublicKey: config.appOwnerPublicKey },
	])
		assert.throws(() =>
			keeperOptions({ source: 'json', configJson: JSON.stringify({ ...config, ...patch }) }),
		);
});

test('create without the owner key fails before sending any request', async () => {
	const fixture = configuration();
	delete fixture.config.appOwnerPublicKey;
	fixture.credentials.configJson = JSON.stringify(fixture.config);
	let calls = 0;
	const client = new KeeperClient(keeperOptions(fixture.credentials), async () => {
		calls++;
	});
	await assert.rejects(
		client.createSecret('folder', { type: 'login', title: 'Test', fields: [] }),
		/appOwnerPublicKey/,
	);
	assert.equal(calls, 0);
});

test('signed requests decrypt direct, nested and flat folder-shared records', async () => {
	const fixture = configuration();
	const records = await recordFixture(fixture);
	const { client, requests } = clientServer(fixture, async () => records.response);
	const result = await client.getSecrets(['direct', 'nested', 'flat']);
	assert.deepEqual(
		result.records.map((record) => record.recordUid),
		['direct', 'flat', 'nested'],
	);
	for (const record of result.records) assert.deepEqual(record.data, records.data);
	assert.deepEqual(requests[0].payload.requestedRecords, ['direct', 'nested', 'flat']);
	assert.deepEqual(Object.keys(result.records[0]), ['recordUid', 'revision', 'data']);
});

test('filtered reads return only requested records even if the server includes extras', async () => {
	const fixture = configuration();
	const records = await recordFixture(fixture);
	const { client } = clientServer(fixture, async () => records.response);
	assert.deepEqual(
		(await client.getSecrets(['direct'])).records.map((record) => record.recordUid),
		['direct'],
	);
});

test('the n8n node and credential test exercise encrypted traffic through their HTTP helpers', async () => {
	const fixture = configuration();
	const records = await recordFixture(fixture);
	const server = clientServer(fixture, async () => records.response);
	const node = new KeeperSecretsManager();
	const ctx = {
		getInputData: () => [{ json: {} }, { json: {} }],
		getCredentials: async () => fixture.credentials,
		getNode: () => ({
			name: 'Keeper',
			type: 'keeperSecretsManager',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getNodeParameter: (name, index) =>
			({
				operation: 'getByUid',
				recordUids: index === 0 ? 'direct' : 'nested',
				excludeUids: '',
				outputFormat: 'raw',
			})[name],
		continueOnFail: () => false,
		helpers: { httpRequest: (options) => server.transport(options) },
	};
	const [output] = await node.execute.call(ctx);
	assert.deepEqual(
		output.map((item) => [item.json.recordUid, item.pairedItem.item]),
		[
			['direct', 0],
			['nested', 1],
		],
	);
	const result = await node.methods.credentialTest.keeperCredentialTest.call(
		{ helpers: { request: (options) => server.transport({ ...options, url: options.uri }) } },
		{ data: fixture.credentials },
	);
	assert.deepEqual(result, { status: 'OK', message: 'Connected to Keeper Secrets Manager' });
});

test('missing record keys fail closed instead of falling back to an unrelated key', async () => {
	const fixture = configuration();
	const { appKey, data } = await recordFixture(fixture);
	const { client } = clientServer(fixture, async () => ({
		records: [{ recordUid: 'legacy', revision: 0, data: await encryptedJson(data, appKey) }],
	}));
	await assert.rejects(client.getSecrets());
});

test('create wraps record keys for both owner and folder; update preserves revision', async () => {
	const fixture = configuration();
	const records = await recordFixture(fixture);
	let createdUid;
	const { client } = clientServer(fixture, async ({ route, payload }) => {
		if (route === 'get_secret') return records.response;
		if (route === 'create_secret') {
			createdUid = payload.recordUid;
			assert.equal(payload.folderUid, 'folder');
			const fromOwner = await openEcies(Buffer.from(payload.recordKey, 'base64'), fixture.owner);
			const fromFolder = await decrypt(Buffer.from(payload.folderKey, 'base64'), records.folderKey);
			assert.deepEqual(fromOwner, fromFolder);
			assert.deepEqual(
				JSON.parse((await decrypt(Buffer.from(payload.data, 'base64url'), fromOwner)).toString()),
				records.data,
			);
			return;
		}
		assert.equal(route, 'update_secret');
		assert.equal(payload.recordUid, 'direct');
		assert.equal(payload.revision, 11);
		assert.deepEqual(
			JSON.parse(
				(await decrypt(Buffer.from(payload.data, 'base64url'), records.recordKey)).toString(),
			),
			{ ...records.data, title: 'Updated' },
		);
	});
	assert.equal(await client.createSecret('folder', records.data), createdUid);
	const { records: read } = await client.getSecrets(['direct']);
	read[0].data.title = 'Updated';
	await client.updateSecret(read[0]);
});

test('SDK reads the same encrypted direct and nested fixtures as the native client', async () => {
	const fixture = configuration();
	const records = await recordFixture(fixture);
	// SDK 17 predates flat folder-wrapped records; compare the formats it supports.
	const response = { ...records.response, records: records.response.records.slice(0, 1) };
	const options = {
		storage: sdk.loadJsonConfig(JSON.stringify(fixture.config)),
		queryFunction: async (_url, transmission) => ({
			statusCode: 200,
			data: await sdk.platform.encryptWithKey(
				Buffer.from(JSON.stringify(response)),
				transmission.key,
			),
		}),
	};
	const reference = await sdk.getSecrets(options);
	const { client } = clientServer(fixture, async () => response);
	const result = await client.getSecrets();
	assert.deepEqual(
		result.records,
		reference.records.map(({ recordUid, revision, data }) => ({ recordUid, revision, data })),
	);
});

test('deletion preserves safe per-record codes and omits remote error text', async () => {
	const fixture = configuration();
	const { client } = clientServer(fixture, async ({ route, payload }) => {
		assert.equal(route, 'delete_secret');
		assert.deepEqual(payload.recordUids, ['a', 'b']);
		return {
			records: [
				{ recordUid: 'a', responseCode: 'ok' },
				{ recordUid: 'b', responseCode: 'access_denied', errorMessage: 'private remote payload' },
			],
		};
	});
	assert.deepEqual(await client.deleteSecret(['a', 'b']), {
		records: [
			{ recordUid: 'a', responseCode: 'ok' },
			{ recordUid: 'b', responseCode: 'access_denied' },
		],
	});
});

test('legacy and current server-key rejections retry with the suggested trusted key', async () => {
	for (const discriminator of ['error', 'result_code']) {
		const fixture = configuration();
		let calls = 0;
		const { client, requests } = clientServer(fixture, async () =>
			++calls === 1
				? {
						statusCode: 403,
						body: Buffer.from(JSON.stringify({ [discriminator]: 'key', key_id: 8 })),
					}
				: { records: [] },
		);
		await client.getSecrets();
		await client.getSecrets();
		assert.deepEqual(
			requests.map((call) => call.request.headers.PublicKeyId),
			['7', '8', '8'],
		);
	}
});

test('rotation loops, unknown keys, throttling and network errors do not replay writes', async () => {
	for (const reply of [
		{ statusCode: 403, body: Buffer.from('{"error":"key","key_id":7}') },
		{ statusCode: 403, body: Buffer.from('{"error":"key","key_id":99}') },
		{ statusCode: 429, body: Buffer.from('{"result_code":"throttled"}') },
	]) {
		const fixture = configuration();
		const { client, requests } = clientServer(fixture, async () => reply);
		await assert.rejects(client.deleteSecret(['a']));
		assert.equal(requests.length, 1);
	}
	const fixture = configuration();
	const { client, requests } = clientServer(fixture, async () => {
		throw new Error('timeout');
	});
	await assert.rejects(client.deleteSecret(['a']));
	assert.equal(requests.length, 1);
});

test('repeated rotation is bounded even across different supported key IDs', async () => {
	const fixture = configuration();
	let keyId = 7;
	const { client, requests } = clientServer(fixture, async () => ({
		statusCode: 400,
		body: Buffer.from(JSON.stringify({ error: 'key', key_id: ++keyId })),
	}));
	await assert.rejects(client.getSecrets(), /rotation limit/);
	assert.equal(requests.length, 4);
});

test('tampered record data and malformed responses fail the entire read', async () => {
	const fixture = configuration();
	const records = await recordFixture(fixture);
	const damaged = Buffer.from(records.response.records[0].data, 'base64');
	damaged[damaged.length - 1] ^= 1;
	records.response.records[0].data = damaged.toString('base64');
	for (const reply of [
		records.response,
		{},
		{ records: 'bad' },
		{ encryptedAppKey: 'unbound', records: [] },
	]) {
		const { client } = clientServer(fixture, async () => reply);
		await assert.rejects(client.getSecrets());
	}
});

test('concurrent clients with identical record UIDs retain separate application keys', async () => {
	const a = configuration();
	const b = configuration();
	const ra = await recordFixture(a);
	const rb = await recordFixture(b);
	const serverA = fakeKeeper(a, async () => {
		await new Promise((resolve) => setImmediate(resolve));
		return ra.response;
	});
	const serverB = fakeKeeper(b, async () => rb.response);
	// Both synthetic endpoints use the same server key, like the real shared trust anchors.
	serverB.server.setPrivateKey(serverA.server.getPrivateKey());
	keys.serverKey = () => serverA.server.getPublicKey();
	const ca = new KeeperClient(keeperOptions(a.credentials), serverA.transport);
	const cb = new KeeperClient(keeperOptions(b.credentials), serverB.transport);
	const [one, two] = await Promise.all([ca.getSecrets(), cb.getSecrets()]);
	assert.equal(one.records[0].recordUid, two.records[0].recordUid);
	await assert.rejects(ca.updateSecret(two.records[0]), /read by this client/);
	assert.notDeepEqual(ra.appKey, rb.appKey);
});

test('HTTP adapters preserve bytes, set timeouts, and disable redirects', async () => {
	const request = {
		url: 'https://keepersecurity.com/api/rest/sm/v1/get_secret',
		headers: {},
		body: Buffer.from([0, 128, 255]),
	};
	let execution;
	const output = await executionTransport({
		helpers: {
			httpRequest: async (options) => {
				execution = options;
				return { statusCode: 200, body: new Uint8Array([0, 255]) };
			},
		},
	})(request);
	assert.deepEqual(output.body, Buffer.from([0, 255]));
	assert.equal(execution.timeout, 30000);
	assert.equal(execution.disableFollowRedirect, true);
	assert.equal(execution.sendCredentialsOnCrossOriginRedirect, false);
	assert.equal(execution.encoding, 'arraybuffer');
	assert.deepEqual(execution.body, request.body);
	let credential;
	await credentialTransport({
		helpers: {
			request: async (options) => {
				credential = options;
				return { statusCode: 200, body: Buffer.alloc(0) };
			},
		},
	})(request);
	assert.equal(credential.encoding, null);
	assert.equal(credential.uri, request.url);
	assert.equal(credential.json, false);
	assert.equal(credential.followRedirect, false);
	assert.equal(credential.followAllRedirects, false);
	assert.equal(credential.timeout, 30000);
	await assert.rejects(
		executionTransport({
			helpers: { httpRequest: async () => ({ statusCode: 200, body: 'decoded ciphertext' }) },
		})(request),
		/binary response/,
	);
	await assert.rejects(
		executionTransport({
			helpers: {
				httpRequest: async () => ({ statusCode: 200, body: Buffer.alloc(16 * 1024 * 1024 + 1) }),
			},
		})(request),
		/too large/,
	);
});
