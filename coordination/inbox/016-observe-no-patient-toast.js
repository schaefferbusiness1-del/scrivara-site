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

const target = path.join(__dirname, '..', '..', 'tests', 'live-synthetic-smoke.js');
let source = fs.readFileSync(target, 'utf8');

const before = [
  "    const originalAlert=window.alert;",
  "    let alertText='';",
  "    window.alert=value=>{alertText=String(value||'')};",
  "    try { window.__mlsWriteFlow.oneClick(); } finally { window.alert=originalAlert; window.removeEventListener('message',listener); }",
  "    return {",
  "      activePatient:!!(window.activePatient&&window.activePatient()),",
  "      oneClickVisible:visible(document.getElementById('wf2OneClick')),",
  "      reviewVisible:visible(document.getElementById('mlsAthenaUnifiedConfirm'))||visible(document.getElementById('emrPanel')),",
  "      alertText, writeMessages:messages",
  "    };",
  "  })()`);",
  "  assert.strictEqual(result.activePatient, false, 'No-patient guard fixture unexpectedly has an active patient');",
  "  assert.strictEqual(result.oneClickVisible, false, 'Athena one-click is visible without an active patient');",
  "  assert.strictEqual(result.reviewVisible, false, 'Athena review opened without an active patient');",
  "  assert(/pick a patient first/i.test(result.alertText), `No-patient guard did not explain the block: ${result.alertText}`);",
  "  assert.deepStrictEqual(result.writeMessages, [], 'No-patient guard emitted an Athena write bridge message');"
].join('\n');

const after = [
  "    const originalAlert=window.alert;",
  "    let alertText='';",
  "    window.alert=value=>{alertText=String(value||'')};",
  "    try { window.__mlsWriteFlow.oneClick(); } finally { window.alert=originalAlert; window.removeEventListener('message',listener); }",
  "    const toastNode=document.getElementById('toast');",
  "    const toastShown=!!(toastNode&&toastNode.classList.contains('show'));",
  "    return {",
  "      activePatient:!!(window.activePatient&&window.activePatient()),",
  "      oneClickVisible:visible(document.getElementById('wf2OneClick')),",
  "      reviewVisible:visible(document.getElementById('mlsAthenaUnifiedConfirm'))||visible(document.getElementById('emrPanel')),",
  "      alertText,",
  "      toastText:toastShown?String(toastNode.textContent||''):'',",
  "      toastRole:toastNode?String(toastNode.getAttribute('role')||''):'',",
  "      toastError:!!(toastNode&&toastNode.classList.contains('err')),",
  "      writeMessages:messages",
  "    };",
  "  })()`);",
  "  assert.strictEqual(result.activePatient, false, 'No-patient guard fixture unexpectedly has an active patient');",
  "  assert.strictEqual(result.oneClickVisible, false, 'Athena one-click is visible without an active patient');",
  "  assert.strictEqual(result.reviewVisible, false, 'Athena review opened without an active patient');",
  "  const guardText=result.toastText||result.alertText;",
  "  assert(/pick a patient first/i.test(guardText), `No-patient guard did not explain the block: ${guardText}`);",
  "  if(result.toastText){",
  "    assert.strictEqual(result.toastRole, 'alert', 'No-patient error toast is not announced as an alert');",
  "    assert.strictEqual(result.toastError, true, 'No-patient error toast is missing its error state');",
  "  }",
  "  assert.deepStrictEqual(result.writeMessages, [], 'No-patient guard emitted an Athena write bridge message');"
].join('\n');

source = replaceOnce(source, before, after, 'observe canonical no-patient toast');

fs.writeFileSync(target, source, 'utf8');
console.log('Patched ' + target);
