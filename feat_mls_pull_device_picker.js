/* feat_mls_pull_device_picker.js -> window.__mlsPullTarget (pdp-1.0.0)
 *
 * Choose WHICH computer runs Athena pulls. Every signed-in device (phone,
 * office computer, laptop) gets a small "Pull runs on" selector next to the
 * day bar's Pull button, listing the account's registered computers from the
 * relay device registry (roles office/secondary; phones can't pull — they are
 * requesters). Default stays "Auto — office computer".
 *
 * The relay module consults window.__mlsPullTarget.get():
 *  - null / Auto / this-device  -> exactly the old behavior (office target,
 *    or a local extension pull when this device has one).
 *  - another computer           -> the job is targeted at that exact deviceId;
 *    a secondary computer's agent polls targetedOnly=1 and may execute ONLY
 *    jobs aimed at it (backend-enforced), never untargeted office jobs.
 *
 * Storage: localStorage mls_pull_target_device = {"id","name"}. Absent = Auto.
 * The list refreshes from GET /api/relay/devices while the day bar is visible;
 * offline devices stay listed but are marked, and the pull's own queued-bail
 * still protects against a dead target. No Athena action happens here.
 */
;(function () {
  "use strict";
  var NS = "__mlsPullTarget", VERSION = "pdp-1.0.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  var KEY = "mls_pull_target_device", WRAP_ID = "mlsPdpWrap", SEL_ID = "mlsPdpSel", STYLE_ID = "mlsPdpStyle";
  var disposed = false, devices = [], lastFetch = 0, iv = 0;

  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function myDeviceId() { return safe(function () { var dr = window.__mlsDeviceRole; return dr && dr.deviceId ? String(dr.deviceId) : ""; }, ""); }
  function tok() { return safe(function () { return typeof window.bkToken === "function" ? window.bkToken() : ""; }, ""); }
  function base() { return safe(function () { return typeof window.bkBase === "function" ? window.bkBase() : ""; }, ""); }
  function authed() { return safe(function () { return typeof window.backendMode === "function" && window.backendMode() && !!tok(); }, false); }

  function stored() {
    return safe(function () {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return v && v.id ? { id: String(v.id), name: String(v.name || "") } : null;
    }, null);
  }
  function store(v) {
    safe(function () {
      if (v && v.id) localStorage.setItem(KEY, JSON.stringify({ id: String(v.id), name: String(v.name || "") }));
      else localStorage.removeItem(KEY);
    });
  }

  /* get(): what the relay module consults. self=true when the choice is this
     very device (relay then keeps local-pull behavior). */
  function get() {
    var v = stored();
    if (!v) return null;
    return { id: v.id, name: v.name, self: !!(v.id && v.id === myDeviceId()) };
  }
  function set(id, name) {
    if (!id || id === "auto") { store(null); }
    else store({ id: id, name: name || "" });
    render();
  }

  function fetchDevices(force) {
    if (!authed()) return;
    var now = Date.now();
    if (!force && now - lastFetch < 45000) return;
    lastFetch = now;
    fetch(base() + "/api/relay/devices", { headers: { Authorization: "Bearer " + tok() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (disposed || !j || !j.ok || !Array.isArray(j.devices)) return;
        devices = j.devices.filter(function (d) { return d && d.id && d.role !== "phone"; });
        render();
      })
      .catch(function () {});
  }

  function optionLabel(d) {
    var bits = [d.name || (d.role === "office" ? "Office computer" : "Computer")];
    if (d.role === "office") bits.push("(office)");
    if (d.role === "secondary") bits.push("(laptop/secondary)");
    if (d.id === myDeviceId()) bits.push("— this device");
    if (!(d.online && d.ext)) bits.push(d.online ? "— extension off" : "— offline");
    return bits.join(" ");
  }

  function render() {
    if (disposed) return;
    var btn = byId("mlsDsPullBtn");
    var wrap = byId(WRAP_ID);
    if (!btn || !btn.parentNode) { if (wrap) wrap.remove(); return; }
    if (!wrap) {
      wrap = document.createElement("span");
      wrap.id = WRAP_ID;
      btn.parentNode.insertBefore(wrap, btn);
    }
    var cur = stored();
    var h = '<label for="' + SEL_ID + '">Pull runs on</label><select id="' + SEL_ID + '">' +
      '<option value="auto">Auto — office computer</option>';
    var curListed = false;
    devices.forEach(function (d) {
      if (cur && d.id === cur.id) curListed = true;
      h += '<option value="' + esc(d.id) + '" data-name="' + esc(d.name || "") + '"' + (cur && d.id === cur.id ? " selected" : "") + ">" + esc(optionLabel(d)) + "</option>";
    });
    if (cur && !curListed) h += '<option value="' + esc(cur.id) + '" data-name="' + esc(cur.name) + '" selected>' + esc((cur.name || "Chosen computer") + " — not registered right now") + "</option>";
    h += "</select>";
    if (wrap._pdpHtml !== h) {
      /* never yank the select out from under an open interaction - the next 5s
         tick repaints once focus has left (transcript-box-destroyed class) */
      if (wrap.contains(document.activeElement)) return;
      wrap.innerHTML = h; wrap._pdpHtml = h;
    }
  }

  function onChange(ev) {
    var t = ev && ev.target;
    if (!t || t.id !== SEL_ID) return;
    var id = String(t.value || "auto");
    var opt = t.options[t.selectedIndex];
    set(id, opt ? String(opt.getAttribute("data-name") || opt.textContent || "") : "");
    safe(function () {
      if (typeof window.toast !== "function") return;
      var v = stored();
      window.toast(v ? ('Athena pulls will run on "' + (v.name || "the chosen computer") + '".') : "Athena pulls back to Auto — your office computer.", "ok");
    });
  }

  function installStyle() {
    if (byId(STYLE_ID)) return;
    var s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent =
      "#" + WRAP_ID + "{display:inline-flex;align-items:center;gap:6px;margin-right:10px;vertical-align:middle;}" +
      "#" + WRAP_ID + " label{font:600 11.5px system-ui;color:#5f7569;white-space:nowrap;}" +
      "#" + WRAP_ID + " select{border:1px solid #cfdcd3;border-radius:8px;background:#fff;color:#204034;font:600 12px system-ui;padding:6px 8px;max-width:230px;cursor:pointer;}" +
      "@media(max-width:640px){#" + WRAP_ID + "{display:flex;margin:0 0 6px;}#" + WRAP_ID + " select{flex:1;max-width:none;}}";
    (document.head || document.documentElement).appendChild(s);
  }

  function tick() { fetchDevices(false); render(); }

  function boot() {
    if (disposed) return;
    installStyle();
    safe(function () { document.addEventListener("change", onChange, true); });
    iv = setInterval(function () { safe(tick); }, 5000);
    fetchDevices(true);
    render();
  }

  var api = {
    installed: true, version: VERSION,
    get: get, set: set,
    refresh: function () { fetchDevices(true); render(); },
    _test: { optionLabel: optionLabel, stored: stored },
    revert: function () {
      disposed = true;
      safe(function () { clearInterval(iv); });
      safe(function () { document.removeEventListener("change", onChange, true); });
      var w = byId(WRAP_ID); if (w) w.remove();
      var st = byId(STYLE_ID); if (st) st.remove();
      try { delete window[NS]; } catch (e) { window[NS] = null; }
    }
  };
  window[NS] = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
