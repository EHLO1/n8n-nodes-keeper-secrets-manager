// Development/CI tooling only; never included in the published node.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const scannerRoot = dirname(require.resolve('@n8n/scan-community-package/package.json'));
const { analyzePackage, SOURCE_FILE_PATTERNS } = await import(
	pathToFileURL(join(scannerRoot, 'scanner/scanner.mjs'))
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'keeper-node-scan-'));
// This command targets Linux/macOS, including the project's WSL and GitHub CI.
if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary path');
try {
	const tarball = join(temporary, 'node.tgz');
	const unpacked = join(temporary, 'unpacked');
	mkdirSync(unpacked);
	execFileSync('pnpm', ['pack', '--out', tarball], { cwd: root, stdio: 'pipe' });
	execFileSync('tar', ['-xzf', tarball, '-C', unpacked]);
	for (const [label, directory, patterns] of [
		['Source', root, SOURCE_FILE_PATTERNS],
		['Packed distribution', join(unpacked, 'package'), ['**/*.js', 'package.json']],
	]) {
		const result = await analyzePackage(directory, patterns);
		console.log(`${label}: ${result.passed ? 'passed' : 'FAILED'}`);
		if (!result.passed) {
			console.error(result.details ?? result.message);
			process.exitCode = 1;
		}
	}
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
