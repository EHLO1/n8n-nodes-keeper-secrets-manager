// Protocol adapted from Keeper Security's MIT-licensed JavaScript SDK.
// Copyright (c) 2021 Keeper Security. See THIRD_PARTY_NOTICES.md.
import { randomBytes, sign, type KeyObject } from 'node:crypto';
import type { IDataObject } from 'n8n-workflow';
import {
	createUid,
	decodeBase64,
	decrypt,
	encrypt,
	publicEncrypt,
	KeeperProtocolError,
	KeeperValidationError,
} from './KeeperCrypto';
import { serverKey } from './KeeperServerKeys';
import type { KeeperTransport } from './KeeperTransport';

export type KeeperConfig = {
	hostname: string;
	clientId: string;
	privateKey: KeyObject;
	appKey: Buffer;
	appOwnerPublicKey?: Buffer;
	serverPublicKeyId: number;
};
export type RecordData = {
	title: string;
	type: string;
	fields: IDataObject[];
	notes?: string;
	custom?: IDataObject[];
};
export type KeeperRecord = { recordUid: string; revision: number; data: RecordData };
type DeleteStatus = { recordUid: string; responseCode: string };

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new KeeperProtocolError('Invalid Keeper object');
	return value as Record<string, unknown>;
}
function text(value: unknown): string {
	if (typeof value !== 'string' || !value) throw new KeeperProtocolError('Invalid Keeper string');
	return value;
}
function array(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new KeeperProtocolError('Invalid Keeper list');
	return value;
}
function unwrap(value: unknown, key: Buffer): Buffer {
	const result = decrypt(decodeBase64(value), key, 'record key');
	if (result.length !== 32) throw new KeeperProtocolError('Invalid Keeper key');
	return result;
}
function json(bytes: Buffer): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString('utf8'));
	} catch {
		parsed = undefined;
	}
	if (parsed === undefined) throw new KeeperProtocolError('Keeper returned invalid JSON');
	return object(parsed);
}

export class KeeperClient {
	private readonly folderKeys = new Map<string, Buffer>();
	private recordKeys = new WeakMap<KeeperRecord, Buffer>();
	private keyId: number;

	constructor(
		private readonly config: KeeperConfig,
		private readonly transport: KeeperTransport,
	) {
		this.keyId = config.serverPublicKeyId;
	}

	private async query(route: string, data: Record<string, unknown>): Promise<Buffer> {
		const payload = Buffer.from(
			JSON.stringify({ clientVersion: 'ms17.0.0', clientId: this.config.clientId, ...data }),
		);
		const attempted = new Set<number>();
		// A key rejection occurs before processing. Only that explicit rejection may be
		// retried; network errors, throttling and ambiguous write responses never are.
		for (let attempt = 0; attempt < 4; attempt++) {
			const publicKey = serverKey(this.keyId);
			if (!publicKey || attempted.has(this.keyId))
				throw new KeeperProtocolError('Unsupported or repeated server key');
			attempted.add(this.keyId);
			const transmissionKey = randomBytes(32);
			try {
				const encryptedKey = publicEncrypt(transmissionKey, publicKey);
				const body = encrypt(payload, transmissionKey);
				const signature = sign(
					'sha256',
					Buffer.concat([encryptedKey, body]),
					this.config.privateKey,
				);
				const response = await this.transport({
					url: `https://${this.config.hostname}/api/rest/sm/v1/${route}`,
					body,
					headers: {
						'Content-Type': 'application/octet-stream',
						PublicKeyId: String(this.keyId),
						TransmissionKey: encryptedKey.toString('base64'),
						Authorization: `Signature ${signature.toString('base64')}`,
					},
				});
				if (response.statusCode === 200)
					return response.body.length ? decrypt(response.body, transmissionKey) : Buffer.alloc(0);
				// Do not decode or expose arbitrary remote error payloads.
				if (response.body.length > 65_536) throw new KeeperProtocolError('Keeper rejected request');
				let error: Record<string, unknown> | undefined;
				try {
					error = json(response.body);
				} catch {
					error = undefined;
				}
				if (
					!error ||
					(error.result_code ?? error.error) !== 'key' ||
					!Number.isInteger(error.key_id) ||
					!serverKey(error.key_id as number)
				)
					throw new KeeperProtocolError(
						`Keeper rejected the request (HTTP ${response.statusCode})`,
					);
				this.keyId = error.key_id as number;
			} finally {
				transmissionKey.fill(0);
			}
		}
		throw new KeeperProtocolError('Server key rotation limit reached');
	}

