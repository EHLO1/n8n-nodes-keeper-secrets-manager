import type { ICredentialDataDecryptedObject, IDataObject } from 'n8n-workflow';
import { createPrivateKey, ECDH } from 'node:crypto';
import type { KeeperConfig, KeeperRecord, RecordData } from './KeeperClient';
import { decodeBase64, KeeperValidationError } from './KeeperCrypto';
import { serverKey } from './KeeperServerKeys';
import {
	arrayFieldTypes,
	booleanFieldTypes,
	numericFieldTypes,
	objectFieldTypes,
} from './RecordSchemas';
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
	if (c.source === 'json')
		text = typeof c.configJson === 'string' ? c.configJson : JSON.stringify(c.configJson ?? '');
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

export function formatRecord(record: KeeperRecord, excludeNullValues = false): IDataObject {
	const data = record.data as unknown as {
		title: string;
		fields?: { label?: string; type: string; value?: unknown[] }[];
		custom?: { label?: string; type: string; value?: unknown[] }[];
	};
	const map: Record<string, unknown> = Object.assign(Object.create(null), {
		recordUid: record.recordUid,
		title: data.title,
		revision: record.revision,
		folderUid: record.folderUid ?? null,
		folderName: record.folderName ?? null,
		login: null,
		password: null,
		distinguishedName: null,
		description: null,
		id: null,
		domain: null,
	});
	const used = new Set([
		'recordUid',
		'title',
		'revision',
		'folderUid',
		'folderName',
		'__proto__',
		'constructor',
		'prototype',
	]);
	for (const field of [...(data.fields ?? []), ...(data.custom ?? [])]) {
		let key = (field.label || field.type || '').replace(/\s+/g, '').toLowerCase();
		if (!key) continue;
		if (key === 'distinguishedname') key = 'distinguishedName';
		// Protect metadata and retain fields with duplicate labels instead of overwriting.
		if (
			[
				'recorduid',
				'folderuid',
				'foldername',
				'title',
				'revision',
				'__proto__',
				'constructor',
				'prototype',
			].includes(key.toLowerCase())
		)
			key = `field_${key}`;
		const base = key;
		let suffix = 2;
		while (used.has(key)) key = `${base}_${suffix++}`;
		used.add(key);
		const values = field.value ?? [];
		map[key] = values.length > 1 ? values : (values[0] ?? null);
	}
	if (excludeNullValues) for (const key of Object.keys(map)) if (map[key] === null) delete map[key];
	return JSON.parse(JSON.stringify(map)) as IDataObject;
}

export function structuredFields(value: unknown): IDataObject[] {
	const rows = parseObject(value ?? {}).field ?? [];
	if (!Array.isArray(rows)) throw new KeeperValidationError('Invalid structured fields');
	const seen = new Set<string>();
	return rows.flatMap((row) => {
		const field = parseObject(row);
		const type = typeof field.type === 'string' ? field.type.trim() : '';
		const label = typeof field.label === 'string' ? field.label : '';
		if (!type) throw new KeeperValidationError('Each field requires a Keeper field type');
		const identity = JSON.stringify([type, label]);
		if (seen.has(identity))
			throw new KeeperValidationError('Use distinct labels for fields with the same type');
		seen.add(identity);
		let values: unknown[];
		if (field.clearValue === true) values = [];
		else if (field.valueType === undefined) {
			const complex = objectFieldTypes.includes(type) || arrayFieldTypes.includes(type);
			const input = complex ? field.jsonValue : field.textValue;
			// Template placeholders never erase values during an update.
			if (input === '' || input === undefined) return [];
			if (complex) {
				let parsed: unknown;
				try {
					parsed = typeof input === 'string' ? JSON.parse(input) : input;
				} catch {
					parsed = undefined;
				}
				if (parsed === undefined)
					throw new KeeperValidationError('Enter valid JSON for a compound field');
				values = Array.isArray(parsed) ? parsed : [parsed];
				if (arrayFieldTypes.includes(type)) {
					if (!Array.isArray(parsed) || values.some((v) => typeof v !== 'string'))
						throw new KeeperValidationError('Reference fields require an array of UID strings');
				} else if (values.some((v) => !v || typeof v !== 'object' || Array.isArray(v)))
					throw new KeeperValidationError('Compound fields require objects or an array of objects');
			} else if (numericFieldTypes.includes(type)) {
				if (
					(typeof input !== 'string' && typeof input !== 'number') ||
					String(input).trim() === '' ||
					!Number.isSafeInteger(Number(input))
				)
					throw new KeeperValidationError('Date fields require integer epoch milliseconds');
				values = [Number(input)];
			} else if (booleanFieldTypes.includes(type)) {
				if (![true, false, 'true', 'false'].includes(input as string | boolean))
					throw new KeeperValidationError('Checkbox fields require true or false');
				values = [input === true || input === 'true'];
			} else {
				if (typeof input !== 'string')
					throw new KeeperValidationError('Text fields require a string value');
				values = [input];
			}
		} else if (field.valueType === 'json') {
			let parsed: unknown;
			try {
				parsed =
					typeof field.jsonValue === 'string' ? JSON.parse(field.jsonValue) : field.jsonValue;
			} catch {
				parsed = undefined;
			}
			if (!Array.isArray(parsed))
				throw new KeeperValidationError('JSON field values must be an array');
			values = parsed;
		} else if (field.valueType === 'number') {
			if (typeof field.numberValue !== 'number' || !Number.isFinite(field.numberValue))
				throw new KeeperValidationError('Enter a finite numeric field value');
			values = [field.numberValue];
		} else if (field.valueType === 'boolean') {
			if (typeof field.booleanValue !== 'boolean')
				throw new KeeperValidationError('Enter a boolean field value');
			values = [field.booleanValue];
		} else {
			if (field.valueType !== undefined && field.valueType !== 'text')
				throw new KeeperValidationError('Unknown field value type');
			if (typeof field.textValue !== 'string')
				throw new KeeperValidationError('Enter a text field value');
			values = [field.textValue];
		}
		return [{ type, ...(label ? { label } : {}), value: values } as IDataObject];
	});
}

export function mergeFields(existing: IDataObject[], supplied: IDataObject[]): IDataObject[] {
	const result = [...existing];
	for (const field of supplied) {
		const matches = result
			.map((candidate, i) =>
				candidate.type === field.type && (candidate.label || '') === (field.label || '') ? i : -1,
			)
			.filter((i) => i >= 0);
		if (matches.length > 1)
			throw new KeeperValidationError(
				'Multiple existing fields match; use Raw JSON to update this record',
			);
		if (matches.length) result[matches[0]] = { ...result[matches[0]], ...field };
		else result.push(field);
	}
	return result;
}
