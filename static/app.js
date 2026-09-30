/* 宝记 前端：响应式 SPA，hash 路由，移动端优先。 */
(function () {
  "use strict";

  const NAV = [
    { key: "overview", label: "概览", ico: "🏠" },
    { key: "feeding", label: "喂养", ico: "🍼" },
    { key: "sleep", label: "睡眠", ico: "😴" },
    { key: "diaper", label: "尿布", ico: "💧" },
    { key: "growth", label: "生长", ico: "📈" },
    { key: "health", label: "健康", ico: "🩺" },
    { key: "milestone", label: "事件", ico: "⭐" },
    { key: "photos", label: "照片", ico: "📷" },
    { key: "settings", label: "设置", ico: "⚙️" },
  ];
  const MOBILE_NAV_HIDE = new Set(["settings"]);   // 移动端底部导航隐藏项（设置走顶部 ⚙ 按钮）

  let token = localStorage.getItem("baoji_token") || "";
  let authRequired = true;
  let baby = null;            // 单宝宝对象
  let whoLms = null;          // WHO LMS 参考缓存
  const LIST_CACHE = {};      // 各模块当前列表（供编辑弹窗取值）

  // ---------- 工具 ----------
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 1800);
  }
  async function api(method, path, body, isForm) {
    const headers = { "X-Token": token };
    const opts = { method, headers };
    if (body) {
      if (isForm) opts.body = body;
      else { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    }
    const res = await fetch("/api" + path, opts);
    if (res.status === 401) { logout(); throw new Error("未授权"); }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.detail || "请求失败");
    }
    if (res.status === 204) return null;
    return res.json();
  }
  async function download(path, fname) {
    const res = await fetch("/api" + path, { headers: { "X-Token": token } });
    if (!res.ok) { toast("导出失败"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname; a.click();
    URL.revokeObjectURL(url);
    toast("已开始下载");
  }
  function nowLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  function toISO(v) { return !v ? null : (v.length === 16 ? v + ":00" : v); }
  function dtVal(v) { return v ? String(v).slice(0, 16) : ""; }   // datetime-local 回填
  function fmt(dt) { return !dt ? "—" : String(dt).replace("T", " ").slice(0, 16); }
  function fmtDate(d) { return d ? String(d).slice(0, 10) : "—"; }
  function v(id) { const el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function num(id) { const el = document.getElementById(id); if (!el) return null; const x = el.value; return x === "" ? null : parseFloat(x); }
  function emptyMsg() { return `<div class="empty">暂无记录</div>`; }
  /** 应种日天数 → 友好文案：负数不再显示"还有 -3 天" */
  function dueText(x) {
    if (x.days_left == null) return "";
    if (x.days_left > 0) return `还有 ${x.days_left} 天`;
    if (x.days_left === 0) return "就是今天";
    return `已过 ${-x.days_left} 天`;
  }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function isVideo(fname) { return /\.(mp4|mov|m4v|webm|avi|3gp)$/i.test(String(fname || "")); }
  function mediaThumb(fname, cls) {
    const src = "/static/uploads/" + fname;
    if (isVideo(fname)) {
      // #t=0.1 强制定位到开头帧；preload=metadata 只拉头部数据，不整段加载
      return `<video class="${cls || "thumb"}" src="${src}#t=0.1" muted preload="metadata" playsinline></video>`;
    }
    // 小图走服务端 320px 缩略图缓存；生成失败（如 HEIC）回退原图
    const full = encodeURIComponent(fname);
    return `<img class="${cls || "thumb"}" src="/media-thumb?f=${full}" alt="" loading="lazy" decoding="async"
      onerror="this.onerror=null;this.src='${src}'">`;
  }

  // ---------- 登录 / 启动 ----------
  async function doLogin() {
    const fd = new URLSearchParams();
    fd.set("password", document.getElementById("pwd").value);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fd,
    });
    if (!res.ok) { toast("口令错误"); return; }
    const data = await res.json();
    token = data.token;
    localStorage.setItem("baoji_token", token);
    await enterApp();
  }
  function logout() {
    token = "";
    localStorage.removeItem("baoji_token");
    document.getElementById("app").style.display = "none";
    document.getElementById("login").style.display = "flex";
  }

  async function bootstrap() {
    try {
      const cfg = await (await fetch("/api/config")).json();
      authRequired = cfg.auth_required;
    } catch (e) { authRequired = true; }
    if (!authRequired) {
      token = "noauth";
      localStorage.setItem("baoji_token", token);
      await enterApp();
    } else if (token) {
      api("GET", "/me").then(enterApp).catch(logout);
    } else {
      document.getElementById("login").style.display = "flex";
    }
  }

  async function enterApp() {
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "block";
    renderNav();
    await loadBaby();
    if (!location.hash) location.hash = "#overview";
    route();
  }
  async function loadBaby() {
    try { baby = await api("GET", "/baby"); } catch (e) { baby = null; }
    updateTags();
  }
  function updateTags() {
    document.getElementById("babyTag").textContent = baby ? baby.name : "";
    document.getElementById("dolTag").textContent = baby ? `出生第 ${baby.dol} 天` : "";
  }

  // ---------- 导航 ----------
  function renderNav() {
    const nav = document.getElementById("nav");
    const bn = document.getElementById("bottomNav");
    nav.innerHTML = ""; bn.innerHTML = "";
    NAV.forEach((n) => {
      const a = document.createElement("div");
      a.className = "nav-item"; a.dataset.key = n.key;
      a.innerHTML = `<span class="ico">${n.ico}</span><span>${n.label}</span>`;
      a.onclick = () => (location.hash = "#" + n.key);
      nav.appendChild(a);
      if (MOBILE_NAV_HIDE.has(n.key)) return;   // 移动端隐藏（如设置）
      const b = document.createElement("div");
      b.className = "nav-item"; b.dataset.key = n.key;
      b.innerHTML = `<span class="ico">${n.ico}</span><span class="txt">${n.label}</span>`;
      b.onclick = () => (location.hash = "#" + n.key);
      bn.appendChild(b);
    });
    document.getElementById("logoutBtn").onclick = logout;
    const topBtn = document.getElementById("topSettings");
    if (topBtn) topBtn.onclick = () => (location.hash = "#settings");
  }
  function setActive(key) {
    document.querySelectorAll(".nav-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.key === key);
    });
  }

  // ---------- 路由 ----------
  function route() {
    const key = (location.hash || "#overview").slice(1);
    setActive(key);
    const view = document.getElementById("view");
    view.scrollTop = 0;
    const map = {
      overview: renderOverview, feeding: renderFeeding, sleep: renderSleep,
      diaper: renderDiaper, growth: renderGrowth, health: renderHealth,
      milestone: renderMilestone, photos: renderPhotos, settings: renderSettings,
    };
    (map[key] || renderOverview)(view);
  }
  window.addEventListener("hashchange", route);

  function needBaby(view) {
    if (!baby) { view.innerHTML = `<div class="empty">宝宝信息加载中，请稍候或到「设置」完善。</div>`; return false; }
    return true;
  }

  // ---------- 通用编辑弹窗 ----------
  const EDIT_SPECS = {
    sleeps: [
      { k: "start_time", label: "开始", type: "datetime-local" },
      { k: "end_time", label: "结束（可空）", type: "datetime-local" },
      { k: "note", label: "备注", type: "text" },
    ],
    diapers: [
      { k: "diaper_type", label: "类型", type: "select", options: [["wet", "尿"], ["poop", "便"], ["mixed", "混合"]] },
      { k: "time", label: "更换时间", type: "datetime-local" },
      { k: "stool_desc", label: "便便描述", type: "text" },
      { k: "note", label: "备注", type: "text" },
    ],
    temperatures: [
      { k: "value", label: "体温 ℃", type: "number", step: "0.1" },
      { k: "time", label: "时间", type: "datetime-local" },
      { k: "note", label: "备注", type: "text" },
    ],
    medications: [
      { k: "med_name", label: "药名", type: "text" },
      { k: "dose", label: "剂量", type: "text" },
      { k: "time", label: "本次时间", type: "datetime-local" },
      { k: "next_dose_at", label: "下次服药（提醒）", type: "datetime-local" },
      { k: "note", label: "备注", type: "text" },
    ],
    vaccines: [
      { k: "name", label: "名称", type: "text" },
      { k: "date", label: "接种日期", type: "date" },
      { k: "due_date", label: "应接种日", type: "date" },
      { k: "done", label: "已接种", type: "checkbox" },
      { k: "note", label: "备注", type: "text" },
    ],
    growths: [
      { k: "record_date", label: "日期", type: "date" },
      { k: "weight_kg", label: "体重 kg", type: "number", step: "0.01" },
      { k: "height_cm", label: "身长 cm", type: "number", step: "0.1" },
      { k: "head_cm", label: "头围 cm", type: "number", step: "0.1" },
      { k: "note", label: "备注", type: "text" },
    ],
    milestones: [
      { k: "date", label: "日期", type: "date" },
      { k: "content", label: "内容", type: "textarea" },
    ],
  };

  function closeModal() {
    const m = document.getElementById("modalMask");
    if (m) m.remove();
  }
  /** 按钮忙碌态：执行期间禁用并显示进度文字，完成后恢复；防重复提交。setT 可中途更新文字 */
  async function withBusy(btn, text, fn) {
    if (!btn || btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    const old = btn.textContent;
    btn.disabled = true; btn.style.opacity = ".6"; btn.textContent = text;
    const setT = (t) => { btn.textContent = t; };
    try { await fn(setT); }
    finally { btn.dataset.busy = ""; btn.disabled = false; btn.style.opacity = ""; btn.textContent = old; }
  }

  /** 通用表单弹窗。fields: [{k,label,type,options,step,placeholder,flex}]；onSave(vals) 返回 Promise */
  function openFormModal(title, fields, initial, onSave) {
    closeModal();
    const mask = document.createElement("div");
    mask.className = "modal-mask"; mask.id = "modalMask";
    const body = fields.map((f) => {
      const val = initial ? initial[f.k] : "";
      const flex = f.flex ? `style="flex:1 1 100%;"` : "";
      if (f.type === "select") {
        const opts = f.options.map(([val2, lab]) =>
          `<option value="${val2}" ${String(val) === String(val2) ? "selected" : ""}>${lab}</option>`).join("");
        return `<div class="field" ${flex}><label>${f.label}</label><select data-k="${f.k}">${opts}</select></div>`;
      }
      if (f.type === "checkbox") {
        return `<div class="field" ${flex}><label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" data-k="${f.k}" ${val ? "checked" : ""}> ${f.label}</label></div>`;
      }
      if (f.type === "textarea") {
        return `<div class="field" ${flex}><label>${f.label}</label><textarea data-k="${f.k}">${escapeHtml(val)}</textarea></div>`;
      }
      const dv = f.type === "datetime-local" ? dtVal(val) : (val == null ? "" : val);
      return `<div class="field" ${flex}><label>${f.label}</label>
        <input data-k="${f.k}" type="${f.type}" ${f.step ? `step="${f.step}"` : ""} value="${escapeHtml(dv)}" ${f.placeholder ? `placeholder="${f.placeholder}"` : ""}></div>`;
    }).join("");
    mask.innerHTML = `<div class="modal">
      <h3>${escapeHtml(title)}</h3>
      <div class="row">${body}</div>
      <div class="form-actions">
        <button class="btn sec" id="modalCancel" style="width:auto;">取消</button>
        <button class="btn" id="modalSave" style="width:auto;">保存</button>
      </div></div>`;
    document.body.appendChild(mask);
    mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(); });
    document.getElementById("modalCancel").onclick = closeModal;
    document.getElementById("modalSave").onclick = async () => {
      const vals = {};
      mask.querySelectorAll("[data-k]").forEach((el) => {
        const k = el.dataset.k;
        if (el.type === "checkbox") vals[k] = el.checked;
        else if (el.type === "number") vals[k] = el.value === "" ? null : parseFloat(el.value);
        else if (el.type === "datetime-local") vals[k] = toISO(el.value);
        else vals[k] = el.value.trim();
      });
      try {
        await onSave(vals);
        closeModal();
      } catch (e) { toast(e.message); }
    };
  }

  window.editRec = function (kind, id) {
    let rec = (LIST_CACHE[kind] || []).find((x) => x.id === id);
    if (!rec) { toast("记录不存在"); return; }
    if (kind === "feedings") return openFeedingModal(rec);
    if (kind === "diapers" && !rec.time) rec = { ...rec, time: rec.created_at };  // 旧记录兜底
    const spec = EDIT_SPECS[kind];
    if (!spec) { toast("该类型暂不支持编辑"); return; }
    openFormModal("编辑记录", spec, rec, async (vals) => {
      await api("PUT", "/" + kind + "/" + id, vals);
      toast("已更新");
      route();
    });
  };

  // 喂养会话编辑（开始/结束/备注 + 多种奶量明细）
  function openFeedingModal(sess) {
    closeModal();
    const mask = document.createElement("div");
    mask.className = "modal-mask"; mask.id = "modalMask";
    mask.innerHTML = `<div class="modal"><h3>编辑喂养</h3>
      <div class="row">
        <div class="field"><label>开始时间</label><input id="ef_start" type="datetime-local" value="${dtVal(sess.start_time)}"></div>
        <div class="field"><label>结束时间（可空）</label><input id="ef_end" type="datetime-local" value="${dtVal(sess.end_time)}"></div>
      </div>
      <div class="meta" style="margin:8px 0 6px;">本场奶量明细（可添加/删除）</div>
      <div id="ef_lines"></div>
      <button class="btn sec" id="ef_add" style="width:auto;padding:6px 12px;">＋ 添加一种奶</button>
      <div class="row" style="margin-top:10px;"><div class="field" style="flex:1 1 100%;">
        <label>备注</label><input id="ef_note" value="${escapeHtml(sess.note || "")}"></div></div>
      <div class="form-actions">
        <button class="btn sec" id="ef_cancel" style="width:auto;">取消</button>
        <button class="btn" id="ef_save" style="width:auto;">保存</button>
      </div></div>`;
    document.body.appendChild(mask);
    mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(); });
    const lines = document.getElementById("ef_lines");
    function addLine(type, amt) {
      const div = document.createElement("div");
      div.className = "feed-line";
      div.innerHTML = `<select class="fl_type">
          <option value="breast">母乳</option><option value="formula">奶粉</option><option value="mixed">混合</option>
        </select>
        <input class="fl_amt" type="number" step="1" placeholder="奶量 ml（可空）" value="${amt == null ? "" : amt}">
        <button class="btn danger fl_del" style="width:auto;padding:8px 12px;">✕</button>`;
      div.querySelector(".fl_type").value = type || "breast";
      div.querySelector(".fl_del").onclick = () => div.remove();
      lines.appendChild(div);
    }
    (sess.logs && sess.logs.length ? sess.logs : [{ feed_type: "breast", amount_ml: null }])
      .forEach((l) => addLine(l.feed_type, l.amount_ml));
    document.getElementById("ef_add").onclick = () => addLine("breast", null);
    document.getElementById("ef_cancel").onclick = closeModal;
    document.getElementById("ef_save").onclick = () => withBusy(document.getElementById("ef_save"), "保存中…", async () => {
      const logs = [...lines.querySelectorAll(".feed-line")].map((d) => ({
        feed_type: d.querySelector(".fl_type").value,
        amount_ml: d.querySelector(".fl_amt").value === "" ? null : parseFloat(d.querySelector(".fl_amt").value),
      }));
      if (!logs.length) { toast("至少保留一种奶"); return; }
      try {
        await api("PUT", "/feedings/" + sess.id, {
          baby_id: baby.id,
          start_time: toISO(document.getElementById("ef_start").value),
          end_time: toISO(document.getElementById("ef_end").value),
          note: document.getElementById("ef_note").value.trim(),
          logs,
        });
        toast("已更新"); closeModal(); route();
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- 媒体查看器（抖音式：上下全屏、顶部信息、左右滑动切换） ----------
  let viewer = { items: [], idx: 0 };
  function closeViewer() {
    const el = document.getElementById("mediaViewer");
    if (el) el.remove();
    viewer = { items: [], idx: 0 };
  }
  function viewerShow(i) {
    const items = viewer.items;
    if (!items.length) return;
    viewer.idx = (i + items.length) % items.length;
    const it = items[viewer.idx];
    const body = document.querySelector("#mediaViewer .viewer-body");
    body.innerHTML = it.video
      ? `<video src="${it.src}" controls playsinline></video>`
      : `<img src="${it.src}" alt="">`;
    const sub = document.querySelector("#mediaViewer .vsub");
    const ttl = document.querySelector("#mediaViewer .vtitle");
    if (ttl) ttl.textContent = it.title || "";
    if (sub) sub.textContent = (it.sub || "") + (items.length > 1 ? ` · ${viewer.idx + 1}/${items.length}` : "");
    const act = document.getElementById("viewerActions");
    if (act) act.style.display = it.photoId ? "flex" : "none";
    const cnt = document.querySelector("#mediaViewer .viewer-count");
    if (cnt) cnt.textContent = items.length > 1 ? `${viewer.idx + 1} / ${items.length}` : "";
    window._viewerPhotoId = it.photoId || null;
  }
  function openViewer(items, idx) {
    closeViewer();
    viewer = { items, idx: idx || 0 };
    const mask = document.createElement("div");
    mask.className = "viewer"; mask.id = "mediaViewer";
    mask.innerHTML = `
      <div class="viewer-top">
        <div class="vmeta"><div class="vtitle"></div><div class="vsub"></div></div>
        <div id="viewerActions" style="display:none;gap:8px;">
          <button class="viewer-btn" id="viewerEdit" title="编辑备注">✏️</button>
          <button class="viewer-btn" id="viewerDel" title="删除">🗑️</button>
        </div>
        <button class="viewer-btn" id="viewerClose">✕</button>
      </div>
      <div class="viewer-body">
        <div class="viewer-nav prev" title="上一张（←）"><b>‹</b></div>
        <div class="viewer-nav next" title="下一张（→）"><b>›</b></div>
        <div class="viewer-count"></div>
      </div>`;
    document.body.appendChild(mask);
    document.getElementById("viewerClose").onclick = closeViewer;
    mask.querySelector(".viewer-nav.prev").onclick = () => viewerShow(viewer.idx - 1);
    mask.querySelector(".viewer-nav.next").onclick = () => viewerShow(viewer.idx + 1);
    document.getElementById("viewerEdit").onclick = async () => {
      const pid = window._viewerPhotoId;
      const it = viewer.items[viewer.idx];
      const nv = prompt("修改备注：", it.title || "");
      if (nv === null) return;
      try {
        await api("PUT", "/photos/" + pid, { caption: nv });
        it.title = nv; viewerShow(viewer.idx); toast("已更新"); route();
      } catch (e) { toast(e.message); }
    };
    document.getElementById("viewerDel").onclick = async () => {
      const pid = window._viewerPhotoId;
      if (!confirm("确定删除该照片/视频？")) return;
      try {
        await api("DELETE", "/photos/" + pid);
        toast("已删除"); closeViewer(); route();
      } catch (e) { toast(e.message); }
    };
    // 键盘
    viewer._key = (e) => {
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowLeft") viewerShow(viewer.idx - 1);
      else if (e.key === "ArrowRight") viewerShow(viewer.idx + 1);
    };
    document.addEventListener("keydown", viewer._key);
    // 触摸左右滑：水平滑动时接管手势（阻止浏览器页面切换/滚动），跟手位移，松手翻页
    const vbody = mask.querySelector(".viewer-body");
    let sx = 0, sy = 0, dragging = false, dx = 0;
    mask.addEventListener("touchstart", (e) => {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      dragging = true; dx = 0;
    }, { passive: true });
    mask.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();   // 关键：水平滑动由查看器接管，不再触发浏览器的页面间滑动
        vbody.classList.add("dragging");
        const media = vbody.querySelector("img, video");
        if (media) media.style.transform = `translateX(${dx * 0.6}px)`;
      }
    }, { passive: false });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      vbody.classList.remove("dragging");
      const media = vbody.querySelector("img, video");
      if (media) media.style.transform = "";
      const t = e.changedTouches && e.changedTouches[0];
      const ddx = t ? t.clientX - sx : dx;
      if (Math.abs(ddx) > 50) viewerShow(viewer.idx + (ddx < 0 ? 1 : -1));
    };
    mask.addEventListener("touchend", endDrag, { passive: true });
    mask.addEventListener("touchcancel", endDrag, { passive: true });
    viewerShow(viewer.idx);
    const obs = new MutationObserver(() => {
      if (!document.getElementById("mediaViewer")) {
        document.removeEventListener("keydown", viewer._key);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true });
  }
  function photoItems(photos) {
    return photos.map((p) => ({
      src: "/static/uploads/" + p.filename,
      video: isVideo(p.filename),
      title: p.caption || "",
      sub: fmtDate(p.uploaded_at),
      photoId: p.id,
    }));
  }

  // ---------- 概览 ----------
  async function renderOverview(view) {
    if (!needBaby(view)) return;
    let sum = null, growths = [], rem = { vaccines: [], medications: [], events: [] };
    try { sum = await api("GET", "/summary?baby_id=" + baby.id); } catch (e) {}
    try { growths = await api("GET", "/growths?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01"); } catch (e) {}
    try { rem = await api("GET", "/reminders?baby_id=" + baby.id); } catch (e) {}
    const b = baby;

    // 最近生长（含 WHO 百分位）
    let growthHtml = `<div class="empty">暂无生长记录，去「生长」页开始记录</div>`;
    if (growths.length) {
      if (!whoLms) { try { whoLms = await (await fetch("/static/who_lms.json")).json(); } catch (e) {} }
      const g = growths[0];   // 列表按日期倒序，第一条为最新
      const parts = [];
      const items = [
        ["weight_kg", "weight", "体重", " kg"],
        ["height_cm", "length", "身长", " cm"],
        ["head_cm", "head", "头围", " cm"],
      ];
      for (const [key, meas, label, unit] of items) {
        if (g[key] == null) continue;
        const pct = whoLms ? pctFor(g[key], meas, g.record_date) : null;
        parts.push(`${label} <b>${g[key]}${unit}</b>${pct != null ? `（第 ${pct} 百分位）` : ""}`);
      }
      growthHtml = `<div class="title">${fmtDate(g.record_date)}</div><div class="meta" style="margin-top:4px;">${parts.join("　") || "—"}</div>`;
    }

    // 未来 7 天提醒（疫苗 + 服药 + 未来日期事件自动转提醒）
    const weekV = rem.vaccines
      .filter((x) => x.status !== "已完成" && x.days_left != null && x.days_left <= 7)
      .sort((a, b2) => a.days_left - b2.days_left);
    const weekE = (rem.events || []).filter((x) => x.days_left != null && x.days_left >= 0 && x.days_left <= 7);
    const nowMs = Date.now();
    const weekM = (rem.medications || []).filter((m) => {
      const t = new Date(m.next_dose_at).getTime();
      return t - nowMs <= 7 * 86400e3;    // 含逾期
    });
    let weekHtml = "";
    if (weekV.length || weekM.length || weekE.length) {
      weekHtml = weekE.map((x) => `
        <div class="item"><div><div class="title">⭐ ${escapeHtml(x.name)}</div>
          <div class="meta">${x.date} · ${dueText(x)}</div></div>
          <span class="tag">${x.status}</span></div>`).join("")
        + weekV.map((x) => `
        <div class="item"><div><div class="title">💉 ${escapeHtml(x.name)}</div>
          <div class="meta">应种 ${x.due_date} · ${dueText(x)}</div></div>
          <span class="tag wet">${x.status}</span></div>`).join("")
        + weekM.map((m) => `
        <div class="item"><div><div class="title">💊 ${escapeHtml(m.med_name)}${m.dose ? " · " + escapeHtml(m.dose) : ""}</div>
          <div class="meta">下次 ${fmt(m.next_dose_at)}</div></div>
          <span class="tag wet">${m.status}</span></div>`).join("");
    } else {
      weekHtml = `<div class="empty">未来一周没有到期提醒 🎉</div>`;
    }

    view.innerHTML = `
      <div class="dol-banner">
        <div>⚫ ${b ? b.name : ""} · 出生第 <span class="big">${b ? b.dol : 0}</span> 天</div>
        <div style="opacity:.9;font-size:13px;margin-top:4px;">今日概览（${fmtDate(sum ? sum.date : new Date())}）</div>
      </div>
      <div class="stat-grid" style="margin-top:16px;">
        ${stat(sum ? sum.feeding_count : 0, "喂养次数")}
        ${stat(sum ? sum.feeding_total_ml.toFixed(0) : 0, "喂奶总量(ml)")}
        ${stat(sum ? sum.feeding_total_min : 0, "喂养时长(分)")}
        ${stat(sum ? sum.sleep_count : 0, "睡眠次数")}
        ${stat(sum ? sum.sleep_total_min : 0, "睡眠时长(分)")}
        ${stat(sum ? sum.diaper_count : 0, "换尿布(次)")}
      </div>
      <div class="card" style="margin-top:16px;">
        <h2>📈 最近生长</h2>
        <div class="list">${growthHtml}</div>
        <div class="form-actions"><button class="btn sec" style="width:auto;" onclick="location.hash='#growth'">📈 记生长</button></div>
      </div>
      <div class="card">
        <h2>🔔 未来 7 天提醒</h2>
        <div class="list">${weekHtml}</div>
        <p class="meta" style="margin:8px 0 0;">疫苗接种管理与登记在「健康 → 疫苗」；「事件」页里日期在未来的记录会自动出现在这里。</p>
      </div>`;
  }
  function stat(numVal, lbl) {
    return `<div class="stat"><div class="num">${numVal}</div><div class="lbl">${lbl}</div></div>`;
  }

  // ---------- 列表分页（默认只显示最近 2 条，「更多」展开全部） ----------
  const PAGE = {};   // key -> 当前已显示条数
  function renderList(el, key, arr, htmlFn, after, step) {
    step = step || 2;
    if (!(key in PAGE)) PAGE[key] = step;
    const n = Math.min(PAGE[key], arr.length);
    let html = arr.slice(0, n).map(htmlFn).join("");
    if (arr.length > n) {
      html += `<div style="text-align:center;padding:8px 0 2px;">
        <button class="btn sec" style="width:auto;padding:6px 16px;" data-more="${key}">更多（还有 ${arr.length - n} 条）</button></div>`;
    }
    if (!arr.length) html = emptyMsg();
    el.innerHTML = html;
    const more = el.querySelector(`[data-more="${key}"]`);
    if (more) more.onclick = () => { PAGE[key] = Math.min(PAGE[key] + (step || 2), arr.length); renderList(el, key, arr, htmlFn, after, step); };
    if (after) after();
  }

  // ---------- 按日切换总览（各模块新增卡片上方） ----------
  const DAYSEL = {};   // key -> 'YYYY-MM-DD'，缺省今天
  function todayStr() { return fmtDate(nowLocal()); }
  function shiftDate(dstr, days) {
    const d = new Date(dstr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function chip(txt) { return `<div class="dn-chip">${txt}</div>`; }
  /** 最近 7 天图表：days=标签数组，series=[{name,unit,data,type}]（type:"bar" 为条形；仅第一根 Y 轴显示网格虚线） */
  function chartCardHtml(id, title) { return `<div class="card"><h2>${title}</h2><div id="${id}" class="chart chart-sm"></div></div>`; }
  function chart7(el, days, series) {
    const chart = echarts.init(el);
    chart.setOption({
      tooltip: { trigger: "axis" },
      legend: { top: 0, itemGap: 10, textStyle: { fontSize: 10 } },
      grid: { left: 40, right: series.length > 1 ? 46 : 18, top: 32, bottom: 24 },
      xAxis: { type: "category", data: days, axisLabel: { fontSize: 10 } },
      yAxis: series.map((s, i) => ({
        type: "value", name: s.unit || "", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 },
        splitLine: { show: i === 0, lineStyle: { color: "#eef1f6" } },
      })),
      series: series.map((s, i) => s.type === "bar"
        ? { name: s.name, type: "bar", data: s.data, yAxisIndex: i, barWidth: "45%", itemStyle: { color: "#9fb4cf", borderRadius: [3, 3, 0, 0] } }
        : { name: s.name, type: "line", data: s.data, yAxisIndex: i, smooth: true, symbolSize: 5, itemStyle: { color: "#4a90d9" } }),
    });
  }
  /** 最近 7 天的日期键与短标签 */
  function last7() {
    const keys = [], labels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
      keys.push(`${y}-${m}-${dd}`); labels.push(`${m}-${dd}`);
    }
    return { keys, labels };
  }
  function dayNavHtml(key) {
    const d = DAYSEL[key] || todayStr();
    return `<div class="card day-nav">
      <div class="dn-row">
        <button class="btn sec" style="width:auto;padding:6px 12px;" data-dn="prev" data-key="${key}">‹</button>
        <input type="date" value="${d}" data-dn="date" data-key="${key}">
        <button class="btn sec" style="width:auto;padding:6px 12px;" data-dn="next" data-key="${key}">›</button>
        <button class="btn sec" style="width:auto;padding:6px 12px;" data-dn="today" data-key="${key}">今天</button>
      </div>
      <div class="dn-stats" id="dn_stats_${key}"></div>
    </div>`;
  }
  function bindDayNav(view, key, compute) {
    const statsEl = document.getElementById("dn_stats_" + key);
    if (!statsEl) return;
    const upd = () => {
      const d = DAYSEL[key] || todayStr();
      const html = compute(d);
      statsEl.innerHTML = html || `<div class="dn-chip">当日暂无记录</div>`;
    };
    view.querySelectorAll(`[data-dn][data-key="${key}"]`).forEach((el) => {
      const role = el.dataset.dn;
      if (role === "date") {
        el.onchange = () => { DAYSEL[key] = el.value || todayStr(); upd(); };
      } else {
        el.onclick = () => {
          const cur = DAYSEL[key] || todayStr();
          if (role === "prev") DAYSEL[key] = shiftDate(cur, -1);
          else if (role === "next") DAYSEL[key] = shiftDate(cur, 1);
          else DAYSEL[key] = todayStr();
          const inp = view.querySelector(`input[data-dn="date"][data-key="${key}"]`);
          if (inp) inp.value = DAYSEL[key];
          upd();
        };
      }
    });
    upd();
  }

  // ---------- 喂养（一场 = 开始/结束 + 多种奶量明细） ----------
  function feedLineHtml() {
    return `<div class="feed-line">
      <select class="fl_type">
        <option value="breast">母乳</option><option value="formula">奶粉</option><option value="mixed">混合</option>
      </select>
      <input class="fl_amt" type="number" step="1" placeholder="奶量 ml（可空）">
      <button class="btn danger fl_del" style="width:auto;padding:8px 12px;">✕</button>
    </div>`;
  }
  async function renderFeeding(view) {
    if (!needBaby(view)) return;
    view.innerHTML = `
      ${chartCardHtml("f_chart", "🍼 近 7 天喂养")}
      <div class="card">
        <h2>🍼 新增喂养</h2>
        <div class="row">
          <div class="field"><label>开始时间</label><input id="f_start" type="datetime-local" value="${nowLocal()}"></div>
          <div class="field"><label>结束时间（可选）</label><input id="f_end" type="datetime-local"></div>
        </div>
        <div class="meta" style="margin:10px 0 6px;">本场奶量明细（同一开始时间可记录不同类型、不同量）</div>
        <div id="f_lines">${feedLineHtml()}</div>
        <button class="btn sec" id="f_add" style="width:auto;padding:6px 12px;">＋ 添加一种奶</button>
        <div class="row" style="margin-top:12px;">
          <div class="field" style="flex:1 1 100%;"><label>备注</label><input id="f_note" placeholder="可选"></div>
        </div>
        <div class="form-actions"><button class="btn" id="f_save">保存</button></div>
      </div>
      <div class="card"><h2>近期记录</h2><div class="list" id="f_list"></div></div>`;
    const lines = document.getElementById("f_lines");
    document.getElementById("f_add").onclick = () => {
      lines.insertAdjacentHTML("beforeend", feedLineHtml());
      bindLineDel();
    };
    function bindLineDel() {
      lines.querySelectorAll(".fl_del").forEach((b) => {
        b.onclick = () => {
          if (lines.querySelectorAll(".feed-line").length <= 1) { toast("至少保留一种奶"); return; }
          b.closest(".feed-line").remove();
        };
      });
    }
    bindLineDel();
    document.getElementById("f_save").onclick = () => withBusy(document.getElementById("f_save"), "保存中…", async () => {
      const logs = [...lines.querySelectorAll(".feed-line")].map((d) => ({
        feed_type: d.querySelector(".fl_type").value,
        amount_ml: d.querySelector(".fl_amt").value === "" ? null : parseFloat(d.querySelector(".fl_amt").value),
      }));
      try {
        await api("POST", "/feedings", {
          baby_id: baby.id,
          start_time: toISO(v("f_start")),
          end_time: toISO(v("f_end")),
          note: v("f_note"),
          logs,
        });
        toast("已保存"); renderFeeding(view);
      } catch (e) { toast(e.message); }
    });
    const list = await api("GET", "/feedings?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01");
    LIST_CACHE.feedings = list;
    {
      const { keys, labels } = last7();
      const cnt = keys.map(() => 0), ml = keys.map(() => 0);
      for (const x of list) {
        const i = keys.indexOf(String(x.start_time).slice(0, 10));
        if (i < 0) continue;
        cnt[i] += 1;
        ml[i] = +((ml[i] || 0) + (x.logs || []).reduce((a, l) => a + (l.amount_ml || 0), 0)).toFixed(1);
      }
      chart7(document.getElementById("f_chart"), labels, [
        { name: "奶量", unit: "ml", data: ml, type: "bar" },
        { name: "次数", unit: "次", data: cnt },
      ]);
    }
    renderList(document.getElementById("f_list"), "feedings", list, (x) => {
      const desc = (x.logs || []).map((l) =>
        typeLabel(l.feed_type) + (l.amount_ml != null ? ` ${l.amount_ml}ml` : "")).join(" + ") || "—";
      const total = (x.logs || []).reduce((s, l) => s + (l.amount_ml || 0), 0);
      return `<div class="item">
        <div><div class="title">${escapeHtml(desc)}${total ? ` · 共 ${+total.toFixed(1)}ml` : ""}</div>
          <div class="meta">${fmt(x.start_time)}${x.end_time ? " → " + fmt(x.end_time) : ""}${x.duration_min != null ? " · " + x.duration_min + "分" : ""}${x.note ? " · " + escapeHtml(x.note) : ""}</div></div>
        <div class="actions">
          <button class="btn sec" onclick="editRec('feedings',${x.id})">编辑</button>
          <button class="btn danger" onclick="del('feedings',${x.id})">删除</button>
        </div></div>`;
    });
  }
  function typeLabel(t) { return { breast: "母乳", formula: "奶粉", mixed: "混合" }[t] || t; }

  // ---------- 睡眠 ----------
  async function renderSleep(view) {
    if (!needBaby(view)) return;
    view.innerHTML = `
      ${chartCardHtml("s_chart", "😴 近 7 天睡眠")}
      <div class="card"><h2>😴 新增睡眠</h2>
        <div class="row">
          <div class="field"><label>开始</label><input id="s_start" type="datetime-local" value="${nowLocal()}"></div>
          <div class="field"><label>结束（可选）</label><input id="s_end" type="datetime-local"></div>
          <div class="field"><label>备注</label><input id="s_note" placeholder="可选"></div>
        </div>
        <div class="form-actions"><button class="btn" id="s_save">保存</button></div>
      </div>
      <div class="card"><h2>近期记录</h2><div class="list" id="s_list"></div></div>`;
    document.getElementById("s_save").onclick = () => withBusy(document.getElementById("s_save"), "保存中…", async () => {
      try {
        await api("POST", "/sleeps", { baby_id: baby.id, start_time: toISO(v("s_start")), end_time: toISO(v("s_end")), note: v("s_note") });
        toast("已保存"); renderSleep(view);
      } catch (e) { toast(e.message); }
    });
    const list = await api("GET", "/sleeps?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01");
    LIST_CACHE.sleeps = list;
    {
      const { keys, labels } = last7();
      const dur = keys.map(() => 0), cnt = keys.map(() => 0);
      for (const x of list) {
        const i = keys.indexOf(String(x.start_time).slice(0, 10));
        if (i < 0) continue;
        cnt[i] += 1;
        dur[i] += x.duration_min || 0;
      }
      chart7(document.getElementById("s_chart"), labels, [
        { name: "时长", unit: "分", data: dur },
        { name: "次数", unit: "次", data: cnt },
      ]);
    }
    renderList(document.getElementById("s_list"), "sleeps", list, (x) => `
      <div class="item"><div><div class="title">${fmt(x.start_time)} → ${fmt(x.end_time)}</div>
        <div class="meta">${x.duration_min != null ? x.duration_min + " 分钟" : "进行中"}${x.note ? " · " + escapeHtml(x.note) : ""}</div></div>
        <div class="actions">
          <button class="btn sec" onclick="editRec('sleeps',${x.id})">编辑</button>
          <button class="btn danger" onclick="del('sleeps',${x.id})">删除</button>
        </div></div>`);
  }

  // ---------- 尿布（合并便便描述 + 拍照） ----------
  async function renderDiaper(view) {
    if (!needBaby(view)) return;
    view.innerHTML = `
      ${dayNavHtml("diaper")}
      <div class="card"><h2>💧 新增尿布</h2>
        <div class="row">
          <div class="field"><label>更换时间</label><input id="d_time" type="datetime-local" value="${nowLocal()}"></div>
          <div class="field"><label>类型</label><select id="d_type">
            <option value="wet">尿</option><option value="poop">便</option><option value="mixed">混合</option></select></div>
          <div class="field"><label>便便描述（颜色/性状）</label><input id="d_desc" placeholder="如 金黄、偏稀"></div>
          <div class="field"><label>备注</label><input id="d_note" placeholder="可选"></div>
          <div class="field"><label>📷 尿布照片（可选，拍照或从图库选）</label><input id="d_file" type="file" accept="image/*"></div>
        </div>
        <div class="form-actions"><button class="btn" id="d_save">保存</button></div>
      </div>
      <div class="card"><h2>近期记录</h2><div class="list" id="d_list"></div></div>`;
    document.getElementById("d_save").onclick = () => withBusy(document.getElementById("d_save"), "保存中…", async (setT) => {
      try {
        let photo = "";
        const file = document.getElementById("d_file").files[0];
        if (file) {
          setT(`上传照片中…${file.size > 1048576 ? "（照片较大，请稍候）" : ""}`);
          const fd = new FormData();
          fd.append("file", file);
          const up = await api("POST", "/upload", fd, true);
          photo = up.filename;
        }
        setT("保存中…");
        await api("POST", "/diapers", { baby_id: baby.id, diaper_type: v("d_type"), time: toISO(v("d_time")), stool_desc: v("d_desc"), photo_filename: photo, note: v("d_note") });
        toast("已保存"); renderDiaper(view);
      } catch (e) { toast(e.message); }
    });
    const list = await api("GET", "/diapers?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01");
    LIST_CACHE.diapers = list;
    bindDayNav(view, "diaper", (d) => {
      const ss = list.filter((x) => String(x.time || x.created_at).slice(0, 10) === d);
      if (!ss.length) return "";
      const poop = ss.filter((x) => x.diaper_type === "poop" || x.diaper_type === "mixed").length;
      return chip(`<b>${ss.length}</b> 次`) + (poop ? chip(`便便 <b>${poop}</b> 次`) : "");
    });
    renderList(document.getElementById("d_list"), "diapers", list, (x, i) => `
      <div class="item"><div style="display:flex;gap:10px;align-items:center;">
        ${x.photo_filename ? `<div class="thumb-wrap" data-i="${i}">${mediaThumb(x.photo_filename)}</div>` : ""}
        <div><div class="title"><span class="tag ${x.diaper_type}">${diaperLabel(x.diaper_type)}</span></div>
        <div class="meta">${fmt(x.time || x.created_at)}${x.stool_desc ? " · " + escapeHtml(x.stool_desc) : ""}${x.note ? " · " + escapeHtml(x.note) : ""}</div></div></div>
        <div class="actions">
          <button class="btn sec" onclick="editRec('diapers',${x.id})">编辑</button>
          <button class="btn danger" onclick="del('diapers',${x.id})">删除</button>
        </div></div>`, bindDiaperThumbs);
    function bindDiaperThumbs() {
      view.querySelectorAll("#d_list .thumb-wrap").forEach((el) => {
        el.onclick = () => {
          const x = LIST_CACHE.diapers[+el.dataset.i];
          if (x && x.photo_filename) openViewer([{
            src: "/static/uploads/" + x.photo_filename, video: isVideo(x.photo_filename),
            title: x.stool_desc || "", sub: fmt(x.time || x.created_at),
          }], 0);
        };
      });
    }
  }
  function diaperLabel(t) { return { wet: "尿", poop: "便", mixed: "混合" }[t] || t; }

  // ---------- 生长曲线（WHO 百分位 + 缩放 + 实际日期；标准跟随设置里的宝宝性别） ----------
  let growthMeas = "weight";
  function growthSexKey() {
    return baby && baby.gender === "女" ? "girls" : "boys";
  }
  async function renderGrowth(view) {
    if (!needBaby(view)) return;
    if (!whoLms) {
      try { whoLms = await (await fetch("/static/who_lms.json")).json(); } catch (e) { whoLms = null; }
    }
    const measName = { weight: "体重(kg)", length: "身长(cm)", head: "头围(cm)" };
    const sk = growthSexKey();
    view.innerHTML = `
      <div class="card"><h2>生长曲线（WHO 参考）</h2>
        <div class="tabs" style="margin-bottom:10px;">
          <div class="tab ${growthMeas==="weight"?"active":""}" data-m="weight">体重</div>
          <div class="tab ${growthMeas==="length"?"active":""}" data-m="length">身长</div>
          <div class="tab ${growthMeas==="head"?"active":""}" data-m="head">头围</div>
        </div>
        <div id="growthInfo" class="meta" style="margin-bottom:8px;"></div>
        <div id="growthChart" class="chart"></div>
      </div>
      <div class="card"><h2>📈 新增生长记录</h2>
        <div class="row">
          <div class="field"><label>日期</label><input id="g_date" type="date" value="${fmtDate(nowLocal())}"></div>
          <div class="field"><label>体重 kg</label><input id="g_w" type="number" step="0.01"></div>
          <div class="field"><label>身长 cm</label><input id="g_h" type="number" step="0.1"></div>
          <div class="field"><label>头围 cm</label><input id="g_head" type="number" step="0.1"></div>
          <div class="field"><label>备注</label><input id="g_note" placeholder="可选"></div>
        </div>
        <div class="form-actions"><button class="btn" id="g_save">保存</button></div>
      </div>
      <div class="card"><h2>历史记录</h2><div class="list" id="g_list"></div></div>`;
    view.querySelectorAll(".tab[data-m]").forEach((t) => t.onclick = () => { growthMeas = t.dataset.m; renderGrowth(view); });
    document.getElementById("g_save").onclick = () => withBusy(document.getElementById("g_save"), "保存中…", async () => {
      try {
        await api("POST", "/growths", { baby_id: baby.id, record_date: v("g_date"),
          weight_kg: num("g_w"), height_cm: num("g_h"), head_cm: num("g_head"), note: v("g_note") });
        toast("已保存"); renderGrowth(view);
      } catch (e) { toast(e.message); }
    });
    const list = await api("GET", "/growths?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01");
    LIST_CACHE.growths = list;
    const asc = list.slice().reverse();   // 正序供绘图
    renderList(document.getElementById("g_list"), "growths", list, (x) => `
      <div class="item"><div><div class="title">${fmtDate(x.record_date)}</div>
        <div class="meta">${x.weight_kg != null ? "体重 " + x.weight_kg + "kg " : ""}${x.height_cm != null ? "身长 " + x.height_cm + "cm " : ""}${x.head_cm != null ? "头围 " + x.head_cm + "cm" : ""}${x.note ? " · " + escapeHtml(x.note) : ""}</div></div>
        <div class="actions">
          <button class="btn sec" onclick="editRec('growths',${x.id})">编辑</button>
          <button class="btn danger" onclick="del('growths',${x.id})">删除</button>
        </div></div>`);
    drawGrowth(asc, measName[growthMeas]);
  }
  // 正态 CDF（erf 近似）
  function erf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function lmsValue(L, M, S, z) {
    if (L === 0) return M * Math.exp(S * z);
    return M * Math.pow(1 + L * S * z, 1 / L);
  }
  function lmsZ(L, M, S, X) {
    if (X <= 0) return null;
    if (L === 0) return Math.log(X / M) / S;
    return (Math.pow(X / M, L) - 1) / (L * S);
  }
  function interpLMS(arr, month) {
    if (month <= arr[0].m) return arr[0];
    if (month >= arr[arr.length - 1].m) return arr[arr.length - 1];
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      if (month >= a.m && month <= b.m) {
        const r = (month - a.m) / (b.m - a.m);
        return {
          L: a.L + (b.L - a.L) * r, M: a.M + (b.M - a.M) * r, S: a.S + (b.S - a.S) * r,
        };
      }
    }
    return arr[arr.length - 1];
  }
  /** 数值 → WHO 百分位字符串（需传记录日期） */
  function pctFor(value, meas, dateStr) {
    if (!whoLms || !baby || value == null) return null;
    const arr = (whoLms.data[meas] && whoLms.data[meas][growthSexKey()]) || null;
    if (!arr || !arr.length) return null;
    const mo = monthOf(dateStr);
    const lms = interpLMS(arr, mo);
    const z = lmsZ(lms.L, lms.M, lms.S, value);
    if (z == null) return null;
    return (normCdf(z) * 100).toFixed(1);
  }
  function monthOf(dateStr) {
    if (!baby || !baby.birthday) return 0;
    const b = new Date(baby.birthday + "T00:00:00");
    const d = new Date(dateStr + "T00:00:00");
    return (d - b) / (1000 * 60 * 60 * 24 * 30.4375);
  }
  /** 月龄 → 实际日期字符串 */
  function monthToDateStr(mo) {
    if (!baby || !baby.birthday) return "";
    const d = new Date(baby.birthday + "T00:00:00");
    d.setDate(d.getDate() + Math.round(mo * 30.4375));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function drawGrowth(data, measLabel) {
    if (!window.echarts) return;
    if (!whoLms || !baby) return;
    const sk = growthSexKey();
    const arr = (whoLms.data[growthMeas] && whoLms.data[growthMeas][sk]) || [];
    const zMap = { 3: -1.88079, 15: -1.03643, 50: 0, 85: 1.03643, 97: 1.88079 };
    const colors = { 3: "#e2607a", 15: "#f0a8b6", 50: "#4a90d9", 85: "#f0a8b6", 97: "#e2607a" };
    const key = growthMeas === "weight" ? "weight_kg" : growthMeas === "length" ? "height_cm" : "head_cm";
    const maxMonth = Math.max(24, ...data.filter((g) => g[key] != null)
      .map((g) => monthOf(g.record_date)));
    const refSeries = Object.keys(zMap).map((p) => {
      const pts = [];
      for (let mo = 0; mo <= maxMonth; mo += 0.5) {
        const lms = interpLMS(arr, mo);
        pts.push([mo, +lmsValue(lms.L, lms.M, lms.S, zMap[p]).toFixed(2)]);
      }
      return { name: p + "th", type: "line", showSymbol: false, data: pts, silent: true,
        lineStyle: { color: colors[p], width: p === "50" ? 2 : 1, type: p === "50" ? "solid" : "dashed" },
        itemStyle: { color: colors[p] } };
    });
    const babyPts = data.filter((g) => g[key] != null).map((g) => [+monthOf(g.record_date).toFixed(2), g[key]]);
    const babySeries = { name: "宝宝", type: "line", data: babyPts, connectNulls: false,
      symbolSize: 8, itemStyle: { color: "#2b2f36" }, lineStyle: { color: "#2b2f36", width: 2 } };
    const chart = echarts.getInstanceByDom(document.getElementById("growthChart")) || echarts.init(document.getElementById("growthChart"));
    chart.setOption({
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const mo = params[0].axisValue;
          let html = `月龄 <b>${(+mo).toFixed(1)}</b> · ${monthToDateStr(mo)}`;
          params.forEach((p) => {
            const val = Array.isArray(p.value) ? p.value[1] : p.value;
            html += `<br/>${p.marker}${p.seriesName}: ${val == null ? "—" : val}`;
          });
          return html;
        },
      },
      legend: {
        data: [...Object.keys(zMap).map((p) => p + "th"), "宝宝"],
        top: 0, type: "scroll", itemWidth: 16, itemHeight: 8, itemGap: 6,
        textStyle: { fontSize: 10 }, pageIconSize: 10,
      },
      grid: { left: 44, right: 16, top: 48, bottom: 56 },
      dataZoom: [
        { type: "inside" },
        { type: "slider", height: 18, bottom: 8 },
      ],
      xAxis: { type: "value", name: "月龄", min: 0, max: maxMonth, axisLabel: { formatter: "{value}" } },
      yAxis: { type: "value", name: measLabel, scale: true },
      series: [...refSeries, babySeries],
    }, true);
    // 最新一次百分位
    const info = document.getElementById("growthInfo");
    const last = babyPts[babyPts.length - 1];
    if (last) {
      const lms = interpLMS(arr, last[0]);
      const z = lmsZ(lms.L, lms.M, lms.S, last[1]);
      const pct = z == null ? "—" : (normCdf(z) * 100).toFixed(1);
      const lastDate = data.filter((g) => g[key] != null).slice(-1)[0].record_date;
      info.textContent =
        `最近一次（${fmtDate(lastDate)}，${last[0].toFixed(1)} 月龄）${measLabel} = ${last[1]}，约第 ${pct} 百分位（Z=${z == null ? "—" : z.toFixed(2)}）`;
    } else info.textContent = "";
  }

  // ---------- 健康（体温 / 疫苗 / 用药） ----------
  let healthTab = "temperature";
  async function renderHealth(view) {
    if (!needBaby(view)) return;
    view.innerHTML = `
      <div class="tabs">
        <div class="tab ${healthTab==="temperature"?"active":""}" data-t="temperature">🌡️ 体温</div>
        <div class="tab ${healthTab==="vaccine"?"active":""}" data-t="vaccine">💉 疫苗</div>
        <div class="tab ${healthTab==="medication"?"active":""}" data-t="medication">💊 用药</div>
      </div>
      <div id="health_body"></div>`;
    view.querySelectorAll(".tab").forEach((t) => t.onclick = () => { healthTab = t.dataset.t; renderHealth(view); });
    const body = view.querySelector("#health_body");
    if (healthTab === "temperature") await healthTemp(body);
    else if (healthTab === "vaccine") await healthVaccine(body);
    else await healthMed(body);
  }
  async function healthTemp(body) {
    body.innerHTML = `
      ${dayNavHtml("health_temp")}
      <div class="card"><h2>🌡️ 体温曲线</h2><div id="tempChart" class="chart"></div></div>
      <div class="card"><h2>🌡️ 新增体温</h2>
        <div class="row">
          <div class="field"><label>体温 ℃</label><input id="t_val" type="number" step="0.1" placeholder="36.5"></div>
          <div class="field"><label>时间</label><input id="t_time" type="datetime-local" value="${nowLocal()}"></div>
          <div class="field"><label>备注</label><input id="t_note"></div>
        </div>
        <div class="form-actions"><button class="btn" id="t_save">保存</button></div>
      </div>
      <div class="card"><h2>近期记录</h2><div class="list" id="t_list"></div></div>`;
    document.getElementById("t_save").onclick = () => withBusy(document.getElementById("t_save"), "保存中…", async () => {
      try { await api("POST", "/temperatures", { baby_id: baby.id, value: num("t_val"), time: toISO(v("t_time")), note: v("t_note") });
        toast("已保存"); healthTemp(body); } catch (e) { toast(e.message); }
    });
    const list = await api("GET", "/temperatures?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01");
    LIST_CACHE.temperatures = list;
    bindDayNav(body, "health_temp", (d) => {
      const ss = list.filter((x) => String(x.time).slice(0, 10) === d);
      if (!ss.length) return "";
      const mx = Math.max(...ss.map((x) => x.value));
      return chip(`<b>${ss.length}</b> 次`) + chip(`最高 <b>${mx}</b> ℃`);
    });
    const asc = list.slice().reverse();
    drawTemp(asc);
    renderList(document.getElementById("t_list"), "temperatures", list, (x) => `
      <div class="item"><div><div class="title">${x.value} ℃ ${x.value>=37.5?'<span class="tag wet">发热</span>':''}</div>
        <div class="meta">${fmt(x.time)}${x.note ? " · " + escapeHtml(x.note) : ""}</div></div>
        <div class="actions">
          <button class="btn sec" onclick="editRec('temperatures',${x.id})">编辑</button>
          <button class="btn danger" onclick="del('temperatures',${x.id})">删除</button>
        </div></div>`);
  }
  function drawTemp(data) {
    if (!window.echarts) return;
    const chart = echarts.getInstanceByDom(document.getElementById("tempChart")) || echarts.init(document.getElementById("tempChart"));
    chart.setOption({
      tooltip: { trigger: "axis" }, grid: { left: 40, right: 16, top: 30, bottom: 30 },
      xAxis: { type: "category", data: data.map((x) => fmt(x.time)) },
      yAxis: { type: "value", scale: true },
      series: [{ name: "体温", type: "line", smooth: true, data: data.map((x) => x.value), itemStyle: { color: "#e2607a" }, lineStyle: { color: "#e2607a" } }],
    });
  }
  // 疫苗：标准免疫程序（合并提醒功能）+ 自定义新增 + 记录管理
  async function healthVaccine(body) {
    body.innerHTML = `
      ${dayNavHtml("health_vax")}
      <div class="card"><h2>💉 免疫程序（按宝宝年龄自动生成）</h2>
        <p class="meta" style="margin:-6px 0 10px;">依据国家免疫规划 0–24 月参考程序；「✓ 登记」记录接种，「↩ 取消登记」删除对应记录。自定义疫苗在下方「接种记录」里可编辑/删除。</p>
        <div class="list" id="v_sched"></div>
      </div>
      <div class="card"><h2>➕ 新增/自定义疫苗</h2>
        <div class="row">
          <div class="field"><label>名称</label><input id="v_name"></div>
          <div class="field"><label>接种日期</label><input id="v_date" type="date"></div>
          <div class="field"><label>应接种日</label><input id="v_due" type="date"></div>
          <div class="field"><label>备注</label><input id="v_note"></div>
        </div>
        <div class="form-actions"><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="v_done"> 已接种</label><button class="btn" id="v_save">保存</button></div>
      </div>
      <div class="card"><h2>近期记录</h2><div class="list" id="v_list"></div></div>`;
    document.getElementById("v_save").onclick = async () => {
      try { await api("POST", "/vaccines", { baby_id: baby.id, name: v("v_name"), date: v("v_date") || null, due_date: v("v_due") || null, done: document.getElementById("v_done").checked, note: v("v_note") });
        toast("已保存"); healthVaccine(body); } catch (e) { toast(e.message); }
    };
    const [rem, list] = await Promise.all([
      api("GET", "/reminders?baby_id=" + baby.id),
      api("GET", "/vaccines?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01"),
    ]);
    LIST_CACHE.vaccines = list;
    bindDayNav(body, "health_vax", (d) => {
      const ss = list.filter((x) => fmtDate(x.date) === d);
      if (!ss.length) return "";
      const done = ss.filter((x) => x.done).length;
      return chip(`接种 <b>${done}</b> 支`) + (ss.length - done ? chip(`待接 <b>${ss.length - done}</b> 支`) : "");
    });
    const statusCls = { "已完成": "", "已到/逾期": "wet", "即将到期": "wet", "未到": "", "自定义待办": "wet" };
    document.getElementById("v_sched").innerHTML = rem.vaccines.length ? rem.vaccines.map((x, i) => {
      const safeName = escapeHtml(x.name).replace(/'/g, "\\'");
      let actions;
      if (x.status === "已完成") {
        actions = `<div class="actions"><span class="tag">已完成</span>
          ${x.record_id ? `<button class="btn sec" style="width:auto;padding:6px 10px;" onclick="undoVaccine(${x.record_id})">↩ 取消登记</button>` : ""}</div>`;
      } else {
        actions = `<div class="actions"><span class="tag ${statusCls[x.status] || "wet"}">${x.status}</span>
          ${x.status === "自定义待办" && x.record_id
            ? `<button class="btn sec" style="width:auto;padding:6px 10px;" onclick="completeVaccine(${x.record_id})">✓ 完成</button>
               <button class="btn danger" style="width:auto;padding:6px 10px;" onclick="del('vaccines',${x.record_id})">🗑</button>`
            : `<button class="btn sec" style="width:auto;padding:6px 10px;" onclick="quickVaccine('${safeName}','${x.due_date || ""}')">✓ 登记</button>`}</div>`;
      }
      return `<div class="item"><div><div class="title">${escapeHtml(x.name)}</div>
        <div class="meta">应种 ${x.due_date || "—"}${x.days_left != null ? ` · ${dueText(x)}` : ""}</div></div>
        ${actions}</div>`;
    }).join("") : emptyMsg();
    renderList(document.getElementById("v_list"), "vaccines", list, (x) => `
      <div class="item"><div><div class="title">${escapeHtml(x.name)} ${x.done ? '<span class="tag">已接种</span>' : '<span class="tag wet">待接种</span>'}</div>
        <div class="meta">${x.date ? "接种 " + fmtDate(x.date) : ""}${x.due_date ? " 应种 " + fmtDate(x.due_date) : ""}${x.note ? " · " + escapeHtml(x.note) : ""}</div></div>
        <div class="actions">
          <button class="btn sec" onclick="editRec('vaccines',${x.id})">编辑</button>
          <button class="btn danger" onclick="del('vaccines',${x.id})">删除</button>
        </div></div>`);
  }
  window.quickVaccine = async function (name, due) {
    if (LIST_CACHE.vaccines && LIST_CACHE.vaccines.some((x) => x.name === name && x.done)) {
      toast("该疫苗已登记过"); return;
    }
    try {
      await api("POST", "/vaccines", {
        baby_id: baby.id, name,
        date: fmtDate(nowLocal()), due_date: due || null, done: true, note: "",
      });
      toast("已登记接种"); route();
    } catch (e) { toast(e.message); }
  };
  /** 取消登记：删除该计划项对应的已接种记录 */
  window.undoVaccine = async function (recordId) {
    if (!confirm("取消登记将删除这条接种记录，确定？")) return;
    try { await api("DELETE", "/vaccines/" + recordId); toast("已取消登记"); route(); }
    catch (e) { toast(e.message); }
  };
  /** 自定义待办 → 一键标记完成（更新原记录，不新建） */
  window.completeVaccine = async function (recordId) {
    const rec = (LIST_CACHE.vaccines || []).find((x) => x.id === recordId);
    try {
      await api("PUT", "/vaccines/" + recordId, {
        name: rec ? rec.name : undefined,
        date: fmtDate(nowLocal()),
        due_date: rec ? (rec.due_date || null) : null,
        done: true,
        note: rec ? (rec.note || "") : "",
      });
      toast("已完成接种"); route();
    } catch (e) { toast(e.message); }
  };
  async function healthMed(body) {
    body.innerHTML = `
      ${dayNavHtml("health_med")}
      <div class="card"><h2>💊 新增用药</h2>
        <div class="row">
          <div class="field"><label>药名</label><input id="m_name"></div>
          <div class="field"><label>剂量</label><input id="m_dose" placeholder="如 0.5ml"></div>
          <div class="field"><label>本次时间</label><input id="m_time" type="datetime-local" value="${nowLocal()}"></div>
          <div class="field"><label>下次服药（提醒）</label><input id="m_next" type="datetime-local"></div>
          <div class="field"><label>备注</label><input id="m_note"></div>
        </div>
        <div class="form-actions"><button class="btn" id="m_save">保存</button></div>
      </div>
      <div class="card"><h2>近期记录</h2><div class="list" id="m_list"></div></div>`;
    document.getElementById("m_save").onclick = () => withBusy(document.getElementById("m_save"), "保存中…", async () => {
      try { await api("POST", "/medications", { baby_id: baby.id, med_name: v("m_name"), dose: v("m_dose"), time: toISO(v("m_time")), next_dose_at: toISO(v("m_next")), note: v("m_note") });
        toast("已保存"); healthMed(body); } catch (e) { toast(e.message); }
    });
    const list = await api("GET", "/medications?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01");
    LIST_CACHE.medications = list;
    bindDayNav(body, "health_med", (d) => {
      const ss = list.filter((x) => String(x.time).slice(0, 10) === d);
      if (!ss.length) return "";
      return chip(`<b>${ss.length}</b> 次用药`);
    });
    renderList(document.getElementById("m_list"), "medications", list, (x) => `
      <div class="item"><div><div class="title">${escapeHtml(x.med_name)} ${x.dose ? "· " + escapeHtml(x.dose) : ""}</div>
        <div class="meta">${fmt(x.time)}${x.next_dose_at ? " · 下次 " + fmt(x.next_dose_at) : ""}${x.note ? " · " + escapeHtml(x.note) : ""}</div></div>
        <div class="actions">
          <button class="btn sec" onclick="editRec('medications',${x.id})">编辑</button>
          <button class="btn danger" onclick="del('medications',${x.id})">删除</button>
        </div></div>`);
  }

  // ---------- 事件（时间轴） ----------
  async function renderMilestone(view) {
    if (!needBaby(view)) return;
    view.innerHTML = `
      ${dayNavHtml("milestone")}
      <div class="card"><h2>🕰️ 事件时间轴</h2><div class="timeline" id="mi_list"></div></div>
      <div class="card"><h2>⭐ 新增事件</h2>
        <div class="row">
          <div class="field"><label>日期</label><input id="mi_date" type="date" value="${fmtDate(nowLocal())}"></div>
          <div class="field" style="flex:1 1 100%;"><label>内容（标题 + 描述）</label><textarea id="mi_content" placeholder="如 第一次翻身，趴着能抬头坚持 5 秒；未来日期的事件会自动出现在概览提醒里"></textarea></div>
          <div class="field"><label>📷 配图 / 🎬 视频（可选，可多选）</label><input id="mi_file" type="file" accept="image/*,video/*" multiple></div>
        </div>
        <div class="form-actions"><button class="btn" id="mi_save">保存</button></div>
      </div>`;
    document.getElementById("mi_save").onclick = () => withBusy(document.getElementById("mi_save"), "保存中…", async (setT) => {
      try {
        const files = [...document.getElementById("mi_file").files];
        let photo_id = null;
        for (let i = 0; i < files.length; i++) {
          setT(files.length > 1 ? `上传中…（${i + 1}/${files.length}）` : "上传中…");
          const fd = new FormData();
          fd.append("baby_id", baby.id); fd.append("caption", v("mi_content").slice(0, 20)); fd.append("file", files[i]);
          const ph = await api("POST", "/photos", fd, true);
          if (!photo_id) photo_id = ph.id;   // 第一张挂到事件，其余进「照片」页
        }
        setT("保存中…");
        await api("POST", "/milestones", { baby_id: baby.id, date: v("mi_date"), content: v("mi_content"), photo_id });
        toast("已保存");
        renderMilestone(view);
      } catch (e) { toast(e.message); }
    });
    const [list, photos] = await Promise.all([
      api("GET", "/milestones?baby_id=" + baby.id + "&from_=2000-01-01&to_=2100-01-01"),
      api("GET", "/photos?baby_id=" + baby.id),
    ]);
    LIST_CACHE.milestones = list;
    LIST_CACHE.photos = photos;
    bindDayNav(view, "milestone", (d) => {
      const ss = list.filter((x) => fmtDate(x.date) === d);
      if (!ss.length) return "";
      return chip(`<b>${ss.length}</b> 条`);
    });
    const phMap = {}; photos.forEach((p) => (phMap[p.id] = p));
    const items = photoItems(photos);
    const today = fmtDate(nowLocal());
    renderList(document.getElementById("mi_list"), "milestones", list, (x) => {
      const p = x.photo_id ? phMap[x.photo_id] : null;
      const future = new Date(x.date + "T00:00:00") > new Date(today + "T00:00:00");
      const [head, ...rest] = String(x.content || "").split("\n");
      return `<div class="tl-item">
        <div class="tl-side"><div class="tl-date">${x.date.slice(5)}</div><div class="tl-year">${x.date.slice(0, 4)}</div></div>
        <div class="tl-axis"><div class="tl-dot${future ? " future" : ""}"></div></div>
        <div class="tl-body">
          <div class="tl-head">${escapeHtml(head)}${future ? ' <span class="tag">⏰ 提醒</span>' : ""}</div>
          ${rest.length ? `<div class="tl-desc">${escapeHtml(rest.join("\n"))}</div>` : ""}
          ${p ? `<div class="thumb-wrap tl-thumb" data-pid="${p.id}">${mediaThumb(p.filename, "gallery-media")}${isVideo(p.filename) ? '<span class="play">▶</span>' : ""}</div>` : ""}
          <div class="tl-actions">
            <button class="btn sec" onclick="editRec('milestones',${x.id})">编辑</button>
            <button class="btn danger" onclick="del('milestones',${x.id})">删除</button>
          </div>
        </div>
      </div>`;
    }, () => {
      view.querySelectorAll("#mi_list .tl-thumb").forEach((el) => {
        el.onclick = () => {
          const pid = +el.dataset.pid;
          const idx = photos.findIndex((p) => p.id === pid);
          openViewer(items, idx >= 0 ? idx : 0);
        };
      });
    }, 5);
  }

  // ---------- 照片墙（独立页面） ----------
  async function renderPhotos(view) {
    if (!needBaby(view)) return;
    view.innerHTML = `
      <div class="card">
        <h2>📷 照片墙 <span class="meta" id="ph_count"></span></h2>
        <p class="meta" style="margin:-4px 0 10px;">事件页保存的图片/视频都在这里；点击进入播放模式，左右滑动或方向键切换。</p>
        <div class="gallery" id="ph_gallery"></div>
      </div>`;
    const photos = await api("GET", "/photos?baby_id=" + baby.id);
    LIST_CACHE.photos = photos;
    document.getElementById("ph_count").textContent = photos.length ? `（共 ${photos.length} 个）` : "";
    const items = photoItems(photos);
    renderList(document.getElementById("ph_gallery"), "photos_page", photos, (p) => `
      <div class="ph" data-pid="${p.id}">
        ${mediaThumb(p.filename, "gallery-media")}${isVideo(p.filename) ? '<span class="play">▶</span>' : ""}
        <div class="cap">${escapeHtml(p.caption || "")}</div>
      </div>`, () => {
      view.querySelectorAll("#ph_gallery .ph").forEach((el) => {
        el.onclick = () => {
          const idx = photos.findIndex((p) => p.id === +el.dataset.pid);
          openViewer(items, idx >= 0 ? idx : 0);
        };
      });
    }, 9);
  }

  // ---------- 设置（单宝宝信息 + 导出） ----------
  async function renderSettings(view) {
    if (!needBaby(view)) return;
    view.innerHTML = `
      <div class="card"><h2>👶 宝宝信息</h2>
        <div class="row">
          <div class="field"><label>姓名</label><input id="b_name" value="${escapeHtml(baby.name||"")}"></div>
          <div class="field"><label>出生日期</label><input id="b_birth" type="date" value="${fmtDate(baby.birthday)}"></div>
          <div class="field"><label>性别</label><select id="b_gender">
            <option value="男" ${baby.gender==="男"?"selected":""}>男</option>
            <option value="女" ${baby.gender==="女"?"selected":""}>女</option>
            <option value="未知" ${baby.gender==="未知"?"selected":""}>未知</option></select></div>
          <div class="field" style="flex:1 1 100%;"><label>备注</label><input id="b_note" value="${escapeHtml(baby.note||"")}"></div>
        </div>
        <p class="meta" style="margin:-4px 0 8px;">性别会决定生长曲线使用的 WHO 标准（男宝/女宝）。</p>
        <div class="form-actions"><button class="btn" id="b_save">保存</button></div>
      </div>
      <div class="card"><h2>📤 数据导出</h2>
        <p class="meta">导出全部记录为离线文件，便于备份与打印。</p>
        <div class="row">
          <button class="btn sec" id="exp_excel">导出 Excel</button>
          <button class="btn sec" id="exp_pdf">导出 PDF</button>
        </div>
      </div>
      <div class="card"><h2>📥 数据导入</h2>
        <p class="meta">导入此前导出的 Excel：按内容<b>自动去重</b>后追加写入（忽略 ID、不覆盖现有数据），重复导入同一文件也安全，适合恢复、换机或补数据。照片/视频文件不随 Excel 走，需另行拷贝到 uploads 目录后用下方「媒体扫描」入库。</p>
        <div class="row">
          <div class="field" style="flex:1 1 100%;"><label>选择 Excel 文件（.xlsx）</label><input id="imp_file" type="file" accept=".xlsx"></div>
        </div>
        <div class="form-actions"><button class="btn" id="imp_btn">开始导入</button></div>
      </div>
      <div class="card"><h2>🗂️ 媒体文件扫描</h2>
        <p class="meta" style="margin:-4px 0 10px;">
          扫描 <code>static/uploads/&lt;宝宝名&gt;/&lt;日期&gt;/event|diaper/</code>：<br>
          · 缺少 .json 说明文件的媒体 → 自动补建（已有则跳过）；<br>
          · 手动拷入 <code>event/</code> 的图片/视频 → 自动入照片库；<br>
          · 被手动删除/移动的文件 → 自动清理死链或按文件名重新挂接；<br>
          · 孤儿 .json（媒体已不在）→ 自动删除。
        </p>
        <div class="form-actions"><button class="btn" id="scan_btn">开始扫描</button><span class="meta" id="scan_result"></span></div>
      </div>
      <div class="card"><h2>🔐 访问安全</h2>
        <p class="meta">当前访问口令由服务端 <code>.env</code> 的 <code>BABYWEB_PASSWORD</code> 控制（默认 <code>baby1234</code>）。可改用 <code>python main.py --no-auth</code> 关闭验证（仅限可信局域网）。手机访问请用电脑局域网 IP。</p>
      </div>`;
    document.getElementById("b_save").onclick = async () => {
      try {
        baby = await api("PUT", "/baby", { name: v("b_name") || "宝宝", birthday: v("b_birth"), gender: v("b_gender"), note: v("b_note") });
        updateTags();
        toast("已保存");
      } catch (e) { toast(e.message); }
    };
    document.getElementById("exp_excel").onclick = () => download("/export/excel", "baoji_export.xlsx");
    document.getElementById("exp_pdf").onclick = () => download("/export/pdf", "baoji_export.pdf");
    document.getElementById("imp_btn").onclick = () => withBusy(document.getElementById("imp_btn"), "导入中…", async (setT) => {
      const file = document.getElementById("imp_file").files[0];
      if (!file) { toast("请先选择 Excel 文件"); return; }
      if (!confirm("导入会按内容去重后追加到现有数据（不覆盖），确定继续？")) return;
      setT("上传解析中…");
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await api("POST", "/import/excel", fd, true);
        const parts = Object.entries(res.counts || {}).filter(([, n]) => n > 0)
          .map(([k, n]) => `${k} ${n} 条`);
        const sk = Object.entries(res.skipped || {}).filter(([, n]) => n > 0)
          .map(([k, n]) => `${k} 跳过 ${n}`);
        const all = [...parts, ...sk];
        toast("导入完成" + (all.length ? "：" + all.join("，") : "（无新增数据）"));
      } catch (e) { toast(e.message); }
    });
    document.getElementById("scan_btn").onclick = () => withBusy(document.getElementById("scan_btn"), "扫描中…", async () => {
      try {
        const res = await api("POST", "/media/scan");
        const lbl = { json_created: "补建JSON", json_removed: "清理孤儿JSON", photos_added: "新入库照片",
                      photos_removed: "清理死链", photos_remapped: "重挂接", diapers_fixed: "尿布修正" };
        const parts = Object.entries(res).filter(([, n]) => n > 0).map(([k, n]) => `${lbl[k]} ${n}`);
        document.getElementById("scan_result").textContent = parts.length ? parts.join(" · ") : "一切正常，无需处理";
        toast("扫描完成");
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- 删除 ----------
  window.del = async function (kind, id) {
    if (!confirm("确定删除该记录？")) return;
    try { await api("DELETE", "/" + kind + "/" + id); toast("已删除"); route(); }
    catch (e) { toast(e.message); }
  };

  // ---------- 启动 ----------
  // 屏幕旋转/窗口变化时图表自适应
  window.addEventListener("resize", () => {
    document.querySelectorAll(".chart, .chart-sm").forEach((el) => {
      const c = window.echarts && echarts.getInstanceByDom(el);
      if (c) c.resize();
    });
  });
  document.getElementById("loginBtn").onclick = doLogin;
  document.getElementById("pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  bootstrap();
})();
