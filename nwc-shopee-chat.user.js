// ==UserScript==
// @name         好好禮車｜蝦皮聊聊未讀提醒
// @namespace    https://nicoletai-cloud.github.io/
// @version      1.1
// @description  開著蝦皮聊聊頁，每分鐘把「未讀」聊聊回報給好好禮車系統；超過 15 分鐘沒看，好好禮車機器人會在 LINE 提醒。只讀清單，不會打開對話、不會幫你回覆。
// @match        https://seller.shopee.tw/new-webchat/*
// @match        https://accounts.shopee.tw/seller/login*
// @match        https://nicoletai-cloud.github.io/nice-wedding-procession/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @noframes
// ==/UserScript==
(function () {
  'use strict';
  var URL = 'https://script.google.com/macros/s/AKfycbwoKk13j5YOtkA5cTh3FtvECekYm0uMBPsid1H--kB7bhUVpDFvSnSA0iTzCfc8IT11_Q/exec';
  var CHAT = 'https://seller.shopee.tw/new-webchat/conversations';

  GM_registerMenuCommand('設定好好禮車金鑰', function () {
    var k = prompt('請輸入好好禮車系統的金鑰（只存在這台電腦的 Tampermonkey 裡）', '');
    if (k !== null) { GM_setValue('key', k.trim()); alert(k.trim() ? '已儲存，開始回報蝦皮未讀聊聊' : '已清除金鑰'); location.reload(); }
  });
  // 1.1 金鑰自動帶入：在這台電腦打開「好好禮車婚禮派車」時，從派車系統已存好的設定讀金鑰，存進 Tampermonkey（不顯示、不用手打）
  if (location.hostname === 'nicoletai-cloud.github.io') {
    try { var ws = JSON.parse(localStorage.getItem('nwcw_settings') || '{}') || {}, k2 = String(ws.driveKey || '').trim();
      if (k2 && k2 !== GM_getValue('key', '')) { GM_setValue('key', k2); var n = document.createElement('div'); n.textContent = '好好禮車｜蝦皮聊聊提醒已自動帶入金鑰，回到蝦皮聊聊分頁重新整理即可'; n.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;background:#7A5A2B;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:8px'; document.body.appendChild(n); setTimeout(function () { n.remove(); }, 6000); }
    } catch (e) {}
    return;
  }
  var key = GM_getValue('key', '');
  if (!key) { badge('尚未帶入金鑰：請在這台電腦打開「好好禮車婚禮派車」一次，再回來重新整理', true); return; }

  function send(body, cb) {
    body.token = key; body.action = 'shopeeChat';
    GM_xmlhttpRequest({ method: 'POST', url: URL, data: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      onload: function (r) { cb && cb(r.status < 400 && !/金鑰不正確/.test(r.responseText || '')); }, onerror: function () { cb && cb(false); } });
  }

  // 登入頁＝被登出：每 10 分鐘最多回報一次
  if (location.hostname === 'accounts.shopee.tw') {
    var last = +GM_getValue('outAt', 0);
    if (Date.now() - last > 600e3) { GM_setValue('outAt', Date.now()); send({ loggedOut: true }); }
    setTimeout(function () { location.href = CHAT; }, 15 * 60e3);   // 15 分鐘後再試一次（你登入後會自動恢復）
    return;
  }

  function txt(e) { return (e && (e.textContent || '') || '').trim(); }
  function leaf(re) { return [].slice.call(document.querySelectorAll('span,div,button,label')).filter(function (e) { return e.children.length === 0 && re.test(txt(e)); }); }
  function click(re) { var e = leaf(re)[0]; if (e) { e.click(); return true; } return false; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 切到「全部聊聊」→ 過濾 →「未讀」（不會點開任何對話）
  async function setup() {
    for (var i = 0; i < 30 && !leaf(/^全部聊聊$/).length; i++) await wait(1000);
    click(/^全部聊聊$/); await wait(1500);
    if (!click(/^過濾$/)) return false; await wait(800);
    var un = leaf(/^未讀$/)[0]; if (!un) return false;
    (un.closest('label') || un).click(); await wait(400);
    click(/^確認$/); await wait(2000);
    return true;
  }

  function read() {
    var hdr = leaf(/^全部買家$/)[0]; if (!hdr) return null;
    var row = hdr; while (row && row.parentElement && !/innerScrollContainer/.test(String(row.parentElement.className))) row = row.parentElement;
    if (!row || !row.parentElement) return { items: [], complete: true };
    var items = [], sib = row.nextElementSibling;
    while (sib && items.length < 50) {
      var t = (sib.innerText || '').split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^\d{1,3}\+?$/.test(x); });
      if (t.length >= 2) items.push({ name: t[0], time: t[1], text: t.slice(2).join(' ').slice(0, 300) });
      sib = sib.nextElementSibling;
    }
    return { items: items, complete: true };
  }

  var okSetup = false, fails = 0;
  function tick() {
    if (!okSetup) return;
    var r = read(); if (!r) { badge('讀不到聊聊清單（蝦皮可能改版）', true); return; }
    send(r, function (ok) { fails = ok ? 0 : fails + 1; badge(ok ? '蝦皮未讀提醒運作中｜未讀 ' + r.items.length + '｜' + new Date().toTimeString().slice(0, 5) : '回報失敗（' + fails + '）', !ok); });
  }

  function badge(msg, bad) {
    var b = document.getElementById('nwc-sp-badge');
    if (!b) { b = document.createElement('div'); b.id = 'nwc-sp-badge'; b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:12px/1.4 system-ui,sans-serif;padding:4px 8px;border-radius:6px;color:#fff;opacity:.85;pointer-events:none'; (document.body || document.documentElement).appendChild(b); }
    b.style.background = bad ? '#C0453A' : '#7A5A2B'; b.textContent = '好好禮車｜' + msg;
  }

  setup().then(function (ok) { okSetup = ok; if (!ok) badge('設定「未讀」過濾失敗，30 秒後重新整理', true), setTimeout(function () { location.href = CHAT; }, 30e3); else { tick(); setInterval(tick, 60e3); } });
  setTimeout(function () { location.href = CHAT; }, 20 * 60e3);   // 每 20 分鐘重新整理一次，避免頁面卡住
})();
