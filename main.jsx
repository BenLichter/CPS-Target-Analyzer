import React, { useState, useRef, useEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL    = "claude-sonnet-4-20250514";
const TKEY_LS  = "cp_tavily_key";
const NJKEY_LS = "cp_ninjapear_key";

const C = {
  bg:"#07090F", surface:"#0D1117", card:"#111827", border:"#1F2937",
  accent:"#00C2FF", accentDim:"#00C2FF12", gold:"#F59E0B", goldDim:"#F59E0B12",
  green:"#10B981", greenDim:"#10B98112", red:"#EF4444", redDim:"#EF444412",
  purple:"#8B5CF6", cyan:"#06B6D4", text:"#F1F5F9", muted:"#94A3B8", dim:"#334155",
};

const BLOCKED = ["bloomberg.com","wsj.com","ft.com","economist.com","nytimes.com","washingtonpost.com","barrons.com","hbr.org"];

const COMPARE_ROWS = [
  ["Merchant Acceptance","merchant_acceptance"],["Fiat On-Ramp","fiat_on_ramp"],
  ["Fiat Off-Ramp","fiat_off_ramp"],["Crypto Breadth","crypto_breadth"],
  ["White Label","white_label"],["Compliance","compliance_licensing"],
  ["Costs & Fees","costs_fees"],["API Architecture","api_architecture"],
  ["Scalability","scalability"],["SLA & Support","sla_support"],
];

// ─── Pure helpers (no hooks, no React) ───────────────────────────────────────
function sanitize(str) {
  if (typeof str !== "string") return str;
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDFFF) continue;
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) continue;
    out += str[i];
  }
  return out;
}

async function callAPI(system, user, maxTokens) {
  const res = await fetch("/api/anthropic", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 6000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error("API " + res.status + (t ? " - " + t.slice(0, 120) : "")); }
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  const blocks = (j.content || []).filter(b => b.type === "text");
  if (!blocks.length) throw new Error("Empty response from Claude");
  return blocks.map(b => b.text).join("\n");
}

function parseJSON(raw) {
  let s = raw.trim().replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error("JSON parse: " + e.message); } }
  throw new Error("No JSON found");
}

async function tavilyRaw(query, key, n, days) {
  if (!key) return [];
  try {
    const body = { api_key: key, query, max_results: n || 8, include_answer: false, include_raw_content: false, search_depth: "basic" };
    if (days) body.days = days;
    const res = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return [];
    const d = await res.json();
    return d.results || [];
  } catch { return []; }
}

