const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

test('credential test interoperates with n8n 2.10.3 real HTTP helper over a local server', () => {
	// Isolate n8n-core's process-wide HTTP pools and timers from the test runner.
	execFileSync(process.execPath, [join(__dirname, 'n8n-http-fixture.cjs')], {
		timeout: 15000,
		stdio: 'pipe',
	});
});
