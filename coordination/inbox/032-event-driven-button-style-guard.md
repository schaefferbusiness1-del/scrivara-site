# 032 - Make the primary-button stylesheet guard event-driven

## Measured problem

The production `mls-connect.js:3838-3855` primary-button polish owner installs
one global stylesheet, then calls `mount()` every 3,000 ms for the lifetime of
the tab.

A reproducible Node VM probe extracted the owner directly from frozen b790,
ran its real boot, and invoked the registered callback for one simulated idle
minute. It measured:

- one 3,000 ms permanent interval;
- 20 timer callbacks;
- 20 `document.getElementById('mlsBtnPolishCss')` reads; and
- zero DOM writes after the one required boot insertion.

Repository search found no test literal pin for `mlsBtnPolishCss`,
`__mlsBtnPolish`, or this interval. The stylesheet is global, so ordinary body
mounts do not require reinsertion.

Reproduction from the repository root:

```powershell
node -e "const cp=require('child_process'),vm=require('vm');const s=cp.execFileSync('git',['show','HEAD:mls-connect.js'],{encoding:'latin1',maxBuffer:8*1024*1024});const a=s.indexOf('/* =========================================================================\n * MLS Scribe - PRIMARY BUTTON POLISH');const b=s.indexOf('/* =========================================================================\n * MLS Scribe - COPILOT PROVIDER-DATA GROUNDING',a);if(a<0||b<a)throw Error('owner');const code=s.slice(s.indexOf('(function () {',a),b);let reads=0,writes=0,cb=null,delay=0;const head={children:[],appendChild(n){writes++;n.parentNode=this;this.children.push(n);return n;}};const d={head,documentElement:{},getElementById(id){reads++;return head.children.find(n=>n.id===id)||null;},createElement(){return{id:'',textContent:'',remove(){const i=head.children.indexOf(this);if(i>=0)head.children.splice(i,1);}};}};const w={};w.window=w;vm.runInNewContext(code,{window:w,document:d,setInterval(fn,ms){cb=fn;delay=ms;return 1;},clearInterval(){}});const boot={reads,writes};reads=0;writes=0;for(let i=0;i<60000/delay;i++)cb();console.log(JSON.stringify({delay,boot,idleMinute:{callbacks:60000/delay,domReads:reads,domWrites:writes},styleCount:head.children.length}));"
```

## Change

Change only production `mls-connect.js` and its existing performance contract:

- replace the permanent 3-second timer with one `MutationObserver`;
- observe only direct children of the current `head` and
  `document.documentElement`;
- ignore ordinary additions and all body-descendant mutations;
- restore the identical stylesheet immediately if its exact node is removed;
- rebind and restore after wholesale head replacement; and
- disconnect the observer before the existing revert path removes the style.

The persisted VM proof executes the patched production owner. It verifies zero
interval registration, zero work for unrelated head additions, exact-style
removal recovery, head-replacement recovery and rebinding, and complete revert
cleanup.

`mls-connect.js` is read and written with latin1 encoding. No stylesheet text,
rendered design, layout, copy, control, route, feature reach, patient data,
network behavior, or extension file changes.

## Expected effect

Remove 20 steady-state main-thread timer callbacks and 20 DOM reads per minute
per open production tab. Recovery from the two cases the old timer defended
against becomes mutation-driven instead of waiting up to three seconds.

## Validation

Validated without changing worktree targets in disposable archives made from
clean b790:

- the proposal script and both patched files pass `node --check`;
- `node tests/interaction-performance-contract.test.js` passes;
- `node tests/chart-row-status-glyphs-are-not-mojibake.test.js` passes the
  required latin1/byte-integrity checks;
- `node tests/motion-system-costs-no-layout.test.js` passes;
- a second proposal application exits 1 at the first missing anchor and leaves
  both patched hashes unchanged;
- applying 023, 025, 031, then 032 succeeds with all four exit codes 0, and both
  the interaction-performance and scoped-lifecycle contracts pass; and
- applying 032 first, then 023, 025 and 031 also succeeds with all four exit
  codes 0, and both focused contracts pass.

On clean b790, the first application changed:

- `mls-connect.js` SHA-256 from
  `BD5D83654F076875A2ACCDB4A1FFCE861A96507DF7F7F54AED466DBE260ECF53`
  to
  `B0DB9CF8D9FCD24656CC1B4C44671FC02CB0B9F5C917DF7357194EAEE0FC9877`;
  and
- `tests/interaction-performance-contract.test.js` SHA-256 from
  `843C7CB863D7D4675C782DA2ACC14B0C7F851DC6507AC4D5E42FC5539AEE3BC3`
  to
  `4A3CC3B4B46E86ADC73D04203B3728F0D1727D6B4398B53FDB7F4042315E6C00`.

Because this changes `mls-connect.js` bytes, release assembly must advance the
site asset token before deployment.

## Risks

Low.

Supported production Chrome provides `MutationObserver`. If it is unavailable,
the unchanged stylesheet still mounts once at boot, which is sufficient during
normal operation. The observer watches two low-churn direct-child scopes and
filters for the exact removal condition before performing any DOM lookup or
write.
