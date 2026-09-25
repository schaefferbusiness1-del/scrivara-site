'use strict';
/* =========================================================================
   bla-1.2.0 (2026-09-25): THE SHELL SAYS WHAT THE SERVER REFUSED.

   Two refusals the backend lane added for the legal and admin findings, which
   the site never read:
     1. POST /api/legal/requests/:id/fee answers 409 LEGAL_FEE_LOCKED_PAID once
        the report is paid, and 409 LEGAL_FEE_LOCKED_CHECKOUT while the
        attorney has a checkout open at another fee. returnLegalToAttorney
        ignored the answer and said "Sent to attorney." with the fee unchanged.
        (That path sits behind the release hold today - its first statement
        refuses - so this suite runs the held body exactly as it will run when
        the hold lifts, and checks the hold is still in place.)
     2. POST /api/admin/accounts/ready answers 409 ACCOUNT_EXISTS_PLAN_CHANGE
        when "Create account & make ready" would replace an existing
        account's plan, with a sentence that ends "to change its plan,
        confirm the change". This form has no confirm step; the owner changes
        a plan in Billing, and the status now says so.

   The real function bodies are read from each shipped shell (the /1p shell,
   its /1p/ copy, production and /cloned) and run in a vm with the network
   and the page stubbed. Nothing leaves the process.
   ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
const failures = [];
let checks = 0;
function check(value, message) { checks++; if (!value) failures.push(message); return !!value; }

function fn(source, head) {
  const at = source.indexOf(head);
  if (at < 0) return '';
  const end = source.indexOf('\n}\n', at);
  return source.slice(at, end + 2);
}

function element(value) { return { value: value || '', style: {}, disabled: false, textContent: '', innerHTML: '' }; }

async function feeCase(source, name, feeAnswer) {
  const send = fn(source, 'async function returnLegalToAttorney(){');
  const retry = fn(source, 'async function _legalFetchRetry(');
  const refusal = fn(source, 'async function _legalFeeRefusal(');
  const hold = "  toast('Report release is unavailable. Nothing was signed or sent.','err');\n  return false;\n";
  check(send.indexOf(hold) > 0 && send.indexOf(hold) < send.indexOf('/fulfill'), name + ': the release hold no longer comes before the release POST');
  const released = send.replace(hold, '');
  const toasts = [], posts = [];
  const els = { legalBody: element('Signed report text.'), legalReturnBtn: element(), legalFeeInput: element('650'), legalReqRef: element(), legalReqAttach: element() };
  const context = {
    console, JSON, Number, Math, String, Promise, setTimeout,
    document: { getElementById: (id) => els[id] || null },
    currentLegalRequestId: 'req-7', legalReqFilesText: 'x',
    legalWorkspaceReleased: () => true, bkBase: () => 'https://api.synthetic.invalid', bkToken: () => 'tok',
    handle401() {}, loadLegalRequests() {}, friendlyError: (e) => String(e && e.message || e),
    toast: (message, kind) => toasts.push({ message: String(message), kind }),
    fetch: async (url, init) => {
      posts.push(String(url));
      if (/\/fulfill$/.test(url)) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: feeAnswer.status === 200, status: feeAnswer.status, json: async () => feeAnswer.body };
    }
  };
  vm.createContext(context);
  vm.runInContext(retry + '\n' + refusal + '\n' + released + '\nthis.__send = returnLegalToAttorney;', context);
  await context.__send();
  return { toasts, posts };
}

async function planCase(source, name, error) {
  const provision = fn(source, 'async function adminProvisionAccount(btn){');
  const status = element();
  const els = {
    adminCreateName: element('Ent Head'), adminCreateEmail: element('ent@example.test'), adminCreateRole: element('head'),
    adminCreatePractice: element(''), adminCreatePlan: element('standard_monthly'), adminCreateAccessMode: element('comp'),
    adminCreateTrialDays: element(''), adminCreateClinicalApproved: Object.assign(element(), { checked: true }), adminCreateStatus: status
  };
  let rendered = 0;
  const context = {
    console, JSON, Number, Math, String, Promise,
    document: { getElementById: (id) => els[id] || null },
    _adminLastUsers: [], adminRoleKey: (v) => v, adminSelectedEnterprisePractice: () => null, adminProtectedPractice: () => true,
    adminClearCreatedInvite() {}, adminRenderCreateResult() { rendered++; }, adminReadinessState: () => 'ready', adminExpectedRecipientSetup: () => false,
    adminReadinessText: () => '', loadAdminUsers() {}, loadAdminBilling() {},
    adminReadyRequest: async () => { const e = new Error(error.message); e.status = 409; e.code = error.code; throw e; }
  };
  vm.createContext(context);
  vm.runInContext(provision + '\nthis.__provision = adminProvisionAccount;', context);
  const result = await context.__provision({ textContent: 'Create account & make ready', disabled: false });
  return { result, said: status.textContent, bad: status.style.color === '#b4231e', rendered };
}

(async function main() {
  const PLAN_SENTENCE = 'ent@example.test already has an account on Enterprise monthly (comp). Creating it again would replace that with Standard monthly (comp), so no changes were made. To re-send its invite, submit it again with its current plan and access; to change its plan, confirm the change.';
  for (const name of SHELLS) {
    const source = fs.readFileSync(path.join(ROOT, name), 'utf8');

    /* 1. the fee answer is read */
    const checkout = await feeCase(source, name, { status: 409, body: { code: 'LEGAL_FEE_LOCKED_CHECKOUT', error: 'The attorney has a checkout open at $500.00, so the fee cannot change right now. If that checkout is not paid, you can change the fee after Fri, 25 Sep 2026 05:00:00 GMT.', checkout_fee_cents: 50000 } });
    check(checkout.posts.some((u) => /\/fee$/.test(u)), name + ': the fee was never sent');
    check(!checkout.toasts.some((t) => t.message === 'Sent to attorney.'), name + ': a fee the server refused (checkout open) still read "Sent to attorney.": ' + JSON.stringify(checkout.toasts));
    check(checkout.toasts.some((t) => /^The report was sent to the attorney, but the fee did not change\. The attorney has a checkout open at \$500\.00, so the fee cannot change right now/.test(t.message) && t.kind === 'err'),
      name + ': the checkout lock was not said plainly: ' + JSON.stringify(checkout.toasts));
    const paid = await feeCase(source, name, { status: 409, body: { code: 'LEGAL_FEE_LOCKED_PAID', error: 'This report has already been paid for, so its fee can no longer change.' } });
    check(paid.toasts.some((t) => /the fee did not change\. This report has already been paid for, so its fee can no longer change\./.test(t.message)) && !paid.toasts.some((t) => t.message === 'Sent to attorney.'),
      name + ': the paid lock was not said plainly: ' + JSON.stringify(paid.toasts));
    const saved = await feeCase(source, name, { status: 200, body: { ok: true, fee_cents: 65000 } });
    check(saved.toasts.length === 1 && saved.toasts[0].message === 'Sent to attorney.' && saved.toasts[0].kind === 'ok', name + ': a saved fee no longer reads "Sent to attorney.": ' + JSON.stringify(saved.toasts));

    /* 2. an existing account's plan is changed in Billing, not by a confirm this form lacks */
    const plan = await planCase(source, name, { code: 'ACCOUNT_EXISTS_PLAN_CHANGE', message: PLAN_SENTENCE });
    check(plan.result === false && plan.bad && plan.rendered === 0, name + ': the plan-change refusal was not shown as a refusal: ' + JSON.stringify(plan));
    check(plan.said.indexOf('ent@example.test already has an account on Enterprise monthly (comp). Creating it again would replace that with Standard monthly (comp), so no changes were made.') >= 0,
      name + ': the server’s sentence was not shown: ' + plan.said);
    check(!/confirm the change/i.test(plan.said), name + ': the status still asks for a confirm step this form does not have: ' + plan.said);
    check(/To change its plan, use Grant & make Ready for that account in Admin › Billing & plans below\./.test(plan.said), name + ': the status does not point to Billing to change the plan: ' + plan.said);
    const other = await planCase(source, name, { code: 'ACCOUNT_ROLE_MISMATCH', message: 'That email already belongs to role doctor; no account changes were made.' });
    check(/^Nothing was reported as Ready: That email already belongs to role doctor/.test(other.said) && !/Billing/.test(other.said), name + ': another refusal changed wording: ' + other.said);
  }
  if (failures.length) {
    console.error('FAIL shell-says-fee-lock-and-plan-change-refusals: ' + failures.length + ' of ' + checks + ' checks failed:\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log('PASS shell-says-fee-lock-and-plan-change-refusals: ' + checks + ' checks across ' + SHELLS.length + ' shells - a fee the server refuses (checkout open, or already paid) is said in its words and never as "Sent to attorney." (the release hold still stands first), a saved fee still reads "Sent to attorney."; an existing account’s plan-change refusal shows the server’s sentence without a confirm step this form lacks and points to Billing');
})().catch((e) => { console.error(e); process.exit(1); });
