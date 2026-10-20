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
	templateFields,
	formatRecord,
} = require('../dist/nodes/KeeperSecretsManager/GenericFunctions');
const { recordProperties } = require('../dist/nodes/KeeperSecretsManager/RecordProperties');
const { documentedFields } = require('../dist/nodes/KeeperSecretsManager/RecordFieldUi');
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
	assert.deepEqual(Object.keys(login.fieldsLogin), [
		'standardLogin',
		'standardPassword',
		'standardUrl',
	]);
	assert.equal(login.fieldsServerCredentials, undefined);
	assert.deepEqual(Object.keys(login.fieldsLogin.standardLogin[0]), ['textValue']);
	const server = resolve({ ...login, recordType: 'serverCredentials' });
	assert.equal(server.fieldsLogin, undefined);
	assert.ok(server.fieldsServerCredentials.standardHost);
	const removed = resolve({ ...login, fieldsLogin: { standardLogin: [{ textValue: 'user' }] } });
	assert.deepEqual(Object.keys(removed.fieldsLogin), ['standardLogin']);
	assert.deepEqual(templateFields(removed.fieldsLogin, 'login', true), [
		{ type: 'login', value: ['user'] },
	]);
	const update = resolve({ operation: 'update' });
	assert.equal(update.recordType, 'existing');
	const updateLogin = resolve({ operation: 'update', recordType: 'login' });
	assert.equal(updateLogin.fieldsLogin.standardLogin[0].clearValue, false);
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
		assert.equal(Object.keys(property.default).length, documentedFields[type].length);
		assert.deepEqual(
			templateFields(property.default, type, true),
			documentedFields[type].map(({ type, label }) => ({
				type,
				...(label ? { label } : {}),
				value: [],
			})),
		);
		assert.deepEqual(templateFields(property.default, type), []);
		for (const option of property.options) {
			assert.equal(
				option.values.some((p) => p.name === 'valueType'),
				false,
			);
			assert.deepEqual(option.values.find((p) => p.name === 'clearValue').displayOptions.show, {
				'/operation': ['update'],
			});
			if (option.name !== 'field')
				assert.ok(
					option.values.every((p) => ['textValue', 'jsonValue', 'clearValue'].includes(p.name)),
				);
		}
	}
});

test('Clear Value empties an update value but is ignored when creating a record', () => {
	const input = {
		standardLogin: [{ textValue: 'user', clearValue: true }],
		field: [{ type: 'text', label: 'Extra', textValue: 'keep', clearValue: true }],
	};
	assert.deepEqual(templateFields(input, 'login'), [
		{ type: 'login', value: [] },
		{ type: 'text', label: 'Extra', value: [] },
	]);
	assert.deepEqual(templateFields(input, 'login', true), [
		{ type: 'login', value: ['user'] },
		{ type: 'text', label: 'Extra', value: ['keep'] },
	]);
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

test('fields-array output separates metadata and combines field sources without losing duplicate labels or value arrays', () => {
	const record = {
		recordUid: 'a',
		revision: 0,
		folderUid: 'f',
		folderName: 'n8n',
		recordKey: 'never-output',
		data: {
			title: 'Test',
			fields: [
				{ type: 'login', value: ['user'] },
				{ type: 'password', value: [] },
				{ type: 'text', label: 'Duplicate', value: ['first'] },
			],
			custom: [
				{ type: 'text', label: 'Duplicate', value: ['second', 'third'] },
				{ type: 'checkbox', value: [false] },
				{ type: 'text', value: [null] },
				{ type: 'text', label: 'Zero', value: [0] },
				{ type: 'text', label: 'Empty', value: [''] },
			],
		},
	};
	const result = formatRecord(record, false, true);
	assert.deepEqual(Object.keys(result), [
		'recordUid',
		'title',
		'revision',
		'folderUid',
		'folderName',
		'fields',
	]);
	assert.equal(result.fields.length, 8);
	assert.deepEqual(result.fields[3], {
		type: 'text',
		label: 'Duplicate',
		value: ['second', 'third'],
	});
	assert.deepEqual(
		formatRecord(record, true, true).fields.map((f) => f.value),
		[['user'], ['first'], ['second', 'third'], [false], [0], ['']],
	);
	assert.equal(result.recordKey, undefined);
	assert.equal(result.custom, undefined);
	assert.equal(
		formatRecord({ ...record, data: { title: 'Empty', fields: [] } }, true, true).fields.length,
		0,
	);
});
