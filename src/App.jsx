import React, { useState, useRef, useEffect } from "react";
import AnalysisView, { Badge, Chip, Sec, ContactCard } from "./AnalysisView";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL    = "claude-sonnet-4-20250514";
const TKEY_LS  = "cp_tavily_key";
const NJKEY_LS = "cp_ninjapear_key";
const HIST_LS  = "cp_history";
const PIPE_LS  = "cp_pipeline";
const GAMMA_HIST_LS = "cp_gamma_history";

// ─── CoinPayments Authoritative Capability Data ───────────────────────────────
// Single source of truth for all CoinPayments positioning across prompts.
// Reference CP_CAPABILITIES in any Grok/Claude prompt that describes CoinPayments.
const CP_CAPABILITIES = "COINPAYMENTS AUTHORITATIVE CAPABILITY DATA — use this as the definitive source for all CoinPayments capability descriptions in competitive analysis. Do not deviate from these descriptions or substitute generic crypto payment processor language.\n\nCoinPayments delivers one platform with four transformative capabilities — an API-driven infrastructure stack that eliminates the need for clients to build or maintain their own blockchain infrastructure, enabling instant, low-cost, 24/7 global payments with outsourced custody and compliance.\n\n1. STABLECOIN + BLOCKCHAIN RAILS: 24/7 instant settlement bypassing correspondent banks. Automated FX conversions, zero pre-funding requirements, fractions of a cent per transaction.\n\n2. FIAT ON/OFF RAMPS: White-label tooling for local fiat \u2194 stablecoin/crypto \u2194 local fiat. Single UX, no intermediated conversion. Bank, card, and cash integration via regulated partners.\n\n3. THIRD-PARTY WALLET HOSTING: White-label, compliant MPC custody with insured cold/hot storage, automated reconciliation, and audit-ready reporting \u2014 fully outsourced key management.\n\n4. COMPLIANCE-AS-A-SERVICE: Turnkey jurisdictional expansion across 180+ licensed jurisdictions and 40+ digital assets. AML/KYC, audit trails, and policy engines included.";

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

