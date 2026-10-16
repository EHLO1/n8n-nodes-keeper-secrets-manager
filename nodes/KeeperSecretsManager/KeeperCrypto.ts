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

export function decrypt(data: Uint8Array, key: Uint8Array): Buffer {
	if (data.length < 28) throw new KeeperProtocolError('Invalid encrypted envelope');
	const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
	decipher.setAuthTag(data.subarray(data.length - 16));
	return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]);
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
