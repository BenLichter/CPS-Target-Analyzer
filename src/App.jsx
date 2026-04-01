import React, { useState, useRef, useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL    = "claude-sonnet-4-20250514";
const TKEY_LS  = "cp_tavily_key";
const NJKEY_LS = "cp_ninjapear_key";
const HIST_LS  = "cp_history";
const PIPE_LS  = "cp_pipeline";

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
  const SYS = 'You are a senior B2B sales intelligence expert for CoinPayments (100+ digital assets, white-label infrastructure, fiat on/off ramps, API-first). Output ONLY valid JSON. No markdown. Start with { end with }. Values under 35 words. ARR: bottoms-up only. likely_arr_usd = SOM x 1-2% capture rate. Show math e.g. $100M SOM x 1% = $1M ARR. Target range $750K-$2M. Never go below $500K.';

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

  // Phase 0c — Deep scraping + multi-step verification
  if (tKey) {
    onStep("\U0001f50d Scraping executive mentions for " + company + "...");
    const [r1, r2, r3, r4, r5, rPart] = await Promise.all([
      tavilyRaw(company + " VP Director Head Chief executive linkedin.com 2024 2025", tKey, 10, 730),
      tavilyRaw(company + " speaker podcast interview conference keynote 2024 2025", tKey, 8, 730),
      tavilyRaw(company + " CEO CMO CPO CTO executive quote said 2024 2025", tKey, 8, 730),
      tavilyRaw(company + " Forbes TechCrunch profile executive team leadership 2024 2025", tKey, 6, 730),
      tavilyRaw(company + " crunchbase tracxn team founder executive 2024 2025", tKey, 6, 730),
      tavilyRaw(company + " Bancorp Stride Evolve Visa stablecoin partner integration", tKey, 6, 365),
    ]);
    const allRaw = [...r1, ...r2, ...r3, ...r4, ...r5].filter(Boolean);

    // Step A: Claude extracts candidate names with LinkedIn URLs from scraped text
    var scrapedCandidates = [];
    if (allRaw.length) {
      const txt = allRaw.slice(0, 20).map((r, i) =>
        (i + 1) + ". URL:" + r.url + "\nTITLE:" + r.title + "\nTEXT:" + (r.content || "").slice(0, 350)
      ).join("\n\n");
      onStep("\U0001f4cb Extracting names from " + allRaw.length + " sources...");
      try {
        const extRaw = await callAPI(
          "Extract named employees from source text. Output ONLY a JSON array. Never invent names.",
          "Find every real named person currently working at " + company + " from these sources.\n\nRULES:\n- Only include people explicitly named as working AT " + company + "\n- Never include people from other companies\n- Extract LinkedIn URL if visible in any source URL or text\n- Note the source URL where you found them\n\nOutput ONLY a JSON array:\n[{\"name\":\"Full Name\",\"title\":\"exact role at " + company + "\",\"linkedin_url\":\"https://linkedin.com/in/handle or empty string\",\"source_url\":\"url where found\",\"confidence\":\"HIGH if explicitly named with title, MEDIUM if mentioned in passing\"}]\n\nSOURCES:\n" + txt,
          2000
        );
        let es = extRaw.trim().replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
        if (es.startsWith("[")) scrapedCandidates = JSON.parse(es).filter(function(e) { return e.name && e.name.length > 3; });
      } catch {}
    }

    // Step B: NinjaPear first/last name verification of each scraped candidate
    if (scrapedCandidates.length && njKey) {
      onStep("\U0001f3af Verifying " + scrapedCandidates.length + " scraped names via NinjaPear...");
      const verifyResults = await Promise.all(
        scrapedCandidates.slice(0, 8).map(async function(cand) {
          const parts = (cand.name || "").trim().split(" ");
          const firstName = parts[0];
          const lastName = parts.slice(1).join(" ");
          if (!firstName || !lastName) return { cand: cand, verified: null };
          try {
            const res = await fetch("/api/ninjapear", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: "v1/employee/profile", params: { first_name: firstName, last_name: lastName, employer_website: "https://" + domain }, key: njKey }),
            });
            if (!res.ok) return { cand: cand, verified: null };
            const d = await res.json();
            return { cand: cand, verified: (d.first_name || d.full_name) ? d : null };
          } catch { return { cand: cand, verified: null }; }
        })
      );

      // Step C: Tavily web confirmation for names NinjaPear didn't find
      const unverified = verifyResults.filter(function(r) { return !r.verified; }).map(function(r) { return r.cand; });
      var webChecks = {};
      if (unverified.length) {
        onStep("\U0001f310 Web-confirming " + unverified.length + " unverified names...");
        const webResults = await Promise.all(
          unverified.slice(0, 5).map(function(cand) {
            return tavilyRaw('"' + cand.name + '" ' + company, tKey, 4, 730);
          })
        );
        unverified.slice(0, 5).forEach(function(cand, i) {
          const results = webResults[i] || [];
          const allText = results.map(function(r) { return (r.title || "") + " " + (r.content || ""); }).join(" ").toLowerCase();
          const nameParts = cand.name.toLowerCase().split(" ");
          const confirmed = nameParts.every(function(p) { return allText.includes(p); }) && allText.includes(company.toLowerCase());
          const liMatch = results.find(function(r) { return r.url && r.url.includes("linkedin.com/in/"); });
          webChecks[cand.name] = { confirmed: confirmed, liUrl: liMatch ? liMatch.url.split("?")[0] : "" };
        });
      }

      // Merge verified contacts — NinjaPear HIGH, web-confirmed MEDIUM, scraped LOW
      const existing = new Set(contacts.map(function(c) { return c.name.toLowerCase(); }));
      verifyResults.forEach(function(item) {
        const cand = item.cand; const verified = item.verified;
        if (existing.has(cand.name.toLowerCase())) return;
        if (verified) {
          const job = (verified.work_experience || []).find(function(e) { return !e.end_date; });
          const liUrl = cand.linkedin_url || (verified.x_profile_url && verified.x_profile_url.includes("linkedin") ? verified.x_profile_url : "") || "";
          contacts.push({ name: cand.name, title: job ? job.role : (cand.title || ""), category: "Influencer", verified_source: "ninjapear_verified", verification_confidence: "HIGH", linkedin: liUrl, source_url: cand.source_url || "", why_target: "Verified executive at " + company, outreach_angle: "NinjaPear-confirmed — safe to contact directly" });
          existing.add(cand.name.toLowerCase());
        } else {
          const web = webChecks[cand.name];
          if (web && web.confirmed) {
            contacts.push({ name: cand.name, title: cand.title || "", category: "Influencer", verified_source: "web_confirmed", verification_confidence: "MEDIUM", linkedin: web.liUrl || cand.linkedin_url || "", source_url: cand.source_url || "", why_target: "Web-confirmed at " + company, outreach_angle: "Web-confirmed — verify role before outreach" });
            existing.add(cand.name.toLowerCase());
          } else if (cand.confidence === "HIGH") {
            contacts.push({ name: cand.name, title: cand.title || "", category: "Influencer", verified_source: "scraped", verification_confidence: "LOW", linkedin: cand.linkedin_url || "", source_url: cand.source_url || "", why_target: "Found in public sources", outreach_angle: "\u26a0 Verify before outreach" });
            existing.add(cand.name.toLowerCase());
          }
        }
      });

    } else if (scrapedCandidates.length) {
      // No NinjaPear key — add scraped with LOW confidence
      const existing = new Set(contacts.map(function(c) { return c.name.toLowerCase(); }));
      scrapedCandidates.forEach(function(e) {
        if (!existing.has(e.name.toLowerCase())) {
          contacts.push({ name: e.name, title: e.title || "", category: "Influencer", verified_source: "scraped", verification_confidence: "LOW", linkedin: e.linkedin_url || "", source_url: e.source_url || "", why_target: "Found in public sources", outreach_angle: "\u26a0 Verify before outreach" });
          existing.add(e.name.toLowerCase());
        }
      });
    }

    if (rPart.length) { ctx += "PARTNER SIGNALS:\n" + rPart.slice(0, 4).map(function(r) { return r.title + ": " + (r.content || "").slice(0, 150); }).join("\n") + "\n\n"; }
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
    callAPI(SYS, "Compare CoinPayments capabilities vs what " + company + " currently has or offers in payments and crypto. The two columns are CoinPayments and " + company + " itself (not an incumbent provider).\nFor each dimension, rate and explain what CoinPayments brings vs what " + company + " already has in-house or via existing providers.\nOutput ONLY: {\"competitive_comparison\":{\"coinpayments\":{" + COMPARE_ROWS.map(([, k]) => "\"" + k + "\":\"CoinPayments capability in 1 sentence\"").join(",") + "},\"target\":{\"name\":\"" + company + "\",\"" + COMPARE_ROWS.map(([, k]) => k + "\":\"what " + company + " currently has in 1 sentence\"").join(",\"") + "\"}},\"positioning_statement\":\"2-sentence statement on what CoinPayments uniquely adds to " + company + "'s existing stack\"}", 3000),
    callAPI(SYS, "Build GTM attack plan for CoinPayments to win " + company + ".\nOutput ONLY: {\"attack_plan\":{\"icp_profile\":{\"primary_buyer\":\"title\",\"champion\":\"who advocates\",\"blocker\":\"who blocks\",\"trigger_event\":\"what makes them act\"},\"sequenced_timeline\":[{\"week\":\"Week 1-2\",\"action\":\"specific action\",\"goal\":\"what to achieve\"}],\"objection_handling\":[{\"objection\":\"likely objection\",\"response\":\"how to handle\"}],\"motions\":{\"abm\":{\"tactic\":\"specific ABM tactic\"},\"outbound\":{\"hook\":\"opening line\",\"cta\":\"call to action\"},\"events\":{\"events\":\"which conferences\",\"play\":\"engagement strategy\"}}}}", 3000),
  ]);

  try { const p2 = parseJSON(p2raw); p1.competitive_comparison = p2.competitive_comparison; p1.positioning_statement = p2.positioning_statement; } catch {}
  try { const p3 = parseJSON(p3raw); p1.attack_plan = p3.attack_plan; } catch {}

  p1.analyzedAt = new Date().toISOString();
  return p1;
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function Badge({ color, children, sm }) {
  var colors = { accent: [C.accentDim, C.accent], gold: [C.goldDim, C.gold], green: [C.greenDim, C.green], purple: ["#8B5CF612", C.purple], red: [C.redDim, C.red], muted: [C.dim + "33", C.muted], cyan: ["#06B6D412", C.cyan] };
  var pair = colors[color || "muted"] || colors.muted;
  var bg = pair[0]; var fg = pair[1];
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
function ContactCard({ contact, company, onRemove }) {
  var s1 = useState(false); var showPaste = s1[0]; var setShowPaste = s1[1];
  var s2 = useState(contact.linkedin || ""); var liPaste = s2[0]; var setLiPaste = s2[1];

  var catColor = { "Economic Buyer": "gold", "Champion": "green", "Technical Buyer": "cyan", "Influencer": "accent", "Blocker": "red" };
  var cc = catColor[contact.category] || "muted";

  // Verification badge config
  var vBadge = {
    ninjapear:          { color: "green",  label: "🎯 NinjaPear" },
    ninjapear_verified: { color: "green",  label: "🎯 NinjaPear ✓" },
    web_confirmed:      { color: "accent", label: "🌐 Web Confirmed" },
    scraped:            { color: "gold",   label: "⚠ Unverified" },
  }[contact.verified_source] || { color: "muted", label: "⚠ Verify" };

  var liUrl = liPaste.trim() || contact.linkedin || "";
  var sq = [contact.name, company, contact.title].filter(Boolean).join(" ");
  var liSearch = "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(sq);

  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "12px 14px", marginBottom: 8, border: "1px solid " + (contact.verification_confidence === "HIGH" ? C.green + "30" : contact.verification_confidence === "MEDIUM" ? C.accent + "30" : C.border) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{contact.name}</span>
            <Badge color={cc} sm>{contact.category}</Badge>
            <Badge color={vBadge.color} sm>{vBadge.label}</Badge>
          </div>
          {contact.title && <div style={{ color: C.muted, fontSize: 11, marginBottom: 2 }}>{contact.title}</div>}
          {contact.outreach_angle && <div style={{ color: C.accent, fontSize: 10 }}>💬 {contact.outreach_angle}</div>}
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "flex-start", flexShrink: 0 }}>
          {liUrl
            ? <a href={liUrl.startsWith("http") ? liUrl : "https://linkedin.com/in/" + liUrl} target="_blank" rel="noreferrer"
                style={{ background: "#0A66C2", color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 10, textDecoration: "none", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                LinkedIn
              </a>
            : <a href={liSearch} target="_blank" rel="noreferrer"
                style={{ background: "transparent", color: C.dim, border: "1px solid " + C.border, borderRadius: 6, padding: "5px 10px", fontSize: 10, textDecoration: "none" }}>
                🔍 Search LI
              </a>
          }
          <button onClick={function() { setShowPaste(!showPaste); }}
            style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 6, padding: "5px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>✏</button>
          {onRemove && (
            <button onClick={onRemove}
              title="Remove this contact"
              style={{ background: "transparent", border: "1px solid " + C.red + "40", color: C.red, borderRadius: 6, padding: "5px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
          )}
        </div>
      </div>
      {contact.source_url && (
        <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>
          Found at: <a href={contact.source_url} target="_blank" rel="noreferrer" style={{ color: C.dim, textDecoration: "underline" }}>{contact.source_url.replace(/https?:\/\/(www\.)?/, "").split("/")[0]}</a>
        </div>
      )}
      {(contact.verification_confidence === "LOW" || contact.verified_source === "scraped") && (
        <div style={{ marginTop: 8, background: "#F59E0B0E", border: "1px solid #F59E0B40", borderRadius: 6, padding: "6px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>⚠️</span>
          <div style={{ color: "#F59E0B", fontSize: 10, lineHeight: 1.5 }}>
            <strong>Unconfirmed — verify before outreach.</strong> This individual was found in public sources but could not be confirmed via NinjaPear or web cross-check. Search LinkedIn before contacting.
          </div>
        </div>
      )}
      {showPaste && (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: C.dim, fontSize: 9, marginBottom: 3 }}>PASTE LINKEDIN URL</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={liPaste} onChange={function(e) { setLiPaste(e.target.value); }}
              placeholder="https://linkedin.com/in/firstname-lastname"
              style={{ flex: 1, background: C.card, border: "1px solid " + C.accent, borderRadius: 6, padding: "6px 8px", color: C.text, fontSize: 11, outline: "none", fontFamily: "inherit" }} />
            <button onClick={function() { setShowPaste(false); }}
              style={{ background: C.accent, color: "#000", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 10, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>Save</button>
          </div>
        </div>
      )}
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

      {/* ARR */}
      {t.likely_arr_usd && (
        <Sec title="💰 ARR Potential" accent={C.green}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
            {t.tam_usd && <Chip label="TAM" value={t.tam_usd} color={C.muted} />}
            {t.som_usd && <Chip label="SOM" value={t.som_usd} color={C.accent} />}
            {t.likely_arr_usd && <Chip label="Projected ARR" value={t.likely_arr_usd} color={C.green} />}
            {t.upside_arr_usd && <Chip label="Upside ARR" value={t.upside_arr_usd} color={C.gold} />}
          </div>
          {t.methodology && <div style={{ color: C.muted, fontSize: 11, marginBottom: 6 }}>📐 {t.methodology}</div>}
          {(t.assumptions || []).map(function(a, i) { return <div key={i} style={{ color: C.dim, fontSize: 11, marginBottom: 4 }}>• {a}</div>; })}
          {t.reasoning && <div style={{ color: C.muted, fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>{t.reasoning}</div>}
        </Sec>
      )}

      {/* Key Contacts */}
      <Sec title={"👥 Key Contacts" + (contacts.length ? " (" + contacts.length + ")" : "")} accent={C.cyan} open={true}>
        {contacts.length === 0 && <div style={{ color: C.dim, fontSize: 11, textAlign: "center", padding: 20 }}>No contacts found. Add a NinjaPear key for verified executives.</div>}
        {contacts.map(function(c, i) { return <ContactCard key={i} contact={c} company={data.company} onRemove={function(){ setContacts(function(prev){ return prev.filter(function(_,j){ return j!==i; }); }); }} />; })}
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
        <Sec title="⚔️ Competitive Comparison" accent={C.gold} open={false}>
          {data.positioning_statement && <div style={{ background: C.goldDim, border: "1px solid " + C.gold + "40", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: C.gold, fontSize: 11, lineHeight: 1.6 }}>{data.positioning_statement}</div>}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: C.card }}>
                <th style={{ padding: "7px 10px", textAlign: "left", color: C.dim, fontSize: 10, borderBottom: "1px solid " + C.border }}>Dimension</th>
                <th style={{ padding: "7px 10px", textAlign: "left", color: C.accent, fontSize: 10, borderBottom: "1px solid " + C.border }}>CoinPayments</th>
                <th style={{ padding: "7px 10px", textAlign: "left", color: C.gold, fontSize: 10, borderBottom: "1px solid " + C.border }}>{cc.target ? cc.target.name || data.company : data.company}</th>
              </tr></thead>
              <tbody>
                {COMPARE_ROWS.map(function(row, i) {
                  var label = row[0]; var key = row[1];
                  return (
                    <tr key={key} style={{ borderBottom: "1px solid " + C.border, background: i % 2 === 0 ? "transparent" : C.card + "80" }}>
                      <td style={{ padding: "7px 10px", color: C.muted, fontWeight: 600 }}>{label}</td>
                      <td style={{ padding: "7px 10px", color: C.text }}>{(cc.coinpayments || {})[key] || "—"}</td>
                      <td style={{ padding: "7px 10px", color: C.muted }}>{cc.target ? (cc.target[key] || "—") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      {/* GTM */}
      {ap.icp_profile && (
        <Sec title="🗺️ GTM Plan" accent={C.purple} open={false}>
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

// ─── Pipeline constants ───────────────────────────────────────────────────────
var VERTICALS = [
  { id:"financial_services", label:"Financial Services", icon:"🏦", color:"#00C2FF", dim:"#00C2FF12" },
  { id:"luxury_travel",      label:"Luxury Travel",      icon:"✈️",  color:"#F59E0B", dim:"#F59E0B12" },
  { id:"luxury_goods",       label:"Luxury Goods",       icon:"💎", color:"#8B5CF6", dim:"#8B5CF612" },
  { id:"gaming_casinos",     label:"Gaming & Casinos",   icon:"🎰", color:"#10B981", dim:"#10B98112" },
];
var PIPE_STAGES = [
  { id:"prospecting",   label:"Prospecting",            color:"#94A3B8" },
  { id:"lead_sql",      label:"Lead / SQL",             color:"#06B6D4" },
  { id:"discovery",     label:"Discovery",              color:"#00C2FF" },
  { id:"solution_demo", label:"Solution Design & Demo", color:"#8B5CF6" },
  { id:"proposal_neg",  label:"Proposal & Negotiation", color:"#F59E0B" },
  { id:"closed_won",    label:"Closed / Won",           color:"#10B981" },
  { id:"expansion",     label:"Expansion / Retention",  color:"#10B981" },
];
var TIERS = [
  { id:"tier1", label:"Tier 1", color:"#00C2FF" },
  { id:"tier2", label:"Tier 2", color:"#F59E0B" },
  { id:"tier3", label:"Tier 3", color:"#8B5CF6" },
];
var FS_SUBVERTS = [
  { id:"remittance", label:"Remittance Fintechs",    color:"#00C2FF" },
  { id:"brokerage",  label:"Brokerage & Investment", color:"#F59E0B" },
  { id:"neobanks",   label:"Neobanks",               color:"#8B5CF6" },
];

function parseArr(s) {
  if (!s) return 0;
  var raw = String(s).trim();
  var match = raw.match(/\$?([0-9,]+(?:\.[0-9]+)?)\s*(T|B|M|K|t|b|m|k)?/);
  if (!match) return 0;
  var num = parseFloat(match[1].replace(/,/g,""));
  var unit = (match[2]||"").toUpperCase();
  if (unit==="T") return num*1e12;
  if (unit==="B") return num*1e9;
  if (unit==="M") return num*1e6;
  if (unit==="K") return num*1e3;
  return num||0;
}
function fmtMoney(n) {
  if (!n) return "—";
  if (n>=1e12) return "$"+(n/1e12).toFixed(1)+"T";
  if (n>=1e9)  return "$"+(n/1e9).toFixed(1)+"B";
  if (n>=1e6)  return "$"+(n/1e6).toFixed(1)+"M";
  if (n>=1e3)  return "$"+Math.round(n/1e3)+"K";
  return "$"+Math.round(n);
}

// ─── City coords for world map ────────────────────────────────────────────────
var CITY_COORDS = {
  "new york":[-74.006,40.714],"new york city":[-74.006,40.714],"nyc":[-74.006,40.714],
  "san francisco":[-122.419,37.775],"los angeles":[-118.244,34.052],"chicago":[-87.629,41.878],
  "miami":[-80.191,25.761],"boston":[-71.059,42.360],"seattle":[-122.333,47.608],
  "austin":[-97.743,30.267],"denver":[-104.990,39.739],"las vegas":[-115.139,36.175],
  "phoenix":[-112.074,33.448],"atlanta":[-84.387,33.749],"dallas":[-96.797,32.777],
  "houston":[-95.369,29.760],"washington":[-77.037,38.907],"washington dc":[-77.037,38.907],
  "toronto":[-79.383,43.653],"vancouver":[-123.121,49.283],"montreal":[-73.588,45.508],
  "mexico city":[-99.133,19.433],
  "london":[-0.118,51.508],"paris":[2.349,48.864],"frankfurt":[8.682,50.111],
  "berlin":[13.405,52.520],"amsterdam":[4.904,52.367],"zurich":[8.541,47.377],
  "geneva":[6.143,46.204],"stockholm":[18.063,59.334],"copenhagen":[12.568,55.676],
  "oslo":[10.757,59.913],"helsinki":[24.940,60.170],"madrid":[-3.703,40.417],
  "barcelona":[2.154,41.385],"milan":[9.190,45.464],"rome":[12.496,41.903],
  "dublin":[-6.260,53.338],"luxembourg":[6.130,49.611],"monaco":[7.412,43.736],
  "monte carlo":[7.412,43.736],"lisbon":[-9.139,38.717],"vienna":[16.373,48.210],
  "warsaw":[21.012,52.229],"prague":[14.420,50.088],"budapest":[19.040,47.498],
  "athens":[23.728,37.984],"brussels":[4.352,50.846],"munich":[11.582,48.135],
  "dubai":[55.297,25.205],"abu dhabi":[54.367,24.453],"riyadh":[46.675,24.683],
  "tel aviv":[34.782,32.085],"istanbul":[28.978,41.013],"cairo":[31.235,30.044],
  "johannesburg":[28.047,-26.204],"cape town":[18.423,-33.924],
  "nairobi":[36.822,-1.292],"lagos":[3.379,6.524],
  "hong kong":[114.177,22.302],"singapore":[103.820,1.352],"tokyo":[139.689,35.690],
  "osaka":[135.502,34.693],"shanghai":[121.473,31.230],"beijing":[116.407,39.904],
  "shenzhen":[114.059,22.543],"guangzhou":[113.264,23.129],"seoul":[126.978,37.566],
  "taipei":[121.565,25.033],"sydney":[151.207,-33.868],"melbourne":[144.963,-37.814],
  "auckland":[174.763,-36.848],"bangalore":[77.591,12.972],"mumbai":[72.878,19.076],
  "delhi":[77.209,28.614],"new delhi":[77.209,28.614],"jakarta":[106.845,-6.208],
  "kuala lumpur":[101.687,3.140],"bangkok":[100.523,13.736],"macau":[113.543,22.197],
  "manila":[120.984,14.563],"ho chi minh city":[106.662,10.823],
  "sao paulo":[-46.633,-23.550],"rio de janeiro":[-43.173,-22.907],
  "buenos aires":[-58.382,-34.608],"bogota":[-74.072,4.711],
  "lima":[-77.043,-12.046],"santiago":[-70.649,-33.459],"panama city":[-79.519,8.994],
};
function parseHqCoords(hq) {
  if (!hq) return null;
  var lower = String(hq).toLowerCase().trim();
  if (CITY_COORDS[lower]) return CITY_COORDS[lower];
  var parts = lower.split(",");
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (CITY_COORDS[p]) return CITY_COORDS[p];
  }
  return null;
}

var VCOLOR_MAP = { financial_services:"#00C2FF", luxury_travel:"#F59E0B", luxury_goods:"#8B5CF6", gaming_casinos:"#10B981" };

var GEO_OPTS = [
  { id:"all",  label:"All Regions" },
  { id:"AMER", label:"AMER" },
  { id:"EMEA", label:"EMEA" },
  { id:"APAC", label:"APAC" },
];
function detectGeo(hq) {
  if (!hq) return "";
  var h = String(hq).toLowerCase();
  var APAC = /\b(china|japan|india|singapore|hong kong|australia|south korea|korea|taiwan|thailand|vietnam|indonesia|philippines|malaysia|new zealand|bangladesh|pakistan|sri lanka|myanmar|tokyo|beijing|shanghai|mumbai|delhi|bangalore|hyderabad|chennai|sydney|melbourne|seoul|taipei|bangkok|jakarta|kuala lumpur|manila|ho chi minh|hanoi)\b/;
  var EMEA = /\b(u\.k|united kingdom|england|britain|france|germany|spain|italy|netherlands|sweden|norway|denmark|finland|switzerland|austria|belgium|portugal|ireland|poland|czech|hungary|romania|greece|turkey|uae|dubai|abu dhabi|saudi|israel|south africa|nigeria|kenya|egypt|ghana|morocco|tunisia|algeria|london|paris|berlin|madrid|rome|amsterdam|stockholm|oslo|copenhagen|zurich|brussels|dublin|warsaw|tel aviv|nairobi|lagos|johannesburg|cape town|cairo)\b/;
  var AMER = /\b(u\.s\.a|usa|united states|canada|mexico|brazil|argentina|colombia|chile|peru|venezuela|costa rica|panama|new york|los angeles|chicago|houston|miami|san francisco|boston|seattle|toronto|vancouver|montreal|sao paulo|buenos aires|bogota|lima|mexico city)\b|\bus\b/;
  if (APAC.test(h)) return "APAC";
  if (EMEA.test(h)) return "EMEA";
  if (AMER.test(h)) return "AMER";
  return "";
}

var MAP_BUCKET_OPTS = [
  { id:"all",           label:"All Sub-verticals",            filterType:"all"      },
  { id:"remittance",    label:"Remittance Fintechs",          filterType:"tier"     },
  { id:"brokerage",     label:"Brokerage & Investment Firms", filterType:"tier"     },
  { id:"neobanks",      label:"Neobanks",                     filterType:"tier"     },
  { id:"luxury_travel", label:"Luxury Travel",                filterType:"vertical" },
  { id:"luxury_goods",  label:"Luxury Goods",                 filterType:"vertical" },
  { id:"gaming_casinos",label:"Gaming & Casinos",             filterType:"vertical" },
];

function WorldMap({ deals }) {
  var s1 = useState("all"); var mapTierF = s1[0]; var setMapTierF = s1[1];
  var s2 = useState("all"); var mapPrioF = s2[0]; var setMapPrioF = s2[1];
  var s3 = useState("all"); var mapGeoF  = s3[0]; var setMapGeoF  = s3[1];
  var mapRef     = useRef(null);
  var lMapRef    = useRef(null);
  var markersRef = useRef([]);

  // Initialize Leaflet map once on mount
  useEffect(function() {
    if (!mapRef.current || mapRef.current._leaflet_id) return;
    var map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd", maxZoom: 19,
    }).addTo(map);
    lMapRef.current = map;
    // Force correct size after DOM settle
    setTimeout(function() { map.invalidateSize(); }, 100);
    return function() { map.remove(); lMapRef.current = null; };
  }, []);

  // Re-plot markers whenever deals or filters change
  useEffect(function() {
    if (!lMapRef.current) return;
    markersRef.current.forEach(function(m) { m.remove(); });
    markersRef.current = [];
    deals.forEach(function(d) {
      var coords = parseHqCoords(d.analysisData && d.analysisData.hq);
      if (!coords) return;
      var matchBucket;
      if (mapTierF === "all") {
        matchBucket = true;
      } else {
        var opt = MAP_BUCKET_OPTS.find(function(o){ return o.id === mapTierF; });
        if (!opt || opt.filterType === "all") matchBucket = true;
        else if (opt.filterType === "tier")   matchBucket = (d.tier||"") === mapTierF;
        else                                  matchBucket = d.vertical === mapTierF;
      }
      if (!matchBucket) return;
      if (mapPrioF !== "all" && (d.priority||"p1") !== mapPrioF) return;
      if (mapGeoF !== "all" && (d.geography||"") !== mapGeoF) return;
      var color = VCOLOR_MAP[d.vertical] || "#94A3B8";
      var marker = L.circleMarker([coords[1], coords[0]], {
        radius: 8, fillColor: color, color: "#fff", weight: 1.5, opacity: 1, fillOpacity: 0.9,
      });
      var v    = VERTICALS.find(function(x){ return x.id === d.vertical; });
      var bkts = d.vertical === "financial_services" ? FS_SUBVERTS : TIERS;
      var bkt  = bkts.find(function(x){ return x.id === d.tier; });
      var vc   = v ? v.color : color;
      var bc   = bkt ? bkt.color : null;
      var pri  = (d.priority||"p1") === "p2";
      var tip  = '<div style="min-width:160px">' +
        '<div style="font-weight:700;font-size:12px;margin-bottom:6px">' + d.company + '</div>' +
        (d.analysisData && d.analysisData.hq ? '<div style="color:#94A3B8;font-size:10px;margin-bottom:6px">\uD83D\uDCCD ' + d.analysisData.hq + '</div>' : '') +
        '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
          (v   ? '<span style="background:' + vc + '22;color:' + vc + ';border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700">' + v.label + '</span>' : '') +
          (bkt ? '<span style="background:' + bc + '22;color:' + bc + ';border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700">' + bkt.label + '</span>' : '') +
          '<span style="background:' + (pri ? '#33415522' : '#00C2FF22') + ';color:' + (pri ? '#94A3B8' : '#00C2FF') + ';border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700">' + (pri ? 'P2' : 'P1') + '</span>' +
        '</div></div>';
      marker.bindTooltip(tip, { className: "cp-tt", sticky: false, direction: "top", offset: [0, -10] });
      marker.addTo(lMapRef.current);
      markersRef.current.push(marker);
    });
  }, [deals, mapTierF, mapPrioF, mapGeoF]);

  // Plotted count for header
  var plotCount = deals.filter(function(d) {
    var coords = parseHqCoords(d.analysisData && d.analysisData.hq);
    if (!coords) return false;
    var matchBucket;
    if (mapTierF === "all") {
      matchBucket = true;
    } else {
      var opt = MAP_BUCKET_OPTS.find(function(o){ return o.id === mapTierF; });
      if (!opt || opt.filterType === "all") matchBucket = true;
      else if (opt.filterType === "tier")   matchBucket = (d.tier||"") === mapTierF;
      else                                  matchBucket = d.vertical === mapTierF;
    }
    if (!matchBucket) return false;
    if (mapPrioF !== "all" && (d.priority||"p1") !== mapPrioF) return false;
    return mapGeoF === "all" || (d.geography||"") === mapGeoF;
  }).length;

  var sel = { background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"5px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" };

  return (
    <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:10, padding:"16px", marginTop:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, flexWrap:"wrap", gap:8 }}>
        <span style={{ color:C.text, fontWeight:700, fontSize:13 }}>Global Pipeline Map</span>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <select value={mapTierF} onChange={function(e){ setMapTierF(e.target.value); }} style={sel}>
            {MAP_BUCKET_OPTS.map(function(o){ return <option key={o.id} value={o.id}>{o.label}</option>; })}
          </select>
          <select value={mapPrioF} onChange={function(e){ setMapPrioF(e.target.value); }} style={sel}>
            <option value="all">All Priorities</option>
            <option value="p1">Priority 1</option>
            <option value="p2">Priority 2</option>
          </select>
          <select value={mapGeoF} onChange={function(e){ setMapGeoF(e.target.value); }} style={sel}>
            {GEO_OPTS.map(function(o){ return <option key={o.id} value={o.id}>{o.label}</option>; })}
          </select>
          <span style={{ color:C.dim, fontSize:10 }}>{plotCount} plotted</span>
        </div>
      </div>
      <div ref={mapRef} style={{ width:"100%", height:400, borderRadius:8, overflow:"hidden" }}/>
      <div style={{ display:"flex", gap:16, marginTop:10, flexWrap:"wrap" }}>
        {VERTICALS.map(function(v){
          return <div key={v.id} style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:v.color }}/>
            <span style={{ color:C.dim, fontSize:9 }}>{v.label}</span>
          </div>;
        })}
      </div>
    </div>
  );
}

// ─── Pipeline Tab ─────────────────────────────────────────────────────────────
function PipelineTab({ deals, setDeals, history, onViewResult, tKey, njKey }) {
  // ALL hooks first — var sN pattern, no const, no early returns before hooks
  var s1 = useState({ vertical: null, tier: null }); var pipeView = s1[0]; var setPipeView = s1[1];
  var s2 = useState(null);  var editId  = s2[0]; var setEditId  = s2[1];
  var s3 = useState(false); var showAdd = s3[0]; var setShowAdd = s3[1];
  var s4 = useState({ company:"", arr:"", stage:"prospecting", vertical:"financial_services", tier:"", priority:"p1", geography:"", notes:"" });
  var form = s4[0]; var setForm = s4[1];
  var s5 = useState(null);  var tierPickId      = s5[0]; var setTierPickId      = s5[1];
  var s6 = useState(null);  var overlayAnalysis = s6[0]; var setOverlayAnalysis = s6[1];
  var s7 = useState("all"); var prioFilter      = s7[0]; var setPrioFilter      = s7[1];
  var s8  = useState({});    var rerunStatus  = s8[0];  var setRerunStatus  = s8[1];
  var s9  = useState("");    var dealSearch   = s9[0];  var setDealSearch   = s9[1];
  var s10 = useState("all"); var stageFilter  = s10[0]; var setStageFilter  = s10[1];
  var s11 = useState("all"); var arrFilter    = s11[0]; var setArrFilter    = s11[1];
  var s12 = useState("all"); var geoFilter    = s12[0]; var setGeoFilter    = s12[1];

  function getBuckets(vid) { return vid==="financial_services" ? FS_SUBVERTS : TIERS; }

  function addDeal() {
    if (!form.company.trim()) return;
    var d = { id:Date.now(), company:form.company.trim(), arr:form.arr.trim(), stage:form.stage, vertical:form.vertical, tier:form.tier||"", priority:form.priority||"p1", geography:form.geography||"", notes:form.notes.trim(), addedAt:new Date().toISOString() };
    setDeals(function(prev){ return prev.concat([d]); });
    setForm(function(f){ return Object.assign({},f,{company:"",arr:"",notes:""}); });
    setShowAdd(false);
  }
  function updateStage(id, stage) { setDeals(function(prev){ return prev.map(function(d){ return d.id===id?Object.assign({},d,{stage:stage}):d; }); }); }
  function updateDeal(id, updates) { setDeals(function(prev){ return prev.map(function(d){ return d.id===id?Object.assign({},d,updates):d; }); }); setEditId(null); }
  function removeDeal(id) { setDeals(function(prev){ return prev.filter(function(d){ return d.id!==id; }); }); }
  function rerunAnalysis(deal) {
    setRerunStatus(function(prev){ return Object.assign({},prev,{[deal.id]:"Starting..."}); });
    runAnalysis(deal.company, function(step){
      setRerunStatus(function(prev){ return Object.assign({},prev,{[deal.id]:step}); });
    }, { tavily:tKey||"", ninjapear:njKey||"" }).then(function(data) {
      var freshArr = (data.tam_som_arr&&data.tam_som_arr.likely_arr_usd)||deal.arr;
      var freshTam = (data.tam_som_arr&&data.tam_som_arr.tam_usd)||"";
      var freshGeo = detectGeo(data.hq||"") || deal.geography || "";
      setDeals(function(prev){ return prev.map(function(d){
        if (d.id!==deal.id) return d;
        return Object.assign({},d,{ analysisData:data, arr:freshArr, tam:freshTam, geography:freshGeo, notes:(data.executive_summary||"").slice(0,120) });
      }); });
      setRerunStatus(function(prev){ var n=Object.assign({},prev); delete n[deal.id]; return n; });
    }).catch(function(err) {
      setRerunStatus(function(prev){ return Object.assign({},prev,{[deal.id]:"Error: "+err.message}); });
      setTimeout(function(){ setRerunStatus(function(prev){ var n=Object.assign({},prev); delete n[deal.id]; return n; }); }, 4000);
    });
  }

  function importFromHistory(h) {
    var already = deals.find(function(d){ return d.company.toLowerCase()===(h.company||"").toLowerCase(); });
    if (already) return;
    var seg = (h.data.segment||"").toLowerCase();
    var vert = "financial_services";
    if (seg.includes("travel")||seg.includes("hotel")||seg.includes("airline")||seg.includes("hospitality")) vert="luxury_travel";
    else if (seg.includes("luxury")||seg.includes("fashion")||seg.includes("retail")) vert="luxury_goods";
    else if (seg.includes("gaming")||seg.includes("casino")||seg.includes("gambling")||seg.includes("betting")) vert="gaming_casinos";
    var arr = (h.data.tam_som_arr&&h.data.tam_som_arr.likely_arr_usd)||"";
    var tam = (h.data.tam_som_arr&&h.data.tam_som_arr.tam_usd)||"";
    var geo = detectGeo(h.data.hq||"");
    var autoTier = (pipeView.tier&&pipeView.tier!=="all") ? pipeView.tier : "";
    var d = { id:Date.now(), company:h.company, arr:arr, tam:tam, geography:geo, stage:"prospecting", vertical:vert, tier:autoTier, priority:"p1", notes:(h.data.executive_summary||"").slice(0,120), analysisData:h.data, addedAt:h.analyzedAt };
    setDeals(function(prev){ return prev.concat([d]); });
  }

  // Metrics helpers
  function getDealTam(d) {
    if (d.tam) return parseArr(String(d.tam));
    if (!d.analysisData || !d.analysisData.tam_som_arr) return 0;
    var t = d.analysisData.tam_som_arr.tam_usd || d.analysisData.tam_som_arr.tam;
    return t ? parseArr(String(t)) : 0;
  }
  function vMetrics(vid, geo) {
    var vd = deals.filter(function(d){ return d.vertical===vid; });
    if (geo && geo!=="all") vd = vd.filter(function(d){ return (d.geography||"")===geo; });
    var wa = vd.filter(function(d){ return d.arr; });
    var tot = wa.reduce(function(s,d){ return s+parseArr(d.arr); }, 0);
    var tam = vd.reduce(function(s,d){ return s+getDealTam(d); }, 0);
    return { total:vd.length, avgArr:wa.length?tot/wa.length:0, totalArr:tot, tam:tam, won:vd.filter(function(d){return d.stage==="closed_won";}).length, p1:vd.filter(function(d){return (d.priority||"p1")==="p1";}).length, p2:vd.filter(function(d){return d.priority==="p2";}).length };
  }
  function tMetrics(vid, tid, prio, geo) {
    var vd = deals.filter(function(d){ return d.vertical===vid; });
    var td = tid==="all" ? vd : vd.filter(function(d){ return (d.tier||"")===tid; });
    if (prio && prio!=="all") td = td.filter(function(d){ return (d.priority||"p1")===prio; });
    if (geo && geo!=="all") td = td.filter(function(d){ return (d.geography||"")===geo; });
    var wa = td.filter(function(d){ return d.arr; });
    var tot = wa.reduce(function(s,d){ return s+parseArr(d.arr); }, 0);
    var tam = td.reduce(function(s,d){ return s+getDealTam(d); }, 0);
    return { total:td.length, avgArr:wa.length?tot/wa.length:0, totalArr:tot, tam:tam, p1:td.filter(function(d){return (d.priority||"p1")==="p1";}).length, p2:td.filter(function(d){return d.priority==="p2";}).length };
  }

  var inp = { background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"7px 10px", color:C.text, fontSize:11, outline:"none", fontFamily:"inherit", width:"100%" };
  var sel = Object.assign({}, inp, { cursor:"pointer" });

  var activeVert = pipeView.vertical ? (VERTICALS.find(function(v){ return v.id===pipeView.vertical; })||VERTICALS[0]) : null;
  var activeTier = pipeView.tier ? (getBuckets(pipeView.vertical||"").find(function(t){ return t.id===pipeView.tier; })||null) : null;
  var baseTierDeals = (pipeView.vertical&&pipeView.tier)
    ? deals.filter(function(d){
        if (d.vertical!==pipeView.vertical) return false;
        return pipeView.tier==="all" ? true : (d.tier||"")===pipeView.tier;
      })
    : [];
  var tierDeals = baseTierDeals.filter(function(d){
    if (prioFilter!=="all" && (d.priority||"p1")!==prioFilter) return false;
    if (geoFilter!=="all" && (d.geography||"")!==geoFilter) return false;
    if (dealSearch && !d.company.toLowerCase().includes(dealSearch.toLowerCase())) return false;
    if (stageFilter!=="all" && d.stage!==stageFilter) return false;
    if (arrFilter!=="all") {
      if (!d.arr) return false;
      var av = parseArr(d.arr);
      if (arrFilter==="under1m" && av >= 1000000) return false;
      if (arrFilter==="1m_2m" && (av < 1000000 || av > 2000000)) return false;
      if (arrFilter==="over2m" && av <= 2000000) return false;
    }
    return true;
  });

  // ── Shared add-form snippet ──────────────────────────────────────────────────
  function AddForm({ vert }) {
    return (
      <div style={{ background:C.card, border:"1px solid "+vert.color+"40", borderRadius:10, padding:"16px", marginBottom:16 }}>
        <div style={{ color:vert.color, fontWeight:700, fontSize:12, marginBottom:12 }}>New Account</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
          <div>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:4 }}>COMPANY NAME</div>
            <input value={form.company} onChange={function(e){setForm(function(f){return Object.assign({},f,{company:e.target.value});});}} placeholder="e.g. Saks Fifth Avenue" style={inp}/>
          </div>
          <div>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:4 }}>PROJECTED ARR</div>
            <input value={form.arr} onChange={function(e){setForm(function(f){return Object.assign({},f,{arr:e.target.value});});}} placeholder="e.g. $45K" style={inp}/>
          </div>
          <div>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:4 }}>{vert.id==="financial_services"?"SUB-VERTICAL":"TIER"}</div>
            <select value={form.tier||""} onChange={function(e){setForm(function(f){return Object.assign({},f,{tier:e.target.value});});}} style={sel}>
              <option value="">Unassigned</option>
              {getBuckets(vert.id).map(function(t){ return <option key={t.id} value={t.id}>{t.label}</option>; })}
            </select>
          </div>
          <div>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:4 }}>PRIORITY</div>
            <select value={form.priority||"p1"} onChange={function(e){setForm(function(f){return Object.assign({},f,{priority:e.target.value});});}} style={sel}>
              <option value="p1">Priority 1</option>
              <option value="p2">Priority 2</option>
            </select>
          </div>
          <div>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:4 }}>STAGE</div>
            <select value={form.stage} onChange={function(e){setForm(function(f){return Object.assign({},f,{stage:e.target.value});});}} style={sel}>
              {PIPE_STAGES.map(function(s){ return <option key={s.id} value={s.id}>{s.label}</option>; })}
            </select>
          </div>
          <div>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:4 }}>GEOGRAPHY</div>
            <select value={form.geography||""} onChange={function(e){setForm(function(f){return Object.assign({},f,{geography:e.target.value});});}} style={sel}>
              <option value="">Auto / Unknown</option>
              <option value="AMER">AMER</option>
              <option value="EMEA">EMEA</option>
              <option value="APAC">APAC</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom:10 }}>
          <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:4 }}>NOTES</div>
          <input value={form.notes} onChange={function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});}} placeholder="Brief opportunity summary..." style={inp}/>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={addDeal} style={{ background:vert.color, color:"#000", border:"none", borderRadius:7, padding:"7px 18px", fontWeight:800, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Add to Pipeline</button>
          <button onClick={function(){setShowAdd(false);}} style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:7, padding:"7px 14px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── Actions bar (import + add button) ───────────────────────────────────────
  function ActionsBar({ vert, defaultTier }) {
    return (
      <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        {history.length > 0 && (
          <select onChange={function(e){ if(e.target.value!=="") { importFromHistory(history[parseInt(e.target.value)]); e.target.value=""; } }}
            style={{ background:C.surface, border:"1px solid "+C.accent+"50", borderRadius:7, padding:"6px 12px", color:C.accent, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
            <option value="">+ Import from history…</option>
            {history.map(function(h,i){ return <option key={i} value={String(i)}>{h.company}</option>; })}
          </select>
        )}
        <button onClick={function(){
          setForm(function(f){ return Object.assign({},f,{vertical:vert.id, tier:defaultTier||""}); });
          setShowAdd(true);
        }} style={{ background:vert.color, color:"#000", border:"none", borderRadius:7, padding:"6px 14px", fontWeight:800, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
          + Add Account
        </button>
      </div>
    );
  }

  return (
    <div>

      {/* ── Analysis overlay ─────────────────────────────────────────────── */}
      {overlayAnalysis && (
        <div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:C.bg, zIndex:1000, overflowY:"auto", padding:"16px 20px" }}>
          <button onClick={function(){ setOverlayAnalysis(null); }}
            style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:7, padding:"6px 14px", fontSize:11, cursor:"pointer", fontFamily:"inherit", marginBottom:16 }}>
            ← Back to Pipeline
          </button>
          <AnalysisView data={overlayAnalysis}/>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN DASHBOARD — vertical === null
      ══════════════════════════════════════════════════════════════════════ */}
      {!pipeView.vertical && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
            <div style={{ color:C.text, fontSize:18, fontWeight:900 }}>Pipeline Dashboard</div>
            <div style={{ display:"flex", gap:4 }}>
              {GEO_OPTS.map(function(o){
                var active = geoFilter===o.id;
                return <button key={o.id} onClick={function(){ setGeoFilter(o.id); }}
                  style={{ background:active?C.accent:C.surface, color:active?"#000":C.muted, border:"1px solid "+(active?C.accent:C.border), borderRadius:5, padding:"4px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit", fontWeight:active?700:400 }}>
                  {o.label}
                </button>;
              })}
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:10, marginBottom:16 }}>
            {VERTICALS.map(function(v) {
              var m = vMetrics(v.id, geoFilter);
              return (
                <div key={v.id} onClick={function(){ setPipeView({vertical:v.id,tier:null}); }}
                  style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"14px 16px", cursor:"pointer", transition:"border-color 0.15s" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:12 }}>
                    <span style={{ fontSize:20 }}>{v.icon}</span>
                    <span style={{ color:C.muted, fontWeight:700, fontSize:11 }}>{v.label}</span>
                  </div>
                  <div style={{ color:v.color, fontSize:26, fontWeight:900, marginBottom:2 }}>{m.total?fmtMoney(m.totalArr):"—"}</div>
                  <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Total ARR</div>
                  {m.tam > 0 && <div style={{ marginBottom:6 }}>
                    <div style={{ color:C.gold, fontSize:11, fontWeight:700, lineHeight:1.6 }}>TAM {fmtMoney(m.tam)}</div>
                    <div style={{ color:C.cyan, fontSize:11, fontWeight:700, lineHeight:1.6 }}>Crypto SAM {fmtMoney(m.tam*0.125)}</div>
                  </div>}
                  <div style={{ color:C.muted, fontSize:12, fontWeight:600, marginBottom:10 }}>{m.total&&m.avgArr?fmtMoney(m.avgArr)+" avg":"—"}</div>
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                    <div><div style={{ color:C.dim, fontSize:9 }}>Accounts</div><div style={{ color:C.text, fontWeight:700, fontSize:13 }}>{m.total}</div></div>
                    <div><div style={{ color:C.dim, fontSize:9 }}>Won</div><div style={{ color:C.green, fontWeight:700, fontSize:13 }}>{m.won}</div></div>
                    <div><div style={{ color:C.dim, fontSize:9 }}>P1</div><div style={{ color:C.accent, fontWeight:700, fontSize:13 }}>{m.p1}</div></div>
                    <div><div style={{ color:C.dim, fontSize:9 }}>P2</div><div style={{ color:C.muted, fontWeight:700, fontSize:13 }}>{m.p2}</div></div>
                  </div>
                </div>
              );
            })}
          </div>
          {deals.length > 0 && (
            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"10px 16px", display:"flex", gap:24, alignItems:"center", flexWrap:"wrap" }}>
              <div><span style={{ color:C.dim, fontSize:10 }}>Total accounts: </span><span style={{ color:C.text, fontWeight:700, fontSize:13 }}>{deals.length}</span></div>
              <div><span style={{ color:C.dim, fontSize:10 }}>Pipeline ARR: </span><span style={{ color:C.accent, fontWeight:700, fontSize:13 }}>{fmtMoney(deals.filter(function(d){return d.arr;}).reduce(function(s,d){return s+parseArr(d.arr);},0))}</span></div>
              <div><span style={{ color:C.dim, fontSize:10 }}>Closed / Won: </span><span style={{ color:C.green, fontWeight:700, fontSize:13 }}>{deals.filter(function(d){return d.stage==="closed_won";}).length}</span></div>
              <div><span style={{ color:C.dim, fontSize:10 }}>In Proposal: </span><span style={{ color:C.gold, fontWeight:700, fontSize:13 }}>{deals.filter(function(d){return d.stage==="proposal_neg";}).length}</span></div>
            </div>
          )}
          <WorldMap deals={deals}/>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          VERTICAL VIEW — vertical set, tier === null
      ══════════════════════════════════════════════════════════════════════ */}
      {pipeView.vertical && !pipeView.tier && activeVert && (
        <div>
          {/* Breadcrumb + back + priority + geo toggles */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:16, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button onClick={function(){ setPipeView({vertical:null,tier:null}); setShowAdd(false); setPrioFilter("all"); setGeoFilter("all"); }}
                style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:7, padding:"5px 12px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>← Back</button>
              <span style={{ fontSize:18 }}>{activeVert.icon}</span>
              <span style={{ color:activeVert.color, fontWeight:900, fontSize:18 }}>{activeVert.label}</span>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <div style={{ display:"flex", gap:4 }}>
                {[["all","All"],["p1","P1"],["p2","P2"]].map(function(pair){
                  var active = prioFilter===pair[0];
                  return <button key={pair[0]} onClick={function(){ setPrioFilter(pair[0]); }}
                    style={{ background:active?C.accent:C.surface, color:active?"#000":C.muted, border:"1px solid "+(active?C.accent:C.border), borderRadius:5, padding:"4px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit", fontWeight:active?700:400 }}>
                    {pair[1]}
                  </button>;
                })}
              </div>
              <div style={{ display:"flex", gap:4 }}>
                {GEO_OPTS.map(function(o){
                  var active = geoFilter===o.id;
                  return <button key={o.id} onClick={function(){ setGeoFilter(o.id); }}
                    style={{ background:active?"#334155":C.surface, color:active?C.text:C.muted, border:"1px solid "+(active?"#475569":C.border), borderRadius:5, padding:"4px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit", fontWeight:active?700:400 }}>
                    {o.label}
                  </button>;
                })}
              </div>
            </div>
          </div>

          {/* Tier/sub-vert cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))", gap:10, marginBottom:20 }}>
            {[{id:"all",label:"All",color:C.green}].concat(getBuckets(pipeView.vertical)).map(function(t) {
              var m = tMetrics(pipeView.vertical, t.id, prioFilter, geoFilter);
              return (
                <div key={t.id} onClick={function(){ setPipeView({vertical:pipeView.vertical,tier:t.id}); setShowAdd(false); }}
                  style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"14px 16px", cursor:"pointer" }}>
                  <div style={{ color:t.color, fontWeight:800, fontSize:13, marginBottom:10 }}>{t.label}</div>
                  <div style={{ color:t.color, fontSize:22, fontWeight:900, marginBottom:2 }}>{m.total?fmtMoney(m.totalArr):"—"}</div>
                  <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:3 }}>Total ARR</div>
                  {m.tam > 0 && <div style={{ marginBottom:6 }}>
                    <div style={{ color:C.gold, fontSize:10, fontWeight:700, lineHeight:1.6 }}>TAM {fmtMoney(m.tam)}</div>
                    <div style={{ color:C.cyan, fontSize:10, fontWeight:700, lineHeight:1.6 }}>Crypto SAM {fmtMoney(m.tam*0.125)}</div>
                  </div>}
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginTop: m.tam > 0 ? 0 : 6 }}>
                    <div><div style={{ color:C.dim, fontSize:9 }}>Accounts</div><div style={{ color:C.text, fontWeight:700, fontSize:13 }}>{m.total}</div></div>
                    <div><div style={{ color:C.dim, fontSize:9 }}>Avg ARR</div><div style={{ color:t.color, fontWeight:700, fontSize:11 }}>{m.total&&m.avgArr?fmtMoney(m.avgArr):"—"}</div></div>
                    <div><div style={{ color:C.dim, fontSize:9 }}>P1</div><div style={{ color:C.accent, fontWeight:700, fontSize:11 }}>{m.p1}</div></div>
                    <div><div style={{ color:C.dim, fontSize:9 }}>P2</div><div style={{ color:C.muted, fontWeight:700, fontSize:11 }}>{m.p2}</div></div>
                  </div>
                </div>
              );
            })}
          </div>

          <ActionsBar vert={activeVert} defaultTier="" />
          {showAdd && <AddForm vert={activeVert} />}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TIER VIEW — vertical + tier both set
      ══════════════════════════════════════════════════════════════════════ */}
      {pipeView.vertical && pipeView.tier && activeVert && (
        <div>
          {/* Breadcrumb + back */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, flexWrap:"wrap" }}>
            <button onClick={function(){ setPipeView({vertical:pipeView.vertical,tier:null}); setShowAdd(false); setDealSearch(""); setStageFilter("all"); setArrFilter("all"); setPrioFilter("all"); setGeoFilter("all"); }}
              style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:7, padding:"5px 12px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>← Back</button>
            <span style={{ fontSize:16 }}>{activeVert.icon}</span>
            <span style={{ color:activeVert.color, fontWeight:700, fontSize:14 }}>{activeVert.label}</span>
            <span style={{ color:C.dim, fontSize:13 }}>›</span>
            <span style={{ color:activeTier?activeTier.color:C.green, fontWeight:800, fontSize:16 }}>{activeTier?activeTier.label:"All"}</span>
            <span style={{ color:C.dim, fontSize:11 }}>
              {(dealSearch||stageFilter!=="all"||prioFilter!=="all"||arrFilter!=="all"||geoFilter!=="all")
                ? "(Showing "+tierDeals.length+" of "+baseTierDeals.length+")"
                : "("+baseTierDeals.length+")"}
            </span>
          </div>

          {/* Search + filter bar */}
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
            <input value={dealSearch} onChange={function(e){ setDealSearch(e.target.value); }}
              placeholder="Search companies…"
              style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.text, fontSize:11, outline:"none", fontFamily:"inherit", minWidth:160, flex:"1 1 160px" }}/>
            <select value={stageFilter} onChange={function(e){ setStageFilter(e.target.value); }}
              style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
              <option value="all">All Stages</option>
              {PIPE_STAGES.map(function(s){ return <option key={s.id} value={s.id}>{s.label}</option>; })}
            </select>
            <select value={prioFilter} onChange={function(e){ setPrioFilter(e.target.value); }}
              style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
              <option value="all">All Priorities</option>
              <option value="p1">Priority 1</option>
              <option value="p2">Priority 2</option>
            </select>
            <select value={arrFilter} onChange={function(e){ setArrFilter(e.target.value); }}
              style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
              <option value="all">All ARR</option>
              <option value="under1m">Under $1M</option>
              <option value="1m_2m">$1M – $2M</option>
              <option value="over2m">Over $2M</option>
            </select>
            <select value={geoFilter} onChange={function(e){ setGeoFilter(e.target.value); }}
              style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
              {GEO_OPTS.map(function(o){ return <option key={o.id} value={o.id}>{o.label}</option>; })}
            </select>
            {(dealSearch||stageFilter!=="all"||prioFilter!=="all"||arrFilter!=="all"||geoFilter!=="all") && (
              <button onClick={function(){ setDealSearch(""); setStageFilter("all"); setPrioFilter("all"); setArrFilter("all"); setGeoFilter("all"); }}
                style={{ background:"transparent", border:"1px solid "+C.border, color:C.dim, borderRadius:6, padding:"6px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>
                Clear
              </button>
            )}
          </div>

          <ActionsBar vert={activeVert} defaultTier={pipeView.tier!=="all"?pipeView.tier:""} />
          {showAdd && <AddForm vert={activeVert} />}

          {/* Deal cards by stage */}
          {tierDeals.length === 0 ? (
            <div style={{ textAlign:"center", padding:"60px 20px", color:C.dim }}>
              <div style={{ fontSize:32, marginBottom:12 }}>{activeVert.icon}</div>
              <div style={{ fontSize:14, marginBottom:6 }}>No accounts here yet</div>
              <div style={{ fontSize:11 }}>Add manually or import from your analysis history above.</div>
            </div>
          ) : (
            <div>
              {PIPE_STAGES.map(function(stage) {
                var stageDeals = tierDeals.filter(function(d){ return d.stage===stage.id; });
                if (stageDeals.length === 0) return null;
                return (
                  <div key={stage.id} style={{ marginBottom:14 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, padding:"0 4px" }}>
                      <div style={{ width:10, height:10, borderRadius:"50%", background:stage.color, flexShrink:0 }}/>
                      <span style={{ color:stage.color, fontWeight:700, fontSize:11 }}>{stage.label}</span>
                      <span style={{ color:C.dim, fontSize:10 }}>({stageDeals.length})</span>
                      {stageDeals.some(function(d){return d.arr;}) && (
                        <span style={{ color:C.dim, fontSize:10 }}>· {fmtMoney(stageDeals.filter(function(d){return d.arr;}).reduce(function(s,d){return s+parseArr(d.arr);},0))} ARR</span>
                      )}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:8 }}>
                      {stageDeals.map(function(deal) {
                        var isEditing = editId===deal.id;
                        var dealBuckets = getBuckets(deal.vertical);
                        var dt = dealBuckets.find(function(t){ return t.id===deal.tier; });
                        var isPri2 = deal.priority==="p2";
                        return (
                          <div key={deal.id} style={{ background:C.card, border:"1px solid "+(isEditing?activeVert.color+"60":C.border), borderRadius:8, padding:"12px 14px" }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                              <div>
                                <div style={{ color:C.text, fontWeight:700, fontSize:13, lineHeight:1.3 }}>{deal.company}</div>
                                <div style={{ display:"flex", gap:6, alignItems:"center", marginTop:3, flexWrap:"wrap" }}>
                                  {dt && <span style={{ color:dt.color, fontSize:9, fontWeight:700 }}>{dt.label}</span>}
                                  <select value={deal.geography||""} onChange={function(e){ setDeals(function(prev){ return prev.map(function(x){ return x.id===deal.id?Object.assign({},x,{geography:e.target.value}):x; }); }); }}
                                    style={{ background:"transparent", border:"1px solid "+C.border, color:C.dim, borderRadius:4, padding:"1px 4px", fontSize:8, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
                                    <option value="">Region</option>
                                    <option value="AMER">AMER</option>
                                    <option value="EMEA">EMEA</option>
                                    <option value="APAC">APAC</option>
                                  </select>
                                  <button onClick={function(){ setDeals(function(prev){ return prev.map(function(x){ return x.id===deal.id?Object.assign({},x,{priority:isPri2?"p1":"p2"}):x; }); }); }}
                                    style={{ background:isPri2?C.surface:C.accentDim, border:"1px solid "+(isPri2?C.border:C.accent), color:isPri2?C.muted:C.accent, borderRadius:4, padding:"2px 6px", fontSize:8, fontWeight:700, cursor:"pointer", fontFamily:"inherit", lineHeight:1.4 }}>
                                    {isPri2?"P2":"P1"}
                                  </button>
                                </div>
                              </div>
                              <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                                {deal.analysisData && !rerunStatus[deal.id] && (
                                  <button onClick={function(){ setOverlayAnalysis(deal.analysisData); }}
                                    style={{ background:C.accentDim, border:"1px solid "+C.accent+"50", color:C.accent, borderRadius:5, padding:"3px 7px", fontSize:9, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                                    View Analysis
                                  </button>
                                )}
                                <button onClick={function(){ rerunAnalysis(deal); }} disabled={!!rerunStatus[deal.id]}
                                  style={{ background:"transparent", border:"1px solid "+(rerunStatus[deal.id]?C.dim+"40":C.border), color:rerunStatus[deal.id]?C.dim:C.muted, borderRadius:5, padding:"3px 7px", fontSize:9, cursor:rerunStatus[deal.id]?"default":"pointer", fontFamily:"inherit", fontWeight:600, opacity:rerunStatus[deal.id]?0.5:1 }}>
                                  ↺ Rerun
                                </button>
                                <button onClick={function(){ setEditId(isEditing?null:deal.id); }} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:11, padding:"0 2px" }}>✏</button>
                                <button onClick={function(){ removeDeal(deal.id); }} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:11, padding:"0 2px" }}>✕</button>
                              </div>
                            </div>
                            {rerunStatus[deal.id] && (
                              <div style={{ color:C.accent, fontSize:9, fontWeight:600, padding:"4px 0 2px", lineHeight:1.4 }}>⟳ {rerunStatus[deal.id]}</div>
                            )}
                            {deal.arr && <div style={{ color:activeVert.color, fontWeight:800, fontSize:14, marginBottom:4 }}>{deal.arr} ARR</div>}
                            {deal.notes && <div style={{ color:C.muted, fontSize:10, lineHeight:1.5, marginBottom:8 }}>{deal.notes}</div>}

                            {isEditing ? (
                              <div style={{ borderTop:"1px solid "+C.border, paddingTop:10, marginTop:6 }}>
                                <div style={{ display:"grid", gap:6, marginBottom:8 }}>
                                  <input defaultValue={deal.arr}     id={"arr_"+deal.id}   placeholder="Projected ARR e.g. $45K" style={inp}/>
                                  <input defaultValue={deal.notes}   id={"notes_"+deal.id} placeholder="Notes"                   style={inp}/>
                                  <select defaultValue={deal.tier||""} id={"tier_"+deal.id} style={sel}>
                                    <option value="">Unassigned</option>
                                    {dealBuckets.map(function(t){ return <option key={t.id} value={t.id}>{t.label}</option>; })}
                                  </select>
                                  <select defaultValue={deal.priority||"p1"} id={"priority_"+deal.id} style={sel}>
                                    <option value="p1">Priority 1</option>
                                    <option value="p2">Priority 2</option>
                                  </select>
                                  <select defaultValue={deal.stage}    id={"stage_"+deal.id} style={sel}>
                                    {PIPE_STAGES.map(function(s){ return <option key={s.id} value={s.id}>{s.label}</option>; })}
                                  </select>
                                  <select defaultValue={deal.vertical} id={"vert_"+deal.id}  style={sel}>
                                    {VERTICALS.map(function(v){ return <option key={v.id} value={v.id}>{v.icon} {v.label}</option>; })}
                                  </select>
                                  <select defaultValue={deal.geography||""} id={"geo_"+deal.id} style={sel}>
                                    <option value="">No Region</option>
                                    <option value="AMER">AMER</option>
                                    <option value="EMEA">EMEA</option>
                                    <option value="APAC">APAC</option>
                                  </select>
                                </div>
                                <button onClick={function(){
                                  var arrEl      = document.getElementById("arr_"+deal.id);
                                  var notesEl    = document.getElementById("notes_"+deal.id);
                                  var tierEl     = document.getElementById("tier_"+deal.id);
                                  var priorityEl = document.getElementById("priority_"+deal.id);
                                  var stageEl    = document.getElementById("stage_"+deal.id);
                                  var vertEl     = document.getElementById("vert_"+deal.id);
                                  var geoEl      = document.getElementById("geo_"+deal.id);
                                  updateDeal(deal.id, {
                                    arr:      arrEl      ? arrEl.value      : deal.arr,
                                    notes:    notesEl    ? notesEl.value    : deal.notes,
                                    tier:     tierEl     ? tierEl.value     : (deal.tier||""),
                                    priority: priorityEl ? priorityEl.value : (deal.priority||"p1"),
                                    stage:    stageEl    ? stageEl.value    : deal.stage,
                                    vertical: vertEl     ? vertEl.value     : deal.vertical,
                                    geography:geoEl      ? geoEl.value      : (deal.geography||""),
                                  });
                                }} style={{ background:activeVert.color, color:"#000", border:"none", borderRadius:6, padding:"5px 14px", fontWeight:800, fontSize:10, cursor:"pointer", fontFamily:"inherit", marginRight:6 }}>Save</button>
                                <button onClick={function(){ setEditId(null); }} style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:6, padding:"5px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                              </div>
                            ) : (
                              <div style={{ borderTop:"1px solid "+C.border, paddingTop:8, marginTop:4 }}>
                                <div style={{ color:C.dim, fontSize:9, marginBottom:5 }}>MOVE TO STAGE</div>
                                <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8 }}>
                                  {PIPE_STAGES.filter(function(s){ return s.id!==deal.stage; }).map(function(s) {
                                    return (
                                      <button key={s.id} onClick={function(){ updateStage(deal.id,s.id); }}
                                        style={{ background:"transparent", border:"1px solid "+s.color+"50", color:s.color, borderRadius:5, padding:"3px 7px", fontSize:9, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                                        {s.label}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:4 }}>
                                  <button onClick={function(){ setTierPickId(tierPickId===deal.id?null:deal.id); }}
                                    style={{ background:"transparent", border:"1px solid "+(dt?dt.color+"80":C.border), color:dt?dt.color:C.dim, borderRadius:5, padding:"3px 8px", fontSize:9, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                                    {dt ? "Change" : "Add"} {deal.vertical==="financial_services"?"Sub-vertical":"Tier"}
                                  </button>
                                  {tierPickId===deal.id && (
                                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                                      {dealBuckets.map(function(t){
                                        var isActive = deal.tier===t.id;
                                        return (
                                          <button key={t.id} onClick={function(){ setDeals(function(prev){ return prev.map(function(x){ return x.id===deal.id?Object.assign({},x,{tier:t.id}):x; }); }); setTierPickId(null); }}
                                            style={{ background:isActive?t.color:t.color+"25", border:"1px solid "+t.color, color:isActive?"#000":t.color, borderRadius:5, padding:"3px 8px", fontSize:9, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>
                                            {t.label}
                                          </button>
                                        );
                                      })}
                                      {dt && (
                                        <button onClick={function(){ setDeals(function(prev){ return prev.map(function(x){ return x.id===deal.id?Object.assign({},x,{tier:""}):x; }); }); setTierPickId(null); }}
                                          style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:5, padding:"3px 7px", fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>
                                          Unassign
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  var s1  = useState("analyze"); var page    = s1[0];  var setPage    = s1[1];
  var s2  = useState("");        var company = s2[0];  var setCompany = s2[1];
  var s3  = useState(false);     var loading = s3[0];  var setLoading = s3[1];
  var s4  = useState("");        var step    = s4[0];  var setStep    = s4[1];
  var s5  = useState(null);      var result  = s5[0];  var setResult  = s5[1];
  var s6  = useState("");        var error   = s6[0];  var setError   = s6[1];
  var s7  = useState(false);     var showKeys= s7[0];  var setShowKeys= s7[1];
  var s8  = useState(function(){ return localStorage.getItem(TKEY_LS)||""; }); var tKey  = s8[0]; var setTKey  = s8[1];
  var s9  = useState(function(){ return localStorage.getItem(NJKEY_LS)||""; }); var njKey = s9[0]; var setNjKey = s9[1];
  var s10 = useState(function(){ try { return JSON.parse(localStorage.getItem(HIST_LS)||"[]"); } catch { return []; } });
  var history      = s10[0]; var setHistory      = s10[1];
  var s11 = useState(function(){ try { return (JSON.parse(localStorage.getItem(PIPE_LS)||"[]")).filter(function(d){ return d && d.company; }); } catch { return []; } });
  var pipelineDeals= s11[0]; var setPipelineDeals= s11[1];
  var s12 = useState(false); var pipeLoaded = s12[0]; var setPipeLoaded = s12[1];

  useEffect(function(){ localStorage.setItem(HIST_LS, JSON.stringify(history)); }, [history]);

  // Load pipeline from server on mount — server is source of truth for cross-device sync
  useEffect(function() {
    fetch("/api/pipeline").then(function(r){ return r.json(); }).then(function(d) {
      if (Array.isArray(d.pipeline) && d.pipeline.length > 0) setPipelineDeals(d.pipeline.filter(function(d){ return d && d.company; }));
      setPipeLoaded(true);
    }).catch(function(){ setPipeLoaded(true); });
  }, []);

  // Save pipeline to server + localStorage on every change (pipeLoaded guards against
  // overwriting server data with stale localStorage before the mount fetch resolves)
  useEffect(function() {
    localStorage.setItem(PIPE_LS, JSON.stringify(pipelineDeals));
    if (!pipeLoaded) return;
    fetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: pipelineDeals })
    }).catch(function(){});
  }, [pipelineDeals, pipeLoaded]);

  function saveKey(lsKey, val, fn) { fn(val); localStorage.setItem(lsKey, val); }

  async function go() {
    if (!company.trim() || loading) return;
    setLoading(true); setError(""); setResult(null); setStep("Starting analysis...");
    try {
      var data = await runAnalysis(company.trim(), setStep, { tavily:tKey, ninjapear:njKey });
      setResult(data);
      setHistory(function(h){ return [{ company:data.company, analyzedAt:data.analyzedAt, data:data }].concat(h.slice(0,9)); });
      setPage("result");
    } catch(e) { setError(e.message); }
    setLoading(false); setStep("");
  }

  var keyColor = (tKey&&njKey)?C.green:(tKey||njKey)?C.gold:C.red;
  var keyLabel = (tKey&&njKey)?"🟢 Full Intel":(tKey||njKey)?"🟡 Partial":"🔑 Add Keys";

  var pipeCount = history.length; // pipeline uses history-imported deals, no separate count needed in nav
  var NAV = [
    ["analyze", "🔍 Analyze"],
    ["result",  "📊 Result"+(result?" ✓":"")],
    ["pipeline","📋 Pipeline"],
    ["history", "🕐 History"+(history.length?" ("+history.length+")":"")],
  ];

  return (
    <div style={{ background:C.bg, minHeight:"100vh", fontFamily:"ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace", fontSize:12 }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}button,input,select,textarea{font-family:inherit}input::placeholder,textarea::placeholder{color:#334155}`}</style>

      {/* Nav */}
      <div style={{ background:C.surface, borderBottom:"1px solid "+C.border, padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:52, position:"sticky", top:0, zIndex:100, gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <div style={{ width:28, height:28, borderRadius:7, background:"linear-gradient(135deg,"+C.accent+","+C.purple+")", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>₿</div>
          <div>
            <div style={{ color:C.text, fontWeight:800, fontSize:11, letterSpacing:"0.05em" }}>COINPAYMENTS</div>
            <div style={{ color:C.dim, fontSize:8, letterSpacing:"0.1em" }}>SALES INTELLIGENCE</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:4, alignItems:"center", overflowX:"auto" }}>
          {NAV.map(function(n){
            var id=n[0]; var label=n[1];
            return <button key={id} onClick={function(){setPage(id);}} style={{ padding:"5px 12px", borderRadius:7, background:page===id?C.accent:"transparent", color:page===id?"#000":C.muted, border:"1px solid "+(page===id?C.accent:"transparent"), fontWeight:page===id?800:500, fontSize:10, cursor:"pointer", whiteSpace:"nowrap" }}>{label}</button>;
          })}
          <div style={{ width:1, height:22, background:C.border, margin:"0 4px" }}/>
          <button onClick={function(){setShowKeys(!showKeys);}} style={{ padding:"4px 10px", borderRadius:7, background:"transparent", color:keyColor, border:"1px solid "+keyColor+"50", fontSize:10, cursor:"pointer", whiteSpace:"nowrap" }}>{keyLabel}</button>
        </div>
      </div>

      {/* Keys */}
      {showKeys && (
        <div style={{ background:C.surface, borderBottom:"1px solid "+C.border, padding:"14px 20px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <span style={{ color:C.text, fontSize:12, fontWeight:700 }}>🔑 API Keys</span>
            <button onClick={function(){setShowKeys(false);}} style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11 }}>Done</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:12 }}>
            {[{ label:"🌐 Tavily Search", desc:"Live news · app.tavily.com ($35/mo Starter)", lsk:TKEY_LS, val:tKey, fn:function(v){saveKey(TKEY_LS,v,setTKey);}, ph:"tvly-xxxx" },
              { label:"🎯 NinjaPear",     desc:"Executive profiles · nubela.co/dashboard",    lsk:NJKEY_LS,val:njKey,fn:function(v){saveKey(NJKEY_LS,v,setNjKey);},ph:"api key from nubela.co" }
            ].map(function(k){
              return (
                <div key={k.label} style={{ background:C.card, borderRadius:8, padding:"12px 14px", border:"1px solid "+(k.val?C.green+"40":C.border) }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:4 }}>
                    <span style={{ color:C.text, fontWeight:700, fontSize:11 }}>{k.label}</span>
                    {k.val && <Badge color="green" sm>CONNECTED</Badge>}
                  </div>
                  <div style={{ color:C.dim, fontSize:10, marginBottom:8 }}>{k.desc}</div>
                  <input type="password" value={k.val} onChange={function(e){k.fn(e.target.value);}} placeholder={k.ph} style={{ width:"100%", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"7px 10px", color:C.text, fontSize:11, outline:"none" }}/>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:10, color:C.dim, fontSize:10 }}>Keys are saved to this browser only. NinjaPear finds executives: CEO, CMO, CPO, CTO, COO, CFO + VPs.</div>
        </div>
      )}

      {/* Main */}
      <div style={{ padding:"20px 16px", maxWidth:960, margin:"0 auto" }}>

        {/* Analyze */}
        {page==="analyze" && (
          <div>
            <div style={{ marginBottom:24 }}>
              <div style={{ color:C.text, fontSize:22, fontWeight:900, marginBottom:4 }}>Sales Intelligence</div>
              <div style={{ color:C.muted, fontSize:12 }}>Full B2B sales intelligence report for any target.</div>
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <input value={company} onChange={function(e){setCompany(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")go();}} placeholder="e.g. Bellagio, Saks Fifth Avenue, DraftKings, Amex..." style={{ flex:1, background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"12px 16px", color:C.text, fontSize:14, outline:"none" }}/>
              <button onClick={go} disabled={loading||!company.trim()} style={{ padding:"12px 28px", borderRadius:8, background:loading?"transparent":C.accent, color:loading?C.muted:"#000", border:"1px solid "+(loading?C.border:C.accent), fontWeight:800, fontSize:13, cursor:loading?"wait":"pointer", whiteSpace:"nowrap" }}>
                {loading?"Analyzing...":"⚡ Analyze"}
              </button>
            </div>
            {loading&&step&&<div style={{ color:C.accent, fontSize:11, padding:"10px 14px", background:C.accentDim, borderRadius:8, marginBottom:12 }}>⟳ {step}</div>}
            {error&&<div style={{ background:C.redDim, border:"1px solid "+C.red+"40", borderRadius:8, padding:"12px 16px", color:C.red, fontSize:11 }}><div style={{ fontWeight:700, marginBottom:4 }}>Error</div>{error}</div>}
            {!loading&&!error&&(
              <div style={{ marginTop:24, color:C.dim, fontSize:11, lineHeight:1.9 }}>
                <div style={{ marginBottom:6, color:C.muted, fontWeight:700 }}>What you get:</div>
                {["🚨 Missed opportunity + competitor threat","💰 Bottoms-up ARR projection ($750K-$2M typical range)","👥 Verified executives via NinjaPear (12 roles)","🤝 Partnership intelligence","⚔️ Competitive comparison: CoinPayments vs target","🗺️ GTM plan + sequenced timeline","📰 Live news from last 6 months","💬 AI chat for account questions","📋 Pipeline with 4 verticals & stage tracking"].map(function(f){
                  return <div key={f}>• {f}</div>;
                })}
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {page==="result" && (
          result
            ? <div>
                <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}>
                  <button onClick={function(){
                    // Auto-detect vertical from segment
                    var seg = (result.segment||"").toLowerCase();
                    var vert = "financial_services";
                    if (seg.includes("travel")||seg.includes("hotel")||seg.includes("airline")||seg.includes("hospitality")) vert="luxury_travel";
                    else if (seg.includes("luxury")||seg.includes("fashion")||seg.includes("retail")) vert="luxury_goods";
                    else if (seg.includes("gaming")||seg.includes("casino")||seg.includes("gambling")||seg.includes("betting")) vert="gaming_casinos";
                    var arr = (result.tam_som_arr&&result.tam_som_arr.likely_arr_usd)||"";
                    var tam = (result.tam_som_arr&&result.tam_som_arr.tam_usd)||"";
                    var geo = detectGeo(result.hq||"");
                    setPipelineDeals(function(prev){
                      var already = prev.find(function(d){ return d.company.toLowerCase()===(result.company||"").toLowerCase(); });
                      if (already) return prev;
                      return prev.concat([{ id:Date.now(), company:result.company, arr:arr, tam:tam, geography:geo, stage:"prospecting", vertical:vert, priority:"p1", notes:(result.executive_summary||"").slice(0,120), analysisData:result, addedAt:new Date().toISOString() }]);
                    });
                    setPage("pipeline");
                  }} style={{ background:C.accent, color:"#000", border:"none", borderRadius:7, padding:"8px 18px", fontSize:11, cursor:"pointer", fontWeight:800, fontFamily:"inherit" }}>
                    + Add to Pipeline
                  </button>
                </div>
                <AnalysisView data={result}/>
              </div>
            : <div style={{ textAlign:"center", padding:80, color:C.dim }}>
                <div style={{ fontSize:32, marginBottom:16 }}>📊</div>
                <div style={{ fontSize:14, marginBottom:16 }}>No analysis yet</div>
                <button onClick={function(){setPage("analyze");}} style={{ background:C.accent, color:"#000", border:"none", borderRadius:8, padding:"10px 20px", fontWeight:700, fontSize:12, cursor:"pointer" }}>Run Analysis →</button>
              </div>
        )}

        {/* Pipeline */}
        {page==="pipeline" && <PipelineTab deals={pipelineDeals} setDeals={setPipelineDeals} history={history} tKey={tKey} njKey={njKey} onViewResult={function(data){setResult(data);setPage("result");}}/>}

        {/* History */}
        {page==="history" && (
          <div>
            <div style={{ color:C.text, fontSize:18, fontWeight:800, marginBottom:16 }}>Analysis History</div>
            {history.length===0
              ? <div style={{ textAlign:"center", padding:60, color:C.dim }}>
                  <div style={{ fontSize:28, marginBottom:12 }}>🕐</div>
                  <div>No analyses yet. History is saved in this browser.</div>
                </div>
              : history.map(function(h,i){
                  return (
                    <div key={i} style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"14px 16px", marginBottom:10, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}
                      onClick={function(){setResult(h.data);setPage("result");}}>
                      <div>
                        <div style={{ color:C.text, fontWeight:700, fontSize:14 }}>{h.company}</div>
                        <div style={{ color:C.muted, fontSize:11, marginTop:2 }}>{h.data.segment||""} {h.data.hq?"· "+h.data.hq:""}</div>
                        {h.data.tam_som_arr&&h.data.tam_som_arr.likely_arr_usd&&<div style={{ color:C.green, fontSize:11, marginTop:2 }}>ARR: {h.data.tam_som_arr.likely_arr_usd}</div>}
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ color:C.dim, fontSize:10 }}>{new Date(h.analyzedAt).toLocaleTimeString()}</div>
                        <div style={{ color:C.accent, fontSize:11, marginTop:4 }}>View →</div>
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