async function callGrok(system, user, maxTokens, fast) {
  const model = fast ? "grok-3-fast" : "grok-3";
  const res = await fetch("/api/grok", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens || 8000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    let msg = "Grok " + res.status;
    try { const j = JSON.parse(t); msg = "Grok " + (j.xai_status || res.status) + " " + (j.xai_status_text || "") + (j.error ? ": " + String(j.error).slice(0, 120) : ""); } catch {}
    throw new Error(msg.trim());
  }
  const j = await res.json();
  if (j.error) throw new Error("Grok " + (j.xai_status || "") + " " + (j.xai_status_text || "") + ": " + String(typeof j.error === "string" ? j.error : (j.error.message || JSON.stringify(j.error))).slice(0, 120));
  const choice = (j.choices || [])[0];
  if (!choice) throw new Error("Empty response from Grok");
  return (choice.message && choice.message.content) || choice.text || "";
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
  const SYS = 'You are a senior B2B sales intelligence expert for CoinPayments (100+ digital assets, white-label infrastructure, fiat on/off ramps, API-first). Output ONLY valid JSON. No markdown. Start with { end with }. Values under 35 words.\n\nARR METHODOLOGY — follow this exact structure:\n\nStep 1 — Find the volume driver. Identify the most appropriate volume metric based on business model:\n  FX & Brokerage: AUM or annual trading volume\n  Neobanks: annual payment volume or total transaction volume\n  Remittance Fintechs: annual remittance volume\n  Regional/Middle Market Banks: total payment volume or deposit base\n  Escrow: annual escrow transaction volume\n  Luxury Travel: annual booking volume or GMV\n  Luxury Goods: annual GMV or revenue\n  Gaming & Casinos: annual GGR or wagering volume\nUse the actual figure from the provided research data. If not found, make an informed estimate based on company size, funding, and comparable companies — state clearly that it is an estimate.\n\nStep 2 — Calculate crypto adoption volume. Apply a rate based on this company\'s current crypto maturity:\n  Already offering crypto: 15-25% of volume\n  Actively exploring crypto: 8-15% of volume\n  Early stage / no crypto yet: 3-8% of volume\nCrypto adoption volume = Total volume x adoption rate.\n\nStep 3 — Calculate SOM. SOM = Crypto adoption volume x 0.5% CoinPayments fee rate. This is the serviceable obtainable market — what CoinPayments can realistically earn from this company\'s crypto volume.\n\nStep 4 — Calculate projected ARR. projected_arr = SOM x capture rate:\n  1% for no existing crypto infrastructure or early exploration\n  1.5% for actively piloting or exploring crypto payments\n  2% for already partially deployed or strong crypto affinity\nupside_arr = SOM x 3% capture rate.\n\nStep 5 — Sanity check. Does projected_arr make sense relative to the company\'s overall scale? Flag and adjust if the number seems too low or too high — explain why.\n\nAlways show full inline math in som_calculation in this format:\n"[Volume driver] x [adoption %] = [crypto volume] x 0.5% fee = [SOM] x [capture %] = [Projected ARR]"\nExample: "$500B AUM x 10% crypto adoption = $50B crypto volume x 0.5% fee = $250M SOM x 1.5% = $3.75M ARR"\n\nOutput fields: tam = broad industry TAM for reference only (not used in calculation), som = crypto adoption volume x 0.5% fee, projected_arr = SOM x capture rate, upside_arr = SOM x 3%.\n\nFX & BROKERAGE VERTICAL OVERRIDE — For any target identified as FX & Brokerage (broker, FX firm, prop trading firm, market maker, institutional trading desk), ignore the general ARR formula above and use this simplified basis points model instead. Do NOT apply a crypto adoption haircut — the fee applies to full volume:\n\nFormula:\nProjected ARR = Total annual volume × 0.003% (0.3 bps = $3 per $1,000,000)\nUpside ARR = Total annual volume × 0.005% (0.5 bps upside scenario)\n\nStep 1 — Find 2025 total trading/transaction volume. Use the full volume number — not crypto volume, not an adoption subset. Priority: (1) annual trading or transaction volume; (2) daily average volume × 252 trading days to annualize; (3) comparable firm benchmarks for their size/category. If not publicly disclosed, extrapolate from most recent disclosed figure adjusted for growth rate. Always state the source or methodology used.\n\nShow the full inline math in som_calculation in this exact format:\n"$[total volume] annual volume × 0.003% (0.3bps per $1M) = $[Projected ARR] ARR"\nExample: "$100B annual volume × 0.003% (0.3bps per $1M) = $3M ARR"\n\nFor FX & Brokerage: SOM = total annual volume (the full volume base). TAM = total addressable market for their specific segment (retail FX, institutional FX, equity brokerage, prop trading) — for reference only. All figures in USD — convert any non-USD volumes at current approximate exchange rates and state the conversion used.';

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
      // Targeted crypto infrastructure partnership searches
      tavilyRaw(company + " Fireblocks partnership integration", tKey, 5, 730),
      tavilyRaw(company + " Anchorage Digital partnership custody", tKey, 5, 730),
      tavilyRaw(company + " Coinbase Prime partnership integration", tKey, 5, 730),
      tavilyRaw(company + " Zero Hash partnership stablecoin", tKey, 5, 730),
      tavilyRaw(company + " Paxos partnership settlement", tKey, 5, 730),
      tavilyRaw(company + " BitGo custody partnership", tKey, 5, 730),
      tavilyRaw(company + " Bakkt partnership crypto", tKey, 5, 730),
      tavilyRaw(company + " crypto infrastructure partner custody settlement", tKey, 5, 730),
      tavilyRaw(company + " blockchain partnership announcement 2024 2025", tKey, 5, 730),
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

    if (allRaw.length) {
      ctx += "=== SCRAPED EXECUTIVE & COMPANY CONTENT for " + company + " ===\n";
      allRaw.slice(0, 8).forEach(function(r, i) {
        ctx += (i+1) + ". " + r.title + "\n   URL: " + r.url + "\n   " + (r.content || "").slice(0, 200) + "\n\n";
      });
      ctx += "=== END SCRAPED CONTENT ===\n\n";
    }
    if (rPart.length) { ctx += "PARTNER SIGNALS:\n" + rPart.slice(0, 4).map(function(r) { return r.title + ": " + (r.content || "").slice(0, 150); }).join("\n") + "\n\n"; }
  }

  // Phase 0d — Upcoming events research: targeted conference + exec social searches
  var rawEvents = [];
  var njEvtCtx = "";
  if (tKey || njKey) {
    onStep("🗓️ Researching upcoming events...");
    var evtSearches = [];

    // Step 1 — Specific named-conference searches + exec social searches (Tavily)
    if (tKey) {
      var KNOWN_CONFS = ["Consensus 2026", "Money 20/20 2026", "Fintech Nexus 2026", "Singapore Fintech Festival 2026"];
      for (var _cn of KNOWN_CONFS) {
        evtSearches.push(tavilyRaw(company + " " + _cn, tKey, 5, 365));
      }
      evtSearches.push(tavilyRaw(company + " conference speaking sponsor exhibitor 2026", tKey, 8, 365));
      evtSearches.push(tavilyRaw('"' + company + '" event 2026 site:linkedin.com OR site:x.com', tKey, 6, 365));
      for (var _ec of contacts.slice(0, 4)) {
        evtSearches.push(tavilyRaw('"' + _ec.name + '" speaking attending conference 2026 site:linkedin.com OR site:x.com', tKey, 5, 365));
        evtSearches.push(tavilyRaw('"' + _ec.name + '" Consensus OR "Money 20/20" OR "Fintech Nexus" 2026', tKey, 4, 365));
      }
    }

    // Step 2 — NinjaPear company updates (social posts / press releases)
    var njCoUpdatesP = njKey ? (async function() {
      try {
        var r = await fetch("/api/ninjapear", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: "v1/company/updates", params: { website: "https://" + domain, page_size: 15 }, key: njKey }) });
        if (!r.ok) return null;
        var d = await r.json();
        return (d.updates || d.results || d.posts || null);
      } catch { return null; }
    })() : Promise.resolve(null);

    var [evtResultBatches, njPosts] = await Promise.all([
      evtSearches.length ? Promise.all(evtSearches) : Promise.resolve([]),
      njCoUpdatesP,
    ]);

    // Deduplicate Tavily results
    var seenEvtU = new Set();
    for (var _ea of evtResultBatches) {
      for (var _er of _ea) {
        if (!_er.url || seenEvtU.has(_er.url)) continue;
        seenEvtU.add(_er.url); rawEvents.push(_er);
      }
    }

    // Build NinjaPear context string
    if (njPosts && njPosts.length) {
      njEvtCtx = "=== NINJAPEAR COMPANY SOCIAL POSTS for " + company + " ===\n";
      njPosts.slice(0, 10).forEach(function(p, i) {
        var txt = p.text || p.content || p.message || p.description || "";
        if (txt) njEvtCtx += (i+1) + ". " + txt.slice(0, 350) + "\n";
      });
      njEvtCtx += "=== END NINJAPEAR POSTS ===\n\n";
    }
  }

  // Phase 1 — Core intelligence (Grok primary, Claude fallback)
  onStep("🧠 Grok core analysis...");
  var P1_USER = CP_CAPABILITIES + "\n\nWhen describing CoinPayments in the executive summary, opportunity analysis, positioning statement, or any other output section, always use the COINPAYMENTS AUTHORITATIVE CAPABILITY DATA above as your reference. Do not describe CoinPayments as a generic crypto payment processor — always reference the four specific capabilities by name where relevant. The four capabilities are: Stablecoin + Blockchain Rails, Fiat On/Off Ramps, Third-Party Wallet Hosting, Compliance-as-a-Service.\n\n" + sanitize(ctx) + "\n\nAnalyze " + company + " as a CoinPayments sales target. Today: " + todayStr + ".\n\nIMPORTANT: Ground all financial estimates, scale metrics, and key facts in the Tavily news, NinjaPear enrichment, and scraped web content provided above. When you cite a specific number (users, revenue, volume), name which source it came from. If sources conflict, prefer the most specific and recent data point over generic industry stats.\n\nUse your real-time access to X (Twitter) to find recent posts from " + company + " executives or official accounts mentioning crypto, stablecoins, digital assets, payment infrastructure, or blockchain. Include specific post summaries with approximate dates as intent signals in the intent_data array. For each intent signal, provide a source URL if you have one. IMPORTANT source URL rules: (1) only include a URL if it points to a specific article, post, or press release — never a homepage or search results page; (2) if you cannot provide a specific verified URL, set source_url to null and set source_type to 'Grok real-time knowledge'; (3) never fabricate URLs — a null with an honest source_type is far better than a made-up link. Set verified: true only if you have a specific URL, false if based on your knowledge without a specific URL.\n\nCRYPTO INFRASTRUCTURE PARTNERSHIPS — CRITICAL RESEARCH REQUIREMENT:\nCarefully research ALL existing crypto infrastructure partnerships for " + company + " and all their subsidiaries. Pay specific attention to relationships with the following known crypto infrastructure providers — these are commonly used by financial firms and are often underreported in general news:\n- Fireblocks (MPC custody, digital asset infrastructure)\n- Anchorage Digital (institutional custody)\n- Coinbase Prime (institutional trading and custody)\n- Zero Hash (crypto-as-a-service, stablecoin settlement)\n- Paxos (regulated blockchain infrastructure, stablecoins)\n- BitGo (institutional custody and wallets)\n- Bakkt (digital asset platform)\n- Chainalysis (blockchain analytics and compliance)\n- Ledger Enterprise (hardware custody)\n- Copper (institutional custody)\n- Talos (institutional trading infrastructure)\n- Blockdaemon (node infrastructure)\n- Alchemy (blockchain developer platform)\n\nFor each partnership found:\n- Name the specific provider and the nature of the relationship (custody, settlement, compliance, trading infrastructure etc)\n- State when the partnership was announced if known\n- Explain what this tells us about " + company + "'s existing crypto infrastructure maturity\n- Flag if this partnership overlaps with or complements CoinPayments' capabilities\n- Flag if this partnership means " + company + " already has a solution CoinPayments would need to displace or complement\n\nIf a partnership with any of the above providers is found, this is critical intelligence for the competitive comparison — " + company + " already has crypto infrastructure and the CoinPayments pitch must be framed as complementary or superior, not introductory. Adjust the opportunity framing accordingly.\n\nNever return an empty partnerships section without first exhausting searches for all providers listed above. If no partnerships are found after thorough research, state explicitly in the partnerships array: 'No confirmed crypto infrastructure partnerships found. " + company + " appears to be building or exploring independently.'\n\nTAM REFERENCE FIGURES — use these benchmarks for the tam_usd field based on the company's segment:\n- FX & Brokerage: TAM = total addressable FX and brokerage market for their specific segment. Used as reference only — ARR is calculated from payment/FX volume × 0.003%, TAM does not feed into the ARR calculation.\n- Neobanks: Default to the global digital banking market (~$9T). Only deviate if the company is a clear specialist: cross-border remittance neobank ($150T global cross-border flows), B2B payments only ($125T global B2B payments), pure consumer digital payments ($2.8T). Always state which figure is used and why. Always use a figure ≥ $500B — a TAM below $500B for a neobank indicates the wrong reference market was selected.\n- Remittance Fintechs: Use the global remittance market TAM — approximately $48B–$54B annually for formal remittance channels, or the broader $150T global cross-border payment flows if the company operates at that scale. Choose based on company scope and state which you used.\n- Escrow: Use the global escrow and trust services market TAM as reference.\n- Regional / Middle Market Banks: Use the total addressable digital banking and payments market for their regional scope as reference.\n\nOutput ONLY this JSON:\n{\n  \"company\": \"" + company + "\",\n  \"segment\": \"e.g. Neo-bank\",\n  \"hq\": \"City, Country\",\n  \"website\": \"domain.com\",\n  \"employees\": \"count or range\",\n  \"revenue\": \"annual revenue\",\n  \"executive_summary\": \"3-sentence opportunity summary\",\n  \"tam_som_arr\": {\n    \"tam_usd\": \"$X broad industry TAM for reference only — see TAM REFERENCE FIGURES above for segment benchmarks (neobanks ≥$500B; FX & Brokerage TAM is reference only, ARR uses volume × 0.003%)\",\n    \"scale_metric\": \"e.g. 15M active users or $2B annual payment volume\",\n    \"penetration_rate\": \"e.g. 6% (Remittance Fintech range 12-18%)\",\n    \"addressable_base\": \"e.g. 900K crypto-addressable users\",\n    \"avg_transaction_value\": \"e.g. $450/user/year (default)\",\n    \"som\": \"e.g. $405M\",\n    \"capture_rate\": \"e.g. 1.5%\",\n    \"projected_arr\": \"e.g. $6.1M\",\n    \"upside_arr\": \"e.g. $12.2M (SOM × 3%)\",\n    \"som_calculation\": \"show full math inline e.g. 15M users × 6% = 900K × $450 = $405M SOM × 1.5% = $6.1M ARR\",\n    \"assumptions\": [\"assumption 1\", \"assumption 2\"]\n  },\n  \"partnerships\": [{ \"partner\": \"Name\", \"type\": \"type\", \"what_they_provide\": \"what\", \"dependency\": \"Critical|Important|Minor\", \"cp_angle\": \"how CP fits\" }],\n  \"geography\": { \"markets\": [\"list\"], \"gaps\": \"key gaps\" },\n  \"incumbent\": { \"name\": \"provider or null\", \"weaknesses\": \"why switch\" },\n  \"missed_opportunity\": { \"headline\": \"punchy sentence\", \"competitor_threat\": \"who is stealing users\", \"market_stat_1\": \"stat\", \"market_stat_2\": \"stat\", \"narrative\": \"5-sentence argument\", \"urgency\": \"High|Medium|Low\", \"urgency_reason\": \"why now\" },\n  \"intent_data\": [{ \"signal\": \"observation or X post summary\", \"type\": \"Funding|Hiring|Product|Partnership|Regulatory|X_Signal\", \"date\": \"when\", \"implication\": \"what it means\", \"source_url\": \"specific URL to the exact article, post, or press release — or null if you cannot provide a verified specific URL (never use homepage URLs like reuters.com or linkedin.com; never fabricate)\", \"source_type\": \"X Post|News Article|LinkedIn Post|Press Release|Grok real-time knowledge\", \"verified\": false }],\n  \"recent_news\": [],\n  \"alert_keywords\": [\"kw1\", \"kw2\", \"kw3\"]\n}";
  var p1raw;
  var p1GrokError = null;
  try {
    console.log('[Phase 1] Using: grok-3');
    p1raw = await callGrok(SYS, P1_USER, 8000, false);
  } catch (grokErr) {
    p1GrokError = grokErr.message;
    console.log('[Phase 1] Fallback: claude |', p1GrokError);
    onStep("⚠️ Grok unavailable (" + p1GrokError + "), falling back to Claude...");
    p1raw = await callAPI(SYS, P1_USER, 7000);
    p1raw = '__CLAUDE_FALLBACK__' + p1raw;
  }
  var p1UsedGrok = !p1raw.startsWith('__CLAUDE_FALLBACK__');
  if (!p1UsedGrok) p1raw = p1raw.slice('__CLAUDE_FALLBACK__'.length);
  const p1 = parseJSON(p1raw);
  p1.model_used = p1UsedGrok ? 'grok-3' : 'claude';
  if (p1GrokError) p1.grok_error = p1GrokError;

  // Phase 1c — Tavily verification of unverified intent signals
  if (tKey && Array.isArray(p1.intent_data) && p1.intent_data.length > 0) {
    const needsVerify = p1.intent_data.filter(function(s) {
      var url = s.source_url;
      if (!url || !url.startsWith('http')) return true;
      // reject homepage-only URLs (no meaningful path)
      var path = url.replace(/https?:\/\/(www\.)?[^/]+/, '').replace(/\/$/, '');
      return path.length < 3;
    });
    if (needsVerify.length > 0) {
      onStep("🔍 Verifying " + needsVerify.length + " intent signal source" + (needsVerify.length > 1 ? "s" : "") + "...");
      const verifySearches = needsVerify.slice(0, 5).map(function(s) {
        var keyPhrase = s.signal.split(' ').slice(0, 7).join(' ');
        var yr = (s.date || '').replace(/\D/g, '').slice(0, 4) || '2025';
        return tavilyRaw(company + ' ' + keyPhrase + ' ' + yr, tKey, 3, 730);
      });
      const verifyResults = await Promise.all(verifySearches);
      needsVerify.forEach(function(s, i) {
        var hits = verifyResults[i] || [];
        var best = hits.find(function(h) {
          if (!h.url || !h.url.startsWith('http')) return false;
          var path = h.url.replace(/https?:\/\/(www\.)?[^/]+/, '').replace(/\/$/, '');
          return path.length >= 3;
        });
        if (best) {
          s.source_url = best.url;
          s.source_type = s.source_type === 'Grok real-time knowledge' ? 'News Article' : (s.source_type || 'News Article');
          s.verified = true;
        }
      });
    }
  }

  // Merge contacts
  p1.key_contacts = contacts.length > 0 ? contacts : (p1.key_contacts || []);

  // Phase 1b — News categories (Grok-fast primary, Claude fallback)
  if (rawNews.length > 0) {
    onStep("📰 Categorizing news...");
    try {
      const articleList = rawNews.slice(0, 10).map((r, i) => (i + 1) + ". " + r.title + " (" + (r.published_date || "") + ")\n   " + (r.content || "").slice(0, 180)).join("\n\n");
      var catRaw;
      try { catRaw = await callGrok("Categorize news articles. Output ONLY a JSON array.", "For each article about " + company + ", output: {\"idx\":N, \"category\":\"Funding|Partnership|Product|Regulatory|Leadership|Competitive|Crypto|Other\", \"summary\":\"1 sentence\", \"cp_relevance\":\"why matters for CoinPayments\"}\n\n" + articleList, 2000, true); }
      catch { catRaw = await callAPI("Categorize news articles. Output ONLY a JSON array.", "For each article about " + company + ", output: {\"idx\":N, \"category\":\"Funding|Partnership|Product|Regulatory|Leadership|Competitive|Crypto|Other\", \"summary\":\"1 sentence\", \"cp_relevance\":\"why matters for CoinPayments\"}\n\n" + articleList, 2000); }
      let cs = catRaw.trim().replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      const cats = cs.startsWith("[") ? JSON.parse(cs) : [];
      p1.recent_news = rawNews.slice(0, 10).map((r, i) => {
        const cat = cats.find(c => c.idx === i + 1);
        return { title: r.title, url: r.url, date: r.published_date || "", source: r.url.replace(/https?:\/\/(www\.)?/, "").split("/")[0], category: cat?.category || "Other", summary: cat?.summary || "", cp_relevance: cat?.cp_relevance || "" };
      });
    } catch { p1.recent_news = rawNews.slice(0, 6).map(r => ({ title: r.title, url: r.url, date: r.published_date || "", source: r.url.split("/")[2] || "" })); }
  }

  // Phase 2 — Competitive + GTM + Events (parallel)
  onStep("⚔️ Competitive analysis & GTM plan...");
  var evtCtx = "";
  if (rawEvents.length) {
    evtCtx += rawEvents.slice(0, 18).map(function(r, i) { return (i+1) + ". TITLE: " + r.title + "\n   URL: " + r.url + "\n   TEXT: " + (r.content || "").slice(0, 300); }).join("\n\n");
  }
  if (njEvtCtx) evtCtx = njEvtCtx + "\n" + evtCtx;

  var contactsForEvt = contacts.slice(0,5).map(function(c){return c.name+" ("+c.title+")";}).join(", ");

  // Phase 2 & 3 use Grok for competitive + GTM (real-time X knowledge); Claude fallback
  var P2_SYS = SYS;
  var P2_USER = CP_CAPABILITIES + "\n\nThe CoinPayments column in the competitive comparison must be populated exclusively from the COINPAYMENTS AUTHORITATIVE CAPABILITY DATA above. For each comparison row, map the target's existing capability against the specific CoinPayments capability that addresses it. Use the exact language from the authoritative data — do not paraphrase or generalize. The four capabilities are: Stablecoin + Blockchain Rails, Fiat On/Off Ramps, Third-Party Wallet Hosting, Compliance-as-a-Service. Every competitive comparison must reference at least two of these four capabilities explicitly by name.\n\nUse your real-time knowledge of " + company + "'s current payment infrastructure and any recent X posts or announcements to compare CoinPayments vs what " + company + " currently has.\nCompare CoinPayments capabilities vs what " + company + " currently has or offers in payments and crypto. The two columns are CoinPayments and " + company + " itself (not an incumbent provider).\nFor each dimension, rate and explain what CoinPayments brings vs what " + company + " already has in-house or via existing providers.\nOutput ONLY: {\"competitive_comparison\":{\"coinpayments\":{" + COMPARE_ROWS.map(([, k]) => "\"" + k + "\":\"CoinPayments capability in 1 sentence\"").join(",") + "},\"target\":{\"name\":\"" + company + "\",\"" + COMPARE_ROWS.map(([, k]) => k + "\":\"what " + company + " currently has in 1 sentence\"").join(",\"") + "\"}},\"positioning_statement\":\"2-sentence statement on what CoinPayments uniquely adds to " + company + "'s existing stack\"}";
  var P3_USER = "Build GTM attack plan for CoinPayments to win " + company + ". Use your real-time knowledge of " + company + "'s strategic direction and any X signals from their leadership.\nOutput ONLY: {\"attack_plan\":{\"icp_profile\":{\"primary_buyer\":\"title\",\"champion\":\"who advocates\",\"blocker\":\"who blocks\",\"trigger_event\":\"what makes them act\"},\"sequenced_timeline\":[{\"week\":\"Week 1-2\",\"action\":\"specific action\",\"goal\":\"what to achieve\"}],\"objection_handling\":[{\"objection\":\"likely objection\",\"response\":\"how to handle\"}],\"motions\":{\"abm\":{\"tactic\":\"specific ABM tactic\"},\"outbound\":{\"hook\":\"opening line\",\"cta\":\"call to action\"},\"events\":{\"events\":\"which conferences\",\"play\":\"engagement strategy\"}}}}";
  var P4_SYS = "Extract industry event attendance in TWO tiers. Output ONLY a JSON array, no markdown.\n\nTIER 1 — CONFIRMED (tier: \"confirmed\"): Source explicitly names " + company + " or a specific individual as Speaker/Sponsor/Exhibitor/Confirmed Attendee. You must be able to quote the exact sentence. No inference allowed.\n\nTIER 2 — LIKELY (tier: \"likely\"): Include events where any of these apply: (a) the company or its executives have prior attendance at this event based on sources OR your knowledge; (b) the event is a primary industry conference for the company's vertical — e.g. fintech companies are broadly expected at Money20/20, Consensus, or Fintech Nexus; gaming/crypto companies at Consensus; travel companies at major travel tech summits; (c) a contact's seniority/role suggests they typically attend this type of event. A Tavily source is preferred but NOT required — use your real-time knowledge of which company types attend which conferences. Provide a brief reasoning sentence. Do NOT exclude purely because you lack a source URL.\n\nFor ALL events (both tiers): must have specific event name, specific date, specific location.\nFor CONFIRMED: relevance = Speaker|Sponsor|Exhibitor|Confirmed Attendee. Must include source_post (verbatim quote, max 120 chars) and/or contacts_attending with evidence_quote.\nFor LIKELY: relevance = Likely. Include reasoning (1 sentence). reasoning_url is optional — use a conference website URL or leave empty string.";
  var P4_USER = "Company: " + company + ". Today: " + todayStr + ".\nKey contacts: " + (contactsForEvt || "none") + ".\n\nSOURCES:\n" + evtCtx + "\n\nOutput array of event objects. For CONFIRMED events:\n{\"tier\":\"confirmed\",\"name\":\"event name\",\"date\":\"exact date\",\"location\":\"city, country\",\"relevance\":\"Speaker|Sponsor|Exhibitor|Confirmed Attendee\",\"contacts_attending\":[{\"name\":\"Full Name\",\"role\":\"title\",\"evidence_quote\":\"verbatim sentence (max 140 chars)\",\"evidence_url\":\"url\",\"evidence_platform\":\"X|LinkedIn|Official Event Page|Press Release|News Article\"}],\"source_post\":\"verbatim confirmation quote (max 120 chars)\",\"url\":\"source url\",\"notes\":\"\"}\n\nFor LIKELY events:\n{\"tier\":\"likely\",\"name\":\"event name\",\"date\":\"exact date\",\"location\":\"city, country\",\"relevance\":\"Likely\",\"reasoning\":\"1 sentence explaining why likely e.g. fintech company at primary industry event, or attended in 2024\",\"reasoning_url\":\"conference website url or empty string\",\"contacts_attending\":[],\"source_post\":\"\",\"url\":\"\",\"notes\":\"\"}\n\nAim to include 2-4 LIKELY events even if sources are sparse — use your knowledge of which conferences are standard for this company's vertical and size. If nothing at all qualifies for either tier, output [].";

  function grokOrClaude(sys, user, tokens, fast) {
    return callGrok(sys, user, tokens, fast).catch(function() { return callAPI(sys, user, tokens); });
  }

  const [p2raw, p3raw, p4raw] = await Promise.all([
    grokOrClaude(P2_SYS, P2_USER, 3000, false),
    grokOrClaude(P2_SYS, P3_USER, 3000, false),
    evtCtx ? callAPI(P4_SYS, P4_USER, 2500) : Promise.resolve("[]"),
  ]);

  try { const p2 = parseJSON(p2raw); p1.competitive_comparison = p2.competitive_comparison; p1.positioning_statement = p2.positioning_statement; } catch {}
  try { const p3 = parseJSON(p3raw); p1.attack_plan = p3.attack_plan; } catch {}
  try {
    var evtStr = p4raw.trim().replace(/^```json\s*/i,"").replace(/^```/,"").replace(/```$/,"").trim();
    if (evtStr.startsWith("[")) {
      p1.upcoming_events = JSON.parse(evtStr)
        .filter(function(e) {
          var tier = e.tier || (e.relevance === "Likely" ? "likely" : "confirmed");
          if (tier === "likely") return !!(e.reasoning && e.reasoning.trim());
          // confirmed: need at least a source quote or per-contact evidence
          return (e.source_post && e.source_post.trim()) ||
            (e.contacts_attending && e.contacts_attending.some(function(ca) { return ca.evidence_quote && ca.evidence_quote.trim(); }));
        })
        .slice(0, 10)
        .map(function(e, i) {
          var tier = e.tier || (e.relevance === "Likely" ? "likely" : "confirmed");
          var cas = (e.contacts_attending || []).map(function(ca) {
            if (typeof ca === "string") return { name: ca, role: "", evidence_quote: "", evidence_url: "", evidence_platform: "" };
            return { name: ca.name||"", role: ca.role||"", evidence_quote: ca.evidence_quote||"", evidence_url: ca.evidence_url||"", evidence_platform: ca.evidence_platform||"" };
          }).filter(function(ca) { return ca.name; });
          return {
            id: "evt_" + Date.now() + "_" + i,
            tier: tier,
            name: e.name||"", date: e.date||"", location: e.location||"",
            relevance: e.relevance||(tier==="likely"?"Likely":"Confirmed Attendee"),
            contacts_attending: cas,
            source_post: e.source_post||"",
            reasoning: e.reasoning||"", reasoning_url: e.reasoning_url||"",
            url: e.url||"", notes: e.notes||"", dismissed: false,
          };
        });
    }
  } catch { p1.upcoming_events = []; }

  p1.analyzedAt = new Date().toISOString();
  return p1;
}

// Fast financial-only recalculation (Phase 0a + Phase 1 TAM/SOM/ARR only)
async function runFinancialCalc(company, onStep, keys) {
  const { tavily: tKey } = keys;
  const todayStr = new Date().toDateString();
  var ctx = "";
  if (tKey) {
    onStep("🌐 Fetching scale metrics...");
    var scaleResults = await Promise.all([
      tavilyRaw(company + " active users monthly transactions payment volume AUM 2025 2026", tKey, 6, 180),
      tavilyRaw(company + " revenue annual report 2024 2025", tKey, 4, 180),
    ]);
    var seenU = new Set();
    var items = [];
    for (var batch of scaleResults) {
      for (var r of batch) {
        if (!r.url || seenU.has(r.url)) continue;
        seenU.add(r.url);
        items.push(r.title + ": " + (r.content || "").slice(0, 200));
      }
    }
    if (items.length) ctx = "=== SCALE DATA for " + company + " ===\n" + items.slice(0, 8).join("\n") + "\n=== END ===\n\n";
  }
  onStep("💰 Recalculating financials...");
  const FIN_SYS = 'Output ONLY valid JSON. No markdown. Start with { end with }.\n\nARR METHODOLOGY:\nStep 1: Find real scale metric (active users OR payment volume OR AUM) from context.\nStep 2: Apply vertical crypto penetration (Remittance 12-18%, Neobanks 4-8%, FX & Brokerage 8-15%, Luxury Travel 3-6%, Luxury Goods 2-5%, Gaming 15-25%).\nStep 3: SOM = addressable base × $450/user/year.\nStep 4: projected_arr = SOM × 1.5% (1% early-stage, 2% if exploring crypto). upside_arr = SOM × 3%.\nAlways show full math inline in som_calculation.';
  var raw = await callAPI(FIN_SYS, sanitize(ctx) + "Calculate TAM/SOM/ARR for " + company + ". Today: " + todayStr + ".\nOutput ONLY: {\"tam_som_arr\":{\"tam_usd\":\"$X\",\"scale_metric\":\"X\",\"penetration_rate\":\"X%\",\"addressable_base\":\"X\",\"avg_transaction_value\":\"$450/user/year\",\"som\":\"$X\",\"capture_rate\":\"1.5%\",\"projected_arr\":\"$X\",\"upside_arr\":\"$X\",\"som_calculation\":\"full math string\",\"assumptions\":[]}}", 1200);
  return parseJSON(raw);
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
  { id:"brokerage",    label:"FX & Brokerage",                color:"#F59E0B" },
  { id:"escrow",       label:"Escrow",                        color:"#EC4899" },
  { id:"remittance",   label:"Remittance Fintechs",          color:"#00C2FF" },
  { id:"neobanks",     label:"Neobanks",                      color:"#8B5CF6" },
  { id:"regional_bank",label:"Regional / Middle Market Banks",color:"#10B981" },
];
var CRYPTO_INFRA_PARTNERS = [
  { terms:["coinbase prime"],     name:"Coinbase Prime"    },
  { terms:["coinbase"],           name:"Coinbase Prime"    },
  { terms:["kraken"],             name:"Kraken"            },
  { terms:["fireblocks"],         name:"Fireblocks"        },
  { terms:["paxos"],              name:"Paxos"             },
  { terms:["zero hash","zerohash"],name:"Zero Hash"        },
  { terms:["bakkt"],              name:"Bakkt"             },
  { terms:["bitgo"],              name:"BitGo"             },
  { terms:["anchorage digital"],  name:"Anchorage Digital" },
  { terms:["anchorage"],          name:"Anchorage Digital" },
  { terms:["bitpay"],             name:"BitPay"            },
  { terms:["chainalysis"],        name:"Chainalysis"       },
  { terms:["copper"],             name:"Copper"            },
  { terms:["talos"],              name:"Talos"             },
  { terms:["ledger enterprise"],  name:"Ledger Enterprise" },
  { terms:["blockdaemon"],        name:"Blockdaemon"       },
];
function detectCryptoPartners(analysisData) {
  if (!analysisData) return { cryptoPartners:[], hasCryptoPartner:false };
  var text = [
    analysisData.executive_summary || "",
    JSON.stringify(analysisData.partnerships || []),
    JSON.stringify(analysisData.intent_data || []),
    JSON.stringify(analysisData.competitive_comparison || {}),
    String(analysisData.positioning_statement || ""),
  ].join(" ").toLowerCase();
  var found = []; var seen = {};
  CRYPTO_INFRA_PARTNERS.forEach(function(p) {
    if (seen[p.name]) return;
    for (var i=0; i<p.terms.length; i++) {
      if (text.includes(p.terms[i])) { found.push(p.name); seen[p.name]=true; break; }
    }
  });
  return { cryptoPartners:found, hasCryptoPartner:found.length>0 };
}

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

// Snapshot financials from analysis data — frozen at add time, only updated explicitly
function buildFinancials(tam_som_arr, arr_str, setOnAdd) {
  var t = tam_som_arr || {};
  return {
    tam:           t.tam_usd || "",
    som:           t.som || t.som_usd || "",
    projected_arr: t.projected_arr || t.likely_arr_usd || arr_str || "",
    upside_arr:    t.upside_arr || t.upside_arr_usd || "",
    arr_calculation: t.som_calculation || "",
    lockedAt:      new Date().toISOString(),
    setOnAdd:      setOnAdd !== false,
  };
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
const SORT_KEY_LS = "cp_pipeline_sort";
var OPP_SIZES = [
  { id:"enterprise", label:"🔴 Enterprise",  dotColor:"#EF4444", min:5000000,  max:Infinity },
  { id:"midmarket",  label:"🟠 Mid-Market",   dotColor:"#F97316", min:1000000,  max:5000000  },
  { id:"growth",     label:"🟡 Growth",        dotColor:"#EAB308", min:500000,   max:1000000  },
  { id:"emerging",   label:"🟢 Emerging",      dotColor:"#10B981", min:0,        max:500000   },
];
var VOL_TIERS = [
  { id:"t1vol", label:"Tier 1 Vol: >$1T",       min:1e12 },
  { id:"t2vol", label:"Tier 2 Vol: $100B–$1T",  min:1e11, max:1e12 },
  { id:"t3vol", label:"Tier 3 Vol: $10B–$100B", min:1e10, max:1e11 },
  { id:"t4vol", label:"Tier 4 Vol: <$10B",      min:0,    max:1e10 },
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

var GEO_CENTERS = { AMER: [-95, 40], EMEA: [20, 50], APAC: [105, 35] };
function geoFallbackCoords(geography) {
  var center = GEO_CENTERS[geography] || GEO_CENTERS["AMER"];
  var offset = function() { return (Math.random() - 0.5) * 6; };
  return [center[0] + offset(), center[1] + offset()];
}

var MAP_BUCKET_OPTS = [
  { id:"all",           label:"All Segments",            filterType:"all"      },
  { id:"brokerage",     label:"FX & Brokerage",                filterType:"tier"     },
  { id:"escrow",        label:"Escrow",                        filterType:"tier"     },
  { id:"remittance",    label:"Remittance Fintechs",           filterType:"tier"     },
  { id:"neobanks",      label:"Neobanks",                      filterType:"tier"     },
  { id:"regional_bank", label:"Regional / Middle Market Banks",filterType:"tier"     },
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
      var coords = parseHqCoords(d.analysisData && d.analysisData.hq) || geoFallbackCoords(d.geography||"");
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
  var s13 = useState(null);  var overlayDealId   = s13[0]; var setOverlayDealId   = s13[1];
  var s14 = useState({});    var updateFinStatus = s14[0]; var setUpdateFinStatus = s14[1];
  var s15 = useState({});    var deckStatus      = s15[0]; var setDeckStatus      = s15[1];
  var s16 = useState("all"); var cryptoFilter    = s16[0]; var setCryptoFilter    = s16[1];
  var s17 = useState(function(){ return localStorage.getItem(SORT_KEY_LS)||"az"; }); var sortOrder = s17[0]; var setSortOrder = s17[1];
  var s18 = useState("all"); var oppSizeFilter  = s18[0]; var setOppSizeFilter  = s18[1];
  var s19 = useState("all"); var volTierFilter  = s19[0]; var setVolTierFilter  = s19[1];

  function getBuckets(vid) { return vid==="financial_services" ? FS_SUBVERTS : TIERS; }

  async function buildGammaDeck(deal) {
    var dealId = deal.id;
    var co = deal.company;

    // Phase 1 — Grok independent intelligence (fresh research, no app data bias)
    setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"researching"}); });
    try {
      var grokIntel = await callGrok(
        "You are an expert B2B competitive intelligence analyst. Respond with a single JSON object only — no markdown, no explanation, just the raw JSON.",
        "Research " + co + " and return this exact JSON object:\n" +
        "{\n" +
        "  \"brand_name\": \"the company's commonly used brand or trade name — how they appear in marketing, on their website, and how customers and industry peers refer to them. Do NOT use the full legal entity name. Examples: 'Webull' not 'Webull Financial LLC', 'SoFi' not 'SoFi Technologies Inc', 'Interactive Brokers' not 'Interactive Brokers LLC', 'Trade Republic' not 'Trade Republic Bank GmbH', 'Chime' not 'Chime Financial Inc'. Concise, recognizable, no legal suffixes (LLC, Inc, Ltd, GmbH, Corp, plc). Use this brand_name exclusively throughout the entire deck — title slide, all body slides, and the call to action.\",\n" +
        "  \"business_model\": \"2-3 sentence description of business model, revenue scale, and customer base\",\n" +
        "  \"primary_competitors\": [\"competitor1\", \"competitor2\", \"competitor3\"],\n" +
        "  \"competitor_crypto_status\": \"what their 2-3 primary competitors are doing with crypto payments right now — be specific with names and product names\",\n" +
        "  \"company_crypto_status\": \"where " + co + " currently stands on crypto relative to peers — behind/at parity/ahead and specifically why\",\n" +
        "  \"competitive_gap\": \"the specific gap between " + co + " and where competitors are heading with crypto in the next 12-24 months\",\n" +
        "  \"urgency_reason\": \"the single most compelling reason " + co + " needs to act now — market shift, regulatory deadline, or competitor move\",\n" +
        "  \"cost_of_inaction\": \"specific cost of falling behind — estimated market share lost, customer churn risk, revenue at risk, name which competitors will capture it\"\n" +
        "}\n\nUse your full knowledge of " + co + ". Be specific with real names, products, and figures.",
        2000, true
      );

      var intelData = {};
      try {
        var intelText = typeof grokIntel === "string" ? grokIntel : JSON.stringify(grokIntel);
        var jsonMatch = intelText.match(/\{[\s\S]*\}/);
        if (jsonMatch) intelData = JSON.parse(jsonMatch[0]);
      } catch(parseErr) { intelData = { raw: typeof grokIntel === "string" ? grokIntel : "" }; }

      // Use Grok's formally-researched company name for all deck-facing content
      co = intelData.brand_name || intelData.formal_name || intelData.full_name || co;

      // Phase 2 — Combine Grok intel + app analysis → final deck narrative
      setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"building"}); });

      var ad = deal.analysisData || {};
      var fin = deal.financials || {};
      var contacts = (ad.key_contacts||[]).slice(0,5).map(function(c){ return c.name + " (" + c.title + ")" + (c.linkedin?" — "+c.linkedin:""); }).join("\n");
      var intentions = (ad.intent_data||[]).slice(0,4).map(function(s){ return "- " + s.signal + " (" + (s.date||"") + ")"; }).join("\n");
      var partnerList = (ad.partnerships||[]).slice(0,3).join(", ");
      var competitorNames = Array.isArray(intelData.primary_competitors) ? intelData.primary_competitors.join(", ") : "";

      var deckPrompt = await callGrok(
        "You are a senior B2B sales strategist writing boardroom-ready pitch decks. Every word is from the prospect's perspective — they are the hero, CoinPayments eliminates the need for them to build or maintain their own blockchain infrastructure. Name competitors explicitly. Every claim is backed by a specific number or fact. Never use generic crypto talking points — every sentence must be grounded in this company's specific situation.",
        "Write a 4-slide executive pitch deck presented TO " + co + "'s leadership. " + co + " is the hero — every slide speaks to their outcomes and competitive position. CoinPayments is the enabling partner that eliminates the need for " + co + " to build or maintain their own blockchain infrastructure. Do not include ROI calculations, fee structures, or financial projections anywhere in the deck.\n\n" +
        "TITLE SLIDE: \"" + co + " \u00d7 CoinPayments \u2014 A Crypto Partnership Opportunity\"\n\n" +
        "=== INDEPENDENT INTELLIGENCE (fresh Grok research) ===\n" +
        "Company formal name: " + co + "\n" +
        "Business model: " + (intelData.business_model || "") + "\n" +
        "Primary competitors: " + competitorNames + "\n" +
        "Competitor crypto status: " + (intelData.competitor_crypto_status || "") + "\n" +
        co + "'s crypto status vs peers: " + (intelData.company_crypto_status || "") + "\n" +
        "Competitive gap: " + (intelData.competitive_gap || "") + "\n" +
        "Urgency: " + (intelData.urgency_reason || "") + "\n" +
        "Cost of inaction: " + (intelData.cost_of_inaction || "") + "\n\n" +
        "=== APP ANALYSIS DATA ===\n" +
        "Segment: " + (ad.segment||deal.vertical||"") + "\n" +
        "HQ: " + (ad.hq||deal.geography||"") + "\n" +
        "Executive Summary: " + (ad.executive_summary||"") + "\n" +
        "Incumbent: " + (ad.incumbent ? ad.incumbent.name + " \u2014 " + ad.incumbent.weaknesses : "none identified") + "\n" +
        "Intent Signals:\n" + (intentions||"none") + "\n" +
        "Key Contacts:\n" + (contacts||"none") + "\n" +
        (partnerList ? "Partnerships: " + partnerList + "\n" : "") +
        "Positioning: " + (ad.positioning_statement||"") + "\n\n" +
        "=== 4-SLIDE NARRATIVE ARC ===\n\n" +
        "Slide 1 \u2014 The Competitive Gap\n" +
        "Open with the specific crypto moves competitors are making right now. Name them explicitly.\n" +
        "- Name the 2-3 primary competitors (" + (competitorNames||"their main rivals") + ") and exactly what crypto capabilities they have launched or announced\n" +
        "- Show " + co + "'s current position relative to those moves\n" +
        "- Frame the gap precisely: '" + co + " is [timeframe] behind [Competitor] in crypto payment capability'\n" +
        "- What customer segments are competitors capturing that " + co + " cannot serve today?\n" +
        "Make the competitive threat visceral with real names and specific product moves.\n\n" +
        "Slide 2 \u2014 " + co + "'s Crypto Opportunity Cost\n" +
        "Translate the competitive gap into real revenue " + co + " is losing right now.\n" +
        "- Use the actual SOM context: '" + co + " processes $X in [volume type] annually. At [Y]% crypto adoption, that is $Z in crypto volume your customers want to transact \u2014 today that goes to [named competitor]'\n" +
        "- Quantify customer churn risk: what % of their customer base is actively seeking crypto capabilities from competitors?\n" +
        "- What does [Competitor]'s crypto feature cost " + co + " in retention and new customer acquisition?\n" +
        "- Frame as revenue already being lost, not hypothetical future revenue\n\n" +
        "Slide 3 \u2014 How " + co + " Closes the Gap With CoinPayments\n" +
        CP_CAPABILITIES + "\n\nFor Slide 3, the CoinPayments solution must be described using only the COINPAYMENTS AUTHORITATIVE CAPABILITY DATA above. Select the 2-3 capabilities most relevant to " + co + "'s specific gaps, describe them using the exact capability names and core descriptions from the authoritative data, then add the bespoke application paragraph for " + co + " after each capability description. Do not paraphrase or invent alternative capability descriptions.\n\n" +
        "Do NOT list CoinPayments' capabilities generically. Instead, conduct a nuanced analysis of how CoinPayments' infrastructure stack specifically solves " + co + "'s unique situation. Work through this in three steps:\n\n" +
        "STEP 1 \u2014 Diagnose " + co + "'s specific infrastructure gaps:\n" +
        "Based on the intelligence and analysis data above, think carefully about:\n" +
        "- What does " + co + "'s current payment and settlement infrastructure actually look like?\n" +
        "- Where are their specific friction points \u2014 settlement speed, FX costs, custody complexity, compliance overhead, cross-border reach, or customer-facing crypto UX?\n" +
        "- Which of their business lines or geographies are most constrained by current infrastructure?\n" +
        "- What are their customers asking for that they cannot currently deliver?\n\n" +
        "STEP 2 \u2014 Select 2-3 of these four CoinPayments capabilities that are most relevant to " + co + "'s specific situation (do not include all four if they are not all relevant):\n" +
        "  A. Stablecoin + Blockchain Rails: 24/7 instant settlement bypassing correspondent banks, automated FX with zero pre-funding, fractions of a cent per transaction\n" +
        "  B. Fiat On/Off Ramps: white-label local fiat \u2194 stablecoin/crypto \u2194 local fiat in a single UX, bank/card/cash integration via regulated partners\n" +
        "  C. Third-Party Wallet Hosting: white-label MPC custody, insured cold/hot storage, automated reconciliation, audit-ready reporting, fully outsourced key management, 40+ digital assets\n" +
        "  D. Compliance-as-a-Service: turnkey expansion across 180+ licensed jurisdictions, 40+ digital assets, AML/KYC, audit trails, policy engines included\n\n" +
        "For each selected capability, write a bespoke application paragraph that:\n" +
        "- Names the specific pain point at " + co + " it solves\n" +
        "- Explains mechanically how CoinPayments solves it for their specific business model\n" +
        "- Quantifies the impact where possible (cost reduction, speed improvement, market expansion)\n" +
        "- References their specific scale, geography, customer base, or competitive context\n\n" +
        "Example of what NOT to write: 'CoinPayments offers 24/7 instant settlement bypassing correspondent banks.'\n" +
        "Example of what TO write: 'For " + co + "'s [specific corridor or business line], stablecoin rails eliminate the [X]-day SWIFT delays and [Y]% FX spread that currently erode margins on [their specific transaction type]. Settlement becomes instant and the cost drops to fractions of a cent \u2014 without changing " + co + "'s customer-facing UX or requiring new banking relationships.'\n\n" +
        "STEP 3 \u2014 Write the capability section as a narrative, not a bullet list:\n" +
        "Frame the selected capabilities as a coherent story of transformation for " + co + ":\n" +
        "- What does " + co + "'s world look like before CoinPayments?\n" +
        "- What changes immediately after integration?\n" +
        "- What becomes possible in 12-24 months that is not possible today?\n" +
        "- What competitive position does " + co + " hold after deployment?\n\n" +
        "The output for Slide 3 should read like it was written by a senior solutions architect who spent a week studying " + co + "'s business \u2014 not a sales template with the company name swapped in. Every sentence must be defensible in a boardroom. If you are not confident about a specific claim, write 'based on " + co + "'s reported [X]' rather than fabricating precision.\n\n" +
        "Slide 4 \u2014 " + co + "'s Path to Implementation\n" +
        co + " gets access to CoinPayments' entire API-driven infrastructure stack without building or maintaining any blockchain infrastructure. Make implementation feel fast, low-risk, and within " + co + "'s control:\n" +
        "- Phase 1: [the highest-priority capability from your Slide 3 analysis] \u2014 live in 4-8 weeks\n" +
        "- Phase 2: [second capability expansion tied to their platform] \u2014 weeks 9-16\n" +
        "- Phase 3: [full stack deployment including remaining capabilities] \u2014 month 4 onward\n" +
        "- '" + co + " starts with one capability and expands on their own timeline \u2014 no big-bang migration, no blockchain infrastructure investment'\n" +
        "- '" + co + " operates across 180+ licensed jurisdictions from day one \u2014 zero compliance build required'\n" +
        "Close with a direct CTA to the specific named contacts from the analysis:\n" +
        (contacts
          ? "- 'Ready to close the gap on " + (competitorNames.split(",")[0]||"competitors") + "? Let\u2019s schedule a 30-minute technical walkthrough with " + contacts.split("\n").slice(0,2).map(function(c){ return c.split("(")[0].trim(); }).join(" and ") + " and the engineering team.'\n"
          : "- 'Ready to close the gap? Let\u2019s schedule a 30-minute technical walkthrough with your payments and engineering teams.'\n") +
        "\n" +
        "TONE GUIDANCE FOR THE ENTIRE DECK:\n" +
        "- Speak to " + co + "'s executives as peers, not as prospects \u2014 they are sophisticated operators who have built something real\n" +
        "- Acknowledge what they have already built \u2014 position crypto infrastructure as the next logical evolution of what they are doing, not a radical departure\n" +
        "- CoinPayments is a partner in their growth, not a vendor selling a product\n" +
        "- " + co + " is the hero. Name competitors explicitly. Every claim grounded in the data above \u2014 no generic crypto talking points\n" +
        "- The deck should feel like it came from someone who deeply respects " + co + "'s business and genuinely wants them to win\n" +
        "- 4 slides \u2014 no more. No ROI calculations, no fee structures, no financial projections. Format for dark professional theme \u2014 minimal, high-contrast.",
        8000, false
      );

      // Phase 3 — Start Gamma generation (fire and return generationId immediately)
      setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"starting"}); });
      var startRes = await fetch("/api/gamma-start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: deckPrompt, title: co + " \u00d7 CoinPayments \u2014 A Crypto Partnership Opportunity" }),
      });
      var startData = await startRes.json();
      if (!startRes.ok || startData.error) throw new Error(startData.error || "Gamma start failed " + startRes.status);
      var generationId = startData.generationId;
      if (!generationId) throw new Error("Gamma did not return a generation ID. Response: " + JSON.stringify(startData).slice(0, 200));

      setDeals(function(prev){ return prev.map(function(d){ return d.id===dealId ? Object.assign({},d,{gammaGenerationId:generationId}) : d; }); });
      setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"polling:0"}); });

      // Phase 4 — Client-side poll every 5s (avoids Vercel timeout)
      async function doPoll(attempt) {
        if (attempt > 30) {
          setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"timeout"}); });
          return;
        }
        await new Promise(function(r){ setTimeout(r, 5000); });
        try {
          var pr = await fetch("/api/gamma-status?id=" + encodeURIComponent(generationId));
          var pd = await pr.json();
          if (!pr.ok) throw new Error(pd.error || "Poll error " + pr.status);
          if (pd.status === "completed" && pd.url) {
            // Attempt dark theme application (non-fatal if it fails)
            try {
              await fetch("/api/gamma-theme", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ generationId: generationId }),
              });
            } catch(themeErr) { /* non-fatal */ }
            setDeals(function(prev){ return prev.map(function(d){ return d.id===dealId ? Object.assign({},d,{gammaDeckUrl:pd.url,gammaGenerationId:null}) : d; }); });
            setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"done"}); });
          } else if (pd.status === "failed") {
            setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"error:" + (pd.error||"Gamma generation failed")}); });
          } else {
            setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"polling:" + attempt}); });
            doPoll(attempt + 1);
          }
        } catch(pollErr) {
          setDeckStatus(function(p){ return Object.assign({},p,{[dealId]:"error:" + pollErr.message.slice(0,80)}); });
        }
      }
      doPoll(1);

    } catch(e) {
      setDeckStatus(function(p){ return Object.assign({},p,{[deal.id]:"error:" + e.message.slice(0,80)}); });
    }
  }

  function addDeal() {
    if (!form.company.trim()) return;
    var d = { id:Date.now(), company:form.company.trim(), arr:form.arr.trim(), stage:form.stage, vertical:form.vertical, tier:form.tier||"", priority:form.priority||"p1", geography:form.geography||"", notes:form.notes.trim(), addedAt:new Date().toISOString(), financials:buildFinancials(null, form.arr.trim(), true) };
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
      var freshGeo = detectGeo(data.hq||"") || deal.geography || "";
      var t = (data && data.tam_som_arr) || {};
      var freshArr = t.projected_arr || t.likely_arr_usd || deal.arr;
      var freshFin = buildFinancials(t, freshArr, false);
      freshFin.updatedByRerun = true;
      var freshCp = detectCryptoPartners(data);
      setDeals(function(prev){ return prev.map(function(d){
        if (d.id!==deal.id) return d;
        return Object.assign({},d,{ analysisData:data, geography:freshGeo, notes:(data.executive_summary||"").slice(0,120), financials:freshFin, arr:freshArr, cryptoPartners:freshCp.cryptoPartners, hasCryptoPartner:freshCp.hasCryptoPartner });
      }); });
      setRerunStatus(function(prev){ var n=Object.assign({},prev); delete n[deal.id]; return n; });
    }).catch(function(err) {
      setRerunStatus(function(prev){ return Object.assign({},prev,{[deal.id]:"Error: "+err.message}); });
      setTimeout(function(){ setRerunStatus(function(prev){ var n=Object.assign({},prev); delete n[deal.id]; return n; }); }, 4000);
    });
  }
  function updateFinancials(deal) {
    if (!window.confirm("This will update the frozen ARR, SOM and TAM figures for " + deal.company + ". Are you sure?")) return;
    setUpdateFinStatus(function(prev){ return Object.assign({},prev,{[deal.id]:"Fetching..."}); });
    runFinancialCalc(deal.company, function(step){
      setUpdateFinStatus(function(prev){ return Object.assign({},prev,{[deal.id]:step}); });
    }, { tavily:tKey||"" }).then(function(data) {
      var t = (data && data.tam_som_arr) || {};
      var freshArr = t.projected_arr || t.likely_arr_usd || deal.arr;
      var freshTam = t.tam_usd || deal.tam || "";
      var newFin = buildFinancials(t, freshArr, false);
      setDeals(function(prev){ return prev.map(function(d){
        if (d.id!==deal.id) return d;
        return Object.assign({},d,{ financials:newFin, arr:freshArr, tam:freshTam });
      }); });
      setUpdateFinStatus(function(prev){ var n=Object.assign({},prev); delete n[deal.id]; return n; });
    }).catch(function(err) {
      setUpdateFinStatus(function(prev){ return Object.assign({},prev,{[deal.id]:"Error: "+err.message}); });
      setTimeout(function(){ setUpdateFinStatus(function(prev){ var n=Object.assign({},prev); delete n[deal.id]; return n; }); }, 4000);
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
    var arr = (h.data.tam_som_arr&&(h.data.tam_som_arr.projected_arr||h.data.tam_som_arr.likely_arr_usd))||"";
    var tam = (h.data.tam_som_arr&&h.data.tam_som_arr.tam_usd)||"";
    var geo = detectGeo(h.data.hq||"");
    var autoTier = (pipeView.tier&&pipeView.tier!=="all") ? pipeView.tier : "";
    var hCp = detectCryptoPartners(h.data);
    var d = { id:Date.now(), company:h.company, arr:arr, tam:tam, geography:geo, stage:"prospecting", vertical:vert, tier:autoTier, priority:"p1", notes:(h.data.executive_summary||"").slice(0,120), analysisData:h.data, addedAt:h.analyzedAt, financials:buildFinancials(h.data.tam_som_arr, arr, true), cryptoPartners:hCp.cryptoPartners, hasCryptoPartner:hCp.hasCryptoPartner };
    setDeals(function(prev){ return prev.concat([d]); });
  }

  // Metrics helpers
  function getDealTam(d) {
    if (d.tam) return parseArr(String(d.tam));
    if (!d.analysisData || !d.analysisData.tam_som_arr) return 0;
    var t = d.analysisData.tam_som_arr.tam_usd || d.analysisData.tam_som_arr.tam;
    return t ? parseArr(String(t)) : 0;
  }
  function getDealVolume(d) {
    var s = (d.financials&&d.financials.som)||(d.analysisData&&d.analysisData.tam_som_arr&&(d.analysisData.tam_som_arr.som||d.analysisData.tam_som_arr.som_usd))||"";
    return parseArr(String(s));
  }
  function getDealOppSize(d) {
    var av = parseArr(d.arr||"0");
    if (av>=5000000) return "enterprise";
    if (av>=1000000) return "midmarket";
    if (av>=500000)  return "growth";
    return "emerging";
  }
  function sortDeals(arr, order) {
    return arr.slice().sort(function(a,b){
      if (order==="za")       return b.company.localeCompare(a.company);
      if (order==="arr_high") return parseArr(b.arr||"0")-parseArr(a.arr||"0");
      if (order==="arr_low")  return parseArr(a.arr||"0")-parseArr(b.arr||"0");
      if (order==="vol_high") return getDealVolume(b)-getDealVolume(a);
      if (order==="vol_low")  return getDealVolume(a)-getDealVolume(b);
      if (order==="recent")   return new Date(b.addedAt||0)-new Date(a.addedAt||0);
      if (order==="priority"){ var pa=(a.priority||"p1")==="p1"?0:1,pb=(b.priority||"p1")==="p1"?0:1; return pa-pb||a.company.localeCompare(b.company); }
      if (order==="stage"){    var si=PIPE_STAGES.findIndex(function(s){return s.id===a.stage;}),sj=PIPE_STAGES.findIndex(function(s){return s.id===b.stage;}); return si-sj||a.company.localeCompare(b.company); }
      return a.company.localeCompare(b.company);
    });
  }
  function applyCryptoFilter(arr, cp) {
    if (!cp || cp==="all") return arr;
    if (cp==="partnered")  return arr.filter(function(d){ return !!d.hasCryptoPartner; });
    if (cp==="greenfield") return arr.filter(function(d){ return !d.hasCryptoPartner; });
    return arr;
  }
  function calcTamStats(dealList) {
    var vals = dealList.map(getDealTam).filter(function(v){ return v>0; });
    if (!vals.length) return { avgTam:0 };
    return { avgTam: vals.reduce(function(s,v){ return s+v; }, 0) / vals.length };
  }
  function vMetrics(vid, geo, cp) {
    var vd = deals.filter(function(d){ return d.vertical===vid; });
    if (geo && geo!=="all") vd = vd.filter(function(d){ return (d.geography||"")===geo; });
    vd = applyCryptoFilter(vd, cp);
    var wa = vd.filter(function(d){ return d.arr; });
    var tot = wa.reduce(function(s,d){ return s+parseArr(d.arr); }, 0);
    var sumTam = tMetrics(vid, "all", null, geo, cp).avgTam;
    return { total:vd.length, avgArr:wa.length?tot/wa.length:0, totalArr:tot, avgTam:sumTam, won:vd.filter(function(d){return d.stage==="closed_won";}).length, p1:vd.filter(function(d){return (d.priority||"p1")==="p1";}).length, p2:vd.filter(function(d){return d.priority==="p2";}).length };
  }
  function tMetrics(vid, tid, prio, geo, cp) {
    var vd = deals.filter(function(d){ return d.vertical===vid; });
    var td = tid==="all" ? vd : vd.filter(function(d){ return (d.tier||"")===tid; });
    if (prio && prio!=="all") td = td.filter(function(d){ return (d.priority||"p1")===prio; });
    if (geo && geo!=="all") td = td.filter(function(d){ return (d.geography||"")===geo; });
    td = applyCryptoFilter(td, cp);
    var wa = td.filter(function(d){ return d.arr; });
    var tot = wa.reduce(function(s,d){ return s+parseArr(d.arr); }, 0);
    var ts = calcTamStats(td);
    var meanTam = tid === "all"
      ? (vid === "financial_services"
          ? FS_SUBVERTS.reduce(function(s, sv) { return s + tMetrics(vid, sv.id, prio, geo, cp).avgTam; }, 0)
          : td.map(getDealTam).filter(function(v){ return v>0; }).reduce(function(s,v){ return s+v; }, 0))
      : ts.avgTam;
    if (tid === 'neobanks'      && meanTam < 1e12) meanTam = 9e12;
    if (tid === 'remittance'    && meanTam < 1e12) meanTam = 10e12;
    if (tid === 'escrow'        && meanTam < 5e11) meanTam = 1e12;
    if (tid === 'regional_bank' && meanTam < 1e12) meanTam = 5e12;
    return { total:td.length, avgArr:wa.length?tot/wa.length:0, totalArr:tot, avgTam:meanTam, p1:td.filter(function(d){return (d.priority||"p1")==="p1";}).length, p2:td.filter(function(d){return d.priority==="p2";}).length };
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
  var tierDeals = sortDeals(baseTierDeals.filter(function(d){
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
    if (cryptoFilter==="partnered"  && !d.hasCryptoPartner) return false;
    if (cryptoFilter==="greenfield" &&  d.hasCryptoPartner) return false;
    if (oppSizeFilter!=="all") {
      var oa = parseArr(d.arr||"0");
      if (oppSizeFilter==="enterprise" && oa<5000000) return false;
      if (oppSizeFilter==="midmarket"  && (oa<1000000||oa>=5000000)) return false;
      if (oppSizeFilter==="growth"     && (oa<500000||oa>=1000000)) return false;
      if (oppSizeFilter==="emerging"   && oa>=500000) return false;
    }
    if (volTierFilter!=="all") {
      var vv = getDealVolume(d);
      if (volTierFilter==="t1vol" && vv<1e12) return false;
      if (volTierFilter==="t2vol" && (vv<1e11||vv>=1e12)) return false;
      if (volTierFilter==="t3vol" && (vv<1e10||vv>=1e11)) return false;
      if (volTierFilter==="t4vol" && vv>=1e10) return false;
    }
    return true;
  }), sortOrder);

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
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:4 }}>{vert.id==="financial_services"?"SEGMENT":"TIER"}</div>
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
          <button onClick={function(){ setOverlayAnalysis(null); setOverlayDealId(null); }}
            style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:7, padding:"6px 14px", fontSize:11, cursor:"pointer", fontFamily:"inherit", marginBottom:16 }}>
            ← Back to Pipeline
          </button>
          <AnalysisView data={overlayAnalysis} onEventsUpdate={overlayDealId ? function(events) {
            setDeals(function(prev){ return prev.map(function(d){ return d.id===overlayDealId ? Object.assign({},d,{ analysisData: Object.assign({},d.analysisData,{ upcoming_events: events }) }) : d; }); });
          } : null}/>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN DASHBOARD — vertical === null
      ══════════════════════════════════════════════════════════════════════ */}
      {!pipeView.vertical && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
            <div style={{ color:C.text, fontSize:18, fontWeight:900 }}>Pipeline Dashboard</div>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
              {GEO_OPTS.map(function(o){
                var active = geoFilter===o.id;
                return <button key={o.id} onClick={function(){ setGeoFilter(o.id); }}
                  style={{ background:active?C.accent:C.surface, color:active?"#000":C.muted, border:"1px solid "+(active?C.accent:C.border), borderRadius:5, padding:"4px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit", fontWeight:active?700:400 }}>
                  {o.label}
                </button>;
              })}
              {[{id:"all",label:"All Partners"},{id:"partnered",label:"🔗 Partnered"},{id:"greenfield",label:"⬜ Greenfield"}].map(function(o){
                var active = cryptoFilter===o.id;
                return <button key={o.id} onClick={function(){ setCryptoFilter(o.id); }}
                  style={{ background:active?(o.id==="partnered"?C.green:C.surface):C.surface, color:active?(o.id==="partnered"?"#000":C.green):C.muted, border:"1px solid "+(active?C.green:C.border), borderRadius:5, padding:"4px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit", fontWeight:active?700:400 }}>
                  {o.label}
                </button>;
              })}
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:10, marginBottom:16 }}>
            {VERTICALS.map(function(v) {
              var m = vMetrics(v.id, geoFilter, cryptoFilter);
              return (
                <div key={v.id} onClick={function(){ setPipeView({vertical:v.id,tier:null}); }}
                  style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"14px 16px", cursor:"pointer", transition:"border-color 0.15s" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:12 }}>
                    <span style={{ fontSize:20 }}>{v.icon}</span>
                    <span style={{ color:C.muted, fontWeight:700, fontSize:11 }}>{v.label}</span>
                  </div>
                  <div style={{ color:v.color, fontSize:26, fontWeight:900, marginBottom:2 }}>{m.total?fmtMoney(m.totalArr):"—"}</div>
                  <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Total ARR</div>
                  {m.avgTam > 0 && <div style={{ marginBottom:6 }}>
                    <div style={{ color:C.gold, fontSize:10, fontWeight:700, lineHeight:1.6 }}>TAM {fmtMoney(m.avgTam)}</div>
                    <div style={{ color:C.cyan, fontSize:10, fontWeight:700, lineHeight:1.6 }}>Crypto SAM {fmtMoney(m.avgTam*0.125)}</div>
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
          {deals.length > 0 && (function() {
            var totalDeals = deals.length;
            var totalArr = deals.reduce(function(s,d){ return s+parseArr(d.arr||""); }, 0);
            return (
              <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"14px 16px", marginBottom:16 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                  <div style={{ color:C.muted, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>Sales Funnel — All Verticals</div>
                  <div style={{ display:"flex", gap:16 }}>
                    <div><span style={{ color:C.dim, fontSize:10 }}>Accounts: </span><span style={{ color:C.text, fontWeight:700, fontSize:12 }}>{totalDeals}</span></div>
                    <div><span style={{ color:C.dim, fontSize:10 }}>Pipeline ARR: </span><span style={{ color:C.accent, fontWeight:700, fontSize:12 }}>{fmtMoney(totalArr)}</span></div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:3, alignItems:"stretch" }}>
                  {PIPE_STAGES.map(function(stage) {
                    var cnt = deals.filter(function(d){ return d.stage===stage.id; }).length;
                    var stageArr = deals.filter(function(d){ return d.stage===stage.id; }).reduce(function(s,d){ return s+parseArr(d.arr||""); }, 0);
                    var pct = totalDeals ? Math.round(cnt/totalDeals*100) : 0;
                    var isActive = stageFilter===stage.id;
                    return (
                      <div key={stage.id} onClick={function(){ setStageFilter(isActive?"all":stage.id); }}
                        title={stage.label + " — click to filter deal cards"}
                        style={{ flex:"1 1 0", minWidth:0, cursor:"pointer", background:isActive?stage.color+"28":"transparent", border:"1px solid "+(isActive?stage.color:C.border), borderRadius:6, padding:"8px 5px", textAlign:"center", transition:"all 0.15s", position:"relative" }}>
                        <div style={{ color:isActive?stage.color:C.text, fontSize:20, fontWeight:900, lineHeight:1 }}>{cnt}</div>
                        <div style={{ color:isActive?stage.color:C.dim, fontSize:8, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.04em", margin:"4px 0 2px", lineHeight:1.2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{stage.label}</div>
                        <div style={{ color:C.muted, fontSize:9 }}>{pct}%</div>
                        {stageArr>0 && <div style={{ color:C.accent, fontSize:8, marginTop:3, fontWeight:600 }}>{fmtMoney(stageArr)}</div>}
                        {isActive && <div style={{ position:"absolute", bottom:0, left:0, right:0, height:2, background:stage.color, borderRadius:"0 0 5px 5px" }}/>}
                      </div>
                    );
                  })}
                </div>
                {stageFilter!=="all" && (function(){
                  var sf = PIPE_STAGES.find(function(s){ return s.id===stageFilter; });
                  return sf ? (
                    <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ color:C.dim, fontSize:10 }}>Filtering by stage:</span>
                      <span style={{ color:sf.color, fontWeight:700, fontSize:10 }}>{sf.label}</span>
                      <button onClick={function(){ setStageFilter("all"); }} style={{ background:"transparent", border:"none", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", padding:"0 2px", lineHeight:1 }}>✕</button>
                    </div>
                  ) : null;
                })()}
              </div>
            );
          })()}
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

          {/* Tier/sub-vert cards — FS uses fixed order; other verticals sorted by ARR */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))", gap:10, marginBottom:20 }}>
            {(function(){
              var FS_ORDER = ["brokerage","escrow","remittance","neobanks","regional_bank"];
              var buckets = getBuckets(pipeView.vertical);
              var ordered = pipeView.vertical==="financial_services"
                ? FS_ORDER.map(function(id){ return buckets.find(function(b){ return b.id===id; }); }).filter(Boolean)
                : buckets.slice().sort(function(a,b){ return tMetrics(pipeView.vertical,b.id,prioFilter,geoFilter,cryptoFilter).totalArr - tMetrics(pipeView.vertical,a.id,prioFilter,geoFilter,cryptoFilter).totalArr; });
              return [{id:"all",label:"All",color:C.green}].concat(ordered);
            })().map(function(t) {
              var m = tMetrics(pipeView.vertical, t.id, prioFilter, geoFilter, cryptoFilter);
              return (
                <div key={t.id} onClick={function(){ setPipeView({vertical:pipeView.vertical,tier:t.id}); setShowAdd(false); }}
                  style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"14px 16px", cursor:"pointer" }}>
                  <div style={{ color:t.color, fontWeight:800, fontSize:13, marginBottom:10 }}>{t.label}</div>
                  <div style={{ color:t.color, fontSize:22, fontWeight:900, marginBottom:2 }}>{m.total?fmtMoney(m.totalArr):"—"}</div>
                  <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:3 }}>Total ARR</div>
                  {m.avgTam > 0 && <div style={{ marginBottom:6 }}>
                    <div style={{ color:C.gold, fontSize:10, fontWeight:700, lineHeight:1.6 }}>TAM {fmtMoney(m.avgTam)}</div>
                    <div style={{ color:C.cyan, fontSize:10, fontWeight:700, lineHeight:1.6 }}>Crypto SAM {fmtMoney(m.avgTam*0.125)}</div>
                  </div>}
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginTop: m.avgTam > 0 ? 0 : 6 }}>
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
            <button onClick={function(){ setPipeView({vertical:pipeView.vertical,tier:null}); setShowAdd(false); setDealSearch(""); setStageFilter("all"); setArrFilter("all"); setPrioFilter("all"); setGeoFilter("all"); setCryptoFilter("all"); setOppSizeFilter("all"); setVolTierFilter("all"); }}
              style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:7, padding:"5px 12px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>← Back</button>
            <span style={{ fontSize:16 }}>{activeVert.icon}</span>
            <span style={{ color:activeVert.color, fontWeight:700, fontSize:14 }}>{activeVert.label}</span>
            <span style={{ color:C.dim, fontSize:13 }}>›</span>
            <span style={{ color:activeTier?activeTier.color:C.green, fontWeight:800, fontSize:16 }}>{activeTier?activeTier.label:"All"}</span>
            <span style={{ color:C.dim, fontSize:11 }}>
              {(dealSearch||stageFilter!=="all"||prioFilter!=="all"||arrFilter!=="all"||geoFilter!=="all"||cryptoFilter!=="all"||oppSizeFilter!=="all"||volTierFilter!=="all")
                ? "(Showing "+tierDeals.length+" of "+baseTierDeals.length+")"
                : "("+baseTierDeals.length+")"}
            </span>
          </div>

          {/* Search + filter bar */}
          <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap", alignItems:"center" }}>
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
            <select value={oppSizeFilter} onChange={function(e){ setOppSizeFilter(e.target.value); }}
              style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
              <option value="all">All Sizes</option>
              {OPP_SIZES.map(function(o){ return <option key={o.id} value={o.id}>{o.label}</option>; })}
            </select>
            {pipeView.tier==="brokerage" && (
              <select value={volTierFilter} onChange={function(e){ setVolTierFilter(e.target.value); }}
                style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
                <option value="all">All Volumes</option>
                {VOL_TIERS.map(function(v){ return <option key={v.id} value={v.id}>{v.label}</option>; })}
              </select>
            )}
            <select value={geoFilter} onChange={function(e){ setGeoFilter(e.target.value); }}
              style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
              {GEO_OPTS.map(function(o){ return <option key={o.id} value={o.id}>{o.label}</option>; })}
            </select>
            <select value={cryptoFilter} onChange={function(e){ setCryptoFilter(e.target.value); }}
              style={{ background:C.surface, border:"1px solid "+(cryptoFilter!=="all"?C.green:C.border), borderRadius:6, padding:"6px 10px", color:cryptoFilter!=="all"?C.green:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
              <option value="all">All Partners</option>
              <option value="partnered">🔗 Crypto-Partnered</option>
              <option value="greenfield">⬜ Greenfield</option>
            </select>
            <select value={sortOrder} onChange={function(e){ var v=e.target.value; setSortOrder(v); localStorage.setItem(SORT_KEY_LS,v); }}
              style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
              <option value="az">A–Z</option>
              <option value="za">Z–A</option>
              <option value="arr_high">ARR: High → Low</option>
              <option value="arr_low">ARR: Low → High</option>
              <option value="vol_high">Volume: High → Low</option>
              <option value="vol_low">Volume: Low → High</option>
              <option value="recent">Recently Added</option>
              <option value="priority">Priority (P1 first)</option>
              <option value="stage">Stage</option>
            </select>
          </div>

          {/* Active filter summary bar */}
          {(function(){
            var chips = [];
            if (prioFilter!=="all") chips.push({ label:prioFilter==="p1"?"Priority 1":"Priority 2", clear:function(){setPrioFilter("all");} });
            if (stageFilter!=="all"){ var sf=PIPE_STAGES.find(function(s){return s.id===stageFilter;}); chips.push({ label:sf?sf.label:stageFilter, clear:function(){setStageFilter("all");} }); }
            if (arrFilter!=="all")  chips.push({ label:arrFilter==="under1m"?"ARR <$1M":arrFilter==="1m_2m"?"ARR $1M–$2M":"ARR >$2M", clear:function(){setArrFilter("all");} });
            if (oppSizeFilter!=="all"){ var os=OPP_SIZES.find(function(o){return o.id===oppSizeFilter;}); chips.push({ label:os?os.label:oppSizeFilter, clear:function(){setOppSizeFilter("all");} }); }
            if (volTierFilter!=="all"){ var vt=VOL_TIERS.find(function(v){return v.id===volTierFilter;}); chips.push({ label:vt?vt.label:volTierFilter, clear:function(){setVolTierFilter("all");} }); }
            if (geoFilter!=="all")  chips.push({ label:geoFilter, clear:function(){setGeoFilter("all");} });
            if (cryptoFilter!=="all") chips.push({ label:cryptoFilter==="partnered"?"🔗 Partnered":"⬜ Greenfield", clear:function(){setCryptoFilter("all");} });
            if (dealSearch)         chips.push({ label:"\""+dealSearch+"\"", clear:function(){setDealSearch("");} });
            if (!chips.length) return null;
            var filteredArr = tierDeals.reduce(function(s,d){ return s+parseArr(d.arr||"0"); },0);
            return (
              <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"5px 10px", marginBottom:10, display:"flex", alignItems:"center", gap:5, flexWrap:"wrap", fontSize:10 }}>
                <span style={{ color:C.dim, fontWeight:700, flexShrink:0 }}>Showing:</span>
                {chips.map(function(chip,i){
                  return <span key={i} style={{ background:C.card, border:"1px solid "+C.border, borderRadius:20, padding:"2px 6px 2px 8px", color:C.text, display:"inline-flex", alignItems:"center", gap:3 }}>
                    {chip.label}
                    <button onClick={chip.clear} style={{ background:"none", border:"none", color:C.dim, cursor:"pointer", padding:"0 0 0 1px", lineHeight:1, fontSize:12, fontFamily:"inherit" }}>×</button>
                  </span>;
                })}
                <span style={{ color:C.muted, marginLeft:"auto", flexShrink:0 }}>{tierDeals.length} account{tierDeals.length!==1?"s":""} · {fmtMoney(filteredArr)} ARR</span>
                <button onClick={function(){ setDealSearch(""); setStageFilter("all"); setPrioFilter("all"); setArrFilter("all"); setGeoFilter("all"); setCryptoFilter("all"); setOppSizeFilter("all"); setVolTierFilter("all"); }}
                  style={{ background:"transparent", border:"none", color:C.gold, cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:"inherit", flexShrink:0 }}>Clear All ×</button>
              </div>
            );
          })()}

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
                  <div key={stage.id} style={{ marginBottom:24 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6, padding:"0 2px" }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:stage.color, flexShrink:0 }}/>
                      <span style={{ color:stage.color, fontWeight:800, fontSize:14, letterSpacing:"-0.01em" }}>{stage.label}</span>
                      <span style={{ color:C.muted, fontWeight:600, fontSize:12 }}>({stageDeals.length})</span>
                      {stageDeals.some(function(d){return d.financials?d.financials.projected_arr:d.arr;}) && (
                        <span style={{ color:C.muted, fontWeight:600, fontSize:12 }}>· {fmtMoney(stageDeals.reduce(function(s,d){ return s+parseArr(d.financials?d.financials.projected_arr:d.arr); },0))} ARR</span>
                      )}
                    </div>
                    <div style={{ borderBottom:"1px solid "+C.border, marginBottom:14 }}/>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:12 }}>
                      {stageDeals.map(function(deal) {
                        var isEditing = editId===deal.id;
                        var dealBuckets = getBuckets(deal.vertical);
                        var dt = dealBuckets.find(function(t){ return t.id===deal.tier; });
                        var isPri2 = deal.priority==="p2";
                        return (function() {
                          var dealVert = VERTICALS.find(function(v){ return v.id===deal.vertical; }) || activeVert;
                          var busy = !!(rerunStatus[deal.id] || updateFinStatus[deal.id]);
                          var dispArr = deal.financials ? deal.financials.projected_arr : deal.arr;
                          var cardStyle = { width:"100%", boxSizing:"border-box", overflow:"hidden", background:C.card, border:"1px solid "+(isEditing?dealVert.color+"60":C.border), borderRadius:12, display:"flex", flexDirection:"column" };
                          var actionBtn = { boxSizing:"border-box", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"7px 4px", fontSize:9, fontWeight:600, cursor:"pointer", fontFamily:"inherit", color:C.muted, textAlign:"center", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" };
                          return (
                          <div key={deal.id} style={cardStyle}>

                            {/* 1. Top accent strip */}
                            <div style={{ height:4, background:dealVert.color, width:"100%", flexShrink:0 }}/>

                            {/* 2. Header row: company name (left) + P1/P2 + × (right) */}
                            <div style={{ display:"flex", alignItems:"center", padding:"10px 12px 6px", gap:8, minWidth:0 }}>
                              <div style={{ flex:"1 1 0", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:C.text, fontWeight:800, fontSize:14, lineHeight:1.2 }}>{deal.company}</div>
                              <button onClick={function(){ setDeals(function(prev){ return prev.map(function(x){ return x.id===deal.id?Object.assign({},x,{priority:isPri2?"p1":"p2"}):x; }); }); }}
                                style={{ flexShrink:0, background:isPri2?C.surface:C.accentDim, border:"1px solid "+(isPri2?C.border:C.accent), color:isPri2?C.muted:C.accent, borderRadius:20, padding:"2px 7px", fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit", lineHeight:1.4 }}>
                                {isPri2?"P2":"P1"}
                              </button>
                              <button onClick={function(){ removeDeal(deal.id); }}
                                style={{ flexShrink:0, background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:13, padding:"0 2px", lineHeight:1 }}>✕</button>
                            </div>

                            {/* 3. Tags row: segment + geo toggles + crypto badge */}
                            <div style={{ display:"flex", flexWrap:"wrap", gap:4, padding:"0 12px 8px", minWidth:0 }}>
                              {dt && <span style={{ background:dt.color+"22", border:"1px solid "+dt.color+"50", color:dt.color, borderRadius:20, padding:"2px 8px", fontSize:9, fontWeight:700 }}>{dt.label}</span>}
                              {["AMER","EMEA","APAC"].map(function(g){
                                var isGeo = deal.geography===g;
                                var gc = g==="AMER"?C.accent:g==="EMEA"?C.gold:C.green;
                                return <button key={g} onClick={function(){ setDeals(function(prev){ return prev.map(function(x){ return x.id===deal.id?Object.assign({},x,{geography:isGeo?"":g}):x; }); }); }}
                                  style={{ background:isGeo?gc+"22":"transparent", border:"1px solid "+(isGeo?gc:C.border), color:isGeo?gc:C.dim, borderRadius:20, padding:"2px 7px", fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit", lineHeight:1.4 }}>{g}</button>;
                              })}
                              {deal.hasCryptoPartner
                                ? <span title={(deal.cryptoPartners||[]).join(", ")} style={{ background:"#10B98122", border:"1px solid #10B98150", color:C.green, borderRadius:20, padding:"2px 8px", fontSize:9, fontWeight:700, cursor:"default" }}>🔗 {(deal.cryptoPartners||[]).length===1?(deal.cryptoPartners[0]):"Crypto Partner"}</span>
                                : <span style={{ background:"transparent", border:"1px solid "+C.border, color:C.dim, borderRadius:20, padding:"2px 8px", fontSize:9, fontWeight:600, cursor:"default" }}>⬜ Greenfield</span>
                              }
                            </div>

                            {/* 4. ARR block */}
                            {(dispArr || busy) && (
                              <div style={{ padding:"0 12px 10px", borderBottom:"1px solid "+C.border }}>
                                {busy ? (
                                  <div style={{ color:rerunStatus[deal.id]?C.accent:C.gold, fontSize:9, fontWeight:600, lineHeight:1.5 }}>
                                    {rerunStatus[deal.id] ? "⟳ "+rerunStatus[deal.id] : "💰 "+updateFinStatus[deal.id]}
                                  </div>
                                ) : (
                                  <div>
                                    {(function(){
                                      var oppId = getDealOppSize(deal);
                                      var oppEntry = OPP_SIZES.find(function(o){ return o.id===oppId; });
                                      var dotColor = oppEntry ? oppEntry.dotColor : "#94A3B8";
                                      return (
                                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                                          <span title={oppEntry?oppEntry.label:"Unknown"} style={{ width:8, height:8, borderRadius:"50%", background:dotColor, display:"inline-block", flexShrink:0 }}></span>
                                          <div style={{ color:C.cyan, fontWeight:800, fontSize:22, lineHeight:1.1 }}>{dispArr}</div>
                                        </div>
                                      );
                                    })()}
                                    {deal.financials && (
                                      <div style={{ color:C.dim, fontSize:8 }}>{deal.financials.updatedByRerun?"✏️ Financials updated":"🔒 Financials locked"} · {new Date(deal.financials.lockedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                                    )}
                                    {deal.tier==="neobanks" && getDealTam(deal) > 0 && getDealTam(deal) < 500000000000 && (
                                      <div title="Neobank TAM reference should be $500B+ (global digital payments/banking market). Re-run analysis to refresh." style={{ marginTop:4, color:"#F59E0B", fontSize:8, fontWeight:700, cursor:"help" }}>⚠️ TAM may need refresh</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 5. Summary text */}
                            {deal.notes && (
                              <div style={{ padding:"8px 12px", borderBottom:"1px solid "+C.border }}>
                                <div style={{ color:C.muted, fontSize:10, lineHeight:1.5, display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{deal.notes}</div>
                              </div>
                            )}

                            {/* Edit form replaces bottom sections when active */}
                            {isEditing ? (
                              <div style={{ padding:"12px" }}>
                                <div style={{ display:"grid", gap:6, marginBottom:8 }}>
                                  <input defaultValue={deal.financials?deal.financials.projected_arr:deal.arr} id={"arr_"+deal.id} placeholder="Projected ARR e.g. $45K" style={inp}/>
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
                                  <div style={{ paddingTop:8, borderTop:"1px solid "+C.border }}>
                                    <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Crypto Infrastructure Partners</div>
                                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 10px", marginBottom:6 }}>
                                      {CRYPTO_INFRA_PARTNERS.map(function(p){
                                        var cbId="cp_"+p.name.toLowerCase().replace(/[^a-z0-9]/g,"_")+"_"+deal.id;
                                        return <label key={p.name} style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", color:C.muted, fontSize:10 }}>
                                          <input type="checkbox" id={cbId} defaultChecked={Array.isArray(deal.cryptoPartners)&&deal.cryptoPartners.includes(p.name)} style={{ accentColor:C.accent }}/>
                                          {p.name}
                                        </label>;
                                      })}
                                    </div>
                                    <input id={"cp_other_"+deal.id} defaultValue={(deal.cryptoPartners||[]).filter(function(p){ return !CRYPTO_INFRA_PARTNERS.find(function(x){ return x.name===p; }); }).join(", ")} placeholder="Other partners (comma-separated)" style={Object.assign({},inp,{fontSize:10,padding:"5px 8px"})}/>
                                  </div>
                                </div>
                                <button onClick={function(){
                                  var arrEl=document.getElementById("arr_"+deal.id), notesEl=document.getElementById("notes_"+deal.id), tierEl=document.getElementById("tier_"+deal.id), priorityEl=document.getElementById("priority_"+deal.id), stageEl=document.getElementById("stage_"+deal.id), vertEl=document.getElementById("vert_"+deal.id), geoEl=document.getElementById("geo_"+deal.id);
                                  var newArr=arrEl?arrEl.value:(deal.financials?deal.financials.projected_arr:deal.arr);
                                  var finPatch=deal.financials?{financials:Object.assign({},deal.financials,{projected_arr:newArr})}:{};
                                  var selPartners=CRYPTO_INFRA_PARTNERS.filter(function(p){ var cb=document.getElementById("cp_"+p.name.toLowerCase().replace(/[^a-z0-9]/g,"_")+"_"+deal.id); return cb&&cb.checked; }).map(function(p){ return p.name; });
                                  var otherEl=document.getElementById("cp_other_"+deal.id);
                                  var otherPartners=otherEl?otherEl.value.split(",").map(function(s){ return s.trim(); }).filter(Boolean):[];
                                  var allPartners=selPartners.concat(otherPartners);
                                  updateDeal(deal.id,Object.assign({arr:newArr,notes:notesEl?notesEl.value:deal.notes,tier:tierEl?tierEl.value:(deal.tier||""),priority:priorityEl?priorityEl.value:(deal.priority||"p1"),stage:stageEl?stageEl.value:deal.stage,vertical:vertEl?vertEl.value:deal.vertical,geography:geoEl?geoEl.value:(deal.geography||""),cryptoPartners:allPartners,hasCryptoPartner:allPartners.length>0},finPatch));
                                }} style={{ background:dealVert.color, color:"#000", border:"none", borderRadius:6, padding:"5px 14px", fontWeight:800, fontSize:10, cursor:"pointer", fontFamily:"inherit", marginRight:6 }}>Save</button>
                                <button onClick={function(){ setEditId(null); }} style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:6, padding:"5px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                              </div>
                            ) : (
                              <div>
                                {/* 6. Stage dropdown */}
                                <div style={{ padding:"8px 12px", borderBottom:"1px solid "+C.border }}>
                                  <select value={deal.stage} onChange={function(e){ updateStage(deal.id, e.target.value); }}
                                    style={{ width:"100%", boxSizing:"border-box", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"5px 8px", color:C.muted, fontSize:10, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
                                    {PIPE_STAGES.map(function(s){ return <option key={s.id} value={s.id}>{s.label}</option>; })}
                                  </select>
                                </div>

                                {/* 7. Action 2×2 grid */}
                                {(function(){
                                  var ds = deckStatus[deal.id] || (deal.gammaDeckUrl ? "done" : "");
                                  var deckPolling = ds.startsWith("polling:");
                                  var deckLoading = ds === "researching" || ds === "building" || ds === "starting" || deckPolling;
                                  var deckDone = ds === "done" || !!(deal.gammaDeckUrl && !deckLoading && ds !== "timeout");
                                  var deckErr = ds.startsWith("error:");
                                  var deckTimeout = ds === "timeout";
                                  var pollSecs = deckPolling ? parseInt(ds.split(":")[1]||"0",10)*5 : 0;
                                  var deckBtnLabel = ds === "researching" ? "🔍 Researching..." : ds === "building" ? "🧠 Building..." : ds === "starting" ? "🚀 Starting..." : deckPolling ? "🎨 ~" + Math.max(5, 150 - pollSecs) + "s..." : "🎨 Deck";
                                  return (
                                    <div>
                                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, padding:"8px 12px", borderBottom:"1px solid "+C.border, boxSizing:"border-box" }}>
                                        <button onClick={function(){ if(deal.analysisData&&!busy){ setOverlayAnalysis(deal.analysisData); setOverlayDealId(deal.id); } }} disabled={!deal.analysisData||busy}
                                          style={Object.assign({},actionBtn,{ color:deal.analysisData&&!busy?C.accent:C.dim, background:deal.analysisData&&!busy?C.accentDim:C.surface, borderColor:deal.analysisData&&!busy?C.accent+"50":C.border, opacity:(!deal.analysisData||busy)?0.4:1, cursor:(!deal.analysisData||busy)?"default":"pointer" })}>👁 View</button>
                                        <button onClick={function(){ rerunAnalysis(deal); }} disabled={busy}
                                          style={Object.assign({},actionBtn,{ opacity:busy?0.4:1, cursor:busy?"default":"pointer" })}>🔄 Rerun</button>
                                        <button onClick={function(){ updateFinancials(deal); }} disabled={busy}
                                          style={Object.assign({},actionBtn,{ color:busy?C.dim:C.gold, background:C.goldDim, borderColor:C.gold+"50", opacity:busy?0.4:1, cursor:busy?"default":"pointer" })}>💰 Financials</button>
                                        {deckDone && deal.gammaDeckUrl
                                          ? <div style={{ display:"flex", gap:3, minWidth:0 }}>
                                              <a href={deal.gammaDeckUrl} target="_blank" rel="noreferrer"
                                                style={Object.assign({},actionBtn,{ color:C.purple, background:C.purple+"20", borderColor:C.purple+"60", textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", flex:"1 1 0", minWidth:0 })}>📊 Deck</a>
                                              <button onClick={function(){ buildGammaDeck(deal); }} disabled={deckLoading}
                                                title="Regenerate deck"
                                                style={Object.assign({},actionBtn,{ flex:"0 0 auto", padding:"7px 8px", color:C.dim })}>↺</button>
                                            </div>
                                          : <button onClick={function(){ if(!deckLoading&&!busy) buildGammaDeck(deal); }} disabled={deckLoading||busy}
                                              style={Object.assign({},actionBtn,{ color:deckLoading?C.dim:C.purple, background:C.purple+"15", borderColor:C.purple+"50", opacity:(deckLoading||busy)?0.5:1, cursor:(deckLoading||busy)?"default":"pointer" })}>
                                              {deckBtnLabel}
                                            </button>
                                        }
                                      </div>
                                      {(deckErr || deckTimeout) && (
                                        <div style={{ padding:"5px 12px 4px", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                                          <span style={{ color:C.gold, fontSize:9 }}>
                                            {deckTimeout
                                              ? "⚠️ Taking longer than expected. Retry or check Deck Builder page."
                                              : "⚠️ " + (ds.slice(6).includes("404") || ds.slice(6).toLowerCase().includes("not found") ? "Gamma key invalid or API unavailable" : ds.slice(6).slice(0,70))}
                                          </span>
                                          <button onClick={function(){ buildGammaDeck(deal); }}
                                            style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:4, padding:"2px 7px", fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>Retry</button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* 8. Segment link + edit link */}
                                <div style={{ padding:"6px 12px 8px", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                                  <button onClick={function(){ setTierPickId(tierPickId===deal.id?null:deal.id); }}
                                    style={{ background:"transparent", border:"none", padding:0, color:dt?dt.color:C.dim, fontSize:9, cursor:"pointer", fontFamily:"inherit", fontWeight:600, textDecoration:"underline", textUnderlineOffset:2 }}>
                                    {dt?"Change":"+"} {deal.vertical==="financial_services"?"Segment":"Tier"}
                                  </button>
                                  <button onClick={function(){ setEditId(deal.id); }}
                                    style={{ background:"transparent", border:"none", padding:0, color:C.dim, fontSize:9, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline", textUnderlineOffset:2 }}>✏ Edit</button>
                                </div>
                                {tierPickId===deal.id && (
                                  <div style={{ display:"flex", gap:4, flexWrap:"wrap", padding:"0 12px 10px" }}>
                                    {dealBuckets.map(function(t){
                                      var isActive=deal.tier===t.id;
                                      return <button key={t.id} onClick={function(){ setDeals(function(prev){ return prev.map(function(x){ return x.id===deal.id?Object.assign({},x,{tier:t.id}):x; }); }); setTierPickId(null); }}
                                        style={{ background:isActive?t.color:t.color+"25", border:"1px solid "+t.color, color:isActive?"#000":t.color, borderRadius:5, padding:"3px 8px", fontSize:9, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>{t.label}</button>;
                                    })}
                                    {dt && <button onClick={function(){ setDeals(function(prev){ return prev.map(function(x){ return x.id===deal.id?Object.assign({},x,{tier:""}):x; }); }); setTierPickId(null); }}
                                      style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:5, padding:"3px 7px", fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>Unassign</button>}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          );
                        })();
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

// ─── DeckBuilder ──────────────────────────────────────────────────────────────
function DeckBuilder({ gammaHistory, setGammaHistory, deals }) {
  var s1 = useState(""); var prompt = s1[0]; var setPrompt = s1[1];
  var s2 = useState(""); var deckTitle = s2[0]; var setDeckTitle = s2[1];
  var s3 = useState(""); var status = s3[0]; var setStatus = s3[1];
  var s4 = useState(null); var deckUrl = s4[0]; var setDeckUrl = s4[1];
  var s5 = useState(false); var busy = s5[0]; var setBusy = s5[1];
  var s6 = useState("free"); var slideType = s6[0]; var setSlideType = s6[1];

  var DECK_SLIDE_TYPES = [
    { id:"free",           label:"✍️ Custom Deck",                desc:"Describe any presentation — Grok builds the outline" },
    { id:"pipeline_brief", label:"📋 Pipeline Intelligence Brief", desc:"Synthesize your full pipeline into an executive summary" },
  ];

  function getSubVertLabel(tierId) {
    var sv = FS_SUBVERTS.find(function(s){ return s.id===tierId; });
    if (sv) return sv.label;
    var t = TIERS.find(function(t){ return t.id===tierId; });
    return t ? t.label : (tierId || "Unknown");
  }

  function serializePipeline(dealList) {
    if (!dealList || !dealList.length) return "No pipeline deals available.";
    var lines = ["=== PIPELINE DEALS (" + dealList.length + " accounts) ===\n"];
    dealList.forEach(function(d) {
      var proj = (d.financials && d.financials.projected_arr) || d.arr || "N/A";
      var som  = (d.financials && d.financials.som) || "N/A";
      var partners = [];
      if (d.analysisData && Array.isArray(d.analysisData.partnerships)) {
        partners = d.analysisData.partnerships.filter(function(p){ return p && p.partner; }).map(function(p){ return p.partner + " (" + (p.type||"partnership") + ")"; });
      }
      var signals = [];
      if (d.analysisData && Array.isArray(d.analysisData.intent_data)) {
        signals = d.analysisData.intent_data.slice(0,3).map(function(s){ return s.signal; });
      }
      lines.push("ACCOUNT: " + d.company);
      lines.push("  Segment: " + getSubVertLabel(d.tier));
      lines.push("  Priority: " + (d.priority||"p1").toUpperCase());
      lines.push("  Geography: " + (d.geography||"Unknown"));
      lines.push("  Stage: " + (d.stage||"prospecting"));
      lines.push("  Projected ARR: " + proj);
      lines.push("  SOM: " + som);
      lines.push("  Crypto partnerships: " + (partners.length ? partners.join("; ") : "None confirmed"));
      if (signals.length) lines.push("  Intent signals: " + signals.join(" | "));
      if (d.analysisData && d.analysisData.executive_summary) lines.push("  Summary: " + (d.analysisData.executive_summary||"").slice(0,200));
      lines.push("");
    });
    return lines.join("\n");
  }

  async function generate() {
    if (busy) return;
    if (slideType==="free" && !prompt.trim()) return;
    if (slideType==="pipeline_brief" && (!deals || !deals.length)) { setStatus("⚠️ No pipeline deals to analyze — add accounts in the Pipeline tab first"); return; }
    setBusy(true); setDeckUrl(null);

    var outline; var finalTitle;
    try {
      if (slideType === "pipeline_brief") {
        var pipelineData = serializePipeline(deals);
        var svMap = {};
        deals.forEach(function(d){ svMap[d.tier||"unknown"]=(svMap[d.tier||"unknown"]||0)+1; });
        var svCount = Object.keys(svMap).length;
        setStatus("🧠 Grok synthesizing " + deals.length + " accounts across " + svCount + " segment" + (svCount!==1?"s":"") + "...");
        var briefPrompt = CP_CAPABILITIES + "\n\nHere is the full pipeline deal data you must analyze:\n\n" + pipelineData + "\n\nUsing only the pipeline deal data provided above, generate a Pipeline Intelligence Brief structured as a series of tables — one section per vertical, broken down by segment within each vertical. Every account named must exist in the provided pipeline data.\n\nFor each vertical present in the pipeline data (Financial Services, Luxury Travel, Luxury Goods, Gaming & Casinos — only include verticals that have accounts):\n\nStart with a vertical header row showing:\n- Vertical name\n- Total account count\n- Total projected ARR across all accounts in this vertical\n- Total estimated volume across all accounts in this vertical\n\nThen for each segment within that vertical, produce a table with these columns:\n| Account Name | Priority | Crypto Infrastructure Partners | Estimated Annual Volume | Projected ARR | Pipeline Stage |\n\nPopulate each row as follows:\n- Account Name: The brand name of the company as stored in the pipeline\n- Priority: P1 or P2\n- Crypto Infrastructure Partners: List any confirmed crypto infrastructure partners found in the analysis data (Fireblocks, Anchorage, Zero Hash, Paxos, BitGo, Coinbase Prime, Bakkt, Chainalysis, etc). If none confirmed write 'None identified — greenfield opportunity'\n- Estimated Annual Volume: The volume figure used in the ARR calculation — pull directly from the bottoms-up calculation stored on the deal (e.g. '$500B annual trading volume' for an FX broker, '$2B payment volume' for a neobank). If not available write 'Volume not disclosed — estimated [X] based on [methodology]'\n- Projected ARR: The projected ARR figure stored on the deal in USD\n- Pipeline Stage: Current stage (Prospecting, Lead/SQL, Discovery, Solution Design & Demo, Proposal & Negotiation, Closed/Won, Expansion/Retention)\n\nSort each segment table: P1 accounts first (sorted by Projected ARR descending), then P2 accounts (sorted by Projected ARR descending).\n\nSPECIAL CASE — FX & BROKERAGE SEGMENT ONLY:\nFor the FX & Brokerage segment, do NOT use the single table format above. Instead replace it entirely with the following structure:\n\nSegment header:\nFX & Brokerage | [X] Accounts | $[total ARR] Projected ARR | $[total volume] Est. Volume\n\nSection 1 — Business Type Classification:\nFirst classify each FX & Brokerage account as either:\n- FX-Focused: Primary business is foreign exchange trading, retail or institutional FX, currency pairs. Examples: CMC Markets, Pepperstone, FxPro, XM, OANDA\n- Multi-Asset: Offers FX plus equities, crypto, commodities, ETFs, or other asset classes. Examples: Interactive Brokers, Saxo Bank, Webull, DriveWealth, Robinhood\nUse Grok's knowledge of each firm's actual business model to classify correctly — do not guess based on name alone.\n\nSection 2 — Four tables, one per category combination:\n\nTable 1: FX-Focused x Crypto-Partnered\nAccounts whose primary business is FX AND have confirmed crypto infrastructure partnerships (Anchorage, Fireblocks, Coinbase Prime, Zero Hash, Kraken, BitGo, Bakkt, Paxos, or similar)\nColumns: | Account | Priority | Crypto Partner(s) | Nature of Partnership | Est. Annual Volume | Projected ARR | Stage | CoinPayments Angle |\n- Crypto Partner(s): Name the specific confirmed partner(s)\n- Nature of Partnership: What the partnership covers — custody, settlement, compliance, trading infrastructure, stablecoin etc\n- CoinPayments Angle: Given they already have crypto infrastructure, what is the CoinPayments play? Complementary capability? Displacement? White-label layer on top?\n\nTable 2: FX-Focused x Greenfield (No Crypto Partners)\nAccounts whose primary business is FX AND have no confirmed crypto infrastructure partnerships\nColumns: | Account | Priority | Crypto Signal | Greenfield Opportunity | Est. Annual Volume | Projected ARR | Stage | CoinPayments Angle |\n- Crypto Signal: Any intent signals from the analysis indicating crypto interest or exploration\n- Greenfield Opportunity: What CoinPayments can bring that they currently lack entirely\n\nTable 3: Multi-Asset x Crypto-Partnered\nAccounts offering multiple asset classes AND have confirmed crypto infrastructure partnerships\nColumns: same as Table 1\n\nTable 4: Multi-Asset x Greenfield (No Crypto Partners)\nAccounts offering multiple asset classes AND have no confirmed crypto infrastructure partnerships\nColumns: same as Table 2\n\nWithin each table:\n- Sort P1 accounts first, then P2; within each priority tier sort by Projected ARR descending\n- Highlight the top account in each table with a brief one-line note: 'Largest ARR opportunity in this category'\n- If Jump Trading or any firm with an internal crypto division appears, note it in Crypto Partner(s) as 'Internal crypto arm: [division name]' and in CoinPayments Angle as 'Potential displacement or complementary play given internal capabilities'\n\nSection 3 — Summary stats after all four tables:\n| Category | Accounts | P1 | P2 | Total ARR | Total Volume | Crypto-Partnered | Greenfield |\n| FX-Focused | | | | | | | |\n| Multi-Asset | | | | | | | |\n| Total FX & Brokerage | | | | | | | |\n\nFormatting for Gamma (FX & Brokerage only): Each of the four tables is a separate slide titled 'FX & Brokerage — [category]' e.g. 'FX & Brokerage — FX-Focused, Crypto-Partnered'. Use dark background, P1 rows in a slightly brighter accent, column headers bold, alternating row shading. The summary stats table is its own final slide for this segment.\n\nFor all other segments (Remittance Fintechs, Neobanks, and any tiers within Luxury Travel, Luxury Goods, Gaming & Casinos), use the standard single table format described above.\n\nAfter each segment table, add a one-line segment summary:\n'[Segment name]: [X] accounts | $[total ARR] projected ARR | $[total volume] estimated volume | [X] accounts with existing crypto partnerships | [X] greenfield accounts'\n\nAfter all segment tables within a vertical, add a vertical summary row:\n'Total [Vertical]: [X] accounts | [X] P1 / [X] P2 | $[total ARR] projected ARR | $[total volume] estimated volume | [X]% accounts with existing crypto infrastructure'\n\nAfter all verticals, add a Grand Total section:\n- Total accounts across entire pipeline: X\n- Total P1 accounts: X ($Y ARR)\n- Total P2 accounts: X ($Y ARR)\n- Total projected ARR: $X\n- Total estimated volume: $X\n- Accounts with confirmed crypto infrastructure partners: X of Y ([Z]%)\n- Greenfield accounts (no confirmed crypto partners): X of Y ([Z]%)\n- Top 5 accounts by projected ARR: [name, vertical, segment, ARR]\n- Top 5 accounts by estimated volume: [name, vertical, segment, volume]\n\nFormatting instructions for Gamma:\nFormat each vertical section as a separate slide in Gamma. The grand total should be its own slide. Use dark background. Tables should have clear column headers, alternating row shading, and P1 accounts highlighted. Segment summary lines should be bold. Vertical summary rows should be a distinct accent color.\n\nUse only data from the pipeline dataset provided. Do not estimate, hallucinate, or reference accounts not in the provided data. If a field is missing for a specific account, write 'Not available' rather than guessing.";
        outline = await callGrok(
          "You are a senior revenue intelligence analyst producing a boardroom-ready pipeline brief. Be specific, data-driven, and reference named accounts throughout. Use only the pipeline data provided — never generalize without examples.",
          briefPrompt, 8000, false
        );
        finalTitle = deckTitle.trim() || "Pipeline Intelligence Brief — CoinPayments";
      } else {
        setStatus("🤖 Grok is building your outline...");
        outline = await callGrok(
          "You are a presentation outline expert for B2B sales materials. Create a detailed, structured presentation outline with clear slide titles, key bullet points, talking points, and specific data suggestions for each slide. Be thorough and specific.",
          "Create a detailed presentation outline for this: " + prompt + "\n\nFormat as a structured outline: Slide 1: [Title], key points, talking points. Slide 2: ... etc. Include suggested data, stats, or visuals for each slide.\n\nDesign note: Format this presentation for a dark professional theme — minimal, clean, high-contrast. Keep all copy concise and data-driven.",
          3000, false
        );
        finalTitle = deckTitle.trim() || prompt.slice(0, 80);
      }

      setStatus("🚀 Starting Gamma generation...");
      var startRes = await fetch("/api/gamma-start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: outline, title: finalTitle }),
      });
      var startData = await startRes.json();
      if (!startRes.ok || startData.error) throw new Error(startData.error || "Gamma start failed " + startRes.status);
      var generationId = startData.generationId;
      if (!generationId) throw new Error("Gamma did not return a generation ID. Response: " + JSON.stringify(startData).slice(0, 200));

      var resolved = false;
      for (var attempt = 1; attempt <= 30; attempt++) {
        setStatus("🎨 Generating presentation... " + (attempt * 5) + "s elapsed (Gamma takes ~60-90s)");
        await new Promise(function(r){ setTimeout(r, 5000); });
        var pr = await fetch("/api/gamma-status?id=" + encodeURIComponent(generationId));
        var pd = await pr.json();
        if (!pr.ok) throw new Error(pd.error || "Poll failed " + pr.status);
        if (pd.status === "completed" && pd.url) {
          setDeckUrl(pd.url); setStatus("");
          var entry = { id:Date.now(), title:finalTitle, url:pd.url, createdAt:new Date().toISOString() };
          setGammaHistory(function(h){ return [entry].concat(h.slice(0, 19)); });
          resolved = true; break;
        }
        if (pd.status === "failed") throw new Error("Gamma generation failed: " + (pd.error || "unknown error"));
      }
      if (!resolved) setStatus("⚠️ Generation is taking longer than expected (>2.5 min). Try the Generate button again.");
    } catch(e) {
      setStatus("❌ " + e.message);
    }
    setBusy(false);
  }

  var canGenerate = slideType==="pipeline_brief" ? (deals && deals.length > 0) : !!prompt.trim();

  return (
    <div>
      <div style={{ marginBottom:24 }}>
        <div style={{ color:C.text, fontSize:22, fontWeight:900, marginBottom:4 }}>🎨 Deck Builder</div>
        <div style={{ color:C.muted, fontSize:12 }}>Grok builds the outline — Gamma renders the presentation.</div>
      </div>

      {/* Slide type selector */}
      <div style={{ marginBottom:20 }}>
        <div style={{ color:C.dim, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Deck Type</div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {DECK_SLIDE_TYPES.map(function(st) {
            var active = slideType===st.id;
            return (
              <div key={st.id} onClick={function(){ setSlideType(st.id); }}
                style={{ flex:1, minWidth:200, background:active?C.accentDim:C.card, border:"1px solid "+(active?C.accent:C.border), borderRadius:10, padding:"14px 16px", cursor:"pointer", transition:"border-color 0.15s,background 0.15s" }}>
                <div style={{ color:active?C.accent:C.text, fontWeight:800, fontSize:13, marginBottom:4 }}>{st.label}</div>
                <div style={{ color:C.muted, fontSize:11, lineHeight:1.4 }}>{st.desc}</div>
                {st.id==="pipeline_brief" && (
                  <div style={{ color:C.dim, fontSize:10, marginTop:6 }}>
                    {deals && deals.length ? deals.length + " account" + (deals.length!==1?"s":"") + " in pipeline" : "No pipeline data"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"20px", marginBottom:20 }}>
        {slideType==="pipeline_brief" ? (
          <div>
            <div style={{ marginBottom:12 }}>
              <label style={{ color:C.dim, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", display:"block", marginBottom:5 }}>Presentation Title (optional)</label>
              <input value={deckTitle} onChange={function(e){ setDeckTitle(e.target.value); }}
                placeholder="Pipeline Intelligence Brief — CoinPayments"
                style={{ width:"100%", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"9px 12px", color:C.text, fontSize:12, outline:"none" }}/>
            </div>
            {deals && deals.length ? (function() {
              var p1 = deals.filter(function(d){ return (d.priority||"p1")==="p1"; }).length;
              var p2 = deals.filter(function(d){ return d.priority==="p2"; }).length;
              var svMap = {}; deals.forEach(function(d){ svMap[d.tier||"unknown"]=(svMap[d.tier||"unknown"]||0)+1; });
              var withPartners = deals.filter(function(d){ return d.analysisData && Array.isArray(d.analysisData.partnerships) && d.analysisData.partnerships.length>0; }).length;
              return (
                <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"14px 16px", marginBottom:16 }}>
                  <div style={{ color:C.muted, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Pipeline snapshot</div>
                  <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
                    <div><div style={{ color:C.accent,  fontSize:20, fontWeight:900 }}>{deals.length}</div><div style={{ color:C.dim, fontSize:10 }}>Total accounts</div></div>
                    <div><div style={{ color:C.gold,    fontSize:20, fontWeight:900 }}>{p1}</div><div style={{ color:C.dim, fontSize:10 }}>P1 priority</div></div>
                    <div><div style={{ color:C.muted,   fontSize:20, fontWeight:900 }}>{p2}</div><div style={{ color:C.dim, fontSize:10 }}>P2 priority</div></div>
                    <div><div style={{ color:C.green,   fontSize:20, fontWeight:900 }}>{Object.keys(svMap).length}</div><div style={{ color:C.dim, fontSize:10 }}>Segments</div></div>
                    <div><div style={{ color:C.purple,  fontSize:20, fontWeight:900 }}>{withPartners}</div><div style={{ color:C.dim, fontSize:10 }}>w/ crypto partners</div></div>
                  </div>
                </div>
              );
            })() : (
              <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"14px 16px", marginBottom:16, color:C.dim, fontSize:12 }}>
                No pipeline deals found — add accounts in the Pipeline tab first.
              </div>
            )}
            <button onClick={generate} disabled={busy||!canGenerate}
              style={{ background:busy||!canGenerate?"#334155":C.purple, color:"#fff", border:"none", borderRadius:7, padding:"10px 22px", fontWeight:800, fontSize:12, cursor:busy||!canGenerate?"default":"pointer", fontFamily:"inherit", transition:"background 0.15s" }}>
              {busy ? "Generating..." : "✨ Generate Pipeline Brief"}
            </button>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom:12 }}>
              <label style={{ color:C.dim, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", display:"block", marginBottom:5 }}>Presentation Title (optional)</label>
              <input value={deckTitle} onChange={function(e){ setDeckTitle(e.target.value); }}
                placeholder="e.g. CoinPayments × Stripe — Partnership Opportunity"
                style={{ width:"100%", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"9px 12px", color:C.text, fontSize:12, outline:"none" }}/>
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={{ color:C.dim, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", display:"block", marginBottom:5 }}>Describe your presentation</label>
              <textarea value={prompt} onChange={function(e){ setPrompt(e.target.value); }}
                placeholder="e.g. A 10-slide investor pitch for CoinPayments targeting remittance fintechs in Southeast Asia. Include TAM/SOM analysis, competitive landscape, and go-to-market strategy."
                rows={4}
                style={{ width:"100%", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"9px 12px", color:C.text, fontSize:12, outline:"none", resize:"vertical", lineHeight:1.5 }}/>
            </div>
            <button onClick={generate} disabled={busy||!canGenerate}
              style={{ background:busy||!canGenerate?"#334155":C.purple, color:"#fff", border:"none", borderRadius:7, padding:"10px 22px", fontWeight:800, fontSize:12, cursor:busy||!canGenerate?"default":"pointer", fontFamily:"inherit", transition:"background 0.15s" }}>
              {busy ? "Generating..." : "✨ Generate with Grok + Gamma"}
            </button>
          </div>
        )}
      </div>

      {status && (
        <div style={{ background:C.card, border:"1px solid "+(status.startsWith("❌")?C.gold+"80":C.border), borderRadius:8, padding:"14px 18px", marginBottom:16, color:status.startsWith("❌")?C.gold:C.accent, fontSize:12, fontWeight:600 }}>
          {status.startsWith("❌") && (status.includes("404") || status.toLowerCase().includes("not found"))
            ? "❌ Gamma API key invalid or endpoint unavailable — check your key in Settings"
            : status}
        </div>
      )}

      {deckUrl && (
        <div style={{ background:"#10B98120", border:"1px solid "+C.green, borderRadius:10, padding:"20px", marginBottom:20, textAlign:"center" }}>
          <div style={{ color:C.green, fontSize:16, fontWeight:900, marginBottom:8 }}>✅ Your presentation is ready</div>
          <div style={{ color:C.muted, fontSize:11, marginBottom:16 }}>{deckTitle || (slideType==="pipeline_brief" ? "Pipeline Intelligence Brief" : prompt.slice(0,60))}</div>
          <a href={deckUrl} target="_blank" rel="noreferrer"
            style={{ display:"inline-block", background:C.green, color:"#000", borderRadius:8, padding:"12px 28px", fontWeight:800, fontSize:13, textDecoration:"none" }}>
            Open in Gamma →
          </a>
        </div>
      )}

      {gammaHistory.length > 0 && (
        <div>
          <div style={{ color:C.muted, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Generated Decks</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {gammaHistory.map(function(entry) {
              return (
                <div key={entry.id} style={{ background:C.card, border:"1px solid "+C.border, borderRadius:8, padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                  <div>
                    <div style={{ color:C.text, fontWeight:700, fontSize:12, marginBottom:2 }}>{entry.title}</div>
                    <div style={{ color:C.dim, fontSize:10 }}>{new Date(entry.createdAt).toLocaleString()}</div>
                  </div>
                  <a href={entry.url} target="_blank" rel="noreferrer"
                    style={{ background:C.purple+"30", border:"1px solid "+C.purple+"60", color:C.purple, borderRadius:6, padding:"5px 12px", fontWeight:700, fontSize:10, textDecoration:"none", whiteSpace:"nowrap" }}>
                    Open in Gamma →
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function svLabel(vid, tid) {
  if (vid==="financial_services"||!vid) {
    var fs = FS_SUBVERTS.find(function(s){ return s.id===tid; });
    if (fs) return fs.label;
  }
  var t = TIERS.find(function(x){ return x.id===tid; });
  return t ? t.label : (tid||"Unknown");
}
function svColor(vid, tid) {
  var buckets = (vid==="financial_services"||!vid) ? FS_SUBVERTS : TIERS;
  var b = buckets.find(function(x){ return x.id===tid; });
  return b ? b.color : C.muted;
}

// ─── Compete Tab ─────────────────────────────────────────────────────────────
var COMP_POSITIONS = [
  { id:"displace",   label:"Displace",   color:"#EF4444" },
  { id:"complement", label:"Complement", color:"#10B981" },
  { id:"coexist",    label:"Co-exist",   color:"#3B82F6" },
  { id:"avoid",      label:"Avoid",      color:"#6B7280" },
];
var COMP_SEED_NAMES = [
  "Fireblocks","Paxos","Anchorage Digital","Coinbase Prime","Zero Hash",
  "Kraken","BitGo","BitPay","Bakkt","BVNK","Stripe","PayPal","Block",
  "Ripple","Circle","Chainalysis","Copper","Talos","Ledger Enterprise",
  "Bitso","Checkout.com","Adyen","Worldpay","Nuvei"
];
var COMP_SEGMENT_OPTS = [
  "FX & Brokerage","Escrow","Remittance Fintechs","Neobanks",
  "Regional / Middle Market Banks","Luxury Travel","Luxury Goods","Gaming & Casinos"
];
function saveCompetitorList(list) {
  fetch("/api/competitors", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ competitors:list })
  }).catch(function(){});
}
async function enrichCompetitorsGrok(names) {
  var sys = "You are a competitive intelligence analyst for CoinPayments, a crypto payments infrastructure company.\n" + CP_CAPABILITIES;
  var user = "Provide competitive intelligence on these companies vs CoinPayments. Return ONLY a JSON array (no markdown fences, no explanation). Each element must include:\n" +
    "name (string, exactly as given in the list), category (one of: Custody/Payments/Exchange/Compliance/Banking/Infrastructure/Fintech), " +
    "description (1-2 sentences: what the company does), " +
    "segmentsPenetrated (array of strings from: FX & Brokerage, Escrow, Remittance Fintechs, Neobanks, Regional / Middle Market Banks, Luxury Travel, Luxury Goods, Gaming & Casinos), " +
    "competitivePosition (one of: displace/complement/coexist/avoid — from CoinPayments' perspective), " +
    "differentiation (2-3 sentences: how CoinPayments' four capabilities specifically beat this competitor), " +
    "weaknesses (1-2 sentences: this competitor's key weaknesses relevant to CoinPayments' market), " +
    "fullDetail (3-4 sentences: market position, key clients, pricing model, strategic direction)\n\n" +
    "Companies to analyze: " + names.join(", ");
  var raw = await callGrok(sys, user, 12000, false);
  var m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("No JSON array in Grok response");
  return JSON.parse(m[0]);
}
function CompeteTab({ deals }) {
  var s1  = useState([]); var competitors = s1[0]; var setCompetitors = s1[1];
  var s2  = useState("idle"); var seedStatus = s2[0]; var setSeedStatus = s2[1];
  var s3  = useState(""); var seedError = s3[0]; var setSeedError = s3[1];
  var s4  = useState(null); var enrichingId = s4[0]; var setEnrichingId = s4[1];
  var s5  = useState(null); var expandedId = s5[0]; var setExpandedId = s5[1];
  var s6  = useState(""); var searchQ = s6[0]; var setSearchQ = s6[1];
  var s7  = useState("all"); var filterPos = s7[0]; var setFilterPos = s7[1];
  var s8  = useState(false); var showAdd = s8[0]; var setShowAdd = s8[1];
  var s9  = useState(null); var editId = s9[0]; var setEditId = s9[1];
  var s10 = useState({ name:"", category:"Payments", description:"", segmentsPenetrated:[], competitivePosition:"complement", differentiation:"", weaknesses:"", fullDetail:"" });
  var addForm = s10[0]; var setAddForm = s10[1];
  var s11 = useState({}); var editForm = s11[0]; var setEditForm = s11[1];
  var s12 = useState("idle"); var deckStatus = s12[0]; var setDeckStatus = s12[1];
  var s13 = useState(function(){ try{return localStorage.getItem("cp_compete_deck_url")||null;}catch(e){return null;} }); var deckUrl = s13[0]; var setDeckUrl = s13[1];
  var s14 = useState(function(){ try{var t=localStorage.getItem("cp_compete_deck_at");return t?parseInt(t,10):null;}catch(e){return null;} }); var deckGeneratedAt = s14[0]; var setDeckGeneratedAt = s14[1];
  var loadedRef = useRef(false);

  function doAutoPopulate(list) {
    var allP = [];
    deals.forEach(function(d){ (d.cryptoPartners||[]).forEach(function(p){ if(allP.indexOf(p)===-1) allP.push(p); }); });
    var existing = list.map(function(c){ return c.name.toLowerCase(); });
    var newN = allP.filter(function(p){ return existing.indexOf(p.toLowerCase())===-1; });
    if (!newN.length) return;
    enrichCompetitorsGrok(newN).then(function(extra){
      var ts = Date.now();
      var items = extra.map(function(c,i){ return Object.assign({},c,{ id:ts+i, addedAt:ts, enrichedAt:ts }); });
      var combined = list.concat(items);
      setCompetitors(combined);
      saveCompetitorList(combined);
    }).catch(function(){});
  }

  useEffect(function(){
    if (loadedRef.current) return;
    loadedRef.current = true;
    fetch("/api/competitors")
      .then(function(r){ return r.json(); })
      .then(function(data){
        var list = Array.isArray(data.competitors) ? data.competitors : [];
        if (list.length === 0) {
          setSeedStatus("loading");
          enrichCompetitorsGrok(COMP_SEED_NAMES)
            .then(function(enriched){
              var ts = Date.now();
              var items = enriched.map(function(c,i){ return Object.assign({},c,{ id:ts+i, addedAt:ts, enrichedAt:ts }); });
              setCompetitors(items); setSeedStatus("done");
              saveCompetitorList(items);
              doAutoPopulate(items);
            })
            .catch(function(err){ setSeedStatus("error"); setSeedError(err.message); });
        } else {
          setCompetitors(list); setSeedStatus("done");
          doAutoPopulate(list);
        }
      })
      .catch(function(){ setSeedStatus("error"); setSeedError("Failed to load from API"); });
  }, []);

  function refreshCompetitor(comp) {
    setEnrichingId(comp.id);
    enrichCompetitorsGrok([comp.name]).then(function(res){
      if (!res.length) { setEnrichingId(null); return; }
      var updated = Object.assign({}, comp, res[0], { enrichedAt:Date.now() });
      var newList = competitors.map(function(c){ return c.id===comp.id ? updated : c; });
      setCompetitors(newList); saveCompetitorList(newList); setEnrichingId(null);
    }).catch(function(){ setEnrichingId(null); });
  }
  function deleteCompetitor(id) {
    var newList = competitors.filter(function(c){ return c.id!==id; });
    setCompetitors(newList); saveCompetitorList(newList);
    if (expandedId===id) setExpandedId(null);
  }
  function addCompetitor() {
    if (!addForm.name.trim()) return;
    var ts = Date.now();
    var item = Object.assign({}, addForm, { id:ts, addedAt:ts, enrichedAt:ts });
    var newList = competitors.concat([item]);
    setCompetitors(newList); saveCompetitorList(newList);
    setShowAdd(false);
    setAddForm({ name:"", category:"Payments", description:"", segmentsPenetrated:[], competitivePosition:"complement", differentiation:"", weaknesses:"", fullDetail:"" });
  }
  function saveEdit() {
    var newList = competitors.map(function(c){ return c.id===editId ? Object.assign({},c,editForm) : c; });
    setCompetitors(newList); saveCompetitorList(newList);
    setEditId(null); setEditForm({});
  }
  function getPipelineTargets(name) {
    return deals.filter(function(d){ return (d.cryptoPartners||[]).some(function(p){ return p.toLowerCase()===name.toLowerCase(); }); });
  }
  function renderFields(form, onChange) {
    var finp = { background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.text, fontSize:11, outline:"none", fontFamily:"inherit", width:"100%" };
    var fsel = { background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none", width:"100%" };
    var flbl = { color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", marginBottom:4 };
    return (
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <div>
          <div style={flbl}>Name *</div>
          <input value={form.name||""} onChange={function(e){ onChange(Object.assign({},form,{name:e.target.value})); }} style={finp} />
        </div>
        <div>
          <div style={flbl}>Category</div>
          <select value={form.category||"Payments"} onChange={function(e){ onChange(Object.assign({},form,{category:e.target.value})); }} style={fsel}>
            {["Custody","Payments","Exchange","Compliance","Banking","Infrastructure","Fintech"].map(function(v){ return <option key={v}>{v}</option>; })}
          </select>
        </div>
        <div style={{ gridColumn:"1 / -1" }}>
          <div style={flbl}>Description</div>
          <textarea value={form.description||""} onChange={function(e){ onChange(Object.assign({},form,{description:e.target.value})); }} rows={2} style={Object.assign({},finp,{resize:"vertical"})} />
        </div>
        <div>
          <div style={flbl}>Competitive Position</div>
          <select value={form.competitivePosition||"complement"} onChange={function(e){ onChange(Object.assign({},form,{competitivePosition:e.target.value})); }} style={fsel}>
            {COMP_POSITIONS.map(function(p){ return <option key={p.id} value={p.id}>{p.label}</option>; })}
          </select>
        </div>
        <div>
          <div style={flbl}>Segments (Ctrl/⌘ multi-select)</div>
          <select multiple value={form.segmentsPenetrated||[]} onChange={function(e){ var v=[]; for(var i=0;i<e.target.options.length;i++){if(e.target.options[i].selected)v.push(e.target.options[i].value);} onChange(Object.assign({},form,{segmentsPenetrated:v})); }} style={Object.assign({},fsel,{height:72,color:C.text})}>
            {COMP_SEGMENT_OPTS.map(function(s){ return <option key={s} value={s}>{s}</option>; })}
          </select>
        </div>
        <div style={{ gridColumn:"1 / -1" }}>
          <div style={flbl}>CoinPayments Differentiation</div>
          <textarea value={form.differentiation||""} onChange={function(e){ onChange(Object.assign({},form,{differentiation:e.target.value})); }} rows={3} style={Object.assign({},finp,{resize:"vertical"})} />
        </div>
        <div style={{ gridColumn:"1 / -1" }}>
          <div style={flbl}>Weaknesses</div>
          <textarea value={form.weaknesses||""} onChange={function(e){ onChange(Object.assign({},form,{weaknesses:e.target.value})); }} rows={2} style={Object.assign({},finp,{resize:"vertical"})} />
        </div>
        <div style={{ gridColumn:"1 / -1" }}>
          <div style={flbl}>Full Intelligence Detail</div>
          <textarea value={form.fullDetail||""} onChange={function(e){ onChange(Object.assign({},form,{fullDetail:e.target.value})); }} rows={3} style={Object.assign({},finp,{resize:"vertical"})} />
        </div>
      </div>
    );
  }

  function exportPDF() {
    var date = new Date().toLocaleDateString();
    var sections = filtered.map(function(c) {
      var targets = getPipelineTargets(c.name);
      var posLbl = (COMP_POSITIONS.find(function(p){return p.id===c.competitivePosition;})||{label:c.competitivePosition||"—"}).label;
      return '<div class="competitor">' +
        '<h2>' + (c.name||"") + ' <span class="cat">' + (c.category||"") + '</span> <span class="pos pos-' + (c.competitivePosition||"") + '">' + posLbl + '</span></h2>' +
        '<p class="desc">' + (c.description||"—") + '</p>' +
        '<div class="lbl">Segments Penetrated</div><p>' + ((c.segmentsPenetrated||[]).join(", ")||"—") + '</p>' +
        '<div class="lbl">Pipeline Targets (' + targets.length + ')</div><p>' + (targets.length ? targets.map(function(d){ return d.company+(d.arr?" · "+d.arr:""); }).join(" · ") : "None") + '</p>' +
        '<div class="lbl">CoinPayments Differentiation</div><p>' + (c.differentiation||"—") + '</p>' +
        '<div class="lbl">Key Weaknesses</div><p>' + (c.weaknesses||"—") + '</p>' +
        '<div class="lbl">Full Intelligence</div><p>' + (c.fullDetail||"—") + '</p>' +
        '</div>';
    }).join('<div class="pb"></div>');
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>CoinPayments Competitive Landscape</title><style>' +
      'body{font-family:Arial,sans-serif;color:#111;margin:0;padding:24px}' +
      '.hdr{border-bottom:3px solid #00C2FF;padding-bottom:10px;margin-bottom:18px}' +
      '.hdr h1{margin:0;font-size:20px;color:#00C2FF}.hdr .dt{color:#666;font-size:11px;margin-top:3px}' +
      '.stats{display:flex;gap:18px;margin-bottom:22px;background:#f5f5f5;padding:10px 14px;border-radius:6px}' +
      '.stat{font-size:11px;color:#333}' +
      '.competitor{margin-bottom:28px;padding-bottom:18px;border-bottom:1px solid #ddd}' +
      'h2{font-size:15px;margin:0 0 6px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}' +
      '.cat{font-size:10px;font-weight:normal;background:#e8e8e8;padding:1px 7px;border-radius:10px;color:#555}' +
      '.pos{font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px}' +
      '.pos-displace{background:#FFE8E8;color:#C00}.pos-complement{background:#E8FFE8;color:#060}.pos-coexist{background:#E8F0FF;color:#003}.pos-avoid{background:#EEE;color:#666}' +
      '.lbl{font-size:9px;font-weight:700;text-transform:uppercase;color:#888;letter-spacing:0.06em;margin:9px 0 2px}' +
      '.desc{margin:0 0 6px;color:#555;font-size:12px}p{margin:0 0 5px;font-size:11px;line-height:1.5;color:#444}' +
      '.pb{page-break-after:always;height:0;margin:0}@media print{.pb{page-break-after:always}}' +
      '</style></head><body>' +
      '<div class="hdr"><h1>⚔️ CoinPayments Competitive Landscape</h1><div class="dt">Generated ' + date + (searchQ||filterPos!=="all" ? " · Filtered view" : "") + '</div></div>' +
      '<div class="stats"><div class="stat"><b>' + filtered.length + '</b> competitors</div><div class="stat"><b>' + pctPipeline + '%</b> pipeline w/ crypto partner</div>' + (mostCommon.count ? '<div class="stat">Most common: <b>' + mostCommon.name + '</b> (' + mostCommon.count + ')</div>' : '') + '</div>' +
      sections + '</body></html>';
    var w = window.open("", "_blank");
    if (!w) { alert("Allow popups to export PDF."); return; }
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

  function exportCSV() {
    function esc(v) { return '"' + String(v||"").replace(/"/g,'""') + '"'; }
    var hdrs = ["Competitor Name","Category","Description","Segments Penetrated","Pipeline Targets Count","Pipeline Targets","Total ARR at Risk","CoinPayments Differentiation","Competitive Position","Key Weaknesses","Full Intelligence"];
    var rows = filtered.map(function(c){
      var t = getPipelineTargets(c.name);
      var arr = t.reduce(function(s,d){ return s+parseArr(d.arr); }, 0);
      return [c.name,c.category,c.description||"",(c.segmentsPenetrated||[]).join("; "),t.length,t.map(function(d){return d.company;}).join("; "),arr?fmtMoney(arr):"",c.differentiation||"",c.competitivePosition||"",c.weaknesses||"",c.fullDetail||""].map(esc).join(",");
    });
    var csv = hdrs.map(esc).join(",") + "\n" + rows.join("\n");
    var blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    var burl = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = burl; a.download = "CoinPayments_Competitive_Landscape_" + new Date().toISOString().slice(0,10) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(burl);
  }

  async function buildCompeteDeck() {
    var busy = deckStatus==="building"||deckStatus==="starting"||deckStatus.indexOf("polling")===0;
    if (busy) return;
    setDeckStatus("building");
    try {
      var compList = filtered.map(function(c){
        var t = getPipelineTargets(c.name);
        return { name:c.name, category:c.category, description:c.description, segmentsPenetrated:c.segmentsPenetrated||[], competitivePosition:c.competitivePosition, differentiation:c.differentiation||"", weaknesses:c.weaknesses||"", fullDetail:c.fullDetail||"", pipelineTargets:t.map(function(d){return {company:d.company,arr:d.arr||"",segment:d.tier||""};}) };
      });
      var sys = "You are a CoinPayments sales enablement specialist creating a competitive intelligence deck for the sales team.\n" + CP_CAPABILITIES;
      var user = "Using the following competitive landscape data, create a structured presentation outline for a CoinPayments internal competitive intelligence deck. Audience: CoinPayments sales team.\n\n" +
        "Slide 1 — Competitive Landscape Overview: Summary of all competitors tracked, breakdown by category, pipeline penetration statistics, key insight about the overall competitive environment.\n\n" +
        "Slide 2 — Competitors to Displace (highest priority): Table format — all 'displace' competitors with: name, segments penetrated, pipeline targets using them, specific CoinPayments capability that displaces them.\n\n" +
        "Slide 3 — Complement Opportunities: Table — 'complement' competitors — accounts where CoinPayments can partner or layer. Name, segments, pipeline targets, how CoinPayments complements them.\n\n" +
        "Slide 4 — Co-exist Landscape: Table — 'coexist' competitors with objection-handling context when prospects mention them.\n\n" +
        "One slide per Displace and key Complement competitor: name & category, what they offer (2-3 bullets), where they are weak (2-3 bullets), CoinPayments differentiation via the four capabilities, pipeline targets using them + recommended CP angle, talk track paragraph.\n\n" +
        "Final slide — Battle Card Summary: Competitor | Their Strength | CoinPayments Counter | Position.\n\n" +
        "Use dark background theme. Keep slides concise and sales-actionable.\n\n" +
        "Data:\n" + JSON.stringify(compList, null, 2);
      var outline = await callGrok(sys, user, 12000, false);
      setDeckStatus("starting");
      var startRes = await fetch("/api/gamma-start", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ prompt:outline, title:"CoinPayments Competitive Intelligence Deck" }) });
      var startData = await startRes.json();
      if (!startRes.ok || startData.error) throw new Error(startData.error || "Gamma start failed " + startRes.status);
      var genId = startData.generationId;
      if (!genId) throw new Error("No generation ID from Gamma");
      setDeckStatus("polling:0");
      async function doPoll(attempt) {
        if (attempt > 30) { setDeckStatus("timeout"); return; }
        await new Promise(function(r){ setTimeout(r, 5000); });
        try {
          var pr = await fetch("/api/gamma-status?id=" + encodeURIComponent(genId));
          var pd = await pr.json();
          if (!pr.ok) throw new Error(pd.error || "Poll error " + pr.status);
          if (pd.status === "completed" && pd.url) {
            try { await fetch("/api/gamma-theme", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({generationId:genId}) }); } catch(te){}
            var now = Date.now();
            setDeckUrl(pd.url); setDeckGeneratedAt(now);
            try { localStorage.setItem("cp_compete_deck_url", pd.url); localStorage.setItem("cp_compete_deck_at", String(now)); } catch(le){}
            setDeckStatus("done");
          } else if (pd.status === "failed") {
            setDeckStatus("error:" + (pd.error||"Generation failed"));
          } else { setDeckStatus("polling:" + attempt); doPoll(attempt + 1); }
        } catch(pe) { setDeckStatus("error:" + pe.message.slice(0,80)); }
      }
      doPoll(1);
    } catch(e) { setDeckStatus("error:" + e.message.slice(0,80)); }
  }

  var dealsWithPartner = deals.filter(function(d){ return d.hasCryptoPartner; });
  var pctPipeline = deals.length ? Math.round(dealsWithPartner.length/deals.length*100) : 0;
  var mostCommon = { name:"—", count:0 };
  competitors.forEach(function(c){ var n=getPipelineTargets(c.name).length; if(n>mostCommon.count) mostCommon={name:c.name,count:n}; });
  var filtered = competitors.filter(function(c){
    if (filterPos!=="all" && c.competitivePosition!==filterPos) return false;
    var q = searchQ.toLowerCase();
    return !q || (c.name||"").toLowerCase().indexOf(q)!==-1 || (c.category||"").toLowerCase().indexOf(q)!==-1 || (c.description||"").toLowerCase().indexOf(q)!==-1;
  });

  var accentBtn = { background:C.accent, color:"#000", border:"none", borderRadius:7, padding:"7px 14px", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" };
  var smBtn     = { background:C.surface, color:C.muted, border:"1px solid "+C.border, borderRadius:6, padding:"5px 12px", fontWeight:600, fontSize:10, cursor:"pointer", fontFamily:"inherit" };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ color:C.text, fontSize:18, fontWeight:800 }}>⚔️ Competitive Landscape</div>
          <div style={{ color:C.muted, fontSize:11, marginTop:4 }}>Crypto infrastructure competitors tracked against CoinPayments' pipeline</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button onClick={exportPDF} style={smBtn}>📄 Export PDF</button>
          <button onClick={exportCSV} style={smBtn}>📊 Export CSV</button>
          <button onClick={buildCompeteDeck}
            disabled={deckStatus==="building"||deckStatus==="starting"||deckStatus.indexOf("polling")===0}
            style={{ background:C.purple, color:"#fff", border:"none", borderRadius:7, padding:"7px 14px", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit", opacity:(deckStatus==="building"||deckStatus==="starting"||deckStatus.indexOf("polling")===0)?0.6:1 }}>
            🎨 Create Competitive Deck
          </button>
          <button onClick={function(){ setShowAdd(!showAdd); setEditId(null); }} style={accentBtn}>
            {showAdd ? "✕ Cancel" : "+ Add Competitor"}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))", gap:10, marginBottom:16 }}>
        {[
          { label:"Tracked",                   value:competitors.length,                                                          color:C.accent },
          { label:"Pipeline w/ Crypto Partner", value:pctPipeline+"%",                                                            color:C.gold   },
          { label:"Most Common",               value:mostCommon.count ? mostCommon.name+" ("+mostCommon.count+")" : "—",          color:"#EF4444" },
          { label:"Displace",                  value:competitors.filter(function(c){return c.competitivePosition==="displace";}).length,   color:"#EF4444" },
          { label:"Complement",                value:competitors.filter(function(c){return c.competitivePosition==="complement";}).length, color:"#10B981" },
          { label:"Co-exist",                  value:competitors.filter(function(c){return c.competitivePosition==="coexist";}).length,    color:"#3B82F6" },
        ].map(function(s,i){
          return (
            <div key={i} style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"12px 14px" }}>
              <div style={{ color:s.color, fontWeight:800, fontSize:18, marginBottom:2 }}>{s.value}</div>
              <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Deck status */}
      {(deckStatus!=="idle" || deckUrl) && (
        <div style={{ background:C.card, border:"1px solid "+(deckStatus==="done"?C.green:C.border), borderRadius:10, padding:"12px 16px", marginBottom:16 }}>
          {(deckStatus==="building"||deckStatus==="starting") && <div style={{ color:C.accent, fontSize:13, fontWeight:700 }}>{deckStatus==="building" ? "🔍 Building competitive intelligence..." : "🎨 Generating deck in Gamma..."}</div>}
          {deckStatus.indexOf("polling")===0 && <div style={{ color:C.accent, fontSize:13, fontWeight:700 }}>🎨 Generating deck in Gamma… ({deckStatus.split(":")[1]}/30)</div>}
          {deckStatus==="done" && deckUrl && (
            <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
              <div style={{ color:C.green, fontSize:13, fontWeight:700 }}>✅ Competitive deck ready</div>
              <a href={deckUrl} target="_blank" rel="noreferrer" style={{ background:C.green, color:"#000", borderRadius:7, padding:"6px 14px", fontWeight:700, fontSize:11, textDecoration:"none" }}>Open in Gamma →</a>
              {deckGeneratedAt && <div style={{ color:C.dim, fontSize:9 }}>Last generated: {new Date(deckGeneratedAt).toLocaleDateString()}</div>}
            </div>
          )}
          {deckStatus==="timeout" && <div style={{ color:C.gold, fontSize:12 }}>⏱ Deck generation timed out. <button onClick={buildCompeteDeck} style={{ background:"transparent", border:"1px solid "+C.gold, color:C.gold, borderRadius:6, padding:"3px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit", marginLeft:8 }}>Retry</button></div>}
          {deckStatus.indexOf("error:")===0 && <div style={{ display:"flex", gap:10, alignItems:"center" }}><div style={{ color:"#EF4444", fontSize:12 }}>⚠️ {deckStatus.slice(6)}</div><button onClick={buildCompeteDeck} style={{ background:"transparent", border:"1px solid #EF4444", color:"#EF4444", borderRadius:6, padding:"3px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Retry</button></div>}
          {deckStatus==="idle" && deckUrl && (
            <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
              <div style={{ color:C.muted, fontSize:12, fontWeight:600 }}>🎨 Previously generated deck</div>
              <a href={deckUrl} target="_blank" rel="noreferrer" style={{ background:C.surface, color:C.accent, border:"1px solid "+C.accent, borderRadius:7, padding:"5px 14px", fontWeight:700, fontSize:11, textDecoration:"none" }}>Open in Gamma →</a>
              {deckGeneratedAt && <div style={{ color:C.dim, fontSize:9 }}>Generated: {new Date(deckGeneratedAt).toLocaleDateString()}</div>}
            </div>
          )}
        </div>
      )}

      {/* Seed status banners */}
      {seedStatus==="loading" && (
        <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:20, marginBottom:16, textAlign:"center" }}>
          <div style={{ color:C.accent, fontSize:14, fontWeight:700, marginBottom:6 }}>🔍 Building competitive intelligence...</div>
          <div style={{ color:C.muted, fontSize:11 }}>Grok is analyzing {COMP_SEED_NAMES.length} competitors against CoinPayments' four capabilities. This takes ~30s.</div>
        </div>
      )}
      {seedStatus==="error" && (
        <div style={{ background:"#EF444420", border:"1px solid #EF4444", borderRadius:10, padding:12, marginBottom:16, fontSize:11, color:"#EF4444", display:"flex", gap:10, alignItems:"center" }}>
          <span>⚠️ {seedError}</span>
          <button onClick={function(){
            setSeedStatus("loading"); setSeedError("");
            enrichCompetitorsGrok(COMP_SEED_NAMES)
              .then(function(enriched){ var ts=Date.now(); var items=enriched.map(function(c,i){ return Object.assign({},c,{id:ts+i,addedAt:ts,enrichedAt:ts}); }); setCompetitors(items); setSeedStatus("done"); saveCompetitorList(items); })
              .catch(function(err){ setSeedStatus("error"); setSeedError(err.message); });
          }} style={{ background:"transparent", border:"1px solid #EF4444", color:"#EF4444", borderRadius:6, padding:"3px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Retry</button>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:16, marginBottom:16 }}>
          <div style={{ color:C.text, fontWeight:700, fontSize:13, marginBottom:12 }}>Add Competitor</div>
          {renderFields(addForm, setAddForm)}
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <button onClick={addCompetitor} style={accentBtn}>Save</button>
            <button onClick={function(){ setShowAdd(false); }} style={smBtn}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <input value={searchQ} onChange={function(e){ setSearchQ(e.target.value); }} placeholder="Search competitors…"
          style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.text, fontSize:11, outline:"none", fontFamily:"inherit", minWidth:160, flex:"1 1 160px" }} />
        <select value={filterPos} onChange={function(e){ setFilterPos(e.target.value); }}
          style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"6px 10px", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
          <option value="all">All Positions</option>
          {COMP_POSITIONS.map(function(p){ return <option key={p.id} value={p.id}>{p.label}</option>; })}
        </select>
        <div style={{ color:C.dim, fontSize:10 }}>{filtered.length} / {competitors.length} competitors</div>
      </div>

      {/* Column headers */}
      {filtered.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 3fr 2fr 1fr 3fr 1fr", gap:8, padding:"4px 14px", marginBottom:4 }}>
          {["Competitor","Category","Description","Segments","Pipeline","Differentiation","Position"].map(function(h){
            return <div key={h} style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</div>;
          })}
        </div>
      )}

      {/* Competitor rows */}
      {filtered.map(function(comp){
        var pipeTargets = getPipelineTargets(comp.name);
        var isExp  = expandedId===comp.id;
        var isEdit = editId===comp.id;
        var posObj = COMP_POSITIONS.find(function(p){ return p.id===comp.competitivePosition; }) || { color:C.muted, label:comp.competitivePosition||"—" };
        return (
          <div key={comp.id} style={{ background:C.card, border:"1px solid "+(isExp?posObj.color:C.border), borderRadius:10, marginBottom:8, overflow:"hidden" }}>
            {/* Summary row */}
            {!isEdit && (
              <div onClick={function(){ setExpandedId(isExp?null:comp.id); setEditId(null); }}
                style={{ display:"grid", gridTemplateColumns:"2fr 1fr 3fr 2fr 1fr 3fr 1fr", gap:8, padding:"12px 14px", cursor:"pointer", alignItems:"start" }}>
                <div>
                  <div style={{ color:C.text, fontWeight:700, fontSize:12 }}>{comp.name}</div>
                  {pipeTargets.length>0 && <div style={{ color:C.green, fontSize:9, marginTop:2 }}>🔗 {pipeTargets.length} deal{pipeTargets.length!==1?"s":""}</div>}
                </div>
                <div style={{ color:C.muted, fontSize:11, paddingTop:1 }}>{comp.category||"—"}</div>
                <div style={{ color:C.dim, fontSize:10, lineHeight:1.5 }}>{(comp.description||"").slice(0,100)}{(comp.description||"").length>100?"…":""}</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                  {(comp.segmentsPenetrated||[]).slice(0,3).map(function(s){ return <span key={s} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:10, padding:"1px 6px", fontSize:8, color:C.muted, whiteSpace:"nowrap" }}>{s}</span>; })}
                  {(comp.segmentsPenetrated||[]).length>3 && <span style={{ color:C.dim, fontSize:8 }}>+{(comp.segmentsPenetrated||[]).length-3}</span>}
                </div>
                <div style={{ color:pipeTargets.length?C.green:C.dim, fontWeight:pipeTargets.length?700:400, fontSize:13, paddingTop:1 }}>{pipeTargets.length||"—"}</div>
                <div style={{ color:C.dim, fontSize:10, lineHeight:1.5 }}>{(comp.differentiation||"").slice(0,90)}{(comp.differentiation||"").length>90?"…":""}</div>
                <div><span style={{ background:posObj.color+"22", border:"1px solid "+posObj.color+"66", color:posObj.color, borderRadius:20, padding:"2px 8px", fontSize:9, fontWeight:700, whiteSpace:"nowrap" }}>{posObj.label}</span></div>
              </div>
            )}
            {/* Edit form */}
            {isEdit && (
              <div style={{ padding:16 }}>
                <div style={{ color:C.text, fontWeight:700, fontSize:13, marginBottom:10 }}>Edit: {comp.name}</div>
                {renderFields(editForm, setEditForm)}
                <div style={{ display:"flex", gap:8, marginTop:10 }}>
                  <button onClick={saveEdit} style={accentBtn}>Save</button>
                  <button onClick={function(){ setEditId(null); setEditForm({}); }} style={smBtn}>Cancel</button>
                </div>
              </div>
            )}
            {/* Expanded detail */}
            {isExp && !isEdit && (
              <div style={{ borderTop:"1px solid "+C.border, padding:"14px 16px" }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:14 }}>
                  <div>
                    <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>Full Intelligence</div>
                    <div style={{ color:C.muted, fontSize:11, lineHeight:1.6 }}>{comp.fullDetail||"—"}</div>
                  </div>
                  <div>
                    <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>Key Weaknesses</div>
                    <div style={{ color:C.muted, fontSize:11, lineHeight:1.6 }}>{comp.weaknesses||"—"}</div>
                  </div>
                  <div>
                    <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>CoinPayments Differentiation</div>
                    <div style={{ color:C.muted, fontSize:11, lineHeight:1.6 }}>{comp.differentiation||"—"}</div>
                  </div>
                  <div>
                    <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>Pipeline Targets ({pipeTargets.length})</div>
                    {pipeTargets.length
                      ? <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                          {pipeTargets.map(function(d){ return <span key={d.id} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:20, padding:"2px 8px", fontSize:9, color:C.text }}>{d.company}</span>; })}
                        </div>
                      : <div style={{ color:C.dim, fontSize:11 }}>None in pipeline</div>}
                  </div>
                  <div style={{ gridColumn:"1 / -1" }}>
                    <div style={{ color:C.dim, fontSize:9, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>All Segments Penetrated</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                      {(comp.segmentsPenetrated||[]).length
                        ? (comp.segmentsPenetrated||[]).map(function(s){ return <span key={s} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:10, padding:"2px 8px", fontSize:9, color:C.muted }}>{s}</span>; })
                        : <span style={{ color:C.dim, fontSize:11 }}>—</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <button onClick={function(e){ e.stopPropagation(); setEditId(comp.id); setEditForm(Object.assign({},comp)); setExpandedId(null); }} style={smBtn}>✏️ Edit</button>
                  <button onClick={function(e){ e.stopPropagation(); if(enrichingId===comp.id) return; refreshCompetitor(comp); }}
                    style={{ background:C.surface, color:enrichingId===comp.id?C.dim:C.accent, border:"1px solid "+(enrichingId===comp.id?C.border:C.accent), borderRadius:6, padding:"5px 12px", fontWeight:600, fontSize:10, cursor:enrichingId===comp.id?"default":"pointer", fontFamily:"inherit" }}>
                    {enrichingId===comp.id ? "⟳ Refreshing…" : "🔄 Refresh Intelligence"}
                  </button>
                  <button onClick={function(e){ e.stopPropagation(); if(window.confirm("Delete "+comp.name+"?")) deleteCompetitor(comp.id); }}
                    style={{ background:C.surface, color:"#EF4444", border:"1px solid #EF4444", borderRadius:6, padding:"5px 12px", fontWeight:600, fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>🗑 Delete</button>
                  <div style={{ marginLeft:"auto", color:C.dim, fontSize:9 }}>
                    {comp.enrichedAt ? "Updated "+new Date(comp.enrichedAt).toLocaleDateString() : ""}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {filtered.length===0 && seedStatus!=="loading" && (
        <div style={{ textAlign:"center", padding:60, color:C.dim }}>
          <div style={{ fontSize:28, marginBottom:12 }}>⚔️</div>
          <div>{competitors.length===0 ? "Competitive intelligence loading…" : "No competitors match your filters."}</div>
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
  var s8  = useState(function(){ return localStorage.getItem(TKEY_LS)||""; });  var tKey = s8[0]; var setTKey = s8[1];
  var s9  = useState(function(){ return localStorage.getItem(NJKEY_LS)||""; }); var njKey = s9[0]; var setNjKey = s9[1];
  var s10 = useState(function(){ try { return JSON.parse(localStorage.getItem(HIST_LS)||"[]"); } catch { return []; } });
  var history      = s10[0]; var setHistory      = s10[1];
  var s11 = useState(function(){ try { return (JSON.parse(localStorage.getItem(PIPE_LS)||"[]")).filter(function(d){ return d && d.company; }); } catch { return []; } });
  var pipelineDeals= s11[0]; var setPipelineDeals= s11[1];
  var s12 = useState(false); var pipeLoaded = s12[0]; var setPipeLoaded = s12[1];
  var sGammaH = useState(function(){ try { return JSON.parse(localStorage.getItem(GAMMA_HIST_LS)||"[]"); } catch { return []; } }); var gammaHistory = sGammaH[0]; var setGammaHistory = sGammaH[1];

  useEffect(function(){ localStorage.setItem(HIST_LS, JSON.stringify(history)); }, [history]);
  useEffect(function(){ localStorage.setItem(GAMMA_HIST_LS, JSON.stringify(gammaHistory)); }, [gammaHistory]);

  // Load pipeline from server on mount — server is source of truth for cross-device sync
  useEffect(function() {
    fetch("/api/pipeline").then(function(r){ return r.json(); }).then(function(d) {
      if (Array.isArray(d.pipeline) && d.pipeline.length > 0) {
        // Migrate any deals where the old label was stored as the tier value
        var migrated = d.pipeline.filter(function(d){ return d && d.company; }).map(function(d) {
          var patched = d;
          if (d.tier === "Brokerage & Investment" || d.tier === "Brokerage & Investment Firms") {
            patched = Object.assign({}, patched, { tier: "brokerage" });
          }
          // One-time crypto partner detection migration for deals that predate this field
          if (patched.hasCryptoPartner === undefined && patched.analysisData) {
            var cp = detectCryptoPartners(patched.analysisData);
            patched = Object.assign({}, patched, cp);
          }
          return patched;
        });
        setPipelineDeals(migrated);
      }
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
    ["deck",    "🎨 Deck Builder"],
    ["compete", "⚔️ Compete"],
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
            {[{ label:"🌐 Tavily Search",  desc:"Live news · app.tavily.com ($35/mo Starter)",   lsk:TKEY_LS,  val:tKey,  fn:function(v){saveKey(TKEY_LS,v,setTKey);},   ph:"tvly-xxxx" },
              { label:"🎯 NinjaPear",      desc:"Executive profiles · nubela.co/dashboard",      lsk:NJKEY_LS, val:njKey, fn:function(v){saveKey(NJKEY_LS,v,setNjKey);}, ph:"api key from nubela.co" }
            ].map(function(k){
              return (
                <div key={k.label} style={{ background:C.card, borderRadius:8, padding:"12px 14px", border:"1px solid "+(k.val?C.green+"40":k.warn?C.red+"50":C.border) }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:4 }}>
                    <span style={{ color:C.text, fontWeight:700, fontSize:11 }}>{k.label}</span>
                    {k.val && <Badge color="green" sm>CONNECTED</Badge>}
                    {k.warn && <Badge color="red" sm>REQUIRED</Badge>}
                  </div>
                  <div style={{ color:C.dim, fontSize:10, marginBottom:k.warn?4:8 }}>{k.desc}</div>
                  {k.warn && <div style={{ color:C.red, fontSize:9, marginBottom:6, lineHeight:1.4 }}>⚠️ Grok key required for primary analysis. Add your xAI API key from console.x.ai</div>}
                  <input type="password" value={k.val} onChange={function(e){k.fn(e.target.value);}} placeholder={k.ph} style={{ width:"100%", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"7px 10px", color:C.text, fontSize:11, outline:"none" }}/>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:10, color:C.dim, fontSize:10 }}>Keys are saved to this browser only. Grok = primary analysis + X signals. NinjaPear finds executives: CEO, CMO, CPO, CTO, COO, CFO + VPs.</div>
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
                    var arr = (result.tam_som_arr&&(result.tam_som_arr.projected_arr||result.tam_som_arr.likely_arr_usd))||"";
                    var tam = (result.tam_som_arr&&result.tam_som_arr.tam_usd)||"";
                    var geo = detectGeo(result.hq||"");
                    setPipelineDeals(function(prev){
                      var already = prev.find(function(d){ return d.company.toLowerCase()===(result.company||"").toLowerCase(); });
                      if (already) return prev;
                      var rCp = detectCryptoPartners(result);
                      return prev.concat([{ id:Date.now(), company:result.company, arr:arr, tam:tam, geography:geo, stage:"prospecting", vertical:vert, priority:"p1", notes:(result.executive_summary||"").slice(0,120), analysisData:result, addedAt:new Date().toISOString(), financials:buildFinancials(result.tam_som_arr, arr, true), cryptoPartners:rCp.cryptoPartners, hasCryptoPartner:rCp.hasCryptoPartner }]);
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

        {/* Deck Builder */}
        {page==="deck" && <DeckBuilder gammaHistory={gammaHistory} setGammaHistory={setGammaHistory} deals={pipelineDeals}/>}

        {/* Compete */}
        {page==="compete" && <CompeteTab deals={pipelineDeals} />}

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
                        {h.data.tam_som_arr&&(h.data.tam_som_arr.projected_arr||h.data.tam_som_arr.likely_arr_usd)&&<div style={{ color:C.green, fontSize:11, marginTop:2 }}>ARR: {h.data.tam_som_arr.projected_arr||h.data.tam_som_arr.likely_arr_usd}</div>}
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