async function njRole(role, domain, key) {
  if (!key) return null;
  try {
    const res = await fetch("/api/ninjapear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: "v1/employee/profile", params: { employer_website: "https://" + domain, role }, key }) });
    if (!res.ok) return null;
    const d = await res.json();
    return (d.first_name || d.full_name) ? d : null;
  } catch { return null; }
}

async function njCompany(domain, key) {
  if (!key) return null;
  try {
    const res = await fetch("/api/ninjapear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: "v1/company/details", params: { website: "https://" + domain }, key }) });
    if (!res.ok) return null;
    const d = await res.json();
    const hq = (d.addresses || []).find(a => a.is_primary) || (d.addresses || [])[0] || {};
    return { employees: d.employee_count ? String(d.employee_count) : "", hq: [hq.city, hq.country].filter(Boolean).join(", "), executives: d.executives || [] };
  } catch { return null; }
}

function profileToContact(p, source) {
  if (!p) return null;
  const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ");
  if (!name) return null;
  const job = (p.work_experience || []).find(e => !e.end_date);
  return { name, title: job?.role || p.role || "", category: "Influencer", verified_source: "ninjapear", verification_confidence: "HIGH", why_target: "Key executive", outreach_angle: "Direct executive outreach", source };
}

async function runAnalysis(company, onStep, keys) {
  const { tavily: tKey, ninjapear: njKey } = keys;
  const domain = company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
  const todayStr = new Date().toDateString();
  const SYS = "You are a senior fintech B2B sales intelligence expert for CoinPayments (2000+ cryptos, white-label, fiat on/off ramps, API-first). Output ONLY valid JSON. No markdown. Start with { end with }. Values under 35 words. ARR: use bottoms-up math, be conservative ($50K-$500K typical range).";

  // Phase 0a — News
  let ctx = "";
  let rawNews = [];
  if (tKey) {
    onStep("🌐 Searching live news...");
    const results = await Promise.all([
      tavilyRaw(company + " partnership deal integration 2025 2026", tKey, 8, 180),
      tavilyRaw(company + " crypto blockchain stablecoin payments 2025 2026", tKey, 8, 180),
      tavilyRaw(company + " funding expansion product launch 2025 2026", tKey, 6, 180),
      tavilyRaw(company + " executive strategy international 2025 2026", tKey, 6, 180),
    ]);
    const seenU = new Set(), seenT = new Set();
    for (const arr of results) {
      for (const r of arr) {
        const tk = (r.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
        if (seenT.has(tk) || !r.url || seenU.has(r.url)) continue;
        const host = r.url.replace(/https?:\/\/(www\.)?/, "").split("/")[0];
        if (BLOCKED.some(d => host.includes(d))) continue;
        seenT.add(tk); seenU.add(r.url); rawNews.push(r);
      }
    }
    rawNews.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    if (rawNews.length) {
      ctx = "=== LIVE NEWS for " + company + " (" + todayStr + ") ===\n";
      rawNews.slice(0, 12).forEach((r, i) => { ctx += (i + 1) + ". " + r.title + "\n   " + r.url + "\n   " + (r.published_date || "") + "\n   " + (r.content || "").slice(0, 250) + "\n\n"; });
      ctx += "=== END NEWS ===\n\n";
      ctx = sanitize(ctx);
    }
  }

  // Phase 0b — NinjaPear
  onStep("🎯 Finding executives via NinjaPear...");
  var contacts = [];
  var coInfo = null;
  if (njKey) {
    const ROLES = ["CEO", "CMO", "CPO", "CTO", "COO", "CFO", "VP Product", "VP Payments", "VP Partnerships", "VP Growth", "VP Engineering", "Head of Business Development"];
    const [co, ...people] = await Promise.all([njCompany(domain, njKey), ...ROLES.map(r => njRole(r, domain, njKey))]);
    coInfo = co;
    const seen = new Set();
    for (const p of people) {
      const c = profileToContact(p, "ninjapear");
      if (c && !seen.has(c.name.toLowerCase())) { seen.add(c.name.toLowerCase()); contacts.push(c); }
    }
    if (contacts.length || coInfo) {
      if (coInfo) ctx += "COMPANY DATA: employees=" + (coInfo.employees || "?") + " hq=" + (coInfo.hq || "?") + "\n";
      if (contacts.length) { ctx += "NINJAPEAR CONTACTS:\n"; contacts.forEach((c, i) => { ctx += (i + 1) + ". " + c.name + " | " + c.title + "\n"; }); ctx += "\n"; }
    }
  }

  // Phase 0c — Scraping
  if (tKey) {
    onStep("🔍 Scraping executive mentions...");
    const [r1, r2, r3] = await Promise.all([
      tavilyRaw(company + " VP Director executive said linkedin.com 2024 2025", tKey, 10, 730),
      tavilyRaw(company + " speaker podcast interview conference keynote 2024 2025", tKey, 8, 730),
      tavilyRaw(company + " Bancorp Stride Evolve Visa stablecoin partner integration", tKey, 6, 365),
    ]);
    const allRaw = [...r1, ...r2].filter(Boolean);
    if (allRaw.length) {
      const txt = allRaw.slice(0, 15).map((r, i) => (i + 1) + ". " + r.title + "\n" + (r.content || "").slice(0, 300)).join("\n\n");
      onStep("📋 Extracting names from scraped data...");
      try {
        const extRaw = await callAPI("Extract named employees. Output ONLY a JSON array. Never invent names.", "Find every real named person working at " + company + " from these sources. Output ONLY [{\"name\":\"Full Name\",\"title\":\"role\"}]. DO NOT include people from other companies.\n\n" + txt, 1500);
        let es = extRaw.trim().replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
        if (es.startsWith("[")) {
          const extracted = JSON.parse(es);
          const existing = new Set(contacts.map(c => c.name.toLowerCase()));
          for (const e of extracted) {
            if (e.name && e.name.length > 3 && !existing.has(e.name.toLowerCase())) {
              contacts.push({ name: e.name, title: e.title || "", category: "Influencer", verified_source: "scraped", verification_confidence: "MEDIUM", why_target: "Mentioned in public sources", outreach_angle: "Referenced in press/events" });
              existing.add(e.name.toLowerCase());
            }
          }
        }
      } catch {}
    }
    if (r3.length) { ctx += "PARTNER SIGNALS:\n" + r3.slice(0, 4).map(r => r.title + ": " + (r.content || "").slice(0, 150)).join("\n") + "\n\n"; }
  }

  // Phase 1 — Core intelligence
  onStep("🧠 Claude core analysis...");
  const p1raw = await callAPI(SYS, sanitize(ctx) + "\n\nAnalyze " + company + " as a CoinPayments sales target. Today: " + todayStr + ".\n\nOutput ONLY this JSON:\n{\n  \"company\": \"" + company + "\",\n  \"segment\": \"e.g. Neo-bank\",\n  \"hq\": \"City, Country\",\n  \"website\": \"domain.com\",\n  \"employees\": \"count or range\",\n  \"revenue\": \"annual revenue\",\n  \"executive_summary\": \"3-sentence opportunity summary\",\n  \"tam_som_arr\": { \"tam_usd\": \"$X\", \"som_usd\": \"$X\", \"likely_arr_usd\": \"$X conservative\", \"upside_arr_usd\": \"$X optimistic\", \"methodology\": \"1 sentence\", \"assumptions\": [\"assumption 1\", \"assumption 2\"], \"reasoning\": \"2 sentences\" },\n  \"partnerships\": [{ \"partner\": \"Name\", \"type\": \"type\", \"what_they_provide\": \"what\", \"dependency\": \"Critical|Important|Minor\", \"cp_angle\": \"how CP fits\" }],\n  \"geography\": { \"markets\": [\"list\"], \"gaps\": \"key gaps\" },\n  \"incumbent\": { \"name\": \"provider or null\", \"weaknesses\": \"why switch\" },\n  \"missed_opportunity\": { \"headline\": \"punchy sentence\", \"competitor_threat\": \"who is stealing users\", \"market_stat_1\": \"stat\", \"market_stat_2\": \"stat\", \"narrative\": \"5-sentence argument\", \"urgency\": \"High|Medium|Low\", \"urgency_reason\": \"why now\" },\n  \"intent_data\": [{ \"signal\": \"observation\", \"type\": \"Funding|Hiring|Product|Partnership|Regulatory\", \"date\": \"when\", \"implication\": \"what it means\" }],\n  \"recent_news\": [],\n  \"alert_keywords\": [\"kw1\", \"kw2\", \"kw3\"]\n}", 7000);
  const p1 = parseJSON(p1raw);

  // Merge contacts
  p1.key_contacts = contacts.length > 0 ? contacts : (p1.key_contacts || []);

  // Phase 1b — News categories
  if (rawNews.length > 0) {
    onStep("📰 Categorizing news...");
    try {
      const articleList = rawNews.slice(0, 10).map((r, i) => (i + 1) + ". " + r.title + " (" + (r.published_date || "") + ")\n   " + (r.content || "").slice(0, 180)).join("\n\n");
      const catRaw = await callAPI("Categorize news articles. Output ONLY a JSON array.", "For each article about " + company + ", output: {\"idx\":N, \"category\":\"Funding|Partnership|Product|Regulatory|Leadership|Competitive|Crypto|Other\", \"summary\":\"1 sentence\", \"cp_relevance\":\"why matters for CoinPayments\"}\n\n" + articleList, 2000);
      let cs = catRaw.trim().replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      const cats = cs.startsWith("[") ? JSON.parse(cs) : [];
      p1.recent_news = rawNews.slice(0, 10).map((r, i) => {
        const cat = cats.find(c => c.idx === i + 1);
        return { title: r.title, url: r.url, date: r.published_date || "", source: r.url.replace(/https?:\/\/(www\.)?/, "").split("/")[0], category: cat?.category || "Other", summary: cat?.summary || "", cp_relevance: cat?.cp_relevance || "" };
      });
    } catch { p1.recent_news = rawNews.slice(0, 6).map(r => ({ title: r.title, url: r.url, date: r.published_date || "", source: r.url.split("/")[2] || "" })); }
  }

  // Phase 2 — Competitive + GTM (parallel)
  onStep("⚔️ Competitive analysis & GTM plan...");
  const [p2raw, p3raw] = await Promise.all([
    callAPI(SYS, "Build competitive comparison for CoinPayments vs " + company + "'s likely incumbent.\nOutput ONLY: {\"competitive_comparison\":{\"coinpayments\":{" + COMPARE_ROWS.map(([, k]) => "\"" + k + "\":\"rating + 1 sentence\"").join(",") + "},\"incumbent\":{\"name\":\"provider name\",\"" + COMPARE_ROWS.map(([, k]) => k + "\":\"rating + 1 sentence\"").join(",\"") + "\"}},\"positioning_statement\":\"2-sentence CP positioning\"}", 3000),
    callAPI(SYS, "Build GTM attack plan for CoinPayments to win " + company + ".\nOutput ONLY: {\"attack_plan\":{\"icp_profile\":{\"primary_buyer\":\"title\",\"champion\":\"who advocates\",\"blocker\":\"who blocks\",\"trigger_event\":\"what makes them act\"},\"sequenced_timeline\":[{\"week\":\"Week 1-2\",\"action\":\"specific action\",\"goal\":\"what to achieve\"}],\"objection_handling\":[{\"objection\":\"likely objection\",\"response\":\"how to handle\"}],\"motions\":{\"abm\":{\"tactic\":\"specific ABM tactic\"},\"outbound\":{\"hook\":\"opening line\",\"cta\":\"call to action\"},\"events\":{\"events\":\"which conferences\",\"play\":\"engagement strategy\"}}}}", 3000),
  ]);

  try { const p2 = parseJSON(p2raw); p1.competitive_comparison = p2.competitive_comparison; p1.positioning_statement = p2.positioning_statement; } catch {}
  try { const p3 = parseJSON(p3raw); p1.attack_plan = p3.attack_plan; } catch {}

  p1.analyzedAt = new Date().toISOString();
  return p1;
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function Badge({ color, children, sm }) {
  const colors = { accent: [C.accentDim, C.accent], gold: [C.goldDim, C.gold], green: [C.greenDim, C.green], purple: ["#8B5CF612", C.purple], red: [C.redDim, C.red], muted: [C.dim + "33", C.muted], cyan: ["#06B6D412", C.cyan] };
  const [bg, fg] = colors[color || "muted"] || colors.muted;
  return <span style={{ background: bg, color: fg, borderRadius: 10, padding: sm ? "1px 7px" : "2px 10px", fontSize: sm ? 9 : 10, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{children}</span>;
}

function Sec({ title, icon, accent, children, open: initOpen }) {
  // useState is the ONLY hook — called first, unconditionally
  var defaultOpen = initOpen === undefined ? true : initOpen;
  var stateArr = useState(defaultOpen);
  var open = stateArr[0];
  var setOpen = stateArr[1];
  var a = accent || C.accent;
  return (
    React.createElement("div", { style: { background: C.card, border: "1px solid " + C.border, borderRadius: 12, marginBottom: 12, overflow: "hidden" } },
      React.createElement("div", { onClick: function() { setOpen(!open); }, style: { padding: "11px 16px", borderBottom: open ? "1px solid " + C.border : "none", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" } },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          icon ? React.createElement("span", { style: { fontSize: 14 } }, icon) : null,
          React.createElement("span", { style: { color: C.text, fontWeight: 700, fontSize: 12 } }, title)
        ),
        React.createElement("span", { style: { color: a, fontSize: 11 } }, open ? "▲" : "▼")
      ),
      open ? React.createElement("div", { style: { padding: "14px 16px" } }, children) : null
    )
  );
}

function Chip({ label, value, color }) {
  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "8px 14px", border: "1px solid " + C.border }}>
      <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
      <div style={{ color: color || C.text, fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  );
}

// ─── Contact Card (pure, no hooks) ───────────────────────────────────────────
function ContactCard({ contact, company }) {
  // All hooks at top
  var s1 = useState(false); var showPaste = s1[0]; var setShowPaste = s1[1];
  var s2 = useState(""); var paste = s2[0]; var setPaste = s2[1];

  var cc = { "Economic Buyer": "gold", "Champion": "green", "Technical Buyer": "cyan", "Influencer": "accent", "Blocker": "red" }[contact.category] || "muted";
  var liUrl = paste.trim() || contact.linkedin || "";
  var sq = [contact.name, company, contact.title].filter(Boolean).join(" ");
  var liSearch = "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(sq);
  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "12px 14px", marginBottom: 8, border: "1px solid " + C.border }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{contact.name}</span>
            <Badge color={cc} sm>{contact.category}</Badge>
            <Badge color={contact.verification_confidence === "HIGH" ? "green" : "gold"} sm>
              {contact.verified_source === "ninjapear" ? "🎯 NinjaPear" : contact.verified_source === "scraped" ? "🌐 Web" : "⚠ Verify"}
            </Badge>
          </div>
          {contact.title && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{contact.title}</div>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {liUrl
            ? <a href={liUrl} target="_blank" rel="noreferrer" style={{ background: C.accentDim, color: C.accent, border: "1px solid " + C.accent + "40", borderRadius: 6, padding: "4px 10px", fontSize: 10, textDecoration: "none", fontWeight: 700 }}>LinkedIn →</a>
            : <a href={liSearch} target="_blank" rel="noreferrer" style={{ background: "transparent", color: C.dim, border: "1px solid " + C.border, borderRadius: 6, padding: "4px 10px", fontSize: 10, textDecoration: "none" }}>Search</a>
          }
          <button onClick={function() { setShowPaste(!showPaste); }} style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 6, padding: "4px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>✏</button>
        </div>
      </div>
      {showPaste && <input value={paste} onChange={function(e) { setPaste(e.target.value); }} placeholder="Paste LinkedIn URL..." style={{ width: "100%", background: C.card, border: "1px solid " + C.accent, borderRadius: 6, padding: "6px 8px", color: C.text, fontSize: 11, outline: "none", fontFamily: "inherit", boxSizing: "border-box", marginTop: 6 }} />}
      {contact.outreach_angle && <div style={{ color: C.accent, fontSize: 11, marginTop: 6 }}>💬 {contact.outreach_angle}</div>}
    </div>
  );
}

// ─── Analysis View ────────────────────────────────────────────────────────────
function AnalysisView({ data }) {
  // ALL hooks declared unconditionally at the very top — NEVER move these
  var s1 = useState([]); var contacts = s1[0]; var setContacts = s1[1];
  var s2 = useState([]); var chat = s2[0]; var setChat = s2[1];
  var s3 = useState(""); var q = s3[0]; var setQ = s3[1];
  var s4 = useState(false); var asking = s4[0]; var setAsking = s4[1];
  var chatRef = useRef(null);

  // Effects after ALL hooks
  useEffect(function() {
    setContacts(Array.isArray(data.key_contacts) ? data.key_contacts : []);
  }, [data.key_contacts]);

  useEffect(function() {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat]);

  // Derived values — computed after hooks, never before
  var mo  = data.missed_opportunity || {};
  var t   = data.tam_som_arr || {};
  var inc = data.incumbent || {};
  var geo = data.geography || {};
  var ap  = data.attack_plan || {};
  var cc  = data.competitive_comparison || {};

  async function ask() {
    var question = q.trim();
    if (!question || asking) return;
    setQ(""); setAsking(true);
    var hist = chat.concat([{ role: "user", content: question }]);
    setChat(hist);
    try {
      var ctx = "Company: " + data.company + ", Segment: " + data.segment + ", Summary: " + data.executive_summary + ", ARR: " + t.likely_arr_usd + ", Incumbent: " + inc.name;
      var ans = await callAPI("You are a CoinPayments sales expert. Answer concisely.", "Account: " + ctx + "\n\nQuestion: " + question, 600);
      setChat(hist.concat([{ role: "assistant", content: ans }]));
    } catch (e) {
      setChat(hist.concat([{ role: "assistant", content: "Error: " + e.message }]));
    }
    setAsking(false);
  }

  return (
    <div>
      {/* Header card */}
      <div style={{ background: C.surface, borderRadius: 12, padding: "16px 20px", marginBottom: 16, border: "1px solid " + C.border }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>{data.company}</div>
        <div style={{ color: C.accent, fontSize: 13, marginBottom: 10 }}>{data.segment}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: data.executive_summary ? 12 : 0 }}>
          {data.hq && <Badge color="muted">📍 {data.hq}</Badge>}
          {data.employees && <Badge color="muted">👥 {data.employees}</Badge>}
          {data.website && <Badge color="cyan">🌐 {data.website}</Badge>}
          {inc.name && <Badge color="gold">⚔ vs {inc.name}</Badge>}
        </div>
        {data.executive_summary && <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.7 }}>{data.executive_summary}</div>}
      </div>

      {/* Missed Opportunity */}
      {mo.headline && (
        <Sec title="🚨 Missed Opportunity" accent={C.red} open={true}>
          <div style={{ background: C.redDim, border: "1px solid " + C.red + "40", borderRadius: 8, padding: "12px 16px", marginBottom: 10 }}>
            <div style={{ color: C.red, fontWeight: 800, fontSize: 14, marginBottom: 4 }}>{mo.headline}</div>
            {mo.urgency_reason && <div style={{ color: C.muted, fontSize: 11 }}>{mo.urgency_reason}</div>}
          </div>
          {mo.competitor_threat && <div style={{ color: C.gold, fontSize: 11, marginBottom: 8 }}>⚠ Competitor threat: {mo.competitor_threat}</div>}
          {[mo.market_stat_1, mo.market_stat_2, mo.market_stat_3].filter(Boolean).map(function(s, i) {
            return <div key={i} style={{ padding: "6px 10px", background: C.surface, borderRadius: 6, marginBottom: 5, color: C.muted, fontSize: 11, borderLeft: "2px solid " + C.accent }}>📊 {s}</div>;
          })}
          {mo.narrative && <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.7, marginTop: 8 }}>{mo.narrative}</div>}
        </Sec>
      )}

      {/* ARR */}
      {t.likely_arr_usd && (
        <Sec title="💰 ARR Potential" accent={C.green}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
            {t.likely_arr_usd && <Chip label="Conservative ARR" value={t.likely_arr_usd} color={C.green} />}
            {t.upside_arr_usd && <Chip label="Upside ARR" value={t.upside_arr_usd} color={C.gold} />}
            {t.som_usd && <Chip label="SOM" value={t.som_usd} color={C.accent} />}
          </div>
          {t.methodology && <div style={{ color: C.muted, fontSize: 11, marginBottom: 6 }}>📐 {t.methodology}</div>}
          {(t.assumptions || []).map(function(a, i) { return <div key={i} style={{ color: C.dim, fontSize: 11, marginBottom: 4 }}>• {a}</div>; })}
          {t.reasoning && <div style={{ color: C.muted, fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>{t.reasoning}</div>}
        </Sec>
      )}

      {/* Key Contacts */}
      <Sec title={"👥 Key Contacts" + (contacts.length ? " (" + contacts.length + ")" : "")} accent={C.cyan} open={true}>
        {contacts.length === 0 && <div style={{ color: C.dim, fontSize: 11, textAlign: "center", padding: 20 }}>No contacts found. Add a NinjaPear key for verified executives.</div>}
        {contacts.map(function(c, i) { return <ContactCard key={i} contact={c} company={data.company} />; })}
      </Sec>

      {/* Partnerships */}
      {(data.partnerships || []).length > 0 && (
        <Sec title="🤝 Partnerships" accent={C.purple} open={false}>
          {(data.partnerships || []).map(function(p, i) {
            return (
              <div key={i} style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", marginBottom: 8, border: "1px solid " + C.border }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>{p.partner}</span>
                  <Badge color="purple" sm>{p.type}</Badge>
                  {p.dependency && <Badge color={p.dependency === "Critical" ? "red" : p.dependency === "Important" ? "gold" : "muted"} sm>{p.dependency}</Badge>}
                </div>
                {p.what_they_provide && <div style={{ color: C.muted, fontSize: 11, marginBottom: 4 }}>{p.what_they_provide}</div>}
                {p.cp_angle && <div style={{ color: C.accent, fontSize: 11 }}>🎯 {p.cp_angle}</div>}
              </div>
            );
          })}
        </Sec>
      )}

      {/* Competitive */}
      {cc.coinpayments && (
        <Sec title="💡 Value Prop & Comparison" accent={C.gold} open={false}>
          {data.positioning_statement && <div style={{ background: C.goldDim, border: "1px solid " + C.gold + "40", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: C.gold, fontSize: 11, lineHeight: 1.6 }}>{data.positioning_statement}</div>}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: C.card }}>
                <th style={{ padding: "7px 10px", textAlign: "left", color: C.dim, fontSize: 10, borderBottom: "1px solid " + C.border }}>Dimension</th>
                <th style={{ padding: "7px 10px", textAlign: "left", color: C.accent, fontSize: 10, borderBottom: "1px solid " + C.border }}>CoinPayments</th>
                <th style={{ padding: "7px 10px", textAlign: "left", color: C.gold, fontSize: 10, borderBottom: "1px solid " + C.border }}>{cc.incumbent ? cc.incumbent.name || "Incumbent" : "Incumbent"}</th>
              </tr></thead>
              <tbody>
                {COMPARE_ROWS.map(function(row, i) {
                  var label = row[0]; var key = row[1];
                  return (
                    <tr key={key} style={{ borderBottom: "1px solid " + C.border, background: i % 2 === 0 ? "transparent" : C.card + "80" }}>
                      <td style={{ padding: "7px 10px", color: C.muted, fontWeight: 600 }}>{label}</td>
                      <td style={{ padding: "7px 10px", color: C.text }}>{(cc.coinpayments || {})[key] || "—"}</td>
                      <td style={{ padding: "7px 10px", color: C.muted }}>{cc.incumbent ? (cc.incumbent[key] || "—") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Sec>
      )}

      {/* GTM */}
      {ap.icp_profile && (
        <Sec title="🗺️ GTM Attack Plan" accent={C.purple} open={false}>
          <div style={{ background: C.surface, borderRadius: 8, padding: "12px 14px", marginBottom: 12, border: "1px solid " + C.border }}>
            <div style={{ color: C.accent, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>ICP Profile</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[["Primary Buyer", ap.icp_profile.primary_buyer], ["Champion", ap.icp_profile.champion], ["Blocker", ap.icp_profile.blocker], ["Trigger", ap.icp_profile.trigger_event]].map(function(kv) {
                return kv[1] ? <div key={kv[0]}><span style={{ color: C.dim, fontSize: 10 }}>{kv[0]}: </span><span style={{ color: C.muted, fontSize: 11 }}>{kv[1]}</span></div> : null;
              })}
            </div>
          </div>
          {(ap.sequenced_timeline || []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: C.text, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Sequenced Timeline</div>
              {(ap.sequenced_timeline || []).map(function(s, i) {
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid " + C.border }}>
                    <div style={{ color: C.accent, fontSize: 10, fontWeight: 700, minWidth: 70 }}>{s.week}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: C.text, fontSize: 11 }}>{s.action}</div>
                      {s.goal && <div style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>{s.goal}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {ap.motions && (
            <div>
              <div style={{ color: C.text, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>GTM Motions</div>
              {Object.values(ap.motions).filter(Boolean).map(function(m, i) {
                return (
                  <div key={i} style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", marginBottom: 8, border: "1px solid " + C.border }}>
                    <div style={{ color: C.accent, fontWeight: 700, fontSize: 11, marginBottom: 4 }}>{m.name || ""}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>{m.tactic || m.hook || m.trigger || m.content || m.play || m.events || ""}</div>
                  </div>
                );
              })}
            </div>
          )}
          {(ap.objection_handling || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: C.text, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Objection Handling</div>
              {(ap.objection_handling || []).map(function(o, i) {
                return (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ color: C.gold, fontSize: 11, fontWeight: 600, marginBottom: 2 }}>❓ {o.objection}</div>
                    <div style={{ color: C.muted, fontSize: 11, paddingLeft: 12 }}>✅ {o.response}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Sec>
      )}

      {/* Intent */}
      {(data.intent_data || []).length > 0 && (
        <Sec title="📡 Intent Signals" accent={C.cyan} open={false}>
          {(data.intent_data || []).map(function(s, i) {
            return (
              <div key={i} style={{ padding: "8px 12px", background: C.surface, borderRadius: 7, marginBottom: 6, border: "1px solid " + C.border }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <Badge color="cyan" sm>{s.type}</Badge>
                  {s.date && <span style={{ color: C.dim, fontSize: 10 }}>{s.date}</span>}
                </div>
                <div style={{ color: C.muted, fontSize: 11 }}>{s.signal}</div>
                {s.implication && <div style={{ color: C.accent, fontSize: 10, marginTop: 3 }}>→ {s.implication}</div>}
              </div>
            );
          })}
        </Sec>
      )}

      {/* Recent News */}
      {(data.recent_news || []).length > 0 && (
        <Sec title="📰 Recent News" accent={C.muted} open={false}>
          {(data.recent_news || []).map(function(n, i) {
            return (
              <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid " + C.border }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                  <Badge color="muted" sm>{n.category}</Badge>
                  <span style={{ color: C.dim, fontSize: 10 }}>{n.date} · {n.source}</span>
                </div>
                <a href={n.url} target="_blank" rel="noreferrer" style={{ color: C.text, fontSize: 11, fontWeight: 600, textDecoration: "none" }}>{n.title}</a>
                {n.summary && <div style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>{n.summary}</div>}
                {n.cp_relevance && <div style={{ color: C.accent, fontSize: 10, marginTop: 2 }}>🎯 {n.cp_relevance}</div>}
              </div>
            );
          })}
        </Sec>
      )}

      {/* Geography */}
      {(geo.markets || []).length > 0 && (
        <Sec title="🌍 Geography" accent={C.muted} open={false}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {(geo.markets || []).map(function(m) { return <Badge key={m} color="accent" sm>{m}</Badge>; })}
          </div>
          {geo.gaps && <div style={{ color: C.gold, fontSize: 11 }}>⚠ Gap: {geo.gaps}</div>}
        </Sec>
      )}

      {/* AI Chat */}
      <Sec title="💬 Ask AI About This Account" accent={C.accent} open={false}>
        <div ref={chatRef} style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
          {chat.length === 0 && <div style={{ color: C.dim, fontSize: 11, textAlign: "center", padding: 20 }}>Ask anything about this account...</div>}
          {chat.map(function(m, i) {
            return (
              <div key={i} style={{ marginBottom: 8, textAlign: m.role === "user" ? "right" : "left" }}>
                <div style={{ display: "inline-block", background: m.role === "user" ? C.accentDim : C.surface, color: C.text, borderRadius: 8, padding: "8px 12px", maxWidth: "85%", fontSize: 11, lineHeight: 1.6, textAlign: "left" }}>{m.content}</div>
              </div>
            );
          })}
          {asking && <div style={{ color: C.dim, fontSize: 11, padding: "8px 0" }}>Thinking...</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={q} onChange={function(e) { setQ(e.target.value); }} onKeyDown={function(e) { if (e.key === "Enter" && !asking) ask(); }} placeholder="e.g. What's the best hook for the CMO?" style={{ flex: 1, background: C.surface, border: "1px solid " + C.border, borderRadius: 8, padding: "8px 12px", color: C.text, fontSize: 11, outline: "none", fontFamily: "inherit" }} />
          <button onClick={ask} disabled={asking || !q.trim()} style={{ background: C.accent, color: "#000", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 800, fontSize: 11, cursor: asking ? "wait" : "pointer", fontFamily: "inherit" }}>Ask</button>
        </div>
      </Sec>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // ALL hooks unconditionally at the very top
  var s1  = useState("analyze"); var page    = s1[0];  var setPage    = s1[1];
  var s2  = useState("");        var company = s2[0];  var setCompany = s2[1];
  var s3  = useState(false);     var loading = s3[0];  var setLoading = s3[1];
  var s4  = useState("");        var step    = s4[0];  var setStep    = s4[1];
  var s5  = useState(null);      var result  = s5[0];  var setResult  = s5[1];
  var s6  = useState("");        var error   = s6[0];  var setError   = s6[1];
  var s7  = useState(false);     var showKeys= s7[0];  var setShowKeys= s7[1];
  var s8  = useState(function() { return localStorage.getItem(TKEY_LS)  || ""; }); var tKey  = s8[0]; var setTKey  = s8[1];
  var s9  = useState(function() { return localStorage.getItem(NJKEY_LS) || ""; }); var njKey = s9[0]; var setNjKey = s9[1];
  var s10 = useState([]);        var history = s10[0]; var setHistory = s10[1];

  // Helpers — no hooks, defined after all hooks
  function saveKey(lsKey, val, fn) { fn(val); localStorage.setItem(lsKey, val); }

  async function go() {
    if (!company.trim() || loading) return;
    setLoading(true); setError(""); setResult(null); setStep("Starting analysis...");
    try {
      var data = await runAnalysis(company.trim(), setStep, { tavily: tKey, ninjapear: njKey });
      setResult(data);
      setHistory(function(h) { return [{ company: data.company, analyzedAt: data.analyzedAt, data: data }].concat(h.slice(0, 9)); });
      setPage("result");
    } catch (e) {
      setError(e.message);
    }
    setLoading(false); setStep("");
  }

  var keyColor = (tKey && njKey) ? C.green : (tKey || njKey) ? C.gold : C.red;
  var keyLabel = (tKey && njKey) ? "🟢 Full Intel" : (tKey || njKey) ? "🟡 Partial" : "🔑 Add Keys";

  var NAV = [["analyze", "🔍 Analyze"], ["result", "📊 Result" + (result ? " ✓" : "")], ["history", "📋 History" + (history.length ? " (" + history.length + ")" : "")]];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace", fontSize: 12 }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}button,input,select,textarea{font-family:inherit}input::placeholder,textarea::placeholder{color:#334155}`}</style>

      {/* Nav */}
      <div style={{ background: C.surface, borderBottom: "1px solid " + C.border, padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, position: "sticky", top: 0, zIndex: 100, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg," + C.accent + "," + C.purple + ")", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>₿</div>
          <div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 11, letterSpacing: "0.05em" }}>COINPAYMENTS</div>
            <div style={{ color: C.dim, fontSize: 8, letterSpacing: "0.1em" }}>SALES INTELLIGENCE</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", overflowX: "auto" }}>
          {NAV.map(function(n) {
            var id = n[0]; var label = n[1];
            return <button key={id} onClick={function() { setPage(id); }} style={{ padding: "5px 12px", borderRadius: 7, background: page === id ? C.accent : "transparent", color: page === id ? "#000" : C.muted, border: "1px solid " + (page === id ? C.accent : "transparent"), fontWeight: page === id ? 800 : 500, fontSize: 10, cursor: "pointer", whiteSpace: "nowrap" }}>{label}</button>;
          })}
          <div style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />
          <button onClick={function() { setShowKeys(!showKeys); }} style={{ padding: "4px 10px", borderRadius: 7, background: "transparent", color: keyColor, border: "1px solid " + keyColor + "50", fontSize: 10, cursor: "pointer", whiteSpace: "nowrap" }}>{keyLabel}</button>
        </div>
      </div>

      {/* Keys Panel */}
      {showKeys && (
        <div style={{ background: C.surface, borderBottom: "1px solid " + C.border, padding: "14px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ color: C.text, fontSize: 12, fontWeight: 700 }}>🔑 API Keys</span>
            <button onClick={function() { setShowKeys(false); }} style={{ background: "transparent", border: "1px solid " + C.border, color: C.muted, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>Done</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
            {[{ label: "🌐 Tavily Search", desc: "Live news · app.tavily.com ($35/mo Starter)", lsk: TKEY_LS, val: tKey, fn: function(v) { saveKey(TKEY_LS, v, setTKey); }, ph: "tvly-xxxx" }, { label: "🎯 NinjaPear", desc: "Executive profiles by role · nubela.co/dashboard", lsk: NJKEY_LS, val: njKey, fn: function(v) { saveKey(NJKEY_LS, v, setNjKey); }, ph: "api key from nubela.co" }].map(function(k) {
              return (
                <div key={k.label} style={{ background: C.card, borderRadius: 8, padding: "12px 14px", border: "1px solid " + (k.val ? C.green + "40" : C.border) }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ color: C.text, fontWeight: 700, fontSize: 11 }}>{k.label}</span>
                    {k.val && <Badge color="green" sm>CONNECTED</Badge>}
                  </div>
                  <div style={{ color: C.dim, fontSize: 10, marginBottom: 8 }}>{k.desc}</div>
                  <input type="password" value={k.val} onChange={function(e) { k.fn(e.target.value); }} placeholder={k.ph} style={{ width: "100%", background: C.surface, border: "1px solid " + C.border, borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 11, outline: "none" }} />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, color: C.dim, fontSize: 10 }}>Keys are saved to this browser only. NinjaPear (same key as old Proxycurl) finds real executives: CEO, CMO, CPO, CTO, COO, CFO + VPs.</div>
        </div>
      )}

      {/* Main */}
      <div style={{ padding: "20px 16px", maxWidth: 920, margin: "0 auto" }}>

        {/* Analyze */}
        {page === "analyze" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ color: C.text, fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Sales Intelligence</div>
              <div style={{ color: C.muted, fontSize: 12 }}>Full B2B sales intelligence report for any fintech target.</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input value={company} onChange={function(e) { setCompany(e.target.value); }} onKeyDown={function(e) { if (e.key === "Enter") go(); }} placeholder="e.g. Revolut, Chime, Wise, Marqeta, Adyen..." style={{ flex: 1, background: C.surface, border: "1px solid " + C.border, borderRadius: 8, padding: "12px 16px", color: C.text, fontSize: 14, outline: "none" }} />
              <button onClick={go} disabled={loading || !company.trim()} style={{ padding: "12px 28px", borderRadius: 8, background: loading ? "transparent" : C.accent, color: loading ? C.muted : "#000", border: "1px solid " + (loading ? C.border : C.accent), fontWeight: 800, fontSize: 13, cursor: loading ? "wait" : "pointer", whiteSpace: "nowrap" }}>
                {loading ? "Analyzing..." : "⚡ Analyze"}
              </button>
            </div>
            {loading && step && (
              <div style={{ color: C.accent, fontSize: 11, padding: "10px 14px", background: C.accentDim, borderRadius: 8, marginBottom: 12 }}>⟳ {step}</div>
            )}
            {error && (
              <div style={{ background: C.redDim, border: "1px solid " + C.red + "40", borderRadius: 8, padding: "12px 16px", color: C.red, fontSize: 11 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Error</div>{error}
              </div>
            )}
            {!loading && !error && (
              <div style={{ marginTop: 24, color: C.dim, fontSize: 11, lineHeight: 1.9 }}>
                <div style={{ marginBottom: 6, color: C.muted, fontWeight: 700 }}>What you get:</div>
                {["🚨 Missed opportunity + competitor threat","💰 Conservative bottoms-up ARR projection","👥 Verified executives via NinjaPear (12 roles)","🤝 Partnership intelligence","⚔️ Competitive comparison vs incumbent","🗺️ GTM attack plan + sequenced timeline","📰 Live news from last 6 months","💬 AI chat for account questions"].map(function(f) {
                  return <div key={f}>• {f}</div>;
                })}
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {page === "result" && (
          result
            ? <AnalysisView data={result} />
            : <div style={{ textAlign: "center", padding: 80, color: C.dim }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>📊</div>
                <div style={{ fontSize: 14, marginBottom: 16 }}>No analysis yet</div>
                <button onClick={function() { setPage("analyze"); }} style={{ background: C.accent, color: "#000", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Run Analysis →</button>
              </div>
        )}

        {/* History */}
        {page === "history" && (
          <div>
            <div style={{ color: C.text, fontSize: 18, fontWeight: 800, marginBottom: 16 }}>Analysis History</div>
            {history.length === 0
              ? <div style={{ textAlign: "center", padding: 60, color: C.dim }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
                  <div>No analyses yet. History appears here and clears when you close the tab.</div>
                </div>
              : history.map(function(h, i) {
                  return (
                    <div key={i} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 10, padding: "14px 16px", marginBottom: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      onClick={function() { setResult(h.data); setPage("result"); }}>
                      <div>
                        <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{h.company}</div>
                        <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{h.data.segment || ""} {h.data.hq ? "· " + h.data.hq : ""}</div>
                        {h.data.tam_som_arr && h.data.tam_som_arr.likely_arr_usd && <div style={{ color: C.green, fontSize: 11, marginTop: 2 }}>ARR: {h.data.tam_som_arr.likely_arr_usd}</div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: C.dim, fontSize: 10 }}>{new Date(h.analyzedAt).toLocaleTimeString()}</div>
                        <div style={{ color: C.accent, fontSize: 11, marginTop: 4 }}>View →</div>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        )}
      </div>
    </div>
  );
}
