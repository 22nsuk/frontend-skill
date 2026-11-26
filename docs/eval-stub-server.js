'use strict';

// Evaluator-only helper for docs/evaluation.md. Never copy it into the workspace under test.
// Serves a workspace on 127.0.0.1 and answers POST /api/bookings locally, so booking
// states can be observed without contacting any real service.
// Usage: node docs/eval-stub-server.js <workspace> [--status 201] [--delay 2000] [--port 47613]

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const workspace = args[0];
function usageError(message) {
  console.error(`${message}\nUsage: node docs/eval-stub-server.js <workspace> [--status N] [--delay MS] [--port N]`);
  process.exit(1);
}
if (!workspace?.trim() || workspace.startsWith('--') ||
    !fs.statSync(workspace, { throwIfNoEntry: false })?.isDirectory()) {
  usageError('Expected an existing workspace directory.');
}
const root = path.resolve(workspace);
const limits = new Map([
  ['--status', [200, 599]],
  ['--delay', [0, 2147483647]],
  ['--port', [0, 65535]],
]);
const options = new Map();
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  const equals = arg.indexOf('=');
  const flag = equals === -1 ? arg : arg.slice(0, equals);
  if (!limits.has(flag)) usageError(`Unknown argument: ${arg}`);
  if (options.has(flag)) usageError(`Duplicate option: ${flag}`);
  const raw = equals === -1 ? args[++i] : arg.slice(equals + 1);
  const value = Number(raw);
  const [min, max] = limits.get(flag);
  if (!/^\d+$/.test(raw ?? '') || value < min || value > max) {
    usageError(`${flag} expects an integer from ${min} to ${max}.`);
  }
  options.set(flag, value);
}
const status = options.get('--status') ?? 201;
const delay = options.get('--delay') ?? 2000;
const port = options.get('--port') ?? 47613;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
let bookings = 0;

function handleBooking(req, res) {
  const n = ++bookings;
  console.log(`#${n} POST /api/bookings`);
  function respond(code, payload) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
    console.log(`#${n} responded ${code}`);
  }

  const mediaType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    req.resume();
    respond(415, { error: 'Expected application/json' });
    return;
  }
  const chunks = [];
  const limit = 64 * 1024;
  let bytes = 0;
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes <= limit) chunks.push(chunk);
  });
  req.on('end', () => {
    if (bytes > limit) return respond(413, { error: 'Booking body too large' });
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return respond(400, { error: 'Invalid JSON' });
    }
    if (!['name', 'phone', 'date'].every((key) => typeof payload?.[key] === 'string' && payload[key].length > 0)) {
      return respond(400, { error: 'Expected name, phone and date as nonempty strings' });
    }
    setTimeout(() => respond(status, status < 400 ? { id: `stub-${n}` } : { error: 'stub failure' }), delay);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    handleBooking(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    console.log(`unexpected ${req.method} ${url.pathname}`);
    res.writeHead(405).end();
    return;
  }

  let file;
  try {
    file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}).listen(port, '127.0.0.1', function () {
  console.log(`serving ${root} at http://127.0.0.1:${this.address().port}/ (POST /api/bookings -> ${status} after ${delay} ms)`);
});
