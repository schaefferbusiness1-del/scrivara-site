'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'late-surfaces-stay-deferred.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

connect = replaceExactlyOnce(
  connect,
  "(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){if(window.__mlsProcReportLoader)return;window.__mlsProcReportLoader=1;var s=document.createElement('script');s.src='mls-procedure-report.js?v=20260722lib2';s.async=true;(document.head||document.documentElement).appendChild(s);},{timeout:2500});}catch(e){}})();",
  "(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){(function waitForRvu(tries){if(window.__mlsRVU||tries>=30){if(window.__mlsProcReportLoader)return;window.__mlsProcReportLoader=1;var s=document.createElement('script');s.src='mls-procedure-report.js?v=20260722lib2';s.async=true;(document.head||document.documentElement).appendChild(s);return;}setTimeout(function(){waitForRvu(tries+1);},100);})(0);},{timeout:2500});}catch(e){}})();",
  'bounded Procedure Report dependency wait'
);

test = replaceExactlyOnce(
  test,
  "/* Patient rows now emit the exact final last-seen label themselves. Keeping",
  "/* 2026-07-29: Procedure Report snapshots RVU values on first mount, so its\n * deferred loader must wait for the RVU script or reach a bounded fallback. */\nconst procedureLoaderLine = connect.split(/\\r?\\n/).find((line) => line.includes(\"s.src='mls-procedure-report.js?v=20260722lib2'\"));\nassert(procedureLoaderLine && procedureLoaderLine.includes('function waitForRvu(tries)') &&\n  procedureLoaderLine.includes('window.__mlsRVU||tries>=30') &&\n  procedureLoaderLine.includes('setTimeout(function(){waitForRvu(tries+1);},100)'),\n  'Procedure Report can race RVU and freeze fallback totals into its first render');\nassert.strictEqual((connect.match(/mls-procedure-report\\.js\\?v=20260722lib2/g) || []).length, 1,\n  'Procedure Report must retain one bounded production loader');\n\n/* Patient rows now emit the exact final last-seen label themselves. Keeping",
  'RVU dependency-order contract'
);

const procedureLine = connect.split(/\r?\n/).find((line) => line.includes("s.src='mls-procedure-report.js?v=20260722lib2'"));
if (!procedureLine ||
    !procedureLine.includes('requestIdleCallback') ||
    !procedureLine.includes('function waitForRvu(tries)') ||
    !procedureLine.includes('window.__mlsRVU||tries>=30')) {
  throw new Error('bounded RVU dependency wait postcondition failed');
}
if ((connect.match(/mls-procedure-report\.js\?v=20260722lib2/g) || []).length !== 1) {
  throw new Error('Procedure Report loader count postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Applied a bounded RVU readiness wait before Procedure Report loading.');
