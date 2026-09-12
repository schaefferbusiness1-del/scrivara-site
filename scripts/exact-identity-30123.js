'use strict';
// Canonical source is embedded in isolated injected drivers: no worker closure.
function mlsExactNameKey(value) {
  var raw = String(value || '').trim().toLowerCase();
  try { raw = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  raw = raw.replace(/\s*[\u2018\u2019\u02bc'`\u2010-\u2015-]\s*/g, '').replace(/\./g, '').replace(/\bjunior\b/g, 'jr').replace(/\bsenior\b/g, 'sr');
  var parts = raw.split(',').map(function (part) { return part.trim(); }).filter(Boolean);
  var suffix = '';
  if (parts.length > 1 && /^(jr|sr|ii|iii|iv|v)$/.test(parts[parts.length - 1])) suffix = parts.pop();
  if (parts.length === 2) raw = parts[1] + ' ' + parts[0];
  else if (parts.length === 1) raw = parts[0];
  else if (parts.length > 2) return '';
  raw = raw.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  var words = raw.split(' ').filter(Boolean);
  while (words.length && /^(mr|mrs|ms|miss|dr|prof)$/.test(words[0])) words.shift();
  while (words.length && /^(jr|sr|ii|iii|iv|v)$/.test(words[words.length-1])) words.pop();
  return words.length >= 2 ? words[0]+' '+words[words.length-1] : '';
}
function mlsExactDobKey(value) {
  var raw = String(value || '').trim(), m, year, month, day;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw))) { year=+m[1]; month=+m[2]; day=+m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw))) { year=+m[3]; month=+m[1]; day=+m[2]; }
  else return '';
  var date = new Date(Date.UTC(year, month-1, day));
  return year >= 1850 && date.getUTCFullYear() === year && date.getUTCMonth() === month-1 && date.getUTCDate() === day ? year+'-'+month+'-'+day : '';
}
function mlsExactIdentityPair(expected, observed) {
  expected = expected || {}; observed = observed || {};
  var name = mlsExactNameKey(expected.name), dob = mlsExactDobKey(expected.dob);
  if (!name || !dob) return {ok:false,reason:'identity-hint-incomplete'};
  if (observed.ambiguous === true || Number(observed.exactPairCandidateCount || 0) > 1) return {ok:false,reason:'identity-ambiguous'};
  if (!mlsExactNameKey(observed.name)) return {ok:false,reason:'same-frame-name-missing'};
  if (name !== mlsExactNameKey(observed.name)) return {ok:false,reason:'same-frame-name-mismatch'};
  if (!mlsExactDobKey(observed.dob)) return {ok:false,reason:'same-frame-dob-missing'};
  if (dob !== mlsExactDobKey(observed.dob)) return {ok:false,reason:'same-frame-dob-mismatch'};
  return {ok:true,reason:'exact-name+dob',mrnConflict:!!(expected.mrn && observed.mrn && String(expected.mrn) !== String(observed.mrn))};
}
module.exports = {mlsExactNameKey,mlsExactDobKey,mlsExactIdentityPair};
