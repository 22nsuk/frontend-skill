'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { createInterface } = require('node:readline');
const test = require('node:test');

const script = path.resolve(__dirname, '../docs/eval-stub-server.js');
const fixture = path.resolve(__dirname, '../docs/eval-fixture');

test('refuses to serve without an explicit workspace directory', () => {
  for (const args of [[], [''], ['--port', '0'], [script], [path.join(fixture, 'missing')]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /existing workspace directory/);
  }
});

for (const status of [201, 503]) {
  test(`only valid JSON bookings receive the configured ${status} response`, { timeout: 8000 }, async (t) => {
    const server = spawn(process.execPath, [script, fixture, '--port', '0', '--delay', '0', '--status', String(status)]);
    const lines = createInterface({ input: server.stdout });
    t.after(() => { lines.close(); server.kill(); });
    const [ready] = await once(lines, 'line');
    const origin = ready.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const fields = { name: '예시', phone: '000', date: '2027-01-01' };
    const cases = [
      ['application/x-www-form-urlencoded', new URLSearchParams(fields).toString(), 415],
      ['application/json', '{', 400],
      ['application/json', 'null', 400],
      ['application/json', JSON.stringify({ ...fields, phone: '' }), 400],
      ['application/json', JSON.stringify({ ...fields, date: 1 }), 400],
      ['application/json', ' '.repeat(65537), 413],
      ['application/json; charset=utf-8', JSON.stringify(fields), status],
    ];
    for (const [type, body, expected] of cases) {
      const response = await fetch(`${origin}/api/bookings`, { method: 'POST', headers: { 'Content-Type': type }, body });
      assert.equal(response.status, expected, `${type}, expected ${expected}`);
      const result = await response.json();
      if (expected === 201) assert.ok(result.id);
      else assert.ok(result.error);
    }
  });
}
