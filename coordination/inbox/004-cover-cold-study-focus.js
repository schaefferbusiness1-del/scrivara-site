'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'help-search-location-contract.test.js');

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
  "(function focusStudyPrompt(tries){setTimeout(function(){var q=document.getElementById('mlsStudyPrompt');if(q){try{q.scrollIntoView({block:'center',behavior:'auto'});q.focus();}catch(e){}return;}if(tries<16)focusStudyPrompt(tries+1);},tries?200:80);})(0);",
  "(function focusStudyPrompt(tries){setTimeout(function(){var q=document.getElementById('mlsStudyPrompt');if(q){try{q.scrollIntoView({block:'center',behavior:'auto'});q.focus();}catch(e){}return;}if(tries<100)focusStudyPrompt(tries+1);},tries?200:80);})(0);",
  'Study prompt measured cold-tail focus window'
);

test = replaceExactlyOnce(
  test,
  "directory.includes('if(tries<16)focusStudyPrompt(tries+1)')",
  "directory.includes('if(tries<100)focusStudyPrompt(tries+1)')",
  'Study prompt focus-window contract'
);

const focusLine = connect.split(/\r?\n/).find((line) => line.includes('function focusStudyPrompt(tries)'));
if (!focusLine ||
    !focusLine.includes('if(tries<100)focusStudyPrompt(tries+1)') ||
    !focusLine.includes("document.getElementById('mlsStudyPrompt')") ||
    !focusLine.includes('tries?200:80')) {
  throw new Error('Study prompt focus-window postcondition failed');
}
if ((connect.match(/function focusStudyPrompt\(tries\)/g) || []).length !== 1) {
  throw new Error('Study prompt focus owner is missing or ambiguous');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Extended the user-triggered Study focus window to 20.08 seconds.');
