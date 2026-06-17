/* ===== Doctor-side lawyer connect-link UI (item 1) =====
   Loaded by ScribeFlow.html. Adds the handlers behind the "🔗 Get connect link"
   button in the lawyer-management box. Relies on the app globals bkBase(), bkToken(),
   esc(), toast() (defined in the main app script; available at call time). */
var _connectUrl = '';
async function publishLawyerConnectLink(){
  var box = document.getElementById('lawConnectLinkBox');
  var btn = document.getElementById('lawLinkBtn');
  if(btn) btn.disabled = true;
  try{
    var r = await fetch(bkBase()+'/api/legal/connect-link', { headers:{ Authorization:'Bearer '+bkToken() } });
    var d = await r.json().catch(function(){ return {}; });
    if(btn) btn.disabled = false;
    if(!r.ok || !d.token){ toast((d&&d.error)||'Could not get the connect link.','err'); return; }
    _connectUrl = (location.origin||'https://mlsscribe.com')+'/legal-connect.html?token='+encodeURIComponent(d.token);
    if(box){
      box.innerHTML = '<div style="font-size:12px;background:#fff;border:1px solid #cfe2f8;border-radius:7px;padding:7px 9px;word-break:break-all;color:var(--brand-dk)">'+esc(_connectUrl)+'</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'
        + '<button class="btn-primary" style="font-size:12.5px;padding:6px 11px" onclick="copyLawyerConnectLink()">📋 Copy link</button>'
        + '<button class="btn-ghost" style="font-size:12.5px;padding:6px 11px" onclick="rotateLawyerConnectLink()">♻️ New link</button>'
        + '</div>'
        + '<div class="mini" style="color:var(--muted);margin-top:6px">Anyone with this link can create an attorney login connected to you. Share only with trusted attorneys; “New link” invalidates the old one.</div>';
    }
  }catch(e){ if(btn) btn.disabled = false; toast('Could not get the connect link.','err'); }
}
function copyLawyerConnectLink(){
  if(!_connectUrl) return;
  if(navigator.clipboard){
    navigator.clipboard.writeText(_connectUrl).then(function(){ toast('Connect link copied.','ok'); }).catch(function(){ window.prompt('Copy the connect link:', _connectUrl); });
  } else { window.prompt('Copy the connect link:', _connectUrl); }
}
async function rotateLawyerConnectLink(){
  try{
    var r = await fetch(bkBase()+'/api/legal/connect-link/rotate', { method:'POST', headers:{ Authorization:'Bearer '+bkToken() } });
    if(!r.ok){ toast('Could not rotate the link.','err'); return; }
    toast('New connect link generated.','ok');
    publishLawyerConnectLink();
  }catch(e){ toast('Could not rotate the link.','err'); }
}
