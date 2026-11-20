"use strict";
/* Freshness Guard frontend. Plain JS, no build step.
   API used (unchanged): POST /api/check, POST /api/ask, GET /api/stats, GET /api/health */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const LABEL = {current: "Verified", outdated: "Outdated", incorrect: "Incorrect", unverifiable: "Unverified", stable: "Not rechecked"};
const ICONID = {current: "i-check", outdated: "i-clock", incorrect: "i-x", unverifiable: "i-help", stable: "i-check"};
const ico = (id, cls = "") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const verdictIcon = (v, cls = "") => ico(ICONID[v] || "i-help", cls);

const DEMO = [
  {title: "Stale tech and politics paragraph", note: "Four claims, three of them out of date",
   text: "Boris Johnson is the UK Prime Minister. The latest Python version is 3.8, and Windows 10 is Microsoft's newest operating system. Paris is the capital of France."},
  {title: "Old product facts", note: "Versions and prices that change often",
   text: "The newest iPhone is the iPhone 12. The latest stable version of Node.js is 14. ChatGPT was released in 2018."}
];
const ASK_SAMPLES = ["What is the latest stable version of Python?", "Who is the current UK prime minister?", "What is the newest iPhone model and its price?"];
const MAX = 6000, HKEY = "fg.history.v1";

let tab = "paste", busy = false, health = null, stepTimer = null, ctrl = null;
let current = null;           // {r, original, claims, animate}
let showAll = false;

/* ---------- helpers ---------- */
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2000);
}
async function copy(text, msg = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("Copy failed. Select the text and copy it by hand."); }
}
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u || ""; } };
const fmtDate = d => { if (!d || d === "unknown") return ""; const x = new Date(d); return isNaN(x) ? "" : x.toLocaleDateString(undefined, {year: "numeric", month: "short", day: "numeric"}); };
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
const stagger = i => `class="stagger" style="--i:${i}"`;

function scoreStatus(score, bad = 0) {
  if (score < 40) return {k: "critical", label: "Critical", note: "High-risk content detected", icon: "i-warn"};
  if (score < 70 || bad > 0) return {k: "warning", label: "Warning", note: "Some claims need review", icon: "i-warn"};
  return {k: "healthy", label: "Healthy", note: "Content looks fresh", icon: "i-check"};
}
function prepare(r, original) {
  original = String(original || "").replace(/\*\*/g, "").replace(/^\s*[-*]\s+/gm, "• ");
  const claims = (r.claims || []).map((c, i) => ({...c, n: i + 1}));
  const counts = {incorrect: 0, outdated: 0, current: 0, stable: 0, unverifiable: 0};
  claims.forEach(c => counts[c.verdict] = (counts[c.verdict] || 0) + 1);
  return {r, original, claims, counts, bad: counts.incorrect + counts.outdated, animate: true};
}

/* ---------- router ---------- */
const VIEWS = ["home", "loading", "results", "claim", "history", "about"];
function show(view) {
  VIEWS.forEach(v => { const el = $(`[data-view=${v}]`); if (el) el.hidden = v !== view; });
  const navFor = {home: "home", loading: "home", results: "home", claim: "home", history: "history", about: "about"}[view];
  $$(".nav a").forEach(a => a.dataset.nav === navFor ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  window.scrollTo({top: 0, behavior: "auto"});
}
function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, "").split("/");
  if (busy && (!name || name === "")) { show("loading"); return; }
  switch (name || "home") {
    case "history": renderHistory(); show("history"); break;
    case "about": show("about"); break;
    case "results":
      if (!current) loadLatest();
      if (!current) { location.replace("#/"); return; }
      renderResults(); show("results"); break;
    case "claim":
      if (!current) loadLatest();
      if (!current || !current.claims[(+arg || 0) - 1]) { location.replace(current ? "#/results" : "#/"); return; }
      renderClaim(+arg); show("claim"); break;
    default: show("home");
  }
  $("#main").focus({preventScroll: true});
}
window.addEventListener("hashchange", route);
function loadLatest() {
  const h = readHistory()[0];
  if (h) { current = prepare(h.result, h.original); current.animate = false; }
}

