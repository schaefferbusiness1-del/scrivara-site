'use strict';
/* cptrunc-1.0.0 (2026-09-24): THE FLOATING ASSISTANT'S DRAFT CARD NEVER
 * PASSES A CUT DRAFT AS WHOLE EITHER.
 *
 * feat_mls_copilot_actions.js paints the canonical Copilot artifact in the
 * Assistant with its own textarea and a "Copy email draft" button - a second
 * surface next to the Studio canvas. It has no 1p twin, so this suite runs the
 * module file itself and proves:
 *   - a flagged draft (artifact.truncated / omittedChars, text carrying the
 *     '[... DRAFT INCOMPLETE' marker) shows an amber strip under the title;
 *     editing the marker out softens it and the flag stays;
 *   - Copy email draft asks first with the in-app dialog while the marker is
 *     there; a cancel, a failed or a missing dialog copies nothing;
 *   - AN OLD-SERVER REPLY (no truncated, no omittedChars, no marker) shows no
 *     strip and copies at once with no dialog, exactly as before.
 * Every draft below is invented for this file.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_actions.js'), 'utf8');
let checks = 0;
function ok(v, msg) { assert.ok(v, msg); checks += 1; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); checks += 1; }
function deq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks += 1; }
const tick = () => new Promise(resolve => setImmediate(resolve));

ok(!/(?:^|[^.\w])(?:window\.)?confirm\(/.test(source.replace(/mlsConfirm\(/g, '')), 'the Assistant card asks with a native confirm()');
ok(!/[^\x00-\x7f]/.test(source.slice(source.indexOf('/* ---------------- cptrunc-1.0.0'), source.indexOf('function renderBlock('))), 'the cut-draft helpers are not ASCII-only like the rest of this module promises');

const MARK = '\n\n[... DRAFT INCOMPLETE: 1,234 characters were cut here because this draft ran past the 16,000-character limit. Ask Copilot for a shorter version, or for the draft in parts, before using it ...]\n\n';
const CUT_TEXT = 'Synthetic email opening.' + MARK + 'Synthetic email closing.';
const STRIP_LOUD = 'Incomplete draft: 1,234 characters were cut where the text is marked. Ask Copilot for a shorter version or for it in parts before you copy, email or send it.';
const STRIP_SOFT = 'This draft came back incomplete: 1,234 characters were cut. The marker is no longer in the text, so check that nothing needed is missing before you use it.';

function hasClass(node, cls) { return String(node.className || '').split(/\s+/).includes(cls); }
function walk(rootNode) { const out = []; (function visit(n) { out.push(n); n.children.forEach(visit); })(rootNode); return out; }
function makeNode(tag, id, cls) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', className: cls || '', children: [], parentNode: null,
    attributes: {}, style: {}, textContent: '', value: '', placeholder: '', disabled: false, type: '', oninput: null, onclick: null,
    appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const at = before ? this.children.indexOf(before) : -1;
      if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
      child.parentNode = this; return child;
    },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; return child; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const descendants = walk(this).slice(1);
      if (selector.startsWith('.')) return descendants.filter(n => hasClass(n, selector.slice(1)));
      const exact = selector.match(/^\[data-mlsca-message="([^"]+)"\]$/);
      if (exact) return descendants.filter(n => n.getAttribute('data-mlsca-message') === exact[1]);
      if (selector === '[data-mlsca-message]') return descendants.filter(n => n.getAttribute('data-mlsca-message') != null);
      return [];
    },
    scrollIntoView() {}, dispatchEvent() {}, focus() {}
  };
  Object.defineProperty(node, 'nextSibling', { get() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return this.parentNode.children[i + 1] || null; } });
  return node;
}

function boot(messages, answers, opts) {
  opts = opts || {};
  const html = makeNode('html'), head = makeNode('head'), body = makeNode('body');
  html.appendChild(head); html.appendChild(body);
  const panel = makeNode('section', 'mlsAsstPanel');
  const thread = makeNode('div', '', 'as-thread');
  messages.forEach(() => thread.appendChild(makeNode('div', '', 'as-msg ai')));
  panel.appendChild(thread); body.appendChild(panel);
  const timers = [];
  const log = [];
  const store = { all() { return messages.slice(); }, subscribe(fn) { fn(); return () => {}; } };
  const context = {
    console, Promise, Date, JSON, Object, Array, String, Number, RegExp, Math, isFinite, Event: function Event() {},
    document: {
      readyState: 'complete', head, body, documentElement: html,
      createElement(tag) { return makeNode(tag); },
      getElementById(id) { return walk(html).find(n => n.id === id) || null; },
      querySelectorAll(selector) { return html.querySelectorAll(selector); }, addEventListener() {}
    },
    __mlsCopilotConvo: store,
    navigator: { clipboard: { writeText(t) { log.push(['clipboard', t]); return opts.clipboardFails ? Promise.reject(new Error('denied')) : Promise.resolve(); } } },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { throw new Error('the draft card must not poll'); }, clearInterval() {},
    addEventListener() {}, removeEventListener() {},
    toast(message) { log.push(['toast', String(message)]); }
  };
  if (!opts.noDialog) {
    context.mlsConfirm = function (msg, o) {
      log.push(['confirm', msg, o && o.okLabel, o && o.cancelLabel]);
      const a = answers.shift();
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    };
  }
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_mls_copilot_actions.js' });
  while (timers.length) timers.shift()();
  const blocks = thread.querySelectorAll('[data-mlsca-message]');
  return { context, log, thread, blocks };
}
function card(block) {
  const art = block.querySelector('.mlsca-art');
  return {
    art,
    strip: art.querySelector('.mlsca-warn'),
    body: art.querySelector('.mlsca-body'),
    send: art.querySelector('.mlsca-send'),
    order: art.children.map(n => n.tagName + (n.className ? '.' + String(n.className).split(' ')[0] : ''))
  };
}

const OLD_EMAIL = { role: 'ai', requestId: 1, text: 'Here is the email.', actions: [], followups: [],
  artifact: { kind: 'email', title: 'Visit follow-up', to: 'patient@example.test', subject: 'Your visit', content: 'Synthetic whole email.' } };
const CUT_EMAIL = { role: 'ai', requestId: 2, text: 'Here is the email.', actions: [], followups: [],
  artifact: { kind: 'email', title: 'Visit follow-up', to: 'patient@example.test', subject: 'Your visit', content: CUT_TEXT, truncated: true, omittedChars: 1234 } };
const CUT_LETTER = { role: 'ai', requestId: 3, text: 'Here is the letter.', actions: [], followups: [],
  artifact: { kind: 'letter', title: 'Referral', content: CUT_TEXT, truncated: true, omittedChars: 1234 } };
const WHOLE_NEW = { role: 'ai', requestId: 4, text: 'Here is the email.', actions: [], followups: [],
  artifact: { kind: 'email', title: 'Visit follow-up', to: 'patient@example.test', subject: 'Your visit', content: 'Synthetic whole email.', truncated: false, omittedChars: 0 } };
const clone = m => JSON.parse(JSON.stringify(m));

(async function () {
  /* ---- 1. render ---- */
  {
    const env = boot([clone(OLD_EMAIL), clone(CUT_EMAIL), clone(CUT_LETTER), clone(WHOLE_NEW)], []);
    eq(env.blocks.length, 4, 'the Assistant did not paint one card per draft');
    const oldCard = card(env.blocks[0]), cutCard = card(env.blocks[1]), letterCard = card(env.blocks[2]), wholeCard = card(env.blocks[3]);
    eq(oldCard.strip, null, 'an old-server draft shows a cut strip');
    deq(oldCard.order, ['H5', 'INPUT.mlsca-to', 'INPUT.mlsca-subj', 'TEXTAREA.mlsca-body', 'BUTTON.mlsca-send', 'DIV.mlsca-note'], 'an old-server email card is no longer laid out as before');
    eq(wholeCard.strip, null, 'a whole draft from the new server shows a cut strip');
    deq(wholeCard.order, oldCard.order, 'a whole draft from the new server is laid out differently from before');

    ok(cutCard.strip, 'a cut email draft shows no strip');
    deq(cutCard.order, ['H5', 'DIV.mlsca-warn', 'INPUT.mlsca-to', 'INPUT.mlsca-subj', 'TEXTAREA.mlsca-body', 'BUTTON.mlsca-send', 'DIV.mlsca-note'], 'the strip is not under the title and over the draft');
    eq(cutCard.strip.className, 'mlsca-warn', 'a marked draft shows a soft strip');
    eq(cutCard.strip.getAttribute('role'), 'alert', 'a marked draft strip is not an alert');
    eq(cutCard.strip.textContent, STRIP_LOUD, 'the strip says the wrong thing');
    ok(letterCard.strip && letterCard.order[1] === 'DIV.mlsca-warn', 'a cut non-email draft shows no strip');
  }

  /* ---- 2. Copy email draft: old server, at once ---- */
  {
    const env = boot([clone(OLD_EMAIL)], []);
    const c = card(env.blocks[0]);
    c.send.onclick();
    deq(env.log, [['clipboard', 'To: patient@example.test\nSubject: Your visit\n\nSynthetic whole email.']], 'an old-server email no longer copies at once with no dialog');
    eq(c.send.disabled, true, 'the copy button did not hold while copying');
    await tick(); await tick();
    eq(c.send.textContent, 'Copied', 'the copy button did not confirm the copy');
    ok(env.log.some(r => r[0] === 'toast' && /Email draft copied/.test(r[1])), 'the copy toast is gone');
  }
  {
    const env = boot([clone(OLD_EMAIL)], [], { clipboardFails: true });
    const c = card(env.blocks[0]);
    c.send.onclick();
    await tick(); await tick();
    eq(c.send.disabled, false, 'a failed clipboard write left the button disabled');
    eq(c.send.textContent, 'Copy email draft', 'a failed clipboard write kept the Copied label');
    ok(env.log.some(r => r[0] === 'toast' && r[1] === 'Could not copy the email draft.'), 'a failed clipboard write said nothing');
  }

  /* ---- 3. Copy email draft: a marked draft asks first ---- */
  for (const [answer, copied] of [[false, false], [true, true], [undefined, false], [new Error('dialog failed'), false]]) {
    const env = boot([clone(CUT_EMAIL)], [answer]);
    const c = card(env.blocks[0]);
    c.send.onclick();
    eq(env.log.filter(r => r[0] === 'clipboard').length, 0, 'a marked draft reached the clipboard before the doctor answered');
    await tick(); await tick(); await tick();
    const ask = env.log.find(r => r[0] === 'confirm');
    ok(ask, 'a marked email draft was copied without asking');
    eq(ask[1], 'This draft is incomplete: 1,234 characters were cut where the text is marked.\n\nCopy it anyway?', 'the question does not say what was cut');
    eq(ask[2], 'Copy anyway', 'the question has the wrong OK label');
    if (copied) {
      deq(env.log.filter(r => r[0] === 'clipboard'), [['clipboard', 'To: patient@example.test\nSubject: Your visit\n\n' + CUT_TEXT]], 'an accepted copy did not copy the marked draft');
      eq(c.send.textContent, 'Copied', 'an accepted copy did not say Copied');
    } else {
      eq(env.log.filter(r => r[0] === 'clipboard').length, 0, 'a declined or failed question still copied (' + String(answer) + ')');
      eq(c.send.disabled, false, 'a declined question left the button disabled');
      ok(env.log.some(r => r[0] === 'toast' && r[1] === 'Nothing was copied.'), 'a declined question said nothing');
    }
  }
  {
    const env = boot([clone(CUT_EMAIL)], [], { noDialog: true });
    const c = card(env.blocks[0]);
    c.send.onclick();
    await tick(); await tick();
    eq(env.log.filter(r => r[0] === 'clipboard').length, 0, 'with no in-app dialog a marked draft was copied anyway');
    ok(env.log.some(r => r[0] === 'toast' && /incomplete, so nothing was copied/.test(r[1])), 'with no in-app dialog the refusal said nothing');
    eq(c.send.disabled, false, 'the refusal left the button disabled');
  }

  /* ---- 4. editing keeps the strip true; the flag stays ---- */
  {
    const messages = [clone(OLD_EMAIL), clone(CUT_EMAIL)];
    const env = boot(messages, []);
    const oldCard = card(env.blocks[0]), cutCard = card(env.blocks[1]);

    const edited = 'Synthetic email opening. Synthetic completed middle. Synthetic email closing.';
    cutCard.body.value = edited; cutCard.body.oninput();
    const soft = cutCard.art.querySelector('.mlsca-warn');
    ok(soft === cutCard.strip, 'editing replaced the strip instead of softening it');
    eq(soft.className, 'mlsca-warn soft', 'the strip did not soften once the marker was edited out');
    eq(soft.getAttribute('role'), 'note', 'the softened strip is still an alert');
    eq(soft.textContent, STRIP_SOFT, 'the softened strip says the wrong thing');
    eq(messages[1].artifact.truncated, true, 'editing the marker out cleared the flag');
    cutCard.send.onclick();
    deq(env.log, [['clipboard', 'To: patient@example.test\nSubject: Your visit\n\n' + edited]], 'a draft whose marker was edited out still asks before copying');

    cutCard.body.value = CUT_TEXT; cutCard.body.oninput();
    eq(cutCard.art.querySelector('.mlsca-warn').className, 'mlsca-warn', 'the strip did not return to amber when the marker came back');

    /* an old-server draft: typing paints nothing, pasting the marker in does */
    oldCard.body.value = 'Synthetic edited whole email.'; oldCard.body.oninput();
    eq(oldCard.art.querySelector('.mlsca-warn'), null, 'editing an old-server draft painted a strip');
    oldCard.body.value = CUT_TEXT; oldCard.body.oninput();
    const pasted = card(env.blocks[0]);
    eq(pasted.order[1], 'DIV.mlsca-warn', 'a pasted marker did not put the strip under the title');
    ok(pasted.strip.textContent.startsWith('Incomplete draft: part of it was cut where the text is marked.'), 'a pasted marker strip says the wrong thing');
    oldCard.body.value = 'Synthetic whole email again.'; oldCard.body.oninput();
    eq(oldCard.art.querySelector('.mlsca-warn'), null, 'a strip stayed up with neither the flag nor the marker');
  }

  console.log('PASS Copilot cut-draft Assistant card: ' + checks + ' checks; flagged drafts show the strip and ask before Copy email draft, and an old-server reply renders and copies exactly as before');
})().catch(error => { console.error(error); process.exit(1); });
