// UI defaults follow the UI Fields tables in Keeper's field/record documentation.
// The wire schemas remain separate so optional SDK-supported fields still validate.
import type { FieldSchema } from './RecordSchemas';
export type UiField = FieldSchema & { displayName: string };
const item = (type: string, displayName: string, label?: string): UiField => ({
	type,
	displayName,
	...(label ? { label } : {}),
});
const name = () => item('name', 'Name');
const login = () => item('login', 'Login');
const password = () => item('password', 'Password');
const website = () => item('url', 'Website Address');
const host = () => item('host', 'Hostname or IP Address / Port');
const address = () => item('addressRef', 'Address');
const birth = () => item('birthDate', 'Date of Birth');
const expiration = () => item('expirationDate', 'Expiration Date');
export const documentedFields: Record<string, UiField[]> = {
	address: [item('address', 'Address')],
	bankAccount: [
		item('bankAccount', 'Bank Account'),
		name(),
		login(),
		password(),
		website(),
		item('cardRef', 'Payment Card'),
	],
	bankCard: [
		item('paymentCard', 'Payment Card'),
		item('text', 'Cardholder Name', 'Cardholder Name'),
		item('pinCode', 'Pin Code'),
		address(),
	],
	birthCertificate: [name(), birth()],
	contact: [
		name(),
		item('text', 'Company', 'Company'),
		item('email', 'Email'),
		item('phone', 'Phone'),
		address(),
	],
	databaseCredentials: [item('text', 'Type', 'type'), host(), login(), password()],
	driverLicense: [
		item('accountNumber', "Driver's License Number", "Driver's License Number"),
		name(),
		birth(),
		address(),
		expiration(),
	],
	encryptedNotes: [item('note', 'Secured Note'), item('date', 'Date')],
	file: [],
	healthInsurance: [
		item('accountNumber', 'Account Number'),
		{ ...name(), label: "Insured's Name" },
		login(),
		password(),
		website(),
	],
	login: [login(), password(), website()],
	membership: [item('accountNumber', 'Account Number'), name(), password()],
	passport: [
		item('accountNumber', 'Passport Number', 'Passport Number'),
		name(),
		birth(),
		address(),
		expiration(),
		item('date', 'Date Issued', 'Date Issued'),
		password(),
	],
	photo: [],
	serverCredentials: [host(), login(), password()],
	softwareLicense: [
		item('licenseNumber', 'Software License Key'),
		expiration(),
		item('date', 'Date Active', 'Date Active'),
	],
	ssnCard: [item('accountNumber', 'Identity Number', 'Identity Number'), name()],
	sshKeys: [
		login(),
		item('keyPair', 'Public Key / Private Key'),
		item('password', 'Passphrase'),
		host(),
	],
};

export const fieldUiNames: Record<string, string> = {
	fileRef: 'Attachments',
	passkey: 'Passkey',
	oneTimeCode: 'One-Time Code',
	securityQuestion: 'Security Question',
};

export function fieldOptionName(slot: FieldSchema): string {
	return `standard${slot.type[0].toUpperCase()}${slot.type.slice(1)}`;
}
