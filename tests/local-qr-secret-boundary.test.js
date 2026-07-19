'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const vendor = read('vendor_qrcode.js');
assert(/QRCode\s*=/.test(vendor), 'the checked-in local QR implementation is missing');

for (const file of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
  const source = read(file);
  assert(!/api\.qrserver\.com|create-qr-code/i.test(source), `${file} still sends QR payloads to a third party`);
  assert(/<script src="vendor_qrcode\.js\?v=[^"]+"><\/script>/.test(source), `${file} does not load the local QR implementation`);
  assert(source.indexOf('vendor_qrcode.js') < source.indexOf('function mlsSetLocalQrImage'), `${file} can call the QR helper before its local implementation loads`);
  for (const id of ['regTwofaQR', 'twofaQR', 'phoneMicQR']) {
    assert(source.includes(`mlsSetLocalQrImage('${id}',`), `${file} does not render #${id} locally`);
  }

  const start = source.indexOf('function mlsSetLocalQrImage(');
  const end = source.indexOf('function reconcileHistoryStorageNotice', start);
  assert(start >= 0 && end > start, `${file} local QR helper markers are missing`);
  const helper = source.slice(start, end);
  assert(!/fetch\s*\(|XMLHttpRequest|\.src\s*=\s*['"]https?:/i.test(helper), `${file} QR helper contains a network path`);

  const image = {
    src: '', alt: '', attrs: {},
    removeAttribute(name) { if (name === 'src') this.src = ''; delete this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = String(value); }
  };
  const canvas = { toDataURL(type) { assert.equal(type, 'image/png'); return 'data:image/png;base64,LOCAL_ONLY'; } };
  const host = { querySelector(selector) { return selector === 'canvas' ? canvas : null; } };
  function QRCode(el, options) {
    assert.strictEqual(el, host);
    assert.equal(options.text, 'otpauth://totp/MLS?secret=SYNTHETIC-SECRET');
    assert.equal(options.width, 180);
  }
  QRCode.CorrectLevel = { M: 0 };
  const context = {
    QRCode,
    document: {
      getElementById(id) { return id === 'twofaQR' ? image : null; },
      createElement(tag) { assert.equal(tag, 'div'); return host; }
    },
    Math, Number, String, Error
  };
  vm.createContext(context);
  vm.runInContext(`${helper};this.renderQr=mlsSetLocalQrImage;`, context, { filename: `${file}-local-qr.js` });
  assert.equal(context.renderQr('twofaQR', 'otpauth://totp/MLS?secret=SYNTHETIC-SECRET', 180), true);
  assert.equal(image.src, 'data:image/png;base64,LOCAL_ONLY');
  assert.equal(image.alt, 'QR code generated on this device');
}

console.log('PASS sensitive 2FA and phone QR payloads are rendered locally with no network path');
