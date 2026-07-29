'use strict';

const fs = require('fs');
const path = require('path');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text was ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const root = path.join(__dirname, '..', '..');
const testPath = path.join(root, 'tests', 'live-athena-smart-ui.js');
let test = fs.readFileSync(testPath, 'utf8');

test = replaceOnce(
  test,
  [
    'async function click(cdp, selector) {',
    '  const result = await evaluate(cdp, `(() => {',
    '    const nodes=[...document.querySelectorAll(${selectorLiteral(selector)})];',
    "    const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};",
    '    const live=nodes.filter(shown);',
    '    if(live.length!==1)return {ok:false,count:nodes.length,visible:live.length};',
    '    if(live[0].disabled)return {ok:false,count:nodes.length,visible:live.length,disabled:true};',
    '    live[0].click();return {ok:true};',
    '  })()`);',
    '  assert(result && result.ok, `Could not click ${selector}: ${JSON.stringify(result)}`);',
    '}',
    '',
    'async function clickButtonText(cdp, containerSelector, text) {'
  ].join('\n'),
  [
    'async function click(cdp, selector) {',
    '  const result = await evaluate(cdp, `(() => {',
    '    const nodes=[...document.querySelectorAll(${selectorLiteral(selector)})];',
    "    const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};",
    '    const live=nodes.filter(shown);',
    '    if(live.length!==1)return {ok:false,count:nodes.length,visible:live.length};',
    '    if(live[0].disabled)return {ok:false,count:nodes.length,visible:live.length,disabled:true};',
    '    live[0].click();return {ok:true};',
    '  })()`);',
    '  assert(result && result.ok, `Could not click ${selector}: ${JSON.stringify(result)}`);',
    '}',
    '',
    'async function waitForInAppConfirm(cdp, description) {',
    '  return waitFor(cdp, description, `(() => {',
    "    const overlay=document.getElementById('_mlsAskDialog');",
    "    const card=overlay&&overlay.querySelector('[role=\"dialog\"]');",
    "    const cancel=document.getElementById('_mlsAskNo'),accept=document.getElementById('_mlsAskYes'),message=document.getElementById('_mlsAskMsg');",
    "    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};",
    '    if(!shown(overlay)||!shown(card)||!shown(cancel)||!shown(accept)||!message)return false;',
    "    const norm=value=>String(value||'').replace(/\\\\s+/g,' ').trim();",
    "    return {message:norm(message.textContent),cancel:norm(cancel.textContent),accept:norm(accept.textContent),role:card.getAttribute('role')||'',ariaModal:card.getAttribute('aria-modal')||''};",
    '  })()`);',
    '}',
    '',
    'let trustedClickSerial = 0;',
    'async function trustedClick(cdp, selector) {',
    '  const probeKey=`__mlsTrustedClickProbe${++trustedClickSerial}`;',
    '  const target=await evaluate(cdp, `(() => {',
    '    const nodes=[...document.querySelectorAll(${selectorLiteral(selector)})];',
    "    const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};",
    '    const live=nodes.filter(shown);',
    '    if(live.length!==1)return {ok:false,count:nodes.length,visible:live.length};',
    '    if(live[0].disabled)return {ok:false,count:nodes.length,visible:live.length,disabled:true};',
    '    const el=live[0],r=el.getBoundingClientRect(),key=${JSON.stringify(probeKey)};',
    '    window[key]=null;',
    "    el.addEventListener('click',event=>{window[key]={seen:true,isTrusted:event.isTrusted};},{capture:true,once:true});",
    '    return {ok:true,x:r.left+r.width/2,y:r.top+r.height/2};',
    '  })()`, { userGesture: false });',
    '  assert(target && target.ok, `Could not target trusted click ${selector}: ${JSON.stringify(target)}`);',
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });",
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 });",
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 });",
    '  const observed=await waitFor(cdp, `trusted click ${selector}`, `window[${JSON.stringify(probeKey)}]`);',
    '  assert.strictEqual(observed.isTrusted, true, `${selector} did not receive trusted browser input`);',
    '  await evaluate(cdp, `delete window[${JSON.stringify(probeKey)}]`, { userGesture: false });',
    '  return observed;',
    '}',
    '',
    'async function clickButtonText(cdp, containerSelector, text) {'
  ].join('\n'),
  'add trusted in-app confirmation helpers'
);

