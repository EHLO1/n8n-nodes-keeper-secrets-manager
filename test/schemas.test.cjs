const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	normalizeRecord,
	recordSchemas,
	fieldParameterName,
	partitionFields,
} = require('../dist/nodes/KeeperSecretsManager/RecordSchemas');
const {
	structuredFields,
	formatRecord,
} = require('../dist/nodes/KeeperSecretsManager/GenericFunctions');
const { recordProperties } = require('../dist/nodes/KeeperSecretsManager/RecordProperties');
const { NodeHelpers } = require('n8n-workflow');
const {
	KeeperSecretsManager,
} = require('../dist/nodes/KeeperSecretsManager/KeeperSecretsManager.node');

test('n8n resolves the selected template defaults and keeps update titles optional', () => {
	const description = new KeeperSecretsManager().description;
	const resolve = (parameters) =>
		NodeHelpers.getNodeParameters(
			description.properties,
			parameters,
			true,
			false,
			{ typeVersion: 1 },
			description,
		);
	const login = resolve({ operation: 'create' });
	assert.equal(login.recordType, 'login');
	assert.ok(login.fieldsLogin.field.some((f) => f.type === 'password'));
	assert.equal(login.fieldsServerCredentials, undefined);
	const server = resolve({ ...login, recordType: 'serverCredentials' });
	assert.equal(server.fieldsLogin, undefined);
	assert.ok(server.fieldsServerCredentials.field.some((f) => f.type === 'host'));
	const update = resolve({ operation: 'update' });
	assert.equal(update.recordType, 'existing');
	const issues = NodeHelpers.getNodeParametersIssues(
		description.properties,
		{
			name: 'Keeper',
			type: description.name,
			typeVersion: 1,
			position: [0, 0],
			parameters: { ...update, recordUid: 'uid' },
		},
		description,
	);
	assert.equal(issues, null);
});

test('every built-in template supplies empty standard fields and keeps explicit custom fields', () => {
	for (const [type, slots] of Object.entries(recordSchemas)) {
		const custom = [{ type: 'text', label: 'Department', value: ['Engineering'] }];
		const result = normalizeRecord({ type, title: 'Test', fields: [], custom });
		assert.deepEqual(
			result.fields,
			slots.map((slot) => ({ ...slot, value: [] })),
		);
		assert.deepEqual(result.custom, custom);
		const property = recordProperties.find((p) => p.name === fieldParameterName(type));
		assert.equal(property.default.field.length, slots.length);
		assert.deepEqual(structuredFields(property.default), []);
		assert.equal(
			property.options[0].values.some((p) => p.name === 'valueType'),
			false,
		);
	}
});

test('normalization rehomes unknown types, extra occurrences and labels without losing values or mutating input', () => {
	const input = {
		type: 'login',
		title: 'Test',
		fields: [
			{ type: 'login', value: ['user'] },
			{ type: 'password', value: ['primary'] },
			{ type: 'password', label: 'Secondary', value: ['secondary'] },
			{ type: 'text', label: 'Environment', value: ['prod'] },
			{ type: 'login', value: ['extra'] },
		],
		custom: [{ type: 'password', label: 'Existing custom', value: ['custom'] }],
	};
	const before = structuredClone(input);
	const result = normalizeRecord(input);
	assert.deepEqual(input, before);
	assert.deepEqual(result.fields.find((f) => f.type === 'login').value, ['user']);
	assert.deepEqual(
		result.custom.map((f) => f.value[0]),
		['custom', 'secondary', 'prod', 'extra'],
	);
	assert.deepEqual(normalizeRecord(result), result);
	assert.deepEqual(normalizeRecord({ ...input, type: 'Tenant Type' }), {
		...input,
		type: 'Tenant Type',
	});
	assert.deepEqual(partitionFields('contact', [{ type: 'text', value: ['Keeper'] }]).fields, [
		{ type: 'text', label: 'Company', value: ['Keeper'] },
	]);
});

test('inferred values preserve textual secrets and accept typed Keeper compound, date, checkbox and reference fields', () => {
	const result = structuredFields({
		field: [
			{ type: 'password', textValue: '001234' },
			{ type: 'text', textValue: 'false' },
			{ type: 'date', textValue: '0' },
			{ type: 'checkbox', textValue: 'false' },
			{ type: 'host', jsonValue: '{"hostName":"db","port":"5432"}' },
			{ type: 'phone', jsonValue: '[{"number":"123"},{"number":"456"}]' },
			{ type: 'fileRef', jsonValue: '["existing-file-uid"]' },
			{ type: 'login', textValue: '', clearValue: true },
		],
	});
	assert.deepEqual(
		result.map((f) => f.value),
		[
			['001234'],
			['false'],
			[0],
			[false],
			[{ hostName: 'db', port: '5432' }],
			[{ number: '123' }, { number: '456' }],
			['existing-file-uid'],
			[],
		],
	);
	for (const field of [
		{ type: 'host', jsonValue: 'private-invalid' },
		{ type: 'name', jsonValue: '["wrong"]' },
		{ type: 'fileRef', jsonValue: '{"uid":"wrong"}' },
		{ type: 'checkbox', textValue: 'yes' },
		{ type: 'date', textValue: 'Infinity' },
		{ type: 'date', textValue: '0.5' },
	])
		assert.throws(
			() => structuredFields({ field: [field] }),
			(error) => !error.message.includes('private-invalid'),
		);
});

test('null exclusion removes only top-level null keys and retains false, zero, empty text and nested nulls', () => {
	const record = {
		recordUid: 'a',
		revision: 0,
		data: {
			title: '',
			fields: [
				{ type: 'checkbox', value: [false] },
				{ type: 'text', label: 'Zero', value: [0] },
				{ type: 'text', label: 'Empty', value: [''] },
				{ type: 'host', value: [{ hostName: null }] },
			],
		},
	};
	assert.equal(formatRecord(record).folderName, null);
	const result = formatRecord(record, true);
	assert.equal('folderName' in result, false);
	assert.equal('password' in result, false);
	assert.equal(result.checkbox, false);
	assert.equal(result.zero, 0);
	assert.equal(result.empty, '');
	assert.equal(result.title, '');
	assert.deepEqual(result.host, { hostName: null });
});
