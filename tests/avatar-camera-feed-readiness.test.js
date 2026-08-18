'use strict';

/*
 * THE CAMERA PREVIEW WAS MEASURED BEFORE IT EXISTED (owner report, 2026-08-17)
 * ===========================================================================
 * The picture-to-avatar camera preview showed BLACK, and the matcher then
 * reported "3 of 14" and "Skin — the sample was not a colour real skin has".
 * The matcher was right: it was refusing an image with no light in it. What
 * was wrong sat one layer below it — nothing had ever established that the
 * camera had delivered a frame.
 *
 * The mechanism, and the reason a fake DOM can prove it: a <video> carrying a
 * MediaStream reports videoWidth/videoHeight from `loadedmetadata`, i.e. from
 * readyState 1, while CanvasRenderingContext2D.drawImage is specified to
 * "return without drawing anything" until readyState reaches HAVE_CURRENT_DATA
 * (2). captureSquare's only precondition is videoWidth/videoHeight. So between
 * those two moments the analysis canvas stayed at its initial transparent
 * black, frameQuality measured exposure 0 on it, and faceReadPortrait was
 * handed a black square — and every word the doctor read after that was a true
 * statement about an image the camera never sent.
 *
 * THE FAKE CANVAS IN THIS FILE MODELS EXACTLY THAT RULE and nothing else: its
 * drawImage copies the source's luminance only when readyState >= 2, and
 * leaves the canvas at 0 otherwise. Every assertion below rides on the real
 * sliced source — captureSquare, faceCaptureVerdict, grabBestFrame, the whole
 * live-view block and the real camera-open click handler — driven through a
 * virtual clock, a fake navigator.mediaDevices.getUserMedia and a fake <video>
 * whose readyState/videoWidth advance on that clock.
 *
 * WHAT THIS PINS
 *   1. no capture and no matcher call before the first DECODED frame;
 *   2. an all-zero-luminance frame never reaches faceReadPortrait, on either
 *      the live path or the shutter path;
 *   3. the readiness state transitions opening -> waiting -> warming -> live,
 *      and the shutter is disabled for every state that is not live;
 *   4. a feed that never delivers is explained in words that name an action,
 *      and never with lighting advice;
 *   5. every getUserMedia rejection is named honestly — NotReadableError is a
 *      busy camera, not a declined permission;
 *   6. the match gate (`examined >= 10 && claimed >= 6`) and the four
 *      dead-feed luminance literals are unchanged and equal.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_avatar.js'), 'utf8');
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }
function between(src, first, last) {
  const a = src.indexOf(first), b = src.indexOf(last, a);
  if (a < 0 || b <= a) throw new Error('missing source boundary: ' + first);
  return src.slice(a, b);
}

/* ---- 1. THE SAFETY LINES THIS CHANGE MAY NOT CROSS ---------------------- */

ok(/examined >= 10 && claimed >= 6 && hasIdentityPalette/.test(source),
  'the avatar match gate is no longer `examined >= 10 && claimed >= 6` — a black-feed repair may not weaken the gate that CORRECTLY refused the black feed');

const deadExposure = Number((source.match(/var DEAD_FEED_EXPOSURE = ([\d.]+);/) || [])[1]);
const darkExposure = Number((source.match(/var DARK_TICKS = \d+, DARK_EXPOSURE = ([\d.]+);/) || [])[1]);
const avcamExposure = Number((source.match(/var AVCAM_DEAD_EXPOSURE = ([\d.]+);/) || [])[1]);
const avcamSharp = Number((source.match(/var AVCAM_DEAD_SHARP = ([\d.]+);/) || [])[1]);
const grabSlice = between(source, 'function grabBestFrame', '/* ---- LIVE CAPTURE VIEW');
const grabLiterals = grabSlice.match(/var lit = Number\(q && q\.exposure\) > ([\d.]+) \|\| Number\(q && q\.sharp\) > ([\d.]+);/);
ok(grabLiterals, 'grabBestFrame no longer carries its own dead-frame literals, so the shutter can run the matcher on a black frame again');
ok(deadExposure > 0 && darkExposure > 0 && avcamExposure > 0, 'a dead-feed luminance threshold went missing or to zero');
eq(avcamExposure, deadExposure, 'AVCAM_DEAD_EXPOSURE drifted from faceCaptureVerdict\'s DEAD_FEED_EXPOSURE');
eq(avcamExposure, darkExposure, 'AVCAM_DEAD_EXPOSURE drifted from faceLiveLoopStart\'s DARK_EXPOSURE');
eq(Number(grabLiterals[1]), avcamExposure, 'grabBestFrame\'s exposure literal drifted from AVCAM_DEAD_EXPOSURE');
eq(Number(grabLiterals[2]), avcamSharp, 'grabBestFrame\'s texture literal drifted from AVCAM_DEAD_SHARP');

