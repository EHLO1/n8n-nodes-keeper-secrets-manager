const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { KeeperClient } = require('../dist/nodes/KeeperSecretsManager/KeeperClient');
const { configuration } = require('./fixtures.cjs');
const helpers = require('../dist/nodes/KeeperSecretsManager/GenericFunctions');
const {
	KeeperSecretsManager,
} = require('../dist/nodes/KeeperSecretsManager/KeeperSecretsManager.node');

// Synthetic configuration only; no test contacts Keeper.
const { config, credentials } = configuration();
const originals = Object.fromEntries(
	['getSecrets', 'createSecret', 'updateSecret', 'deleteSecret'].map((key) => [
		key,
		KeeperClient.prototype[key],
	]),
);
afterEach(() => {
	Object.assign(KeeperClient.prototype, originals);
});

function execute(parameters, count = 1, continueOnFail = false) {
	return new KeeperSecretsManager().execute.call({
		getInputData: () => Array.from({ length: count }, () => ({ json: {} })),
		getCredentials: async () => credentials,
		getNode: () => ({
			name: 'Keeper',
			type: 'keeperSecretsManager',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getNodeParameter: (name, index, fallback) =>
			typeof parameters[name] === 'function'
				? parameters[name](index)
				: (parameters[name] ?? fallback),
		continueOnFail: () => continueOnFail,
	});
}

test('bound JSON/base64 work without optional server key ID; injected storage is ignored', async () => {
	for (const input of [
		credentials,
		{ source: 'base64', configBase64: Buffer.from(JSON.stringify(config)).toString('base64') },
	]) {
		assert.equal(helpers.keeperOptions(input).appKey.toString('base64'), config.appKey);
	}
	const options = helpers.keeperOptions({
		source: 'json',
		configJson: JSON.stringify({ ...config, injected: 'do-not-load' }),
	});
	assert.equal(options.injected, undefined);
});

test('rejects unbound credentials, arbitrary hosts, malformed JSON/base64', () => {
	for (const input of [
		{ source: 'json', configJson: JSON.stringify({ ...config, appKey: undefined }) },
		{ source: 'json', configJson: JSON.stringify({ ...config, hostname: 'localhost' }) },
		{ source: 'json', configJson: '{invalid-secret' },
		{ source: 'base64', configBase64: '!!!!' },
	])
		assert.throws(() => helpers.keeperOptions(input), helpers.KeeperValidationError);
});

test('invalid record patches fail without echoing their secret values', () => {
	for (const value of [
		'secret',
		'[]',
		{ title: ' ' },
		{ fields: [{ type: 'password', value: 'secret' }] },
		{ fields: [{ type: '', value: [] }] },
		{ custom: [{ type: 'text', label: 42, value: [] }] },
		{ appKey: 'secret' },
	]) {
		assert.throws(
			() => helpers.validateData(value, true),
			(error) =>
				error instanceof helpers.KeeperValidationError && !error.message.includes('secret'),
		);
	}
	assert.deepEqual(helpers.uidList('a, b\na a'), ['a', 'b']);
	assert.throws(() => helpers.uidList(' , '));
});

test('flat output preserves custom values, duplicates and arrays without exposing protocol metadata', () => {
	const record = {
		recordUid: 'a',
		revision: 1,
		recordKey: 'do-not-output',
		files: [{ url: 'do-not-output' }],
		folderUid: 'folder',
		folderName: 'n8n',
		data: {
			title: 'Test',
			fields: [{ type: 'password', value: ['secret'] }],
			custom: [
				{ type: 'text', label: 'File Name', value: ['example.txt'] },
				{ type: 'password', value: ['second'] },
				{ type: 'text', label: 'title', value: ['custom title'] },
				{ type: 'text', label: '__proto__', value: ['safe'] },
				{ type: 'text', label: 'Tags', value: ['a', 'b'] },
			],
		},
	};
	const flat = helpers.formatRecord(record);
	assert.equal(flat.recordKey, undefined);
	assert.equal(flat.files, undefined);
	assert.equal(flat.data, undefined);
	assert.equal(flat.password, 'secret');
	assert.equal(flat.password_2, 'second');
	assert.equal(flat.filename, 'example.txt');
	assert.equal(flat.title, 'Test');
	assert.equal(flat.field_title, 'custom title');
	assert.equal(flat.field___proto__, 'safe');
	assert.deepEqual(flat.tags, ['a', 'b']);
	assert.equal(flat.folderName, 'n8n');
	assert.equal(flat.login, null);
});

test('reads evaluate expressions per item and preserve pairing after exclusions', async () => {
	const filters = [];
	KeeperClient.prototype.getSecrets = async (filter) => {
		filters.push(filter);
		return {
			records: filter.map((recordUid) => ({
				recordUid,
				revision: 1,
				data: { title: recordUid, fields: [] },
			})),
		};
	};
	const [output] = await execute(
		{
			operation: 'getByUid',
			recordUids: (i) => `uid-${i},excluded`,
			excludeUids: 'excluded',
			outputFormat: 'raw',
		},
		2,
	);
	assert.deepEqual(filters, [
		['uid-0', 'excluded'],
		['uid-1', 'excluded'],
	]);
	assert.deepEqual(
		output.map((item) => [item.json.recordUid, item.pairedItem.item]),
		[
			['uid-0', 0],
			['uid-1', 1],
		],
	);
});

test('update preserves omitted properties, replaces arrays, and retains revision', async () => {
	KeeperClient.prototype.getSecrets = async () => ({
		records: [
			{
				recordUid: 'a',
				revision: 5,
				data: {
					type: 'login',
					title: 'Old',
					notes: 'Keep',
					fields: [{ type: 'login', value: ['old'] }],
				},
			},
		],
	});
	let updated;
	KeeperClient.prototype.updateSecret = async (record) => {
		updated = record;
	};
	await execute({
		operation: 'update',
		inputMode: 'json',
		recordUid: 'a',
		updateData: { title: 'New', fields: [] },
	});
	assert.equal(updated.data.type, 'login');
	assert.equal(updated.data.title, 'New');
	assert.equal(updated.data.notes, 'Keep');
	assert.ok(updated.data.fields.every((field) => field.value.length === 0));
	assert.equal(updated.revision, 5);
});

test('invalid create makes no request', async () => {
	let called = false;
	KeeperClient.prototype.createSecret = async () => {
		called = true;
	};
	await assert.rejects(
		execute({
			operation: 'create',
			inputMode: 'json',
			folderUid: 'folder',
			recordData: { title: 'Test' },
		}),
		/Create requires/,
	);
	assert.equal(called, false);
});

test('structured create evaluates input values and preserves Keeper value types', async () => {
	const created = [];
	KeeperClient.prototype.createSecret = async (folder, data) => {
		created.push({ folder, data });
		return `created-${created.length}`;
	};
	await execute(
		{
			operation: 'create',
			folderUid: 'folder',
			recordType: 'login',
			title: (i) => `Account ${i}`,
			recordFields: (i) => ({
				field: [
					{ type: 'login', textValue: `user${i}` },
					{ type: 'checkbox', valueType: 'boolean', booleanValue: false },
					{ type: 'text', label: 'Count', valueType: 'number', numberValue: 0 },
					{
						type: 'host',
						valueType: 'json',
						jsonValue: '[{"hostName":"db.example.com","port":"5432"}]',
					},
				],
			}),
			customFields: {
				field: [{ type: 'text', label: 'Empty', valueType: 'json', jsonValue: '[]' }],
			},
		},
		2,
	);
	assert.equal(created[1].data.title, 'Account 1');
	assert.deepEqual(
		[...created[1].data.fields, ...created[1].data.custom]
			.filter((f) => f.value.length)
			.map((f) => f.value),
		[['user1'], [false], [0], [{ hostName: 'db.example.com', port: '5432' }]],
	);
	assert.deepEqual(created[1].data.custom[0].value, []);
});

test('structured update merges exact type/label matches and preserves untouched fields and metadata', async () => {
	KeeperClient.prototype.getSecrets = async () => ({
		records: [
			{
				recordUid: 'a',
				revision: 9,
				data: {
					type: 'login',
					title: 'Production',
					notes: 'Keep',
					fields: [
						{ type: 'password', value: ['old'], required: true },
						{ type: 'text', label: 'Other', value: ['keep'] },
					],
					custom: [{ type: 'text', label: 'Environment', value: ['dev'] }],
				},
			},
		],
	});
	let updated;
	KeeperClient.prototype.updateSecret = async (record) => {
		updated = record;
	};
	await execute({
		operation: 'update',
		recordUid: 'a',
		updateOptions: { notes: '' },
		recordFields: { field: [{ type: 'password', textValue: 'new' }] },
		customFields: { field: [{ type: 'text', label: 'Environment', textValue: 'production' }] },
	});
	assert.equal(updated.revision, 9);
	assert.equal(updated.data.title, 'Production');
	assert.equal(updated.data.notes, '');
	assert.deepEqual(
		updated.data.fields.find((field) => field.type === 'password'),
		{ type: 'password', value: ['new'], required: true },
	);
	assert.deepEqual(
		updated.data.custom.find((field) => field.label === 'Other'),
		{ type: 'text', label: 'Other', value: ['keep'] },
	);
	assert.deepEqual(updated.data.custom[0].value, ['production']);
});

test('invalid or ambiguous structured inputs are rejected without exposing values', async () => {
	for (const field of [
		{ type: 'text', valueType: 'json', jsonValue: 'private-invalid' },
		{ type: 'text', valueType: 'json', jsonValue: '{}' },
		{ type: 'text', valueType: 'number', numberValue: Infinity },
		{ type: 'text', valueType: 'boolean', booleanValue: 'false' },
	])
		assert.throws(
			() => helpers.structuredFields({ field: [field] }),
			(error) => !error.message.includes('private-invalid'),
		);
	assert.throws(
		() =>
			helpers.structuredFields({
				field: [
					{ type: 'text', textValue: '' },
					{ type: 'text', textValue: '' },
				],
			}),
		/distinct labels/,
	);
	assert.throws(
		() =>
			helpers.mergeFields([{ type: 'text' }, { type: 'text' }], [{ type: 'text', value: ['new'] }]),
		/Multiple existing/,
	);
	await assert.rejects(execute({ operation: 'update', recordUid: 'a' }), /at least one property/);
});

test('raw create and update normalize supplied fields against the effective record type', async () => {
	let created;
	KeeperClient.prototype.createSecret = async (_folder, data) => {
		created = data;
		return 'new';
	};
	await execute({
		operation: 'create',
		inputMode: 'json',
		folderUid: 'folder',
		recordData: {
			title: 'Server',
			type: 'serverCredentials',
			fields: [
				{ type: 'host', value: [{ hostName: 'db' }] },
				{ type: 'text', label: 'Environment', value: ['prod'] },
			],
		},
	});
	assert.deepEqual(created.fields.find((f) => f.type === 'host').value, [{ hostName: 'db' }]);
	assert.equal(created.custom[0].label, 'Environment');
	KeeperClient.prototype.getSecrets = async () => ({
		records: [
			{
				recordUid: 'a',
				revision: 3,
				data: {
					type: 'serverCredentials',
					title: 'Old',
					fields: [{ type: 'login', value: ['old'] }],
					custom: [{ type: 'text', label: 'Keep', value: ['keep'] }],
				},
			},
		],
	});
	let updated;
	KeeperClient.prototype.updateSecret = async (record) => {
		updated = record;
	};
	await execute({
		operation: 'update',
		inputMode: 'json',
		recordUid: 'a',
		updateData: {
			fields: [
				{ type: 'host', value: [{ hostName: 'new-db' }] },
				{ type: 'text', label: 'Environment', value: ['prod'] },
			],
		},
	});
	assert.equal(updated.data.type, 'serverCredentials');
	assert.equal(updated.data.title, 'Old');
	assert.deepEqual(updated.data.fields.find((f) => f.type === 'login').value, []);
	assert.deepEqual(
		updated.data.custom.map((f) => f.label),
		['Keep', 'Environment'],
	);
});

test('new structured form preserves blank placeholders, edits custom fields once, and explicitly clears values and notes', async () => {
	KeeperClient.prototype.getSecrets = async () => ({
		records: [
			{
				recordUid: 'a',
				revision: 4,
				data: {
					type: 'serverCredentials',
					title: 'Old',
					notes: 'Remove',
					fields: [
						{ type: 'host', value: [{ hostName: 'keep-db' }] },
						{ type: 'login', value: ['keep-user'] },
						{ type: 'password', value: ['old'] },
						{ type: 'text', label: 'Environment', value: ['old-env'] },
					],
				},
			},
		],
	});
	let updated;
	KeeperClient.prototype.updateSecret = async (record) => {
		updated = record;
	};
	await execute({
		operation: 'update',
		recordUid: 'a',
		title: 'Renamed',
		clearNotes: true,
		fieldsExisting: {
			field: [
				{ type: 'host', jsonValue: '' },
				{ type: 'login', textValue: '' },
				{ type: 'password', clearValue: true },
				{ type: 'text', label: 'Environment', textValue: 'prod' },
			],
		},
	});
	assert.equal(updated.data.type, 'serverCredentials');
	assert.equal(updated.data.title, 'Renamed');
	assert.equal(updated.data.notes, '');
	assert.deepEqual(updated.data.fields.find((f) => f.type === 'host').value, [
		{ hostName: 'keep-db' },
	]);
	assert.deepEqual(updated.data.fields.find((f) => f.type === 'login').value, ['keep-user']);
	assert.deepEqual(updated.data.fields.find((f) => f.type === 'password').value, []);
	assert.deepEqual(updated.data.custom, [{ type: 'text', label: 'Environment', value: ['prod'] }]);
});

test('null exclusion is evaluated per input item during reads', async () => {
	KeeperClient.prototype.getSecrets = async () => ({
		records: [
			{
				recordUid: 'a',
				revision: 0,
				data: { title: 'Test', fields: [{ type: 'checkbox', value: [false] }] },
			},
		],
	});
	const [items] = await execute(
		{ operation: 'list', excludeUids: '', excludeNullValues: (i) => i === 1 },
		2,
	);
	assert.equal(items[0].json.password, null);
	assert.equal('password' in items[1].json, false);
	assert.equal(items[1].json.checkbox, false);
});

test('native field removal omits create inputs without restoring schema slots; standard titles cannot change wire labels', async () => {
	let created;
	KeeperClient.prototype.createSecret = async (_folder, data) => {
		created = data;
		return 'new';
	};
	await execute({
		operation: 'create',
		folderUid: 'folder',
		title: 'Test',
		recordType: 'login',
		fieldsLogin: {
			standardLogin: [{ textValue: 'user', label: 'Ignored user label', type: 'password' }],
			standardUrl: [{ textValue: '' }],
			field: [{ type: 'text', label: 'Environment', textValue: 'prod' }],
		},
	});
	assert.deepEqual(created.fields, [
		{ type: 'login', value: ['user'] },
		{ type: 'url', value: [] },
	]);
	assert.deepEqual(created.custom, [{ type: 'text', label: 'Environment', value: ['prod'] }]);
});

test('fields-array mode is evaluated per item and preserves pairing', async () => {
	KeeperClient.prototype.getSecrets = async () => ({
		records: [
			{
				recordUid: 'a',
				revision: 1,
				data: {
					title: 'Test',
					fields: [{ type: 'login', value: ['user'] }],
					custom: [{ type: 'text', label: 'Extra', value: ['value'] }],
				},
			},
		],
	});
	const [items] = await execute(
		{ operation: 'list', excludeUids: '', fieldsAsArray: (i) => i === 1 },
		2,
	);
	assert.equal(items[0].json.login, 'user');
	assert.equal(items[0].json.fields, undefined);
	assert.equal(items[1].json.login, undefined);
	assert.deepEqual(items[1].json.fields, [
		{ type: 'login', value: ['user'] },
		{ type: 'text', label: 'Extra', value: ['value'] },
	]);
	assert.equal(items[1].pairedItem.item, 1);
});

test('deletion requires confirmation and partial failures stop by default', async () => {
	let called = false;
	KeeperClient.prototype.deleteSecret = async () => {
		called = true;
		return { records: [{ recordUid: 'a', responseCode: 'ok' }] };
	};
	await assert.rejects(
		execute({ operation: 'delete', confirmDelete: false, recordUids: 'a,b' }),
		/Confirm Deletion/,
	);
	assert.equal(called, false);
	await assert.rejects(
		execute({ operation: 'delete', confirmDelete: true, recordUids: 'a,b' }),
		/Some deletions may have succeeded/,
	);
	const [[item]] = await execute(
		{ operation: 'delete', confirmDelete: true, recordUids: 'a,b' },
		1,
		true,
	);
	assert.equal(item.json.success, false);
	assert.equal(item.json.records[1].responseCode, 'missing_response');
});

test('protocol errors are redacted and continue-on-fail processes the next item', async () => {
	let calls = 0;
	KeeperClient.prototype.getSecrets = async () => {
		if (calls++ === 0) throw new Error('remote secret payload');
		return { records: [{ recordUid: 'a', revision: 1, data: { title: 'Test', fields: [] } }] };
	};
	const [items] = await execute(
		{ operation: 'getAll', excludeUids: '', outputFormat: 'raw' },
		2,
		true,
	);
	assert.equal(items.length, 2);
	assert.equal(items[0].json.error.includes('remote secret payload'), false);
	assert.equal(items[0].json.error.includes('write may have completed'), false);
	assert.equal(items[1].pairedItem.item, 1);
});

test('credential test redacts protocol failures', async () => {
	KeeperClient.prototype.getSecrets = async () => {
		throw new Error('remote-secret');
	};
	const check = new KeeperSecretsManager().methods.credentialTest.keeperCredentialTest;
	const result = await check.call({}, { data: credentials });
	assert.equal(result.status, 'Error');
	assert.equal(result.message.includes('remote-secret'), false);
});
