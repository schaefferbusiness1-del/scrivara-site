'use strict';
/* Sign-in errors tell the truth (signin-1.0.0, b1290). Found by the ScribeFlow.html
   bug hunt and verified: a 429/5xx login said "wrong password" and sent the
   doctor to reset it; Enter during a sign-in sent a second request and left the
   button stuck; an offline forgot-password said a link was on its way; the reset
   card had no way back; a failed Terms load said "press Create account again"
   beside a disabled button. Real Chrome, stubbed backend. */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',async()=>{
 const base='http://127.0.0.1:'+srv.address().port;
 const b=await chromium.launch({args:['--no-sandbox']});
 async function page(handler){ const ctx=await b.newContext({viewport:{width:1400,height:900}}); const pg=await ctx.newPage(); const hits={}; await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/,async r=>{const u=new URL(r.request().url()); hits[u.pathname]=(hits[u.pathname]||0)+1; return handler(r,u);}); return {pg,hits,ctx}; }
 const cors={'access-control-allow-origin':'*'};
 // 1. 429 login
 {const {pg,ctx}=await page((r,u)=>u.pathname==='/api/auth/login'?r.fulfill({status:429,headers:Object.assign({'retry-after':'120'},cors),contentType:'text/plain',body:'Too many requests'}):r.fulfill({status:503,body:'x'}));
  await pg.goto(base+'/ScribeFlow.html'); await pg.waitForTimeout(4000);
  await pg.fill('#authEmail','doc@example.test'); await pg.fill('#authPass','Password2026!'); await pg.click('#authBtn'); await pg.waitForTimeout(1500);
  const t=await pg.textContent('#authErr');
  assert.match(t,/Too many attempts/,'a 429 must say it is rate limiting: '+t); assert.match(t,/password was not checked/);
  assert.doesNotMatch(t,/Forgot password/,'a 429 must not send the doctor to reset a correct password');
  assert.strictEqual(await pg.getAttribute('#authErr','role'),'alert','sign-in errors are announced'); await ctx.close();}
 // 2. double Enter with slow 401
 {const {pg,hits,ctx}=await page(async(r,u)=>{ if(u.pathname==='/api/auth/login'){ await new Promise(x=>setTimeout(x,3000)); return r.fulfill({status:401,headers:cors,contentType:'application/json',body:'{"error":"bad"}'});} return r.fulfill({status:503,body:'x'});});
  await pg.goto(base+'/ScribeFlow.html'); await pg.waitForTimeout(4000);
  await pg.fill('#authEmail','doc@example.test'); await pg.fill('#authPass','Password2026!'); await pg.click('#authBtn'); await pg.waitForTimeout(500); await pg.press('#authPass','Enter'); await pg.waitForTimeout(6000);
  assert.strictEqual(hits['/api/auth/login'],1,'Enter during an in-flight sign-in must not send a second request');
  assert.strictEqual((await pg.textContent('#authBtn')).trim(),'Log in','the button label must recover'); assert.strictEqual(await pg.isDisabled('#authBtn'),false); await ctx.close();}
 // 3. forgot offline
 {const {pg,ctx}=await page((r,u)=>u.pathname==='/api/auth/forgot'?r.abort('internetdisconnected'):r.fulfill({status:503,body:'x'}));
  await pg.goto(base+'/ScribeFlow.html'); await pg.waitForTimeout(4000);
  await pg.evaluate(()=>showForgot()); await pg.waitForTimeout(300);
  const fe=await pg.$('#forgotEmail'); if(fe) await pg.fill('#forgotEmail','doc@example.test');
  await pg.click('#forgotBtn'); await pg.waitForTimeout(1500);
  const fm=await pg.textContent('#forgotMsg');
  assert.match(fm,/no reset link was sent/i,'an offline forgot-password must not claim a link is on its way: '+fm);
  assert.doesNotMatch(fm,/on its way/); await ctx.close();}
 // 4. reset card way back
 {const {pg,ctx}=await page((r,u)=>u.pathname==='/api/auth/reset'?r.fulfill({status:400,headers:cors,contentType:'application/json',body:'{"error":"This reset link is invalid or has expired."}'}):r.fulfill({status:503,body:'x'}));
  await pg.goto(base+'/ScribeFlow.html#reset=synthetic-reset-token-0001'); await pg.waitForTimeout(4000);
  const vis=await pg.isVisible('#resetCard'); await pg.click('#resetNewLink'); await pg.waitForTimeout(500);
  assert.ok(vis,'the reset card opened'); assert.strictEqual(await pg.isVisible('#resetCard'),false,'the reset card has a way out');
  assert.ok(await pg.isVisible('#authBtn'),'back on the login card'); assert.ok(await pg.isVisible('#forgotPanel'),'"Request a new link" opens Forgot password'); await ctx.close();}
 // 5. manifest failure retry
 {let fail=true; const {pg,hits,ctx}=await page((r,u)=>{ if(u.pathname==='/api/agreements/signup-manifest') return fail? r.fulfill({status:502,contentType:'text/html',body:'<html>bad</html>'}) : r.fulfill({status:503,body:'x'}); return r.fulfill({status:503,body:'x'});});
  await pg.goto(base+'/ScribeFlow.html'); await pg.waitForTimeout(4000);
  await pg.evaluate(()=>switchAuth('signup')); await pg.waitForTimeout(1500);
  const retry=await pg.isVisible('#authSignupRetry'); const before=hits['/api/agreements/signup-manifest']||0; if(retry) await pg.click('#authSignupRetry'); await pg.waitForTimeout(1500);
  assert.ok(retry,'a failed Terms/Privacy load offers Try again'); assert.ok((hits['/api/agreements/signup-manifest']||0)>before,'Try again re-fetches');
  assert.strictEqual(await pg.getAttribute('#authBtn','aria-label'),'Create your account','the button\'s accessible name follows the mode'); await ctx.close();}
 await b.close(); srv.close();
 console.log('PASS sign-in error honesty on /ScribeFlow.html: 429 is not "wrong password", one request per sign-in, offline forgot-password says nothing was sent, the reset card has a way back, and a failed Terms load can be retried');
});