/* The preview may not go back to requestAnimationFrame: it does not fire at
   all in a hidden or non-compositing tab, which is exactly the state that
   produces a black picture and silences the witness. */
const liveSlice = between(source, 'function faceLiveLoopStart(video, overlay, ui)', '/* ---- end live capture view');
ok(!/requestAnimationFrame\s*\(/.test(liveSlice),
  'the live preview loop CALLS requestAnimationFrame again — it does not fire in a hidden or non-compositing tab, so the dead-feed witness sleeps in the exact state it exists to report');
ok(/setTimeout\(tick, LIVE_MS\)/.test(liveSlice), 'the live preview loop no longer re-arms itself on a timer');
ok(!/setInterval\s*\(/.test(liveSlice), 'the live preview loop arms a permanent interval');

/* ---- 2. THE HARNESS ----------------------------------------------------- */

/* A virtual clock. Everything below — the first-frame poll, the 8Hz live
   loop, the best-of-six step — rides setTimeout, so the whole feed is
   observable one millisecond at a time and nothing depends on wall time. */
function makeClock() {
  let now = 0, seq = 0;
  const queue = [];
  return {
    now: () => now,
    setTimeout(fn, ms) { const t = { id: ++seq, at: now + (Number(ms) || 0), fn }; queue.push(t); return t.id; },
    clearTimeout(id) { const i = queue.findIndex(t => t.id === id); if (i >= 0) queue.splice(i, 1); },
    pending: () => queue.length,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        queue.sort((a, b) => (a.at - b.at) || (a.id - b.id));
        const t = queue[0];
        if (!t || t.at > target) break;
        queue.shift(); now = t.at;
        t.fn();
      }
      now = target;
    }
  };
}

function makeNode(tag) {
  const node = {
    tagName: String(tag || '').toUpperCase(), className: '', textContent: '', type: '',
    disabled: false, isConnected: true, children: [], style: {}, attrs: {},
    listeners: {}, readyState: 0, videoWidth: 0, videoHeight: 0, paused: true,
    srcObject: null, __lum: 0,
    setAttribute(k, v) { node.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(node.attrs, k) ? node.attrs[k] : null; },
    addEventListener(type, fn) { (node.listeners[type] = node.listeners[type] || []).push(fn); },
    removeEventListener() {},
    fire(type, ev) { (node.listeners[type] || []).slice().forEach(fn => fn(ev || {})); },
    appendChild(child) { node.children.push(child); child.parent = node; return child; },
    insertBefore(child, ref) {
      const at = node.children.indexOf(ref);
      node.children.splice(at < 0 ? node.children.length : at, 0, child);
      child.parent = node; return child;
    },
    click() { node.fire('click', {}); }
  };
  /* innerHTML = '' is how this module empties a host; nothing else is used */
  Object.defineProperty(node, 'innerHTML', {
    get() { return ''; },
    set(v) { if (String(v) === '') node.children.length = 0; }
  });
  /* the whole rendered subtree as text, for reading what the doctor is told */
  Object.defineProperty(node, 'allText', {
    get() {
      return [String(node.textContent || '')]
        .concat(node.children.map(c => c.allText)).join(' | ');
    }
  });
  return node;
}

/* THE ONE RULE THAT MATTERS: drawImage draws nothing until readyState >= 2.
   A canvas that was never drawn into keeps its initial transparent black,
   which is luminance 0 — the exact frame the matcher was being handed. */
function makeCanvas() {
  const canvas = makeNode('canvas');
  canvas.width = 0; canvas.height = 0; canvas.__lum = 0; canvas.__drawn = 0;
  canvas.getContext = () => ({
    lineWidth: 0, strokeStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: '',
    drawImage(src) {
      canvas.__drawn++;
      const decoded = Number(src && src.readyState) >= 2;
      canvas.__lum = decoded ? Number(src && src.__lum) || 0 : 0;
    },
    clearRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
  });
  return canvas;
}

