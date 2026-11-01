// ==UserScript==
// @name         好好禮車｜TimeTree 2768 自動同步（Vincent 機場單）＋官方帳號人工回覆偵測
// @namespace    https://nicoletai-cloud.github.io/
// @version      1.1
// @description  開著 TimeTree 2768 分頁，每 3 分鐘向好好禮車系統拿「Vincent 已確認接案」的機場／接送／包車趟次，自動新增或更新到 2768；改派或取消的會標成【已改派】（不刪除）。
// @match        https://timetreeapp.com/*
// @match        https://chat.line.biz/*
// @match        https://nicoletai-cloud.github.io/nice-wedding-procession/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @noframes
// ==/UserScript==
(function () {
  'use strict';
  var URL = 'https://script.google.com/macros/s/AKfycbwoKk13j5YOtkA5cTh3FtvECekYm0uMBPsid1H--kB7bhUVpDFvSnSA0iTzCfc8IT11_Q/exec';
  var CID = 85538428, CAL = 'H3mWcnDaKup1', VINCENT = 42745153, TZ = 'Asia/Taipei', EVERY = 3 * 60e3;
  var MK = function (c) { return '〔機場單 ' + c + '｜系統同步〕'; };

  // 金鑰自動帶入：在這台電腦打開「好好禮車婚禮派車」時，從派車系統已存好的設定讀金鑰，存進 Tampermonkey（不顯示、不用手打）
  if (location.hostname === 'nicoletai-cloud.github.io') {
    try { var ws = JSON.parse(localStorage.getItem('nwcw_settings') || '{}') || {}, k2 = String(ws.driveKey || '').trim();
      if (k2 && k2 !== GM_getValue('key', '')) GM_setValue('key', k2);
    } catch (e) {}
    return;
  }

  // 2026-11-01 Nicole：官方帳號後台（chat.line.biz）分頁開著時，每 3 分鐘看「還沒回覆」的客人：
  // 你在後台／手機 App 手動回過（之後客人沒再傳新訊息）→ 通知機器人把提醒消掉、機器人也不再接話。
  // 只讀取訊息，不會傳訊息、不會改已讀。
  if (location.hostname === 'chat.line.biz') { lineWatch(); return; }

  var badgeEl = null;
  function badge(t, bad) {
    if (!badgeEl) { badgeEl = document.createElement('div'); badgeEl.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;font:12px/1.5 sans-serif;padding:6px 10px;border-radius:8px;max-width:360px;white-space:pre-line;box-shadow:0 2px 8px rgba(0,0,0,.2)'; document.body.appendChild(badgeEl); }
    badgeEl.style.background = bad ? '#fbeee6' : '#f3ece2'; badgeEl.style.color = bad ? '#b4532a' : '#5a4630';
    badgeEl.textContent = '好好禮車｜2768 同步：' + t;
  }
  function bot(body) {
    return new Promise(function (res, rej) {
      body.token = GM_getValue('key', '');
      GM_xmlhttpRequest({ method: 'POST', url: URL, data: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        onload: function (r) { try { res(JSON.parse(r.responseText)); } catch (e) { rej(new Error('機器人回應看不懂')); } }, onerror: function () { rej(new Error('連不到機器人')); } });
    });
  }
  function H() { return { 'X-TimeTreeA': 'web/2.1.0/zh-TW', 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': (document.querySelector('meta[name=csrf-token]') || {}).content || '' }; }
  async function events() {
    var since = 0, all = [];
    for (var i = 0; i < 40; i++) {
      var r = await fetch('/api/v1/calendar/' + CID + '/events?since=' + since, { headers: H() });
      if (!r.ok) throw new Error('讀不到 TimeTree（' + r.status + '），可能被登出');
      var j = await r.json(); all = all.concat(j.events || []);
      if (!j.chunk || !(j.events || []).length) break; since = j.since;
    }
    return all.filter(function (e) { return !e.deactivated_at; });
  }
  var busy = false;
  async function run() {
    if (busy) return; busy = true;
    try {
      if (!GM_getValue('key', '')) { badge('尚未帶入金鑰：請在這台電腦打開「好好禮車婚禮派車」一次，再回來重新整理', true); return; }
      var J = await bot({ action: 'ttAirJobs' });
      if (!J || !J.ok) { badge('機器人回覆錯誤：' + ((J && J.error) || '?'), true); return; }
      var live = await events(), day = function (t) { return new Date(t + 8 * 36e5).toISOString().slice(0, 10); }, n = { add: 0, upd: 0, gone: 0 }, errs = [];
      for (var k = 0; k < J.jobs.length; k++) {
        var j = J.jobs[k];
        var ev = live.find(function (e) { return (e.note || '').indexOf(MK(j.code)) >= 0; }) ||
                 live.find(function (e) { return (e.note || '').indexOf('單號：' + j.code) >= 0 && (!j.date || day(e.start_at) === j.date) && !/〔機場單 /.test(e.note || ''); });
        if (j.gone) {
          if (!ev || /^【已改派】/.test(ev.title || '')) continue;
          var gb = { title: '【已改派】' + ev.title, note: '這趟已經不是 Vincent 的任務（已改派其他司機或取消），請忽略。\n\n' + (ev.note || ''), label_id: ev.label_id, all_day: ev.all_day, start_at: ev.start_at, end_at: ev.end_at, start_timezone: TZ, end_timezone: TZ };
          var rg = await fetch('/api/v1/calendar/' + CID + '/event/' + ev.id, { method: 'PUT', headers: H(), body: JSON.stringify(gb) });
          if (rg.ok) n.gone++; else errs.push('標記已改派失敗 ' + j.code + '（' + rg.status + '）');
          continue;
        }
        var note = j.note.trim() + '\n\n' + MK(j.code);
        var body = { title: j.title, note: note, label_id: j.label, all_day: false, start_at: j.start, end_at: j.end, start_timezone: TZ, end_timezone: TZ, attendees: [VINCENT] };
        if (ev) {
          if (ev.note === note && ev.title === j.title && ev.start_at === j.start && ev.end_at === j.end && ev.label_id === j.label) continue;
          var ru = await fetch('/api/v1/calendar/' + CID + '/event/' + ev.id, { method: 'PUT', headers: H(), body: JSON.stringify(body) });
          if (ru.ok) n.upd++; else errs.push('更新失敗 ' + j.code + '（' + ru.status + '）');
        } else {
          var ra = await fetch('/api/v1/calendar/' + CID + '/event', { method: 'POST', headers: H(), body: JSON.stringify(body) });
          if (ra.ok) n.add++; else errs.push('新增失敗 ' + j.code + '（' + ra.status + '）');
        }
      }
      var now = new Date(), hm = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
      badge(hm + ' 已同步' + (n.add || n.upd || n.gone ? '（新增 ' + n.add + '、更新 ' + n.upd + '、已改派 ' + n.gone + '）' : '，沒有變動') + (errs.length ? '\n' + errs.join('\n') : ''), errs.length > 0);
    } catch (e) { badge(String(e.message || e), true); }
    finally { busy = false; }
  }
  function lineWatch() {
    var bel = null;
    function lb(t, bad) {
      if (!bel) { bel = document.createElement('div'); bel.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;font:12px/1.5 sans-serif;padding:6px 10px;border-radius:8px;max-width:360px;white-space:pre-line;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none;opacity:.9'; document.body.appendChild(bel); }
      bel.style.background = bad ? '#fbeee6' : '#f3ece2'; bel.style.color = bad ? '#b4532a' : '#5a4630';
      bel.textContent = '好好禮車｜人工回覆偵測：' + t;
    }
    var busy2 = false;
    async function scan() {
      if (busy2) return; busy2 = true;
      try {
        if (!GM_getValue('key', '')) { lb('尚未帶入金鑰：請在這台電腦打開「好好禮車婚禮派車」一次，再回來重新整理', true); return; }
        var m = location.pathname.match(/^\/(U[0-9a-f]{32})/); if (!m) { lb('請停在「好好禮車」官方帳號的聊天頁', true); return; }
        var bid = m[1], J = await bot({ action: 'oaHuman', list: [] });
        if (!J || !J.ok) { lb('機器人回覆錯誤：' + ((J && J.error) || '?'), true); return; }
        var list = [], ids = (J.watch || []).slice(0, 40);
        for (var i = 0; i < ids.length; i++) {
          var r = await fetch('/api/v3/bots/' + bid + '/chats/' + ids[i] + '/messages', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
          if (r.status === 401 || r.status === 403) { lb('官方帳號後台被登出了，請重新登入', true); return; }
          if (!r.ok) continue;
          var ev = ((await r.json()).list) || [], hu = 0, cu = 0;
          ev.forEach(function (e) {
            if (e.type === 'message' && e.timestamp > cu) cu = e.timestamp;   // 客人傳的
            if (e.type === 'messageSent' && e.sendId && e.bizId && !/^__/.test(String(e.bizId)) && e.timestamp > hu) hu = e.timestamp;   // 真人（後台／App）傳的；機器人、自動回應沒有 sendId
          });
          if (hu) list.push({ uid: ids[i], humanAt: hu, custAt: cu });
        }
        var R2 = list.length ? await bot({ action: 'oaHuman', list: list }) : J;
        var now = new Date(), hm = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
        lb(hm + ' 已檢查 ' + ids.length + ' 位' + (R2 && R2.cleared ? '，' + R2.cleared + ' 位已人工回覆、提醒已消掉' : ''));
      } catch (e) { lb(String(e.message || e), true); }
      finally { busy2 = false; }
    }
    setTimeout(scan, 5000); setInterval(scan, EVERY);
  }
  if (location.pathname.indexOf('/calendars/' + CAL) !== 0) { badge('這個分頁要停在 2768 行事曆才會同步'); return; }
  setTimeout(run, 4000); setInterval(run, EVERY);
})();
