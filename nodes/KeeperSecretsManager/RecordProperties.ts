import type { INodeProperties } from 'n8n-workflow';

function fields(name: string, displayName: string): INodeProperties {
	return {
		displayName,
		name,
		type: 'fixedCollection',
		default: {},
		placeholder: 'Add Field',
		typeOptions: { multipleValues: true },
		displayOptions: { show: { operation: ['create', 'update'], inputMode: ['structured'] } },
		description: 'Updates match by Keeper type and label; unrelated fields remain unchanged',
		options: [
			{
				name: 'field',
				displayName: 'Field',
				values: [
					{
						displayName: 'Data Type',
						name: 'valueType',
						type: 'options',
						default: 'text',
						options: [
							{ name: 'Boolean', value: 'boolean' },
							{ name: 'JSON Array', value: 'json' },
							{ name: 'Number', value: 'number' },
							{ name: 'Text', value: 'text' },
						],
					},
					{
						displayName: 'Label',
						name: 'label',
						type: 'string',
						default: '',
						description: 'Optional field label; use the exact existing label when updating',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'string',
						default: 'text',
						required: true,
						description: 'Keeper field type, such as login, password, text, or host',
					},
					{
						displayName: 'Value',
						name: 'textValue',
						type: 'string',
						default: '',
						displayOptions: { show: { valueType: ['text'] } },
					},
					{
						displayName: 'Value',
						name: 'numberValue',
						type: 'number',
						default: 0,
						displayOptions: { show: { valueType: ['number'] } },
					},
					{
						displayName: 'Value',
						name: 'booleanValue',
						type: 'boolean',
						default: false,
						displayOptions: { show: { valueType: ['boolean'] } },
					},
					{
						displayName: 'Value Array',
						name: 'jsonValue',
						type: 'json',
						default: JSON.stringify(['value'], null, 2),
						displayOptions: { show: { valueType: ['json'] } },
						description:
							'Keeper value array. For a host field: [{"hostName":"db.example.com","port":"5432"}]. Use [] to clear a value.',
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
		displayOptions: { show: { operation: ['create'], inputMode: ['structured'] } },
	},
	{
		displayName: 'Record Type',
		name: 'recordType',
		type: 'string',
		default: 'login',
		required: true,
		description: 'Keeper record type, such as login, serverCredentials, or databaseCredentials',
		displayOptions: { show: { operation: ['create'], inputMode: ['structured'] } },
	},
	fields('recordFields', 'Fields'),
	fields('customFields', 'Custom Fields'),
	{
		displayName: 'Additional Properties',
		name: 'recordOptions',
		type: 'collection',
		default: {},
		placeholder: 'Add Property',
		displayOptions: { show: { operation: ['create'], inputMode: ['structured'] } },
		options: [
			{
				displayName: 'Notes',
				name: 'notes',
				type: 'string',
				default: '',
				typeOptions: { rows: 4 },
			},
		],
	},
	{
		displayName: 'Update Fields',
		name: 'updateOptions',
		type: 'collection',
		default: {},
		placeholder: 'Add Property',
		displayOptions: { show: { operation: ['update'], inputMode: ['structured'] } },
		options: [
			{
				displayName: 'Notes',
				name: 'notes',
				type: 'string',
				default: '',
				typeOptions: { rows: 4 },
				description: 'Empty text clears notes; omit to preserve existing notes',
			},
			{ displayName: 'Record Type', name: 'type', type: 'string', default: 'login' },
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
		],
	},
];
