'use strict';
/* Listeners bind once (sigonce-1.0.0, b1314). Found by a sweep for handlers
   re-added on every render to an element that survives the render:
   - the signature pad is re-initialised on every agreements ceremony show,
     every resize while it is up and every countersign open; each init bound
     six more canvas listeners and one more window mouseup, each with its own
     state, so one stroke was inked once per init and every mouseup anywhere
     re-ran the sign-state sync N times;
   - MLS Easy keeps the old DOM on a byte-identical repaint but re-ran its
     wiring, stacking another input handler on #ez3Note / #ez3Search;
   - the phone QR card added a window resize listener each time it re-showed.
   Real Chrome for the pad; source pins for the two property-based fixes. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');

/* Easy: the note and search inputs are wired by property, so a repeat wire replaces */
assert.ok(/ta\.oninput = function \(\) \{/.test(CONNECT), '#ez3Note is wired with oninput');
assert.ok(/if \(inp\) inp\.oninput = function \(\) \{/.test(CONNECT), '#ez3Search is wired with oninput');
assert.ok(!/var ta = \$\('ez3Note'\);[\s\S]{0,200}ta\.addEventListener\('input'/.test(CONNECT), '#ez3Note no longer stacks addEventListener input handlers');
/* phone card: its resize listener is registered once */
assert.ok(/if \(resizeWired\) return;\s*resizeWired = true;/.test(SHELL), 'the phone card registers its resize listener once');

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  try {
    const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/ScribeFlow.html?preview=1');
    await pg.waitForFunction(() => typeof window.sigPadInit === 'function' && !!document.getElementById('agSigPad'), null, { timeout: 60000 });

    const pad = await pg.evaluate(() => {
      for (let i = 0; i < 5; i++) sigPadInit('agSigPad');
      const st = _sigPads.agSigPad; let strokes = 0, synced = 0;
      const real = st.ctx.stroke.bind(st.ctx); st.ctx.stroke = function () { strokes++; return real(); };
      st.onstroke = () => { synced++; };
      const cv = document.getElementById('agSigPad');
      const fire = (t, x, y, on) => (on || cv).dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      fire('mousedown', 10, 10); fire('mousemove', 20, 12); fire('mousemove', 30, 14); fire('mouseup', 30, 14, window);
      const afterStroke = { strokes, synced, empty: sigPadIsEmpty('agSigPad') };
      fire('mouseup', 5, 5, window); /* a mouseup elsewhere with no stroke in progress */
      return { afterStroke, idleSync: synced - afterStroke.synced };
    });
    assert.deepStrictEqual(pad.afterStroke, { strokes: 2, synced: 1, empty: false }, 'after five inits one two-segment stroke inks two segments and syncs once: ' + JSON.stringify(pad));
    assert.strictEqual(pad.idleSync, 0, 'a mouseup with no stroke in progress does not re-sync the pad');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS listeners bind once: the signature pad inks and syncs once per stroke however often it is re-initialised, MLS Easy wires its note and search inputs by property, and the phone card registers one resize listener');
  } finally { await b.close(); srv.close(); }
});
