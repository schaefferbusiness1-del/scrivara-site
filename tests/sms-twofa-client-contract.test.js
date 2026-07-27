'use strict';

/* TEXTED SIGN-IN CODES — client contract (b742). The backend (sms-2fa branch)
 * reports methods:['totp','sms'] + sms:{sent,phone_last4} at the password
 * step and completes a texted code at /api/auth/2fa/sms/login. This suite
 * pins the client half: server-driven method choice (an account with no SMS
 * enrollment sees exactly the old TOTP-only card), honest failure copy, and
 * the Settings enrollment card wired to the real routes with the same
 * password-to-change security the backend enforces. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'ScribeFlow.html'), 'utf8');

/* ---- login: the 2FA card is method-aware and server-driven ---- */
assert(app.includes('showTwofaScreen(data.pending, email, data);'),
  'login must hand the FULL response to the 2FA screen - methods and sms state live there');
const show = app.slice(app.indexOf('function showTwofaScreen(pending,email,info)'), app.indexOf('function toggleTwofaRecovery'));
assert(show.includes("twofaMethodsList=(info&&Array.isArray(info.methods))?info.methods.slice():['totp']"),
  'a response with no methods array must degrade to the old TOTP-only card');
assert(/twofaActiveMethod=\(smsOk&&\(smsSent\|\|!totpOk\)\)\?'sms':'totp';/.test(show),
  'the texted code is the default ONLY when one was actually sent (or TOTP does not exist)');
assert(show.includes('use "Text me a new code" below'),
  'a failed automatic text must say so and point at the resend, not sit silent');

/* ---- login: completion routes by proof type ---- */
const doLogin = app.slice(app.indexOf('async function doTwofaLogin()'), app.indexOf('/* ---------- Mandatory 2FA enrollment'));
assert(doLogin.includes("(twofaActiveMethod==='sms'&&!twofaRecoveryMode)?'/api/auth/2fa/sms/login':'/api/auth/2fa/login'"),
  'texted codes complete at the sms sibling route; TOTP and recovery keep the original endpoint');

/* ---- login: resend honors the rate limiter's own honesty ---- */
const resend = app.slice(app.indexOf('async function resendTwofaSms()'), app.indexOf('function showTwofaScreen'));
assert(resend.includes("'/api/auth/2fa/sms/send'") && resend.includes('JSON.stringify({pending:twofaPending})'),
  'resend uses the pending-2FA token, never a session token');
assert(resend.includes('retryAfterSeconds'), 'a rate-limited resend must tell the doctor how long to wait');

/* ---- method switcher: both directions, recovery stays on the TOTP path ---- */
const render = app.slice(app.indexOf('function _twofaRenderMethod()'), app.indexOf('function toggleTwofaMethod'));
assert(render.includes('Use your authenticator app instead') && render.includes('Text a code to my phone instead'),
  'the method switch must offer both directions');
assert(/twofaActiveMethod==='sms'[\s\S]{0,900}recoveryRow\.parentElement\.style\.display='none'/.test(render),
  'recovery codes belong to the authenticator path and must hide on the sms card');

/* ---- Settings: enrollment card wired to the real routes, server truth ---- */
assert(app.includes("adminFetch('/api/auth/2fa/sms/setup',{method:'POST',body:JSON.stringify({phone})})"),
  'enrollment starts at the setup route with the entered phone');
assert(app.includes("adminFetch('/api/auth/2fa/sms/verify',{method:'POST',body:JSON.stringify({code})})"),
  'possession is proven at the verify route');
assert(app.includes("adminFetch('/api/auth/2fa/sms/disable',{method:'POST',body:JSON.stringify({password})})") &&
  /mlsPrompt\('Enter your account password to turn off texted sign-in codes:','',\{password:true\}\)/.test(app),
  'disabling requires the PASSWORD via a masked prompt - mirroring the backend rule');
const settingsRender = app.slice(app.indexOf('function renderTwofaSettings()'), app.indexOf('async function smsTwofaSetup'));
assert(settingsRender.includes('bkUser&&bkUser.sms_2fa_enabled') && settingsRender.includes('sms_2fa_phone_last4'),
  'the card renders from the /api/me projection, never from local guesses');

/* ---- the phone number never persists client-side beyond the input ---- */
assert(!/localStorage\.setItem\([^)]{0,80}(smsTwofaPhone|sms_2fa_phone)/.test(app),
  'the full phone number must never be written to client storage');

console.log('PASS sms 2fa client: server-driven method choice, sms-sibling completion, honest resend, password-gated disable, /api/me truth, no phone persistence');