test = replaceOnce(
  test,
  [
    '    /* Disconnect requires the exact local confirmation. Cancel makes no call;',
    '       acceptance makes exactly one DELETE and changes only API state. */',
    '    const beforeCancel = await harnessSnapshot(cdp);',
    "    dialogDecisions.push('dismiss');",
    "    await click(cdp, '#athApiDisconnectBtn');",
    "    await waitFor(cdp, 'dismissed disconnect dialog', `${dialogs.length}>0`);",
    '    const afterCancel = await harnessSnapshot(cdp);',
    "    assert.strictEqual(smartCalls(afterCancel, '/smart/connection', 'DELETE').length, smartCalls(beforeCancel, '/smart/connection', 'DELETE').length, 'cancelled disconnect sent DELETE');",
    "    dialogDecisions.push('accept');",
    "    await click(cdp, '#athApiDisconnectBtn');",
    "    await waitFor(cdp, 'confirmed disconnect', `/Disconnected/.test((document.getElementById('athApiActionNote')||{}).textContent||'')`);",
    '    const afterDisconnect = await harnessSnapshot(cdp);',
    '    const disconnected = await settingsState(cdp);',
    "    assert.strictEqual(smartCalls(afterDisconnect, '/smart/connection', 'DELETE').length, smartCalls(afterCancel, '/smart/connection', 'DELETE').length + 1, 'confirmed disconnect did not send exactly one DELETE');",
    "    const disconnectCall = smartCalls(afterDisconnect, '/smart/connection', 'DELETE').slice(-1)[0];",
    '    assert.strictEqual(disconnectCall.headers.authorization, `Bearer ${SYNTHETIC_TOKEN}`, \'disconnect lost bearer binding\');',
    "    assert.strictEqual(disconnected.state.connectionStatus, 'not_connected', 'disconnect receipt did not update state');",
    "    assert(dialogs.length >= 2 && dialogs.slice(-2).every((dialog) => /MLS Assist is not changed/.test(dialog.message)), 'disconnect confirmation copy did not preserve MLS Assist');",
    '    report.scenarios.settingsAndConnect = { rejectedCallback, configured, popup: popupSettings, fallback, maliciousHost, writeScope, permission, disconnected, dialogs: dialogs.slice() };'
  ].join('\n'),
  [
    '    /* Disconnect requires the exact local in-app confirmation. Cancel makes',
    '       no call; trusted acceptance makes exactly one DELETE and changes only',
    '       API state. */',
    "    const disconnectConfirmCopy = 'Disconnect the read-only Athena API connection for this practice? This stops API schedule reads and disables the API backup schedule. MLS Assist is not changed.';",
    '    const beforeCancel = await harnessSnapshot(cdp);',
    "    await click(cdp, '#athApiDisconnectBtn');",
    "    const cancelDialog = await waitForInAppConfirm(cdp, 'visible disconnect cancellation dialog');",
    "    assert.deepStrictEqual(cancelDialog, { message: disconnectConfirmCopy, cancel: 'Cancel', accept: 'OK', role: 'dialog', ariaModal: 'true' }, 'disconnect cancellation dialog drifted');",
    '    const beforeCancelDecision = await harnessSnapshot(cdp);',
    "    assert.strictEqual(smartCalls(beforeCancelDecision, '/smart/connection', 'DELETE').length, smartCalls(beforeCancel, '/smart/connection', 'DELETE').length, 'disconnect called DELETE before the cancellation decision');",
    "    const cancelInput = await trustedClick(cdp, '#_mlsAskNo');",
    "    await waitFor(cdp, 'closed disconnect cancellation dialog', `!document.getElementById('_mlsAskDialog')`);",
    '    const afterCancel = await harnessSnapshot(cdp);',
    "    assert.strictEqual(smartCalls(afterCancel, '/smart/connection', 'DELETE').length, smartCalls(beforeCancel, '/smart/connection', 'DELETE').length, 'cancelled disconnect sent DELETE');",
    "    await click(cdp, '#athApiDisconnectBtn');",
    "    const confirmDialog = await waitForInAppConfirm(cdp, 'visible disconnect confirmation dialog');",
    "    assert.deepStrictEqual(confirmDialog, { message: disconnectConfirmCopy, cancel: 'Cancel', accept: 'OK', role: 'dialog', ariaModal: 'true' }, 'disconnect confirmation dialog drifted');",
    '    const beforeConfirmDecision = await harnessSnapshot(cdp);',
    "    assert.strictEqual(smartCalls(beforeConfirmDecision, '/smart/connection', 'DELETE').length, smartCalls(afterCancel, '/smart/connection', 'DELETE').length, 'disconnect called DELETE before explicit confirmation');",
    "    const confirmInput = await trustedClick(cdp, '#_mlsAskYes');",
    "    await waitFor(cdp, 'confirmed disconnect', `/Disconnected/.test((document.getElementById('athApiActionNote')||{}).textContent||'')`);",
    '    const afterDisconnect = await harnessSnapshot(cdp);',
    '    const disconnected = await settingsState(cdp);',
    "    assert.strictEqual(smartCalls(afterDisconnect, '/smart/connection', 'DELETE').length, smartCalls(afterCancel, '/smart/connection', 'DELETE').length + 1, 'confirmed disconnect did not send exactly one DELETE');",
    "    const disconnectCall = smartCalls(afterDisconnect, '/smart/connection', 'DELETE').slice(-1)[0];",
    '    assert.strictEqual(disconnectCall.headers.authorization, `Bearer ${SYNTHETIC_TOKEN}`, \'disconnect lost bearer binding\');',
    "    assert.strictEqual(disconnected.state.connectionStatus, 'not_connected', 'disconnect receipt did not update state');",
    "    const disconnectDialogs = [Object.assign({ decision: 'cancel', trusted: cancelInput.isTrusted }, cancelDialog), Object.assign({ decision: 'confirm', trusted: confirmInput.isTrusted }, confirmDialog)];",
    "    assert(disconnectDialogs.every(dialog => dialog.trusted && /MLS Assist is not changed/.test(dialog.message)), 'disconnect confirmation proof lost trusted input or MLS Assist copy');",
    '    report.scenarios.settingsAndConnect = { rejectedCallback, configured, popup: popupSettings, fallback, maliciousHost, writeScope, permission, disconnected, dialogs: disconnectDialogs };'
  ].join('\n'),
  'drive the real in-app disconnect confirmation'
);

fs.writeFileSync(testPath, test, 'utf8');
console.log('Patched ' + testPath);
