'use strict';

// Evaluator-only helper for docs/evaluation.md. Never copy it into the workspace under test.
// Serves a workspace on 127.0.0.1 and answers POST /api/bookings locally, so booking
// states can be observed without contacting any real service.
// Usage: node docs/eval-stub-server.js <workspace> [--status 201] [--delay 2000] [--port 47613]

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const root = path.resolve(args[0] || '.');
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(args[index + 1]);
};
const status = option('status', 201);
const delay = option('delay', 2000);
const port = option('port', 47613);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
let bookings = 0;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    req.resume();
    req.on('end', () => {
      const n = ++bookings;
      console.log(`#${n} POST /api/bookings`);
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(status < 400 ? { id: `stub-${n}` } : { error: 'stub failure' }));
        console.log(`#${n} responded ${status}`);
      }, delay);
    });
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
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/ (POST /api/bookings -> ${status} after ${delay} ms)`);
});
