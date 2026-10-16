const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sdk = require('@keeper-security/secrets-manager-core');

function configuration() {
	const device = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const owner = crypto.createECDH('prime256v1');
	owner.generateKeys();
	const config = {
		hostname: 'keepersecurity.com',
		clientId: crypto.randomBytes(64).toString('base64'),
		privateKey: device.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
		appKey: crypto.randomBytes(32).toString('base64'),
		appOwnerPublicKey: owner.getPublicKey().toString('base64'),
	};
	return {
		config,
		credentials: { source: 'json', configJson: JSON.stringify(config) },
		device,
		owner,
	};
}

// Use the OFFICIAL SDK's crypto as an independent oracle, never the new client.
const encrypt = async (data, key) =>
	Buffer.from(await sdk.platform.encryptWithKey(Buffer.from(data), key));
const decrypt = async (data, key) =>
	Buffer.from(await sdk.platform.decryptWithKey(Buffer.from(data), key));
const encoded = async (data, key) => (await encrypt(data, key)).toString('base64');
const encryptedJson = async (value, key) => encoded(JSON.stringify(value), key);
function openEcies(envelope, recipient) {
	const secret = recipient.computeSecret(envelope.subarray(0, 65));
	const key = crypto.createHash('sha256').update(secret).digest();
	return decrypt(envelope.subarray(65), key);
}

function fakeKeeper(fixture, handler) {
	const server = crypto.createECDH('prime256v1');
	server.generateKeys();
	const requests = [];
	return {
		server,
		requests,
		transport: async (request) => {
			assert.match(request.url, /^https:\/\/keepersecurity\.com\/api\/rest\/sm\/v1\//);
			const encryptedKey = Buffer.from(request.headers.TransmissionKey, 'base64');
			assert.equal(
				crypto.verify(
					'sha256',
					Buffer.concat([encryptedKey, request.body]),
					fixture.device.publicKey,
					Buffer.from(request.headers.Authorization.replace('Signature ', ''), 'base64'),
				),
				true,
			);
			const key = await openEcies(encryptedKey, server);
			const payload = JSON.parse((await decrypt(request.body, key)).toString());
			assert.equal(payload.clientId, fixture.config.clientId);
			assert.equal(payload.clientVersion, 'ms17.0.0');
			const call = { route: request.url.split('/').at(-1), payload, request };
			requests.push(call);
			const response = await handler(call);
			if (response?.statusCode) return response;
			return {
				statusCode: 200,
				body:
					response === undefined ? Buffer.alloc(0) : await encrypt(JSON.stringify(response), key),
			};
		},
	};
}

module.exports = { configuration, encrypt, decrypt, encoded, encryptedJson, openEcies, fakeKeeper };