	async getSecrets(requestedRecords?: string[]): Promise<{ records: KeeperRecord[] }> {
		const response = json(
			await this.query('get_secret', requestedRecords ? { requestedRecords } : {}),
		);
		if (response.encryptedAppKey !== undefined)
			throw new KeeperProtocolError('Already-bound configuration required');
		if (response.appData !== undefined && response.appData !== null)
			json(decrypt(decodeBase64(response.appData), this.config.appKey, 'application data'));
		if (response.records == null && response.folders == null && response.appData == null)
			throw new KeeperProtocolError('Missing Keeper records');
		this.folderKeys.clear();
		this.recordKeys = new WeakMap();
		const folders = array(response.folders).map(object);
		for (const folder of folders) {
			this.folderKeys.set(text(folder.folderUid), unwrap(folder.folderKey, this.config.appKey));
		}
		const records: KeeperRecord[] = [];
		const seen = new Set<string>();
		const read = (raw: unknown, wrappingKey: Buffer) => {
			const record = object(raw);
			const uid = text(record.recordUid);
			const key = unwrap(record.recordKey, wrappingKey);
			const data = json(decrypt(decodeBase64(record.data), key, 'record data'));
			if (
				!Number.isSafeInteger(record.revision) ||
				(record.revision as number) < 0 ||
				typeof data.title !== 'string' ||
				typeof data.type !== 'string' ||
				!Array.isArray(data.fields) ||
				(data.custom !== undefined && !Array.isArray(data.custom))
			)
				throw new KeeperProtocolError('Invalid Keeper record');
			if (seen.has(uid)) return;
			seen.add(uid);
			const result: KeeperRecord = {
				recordUid: uid,
				revision: record.revision as number,
				data: data as RecordData,
			};
			this.recordKeys.set(result, key);
			records.push(result);
		};
		for (const raw of array(response.records)) {
			const record = object(raw);
			// Current Keeper servers can return folder-shared records in the flat list.
			const folderKey =
				typeof record.innerFolderUid === 'string'
					? this.folderKeys.get(record.innerFolderUid)
					: undefined;
			read(record, folderKey ?? this.config.appKey);
		}
		for (const folder of folders) {
			const key = this.folderKeys.get(text(folder.folderUid))!;
			for (const record of array(folder.records)) read(record, key);
		}
		// Fail closed on decryption errors; never silently return partial secret sets.
		const requested = requestedRecords ? new Set(requestedRecords) : undefined;
		return {
			records: requested ? records.filter((record) => requested.has(record.recordUid)) : records,
		};
	}

	async createSecret(folderUid: string, data: RecordData): Promise<string> {
		if (!this.config.appOwnerPublicKey)
			throw new KeeperValidationError(
				'Creating records requires appOwnerPublicKey in the bound Keeper configuration',
			);
		await this.getSecrets();
		const folderKey = this.folderKeys.get(folderUid);
		if (!folderKey)
			throw new KeeperValidationError('The shared folder is not accessible to this application');
		const recordKey = randomBytes(32);
		const recordUid = createUid();
		try {
			await this.query('create_secret', {
				recordUid,
				folderUid,
				recordKey: publicEncrypt(recordKey, this.config.appOwnerPublicKey).toString('base64'),
				folderKey: encrypt(recordKey, folderKey).toString('base64'),
				data: encrypt(Buffer.from(JSON.stringify(data)), recordKey).toString('base64url'),
			});
			return recordUid;
		} finally {
			recordKey.fill(0);
		}
	}

	async updateSecret(record: KeeperRecord): Promise<void> {
		const key = this.recordKeys.get(record);
		if (!key) throw new KeeperProtocolError('Record must be read by this client before updating');
		await this.query('update_secret', {
			recordUid: record.recordUid,
			revision: record.revision,
			data: encrypt(Buffer.from(JSON.stringify(record.data)), key).toString('base64url'),
		});
	}

	async deleteSecret(recordUids: string[]): Promise<{ records: DeleteStatus[] }> {
		const response = json(await this.query('delete_secret', { recordUids }));
		if (!Array.isArray(response.records)) throw new KeeperProtocolError('Missing deletion results');
		return {
			records: response.records.map((raw) => {
				const status = object(raw);
				return { recordUid: text(status.recordUid), responseCode: text(status.responseCode) };
			}),
		};
	}
}
