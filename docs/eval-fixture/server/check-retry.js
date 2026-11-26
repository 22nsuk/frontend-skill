'use strict';

const assert = require('node:assert/strict');
const { withRetry } = require('./retry');

function httpError(status) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
}

const noWait = () => Promise.resolve();

async function expectRecovery(status, failuresBeforeSuccess) {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls <= failuresBeforeSuccess) throw httpError(status);
    return 'ok';
  }, { wait: noWait });
  assert.equal(result, 'ok');
  assert.equal(calls, failuresBeforeSuccess + 1);
}

const tests = [
  ['returns the first successful result', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return 'ok';
    }, { wait: noWait });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  }],
  ['retries a temporary server error (503)', () => expectRecovery(503, 2)],
  ['retries a request timeout (408)', () => expectRecovery(408, 1)],
  ['retries a rate-limited request (429)', () => expectRecovery(429, 1)],
  ['does not retry a rejected request', async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls += 1;
      throw httpError(400);
    }, { wait: noWait }), { status: 400 });
    assert.equal(calls, 1);
  }],
];

(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`not ok - ${name}\n  ${error.message.split('\n')[0]}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
})();
