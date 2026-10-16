import type {
	ICredentialTestFunctions,
	IExecuteFunctions,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { KeeperProtocolError } from './KeeperCrypto';

export type KeeperRequest = { url: string; body: Buffer; headers: Record<string, string> };
export type KeeperResponse = { statusCode: number; body: Buffer };
export type KeeperTransport = (request: KeeperRequest) => Promise<KeeperResponse>;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function responseBytes(response: { statusCode: number; body: unknown }): KeeperResponse {
	const value = response.body;
	// Never coerce decoded strings/objects into ciphertext: the adapter must return bytes.
	if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array) && !(value instanceof ArrayBuffer))
		throw new KeeperProtocolError('Invalid binary response');
	// n8n buffers HTTP responses before returning; this bounds processing, not network buffering.
	if (value.byteLength > MAX_RESPONSE_BYTES)
		throw new KeeperProtocolError('Keeper response too large');
	const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
	const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
	return { statusCode: response.statusCode, body };
}

export function executionTransport(ctx: IExecuteFunctions): KeeperTransport {
	return async (request) => {
		const options: IHttpRequestOptions = {
			...request,
			method: 'POST',
			encoding: 'arraybuffer',
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			disableFollowRedirect: true,
			sendCredentialsOnCrossOriginRedirect: false,
			timeout: 30_000,
		};
		return responseBytes(await ctx.helpers.httpRequest(options));
	};
}

export function credentialTransport(ctx: ICredentialTestFunctions): KeeperTransport {
	// n8n's credential-test context currently exposes the legacy request helper only.
	return async (request) =>
		responseBytes(
			await ctx.helpers.request({
				uri: request.url,
				body: request.body,
				headers: request.headers,
				method: 'POST',
				encoding: null,
				json: false,
				resolveWithFullResponse: true,
				simple: false,
				followRedirect: false,
				followAllRedirects: false,
				timeout: 30_000,
			}),
		);
}
