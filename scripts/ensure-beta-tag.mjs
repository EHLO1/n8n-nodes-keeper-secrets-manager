// npm can assign latest on the first publication even when --tag beta is used.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/-beta\.\d+$/.test(version)) throw new Error('This command only handles beta versions');
for (let attempt = 0; attempt < 12; attempt++) {
	let tags;
	try {
		tags = JSON.parse(
			execFileSync('npm', ['view', name, 'dist-tags', '--json', '--prefer-online'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			}),
		);
	} catch {
		// New packages can take several minutes to become readable in the registry.
		tags = undefined;
	}
	if (tags?.beta === version) {
		if (tags.latest === version) {
			try {
				execFileSync('npm', ['dist-tag', 'rm', name, 'latest'], { stdio: 'inherit' });
			} catch {
				console.warn(
					`Beta is published, but npm did not permit removing latest. A maintainer must run: npm dist-tag rm ${name} latest`,
				);
				process.exit(0);
			}
		}
		console.log(`Confirmed ${name}@${version} uses beta without promoting it to latest`);
		process.exit(0);
	}
	await setTimeout(15_000);
}
throw new Error('Beta was not visible in the registry before the processing timeout');
