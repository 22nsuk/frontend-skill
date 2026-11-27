'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const test = require('node:test');

const script = path.resolve(__dirname, '../docs/eval-stub-server.js');
const fixture = path.resolve(__dirname, '../docs/eval-fixture');

async function startServer(t, workspace, options) {
  const server = spawn(process.execPath, [script, workspace, ...options]);
  const lines = createInterface({ input: server.stdout });
  t.after(() => { lines.close(); server.kill(); });
  const [ready] = await once(lines, 'line');
  return ready.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
}

test('refuses to serve without an explicit workspace directory', () => {
  for (const args of [[], [''], ['--port', '0'], [script], [path.join(fixture, 'missing')]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /existing workspace directory/);
  }
});

test('rejects invalid options before serving the workspace', () => {
  const cases = [
    [['--port', '0', '--stats', '503'], /--stats/],
    [['--status'], /--status/],
    [['--status', '--delay', '0'], /--status/],
    [['--delay', 'two-seconds'], /--delay/],
    [['--delay=-1'], /--delay/],
    [['--delay=2147483648'], /--delay/],
    [['--status=503.5'], /--status/],
    [['--status=199'], /--status/],
    [['--status=600'], /--status/],
    [['--port=65536'], /--port/],
    [['--status', '201', '--status=503'], /--status/],
    [['extra'], /extra/],
  ];
  for (const [args, diagnostic] of cases) {
    const result = spawnSync(process.execPath, [script, fixture, ...args], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1, `expected ${args.join(' ')} to fail before listening`);
    assert.match(result.stderr, diagnostic);
    assert.doesNotMatch(result.stdout, /serving /);
  }
});

test('serves static files only within the resolved workspace', { timeout: 8000 }, async (t) => {
  const tempRoot = await fs.realpath(os.tmpdir());
  const temp = await fs.mkdtemp(path.join(tempRoot, 'frontend-stub-'));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(temp)), tempRoot);
    await fs.rm(temp, { recursive: true, force: true });
  });
  const workspace = path.join(temp, 'site');
  const assets = path.join(workspace, 'assets');
  const sibling = path.join(temp, 'site-other');
  await fs.mkdir(assets, { recursive: true });
  await fs.mkdir(sibling);
  await fs.writeFile(path.join(sibling, 'empty.css'), '');
  await fs.writeFile(path.join(assets, 'theme.css'), 'body { color: navy; }');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(assets, path.join(workspace, 'theme'), linkType);
  await fs.symlink(sibling, path.join(workspace, 'other'), linkType);

  const origin = await startServer(t, workspace, ['--port', '0']);
  for (const directory of ['assets', 'theme']) {
    const response = await fetch(`${origin}/${directory}/theme.css`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/css/);
    assert.equal(await response.text(), 'body { color: navy; }');
  }
  for (const method of ['GET', 'HEAD']) {
    const denied = await fetch(`${origin}/other/empty.css`, { method });
    assert.equal(denied.status, 403);
    assert.equal(await denied.text(), '');
  }
  const head = await fetch(`${origin}/theme/theme.css`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${origin}/missing.css`)).status, 404);
});

for (const status of [201, 503]) {
  test(`only valid JSON bookings receive the configured ${status} response`, { timeout: 8000 }, async (t) => {
    const options = status === 201
      ? ['--port', '0', '--delay', '0', '--status', String(status)]
      : ['--port=0', '--delay=0', `--status=${status}`];
    const origin = await startServer(t, fixture, options);
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
