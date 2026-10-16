import type {
	IDataObject,
	ICredentialTestFunction,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { KeeperClient } from './KeeperClient';
import { recordProperties } from './RecordProperties';
import { credentialTransport, executionTransport } from './KeeperTransport';
import { keeperFailureMessage } from './KeeperCrypto';
import {
	keeperOptions,
	uidList,
	validateData,
	createData,
	formatRecord,
	KeeperValidationError,
	structuredFields,
	mergeFields,
} from './GenericFunctions';

const keeperCredentialTest: ICredentialTestFunction = async function (credential) {
	try {
		const options = keeperOptions(credential.data ?? {});
		await new KeeperClient(options, credentialTransport(this)).getSecrets();
		return { status: 'OK', message: 'Connected to Keeper Secrets Manager' };
	} catch (error) {
		return {
			status: 'Error',
			message: keeperFailureMessage(error),
		};
	}
};

export class KeeperSecretsManager implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Keeper Secrets Manager',
		subtitle: '={{$parameter["operation"]}}',
		name: 'keeperSecretsManager',
		icon: { light: 'file:keeper-logo.svg', dark: 'file:keeper-logo.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Read and manage Keeper records',
		defaults: {
			name: 'Keeper Secrets Manager',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{ name: 'keeperSecretsManagerApi', required: true, testedBy: 'keeperCredentialTest' },
		],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Create a Record', value: 'create', action: 'Create a record' },
					{ name: 'Delete Records', value: 'delete', action: 'Delete records' },
					{ name: 'Get All Records', value: 'list', action: 'Get all records' },
					{ name: 'Get Records by UID', value: 'getByUid', action: 'Get records by UID' },
					{ name: 'Update a Record', value: 'update', action: 'Update a record' },
				],
				default: 'list',
			},
			{
				displayName: 'Record UIDs',
				name: 'recordUids',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['getByUid', 'delete'],
					},
				},
				description: 'Comma-separated or whitespace-separated record UIDs',
			},
			{
				displayName: 'Record UID',
				name: 'recordUid',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['update'],
					},
				},
			},
			{
				displayName: 'Shared Folder UID',
				name: 'folderUid',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['create'],
					},
				},
				description:
					'Required root shared folder UID. Keeper uses its encryption key to share the new record with this application.',
			},
			...recordProperties,
			{
				displayName: 'Record Data JSON',
				name: 'recordData',
				type: 'json',
				default: JSON.stringify(
					{
						type: 'login',
						title: 'Production',
						fields: [
							{ type: 'login', value: ['service-account'] },
							{ type: 'password', value: ['replace-me'] },
						],
					},
					null,
					2,
				),
				required: true,
				displayOptions: {
					show: {
						operation: ['create'],
						inputMode: ['json'],
					},
				},
				description:
					'Example login field: {"type":"login","value":["service-account"]}. Record data requires title, type, and fields; notes and custom are optional.',
			},
			{
				displayName: 'Update Data JSON',
				name: 'updateData',
				type: 'json',
				default: JSON.stringify({ notes: 'Updated by n8n' }, null, 2),
				required: true,
				displayOptions: {
					show: {
						operation: ['update'],
						inputMode: ['json'],
					},
				},
				description:
					'Top-level patch. Omitted properties remain unchanged; supplied fields/custom arrays replace those entire arrays.',
			},
			{
				displayName: 'Confirm Deletion',
				name: 'confirmDelete',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: ['delete'],
					},
				},
				description: 'Whether to permanently delete the specified records',
			},
			{
				displayName: 'Exclude Record UIDs',
				name: 'excludeUids',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['list', 'getAll', 'getByUid'],
					},
				},
				description:
					'Optional comma-separated or whitespace-separated UIDs to omit from read results',
			},
		],
	};

	methods = { credentialTest: { keeperCredentialTest } };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];

		let client: KeeperClient;

		try {
			client = new KeeperClient(
				keeperOptions(await this.getCredentials('keeperSecretsManagerApi')),
				executionTransport(this),
			);
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof KeeperValidationError
					? error.message
					: 'Failed to load Keeper Secrets Manager configuration',
			);
		}

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			const emit = (json: IDataObject) => output.push({ json, pairedItem: { item: i } });
			try {
				if (operation === 'list' || operation === 'getAll' || operation === 'getByUid') {
					const requested =
						operation === 'getByUid'
							? uidList(this.getNodeParameter('recordUids', i) as string)
							: undefined;
					const { records } = await client.getSecrets(requested, true);
					const found = new Set(records.map((record) => record.recordUid));
					if (requested && requested.some((uid) => !found.has(uid)))
						throw new NodeOperationError(
							this.getNode(),
							'One or more requested records were not found or are not shared with this application',
						);
					const excluded = new Set(
						(this.getNodeParameter('excludeUids', i) as string).split(/[\s,]+/).filter(Boolean),
					);
					for (const record of records)
						if (!excluded.has(record.recordUid)) emit(formatRecord(record));
				} else if (operation === 'create') {
					const folder = (this.getNodeParameter('folderUid', i) as string).trim();
					if (!folder)
						throw new NodeOperationError(this.getNode(), 'Shared folder UID is required');
					const structured = this.getNodeParameter('inputMode', i, 'structured') !== 'json';
					const data = createData(
						structured
							? {
									...(this.getNodeParameter('recordOptions', i, {}) as IDataObject),
									title: this.getNodeParameter('title', i),
									type: this.getNodeParameter('recordType', i),
									fields: structuredFields(this.getNodeParameter('recordFields', i, {})),
									custom: structuredFields(this.getNodeParameter('customFields', i, {})),
								}
							: this.getNodeParameter('recordData', i),
					);
					const recordUid = await client.createSecret(folder, data);
					emit({ recordUid, operation, success: true });
				} else if (operation === 'update') {
					const uid = (this.getNodeParameter('recordUid', i) as string).trim();
					if (!uid)
						throw new NodeOperationError(this.getNode(), 'Specify the record UID to update');
					const structured = this.getNodeParameter('inputMode', i, 'structured') !== 'json';
					const patch = validateData(
						structured
							? this.getNodeParameter('updateOptions', i, {})
							: this.getNodeParameter('updateData', i),
						true,
					);
					if (structured) {
						for (const [property, parameter] of [
							['fields', 'recordFields'],
							['custom', 'customFields'],
						]) {
							const fields = structuredFields(this.getNodeParameter(parameter, i, {}));
							if (fields.length) patch[property] = fields;
						}
					}
					if (!Object.keys(patch).length)
						throw new NodeOperationError(
							this.getNode(),
							'Update data must contain at least one property',
						);
					const { records } = await client.getSecrets([uid]);
					const record = records.find((r) => r.recordUid === uid);
					if (!record)
						throw new NodeOperationError(
							this.getNode(),
							'The record was not found or is not shared with this application',
						);
					if (structured) {
						for (const property of ['fields', 'custom'] as const)
							if (patch[property])
								patch[property] = mergeFields(
									record.data[property] ?? [],
									patch[property] as IDataObject[],
								);
					}
					record.data = { ...record.data, ...patch } as typeof record.data;
					await client.updateSecret(record);
					emit({ recordUid: uid, operation, success: true });
				} else if (operation === 'delete') {
					if (!this.getNodeParameter('confirmDelete', i))
						throw new NodeOperationError(
							this.getNode(),
							'Enable Confirm Deletion to delete records',
						);
					const uids = uidList(this.getNodeParameter('recordUids', i) as string);
					const result = await client.deleteSecret(uids);
					const statuses = uids.map((uid) => {
						const status = result.records.find((r) => r.recordUid === uid);
						return {
							recordUid: uid,
							responseCode: status?.responseCode ?? 'missing_response',
							success: status?.responseCode === 'ok',
						};
					});
					const success = statuses.every((s) => s.success);
					if (!success && !this.continueOnFail())
						throw new NodeOperationError(
							this.getNode(),
							'One or more records could not be deleted. Some deletions may have succeeded; verify Keeper before retrying.',
						);
					emit({
						operation,
						success,
						records: statuses,
						...(!success ? { error: 'One or more records could not be deleted' } : {}),
					});
				} else throw new NodeOperationError(this.getNode(), 'Unsupported operation');
			} catch (error) {
				const writeWarning = ['create', 'update', 'delete'].includes(operation)
					? ' A write may have completed; verify Keeper before retrying.'
					: '';
				const message =
					error instanceof KeeperValidationError || error instanceof NodeOperationError
						? error.message
						: `Keeper ${operation} failed. Check application permissions, record access, and connectivity.${writeWarning}`;
				if (this.continueOnFail()) emit({ error: message, operation, success: false });
				else throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
			}
		}
		return [output];
	}
}
