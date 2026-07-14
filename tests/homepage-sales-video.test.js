const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = 'mls-scribe-30-second-overview.mp4';
const videoPath = path.join(root, source);

assert(fs.existsSync(videoPath), 'homepage sales video asset is missing');
const bytes = fs.statSync(videoPath).size;
assert(bytes > 1_000_000, 'homepage sales video asset is unexpectedly small');
assert(bytes < 25_000_000, 'homepage sales video is too large for an efficient landing page');

const video = html.match(/<video\b[\s\S]*?<\/video>/i);
assert(video, 'homepage sales video element is missing');
assert(video[0].includes('controls'), 'sales video must provide playback controls');
assert(video[0].includes('playsinline'), 'sales video must play inline on mobile');
assert(video[0].includes('preload="metadata"'), 'sales video must avoid an eager full download');
assert(!video[0].includes('autoplay'), 'sales video must not surprise visitors with autoplay');
assert(video[0].includes(`src="${source}"`), 'homepage must use the selected V5 sales video asset');
assert(!html.includes('V6_NATIVE_4K_ABSTRACT'), 'the rejected V6 video must not be published');
assert(html.includes('See MLS in 30 seconds'), 'sales video needs a clear visible introduction');

console.log(`PASS homepage sales video: selected V5 asset (${bytes} bytes), responsive controlled playback`);
