'use strict';

// Run from a quiet machine with a prebuilt release binary; preparation and checks are untimed.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

if (process.argv.length !== 3) {
  console.error('Usage: node scripts/benchmark-workspace-snapshot.js <Rust release executable>');
  process.exit(2);
}
const rust = path.resolve(process.argv[2]);
const warmups = 3;
const samples = 15;
const processOptions = { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 };
const cleanReport = 'No differences in entries, file contents or link targets (root .git excluded).\n';

function run(args, status = 0) {
  const start = performance.now();
  const res = spawnSync(rust, args, processOptions);
  const elapsed = performance.now() - start;
  if (res.error) throw res.error;
  assert.equal(res.status, status, args.join(' ') + '\n' + (res.signal || res.stderr));
  assert.equal(res.stderr, '');
  return { elapsed, stdout: res.stdout };
}

function readRecord(file) {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(new Date(record.recordedAt).toISOString(), record.recordedAt);
  return record;
}

function measure(label, args, verify, status = 0) {
  const times = [];
  for (let i = 0; i < warmups + samples; i++) {
    const result = run(args, status);
    verify(result.stdout);
    if (i >= warmups) times.push(result.elapsed);
  }
  const median = times.sort((a, b) => a - b)[Math.floor(samples / 2)];
  console.log('Rust ' + label + ': ' + median.toFixed(2) + ' ms');
}

function writeSnapshot(file, snapshot) {
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 1) + '\n');
}

function byPath(left, right) {
  if (left.path === right.path) return 0;
  return left.path < right.path ? -1 : 1;
}

function fileEntry(relativePath, content) {
  return {
    path: relativePath,
    type: 'file',
    size: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function editFiles(entries, edits) {
  const after = [];
  const report = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const entry of entries) {
    switch (edits.get(entry.path)) {
      case 'change': {
        const replacement = fileEntry(entry.path, 'snapshot benchmark updated ' + entry.path);
        after.push(replacement);
        report.push({
          path: entry.path,
          line: `changed file ${JSON.stringify(entry.path)} (content, ${entry.size} -> ${replacement.size} bytes)`,
        });
        changed++;
        break;
      }
      case 'remove':
        report.push({ path: entry.path, line: 'removed file ' + JSON.stringify(entry.path) });
        removed++;
        break;
      case 'copy': {
        const addition = { ...entry, path: entry.path + '.benchmark-added' };
        after.push(entry, addition);
        report.push({ path: addition.path, line: 'added file ' + JSON.stringify(addition.path) });
        added++;
        break;
      }
      default:
        after.push(entry);
    }
  }
  const lines = report.sort(byPath).map(entry => entry.line);
  lines.push(`${added} added, ${removed} removed, ${changed} changed`);
  return { entries: after.sort(byPath), stdout: lines.join('\n') + '\n', status: 1 };
}

function measureComparisons(evidence, baseline) {
  const files = baseline.entries.filter(entry => entry.type === 'file');
  assert.ok(files.length >= 3, 'comparison inputs need at least three files');
  const sparse = new Map([
    [files[0].path, 'change'],
    [files[Math.floor(files.length / 2)].path, 'remove'],
    [files.at(-1).path, 'copy'],
  ]);
  // Rewrite every file in place. Directory entries have no content field in v1.
  const dense = new Map(files.map(entry => [entry.path, 'change']));
  // Fix the timestamp so every pair satisfies the v1 requirement for a later record.
  const recordedAt = new Date(Date.parse(baseline.recordedAt) + 1).toISOString();
  const first = path.join(evidence, 'before.json');
  const cases = [
    ['clean', { entries: baseline.entries, stdout: cleanReport, status: 0 }],
    ['sparse', editFiles(baseline.entries, sparse)],
    ['dense', editFiles(baseline.entries, dense)],
  ];
  for (const [name, { entries, stdout, status }] of cases) {
    const last = path.join(evidence, name + '.json');
    writeSnapshot(last, { ...baseline, recordedAt, entries });
    measure('compare (' + name + ')', ['compare', first, last], output => {
      assert.equal(output, stdout, name + ' comparison stdout');
    }, status);
  }
}

function measureWorkspace(workspace, temp) {
  const name = path.basename(workspace);
  const evidence = fs.mkdtempSync(path.join(temp, name + '-evidence-'));
  const first = path.join(evidence, 'before.json');
  run(['record', workspace, first]);
  const baseline = readRecord(first);
  const target = path.join(evidence, 'sample.json');
  console.log(name + ' (' + baseline.entries.length + ' entries)');
  measure('record', ['record', workspace, target], stdout => {
    const sample = readRecord(target);
    assert.deepEqual(sample, { ...baseline, recordedAt: sample.recordedAt });
    assert.ok(stdout.startsWith(`Recorded ${baseline.entries.length} entries from `), stdout);
    fs.unlinkSync(target);
  });
  measureComparisons(evidence, baseline);
}

function measureLargeSnapshots(temp) {
  const name = 'large-compare-only';
  const evidence = path.join(temp, name);
  fs.mkdirSync(evidence);
  const entries = [];
  for (let i = 0; i < 100; i++) {
    // These last two package names sort differently in UTF-16 and UTF-8.
    const suffix = i === 98 ? '\u{10000}' : i === 99 ? '\ue000' : String(i).padStart(2, '0');
    const group = 'package-' + suffix;
    const directory = group + '/src/assets';
    for (const relativePath of [group, group + '/src', directory]) {
      entries.push({ path: relativePath, type: 'dir' });
    }
    for (let n = 0; n < 300; n++) {
      const relativePath = directory + '/resource-' + String(n).padStart(3, '0') + '.js';
      entries.push(fileEntry(relativePath, 'export default ' + JSON.stringify(relativePath) + ';\n'));
    }
  }
  const baseline = {
    format: 'eval-workspace-snapshot/1',
    root: path.join(temp, 'large-workspace'),
    recordedAt: '2000-01-01T00:00:00.000Z',
    entries: entries.sort(byPath),
  };
  writeSnapshot(path.join(evidence, 'before.json'), baseline);
  console.log(name + ' (' + baseline.entries.length + ' entries)');
  measureComparisons(evidence, baseline);
}

const tempRoot = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempRoot, 'snapshot-benchmark-'));
try {
  const fixture = path.join(temp, 'eval-fixture');
  fs.cpSync(path.join(__dirname, '../docs/eval-fixture'), fixture, { recursive: true });
  const generated = path.join(temp, 'generated');
  const block = Buffer.alloc(4096, 0x61);
  for (let dir = 0; dir < 10; dir++) {
    const group = path.join(generated, String(dir));
    fs.mkdirSync(group, { recursive: true });
    for (let n = 0; n < 100; n++) fs.writeFileSync(path.join(group, n + '.bin'), block);
  }
  fs.writeFileSync(path.join(generated, 'large.bin'), Buffer.alloc(16 * 1024 * 1024, 0x62));
  console.log(process.platform, process.arch, 'Node benchmark driver ' + process.version,
    samples + ' runs after ' + warmups + ' warmups');
  measureWorkspace(fixture, temp);
  measureWorkspace(generated, temp);
  measureLargeSnapshots(temp);
} finally {
  assert.equal(path.dirname(fs.realpathSync.native(temp)), tempRoot);
  fs.rmSync(temp, { recursive: true, force: true });
}
