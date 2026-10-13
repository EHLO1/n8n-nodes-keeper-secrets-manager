import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { createSecret, deleteSecret, getSecrets, updateSecret } from '@keeper-security/secrets-manager-core';
import { keeperOptions, uidList, validateData, createData, formatRecord } from './GenericFunctions';
export class KeeperSecretsManager implements INodeType {
 description: INodeTypeDescription = {
  displayName: 'Keeper Secrets Manager', name: 'keeperSecretsManager',
  group: ['transform'], version: 1, description: 'Read and manage Keeper secrets',
  defaults: { name: 'Keeper Secrets Manager' },
  inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main],
  credentials: [{ name: 'keeperSecretsManagerApi', required: true }],
  properties: [
   { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
    options: [
     { name: 'Get All Secrets', value: 'getAll', action: 'Get all secrets' },
     { name: 'Get Secrets by UID', value: 'getByUid', action: 'Get secrets by UID' },
     { name: 'Create a Secret', value: 'create', action: 'Create a secret' },
     { name: 'Update a Secret', value: 'update', action: 'Update a secret' },
     { name: 'Delete Secrets', value: 'delete', action: 'Delete secrets' },
    ], default: 'getAll' },
   { displayName: 'Record UIDs', name: 'recordUids', type: 'string', default: '', required: true,
    displayOptions: { show: { operation: ['getByUid', 'delete'] } },
    description: 'Comma-separated or whitespace-separated record UIDs' },
   { displayName: 'Record UID', name: 'recordUid', type: 'string', default: '', required: true,
    displayOptions: { show: { operation: ['update'] } } },
   { displayName: 'Shared Folder UID', name: 'folderUid', type: 'string', default: '', required: true,
    displayOptions: { show: { operation: ['create'] } },
    description: 'Accessible shared folder root UID, not a subfolder UID' },
   { displayName: 'Record Data JSON', name: 'recordData', type: 'json', default: '{"type":"login","title":"New Secret","fields":[]}', required: true,
    displayOptions: { show: { operation: ['create'] } },
    description: 'Keeper record data with title, type, fields, and optional notes/custom' },
   { displayName: 'Update Data JSON', name: 'updateData', type: 'json', default: '{}', required: true,
    displayOptions: { show: { operation: ['update'] } },
    description: 'Top-level patch. Omitted properties remain unchanged; supplied fields/custom arrays replace those entire arrays.' },
   { displayName: 'Confirm Deletion', name: 'confirmDelete', type: 'boolean', default: false,
    displayOptions: { show: { operation: ['delete'] } },
    description: 'Whether to permanently delete the specified records' },
   { displayName: 'Output Format', name: 'outputFormat', type: 'options',
    options: [{ name: 'Raw Record Data', value: 'raw' }, { name: 'Flat (Existing Workflow Format)', value: 'flat' }],
    default: 'raw', displayOptions: { show: { operation: ['getAll', 'getByUid'] } } },
   { displayName: 'Exclude Record UIDs', name: 'excludeUids', type: 'string', default: '',
    displayOptions: { show: { operation: ['getAll', 'getByUid'] } },
    description: 'Optional comma-separated or whitespace-separated UIDs to omit from read results' },
  ],
 };
 async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const items = this.getInputData();
  const output: INodeExecutionData[] = [];
  let options: Awaited<ReturnType<typeof keeperOptions>>;
  try { options = await keeperOptions(this); }
  catch { throw new NodeOperationError(this.getNode(), 'Keeper configuration could not be loaded. Check the bound JSON or Base64 configuration.'); }
  for (let i = 0; i < items.length; i++) {
   const operation = this.getNodeParameter('operation', i) as string;
   const emit = (json: IDataObject) => output.push({ json, pairedItem: { item: i } });
   try {
    if (operation === 'getAll' || operation === 'getByUid') {
     const requested = operation === 'getByUid' ? uidList(this.getNodeParameter('recordUids', i) as string) : undefined;
     const { records } = await getSecrets(options, requested);
     if (requested && requested.some(uid => !records.some(r => r.recordUid === uid))) throw new Error('Requested record unavailable');
     const excluded = new Set((this.getNodeParameter('excludeUids', i) as string).split(/[\s,]+/).filter(Boolean));
     const flat = this.getNodeParameter('outputFormat', i) === 'flat';
     for (const record of records) if (!excluded.has(record.recordUid)) emit(formatRecord(record, flat));
    } else if (operation === 'create') {
     const folder = (this.getNodeParameter('folderUid', i) as string).trim();
     if (!folder) throw new Error('Folder UID required');
     const data = createData(this.getNodeParameter('recordData', i));
     const recordUid = await createSecret(options, folder, data);
     emit({ recordUid, operation, success: true });
    } else if (operation === 'update') {
     const uid = (this.getNodeParameter('recordUid', i) as string).trim();
     if (!uid) throw new Error('Record UID required');
     const patch = validateData(this.getNodeParameter('updateData', i), true);
     if (!Object.keys(patch).length) throw new Error('Empty patch');
     const { records } = await getSecrets(options, [uid]);
     const record = records.find(r => r.recordUid === uid);
     if (!record) throw new Error('Record unavailable');
     record.data = { ...record.data, ...patch } as typeof record.data;
     await updateSecret(options, record);
     emit({ recordUid: uid, operation, success: true });
    } else if (operation === 'delete') {
     if (!this.getNodeParameter('confirmDelete', i)) throw new Error('Deletion confirmation required');
     const uids = uidList(this.getNodeParameter('recordUids', i) as string);
     const result = await deleteSecret(options, uids);
     const statuses = uids.map(uid => {
      const status = result.records.find(r => r.recordUid === uid);
      return { recordUid: uid, responseCode: status?.responseCode ?? 'missing_response', success: status?.responseCode === 'ok' };
     });
     emit({ operation, success: statuses.every(s => s.success), records: statuses });
    } else throw new Error('Unsupported operation');
   } catch {
    const message = `Keeper ${operation} failed. Check parameters, application permissions, record access, and connectivity. A write may have completed; verify Keeper before retrying.`;
    if (this.continueOnFail()) emit({ error: message, operation, success: false });
    else throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
   }
  }
  return [output];
 }
}
