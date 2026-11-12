const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LABEL = {current:"Still true", outdated:"Outdated", incorrect:"Incorrect", unverifiable:"Could not verify", stable:"Stable fact"};
const SAMPLES = {
  ask: ["What is the latest stable version of Python?", "Who is the current UK prime minister?", "What is the newest iPhone model and its price?"],
  paste: ["Boris Johnson is the UK Prime Minister. The latest Python version is 3.8, and Windows 10 is Microsoft's newest operating system. Paris is the capital of France."]
};
let tab = "ask";

function setTab(t) {
  tab = t;
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  $("#text").placeholder = t === "ask" ? "Ask anything that depends on up-to-date facts..." : "Paste any AI-written answer here...";
  $("#text").value = "";
  $("#samples").innerHTML = SAMPLES[t].map((s, i) => `<button data-i="${i}">${esc(s.length > 48 ? s.slice(0, 48) + "..." : s)}</button>`).join("");
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => setTab(b.dataset.tab));
$("#samples").onclick = e => { if (e.target.dataset.i) $("#text").value = SAMPLES[tab][e.target.dataset.i]; };

function render(r, original) {
  $("#result").hidden = false;
  $("#stamp").className = "stamp " + r.overall_verdict;
  $("#score").textContent = r.overall_score;
  $("#verdict").textContent = {fresh: "Looks fresh", stale: "Outdated facts found", uncertain: "Worth a second look"}[r.overall_verdict];
  $("#meta").textContent = `${r.claims_total} claims found. ${r.claims_verified} checked on the live web using ${r.credits_used} Tavily credits, in ${(r.latency_ms / 1000).toFixed(1)} seconds.`;
  $("#answer").textContent = original;
  $("#fixed-wrap").hidden = !r.corrected_answer;
  $("#fixed").textContent = r.corrected_answer || "";
  $("#claims").innerHTML = r.claims.map(c => {
    const bad = c.verdict === "outdated" || c.verdict === "incorrect";
    const src = c.source ? `<a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.title || c.source.url)}</a>` : "";
    return `<li class="claim ${c.verdict}">
      <span class="chip">${LABEL[c.verdict]}</span><span class="bar"><i style="width:${c.score}%"></i></span>${c.score}/100
      <div class="${bad ? "struck" : ""}">${esc(c.text)}</div>
      ${bad && c.corrected ? `<p class="now">Now: ${esc(c.corrected)}</p>` : ""}
      <p class="why">${esc(c.explanation)} ${src}${c.cached ? " (from cache)" : ""}</p></li>`;
  }).join("");
  $("#result").scrollIntoView({behavior: "smooth", block: "start"});
}

async function run() {
  const text = $("#text").value.trim();
  if (!text) return;
  const ask = tab === "ask", mode = $("#mode").value;
  $("#go").disabled = true; $("#go").textContent = "Checking the live web...";
  $("#error").hidden = true;
  try {
    const res = await fetch(ask ? "/api/ask" : "/api/check", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(ask ? {question: text, mode} : {text, mode})});
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    render(data, ask ? data.answer : text);
  } catch (e) {
    $("#error").textContent = e.message; $("#error").hidden = false;
  } finally {
    $("#go").disabled = false; $("#go").textContent = "Check answer"; loadStats();
  }
}
$("#go").onclick = run;

async function loadStats() {
  try {
    const s = await (await fetch("/api/stats")).json();
    $("#stats").textContent = `So far: ${s.checks} answers checked, ${s.claims_verified} claims verified, ${s.cache_hits} served from cache, ${s.tavily_credits} Tavily credits used.`;
  } catch {}
}
async function loadHealth() {
  try {
    const h = await (await fetch("/api/health")).json(), msgs = [];
    if (!h.tavily_key_set) msgs.push("No Tavily key found. Paste it into the .env file as TAVILY_API_KEY and restart the server.");
    if (!h.bifrost_reachable) msgs.push(`Bifrost is not reachable at ${h.bifrost_url}. Start it with: npx -y @maximhq/bifrost`);
    if (msgs.length) { $("#health").textContent = msgs.join(" "); $("#health").hidden = false; }
  } catch {}
}
setTab("ask"); loadStats(); loadHealth();
