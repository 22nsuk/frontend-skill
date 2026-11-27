'use strict';

const assert = require('node:assert/strict');
const { withRetry } = require('./retry');

function httpError(status) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
}

// Each pair gives the HTTP status and the number of failures before recovery.
const recoveryCases = [
  [408, 1],
  [429, 1],
  [500, 1],
  [502, 1],
  [503, 2],
  [504, 1],
];

function simulateRequest(status, failuresBeforeSuccess, attempts) {
  const steps = [];
  const errors = [];
  const options = {
    wait: async (attempt) => {
      // Observe wait completion on a later turn of the event loop.
      await new Promise((resolve) => setImmediate(resolve));
      steps.push(`wait ${attempt}`);
    },
  };
  if (attempts !== undefined) options.attempts = attempts;
  const result = withRetry(async (attempt) => {
    steps.push(`call ${attempt}`);
    if (errors.length < failuresBeforeSuccess) {
      const error = status === null ? new TypeError('Failed to fetch') : httpError(status);
      errors.push(error);
      throw error;
    }
    return 'ok';
  }, options);
  return { result, steps, errors };
}

function expectedSteps(calls) {
  const steps = ['call 0'];
  for (let attempt = 1; attempt < calls; attempt += 1) {
    steps.push(`wait ${attempt - 1}`, `call ${attempt}`);
  }
  return steps;
}

async function expectRecovery(status, failuresBeforeSuccess) {
  const { result, steps } = simulateRequest(status, failuresBeforeSuccess);
  assert.equal(await result, 'ok');
  assert.deepEqual(steps, expectedSteps(failuresBeforeSuccess + 1));
}

async function expectExhaustion(attempts) {
  const expectedCalls = attempts ?? 3;
  const { result, steps, errors } = simulateRequest(503, expectedCalls, attempts);
  await assert.rejects(result, (error) => error === errors[expectedCalls - 1]);
  assert.deepEqual(steps, expectedSteps(expectedCalls));
}

async function expectRejectedClientErrors() {
  const retryable = new Set(recoveryCases.map(([status]) => status));
  for (let status = 400; status < 500; status += 1) {
    if (retryable.has(status)) continue;
    const { result, steps, errors } = simulateRequest(status, 1);
    await assert.rejects(result, (error) => error === errors[0], `HTTP ${status} must reject immediately`);
    assert.deepEqual(steps, ['call 0'], `HTTP ${status} must not wait or retry`);
  }
}

const tests = [
  ['returns the first successful result', () => expectRecovery(503, 0)],
  ['recovers after a connection failure without an HTTP status', () => expectRecovery(null, 1)],
  ...recoveryCases.map(([status, failuresBeforeSuccess]) => [
    `recovers after HTTP ${status}`,
    () => expectRecovery(status, failuresBeforeSuccess),
  ]),
  ['uses three attempts by default for persistent HTTP 503', () => expectExhaustion()],
  ...[1, 3, 4].map((attempts) => [
    `honors attempts: ${attempts} for persistent HTTP 503`,
    () => expectExhaustion(attempts),
  ]),
  ['rejects every non-retryable 4xx without waiting', expectRejectedClientErrors],
];

// An unresolved promise can let Node exit before the suite finishes.
process.exitCode = 1;
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