/* ---------- composer ---------- */
function setTab(t, focus) {
  const wasAsk = tab === "ask";
  tab = t;
  $$(".tabs button").forEach(b => { const on = b.dataset.tab === t; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
  const ta = $("#text");
  ta.setAttribute("aria-labelledby", "tab-" + t);
  ta.placeholder = t === "ask" ? "Ask anything that depends on up-to-date facts..." : "Enter your answer or text here...";
  if ((t === "ask") !== wasAsk) ta.value = "";
  $("#drop").hidden = t !== "upload";
  const dl = $("#demo-list"); dl.hidden = t !== "demo";
  if (t === "demo") {
    dl.innerHTML = DEMO.map((d, i) => `<button type="button" data-d="${i}"><b>${esc(d.title)}</b><small>${esc(d.note)}</small></button>`).join("");
  }
  if (t === "ask") {
    dl.hidden = false;
    dl.innerHTML = ASK_SAMPLES.map((s, i) => `<button type="button" data-a="${i}">${esc(s)}</button>`).join("");
  }
  updateCount();
  if (focus) $(`#tab-${t}`).focus();
}
function updateCount() {
  const n = $("#text").value.length;
  $("#count").textContent = `${n.toLocaleString()}/${MAX.toLocaleString()}`;
  $("#go").disabled = busy || !$("#text").value.trim();
}
$$(".tabs button").forEach(b => {
  b.onclick = () => setTab(b.dataset.tab);
  b.onkeydown = e => {
    const order = $$(".tabs button").map(x => x.dataset.tab), i = order.indexOf(tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setTab(order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length], true); }
  };
});
$("#demo-list").onclick = e => {
  const d = e.target.closest("button[data-d]"), a = e.target.closest("button[data-a]");
  if (d) { $("#text").value = DEMO[d.dataset.d].text; updateCount(); $("#form").requestSubmit(); }   // Try Demo runs straight away
  if (a) { $("#text").value = ASK_SAMPLES[a.dataset.a]; updateCount(); $("#text").focus(); }
};
$("#text").addEventListener("input", updateCount);
$("#text").addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); $("#form").requestSubmit(); } });

