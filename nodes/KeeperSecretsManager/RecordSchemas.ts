// Standard record schemas adapted from Keeper Security's MIT-licensed helper.
// See THIRD_PARTY_NOTICES.md for attribution and the upstream reference.
import type { IDataObject } from 'n8n-workflow';
import type { RecordData } from './KeeperClient';

export type FieldSchema = { type: string; label?: string };
const field = (type: string, label?: string): FieldSchema => ({
	type,
	...(label ? { label } : {}),
});
export const recordSchemas: Record<string, FieldSchema[]> = {
	address: [field('address'), field('fileRef')],
	bankAccount: [
		'bankAccount',
		'name',
		'login',
		'password',
		'url',
		'cardRef',
		'fileRef',
		'oneTimeCode',
	].map((type) => field(type)),
	bankCard: [
		field('paymentCard'),
		field('text', 'Cardholder Name'),
		field('pinCode'),
		field('addressRef'),
		field('fileRef'),
	],
	birthCertificate: [field('name'), field('birthDate'), field('fileRef')],
	contact: [
		field('name'),
		field('text', 'Company'),
		field('email'),
		field('phone'),
		field('addressRef'),
		field('fileRef'),
	],
	databaseCredentials: [
		field('text', 'type'),
		field('host'),
		field('login'),
		field('password'),
		field('fileRef'),
	],
	driverLicense: [
		field('accountNumber', "Driver's License Number"),
		field('name'),
		field('birthDate'),
		field('addressRef'),
		field('expirationDate'),
		field('fileRef'),
	],
	encryptedNotes: [field('note'), field('date'), field('fileRef')],
	file: [field('fileRef')],
	healthInsurance: [
		field('accountNumber'),
		field('name', "Insured's Name"),
		field('login'),
		field('password'),
		field('url'),
		field('fileRef'),
	],
	login: ['passkey', 'login', 'password', 'url', 'fileRef', 'oneTimeCode'].map((type) =>
		field(type),
	),
	membership: ['accountNumber', 'name', 'password', 'fileRef'].map((type) => field(type)),
	passport: [
		field('accountNumber', 'Passport Number'),
		field('name'),
		field('birthDate'),
		field('addressRef'),
		field('expirationDate'),
		field('date', 'Date Issued'),
		field('password'),
		field('fileRef'),
	],
	photo: [field('fileRef')],
	serverCredentials: ['host', 'login', 'password', 'fileRef'].map((type) => field(type)),
	softwareLicense: [
		field('licenseNumber'),
		field('expirationDate'),
		field('date', 'Date Active'),
		field('fileRef'),
		field('securityQuestion'),
	],
	ssnCard: [field('accountNumber', 'Identity Number'), field('name'), field('fileRef')],
	sshKeys: ['login', 'keyPair', 'password', 'host', 'fileRef'].map((type) => field(type)),
};

export const recordTypeNames: Record<string, string> = {
	address: 'Address',
	bankAccount: 'Bank Account',
	bankCard: 'Payment Card',
	birthCertificate: 'Birth Certificate',
	contact: 'Contact',
	databaseCredentials: 'Database',
	driverLicense: "Driver's License",
	encryptedNotes: 'Secure Note',
	file: 'File Attachment',
	healthInsurance: 'Health Insurance',
	login: 'Login',
	membership: 'Membership',
	passport: 'Passport',
	photo: 'Photo',
	serverCredentials: 'Server',
	softwareLicense: 'Software License',
	ssnCard: 'Identity Card',
	sshKeys: 'SSH Key',
};

export const objectFieldTypes = [
	'address',
	'bankAccount',
	'host',
	'keyPair',
	'name',
	'paymentCard',
	'phone',
	'securityQuestion',
	'passkey',
	'pamHostname',
	'pamResources',
	'script',
	'schedule',
];
export const arrayFieldTypes = ['addressRef', 'cardRef', 'fileRef', 'recordRef'];
export const numericFieldTypes = ['birthDate', 'date', 'expirationDate'];
export const booleanFieldTypes = ['checkbox'];
export const fieldParameterName = (type: string) =>
	`fields${type[0].toUpperCase()}${type.slice(1)}`;

// Match a schema slot once. Extra occurrences and nonmatching labels are custom.
// Unlabelled JSON fields can fill a labelled standard slot of the same type.
export function partitionFields(
	type: string,
	supplied: IDataObject[],
	complete = false,
): { fields: IDataObject[]; custom: IDataObject[] } {
	const schema = Object.prototype.hasOwnProperty.call(recordSchemas, type)
		? recordSchemas[type]
		: undefined;
	if (!schema) return { fields: supplied, custom: [] };
	const remaining = [...supplied];
	const fields: IDataObject[] = [];
	for (const slot of schema) {
		let index = remaining.findIndex(
			(candidate) => candidate.type === slot.type && (candidate.label || '') === (slot.label || ''),
		);
		if (index < 0 && slot.label)
			index = remaining.findIndex((candidate) => candidate.type === slot.type && !candidate.label);
		if (index < 0) {
			if (complete) fields.push({ ...slot, value: [] });
			continue;
		}
		const candidate = remaining.splice(index, 1)[0];
		fields.push({ ...candidate, ...slot });
	}
	return { fields, custom: remaining };
}

export function normalizeRecord(data: RecordData): RecordData {
	const { fields, custom } = partitionFields(data.type, data.fields, true);
	return { ...data, fields, custom: [...(data.custom ?? []), ...custom] };
}