function buildModule(env) {
  const body = [
    'var MEASURE_MAX = 1024;',
    between(source, 'var cameraStream = null', '/* ---- THE PHOTO'),
    between(source, 'function captureSquare(video, out, into)', '/* p1-photo-upload-1.0.0'),
    between(source, 'function faceCaptureVerdict', '/* BEST OF SEVERAL FRAMES'),
    grabSlice,
    between(source, '/* ===== avcam-1.0.0 — A FEED IS PROVEN', '/* ---- end live capture view'),
    between(source, "camBtn.addEventListener('click'", '/* ---- UPLOAD A PHOTO'),
    'return { faceLiveLoopStart: faceLiveLoopStart, faceLiveMeasure: faceLiveMeasure,',
    '  faceCaptureVerdict: faceCaptureVerdict, grabBestFrame: grabBestFrame,',
    '  avcamFrameLooksLive: avcamFrameLooksLive, avcamOpenWhy: avcamOpenWhy,',
    '  avcamAwaitFirstFrame: avcamAwaitFirstFrame, avcamWaitingLine: avcamWaitingLine,',
    '  AVCAM_LIVE_FRAMES: AVCAM_LIVE_FRAMES, AVCAM_FIRST_FRAME_MS: AVCAM_FIRST_FRAME_MS };'
  ].join('\n');
  const names = Object.keys(env);
  return new Function(...names, body)(...names.map(n => env[n]));
}

/* One complete camera surface: the real click handler, the real live view,
   the real verdict, a fake device and a virtual clock. */
function openCamera(options) {
  const opts = options || {};
  const clock = makeClock();
  const seen = { matcher: [], accepted: [], gum: [], playCalls: 0 };
  const win = {};
  const video = makeNode('video');
  video.play = () => { seen.playCalls++; if (opts.playRejects) return Promise.reject({ name: 'NotAllowedError' }); video.paused = false; return Promise.resolve(); };
  const track = {
    readyState: opts.trackReadyState || 'live', muted: opts.trackMuted === true, enabled: opts.trackEnabled !== false,
    stop() { track.readyState = 'ended'; },
    addEventListener(type, fn) { (track.listeners[type] = track.listeners[type] || []).push(fn); },
    listeners: {}
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  let gumCall = 0;
  const document = {
    createElement(tag) {
      if (tag === 'canvas') return makeCanvas();
      if (tag === 'video') return video;
      return makeNode(tag);
    }
  };
  const camHost = makeNode('div');
  const camBtn = makeNode('button');
  const env = {
    document, window: win, navigator: {
      mediaDevices: {
        getUserMedia(constraints) {
          gumCall++;
          seen.gum.push(constraints);
          const answer = opts.gum ? opts.gum(gumCall, constraints) : { ok: true };
          if (answer && answer.reject) return Promise.reject(answer.reject);
          return Promise.resolve(stream);
        }
      }
    },
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    isFn(f) { return typeof f === 'function'; },
    make(tag, className, textValue) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (textValue != null) node.textContent = textValue;
      return node;
    },
    setupCurrent() { return true; },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    /* the two measurement fakes. frameQuality reads the luminance the fake
       canvas actually carries, so a frame that drawImage refused to paint
       measures exactly 0 — which is what the real one does on a black square. */
    frameQuality(canvas) {
      const lum = Number(canvas && canvas.__lum) || 0;
      return { exposure: lum, sharp: lum > 0 ? 5 : 0 };
    },
    faceReadPortrait(canvas) {
      const lum = Number(canvas && canvas.__lum) || 0;
      seen.matcher.push(lum);
      return { look: { skin: '#f0c8a0', hair: '#241a12' }, derived: ['skin', 'hair'],
        refused: [], found: [],
        box: { grid: 128, L: 30, R: 98, T: 20, B: 110, cx: 64, eyeY: 55, skinSpots: [], patchR: 2 },
        receipt: { grid: 128, faceW: 60, claimed: 8, examined: 14, refused: 6 } };
    },
    acceptPortrait(o) { seen.accepted.push(o); },
    camBtn, camHost,
    cancelAnimationFrame() {}, requestAnimationFrame() { return 0; }
  };
  const api = buildModule(env);
  camBtn.click();
  function node(cls) {
    const hit = [];
    (function walk(n) { if (n.className === cls) hit.push(n); n.children.forEach(walk); })(camHost);
    return hit[0] || null;
  }
  return {
    api, clock, seen, video, track, stream, camHost, camBtn, win,
    status: () => { const n = node('mlsAvLiveLine'); return n ? String(n.textContent) : ''; },
    list: () => { const n = node('mlsAvLiveList'); return n ? String(n.allText) : ''; },
    snap: () => { const n = node('mlsAvAction primary'); return n; },
    notices: () => camHost.children.filter(c => c.className === 'mlsAvNotice').map(c => c.allText).join(' || '),
    state: () => (win.__mlsAvCam || {}).state,
    feed: () => win.__mlsAvCam || {}
  };
}

