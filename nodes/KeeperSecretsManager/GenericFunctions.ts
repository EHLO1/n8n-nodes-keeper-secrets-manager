import type { ICredentialDataDecryptedObject, IDataObject } from 'n8n-workflow';
import { createPrivateKey, ECDH } from 'node:crypto';
import type { KeeperConfig, KeeperRecord, RecordData } from './KeeperClient';
import { decodeBase64, KeeperValidationError } from './KeeperCrypto';
import { serverKey } from './KeeperServerKeys';
export { KeeperValidationError } from './KeeperCrypto';

export function parseObject(value: unknown): Record<string, unknown> {
	let result: unknown;
	try {
		result = typeof value === 'string' ? JSON.parse(value) : value;
	} catch {
		result = undefined;
	}
	if (result === undefined)
		throw new KeeperValidationError('Enter valid JSON containing an object');
	if (!result || typeof result !== 'object' || Array.isArray(result))
		throw new KeeperValidationError('Expected a JSON object');
	return result as Record<string, unknown>;
}

export function keeperOptions(c: ICredentialDataDecryptedObject): KeeperConfig {
	let text: string;
	if (c.source === 'json') text = String(c.configJson ?? '');
	else if (c.source === 'base64') {
		const encoded = String(c.configBase64 ?? '').replace(/\s/g, '');
		if (!encoded || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded) || encoded.length % 4 === 1)
			throw new KeeperValidationError('Invalid base64 configuration');
		text = decodeBase64(encoded).toString('utf8');
	} else throw new KeeperValidationError('Unknown configuration source');
	const config = parseObject(text.replace(/^\uFEFF/, ''));
	for (const key of ['hostname', 'clientId', 'privateKey', 'appKey']) {
		if (typeof config[key] !== 'string' || !(config[key] as string).trim())
			throw new KeeperValidationError(
				'Configuration must be complete and already bound, including hostname, clientId, privateKey, and appKey',
			);
	}
	const hosts = new Set([
		'keepersecurity.com',
		'keepersecurity.eu',
		'keepersecurity.com.au',
		'keepersecurity.jp',
		'keepersecurity.ca',
		'govcloud.keepersecurity.us',
	]);
	if (!hosts.has(config.hostname as string))
		throw new KeeperValidationError('Unsupported Keeper hostname');
	if (
		config.serverPublicKeyId !== undefined &&
		((typeof config.serverPublicKeyId !== 'string' &&
			typeof config.serverPublicKeyId !== 'number') ||
			!/^\d+$/.test(String(config.serverPublicKeyId)))
	)
		throw new KeeperValidationError('Invalid Keeper server public key ID');
	const keyId = config.serverPublicKeyId === undefined ? 7 : Number(config.serverPublicKeyId);
	if (!serverKey(keyId)) throw new KeeperValidationError('Unsupported Keeper server public key ID');
	if (config.serverPublicKey !== undefined)
		throw new KeeperValidationError('Custom Keeper server keys are not supported');
	let parsed: KeeperConfig | undefined;
	try {
		const appKey = decodeBase64(config.appKey);
		const privateKey = createPrivateKey({
			key: decodeBase64(config.privateKey),
			format: 'der',
			type: 'pkcs8',
		});
		if (
			appKey.length !== 32 ||
			decodeBase64(config.clientId).length !== 64 ||
			privateKey.asymmetricKeyType !== 'ec' ||
			privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
		)
			throw new KeeperValidationError('Invalid Keeper encryption keys');
		const owner =
			config.appOwnerPublicKey === undefined ? undefined : decodeBase64(config.appOwnerPublicKey);
		if (owner && (owner.length !== 65 || owner[0] !== 4))
			throw new KeeperValidationError('Invalid Keeper owner public key');
		if (owner) ECDH.convertKey(owner, 'prime256v1');
		parsed = {
			hostname: config.hostname as string,
			clientId: config.clientId as string,
			privateKey,
			appKey,
			appOwnerPublicKey: owner,
			serverPublicKeyId: keyId,
		};
	} catch {
		parsed = undefined;
	}
	if (!parsed)
		throw new KeeperValidationError('Configuration contains invalid Keeper encryption keys');
	return parsed;
}

export function uidList(value: string): string[] {
	const list = [...new Set(value.split(/[\s,]+/).filter(Boolean))];
	if (!list.length) throw new KeeperValidationError('At least one record UID is required');
	return list;
}

export function validateData(value: unknown, partial = false): Record<string, unknown> {
	const data = parseObject(value);
	const allowed = new Set(['title', 'type', 'notes', 'fields', 'custom']);
	if (Object.keys(data).some((k) => !allowed.has(k)))
		throw new KeeperValidationError('Unsupported record data property');
	for (const key of ['title', 'type', 'notes'])
		if (key in data && typeof data[key] !== 'string')
			throw new KeeperValidationError('Record text properties must be strings');
	for (const key of ['title', 'type'])
		if (key in data && !(data[key] as string).trim())
			throw new KeeperValidationError('Record title and type cannot be empty');
	if (!partial && (!data.title || !data.type || !Array.isArray(data.fields)))
		throw new KeeperValidationError('Create requires title, type, and fields');
	for (const key of ['fields', 'custom']) {
		if (!(key in data)) continue;
		if (!Array.isArray(data[key])) throw new KeeperValidationError('Fields must be arrays');
		for (const field of data[key] as unknown[]) {
			const f = parseObject(field);
			if (typeof f.type !== 'string' || !f.type.trim() || !Array.isArray(f.value))
				throw new KeeperValidationError('Each field requires a nonempty type and a value array');
			if ('label' in f && typeof f.label !== 'string')
				throw new KeeperValidationError('Field labels must be strings');
		}
	}
	return data;
}

export function createData(value: unknown): RecordData {
	return validateData(value) as unknown as RecordData;
}

export function formatRecord(record: KeeperRecord, flat: boolean): IDataObject {
	// Explicit output projection keeps internal protocol metadata out of workflows.
	if (!flat)
		return JSON.parse(
			JSON.stringify({ recordUid: record.recordUid, revision: record.revision, data: record.data }),
		) as IDataObject;
	const data = record.data as unknown as {
		title: string;
		fields?: { label?: string; type: string; value?: unknown[] }[];
		custom?: { label?: string; type: string; value?: unknown[] }[];
	};
	const map: Record<string, unknown> = Object.create(null);
	for (const field of [...(data.fields ?? []), ...(data.custom ?? [])]) {
		const key = (field.label || field.type || '').replace(/\s+/g, '').toLowerCase();
		if (key) map[key] = field.value?.[0] ?? null;
	}
	return JSON.parse(
		JSON.stringify({
			recordUid: record.recordUid,
			title: data.title,
			revision: record.revision,
			login: map.login ?? null,
			password: map.password ?? null,
			distinguishedName: map.distinguishedname ?? null,
			description: map.description ?? null,
			id: map.id ?? null,
			domain: map.domain ?? null,
		}),
	) as IDataObject;
}
