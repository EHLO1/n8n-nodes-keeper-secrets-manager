import { loadJsonConfig, type SecretsManagerOptions } from '@keeper-security/secrets-manager-core';
import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
type RecordData = Parameters<typeof import('@keeper-security/secrets-manager-core').createSecret>[2];
type KeeperRecord = Awaited<ReturnType<typeof import('@keeper-security/secrets-manager-core').getSecrets>>['records'][number];

export function parseObject(value: unknown): Record<string, unknown> {
 let result: unknown;
 try { result = typeof value === 'string' ? JSON.parse(value) : value; }
 catch { throw new Error('Invalid JSON object'); }
 if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected a JSON object');
 return result as Record<string, unknown>;
}
export async function keeperOptions(ctx: IExecuteFunctions): Promise<SecretsManagerOptions> {
 const c = await ctx.getCredentials('keeperSecretsManagerApi');
 let text: string;
 if (c.source === 'json') text = String(c.configJson ?? '');
 else if (c.source === 'base64') {
  const encoded = String(c.configBase64 ?? '').replace(/\s/g, '');
  if (!encoded || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded) || encoded.length % 4 === 1)
   throw new Error('Invalid base64 configuration');
  text = Buffer.from(encoded, 'base64').toString('utf8');
 } else throw new Error('Unknown configuration source');
 const config = parseObject(text.replace(/^\uFEFF/, ''));
 for (const key of ['hostname', 'clientId', 'privateKey', 'serverPublicKeyId', 'appKey']) {
  if (typeof config[key] !== 'string' || !(config[key] as string).trim())
   throw new Error('Configuration must be complete and already bound');
 }
 const hosts = new Set(['keepersecurity.com', 'keepersecurity.eu', 'keepersecurity.com.au',
  'keepersecurity.jp', 'keepersecurity.ca', 'govcloud.keepersecurity.us']);
 if (!hosts.has(config.hostname as string)) throw new Error('Unsupported Keeper hostname');
 // Fresh storage per execution; no credential material is shared between workflows.
 return { storage: loadJsonConfig(JSON.stringify(config)) };
}
export function uidList(value: string): string[] {
 const list = [...new Set(value.split(/[\s,]+/).filter(Boolean))];
 if (!list.length) throw new Error('At least one record UID is required');
 return list;
}
export function validateData(value: unknown, partial = false): Record<string, unknown> {
 const data = parseObject(value);
 const allowed = new Set(['title', 'type', 'notes', 'fields', 'custom']);
 if (Object.keys(data).some(k => !allowed.has(k))) throw new Error('Unsupported record data property');
 for (const key of ['title', 'type', 'notes'])
  if (key in data && typeof data[key] !== 'string') throw new Error('Record text properties must be strings');
 if (!partial && (!data.title || !data.type || !Array.isArray(data.fields)))
  throw new Error('Create requires title, type, and fields');
 for (const key of ['fields', 'custom']) {
  if (!(key in data)) continue;
  if (!Array.isArray(data[key])) throw new Error('Fields must be arrays');
  for (const field of data[key] as unknown[]) {
   const f = parseObject(field);
   if (typeof f.type !== 'string' || !Array.isArray(f.value)) throw new Error('Each field requires type and value array');
  }
 }
 return data;
}
export function createData(value: unknown): RecordData {
 return validateData(value) as unknown as RecordData;
}
export function formatRecord(record: KeeperRecord, flat: boolean): IDataObject {
 // Never serialize a complete SDK record, which may contain encryption keys.
 if (!flat) return JSON.parse(JSON.stringify({ recordUid: record.recordUid,
  revision: record.revision, data: record.data })) as IDataObject;
 const data = record.data as unknown as { title: string; fields?: {label?: string; type: string; value?: unknown[]}[]; custom?: {label?: string; type: string; value?: unknown[]}[] };
 const map: Record<string, unknown> = Object.create(null);
 for (const field of [...(data.fields ?? []), ...(data.custom ?? [])]) {
  const key = (field.label || field.type || '').replace(/\s+/g, '').toLowerCase();
  if (key) map[key] = field.value?.[0] ?? null;
 }
 return JSON.parse(JSON.stringify({ recordUid: record.recordUid, title: data.title,
  revision: record.revision, login: map.login ?? null, password: map.password ?? null,
  distinguishedName: map.distinguishedname ?? null, description: map.description ?? null,
  id: map.id ?? null, domain: map.domain ?? null })) as IDataObject;
}