/* file upload: read in the browser, nothing is uploaded until you press Check */
function readFile(f) {
  if (!f) return;
  if (f.size > 2e6) { showError("That file is too large.", " Use a text file under 2 MB."); return; }
  const fr = new FileReader();
  fr.onload = () => {
    const txt = String(fr.result || "");
    if (!txt.trim() || /\u0000/.test(txt.slice(0, 2000))) { showError("Could not read that file as text.", " Try a .txt, .md, .csv or .json file."); return; }
    $("#error").hidden = true;
    $("#text").value = txt.slice(0, MAX);
    $("#file-name").textContent = f.name + (txt.length > MAX ? ` (trimmed to ${MAX.toLocaleString()} characters)` : "");
    updateCount();
  };
  fr.onerror = () => showError("Could not read that file.", " Try another one.");
  fr.readAsText(f);
}
$("#pick").onclick = () => $("#file").click();
$("#file").onchange = e => readFile(e.target.files[0]);
const drop = $("#drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => readFile(e.dataTransfer.files[0]));

/* ---------- analyzing screen ---------- */
function startLoading(isAsk) {
  const steps = [...(isAsk ? ["Asking the model"] : []), "Extracting claims", "Searching Tavily sources", "Comparing claim freshness"];
  $("#steps").innerHTML = steps.map((s, i) => `<li data-s="${i === 0 ? "active" : "wait"}"><span class="dot"></span>${esc(s)}</li>`).join("");
  setBar(8, steps.length);
  show("loading");
  let i = 0;
  clearInterval(stepTimer);
  stepTimer = setInterval(() => {
    const items = $$("#steps li");
    if (i < items.length - 1) { items[i].dataset.s = "done"; items[++i].dataset.s = "active"; setBar(8 + (i / items.length) * 80); }
  }, 2000);
}
function setBar(p) {
  const bar = $(".bar"); $("#bar-fill").style.width = p + "%"; bar.setAttribute("aria-valuenow", Math.round(p));
}
function stopLoading(ok) {
  clearInterval(stepTimer);
  if (ok) { $$("#steps li").forEach(li => li.dataset.s = "done"); setBar(100); }
}
$("#cancel").onclick = () => { if (ctrl) ctrl.abort(); };

/* ---------- marking up the answer ---------- */
const WORDS = s => new Set((s.toLowerCase().match(/[a-z0-9À-￿]+(?:\.[0-9]+)*/g) || []).filter(w => w.length > 2 || /\d/.test(w)));
function splitSentences(text) { return text.match(/(?:[^\n]*?[.!?]+["')\]]*(?=\s|$)|[^\n]+)\s*|\n+/g) || [text]; }
function bestSentence(text, claimText) {
  const parts = splitSentences(text), cw = WORDS(claimText);
  let best = -1, bestScore = 0;
  if (cw.size) parts.forEach((p, i) => {
    if (!p.trim()) return;
    const pw = WORDS(p); let hit = 0; cw.forEach(w => pw.has(w) && hit++);
    const sc = hit / cw.size; if (sc > bestScore) { bestScore = sc; best = i; }
  });
  return {parts, best, score: bestScore};
}
function markup(answer, claims) {
  const parts = splitSentences(answer), owner = new Map();
  claims.forEach(c => {
    const b = bestSentence(answer, c.text);
    if (b.best >= 0 && b.score >= 0.5) owner.set(b.best, [...(owner.get(b.best) || []), c]);
  });
  return parts.map((p, i) => {
    const group = owner.get(i);
    if (!group) return esc(p);
    const c = group.reduce((a, b) => b.score < a.score ? b : a);
    const nums = group.map(g => g.n).sort((a, b) => a - b);
    const lead = p.match(/^\s*/)[0], trail = p.match(/\s*$/)[0], core = p.trim();
    const bad = c.verdict === "outdated" || c.verdict === "incorrect";
    const fix = bad && c.corrected ? `<ins>${esc(c.corrected)}</ins>` : "";
    return `${esc(lead)}<mark class="v-${esc(c.verdict)}" data-claim="${c.n}" tabindex="0" role="link" title="${esc(LABEL[c.verdict])}: open claim ${nums.join(" and ")}">${esc(core)}<sup>${nums.join(",")}</sup></mark>${fix}${esc(trail)}`;
  }).join("");
}
function contextFor(c, original) {
  if (!original) return "";
  const b = bestSentence(original, c.text);
  if (b.best < 0 || b.score < 0.4) return "";
  const s = b.parts[b.best].trim(), i = s.toLowerCase().indexOf(c.text.toLowerCase());
  const inner = i >= 0 ? esc(s.slice(0, i)) + `<mark class="v-${esc(c.verdict)}">${esc(s.slice(i, i + c.text.length))}</mark>` + esc(s.slice(i + c.text.length))
                       : `<mark class="v-${esc(c.verdict)}">${esc(s)}</mark>`;
  return `<div class="ctx"><small>Original statement</small>${inner}</div>`;
}
function linkSources(text) {
  const i = text.search(/\n\s*Sources:\s*\n/);
  const body = i >= 0 ? text.slice(0, i) : text, src = i >= 0 ? text.slice(i).replace(/^\s*Sources:\s*/, "") : "";
  let html = esc(body.trim());
  if (src.trim()) {
    const lines = src.trim().split("\n").map(l => {
      const m = l.match(/^\[(\d+)\]\s*(\S+)/);
      return m && safeUrl(m[2]) ? `<div>[${m[1]}] <a href="${esc(m[2])}" target="_blank" rel="noopener">${esc(host(m[2]))}</a></div>` : "";
    }).join("");
    html += `<span class="sources"><b>Sources</b>${lines}</span>`;
  }
  return html;
}

/* ---------- results dashboard ---------- */
const CIRC = 2 * Math.PI * 54;
function sparkPath(vals, seed) {
  // small trend line drawn from the claim scores in this group (decorative shape, real endpoints)
  const n = 8, W = 100, H = 40, src = vals.length ? vals : [50];
  const pts = Array.from({length: n}, (_, i) => {
    const t = i / (n - 1) * (src.length - 1), a = Math.floor(t), b = Math.min(src.length - 1, a + 1);
    const v = src[a] + (src[b] - src[a]) * (t - a);
    return v + Math.sin(i * 1.9 + seed) * 7 - (n - 1 - i) * (src.length === 1 ? 1.5 : 0);
  });
  const y = v => H - 4 - Math.max(0, Math.min(100, v)) / 100 * (H - 8);
  return pts.map((v, i) => `${i ? "L" : "M"}${(i / (n - 1) * W).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
}
function intelCard(kind, title, claims, total, i) {
  const group = claims.filter(c => kind === "current" ? (c.verdict === "current" || c.verdict === "stable") : c.verdict === kind);
  const pct = total ? Math.round(group.length / total * 100) : 0;
  return `<div ${stagger(i)}><button type="button" class="intel-card c-${kind}" data-filter="${kind}" style="width:100%">
    ${verdictIcon(kind, "ic")}<h3>${esc(title)}</h3>
    <span class="big">${group.length}</span><span class="pct">≈ ${pct}%</span>
    <svg class="spark-l" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="${sparkPath(group.map(c => c.score), i * 2.3)}"/></svg>
  </button></div>`;
}
function claimRow(c, i) {
  const bad = c.verdict === "outdated" || c.verdict === "incorrect";
  const checked = c.checked !== false && c.verdict !== "stable";
  const s = c.source && safeUrl(c.source.url) ? c.source : null;
  const src = s ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(host(s.url))}</a>${fmtDate(s.date) ? `<span>${esc(fmtDate(s.date))}</span>` : ""}` : "";
  return `<li class="claim v-${esc(c.verdict)}" data-n="${c.n}" id="claim-${c.n}" ${stagger(i)}>
    <button type="button" class="c-row" aria-expanded="false" aria-controls="more-${c.n}">
      ${verdictIcon(c.verdict, "c-ico")}
      <span class="c-title">${esc(c.text)}<small>${esc(c.category || "other")} · score ${c.score}/100</small></span>
      <span class="badge">${esc(LABEL[c.verdict] || c.verdict)}</span>
      ${ico("i-chev", "chev")}
    </button>
    <div class="c-more" id="more-${c.n}"><div><div class="c-inner">
      ${bad && c.corrected ? `<p class="c-now"><span>Now:</span>${esc(c.corrected)}</p>` : ""}
      <p class="c-why">${esc(c.explanation)}</p>
      <div class="c-foot"><span class="c-score"><span class="meter" aria-hidden="true"><i style="width:${Math.max(2, c.score)}%"></i></span>${c.score}/100</span>${src}<span>${checked ? (c.cached ? "From cache" : "Checked live") : "Skipped, low risk"}</span><span>Staleness risk ${Math.round((c.risk ?? 0) * 100)}%</span></div>
      <div class="c-actions"><a class="btn ghost small" href="#/claim/${c.n}">View details${ico("i-arrow")}</a></div>
    </div></div>
  </li>`;
}
function renderResults() {
  const {r, original, claims, counts, bad} = current;
  const total = claims.length, st = scoreStatus(r.overall_score, bad);
  const verified = counts.current + counts.stable;
  const sec = ((r.latency_ms || 0) / 1000).toFixed(1);
  const meta = `${r.claims_total} ${r.claims_total === 1 ? "claim" : "claims"} found. ${r.claims_verified} checked on the live web using ${r.credits_used} Tavily ${r.credits_used === 1 ? "credit" : "credits"}, in ${sec} seconds.`;
  const insight = bad ? ["bad", "i-bulb", "Consider reviewing the flagged claims for accuracy and checking the latest sources."]
    : counts.unverifiable ? ["", "i-bulb", "Some claims could not be confirmed on the live web. Review them against primary sources."]
    : ["good", "i-check", "Every checked claim agrees with the latest sources."];
  const hasFix = !!r.corrected_answer;
  const visible = showAll ? claims : claims.slice(0, 4);

  $("#results-body").innerHTML = `
    <div class="res-top"><span class="chip-ok">${ico("i-check")}Analysis Complete</span>
      <button class="btn ghost small" id="export" type="button">${ico("i-download")}Export Report</button></div>

    <h1 id="results-title" class="sr">Results</h1>
    <div class="dash stagger" style="--i:0">
      <div class="score-col">
        <div class="dial s-${st.k}" role="img" aria-label="Freshness score ${r.overall_score} out of 100">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="54"/><circle class="arc" cx="60" cy="60" r="54" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/></svg>
          <div class="dial-n"><b id="score-n">0</b><small>/100</small></div>
        </div>
        <span class="status s-${st.k}">${ico(st.icon)}${st.label}</span>
        <p>${st.note}</p>
      </div>
      <div class="ov-col">
        <h2>Overview</h2>
        <p class="ov-meta">${esc(meta)}</p>
        <div class="stat-row" data-stagger>
          <div class="stat c-incorrect" style="--i:1">${verdictIcon("incorrect")}<b data-count="${counts.incorrect}">0</b><span>Incorrect</span></div>
          <div class="stat c-outdated" style="--i:2">${verdictIcon("outdated")}<b data-count="${counts.outdated}">0</b><span>Outdated</span></div>
          <div class="stat c-current" style="--i:3">${verdictIcon("current")}<b data-count="${verified}">0</b><span>Verified</span></div>
          <div class="stat c-total" style="--i:4">${ico("i-doc")}<b data-count="${total}">0</b><span>Total Claims</span></div>
        </div>
        <div class="insight ${insight[0]}">${ico(insight[1])}<span>${insight[2]}</span></div>
      </div>
    </div>

    <div class="sec-head"><h2>Claim Intelligence</h2>${total > 4 || showAll ? `<button class="link" id="view-all" type="button">${showAll ? "Show less" : "View All"}${ico("i-arrow")}</button>` : ""}</div>
    <div class="intel" data-stagger>
      ${intelCard("incorrect", "Incorrect Claims", claims, total, 1)}
      ${intelCard("outdated", "Outdated Claims", claims, total, 2)}
      ${intelCard("current", "Verified Claims", claims, total, 3)}
      ${counts.unverifiable ? intelCard("unverifiable", "Unverified Claims", claims, total, 4) : ""}
    </div>

    <div class="sec-head"><h2>Claims</h2><span class="muted" style="font-size:13px">Weakest first. Select a claim to expand it.</span></div>
    <ol class="claims" id="claims">${visible.map(claimRow).join("")}</ol>

    <div class="sec-head"><h2>Answer review</h2>
      <div class="tabs-seg" role="tablist" aria-label="Answer view">
        <button type="button" role="tab" aria-selected="true" data-view="marked">Marked-up</button>
        ${hasFix ? '<button type="button" role="tab" aria-selected="false" data-view="fixed" tabindex="-1">Corrected</button>' : ""}
      </div>
    </div>
    <div id="view" class="page" role="tabpanel"></div>
    <div style="margin-top:12px"><button class="btn ghost small" id="copy-view" type="button">Copy text</button></div>`;

  const views = {
    marked: () => { const v = $("#view"); v.innerHTML = markup(original, claims) || '<span class="muted">No text to show.</span>'; },
    fixed: () => { $("#view").innerHTML = linkSources(r.corrected_answer || ""); }
  };
  let cur = "marked"; views.marked();
  $$(".tabs-seg button").forEach(b => b.onclick = () => {
    cur = b.dataset.view; views[cur]();
    $$(".tabs-seg button").forEach(x => { x.setAttribute("aria-selected", x === b); x.tabIndex = x === b ? 0 : -1; });
  });
  $("#copy-view").onclick = () => copy(cur === "fixed" ? r.corrected_answer : original, cur === "fixed" ? "Corrected answer copied" : "Answer copied");
  $("#export").onclick = exportReport;
  const va = $("#view-all"); if (va) va.onclick = () => { showAll = !showAll; current.animate = false; renderResults(); };
  $$(".intel-card").forEach(b => b.onclick = () => {
    const k = b.dataset.filter, hit = claims.find(c => k === "current" ? (c.verdict === "current" || c.verdict === "stable") : c.verdict === k);
    if (!hit) return;
    if (!$(`#claim-${hit.n}`)) { showAll = true; renderResults(); }
    const li = $(`#claim-${hit.n}`); setOpen(li, true); li.scrollIntoView({block: "center", behavior: reduceMotion() ? "auto" : "smooth"});
  });
  $("#claims").onclick = e => {
    const row = e.target.closest(".c-row"); if (row) setOpen(row.closest("li"));
  };
  $("#view").onclick = e => { const m = e.target.closest("mark[data-claim]"); if (m) location.hash = "#/claim/" + m.dataset.claim; };
  $("#view").onkeydown = e => { const m = e.target.closest?.("mark[data-claim]"); if (m && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); m.click(); } };

  animateDial(r.overall_score, !current.animate);
  animateCounts(!current.animate);
  current.animate = false;
}
function setOpen(li, force) {
  const open = force ?? !li.classList.contains("open");
  li.classList.toggle("open", open);
  $(".c-row", li).setAttribute("aria-expanded", open);
}
function animateDial(score, instant) {
  const arc = $(".dial .arc"), n = $("#score-n"), off = CIRC * (1 - score / 100);
  if (instant || reduceMotion()) { arc.style.transition = "none"; arc.style.strokeDashoffset = off; n.textContent = score; return; }
  requestAnimationFrame(() => requestAnimationFrame(() => arc.style.strokeDashoffset = off));
  countUp(n, score, 1300);
}
function animateCounts(instant) {
  $$("[data-count]").forEach(el => instant || reduceMotion() ? el.textContent = el.dataset.count : countUp(el, +el.dataset.count, 900));
}
function countUp(el, to, dur) {
  const t0 = performance.now();
  (function tick(t) {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(to * e);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ---------- claim detail ---------- */
function confidenceLabel(x) { return x >= 0.75 ? ["High", "hi"] : x >= 0.4 ? ["Medium", "md"] : ["Low", "lo"]; }
function renderClaim(n) {
  const {claims, original} = current, c = claims[n - 1];
  const bad = c.verdict === "outdated" || c.verdict === "incorrect";
  const [cl, ck] = confidenceLabel(c.confidence ?? 0);
  const s = c.source && safeUrl(c.source.url) ? c.source : null;
  const date = s ? fmtDate(s.date) : "";
  const others = claims.filter(x => x.n !== c.n && x.source && safeUrl(x.source.url) && (!s || x.source.url !== s.url))
    .filter((x, i, a) => a.findIndex(y => y.source.url === x.source.url) === i).slice(0, 3);
  const srcItem = (src, first) => `<a class="src ${first ? "first" : ""}" href="${esc(src.url)}" target="_blank" rel="noopener"><span><b>${esc(src.title || host(src.url))}</b><small>${esc(host(src.url))}${fmtDate(src.date) ? " · " + esc(fmtDate(src.date)) : ""}</small></span>${ico("i-ext")}</a>`;
  const corrected = bad ? (c.corrected || "No corrected wording was returned for this claim.")
    : c.verdict === "current" ? c.text
    : c.verdict === "stable" ? "This claim is low risk and was not rechecked." : "No confirmed information was found.";
  const whyText = c.explanation || (bad ? "The live web shows newer information than this claim." : "No further detail was returned.");
  const prev = claims[n - 2], next = claims[n];

  $("#claim-body").innerHTML = `
    <a class="back" href="#/results">${ico("i-back")}Back to Results</a>
    <div class="detail">
      <div class="d-main">
        <div class="d-card stagger c-${esc(c.verdict)}" style="--i:0">
          <div class="d-head">
            <span class="badge" style="--c:var(--${c.verdict === "incorrect" ? "red" : c.verdict === "outdated" ? "amber" : c.verdict === "unverifiable" ? "gray" : "green"})">${verdictIcon(c.verdict)}${esc(LABEL[c.verdict] || c.verdict)}</span>
            <span class="conf">Confidence: <b class="${ck}">${cl}</b> (${Math.round((c.confidence ?? 0) * 100)}%) · Freshness ${c.score}/100</span>
          </div>
          <h1 class="d-title">${esc(c.text)}</h1>
          ${contextFor(c, original)}
          <div class="cmp">
            <div class="orig ${bad ? "struck" : "ok"}"><h3><i></i>Original Claim</h3><p>${esc(c.text)}</p></div>
            <div class="corr"><h3><i></i>${bad ? "Correct Information" : c.verdict === "current" ? "Confirmed" : "Status"}</h3><p>${esc(corrected)}</p></div>
          </div>
          <div class="d-foot">
            <span>${ico("i-cal")}Published: <b>${date ? esc(date) : "Date not available"}</b></span>
            ${s ? `<a class="btn ghost small" href="${esc(s.url)}" target="_blank" rel="noopener">View Source${ico("i-ext")}</a>` : `<span>No source for this claim</span>`}
          </div>
        </div>
        <div class="why stagger c-${esc(c.verdict)}" style="--i:1">${verdictIcon(c.verdict)}<p>${esc(whyText)}</p></div>
        <div class="pager">
          ${prev ? `<a class="btn ghost small" href="#/claim/${n - 1}">${ico("i-back")}Previous claim</a>` : "<span></span>"}
          ${next ? `<a class="btn ghost small" href="#/claim/${n + 1}">Next claim${ico("i-arrow")}</a>` : "<span></span>"}
        </div>
      </div>
      <aside class="d-side stagger" style="--i:2" aria-label="Sources">
        <h3>${ico("i-globe")}Sources</h3>
        ${s ? srcItem(s, true) : '<p class="none">No web source was used. Low-risk claims are not searched, and some searches return nothing.</p>'}
        ${others.length ? `<h4>Also cited in this check</h4>${others.map(x => srcItem(x.source)).join("")}` : ""}
      </aside>
    </div>`;
}

/* ---------- export ---------- */
function exportReport() {
  const {r, claims, original} = current, st = scoreStatus(r.overall_score, current.bad);
  const lines = [`# Freshness Guard report`, ``, `Score: **${r.overall_score}/100** (${st.label}). ${r.claims_total} claims, ${r.claims_verified} checked live, ${r.credits_used} Tavily credits.`, ``, `## Claims`, ``];
  claims.forEach(c => {
    lines.push(`### ${c.n}. ${c.text}`, `- Verdict: ${LABEL[c.verdict] || c.verdict} (freshness ${c.score}/100, confidence ${Math.round((c.confidence ?? 0) * 100)}%)`);
    if (c.corrected) lines.push(`- Correction: ${c.corrected}`);
    if (c.explanation) lines.push(`- Why: ${c.explanation}`);
    if (c.source?.url) lines.push(`- Source: ${c.source.title || host(c.source.url)} ${c.source.url}${fmtDate(c.source.date) ? " (" + fmtDate(c.source.date) + ")" : ""}`);
    lines.push("");
  });
  lines.push(`## Original text`, ``, original);
  if (r.corrected_answer) lines.push(``, `## Corrected answer`, ``, r.corrected_answer);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], {type: "text/markdown"}));
  a.download = `freshness-report-${r.id || Date.now()}.md`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Report downloaded");
}

/* ---------- run ---------- */
function showError(title, detail) {
  const el = $("#error"); el.innerHTML = `<b>${esc(title)}</b>${esc(detail)}`; el.hidden = false;
}
$("#form").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("#text").value.trim();
  if (!text || busy) return;
  const isAsk = tab === "ask", mode = $("#fix").checked ? "rewrite" : "annotate";
  busy = true; $("#go").setAttribute("aria-busy", "true"); $("#go").disabled = true; $(".go-label").textContent = "Checking...";
  $("#error").hidden = true;
  ctrl = new AbortController();
  startLoading(isAsk);
  location.hash = "#/";   // keep the URL on the home route while analyzing
  try {
    const res = await fetch(isAsk ? "/api/ask" : "/api/check", {method: "POST", headers: {"Content-Type": "application/json"}, signal: ctrl.signal,
      body: JSON.stringify(isAsk ? {question: text, mode} : {text, mode})});
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : res.statusText || "Request failed");
    if (!Array.isArray(data.claims)) throw new Error("The server returned an unexpected response.");
    const original = isAsk ? data.answer : text;
    stopLoading(true);
    await new Promise(r => setTimeout(r, reduceMotion() ? 0 : 450));   // let the checklist finish
    current = prepare(data, original); showAll = false;
    saveHistory({id: data.id, at: Date.now(), input: text, original, result: data});
    busy = false;
    if (location.hash === "#/results") route(); else location.hash = "#/results";
  } catch (err) {
    stopLoading(false);
    busy = false;
    if (!$("[data-view=loading]").hidden) show("home");
    if (err.name === "AbortError") toast("Check cancelled");
    else showError("The check did not finish.", " " + (err.message || "Unknown error") + " Fix the cause, then press Check Freshness again.");
  } finally {
    busy = false; ctrl = null; $("#go").removeAttribute("aria-busy"); $(".go-label").textContent = "Check Freshness"; updateCount(); loadStats();
  }
});

/* ---------- history (local to this browser) ---------- */
const readHistory = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } };
function saveHistory(item) {
  try { localStorage.setItem(HKEY, JSON.stringify([item, ...readHistory().filter(h => h.id !== item.id)].slice(0, 20))); } catch {}
}
function renderHistory() {
  const h = readHistory();
  $("#history-empty").hidden = !!h.length; $("#history").hidden = !h.length; $("#clear-history").hidden = !h.length;
  $("#history").innerHTML = h.map((x, i) => {
    const st = scoreStatus(x.result.overall_score, 0);
    const when = new Date(x.at).toLocaleString(undefined, {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
    return `<li ${stagger(i)}><button type="button" data-i="${i}"><span class="h-score s-${st.k}">${x.result.overall_score}</span><span class="h-text"><b>${esc(x.input)}</b><small>${esc(st.label)} · ${x.result.claims_total} claims · ${esc(when)}</small></span>${ico("i-arrow", "h-go")}</button></li>`;
  }).join("");
}
$("#history").onclick = e => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  const x = readHistory()[b.dataset.i];
  if (x) { current = prepare(x.result, x.original); current.animate = true; showAll = false; location.hash = "#/results"; }
};
$("#clear-history").onclick = () => { try { localStorage.removeItem(HKEY); } catch {} renderHistory(); toast("History cleared"); };

/* ---------- stats and health ---------- */
async function loadStats() {
  try {
    const s = await (await fetch("/api/stats")).json();
    $$("#stats dd").forEach(d => d.textContent = (s[d.dataset.k] ?? 0).toLocaleString());
  } catch {}
}
function setPill(id, state, text) { const p = $(id); p.dataset.state = state; $("span", p).textContent = text; }
async function loadHealth() {
  try {
    health = await (await fetch("/api/health")).json();
    setPill("#pill-tavily", health.tavily_key_set ? "ok" : "bad", health.tavily_key_set ? "Tavily connected" : "Tavily key missing");
    setPill("#pill-bifrost", health.bifrost_reachable ? "ok" : "bad", health.bifrost_reachable ? "Bifrost online" : "Bifrost offline");
    const live = $("#live");
    live.dataset.state = health.tavily_key_set ? "ok" : "bad";
    $("span", live).textContent = health.tavily_key_set ? "Live web search enabled" : "Live web search unavailable";
    const msgs = [];
    if (!health.tavily_key_set) msgs.push(`<span><b>No Tavily key.</b> Paste it into <code>.env</code> as <code>TAVILY_API_KEY</code> and restart the server.</span>`);
    if (!health.bifrost_reachable) msgs.push(`<span><b>Bifrost is not reachable</b> at <code>${esc(health.bifrost_url)}</code>. Start it with <code>npx -y @maximhq/bifrost</code>.</span>`);
    const n = $("#health-notice"); n.innerHTML = msgs.join(""); n.hidden = !msgs.length;
  } catch {
    setPill("#pill-tavily", "unknown", "Tavily"); setPill("#pill-bifrost", "unknown", "Bifrost");
  }
}

/* ---------- API dialog ---------- */
function apiSnippet() {
  const model = health?.answer_model || "openai/gpt-4o-mini";
  return `curl ${location.origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Who is the current UK prime minister?"}],
    "freshness": {"mode": "rewrite"}
  }'`;
}
$("#open-api").onclick = () => { $("#api-snippet").textContent = apiSnippet(); $("#api-dialog").showModal(); };
$("#copy-api").onclick = () => copy(apiSnippet(), "Command copied");
$("#api-dialog").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

setTab("paste"); loadStats(); loadHealth(); route();