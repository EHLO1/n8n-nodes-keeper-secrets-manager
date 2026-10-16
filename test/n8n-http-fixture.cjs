const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { once } = require('node:events');
const {
	CredentialTestContext,
} = require('n8n-core/dist/execution-engine/node-execution-context/credentials-test-context');
const {
	KeeperSecretsManager,
} = require('../dist/nodes/KeeperSecretsManager/KeeperSecretsManager.node');
const keys = require('../dist/nodes/KeeperSecretsManager/KeeperServerKeys');
const { configuration, fakeKeeper, encoded, encryptedJson } = require('./fixtures.cjs');

async function main() {
	const fixture = configuration();
	const appKey = Buffer.from(fixture.config.appKey, 'base64');
	const recordKey = crypto.randomBytes(32);
	const raw = {
		recordUid: 'direct',
		revision: 1,
		recordKey: await encoded(recordKey, appKey),
		data: await encryptedJson({ title: 'Test', type: 'login', fields: [] }, recordKey),
	};
	let reply = { records: [raw] };
	const keeper = fakeKeeper(fixture, async () => reply);
	const originalKey = keys.serverKey;
	keys.serverKey = () => keeper.server.getPublicKey();
	const failures = [];
	const server = http.createServer(async (request, response) => {
		try {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const result = await keeper.transport({
				url: `https://keepersecurity.com${request.url}`,
				body: Buffer.concat(chunks),
				headers: {
					TransmissionKey: request.headers.transmissionkey,
					Authorization: request.headers.authorization,
					PublicKeyId: request.headers.publickeyid,
				},
			});
			response.writeHead(result.statusCode, { 'content-type': 'application/octet-stream' });
			response.end(result.body);
		} catch (error) {
			failures.push(error);
			response.writeHead(500);
			response.end();
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	try {
		const real = new CredentialTestContext();
		const node = new KeeperSecretsManager();
		const check = () =>
			node.methods.credentialTest.keeperCredentialTest.call(
				{
					helpers: {
						request: (options) =>
							real.helpers.request({
								...options,
								uri: `http://127.0.0.1:${server.address().port}${new URL(options.uri).pathname}`,
							}),
					},
				},
				{ data: fixture.credentials },
			);
		const result = await check();
		assert.deepEqual(failures, []);
		assert.deepEqual(result, { status: 'OK', message: 'Connected to Keeper Secrets Manager' });
		const appData = await encryptedJson({ title: 'Empty app', type: 'app' }, appKey);
		for (const encryptedAppKey of [null, '']) {
			reply = { records: [raw], appData, encryptedAppKey };
			assert.equal((await check()).status, 'OK');
		}
		reply = { records: [raw], appData, encryptedAppKey: 'nonempty-binding-envelope' };
		assert.deepEqual(await check(), {
			status: 'Error',
			message: 'Already-bound configuration required',
		});
		for (const empty of [{ appData }, { appData, records: null, folders: null }]) {
			reply = empty;
			assert.equal((await check()).status, 'OK');
		}
		for (const body of [
			Buffer.from('{"error":"access_denied","message":"private response"}'),
			Buffer.from('private non-JSON error'),
		]) {
			reply = { statusCode: 403, body };
			assert.deepEqual(await check(), {
				status: 'Error',
				message: 'Keeper rejected the request (HTTP 403)',
			});
		}
		reply = { statusCode: 200, body: crypto.randomBytes(60) };
		assert.deepEqual(await check(), {
			status: 'Error',
			message: 'Could not authenticate Keeper response',
		});
		reply = { appData: await encryptedJson({ title: 'Wrong key' }, crypto.randomBytes(32)) };
		assert.deepEqual(await check(), {
			status: 'Error',
			message: 'Could not authenticate Keeper application data',
		});
	} finally {
		keys.serverKey = originalKey;
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}
main().then(
	() => process.exit(0),
	(error) => {
		console.error(error);
		process.exit(1);
	},
);
