'use strict';

const assert = require('node:assert/strict');
const { withRetry } = require('./retry');

function httpError(status) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
}

const noWait = () => Promise.resolve();

// Each pair gives the HTTP status and the number of failures before recovery.
const recoveryCases = [
  [408, 1],
  [429, 1],
  [500, 1],
  [502, 1],
  [503, 2],
  [504, 1],
];

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
  ...recoveryCases.map(([status, failuresBeforeSuccess]) => [
    `recovers after HTTP ${status}`,
    () => expectRecovery(status, failuresBeforeSuccess),
  ]),
  ['honors attempts: 1 for persistent HTTP 503', async () => {
    let calls = 0;
    let waits = 0;
    const originalError = httpError(503);
    await assert.rejects(withRetry(async () => {
      calls += 1;
      throw originalError;
    }, {
      attempts: 1,
      wait: async () => { waits += 1; },
    }), (error) => error === originalError);
    assert.equal(calls, 1, 'attempts: 1 must call the operation exactly once');
    assert.equal(waits, 0, 'attempts: 1 must not wait after exhausting the retry budget');
  }],
  ...[400, 404].map((status) => [`does not retry a rejected request (${status})`, async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls += 1;
      throw httpError(status);
    }, { wait: noWait }), { status });
    assert.equal(calls, 1);
  }]),
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
