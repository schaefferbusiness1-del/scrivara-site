const $ = id => document.getElementById(id);
chrome.storage.local.get(['mlsKey', 'mlsBackend'], c => {
  if (c.mlsKey) $('key').value = c.mlsKey;
  if (c.mlsBackend) $('backend').value = c.mlsBackend;
});

// Show how MLS Assist is connected right now.
function refreshConn() {
  const el = $('conn'); if (!el) return;
  chrome.runtime.sendMessage({ type: 'mlsConnStatus' }, s => {
    if (chrome.runtime.lastError || !s) { el.style.cssText += ';background:#fff7e6;border-color:#f0d9a0;color:#8a5a00'; el.textContent = 'Reload the extension to check connection.'; return; }
    if (s.mode === 'session') { el.style.background = '#eafaf0'; el.style.borderColor = '#bfe6cf'; el.style.color = '#1c7a43'; el.textContent = '✓ Connected through your MLS login to the official backend.'; }
    else if (s.mode === 'key') { el.style.background = '#eef6ff'; el.style.borderColor = '#cfe0f3'; el.style.color = '#1a4e80'; el.textContent = s.custom ? '✓ Custom HTTPS backend configured with its own API key.' : '✓ Connected with a saved API key.'; }
    else if (s.mode === 'invalid') { el.style.background = '#fdecea'; el.style.borderColor = '#f5c6cb'; el.style.color = '#a23b3d'; el.textContent = '⛔ ' + (s.error || 'Backend configuration is blocked. Nothing will be sent.'); }
    else { el.style.background = '#fff7e6'; el.style.borderColor = '#f0d9a0'; el.style.color = '#8a5a00'; el.textContent = '⚠ Not connected. Open MLS (mlsscribe.com) and sign in — then reopen this.'; }
  });
}
refreshConn();
$('save').addEventListener('click', () => {
  const key = $('key').value.trim();
  const backend = $('backend').value.trim() || 'https://scrivara-backend.onrender.com';
  chrome.runtime.sendMessage({ type: 'mlsValidateBackendConfig', key, backend }, policy => {
    if (chrome.runtime.lastError || !policy || !policy.ok) {
      $('ok').style.color = '#a23b3d';
      $('ok').textContent = (policy && policy.error) || 'Could not validate this backend. Nothing was saved.';
      refreshConn();
      return;
    }
    chrome.storage.local.set({ mlsKey: key, mlsBackend: policy.backend }, () => {
      $('backend').value = policy.backend;
      $('ok').style.color = '#2E6A4B';
      $('ok').textContent = '✓ Saved';
      refreshConn();
      setTimeout(() => $('ok').textContent = '', 1800);
    });
  });
});

const _ot = document.getElementById('openTab');
if (_ot) _ot.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const t = tabs[0]; if (!t) return;
    chrome.tabs.sendMessage(t.id, { type: 'mlsOpenPanel' }, () => {
      if (chrome.runtime.lastError) { $('ok').textContent = 'Can\u2019t open here - try a normal web page or your EMR.'; }
      else { $('ok').textContent = '\u2713 Opened on this tab'; setTimeout(() => window.close(), 600); }
    });
  });
});

// ---- Nightly backup controls ----
function _fmtBackup(r) {
  if (!r) return 'Has not run yet.';
  if (r.ok) return '\u2713 ' + new Date(r.at).toLocaleString() + ': the one open verified Athena chart was captured.';
  return '\u26a0 ' + new Date(r.at).toLocaleString() + ': ' + (r.error || 'failed');
}
function _pad(n) { return ('0' + n).slice(-2); }
chrome.runtime.sendMessage({ type: 'mlsGetBackup' }, b => {
  if (chrome.runtime.lastError || !b) return;
  if ($('bkEnabled')) $('bkEnabled').checked = !!b.enabled;
  if ($('bkTime')) $('bkTime').value = _pad(b.hour | 0) + ':' + _pad(b.minute | 0);
  if ($('bkStatus')) $('bkStatus').textContent = _fmtBackup(b.lastResult);
});
function _saveBackup(cb) {
  const tv = ($('bkTime').value || '02:00').split(':');
  const value = { enabled: $('bkEnabled').checked, hour: parseInt(tv[0], 10) || 0, minute: parseInt(tv[1], 10) || 0 };
  chrome.runtime.sendMessage({ type: 'mlsSetBackup', value }, () => cb && cb(value));
}
if ($('bkSave')) $('bkSave').addEventListener('click', () => {
  _saveBackup(v => { $('bkStatus').textContent = v.enabled ? ('\u2713 Saved \u2014 checks the one currently open verified Athena chart nightly at ' + _pad(v.hour) + ':' + _pad(v.minute) + '. Keep Chrome open and Athena signed in.') : '\u2713 Saved \u2014 nightly backup off.'; });
});
if ($('bkRun')) $('bkRun').addEventListener('click', () => {
  const btn = $('bkRun'); btn.disabled = true; btn.textContent = '\u2026 checking chart'; $('bkStatus').textContent = 'Checking the one currently open verified Athena chart\u2026';
  _saveBackup(() => {
    chrome.runtime.sendMessage({ type: 'mlsRunBackupNow' }, r => {
      btn.disabled = false; btn.textContent = '\u25b6 Run backup now';
      $('bkStatus').textContent = chrome.runtime.lastError ? 'Could not run (reload the extension?).' : _fmtBackup(r);
    });
  });
});
