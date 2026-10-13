import type { ICredentialType, INodeProperties } from 'n8n-workflow';
export class KeeperSecretsManagerApi implements ICredentialType {
 name = 'keeperSecretsManagerApi';
 displayName = 'Keeper Secrets Manager';
 documentationUrl = 'https://docs.keeper.io/keeperpam/secrets-manager/developer-sdk-library/javascript-sdk';
 properties: INodeProperties[] = [
  { displayName: 'Configuration Source', name: 'source', type: 'options', options: [
   { name: 'Base64', value: 'base64' }, { name: 'JSON', value: 'json' },
  ], default: 'base64' },
  { displayName: 'KSM Configuration Base64', name: 'configBase64', type: 'string',
   typeOptions: { password: true }, default: '', required: true,
   displayOptions: { show: { source: ['base64'] } },
   description: 'Paste the configuration copied from Keeper Add Device > Configuration File > Base64' },
  { displayName: 'KSM Configuration JSON', name: 'configJson', type: 'string',
   typeOptions: { password: true }, default: '', required: true,
   displayOptions: { show: { source: ['json'] } },
   description: 'Complete already-bound KSM configuration JSON, not a one-time token' },
 ];
}
