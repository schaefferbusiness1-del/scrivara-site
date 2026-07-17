'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const states = [
  {
    name: 'time, visit type, and provider badges',
    selector: '#mlsEz3 .ez3-badge:not(.dob):not(.a):not(.g)',
    foreground: '#244B78',
    background: '#EFF4FF'
  },
  {
    name: 'booked badge',
    selector: '#mlsEz3 .ez3-badge.a',
    foreground: '#6F4300',
    background: '#FFF6DF'
  },
  {
    name: 'seen badge',
    selector: '#mlsEz3 .ez3-badge.g',
    foreground: '#1F6248',
    background: '#EAF7F0'
  },
  {
    name: 'Athena mismatch warning',
    selector: '#mlsEz3 .ez3-vchip.warn',
    foreground: '#6F4300',
    background: '#FFF6DF'
  },
  {
    name: 'missing-history row',
    selector: '#mlsEz3 .ez3-vchip.dim',
    foreground: '#3E4B44',
    background: '#F4F6F3'
  },
  {
    name: 'verified-history row',
    selector: '#mlsEz3 .ez3-vchip.ok',
    foreground: '#1F6248',
    background: '#EAF7F0'
  },
  {
    name: 'verification action buttons',
    selector: '#mlsEz3 .ez3-vbtn',
    foreground: '#204034',
    background: '#FFFFFF'
  }
];

for (const state of states) {
  const ruleStart = source.indexOf(`'${state.selector}{`);
  assert(ruleStart >= 0, `${state.name}: scoped light-card override is missing`);
  const ruleEnd = source.indexOf("}',", ruleStart);
  assert(ruleEnd > ruleStart, `${state.name}: override rule is malformed`);
  const rule = source.slice(ruleStart, ruleEnd);
  assert(rule.includes(`color:${state.foreground} !important`), `${state.name}: dark text is not protected from the duplicate dark-theme CSS`);
  assert(rule.includes(`background:${state.background} !important`), `${state.name}: opaque light surface is missing`);
  assert(!/opacity\s*:|filter\s*:/.test(rule), `${state.name}: text is still being washed out by opacity or a filter`);
  assert(contrast(state.foreground, state.background) >= 4.5, `${state.name}: contrast is below WCAG AA`);
}

assert(source.includes("window.__MLS_AV = window.__MLS_AV || 'b367'"), 'shared asset version was not bumped to b367');
assert(source.includes("var MLS_APP_BUILD='2026-07-17-b367'"), 'app build version was not bumped to b367');

console.log('PASS patient card contrast: every metadata, verification, history, and action state uses dark AA text on the light card');
