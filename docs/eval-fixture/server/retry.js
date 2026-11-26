'use strict';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(operation, options = {}) {
  const attempts = options.attempts ?? 3;
  const wait = options.wait ?? ((attempt) => delay(200 * 2 ** attempt));
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(attempt);
    }
  }

  throw lastError;
}

module.exports = { withRetry, RETRYABLE_STATUS };
