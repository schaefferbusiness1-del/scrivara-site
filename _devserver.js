/* local static server for UI verification only — not shipped, not committed */
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch (e) { p = '/'; }
  if (p === '/') p = '/ScribeFlow.html';
  const file = path.join(root, p.replace(/^\/+/, ''));
  if (!file.startsWith(root)) { res.writeHead(403).end('no'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(45231, '127.0.0.1', () => console.log('serving ' + root + ' on http://127.0.0.1:45231'));
