// Keeper wire formats adapted from Keeper Security's MIT-licensed JavaScript SDK.
// Copyright (c) 2021 Keeper Security. See THIRD_PARTY_NOTICES.md.
import { createCipheriv, createDecipheriv, createECDH, createHash, randomBytes } from 'node:crypto';

export function decodeBase64(value: unknown): Buffer {
	if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value))
		throw new KeeperProtocolError('Invalid encoded value');
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
	const decoded = Buffer.from(normalized, 'base64');
	if (decoded.toString('base64').replace(/=+$/, '') !== normalized)
		throw new KeeperProtocolError('Invalid encoded value');
	return decoded;
}

// Protocol errors are intentionally generic. Node boundaries redact remote/crypto errors.
export class KeeperProtocolError extends Error {}
export class KeeperValidationError extends Error {}

// Keeper AES-GCM envelope: 12-byte IV || ciphertext || 16-byte authentication tag.
export function encrypt(data: Uint8Array, key: Uint8Array): Buffer {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	return Buffer.concat([iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

export function decrypt(
	data: Uint8Array,
	key: Uint8Array,
	context: 'response' | 'record key' | 'record data' | 'application data' = 'response',
): Buffer {
	if (data.length < 28) throw new KeeperProtocolError('Invalid encrypted envelope');
	let result: Buffer | undefined;
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
		decipher.setAuthTag(data.subarray(data.length - 16));
		result = Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]);
	} catch {
		result = undefined;
	}
	if (!result) throw new KeeperProtocolError(`Could not authenticate Keeper ${context}`);
	return result;
}

// Folder metadata uses Keeper's legacy AES-CBC format: 16-byte IV and PKCS#7 padding.
// Only use inside an authenticated, decrypted API response.
export function decryptFolder(data: Buffer, key: Buffer): Buffer {
	if (data.length < 32 || data.length % 16 !== 0)
		throw new KeeperProtocolError('Invalid Keeper folder envelope');
	let result: Buffer | undefined;
	try {
		const decipher = createDecipheriv('aes-256-cbc', key, data.subarray(0, 16));
		result = Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]);
	} catch {
		result = undefined;
	}
	if (!result) throw new KeeperProtocolError('Could not decrypt Keeper folder metadata');
	return result;
}

export function keeperFailureMessage(error: unknown): string {
	if (error instanceof KeeperValidationError || error instanceof KeeperProtocolError)
		return error.message;
	const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
	const messages: Record<string, string> = {
		ENOTFOUND: 'Could not resolve the Keeper hostname from the n8n server',
		EAI_AGAIN: 'DNS lookup for Keeper failed temporarily on the n8n server',
		ECONNREFUSED: 'The connection to Keeper was refused',
		ECONNRESET: 'The connection to Keeper was reset',
		ETIMEDOUT: 'The connection to Keeper timed out',
		ECONNABORTED: 'The Keeper HTTP request timed out or was aborted',
		ERR_TLS_CERT_ALTNAME_INVALID: 'The Keeper TLS certificate hostname could not be verified',
		UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The Keeper TLS certificate chain could not be verified',
		SELF_SIGNED_CERT_IN_CHAIN:
			'A self-signed certificate was detected in the Keeper TLS connection',
		CERT_HAS_EXPIRED: 'The Keeper TLS certificate has expired',
	};
	return typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code)
		? messages[code]
		: 'Could not connect to Keeper. Check the bound configuration, application permissions, and connectivity.';
}

// Keeper ECIES: ephemeral uncompressed P-256 point || GCM envelope, with a
// SHA-256 hash of the ECDH shared secret as the AES key (no HKDF or AAD).
export function publicEncrypt(data: Uint8Array, publicKey: Uint8Array): Buffer {
	const ephemeral = createECDH('prime256v1');
	ephemeral.generateKeys();
	const secret = ephemeral.computeSecret(publicKey);
	const key = createHash('sha256').update(secret).digest();
	try {
		return Buffer.concat([ephemeral.getPublicKey(), encrypt(data, key)]);
	} finally {
		secret.fill(0);
		key.fill(0);
	}
}

export function createUid(): string {
	// Keeper reserves the first five bits all set; preserve the SDK's UID rule.
	let bytes = randomBytes(16);
	for (let i = 0; i < 7 && (bytes[0] & 0xf8) === 0xf8; i++) bytes = randomBytes(16);
	if ((bytes[0] & 0xf8) === 0xf8) bytes[0] &= 0x7f;
	return bytes.toString('base64url');
}
