/* avml fixture generator — an ANATOMICAL synthetic sitter, not a smiley.
   Every feature is placed by a canonical facial proportion, so the fixture is a
   face a landmark model can be expected to read, and the traits it is drawn WITH
   are the ground truth the reader must recover. Parameters vary one trait at a
   time and nothing here knows the reader's thresholds.
   Layer order is deliberate: hair silhouette -> skin -> hair cap. Painting the
   cap last is what leaves a bare forehead below the hairline; an even-odd trick
   tried first and filled the whole lower face. */
window.__avFace = function (o) {
  o = o || {};
  var W = o.w || 640, H = o.h || 480;
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var x = c.getContext('2d');
  var dim = o.dim == null ? 1 : o.dim;
  function tint(hex, k) {
    k = k == null ? 1 : k;
    var n = parseInt(String(hex).slice(1), 16);
    var r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * dim * k)));
    var g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * dim * k)));
    var b = Math.max(0, Math.min(255, Math.round((n & 255) * dim * k)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  x.fillStyle = tint(o.bg || '#cfd3d6'); x.fillRect(0, 0, W, H);
  var g0 = x.createLinearGradient(0, 0, 0, H);
  g0.addColorStop(0, 'rgba(255,255,255,0.10)'); g0.addColorStop(1, 'rgba(0,0,0,0.10)');
  x.fillStyle = g0; x.fillRect(0, 0, W, H);

  var headH = H * (o.headFrac || 0.42);
  var wR = o.widthRatio == null ? 0.70 : o.widthRatio;
  var ry = headH / 2, rx = ry * wR;
  var cx = W / 2 + W * (o.dx || 0);
  var cy = H * (o.cyFrac == null ? 0.46 : o.cyFrac);
  var skin = o.skin || '#e8b98f';
  var hair = o.hair === undefined ? '#3b2a1d' : o.hair;
  var jawR = o.jawRatio == null ? 0.78 : o.jawRatio;
  var browY = cy - ry * (o.browAt == null ? 0.20 : o.browAt);
  var chinY = cy + ry * (o.chinDrop == null ? 1.06 : o.chinDrop);
  var faceH = chinY - browY;
  var hairY = browY - faceH * (o.foreheadFrac == null ? 0.42 : o.foreheadFrac);

  /* shoulders + neck */
  x.fillStyle = tint(o.shirt || '#2f5f86');
  x.beginPath(); x.ellipse(cx, cy + ry * 2.35, rx * 3.1, ry * 1.5, 0, 0, 7); x.fill();
  x.fillStyle = tint(skin, 0.86);
  x.fillRect(cx - rx * 0.36, cy + ry * 0.72, rx * 0.72, ry * 0.95);

  /* LAYER 1 — the hair silhouette: the whole head, slightly oversized. */
  if (hair) {
    x.fillStyle = tint(hair);
    x.beginPath(); x.ellipse(cx, cy - ry * 0.06, rx * 1.09, ry * 1.10, 0, 0, 7); x.fill();
    if (o.longHair) {
      x.fillRect(cx - rx * 1.20, cy - ry * 0.40, rx * 0.26, ry * 1.80);
      x.fillRect(cx + rx * 0.94, cy - ry * 0.40, rx * 0.26, ry * 1.80);
    }
  }

  /* LAYER 2 — the skin head: cranium, jaw taper, ears. */
  x.fillStyle = tint(skin);
  x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill();
  x.beginPath();
  x.moveTo(cx - rx * 0.99, cy + ry * 0.02);
  x.lineTo(cx - rx * jawR, cy + ry * 0.58);
  x.quadraticCurveTo(cx, chinY, cx + rx * jawR, cy + ry * 0.58);
  x.lineTo(cx + rx * 0.99, cy + ry * 0.02);
  x.closePath(); x.fill();
  x.beginPath(); x.ellipse(cx - rx * 0.99, cy + ry * 0.06, rx * 0.12, ry * 0.17, 0, 0, 7); x.fill();
  x.beginPath(); x.ellipse(cx + rx * 0.99, cy + ry * 0.06, rx * 0.12, ry * 0.17, 0, 0, 7); x.fill();
  var sh = x.createRadialGradient(cx - rx * 0.25, cy - ry * 0.25, rx * 0.15, cx, cy, rx * 1.25);
  sh.addColorStop(0, 'rgba(255,255,255,0.12)'); sh.addColorStop(1, 'rgba(0,0,0,0.15)');
  x.save(); x.beginPath(); x.ellipse(cx, cy + ry * 0.12, rx * 1.02, ry * 1.12, 0, 0, 7); x.clip();
  x.fillStyle = sh; x.fillRect(cx - rx * 1.3, cy - ry * 1.3, rx * 2.6, ry * 2.6); x.restore();

  /* LAYER 3 — the hair CAP, painted last, so the forehead below hairY stays skin. */
  if (hair) {
    x.fillStyle = tint(hair);
    if (o.receding) {
      /* an M: bare temples, a peak on the midline */
      x.save();
      x.beginPath(); x.ellipse(cx, cy - ry * 0.06, rx * 1.09, ry * 1.10, 0, 0, 7); x.clip();
      x.beginPath();
      x.moveTo(cx - rx * 1.2, hairY - faceH * 0.34);
      x.quadraticCurveTo(cx - rx * 0.52, hairY - faceH * 0.30, cx, hairY + faceH * 0.12);
      x.quadraticCurveTo(cx + rx * 0.52, hairY - faceH * 0.30, cx + rx * 1.2, hairY - faceH * 0.34);
      x.lineTo(cx + rx * 1.2, cy - ry * 1.6); x.lineTo(cx - rx * 1.2, cy - ry * 1.6);
      x.closePath(); x.fill();
      x.restore();
    } else {
      x.save();
      x.beginPath(); x.rect(cx - rx * 1.3, cy - ry * 1.7, rx * 2.6, hairY - (cy - ry * 1.7)); x.clip();
      x.beginPath(); x.ellipse(cx, cy - ry * 0.06, rx * 1.09, ry * 1.10, 0, 0, 7); x.fill();
      x.restore();
    }
  }

  /* eyes */
  var eyeY = browY + faceH * 0.16;
  var eyeDx = rx * (o.eyeSep == null ? 0.46 : o.eyeSep);
  var eyeHalf = rx * (o.eyeW == null ? 0.20 : o.eyeW);
  [-1, 1].forEach(function (s) {
    x.fillStyle = 'rgb(247,245,242)';
    x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, eyeHalf, eyeHalf * 0.44, 0, 0, 7); x.fill();
    x.fillStyle = tint(o.eyes || '#4a3423');
    x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, eyeHalf * 0.46, eyeHalf * 0.42, 0, 0, 7); x.fill();
    x.fillStyle = 'rgb(18,15,13)';
    x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, eyeHalf * 0.20, eyeHalf * 0.20, 0, 0, 7); x.fill();
    x.strokeStyle = 'rgba(40,30,24,0.50)'; x.lineWidth = Math.max(1, rx * 0.016);
    x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, eyeHalf, eyeHalf * 0.44, 0, 0, 7); x.stroke();
  });
  /* brows ON browY */
  x.fillStyle = tint(o.browCol || hair || '#3a2a1c');
  var browT = faceH * (o.browThick == null ? 0.042 : o.browThick);
  [-1, 1].forEach(function (s) {
    x.beginPath(); x.ellipse(cx + s * eyeDx, browY, eyeHalf * 1.12, browT, 0, 0, 7); x.fill();
  });
  /* nose */
  var noseY = browY + faceH * 0.62;
  var noseHalf = rx * (o.noseW == null ? 0.17 : o.noseW);
  x.fillStyle = 'rgba(0,0,0,0.12)';
  x.beginPath(); x.ellipse(cx, noseY, noseHalf, faceH * 0.033, 0, 0, 7); x.fill();
  x.fillStyle = 'rgba(0,0,0,0.22)';
  x.beginPath(); x.ellipse(cx - noseHalf * 0.55, noseY, noseHalf * 0.22, faceH * 0.019, 0, 0, 7); x.fill();
  x.beginPath(); x.ellipse(cx + noseHalf * 0.55, noseY, noseHalf * 0.22, faceH * 0.019, 0, 0, 7); x.fill();
  x.fillStyle = 'rgba(0,0,0,0.06)';
  x.fillRect(cx + rx * 0.02, browY + faceH * 0.10, rx * 0.07, faceH * 0.50);
  /* mouth */
  var mouthY = browY + faceH * 0.79;
  var mouthHalf = rx * (o.mouthW == null ? 0.34 : o.mouthW);
  var lipH = faceH * (o.lipH == null ? 0.055 : o.lipH);
  x.fillStyle = tint(o.lip || '#a9605a');
  x.beginPath(); x.ellipse(cx, mouthY, mouthHalf, lipH, 0, 0, 7); x.fill();
  x.strokeStyle = 'rgba(90,45,40,0.60)'; x.lineWidth = Math.max(1, rx * 0.013);
  x.beginPath(); x.moveTo(cx - mouthHalf, mouthY); x.quadraticCurveTo(cx, mouthY + lipH * 0.16, cx + mouthHalf, mouthY); x.stroke();

  if (o.beard) {
    x.save();
    x.globalAlpha = o.stubble ? 0.42 : 1;
    x.fillStyle = tint(o.beard);
    x.beginPath();
    x.moveTo(cx - rx * jawR * 1.02, cy + ry * 0.26);
    x.quadraticCurveTo(cx, chinY + faceH * 0.05, cx + rx * jawR * 1.02, cy + ry * 0.26);
    x.lineTo(cx + rx * jawR * 1.02, chinY + faceH * 0.05);
    x.lineTo(cx - rx * jawR * 1.02, chinY + faceH * 0.05);
    x.closePath(); x.fill();
    x.restore();
    x.fillStyle = tint(o.lip || '#a9605a');
    x.beginPath(); x.ellipse(cx, mouthY, mouthHalf, lipH, 0, 0, 7); x.fill();
  }
  if (o.glasses) {
    x.strokeStyle = 'rgb(34,31,29)'; x.lineWidth = Math.max(1.4, rx * 0.048);
    [-1, 1].forEach(function (s) {
      x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, eyeHalf * 1.32, eyeHalf * 0.80, 0, 0, 7); x.stroke();
    });
    x.beginPath(); x.moveTo(cx - eyeDx + eyeHalf * 1.32, eyeY - eyeHalf * 0.10);
    x.lineTo(cx + eyeDx - eyeHalf * 1.32, eyeY - eyeHalf * 0.10); x.stroke();
    x.beginPath(); x.moveTo(cx - eyeDx - eyeHalf * 1.32, eyeY); x.lineTo(cx - rx * 1.02, eyeY - faceH * 0.02); x.stroke();
    x.beginPath(); x.moveTo(cx + eyeDx + eyeHalf * 1.32, eyeY); x.lineTo(cx + rx * 1.02, eyeY - faceH * 0.02); x.stroke();
  }

  /* PHOTOGRAPHIC GRAIN. A webcam frame is never flat and a CNN trained on
     photographs reads hard vector edges poorly; light per-pixel noise and a
     half-pixel blur make the fixture behave like a frame without moving a trait. */
  if (o.grain !== false) {
    var gi = x.getImageData(0, 0, W, H), dd = gi.data, amp = o.grain || 6;
    for (var i = 0; i < dd.length; i += 4) {
      var n2 = (Math.random() - 0.5) * 2 * amp;
      dd[i] = Math.max(0, Math.min(255, dd[i] + n2));
      dd[i + 1] = Math.max(0, Math.min(255, dd[i + 1] + n2));
      dd[i + 2] = Math.max(0, Math.min(255, dd[i + 2] + n2));
    }
    x.putImageData(gi, 0, 0);
    var b2 = document.createElement('canvas'); b2.width = W; b2.height = H;
    var bx = b2.getContext('2d'); bx.filter = 'blur(0.6px)'; bx.drawImage(c, 0, 0);
    x.clearRect(0, 0, W, H); x.filter = 'none'; x.drawImage(b2, 0, 0);
  }
  return c;
};
