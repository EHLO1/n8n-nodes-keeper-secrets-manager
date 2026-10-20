import type { INodeProperties } from 'n8n-workflow';
import { documentedFields, fieldOptionName, fieldUiNames } from './RecordFieldUi';
import {
	arrayFieldTypes,
	booleanFieldTypes,
	fieldParameterName,
	numericFieldTypes,
	objectFieldTypes,
	recordSchemas,
	recordTypeNames,
} from './RecordSchemas';

const docs =
	'<a href="https://docs.keeper.io/keeperpam/secrets-manager/about/field-record-types#default-record-types" target="_blank">Keeper record types</a>';
const structured = { operation: ['create', 'update'], inputMode: ['structured'] };
const jsonTypes = [...objectFieldTypes, ...arrayFieldTypes];
const typeOptions = Object.entries(recordTypeNames)
	.map(([value, name]) => ({ name, value }))
	.sort((a, b) => a.name.localeCompare(b.name));

const clearValue: INodeProperties = {
	displayName: 'Clear Value',
	name: 'clearValue',
	type: 'boolean',
	default: false,
	displayOptions: { show: { '/operation': ['update'] } },
	description:
		'Whether to empty the stored Keeper value. Removing an input item only leaves that stored value unchanged.',
};

function fields(type: string): INodeProperties {
	const defaults = documentedFields[type] ?? [];
	const standardOptions = (recordSchemas[type] ?? []).map((slot) => {
		const friendly =
			defaults.find((entry) => entry.type === slot.type)?.displayName ??
			fieldUiNames[slot.type] ??
			slot.label ??
			slot.type;
		const complex = jsonTypes.includes(slot.type);
		return {
			name: fieldOptionName(slot),
			displayName: friendly,
			values: [
				clearValue,
				{
					displayName: 'Value',
					name: complex ? 'jsonValue' : 'textValue',
					type: complex ? 'json' : 'string',
					default: '',
					displayOptions: { hide: { clearValue: [true] } },
					description: complex
						? 'Keeper object or value array. For a host: {"hostName":"db.example.com","port":"5432"}. Blank leaves an existing value unchanged.'
						: 'The value stored in this Keeper field. Blank leaves an existing value unchanged on update.',
				} as INodeProperties,
			],
		};
	});
	return {
		displayName: 'Fields',
		name: fieldParameterName(type),
		type: 'fixedCollection',
		default: {
			...Object.fromEntries(
				defaults.map((slot) => [
					fieldOptionName(slot),
					[{ [jsonTypes.includes(slot.type) ? 'jsonValue' : 'textValue']: '' }],
				]),
			),
		},
		placeholder: 'Add Field',
		typeOptions: { multipleValues: true },
		displayOptions: { show: { ...structured, recordType: [type] } },
		description:
			'Default items follow Keeper’s documented fields. Use the native Delete Item control to omit an input. On update, omitted or blank items leave stored values unchanged; Clear Value empties a stored value. Extra types and labels are saved as custom automatically.',
		options: [
			...standardOptions,
			{
				name: 'field',
				displayName: 'Additional Field',
				values: [
					clearValue,
					{
						displayName: 'Label',
						name: 'label',
						type: 'string',
						default: '',
						description:
							'Optional label for an added field; standard field titles are fixed by the selected record type',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'string',
						default: 'text',
						required: true,
						description:
							'Keeper field type, such as login, password, text, host, date, or checkbox. The value format is determined automatically.',
					},
					{
						displayName: 'Value',
						name: 'textValue',
						type: 'string',
						default: '',
						displayOptions: { hide: { type: jsonTypes, clearValue: [true] } },
						description: `Text is preserved exactly. For ${numericFieldTypes.join(', ')} use epoch milliseconds; for ${booleanFieldTypes.join(', ')} use true or false. Blank leaves an existing value unchanged.`,
					},
					{
						displayName: 'Value',
						name: 'jsonValue',
						type: 'json',
						default: '',
						displayOptions: { show: { type: jsonTypes }, hide: { clearValue: [true] } },
						description:
							'A Keeper object or value array. Host example: {"hostName":"db.example.com","port":"5432"}. Reference fields accept arrays of record UIDs. Blank leaves the value unchanged.',
					},
				],
			},
		],
	};
}

export const recordProperties: INodeProperties[] = [
	{
		displayName: 'Input Mode',
		name: 'inputMode',
		type: 'options',
		default: 'structured',
		options: [
			{ name: 'Structured Fields', value: 'structured' },
			{ name: 'Raw JSON', value: 'json' },
		],
		displayOptions: { show: { operation: ['create', 'update'] } },
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		required: true,
		description:
			'The record name shown in the Keeper vault, such as Production Database. It is separate from the login or username stored inside the record.',
		displayOptions: { show: { operation: ['create'], inputMode: ['structured'] } },
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		description:
			'Rename the record as shown in the Keeper vault. Leave blank to preserve its current title; this does not change its login or username.',
		displayOptions: { show: { operation: ['update'], inputMode: ['structured'] } },
	},
	{
		displayName: 'Record Type',
		name: 'recordType',
		type: 'options',
		default: 'login',
		options: [
			{ name: 'Login', value: 'login' },
			...typeOptions.filter((option) => option.value !== 'login'),
			{ name: 'Custom Record Type', value: 'custom' },
		],
		description: `Select a template to show its default fields. See ${docs}. File and photo templates reference existing attachments; they do not upload files.`,
		displayOptions: { show: { operation: ['create'], inputMode: ['structured'] } },
	},
	{
		displayName: 'Record Type',
		name: 'recordType',
		type: 'options',
		default: 'existing',
		options: [
			{ name: 'Keep Existing Type', value: 'existing' },
			...typeOptions,
			{ name: 'Custom Record Type', value: 'custom' },
		],
		description: `Keep the existing type, or explicitly select a type to show its default fields and apply that type to the record. See ${docs}. Blank field values never overwrite existing values.`,
		displayOptions: { show: { operation: ['update'], inputMode: ['structured'] } },
	},
	{
		displayName: 'Custom Record Type',
		name: 'customRecordType',
		type: 'string',
		default: '',
		required: true,
		description:
			'Exact name of a record type already configured in your Keeper tenant. Its schema is not available locally; use Raw JSON to control standard and custom arrays explicitly.',
		displayOptions: { show: { ...structured, recordType: ['custom'] } },
	},
	...Object.keys(recordSchemas).map(fields),
	fields('existing'),
	fields('custom'),
	{
		displayName: 'Notes',
		name: 'notes',
		type: 'string',
		default: '',
		typeOptions: { rows: 4 },
		description:
			'Optional record-level notes shown in Keeper. On update, blank preserves existing notes; use Clear Notes to remove them.',
		displayOptions: { show: structured },
	},
	{
		displayName: 'Clear Notes',
		name: 'clearNotes',
		type: 'boolean',
		default: false,
		description: 'Whether to remove the existing record-level notes',
		displayOptions: { show: { operation: ['update'], inputMode: ['structured'] } },
	},
	// Read saved beta.4 parameters without exposing the superseded containers in the editor.
	...['recordFields', 'customFields', 'recordOptions', 'updateOptions'].map(
		(name): INodeProperties => ({ displayName: name, name, type: 'hidden', default: {} }),
	),
];