const settle = () => new Promise(r => setImmediate(r));

/* ---- 3. THE DEFECT: METADATA IS NOT A FRAME ----------------------------- */

(async () => {
  {
    const cam = openCamera({});
    await settle();
    eq(cam.state(), 'waiting', 'the feed does not report that it is waiting for its first frame');
    /* the exact trap: dimensions arrive a whole readyState before pixels do */
    cam.video.readyState = 1; cam.video.videoWidth = 1280; cam.video.videoHeight = 720; cam.video.__lum = 140;
    cam.clock.advance(1000);
    eq(cam.seen.matcher.length, 0,
      'the matcher ran on a <video> that had metadata but no decoded frame — this is the owner\'s black preview: drawImage paints nothing below readyState 2, so the matcher was reading a transparent-black canvas');
    eq(cam.state(), 'waiting', 'metadata alone moved the readiness state off "waiting"');
    eq(cam.snap().disabled, true, 'the shutter is live while the camera has sent no picture');
    eq(cam.status(), 'Waiting for the first camera frame…', 'the guide claims to be looking for a face before a frame exists');

    /* the first decoded frame arrives */
    cam.video.readyState = 2;
    cam.clock.advance(120);
    eq(cam.state(), 'warming', 'a decoded frame did not move the readiness state to warming');
    eq(cam.snap().disabled, true, 'the shutter opened on the first frame instead of on a proven feed');

    cam.clock.advance(125);
    eq(cam.seen.matcher.length, 1, 'the live guide did not read the first decoded frame');
    eq(cam.seen.matcher[0], 140, 'the matcher was handed something other than the decoded frame');
    eq(cam.state(), 'warming', 'one lit frame was treated as a proven feed');
    eq(cam.feed().matcherAllowed, false, 'the matcher was allowed to speak after a single frame');
    eq(cam.status(), 'Camera frames are arriving — checking the picture…', 'the warming state is not described honestly');
    eq(cam.list(), '', 'the per-control ledger is filled in before the feed is proven');

    cam.clock.advance(260);
    eq(cam.state(), 'live', 'three consecutive lit frames did not prove the feed');
    eq(cam.feed().matcherAllowed, true, 'the matcher is still gagged on a proven feed');
    eq(cam.snap().disabled, false, 'the shutter never opens on a proven feed');
    /* avfit-1.1.0 (owner, 2026-08-17): the viewfinder line no longer carries
       "N of 14". A doctor lining up a shot cannot act on a count, and the line
       he complained about was this one reading the reader's diagnosis aloud.
       The ledger itself is unchanged and still one row per control, which is
       what the next assertion checks — the count moved, it did not vanish. */
    ok(/Face found/.test(cam.status()), 'the live guide stopped saying a face was found on a proven feed: ' + cam.status());
    ok(!/of 14/.test(cam.status()), 'the viewfinder line carries the matcher count again: ' + cam.status());
    ok(/Skin/.test(cam.list()), 'the per-control ledger never appears on a proven feed');
    eq(cam.seen.playCalls >= 1, true, 'playback was assumed rather than asked for');
  }

  /* ---- 4. A DECODED BLACK FRAME NEVER REACHES THE MATCHER --------------- */
  {
    const cam = openCamera({});
    await settle();
    /* readyState 2 with no light in the frame: a dropped compositor surface,
       not a dim room. The frame IS decoded — this is the case a readyState
       check alone cannot catch, which is why liveness is also measured. */
    cam.video.readyState = 2; cam.video.videoWidth = 1280; cam.video.videoHeight = 720; cam.video.__lum = 0;
    cam.clock.advance(4000);
    eq(cam.seen.matcher.length, 0,
      'faceReadPortrait was handed an all-zero-luminance frame — that is what produced "3 of 14" and "Skin — the sample was not a colour real skin has" in front of the owner');
    eq(cam.state(), 'dark', 'a black feed does not reach the dark readiness state');
    eq(cam.feed().matcherAllowed, false, 'the matcher is allowed to speak for a black feed');
    eq(cam.snap().disabled, true, 'the shutter is live over a black feed');
    const said = cam.status() + ' || ' + cam.notices();
    ok(/[Rr]estart/.test(said), 'a black feed is not offered the one remedy that works: ' + said);
    ok(!/turn a light on|face a window|more light|brighter/i.test(said),
      'a DEAD feed was given LIGHTING advice — the exact defect of 2026-08-16, reproduced: ' + said);
    ok(/black/i.test(said), 'the black feed is never named as black: ' + said);
    /* the endurance witness still fires, and still tries the silent re-attach
       first: 12 dark ticks is one report, 24 is the second and the notice */
    ok(cam.seen.playCalls >= 2, 'the dark witness no longer attempts the silent re-attach on its first report');
    ok(/Restart camera/.test(cam.notices()), 'the second dark report does not offer the restart control: ' + cam.notices());
  }

  /* ---- 5. A FEED THAT NEVER DELIVERS IS EXPLAINED, NOT GUESSED AT ------- */
  {
    const cam = openCamera({});
    await settle();
    cam.video.readyState = 1; cam.video.videoWidth = 640; cam.video.videoHeight = 480;
    cam.clock.advance(cam.api.AVCAM_FIRST_FRAME_MS + 500);
    eq(cam.state(), 'stalled', 'a camera that never sent a frame is not reported as stalled');
    eq(cam.seen.matcher.length, 0, 'the matcher ran on a feed that never delivered a frame');
    const said = cam.status() + ' || ' + cam.notices();
    ok(/No camera frames yet/.test(said), 'the stalled feed is not described in plain language: ' + said);
    ok(/allow the camera|another app|restart the camera/i.test(said), 'the stalled feed names no action: ' + said);
    ok(!/turn a light on|face a window/i.test(said), 'a dead feed was sent after a lamp: ' + said);
    ok(/Restart camera/.test(cam.notices()), 'a stalled feed offers no way back: ' + cam.notices());
  }
  {
    /* a camera held by another app: the track is muted and no frame arrives */
    const cam = openCamera({ trackMuted: true });
    await settle();
    cam.video.readyState = 1; cam.video.videoWidth = 640;
    cam.clock.advance(cam.api.AVCAM_FIRST_FRAME_MS + 500);
    const said = cam.status() + ' || ' + cam.notices();
    ok(/held by another app|privacy switch/i.test(said),
      'a camera held by another app or a privacy switch is not named as such: ' + said);
  }
  {
    /* the browser refused to start playback: say that, do not guess */
    const cam = openCamera({ playRejects: true });
    await settle();
    await settle();
    cam.video.readyState = 1; cam.video.videoWidth = 640;
    cam.clock.advance(cam.api.AVCAM_FIRST_FRAME_MS + 500);
    eq(String(cam.feed().playRejected), 'NotAllowedError',
      'the play() rejection is swallowed again — a blocked autoplay leaves a paused element, a black picture and no evidence');
    ok(/never started the camera preview/i.test(cam.status() + cam.notices()),
      'a refused playback is not named: ' + cam.status() + ' || ' + cam.notices());
  }

  /* ---- 6. EVERY REJECTION IS NAMED HONESTLY ---------------------------- */
  {
    const cases = [
      ['NotReadableError', /busy|another app/i, /permission was declined/i],
      ['NotFoundError', /No camera was found/i, /permission was declined/i],
      ['NotAllowedError', /permission was declined/i, /busy|No camera was found/i],
      ['AbortError', /stopped while it was opening/i, /permission was declined/i]
    ];
    for (const [name, wanted, forbidden] of cases) {
      const cam = openCamera({ gum: () => ({ reject: { name } }) });
      await settle(); await settle();
      const said = cam.notices();
      ok(wanted.test(said), name + ' is not reported honestly: ' + said);
      ok(!forbidden.test(said), name + ' is reported as the wrong fault: ' + said);
      eq(cam.seen.matcher.length, 0, name + ' still ran the matcher');
    }
    /* the sized request is all `ideal`, but a browser that refuses it anyway
       must still get a camera — the old safe() wrapper could only catch a
       SYNCHRONOUS throw, so that documented fallback never ran */
    const retry = openCamera({ gum: call => (call === 1 ? { reject: { name: 'OverconstrainedError' } } : { ok: true }) });
    await settle(); await settle(); await settle();
    eq(retry.seen.gum.length, 2, 'a refused constraint is not retried with a plain request, so asking for quality costs the doctor the feature');
    eq(JSON.stringify(retry.seen.gum[1]), JSON.stringify({ video: true }), 'the constraint retry is not a plain video request');
    retry.video.readyState = 2; retry.video.videoWidth = 1280; retry.video.videoHeight = 720; retry.video.__lum = 130;
    retry.clock.advance(1000);
    eq(retry.state(), 'live', 'the camera opened by the constraint retry never reaches a proven feed');
  }

  /* ---- 7. THE SHUTTER PATH REFUSES A BLACK FRAME TOO -------------------- */
  {
    const cam = openCamera({});
    await settle();
    cam.video.readyState = 2; cam.video.videoWidth = 1280; cam.video.videoHeight = 720; cam.video.__lum = 130;
    cam.clock.advance(600);
    eq(cam.state(), 'live', 'the feed did not reach live before the shutter test');
    const before = cam.seen.matcher.length;
    /* the surface dies between proving the feed and pressing the shutter */
    cam.video.__lum = 0;
    cam.snap().click();
    cam.clock.advance(1200);
    eq(cam.seen.matcher.length, before,
      'the best-of-six ranking pass ran the matcher on black frames and reported the resulting colour ledger as if it described the doctor');
    eq(cam.seen.accepted.length, 1, 'the shutter did not complete');
    const verdict = cam.api.faceCaptureVerdict(cam.seen.accepted[0].q && cam.seen.accepted[0].q.faceResult,
      cam.seen.accepted[0].q);
    eq(verdict.ready, false, 'a black capture was accepted as a portrait');
    ok(/went black/.test(verdict.why), 'the black capture is not named as black: ' + verdict.why);
    ok(!/turn a light on|face a window/i.test(verdict.why), 'the black capture is blamed on the lighting: ' + verdict.why);
  }
  {
    /* and a shutter that is somehow clicked on an unproven feed captures nothing */
    const cam = openCamera({});
    await settle();
    cam.video.readyState = 1; cam.video.videoWidth = 1280;
    cam.clock.advance(300);
    const snap = cam.snap();
    snap.disabled = false;              /* simulate any caller re-enabling it */
    snap.click();
    cam.clock.advance(1200);
    eq(cam.seen.accepted.length, 0, 'a shutter click on an unproven feed still captured');
    eq(cam.seen.matcher.length, 0, 'a shutter click on an unproven feed still ran the matcher');
  }

  /* ---- 8. THE READINESS STATE IS OBSERVABLE ---------------------------- */
  {
    const cam = openCamera({});
    await settle();
    const shape = cam.feed();
    ['state', 'why', 'frames', 'litRun', 'darkFrames', 'matcherAllowed', 'exposure', 'sharp', 'playRejected']
      .forEach(k => ok(Object.prototype.hasOwnProperty.call(shape, k),
        'window.__mlsAvCam does not expose "' + k + '", so neither a test nor the lead can read the feed state'));
    cam.video.readyState = 2; cam.video.videoWidth = 1280; cam.video.videoHeight = 720; cam.video.__lum = 96;
    cam.clock.advance(600);
    eq(cam.feed().exposure, 96, 'the published feed state does not carry the measured luminance of the frames the matcher is being fed');
    eq(cam.feed().state, 'live', 'the published feed state does not reach live');
  }

  /* ---- 9. THE LIVENESS TEST ITSELF ------------------------------------- */
  {
    const cam = openCamera({});
    const isLive = cam.api.avcamFrameLooksLive;
    eq(isLive({ exposure: 0, sharp: 0 }), false, 'a flat black frame is treated as live');
    eq(isLive({ exposure: 0.8, sharp: 0.02 }), false, 'a frame exactly at the dead thresholds is treated as live');
    eq(isLive(null), false, 'a missing measurement is treated as live');
    eq(isLive({ exposure: NaN, sharp: NaN }), false, 'an unmeasurable frame is treated as live');
    eq(isLive({ exposure: 12, sharp: 0 }), true, 'a DIM ROOM (5-40 exposure) is refused as a dead feed — a real dark room must still be measured and given lighting advice');
    eq(isLive({ exposure: 0, sharp: 3 }), true, 'a lens-capped but delivering camera is called a dead surface, so its own honest refusal never runs');
  }

  console.log('PASS avatar camera feed readiness: ' + passed + ' assertions — no capture before the first decoded frame, ' +
    'no black frame reaches the matcher on either path, the readiness state transitions and is published, ' +
    'every dead-feed and rejection case is named honestly, and the match gate is untouched');
})().catch(err => { console.error(err); process.exit(1); });
