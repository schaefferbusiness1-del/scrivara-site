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

source = replaceOnce(
  source,
  "    window.__mlsLiveCrossDayOriginal={had:Object.prototype.hasOwnProperty.call(window,'_calAppts'),value:window._calAppts,todayFn:window._acctTodayKey};",
  [
    "    const providerCacheNames=['mlsProviderRosterV2','mlsSchedProviders','mlsProviderRosterReceiptV2'];",
    "    const providerCaches=providerCacheNames.map(name=>{const key=uns(name);return {name,key,value:localStorage.getItem(key)}});",
    "    window.__mlsLiveCrossDayOriginal={",
    "      had:Object.prototype.hasOwnProperty.call(window,'_calAppts'),value:window._calAppts,",
    "      providersHad:Object.prototype.hasOwnProperty.call(window,'_calProviders'),",
    "      providersValue:Array.isArray(window._calProviders)?window._calProviders.slice():window._calProviders,",
    "      providerCaches,todayFn:window._acctTodayKey",
    "    };",
    "    providerCaches.forEach(entry=>localStorage.removeItem(entry.key));",
    "    window._calProviders=[];_calProviders=window._calProviders;"
  ].join('\n'),
  'isolate cross-day provider state'
);

source = replaceOnce(
  source,
  [
    "      const saved=window.__mlsLiveCrossDayOriginal;",
    "      if(saved){if(saved.had)window._calAppts=saved.value;else delete window._calAppts;}",
    "      if(saved&&saved.todayFn)window._acctTodayKey=saved.todayFn;"
  ].join('\n'),
  [
    "      const saved=window.__mlsLiveCrossDayOriginal;",
    "      if(saved){",
    "        if(saved.had)window._calAppts=saved.value;else delete window._calAppts;",
    "        window._calProviders=saved.providersHad&&Array.isArray(saved.providersValue)?saved.providersValue:[];",
    "        _calProviders=window._calProviders;",
    "        (saved.providerCaches||[]).forEach(entry=>{",
    "          if(entry.value==null)localStorage.removeItem(entry.key);else localStorage.setItem(entry.key,entry.value);",
    "        });",
    "      }",
    "      if(saved&&saved.todayFn)window._acctTodayKey=saved.todayFn;"
  ].join('\n'),
  'restore cross-day provider state'
);

fs.writeFileSync(target, source, 'utf8');
console.log('Patched ' + target);
