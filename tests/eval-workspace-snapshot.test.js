'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.resolve(__dirname, '../scripts/eval-workspace-snapshot.js');
const linkType = process.platform === 'win32' ? 'junction' : 'dir';

function snapshot(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
}

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function setup(t) {
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempRoot, 'workspace-snapshot-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync.native(temp)), tempRoot);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const workspace = path.join(temp, 'site');
  const evidence = path.join(temp, 'evidence');
  fs.mkdirSync(path.join(workspace, 'data'), { recursive: true });
  fs.mkdirSync(evidence);
  const write = (file, data) => fs.writeFileSync(path.join(workspace, file), data);
  write('.gitignore', '*.log\nbuild/\n');
  write('index.html', '<h1>Before</h1>\n');
  write('styles.css', 'body { color: navy; }\n');
  write('data/requests.csv', 'month,count\n2024-01,42\n');
  write('debug.log', 'ignored before\n');
  return { temp, workspace, evidence, write, record: (name) => snapshot('record', workspace, path.join(evidence, name)) };
}

test('reports added, removed and changed entries that git status cannot see', (t) => {
  const { workspace, evidence, write, record } = setup(t);
  git(workspace, 'init', '-q');
  git(workspace, 'add', '-A');
  git(workspace, '-c', 'user.name=baseline', '-c', 'user.email=baseline@localhost', '-c', 'commit.gpgsign=false',
    'commit', '-qm', 'baseline');
  fs.mkdirSync(path.join(workspace, 'vendor/.git'), { recursive: true });
  write('vendor/.git/config', '[core]\n');
  assert.equal(record('before.json').status, 0);

  // Same size and timestamp, different bytes: only content hashing can notice this.
  const css = path.join(workspace, 'styles.css');
  const { mtime } = fs.statSync(css);
  write('styles.css', 'body { color: plum; }\n');
  fs.utimesSync(css, mtime, mtime);
  write('debug.log', 'ignored after!\n');
  fs.mkdirSync(path.join(workspace, 'build'));
  write('build/capture.png', 'not really a png');
  fs.rmSync(path.join(workspace, 'data/requests.csv'));
  write('vendor/.git/config', '[core]\n\tbare = true\n');
  // The evaluator's own Git commands rewrite the root admin state after the run.
  fs.writeFileSync(path.join(workspace, '.git/evaluator-note'), 'index refreshed');
  const status = git(workspace, 'status', '--porcelain', '--untracked-files=all');
  assert.doesNotMatch(status, /debug\.log|build\//, 'ignored changes must be invisible to git status here');

  const after = record('after.json');
  assert.equal(after.status, 0, after.stderr);
  const result = snapshot('compare', path.join(evidence, 'before.json'), path.join(evidence, 'after.json'));
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    'added dir "build"',
    'added file "build/capture.png"',
    'removed file "data/requests.csv"',
    'changed file "debug.log" (content, 15 -> 15 bytes)',
    'changed file "styles.css" (content, 22 -> 22 bytes)',
    'changed file "vendor/.git/config" (content, 7 -> 20 bytes)',
    '2 added, 1 removed, 3 changed',
  ]);
});

test('reports no differences only for an unchanged workspace in two separate records', (t) => {
  const { workspace, evidence, record } = setup(t);
  assert.equal(record('before.json').status, 0);
  fs.readFileSync(path.join(workspace, 'index.html'));
  assert.equal(record('after.json').status, 0);
  const before = path.join(evidence, 'before.json');
  const clean = snapshot('compare', before, path.join(evidence, 'after.json'));
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /^No differences/);

  // Comparing one record with itself, or in reverse, would hide changes made during the run.
  for (const args of [[before, before], [path.join(evidence, 'after.json'), before]]) {
    const result = snapshot('compare', ...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /after snapshot must be a separate record/);
    assert.equal(result.stdout, '');
  }
});

test('records links without following them outside the workspace', (t) => {
  const { temp, workspace, evidence, record } = setup(t);
  const outside = path.join(temp, 'outside');
  const other = path.join(temp, 'other');
  fs.mkdirSync(outside);
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside before');
  const link = path.join(workspace, 'shared');
  fs.symlinkSync(outside, link, linkType);
  assert.equal(record('before.json').status, 0);
  const recorded = JSON.parse(fs.readFileSync(path.join(evidence, 'before.json'), 'utf8'));
  assert.equal(recorded.entries.find((entry) => entry.path === 'shared')?.type, 'symlink');
  assert.ok(!recorded.entries.some((entry) => entry.path.startsWith('shared/')));

  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside after');
  assert.equal(record('outside-edit.json').status, 0);
  const unchanged = snapshot('compare', path.join(evidence, 'before.json'), path.join(evidence, 'outside-edit.json'));
  assert.equal(unchanged.status, 0, unchanged.stdout);

  fs.rmSync(link);
  fs.symlinkSync(other, link, linkType);
  assert.equal(record('retargeted.json').status, 0);
  const retargeted = snapshot('compare', path.join(evidence, 'before.json'), path.join(evidence, 'retargeted.json'));
  assert.equal(retargeted.status, 1);
  assert.match(retargeted.stdout, /^changed symlink "shared" \(target .*outside.* -> .*other.*\)$/m);
});

test('rejects records inside the workspace and malformed requests without writing', (t) => {
  const { temp, workspace, evidence, record } = setup(t);
  const intoWorkspace = path.join(temp, 'into-workspace');
  fs.symlinkSync(workspace, intoWorkspace, linkType);
  const listing = () => fs.readdirSync(workspace).sort();
  const before = listing();
  for (const target of [path.join(workspace, 'snapshot.json'), path.join(intoWorkspace, 'data', 'snapshot.json')]) {
    const result = snapshot('record', workspace, target);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /outside the workspace/);
  }
  assert.deepEqual(listing(), before);
  assert.deepEqual(fs.readdirSync(path.join(workspace, 'data')), ['requests.csv']);

  assert.equal(record('before.json').status, 0);
  const kept = fs.readFileSync(path.join(evidence, 'before.json'), 'utf8');
  const existing = record('before.json');
  assert.equal(existing.status, 2);
  assert.match(existing.stderr, /already exists/);
  assert.equal(fs.readFileSync(path.join(evidence, 'before.json'), 'utf8'), kept);

  const otherWorkspace = path.join(temp, 'site-other');
  fs.mkdirSync(otherWorkspace);
  assert.equal(snapshot('record', otherWorkspace, path.join(evidence, 'other.json')).status, 0);
  fs.writeFileSync(path.join(evidence, 'broken.json'), '{"format":"eval-workspace-snapshot/1"}');
  const cases = [
    [['record', path.join(temp, 'missing'), path.join(evidence, 'x.json')], /existing workspace directory/],
    [['record', workspace, path.join(temp, 'missing', 'x.json')], /directory must already exist/],
    [['compare', path.join(evidence, 'before.json'), path.join(evidence, 'other.json')], /different workspaces/],
    [['compare', path.join(evidence, 'before.json'), path.join(evidence, 'broken.json')], /Not a workspace snapshot/],
    [['compare', path.join(evidence, 'before.json'), path.join(evidence, 'absent.json')], /Cannot read snapshot/],
    [['compare', path.join(evidence, 'before.json')], /Usage:/],
    [['diff', workspace, workspace], /Usage:/],
  ];
  for (const [args, diagnostic] of cases) {
    const result = snapshot(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, diagnostic);
  }
  assert.ok(!fs.existsSync(path.join(evidence, 'x.json')));
});
