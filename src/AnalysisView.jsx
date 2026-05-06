import React, { useState, useEffect, useRef } from "react";

// ─── Shared constants (duplicated from App.jsx; will be consolidated into utils.js) ──
const C = {
  bg:"#07090F", surface:"#0D1117", card:"#111827", border:"#1F2937",
  accent:"#00C2FF", accentDim:"#00C2FF12", gold:"#F59E0B", goldDim:"#F59E0B12",
  green:"#10B981", greenDim:"#10B98112", red:"#EF4444", redDim:"#EF444412",
  purple:"#8B5CF6", cyan:"#06B6D4", text:"#F1F5F9", muted:"#94A3B8", dim:"#334155",
};

const COMPARE_ROWS = [
  ["Merchant Acceptance","merchant_acceptance"],["Fiat On-Ramp","fiat_on_ramp"],
  ["Fiat Off-Ramp","fiat_off_ramp"],["Crypto Breadth","crypto_breadth"],
  ["White Label","white_label"],["Compliance","compliance_licensing"],
  ["Costs & Fees","costs_fees"],["API Architecture","api_architecture"],
  ["Scalability","scalability"],["SLA & Support","sla_support"],
];

var CRYPTO_PROVIDER_TERMS = [
  "fireblocks","fireblocks.com","anchorage digital","anchorage.com","anchorage",
  "zero hash inc","zh liquidity","zerohash.com","zerohash","zero hash",
  "paxos trust","paxos.com","paxos","paypal usd",
  "bitgo trust","bitgo.com","bitgo",
  "coinbase prime","coinbase custody","cb prime","coinbase",
  "kraken","bakkt","bitpay","chainalysis","copper","ledger enterprise","talos","blockdaemon"
];

function isCryptoProvider(name) {
  var nl = (name || "").toLowerCase();
  return CRYPTO_PROVIDER_TERMS.some(function(t) { return nl.includes(t); });
}

async function tavilySearch(query) {
  var key = "";
  try { key = localStorage.getItem("cp_tavily_key") || ""; } catch(e) {}
  if (!key) return [];
  try {
    var res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query: query, search_depth: "basic", max_results: 5, days: 730 })
    });
    if (!res.ok) return [];
    var d = await res.json();
    return d.results || [];
  } catch(e) { return []; }
}

var PARTNER_TYPES = ["Technology","Payment","Banking","Licensing","Distribution","Other"];
var PARTNER_STATUSES = ["Active","Announced","Rumored","Expired"];

async function callAPI(system, user, maxTokens) {
  const MODEL = "claude-sonnet-4-20250514";
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

// ─── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ color, children, sm }) {
  var colors = { accent: [C.accentDim, C.accent], gold: [C.goldDim, C.gold], green: [C.greenDim, C.green], purple: ["#8B5CF612", C.purple], red: [C.redDim, C.red], muted: [C.dim + "33", C.muted], cyan: ["#06B6D412", C.cyan] };
  var pair = colors[color || "muted"] || colors.muted;
  var bg = pair[0]; var fg = pair[1];
  return <span style={{ background: bg, color: fg, borderRadius: 10, padding: sm ? "1px 7px" : "2px 10px", fontSize: sm ? 9 : 10, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{children}</span>;
}

// ─── Sec ──────────────────────────────────────────────────────────────────────
export function Sec({ title, icon, accent, children, open: initOpen }) {
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

// ─── Chip ─────────────────────────────────────────────────────────────────────
export function Chip({ label, value, color }) {
  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "8px 14px", border: "1px solid " + C.border }}>
      <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
      <div style={{ color: color || C.text, fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  );
}

// ─── ContactInlineForm ────────────────────────────────────────────────────────
function ContactInlineForm({ initial, onSave, onCancel, accentColor }) {
  var BLANK = { name: "", title: "", email: "", linkedin: "", phone: "", notes: "", status: "Unverified" };
  var s = useState(Object.assign({}, BLANK, initial || {})); var form = s[0]; var setForm = s[1];
  var ac = accentColor || C.accent;
  var inp = { background: C.bg, border: "1px solid " + C.border, borderRadius: 6, padding: "6px 9px", color: C.text, fontSize: 11, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" };
  function set(k, v) { setForm(function(p) { return Object.assign({}, p, { [k]: v }); }); }
  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "12px 14px", marginBottom: 8, border: "1px solid " + ac + "50" }}>
      <div style={{ color: ac, fontSize: 10, fontWeight: 700, marginBottom: 8 }}>{initial && initial.name ? "Edit Contact" : "Add Contact"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>FULL NAME *</div>
          <input style={inp} value={form.name} onChange={function(e){ set("name", e.target.value); }} placeholder="e.g. Jane Smith" />
        </div>
        <div>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>TITLE / ROLE</div>
          <input style={inp} value={form.title} onChange={function(e){ set("title", e.target.value); }} placeholder="e.g. Chief Financial Officer" />
        </div>
        <div>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>VERIFICATION STATUS</div>
          <select style={Object.assign({}, inp, { cursor: "pointer" })} value={form.status} onChange={function(e){ set("status", e.target.value); }}>
            <option value="Confirmed">Confirmed</option>
            <option value="Unverified">Unverified</option>
            <option value="Former">Former</option>
          </select>
        </div>
        <div>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>EMAIL</div>
          <input style={inp} value={form.email} onChange={function(e){ set("email", e.target.value); }} placeholder="jane@company.com" type="email" />
        </div>
        <div>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>PHONE</div>
          <input style={inp} value={form.phone} onChange={function(e){ set("phone", e.target.value); }} placeholder="+1 555 000 0000" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>LINKEDIN URL</div>
          <input style={inp} value={form.linkedin} onChange={function(e){ set("linkedin", e.target.value); }} placeholder="https://linkedin.com/in/jane-smith" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>NOTES</div>
          <textarea style={Object.assign({}, inp, { resize: "vertical", minHeight: 44 })} value={form.notes} onChange={function(e){ set("notes", e.target.value); }} placeholder="e.g. Met at FinTech Summit, keen on stablecoins" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={function(){ if (form.name.trim()) onSave(form); }} style={{ background: ac, color: "#000", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
        <button onClick={onCancel} style={{ background: "transparent", border: "1px solid " + C.border, color: C.muted, borderRadius: 6, padding: "6px 12px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── PartnershipInlineForm ────────────────────────────────────────────────────
function PartnershipInlineForm({ initial, onSave, onCancel }) {
  var BLANK = { partnerName: "", type: "Other", dateAnnounced: "", status: "Active", notes: "", sourceUrl: "" };
  var s = useState(Object.assign({}, BLANK, initial || {})); var form = s[0]; var setForm = s[1];
  var inp = { background: C.bg, border: "1px solid " + C.border, borderRadius: 6, padding: "6px 9px", color: C.text, fontSize: 11, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" };
  function set(k, v) { setForm(function(p) { return Object.assign({}, p, { [k]: v }); }); }
  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "12px 14px", marginBottom: 8, border: "1px solid " + C.purple + "50" }}>
      <div style={{ color: C.purple, fontSize: 10, fontWeight: 700, marginBottom: 8 }}>{initial && initial.partnerName ? "Edit Partnership" : "Add Partnership"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>PARTNER NAME *</div>
          <input style={inp} value={form.partnerName} onChange={function(e){ set("partnerName", e.target.value); }} placeholder="e.g. Fireblocks" />
        </div>
        <div>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>PARTNERSHIP TYPE</div>
          <select style={Object.assign({}, inp, { cursor: "pointer" })} value={form.type} onChange={function(e){ set("type", e.target.value); }}>
            {PARTNER_TYPES.map(function(t){ return <option key={t} value={t}>{t}</option>; })}
          </select>
        </div>
        <div>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>STATUS</div>
          <select style={Object.assign({}, inp, { cursor: "pointer" })} value={form.status} onChange={function(e){ set("status", e.target.value); }}>
            {PARTNER_STATUSES.map(function(s){ return <option key={s} value={s}>{s}</option>; })}
          </select>
        </div>
        <div>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>DATE ANNOUNCED</div>
          <input style={inp} value={form.dateAnnounced} onChange={function(e){ set("dateAnnounced", e.target.value); }} placeholder="e.g. Jan 2025" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>SOURCE URL</div>
          <input style={inp} value={form.sourceUrl} onChange={function(e){ set("sourceUrl", e.target.value); }} placeholder="https://..." />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>NOTES</div>
          <textarea style={Object.assign({}, inp, { resize: "vertical", minHeight: 44 })} value={form.notes} onChange={function(e){ set("notes", e.target.value); }} placeholder="e.g. Deep tech integration, affects pricing" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={function(){ if (form.partnerName.trim()) onSave(form); }} style={{ background: C.purple, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
        <button onClick={onCancel} style={{ background: "transparent", border: "1px solid " + C.border, color: C.muted, borderRadius: 6, padding: "6px 12px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── ContactCard ──────────────────────────────────────────────────────────────
export function ContactCard({ contact, company, onRemove, onEdit, enriching }) {
  var s1 = useState(false); var showPaste = s1[0]; var setShowPaste = s1[1];
  var s2 = useState(contact.linkedin || ""); var liPaste = s2[0]; var setLiPaste = s2[1];

  var catColor = { "Economic Buyer": "gold", "Champion": "green", "Technical Buyer": "cyan", "Influencer": "accent", "Blocker": "red" };
  var cc = catColor[contact.category] || "muted";

  var vBadge = {
    ninjapear:          { color: "green",  label: "🎯 NinjaPear" },
    ninjapear_verified: { color: "green",  label: "🎯 NinjaPear ✓" },
    web_confirmed:      { color: "accent", label: "🌐 Web Confirmed" },
    scraped:            { color: "gold",   label: "⚠ Unverified" },
  }[contact.verified_source] || { color: "muted", label: "⚠ Verify" };

  var liUrl = liPaste.trim() || contact.linkedin || "";
  var sq = [contact.name, company, contact.title].filter(Boolean).join(" ");
  var liSearch = "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(sq);

  if (enriching) {
    return (
      <div style={{ background: C.surface, borderRadius: 8, padding: "12px 14px", marginBottom: 8, border: "1px solid " + C.accent + "40" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{contact.name}</span>
          {contact.title && <span style={{ color: C.muted, fontSize: 11 }}>{contact.title}</span>}
          <span style={{ color: C.accent, fontSize: 10, fontStyle: "italic" }}>🔍 Enriching contact...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "12px 14px", marginBottom: 8, border: "1px solid " + (contact.verification_confidence === "HIGH" ? C.green + "30" : contact.verification_confidence === "MEDIUM" ? C.accent + "30" : C.border) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{contact.name}</span>
            {contact.category && <Badge color={cc} sm>{contact.category}</Badge>}
            {contact.manual
              ? <Badge color="purple" sm>✏️ Manual</Badge>
              : <Badge color={vBadge.color} sm>{vBadge.label}</Badge>
            }
            {contact.status === "Former" && <Badge color="red" sm>Former</Badge>}
          </div>
          {contact.title && <div style={{ color: C.muted, fontSize: 11, marginBottom: 2 }}>{contact.title}</div>}
          {contact.outreach_angle && <div style={{ color: C.accent, fontSize: 10 }}>💬 {contact.outreach_angle}</div>}
          {contact.notes && <div style={{ color: C.dim, fontSize: 10, marginTop: 3, fontStyle: "italic" }}>{contact.notes}</div>}
          {contact.email && <div style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>✉ {contact.email}</div>}
          {contact.phone && <div style={{ color: C.muted, fontSize: 10 }}>📞 {contact.phone}</div>}
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
          {!contact.manual && (
            <button onClick={function() { setShowPaste(!showPaste); }}
              style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 6, padding: "5px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>✏</button>
          )}
          {onEdit && (
            <button onClick={onEdit}
              style={{ background: "transparent", border: "1px solid " + C.accent + "60", color: C.accent, borderRadius: 6, padding: "5px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>✏ Edit</button>
          )}
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
      {(contact.verification_confidence === "LOW" || contact.verified_source === "scraped") && !contact.manual && (
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

// ─── EventCard ────────────────────────────────────────────────────────────────
var RELEVANCE_OPTS = ["Speaker", "Sponsor", "Exhibitor", "Confirmed Attendee", "Likely"];
var RELEVANCE_ICON = { "Speaker": "🎤", "Sponsor": "💰", "Exhibitor": "🏢", "Confirmed Attendee": "✅", "Likely": "🔍" };
var RELEVANCE_COLOR = { "Speaker": "green", "Sponsor": "gold", "Exhibitor": "purple", "Confirmed Attendee": "accent", "Likely": "muted" };

function EventCard({ event, contactNames, onUpdate, onDismiss }) {
  var s1 = useState(false); var editing = s1[0]; var setEditing = s1[1];
  var s2 = useState(event); var draft = s2[0]; var setDraft = s2[1];
  var s3 = useState(event.notes || ""); var notes = s3[0]; var setNotes = s3[1];

  var inp = { background: C.surface, border: "1px solid " + C.border, borderRadius: 5, padding: "4px 8px", color: C.text, fontSize: 11, fontFamily: "inherit", outline: "none", width: "100%" };

  function save() {
    var updated = Object.assign({}, draft, { notes: notes });
    onUpdate(updated);
    setEditing(false);
  }

  var isLikely = (event.tier || (event.relevance === "Likely" ? "likely" : "confirmed")) === "likely";
  var rc = RELEVANCE_COLOR[event.relevance] || (isLikely ? "muted" : "accent");
  var ri = RELEVANCE_ICON[event.relevance] || (isLikely ? "🔍" : "✅");
  var tierBorderColor = isLikely ? C.dim : C.green;

  if (editing) {
    return (
      <div style={{ background: C.surface, borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: "1px solid " + C.accent + "50" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>EVENT NAME</div>
            <input style={inp} value={draft.name} onChange={function(e){ setDraft(function(p){ return Object.assign({},p,{name:e.target.value}); }); }} />
          </div>
          <div>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>DATE</div>
            <input style={inp} value={draft.date} onChange={function(e){ setDraft(function(p){ return Object.assign({},p,{date:e.target.value}); }); }} placeholder="e.g. May 2025" />
          </div>
          <div>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>LOCATION</div>
            <input style={inp} value={draft.location} onChange={function(e){ setDraft(function(p){ return Object.assign({},p,{location:e.target.value}); }); }} placeholder="City, Country" />
          </div>
          <div>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>RELEVANCE</div>
            <select style={Object.assign({},inp,{cursor:"pointer"})} value={draft.relevance} onChange={function(e){ setDraft(function(p){ return Object.assign({},p,{relevance:e.target.value}); }); }}>
              {RELEVANCE_OPTS.map(function(o){ return <option key={o} value={o}>{RELEVANCE_ICON[o]} {o}</option>; })}
            </select>
          </div>
          <div>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>LINKED CONTACT</div>
            <select style={Object.assign({},inp,{cursor:"pointer"})} value={draft.contact} onChange={function(e){ setDraft(function(p){ return Object.assign({},p,{contact:e.target.value}); }); }}>
              <option value="">None</option>
              {(contactNames||[]).map(function(n){ return <option key={n} value={n}>{n}</option>; })}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>SOURCE URL</div>
            <input style={inp} value={draft.url} onChange={function(e){ setDraft(function(p){ return Object.assign({},p,{url:e.target.value}); }); }} placeholder="https://..." />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>NOTES</div>
            <textarea style={Object.assign({},inp,{resize:"vertical",minHeight:48})} value={notes} onChange={function(e){ setNotes(e.target.value); }} placeholder="e.g. Book a meeting with Sarah at this event" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={save} style={{ background: C.accent, color: "#000", border: "none", borderRadius: 5, padding: "5px 12px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
          <button onClick={function(){ setDraft(event); setNotes(event.notes||""); setEditing(false); }} style={{ background: "transparent", border: "1px solid " + C.border, color: C.muted, borderRadius: 5, padding: "5px 10px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
        </div>
      </div>
    );
  }

  var confirmedContacts = (event.contacts_attending||[]).filter(function(ca){ return ca && ca.name; });

  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: "1px solid " + C.border, borderLeft: "3px solid " + tierBorderColor }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>{event.name}</span>
            <Badge color={rc} sm>{ri} {event.relevance}</Badge>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
            {event.date && <span style={{ color: C.muted, fontSize: 10 }}>📅 {event.date}</span>}
            {event.location && <span style={{ color: C.muted, fontSize: 10 }}>📍 {event.location}</span>}
            {event.url && <a href={event.url} target="_blank" rel="noreferrer" style={{ color: C.accent, fontSize: 10, textDecoration: "none" }}>🔗 Source</a>}
          </div>

          {isLikely && event.reasoning && (
            <div style={{ borderLeft: "2px solid " + C.dim, paddingLeft: 7, marginBottom: 6 }}>
              <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 2 }}>BASIS</div>
              <div style={{ color: C.muted, fontSize: 10 }}>{event.reasoning}
                {event.reasoning_url && <a href={event.reasoning_url} target="_blank" rel="noreferrer" style={{ color: C.accent, marginLeft: 6, textDecoration: "none" }}>↗</a>}
              </div>
            </div>
          )}

          {!isLikely && confirmedContacts.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: C.green, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>🎯 Key Contacts Attending</div>
              {confirmedContacts.map(function(ca, i) {
                return (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div style={{ color: C.text, fontSize: 10, fontWeight: 700, marginBottom: 3 }}>
                      {ca.name}{ca.role ? <span style={{ color: C.muted, fontWeight: 400 }}> · {ca.role}</span> : null}
                    </div>
                    {ca.evidence_quote && (
                      <div style={{ borderLeft: "2px solid " + C.green + "60", paddingLeft: 7 }}>
                        <div style={{ color: C.muted, fontSize: 10, fontStyle: "italic", marginBottom: 2 }}>"{ca.evidence_quote}"</div>
                        <div style={{ color: C.dim, fontSize: 9 }}>
                          {ca.evidence_platform ? "— " + ca.evidence_platform + (ca.name ? " post by " + ca.name : "") : null}
                          {ca.evidence_url ? <a href={ca.evidence_url} target="_blank" rel="noreferrer" style={{ color: C.accent, marginLeft: 6, textDecoration: "none" }}>↗</a> : null}
                        </div>
                      </div>
                    )}
                    {!ca.evidence_quote && ca.evidence_url && (
                      <div style={{ color: C.dim, fontSize: 9, paddingLeft: 9 }}>
                        <a href={ca.evidence_url} target="_blank" rel="noreferrer" style={{ color: C.accent, textDecoration: "none" }}>View source ↗</a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isLikely && confirmedContacts.length === 0 && event.source_post && (
            <div style={{ borderLeft: "2px solid " + C.muted, paddingLeft: 7, marginBottom: 6 }}>
              <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 2 }}>CONFIRMATION</div>
              <div style={{ color: C.muted, fontSize: 10, fontStyle: "italic" }}>"{event.source_post}"</div>
            </div>
          )}

          {event.notes && <div style={{ color: C.gold, fontSize: 10, marginTop: 4, fontStyle: "italic" }}>"{event.notes}"</div>}
          {!event.notes && (
            <div style={{ marginTop: 4 }}>
              <input placeholder="Add notes (e.g. book meeting with Sarah here)..." style={{ background: "transparent", border: "none", borderBottom: "1px solid " + C.dim, color: C.dim, fontSize: 10, outline: "none", fontFamily: "inherit", width: "100%", padding: "2px 0" }}
                onBlur={function(e){ if (e.target.value.trim()) { onUpdate(Object.assign({}, event, { notes: e.target.value.trim() })); } }}
                onKeyDown={function(e){ if (e.key === "Enter" && e.target.value.trim()) { onUpdate(Object.assign({}, event, { notes: e.target.value.trim() })); e.target.blur(); } }} />
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={function(){ setEditing(true); }} style={{ background: "transparent", border: "1px solid " + C.border, color: C.muted, borderRadius: 4, padding: "3px 7px", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>✏ Edit</button>
          <button onClick={onDismiss} style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 4, padding: "3px 7px", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }} title="Dismiss">✕</button>
        </div>
      </div>
    </div>
  );
}

// ─── EventsSection ────────────────────────────────────────────────────────────
function EventsSection({ initEvents, contactNames, onEventsUpdate }) {
  var s1 = useState(function(){ return (initEvents||[]).filter(function(e){ return !e.dismissed; }); });
  var events = s1[0]; var setEvents = s1[1];
  var s2 = useState(false); var addingNew = s2[0]; var setAddingNew = s2[1];
  var s3 = useState({ name:"", date:"", location:"", relevance:"Confirmed Attendee", contacts_attending:[], confirmation_source:"", source_post:"", url:"", notes:"" });
  var newEvt = s3[0]; var setNewEvt = s3[1];

  var inp = { background: C.surface, border: "1px solid " + C.border, borderRadius: 5, padding: "4px 8px", color: C.text, fontSize: 11, fontFamily: "inherit", outline: "none", width: "100%" };

  function updateEvent(updated) {
    var next = events.map(function(e){ return e.id === updated.id ? updated : e; });
    setEvents(next);
    if (onEventsUpdate) onEventsUpdate(next);
  }

  function dismissEvent(id) {
    var next = events.filter(function(e){ return e.id !== id; });
    setEvents(next);
    if (onEventsUpdate) onEventsUpdate(next);
  }

  function addEvent() {
    if (!newEvt.name.trim()) return;
    var e = Object.assign({}, newEvt, { id: "evt_" + Date.now(), dismissed: false, name: newEvt.name.trim() });
    var next = events.concat([e]);
    setEvents(next);
    if (onEventsUpdate) onEventsUpdate(next);
    setNewEvt({ name:"", date:"", location:"", relevance:"Confirmed Attendee", contacts_attending:[], confirmation_source:"", source_post:"", url:"", notes:"" });
    setAddingNew(false);
  }

  var confirmedEvts = events.filter(function(e){ return (e.tier||"confirmed") !== "likely"; });
  var likelyEvts    = events.filter(function(e){ return (e.tier||"confirmed") === "likely"; });
  var countLabel = "";
  if (confirmedEvts.length || likelyEvts.length) {
    var parts = [];
    if (confirmedEvts.length) parts.push(confirmedEvts.length + " confirmed");
    if (likelyEvts.length)    parts.push(likelyEvts.length + " likely");
    countLabel = " (" + parts.join(", ") + ")";
  }

  function renderGroup(group) {
    return group.map(function(evt) {
      return <EventCard key={evt.id} event={evt} contactNames={contactNames} onUpdate={updateEvent} onDismiss={function(){ dismissEvent(evt.id); }} />;
    });
  }

  return (
    <Sec title={"🗓️ Upcoming Industry Events" + countLabel} accent={C.green} open={false}>
      {events.length === 0 && !addingNew && (
        <div style={{ color: C.dim, fontSize: 11, textAlign: "center", padding: "12px 0" }}>No confirmed event attendance found in the next 90 days.</div>
      )}
      {confirmedEvts.length > 0 && (
        <div>
          <div style={{ color: C.green, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>✅ Confirmed</div>
          {renderGroup(confirmedEvts)}
        </div>
      )}
      {likelyEvts.length > 0 && (
        <div style={{ marginTop: confirmedEvts.length ? 10 : 0 }}>
          {confirmedEvts.length > 0 && <div style={{ borderTop: "1px solid " + C.border, marginBottom: 10 }}/>}
          <div style={{ color: C.muted, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>🔍 Likely</div>
          {renderGroup(likelyEvts)}
        </div>
      )}
      {addingNew && (
        <div style={{ background: C.surface, borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: "1px solid " + C.accent + "50" }}>
          <div style={{ color: C.accent, fontSize: 10, fontWeight: 700, marginBottom: 8 }}>Add Event</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <input style={inp} value={newEvt.name} onChange={function(e){ setNewEvt(function(p){ return Object.assign({},p,{name:e.target.value}); }); }} placeholder="Event name *" />
            </div>
            <input style={inp} value={newEvt.date} onChange={function(e){ setNewEvt(function(p){ return Object.assign({},p,{date:e.target.value}); }); }} placeholder="Date (e.g. May 2025)" />
            <input style={inp} value={newEvt.location} onChange={function(e){ setNewEvt(function(p){ return Object.assign({},p,{location:e.target.value}); }); }} placeholder="Location" />
            <select style={Object.assign({},inp,{cursor:"pointer"})} value={newEvt.relevance} onChange={function(e){ setNewEvt(function(p){ return Object.assign({},p,{relevance:e.target.value}); }); }}>
              {RELEVANCE_OPTS.map(function(o){ return <option key={o} value={o}>{RELEVANCE_ICON[o]} {o}</option>; })}
            </select>
            <select style={Object.assign({},inp,{cursor:"pointer"})} value={newEvt.contact} onChange={function(e){ setNewEvt(function(p){ return Object.assign({},p,{contact:e.target.value}); }); }}>
              <option value="">No linked contact</option>
              {(contactNames||[]).map(function(n){ return <option key={n} value={n}>{n}</option>; })}
            </select>
            <div style={{ gridColumn: "1 / -1" }}>
              <input style={inp} value={newEvt.url} onChange={function(e){ setNewEvt(function(p){ return Object.assign({},p,{url:e.target.value}); }); }} placeholder="Source URL" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <textarea style={Object.assign({},inp,{resize:"vertical",minHeight:40})} value={newEvt.notes} onChange={function(e){ setNewEvt(function(p){ return Object.assign({},p,{notes:e.target.value}); }); }} placeholder="Notes" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={addEvent} style={{ background: C.accent, color: "#000", border: "none", borderRadius: 5, padding: "5px 12px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Add</button>
            <button onClick={function(){ setAddingNew(false); }} style={{ background: "transparent", border: "1px solid " + C.border, color: C.muted, borderRadius: 5, padding: "5px 10px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </div>
      )}
      {!addingNew && (
        <button onClick={function(){ setAddingNew(true); }} style={{ background: "transparent", border: "1px dashed " + C.border, color: C.dim, borderRadius: 7, padding: "7px 14px", fontSize: 10, cursor: "pointer", fontFamily: "inherit", width: "100%", marginTop: events.length ? 4 : 0 }}>
          + Add Event
        </button>
      )}
    </Sec>
  );
}

// ─── AnalysisView ─────────────────────────────────────────────────────────────
export default function AnalysisView({ data, onEventsUpdate, manualContacts, manualPartnerships, onUpdate }) {
  // ALL hooks declared unconditionally at the very top — NEVER move these
  var s1  = useState([]); var contacts = s1[0]; var setContacts = s1[1];
  var s2  = useState([]); var chat = s2[0]; var setChat = s2[1];
  var s3  = useState(""); var q = s3[0]; var setQ = s3[1];
  var s4  = useState(false); var asking = s4[0]; var setAsking = s4[1];
  // Manual contacts
  var s5  = useState([]); var manualContactsLocal = s5[0]; var setManualContactsLocal = s5[1];
  var s6  = useState(false); var addingContact = s6[0]; var setAddingContact = s6[1];
  var s7  = useState(null); var editingContactIdx = s7[0]; var setEditingContactIdx = s7[1];
  var s8  = useState(null); var enrichingContactIdx = s8[0]; var setEnrichingContactIdx = s8[1];
  // Analysis contact editing
  var s9  = useState(null); var editingAContactIdx = s9[0]; var setEditingAContactIdx = s9[1];
  // Partnerships
  var s10 = useState([]); var localPartnerships = s10[0]; var setLocalPartnerships = s10[1];
  var s11 = useState([]); var manualPartnershipsLocal = s11[0]; var setManualPartnershipsLocal = s11[1];
  var s12 = useState(false); var addingPartner = s12[0]; var setAddingPartner = s12[1];
  var s13 = useState(null); var editingPartnerIdx = s13[0]; var setEditingPartnerIdx = s13[1];
  var s14 = useState(null); var enrichingPartnerIdx = s14[0]; var setEnrichingPartnerIdx = s14[1];
  var s15 = useState(null); var editingAPartnerIdx = s15[0]; var setEditingAPartnerIdx = s15[1];
  var chatRef = useRef(null);

  // Effects after ALL hooks
  useEffect(function() {
    setContacts(Array.isArray(data.key_contacts) ? data.key_contacts : []);
  }, [data.key_contacts]);

  useEffect(function() {
    setLocalPartnerships(Array.isArray(data.partnerships) ? data.partnerships : []);
  }, [data.partnerships]);

  useEffect(function() {
    setManualContactsLocal(Array.isArray(manualContacts) ? manualContacts : []);
  }, [manualContacts]);

  useEffect(function() {
    setManualPartnershipsLocal(Array.isArray(manualPartnerships) ? manualPartnerships : []);
  }, [manualPartnerships]);

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

  async function saveManualContact(form, editIdx) {
    var contact = Object.assign({}, form, { manual: true });
    var newMC = manualContactsLocal.slice();
    var targetIdx;
    if (editIdx !== null && editIdx >= 0) { newMC[editIdx] = contact; targetIdx = editIdx; }
    else { newMC.push(contact); targetIdx = newMC.length - 1; }
    setManualContactsLocal(newMC);
    setAddingContact(false); setEditingContactIdx(null);
    if (onUpdate) onUpdate({ manualContacts: newMC });
    setEnrichingContactIdx(targetIdx);
    try {
      var sq = '"' + contact.name + '" ' + data.company + (contact.title ? ' "' + contact.title + '"' : '');
      var results = await tavilySearch(sq);
      var liResult = results.find(function(r) { return r.url && r.url.toLowerCase().includes("linkedin.com/in/"); });
      if (liResult && !contact.linkedin) {
        var enriched = Object.assign({}, contact, { linkedin: liResult.url, verified_source: "web_confirmed" });
        setManualContactsLocal(function(prev) {
          var updated = prev.slice();
          if (updated[targetIdx] && updated[targetIdx].name === contact.name) updated[targetIdx] = enriched;
          return updated;
        });
        if (onUpdate) {
          var finalMC = newMC.map(function(c, i) { return i === targetIdx ? enriched : c; });
          onUpdate({ manualContacts: finalMC });
        }
      }
    } catch(e) {}
    setEnrichingContactIdx(null);
  }

  function deleteManualContact(idx) {
    var newMC = manualContactsLocal.filter(function(_, i) { return i !== idx; });
    setManualContactsLocal(newMC);
    if (onUpdate) onUpdate({ manualContacts: newMC });
  }

  function saveAnalysisContact(form, idx) {
    var updated = contacts.slice();
    updated[idx] = Object.assign({}, updated[idx], form);
    setContacts(updated);
    setEditingAContactIdx(null);
    if (onUpdate) onUpdate({ analysisContacts: updated });
  }

  async function saveManualPartnership(form, editIdx) {
    var partnership = Object.assign({}, form, { manual: true });
    var newMP = manualPartnershipsLocal.slice();
    var targetIdx;
    if (editIdx !== null && editIdx >= 0) { newMP[editIdx] = partnership; targetIdx = editIdx; }
    else { newMP.push(partnership); targetIdx = newMP.length - 1; }
    setManualPartnershipsLocal(newMP);
    setAddingPartner(false); setEditingPartnerIdx(null);
    var isCrypto = isCryptoProvider(partnership.partnerName);
    var updatePayload = { manualPartnerships: newMP };
    if (isCrypto && partnership.status === "Active") updatePayload.cryptoPartnerAdd = partnership.partnerName;
    if (onUpdate) onUpdate(updatePayload);
    setEnrichingPartnerIdx(targetIdx);
    try {
      var sq2 = '"' + data.company + '" "' + partnership.partnerName + '" partnership';
      var results2 = await tavilySearch(sq2);
      if (results2.length > 0) {
        var srcResult = results2[0];
        var enriched2 = Object.assign({}, partnership, { sourceUrl: partnership.sourceUrl || srcResult.url || "" });
        setManualPartnershipsLocal(function(prev) {
          var upd = prev.slice();
          if (upd[targetIdx] && upd[targetIdx].partnerName === partnership.partnerName) upd[targetIdx] = enriched2;
          return upd;
        });
        if (onUpdate) {
          var finalMP = newMP.map(function(p, i) { return i === targetIdx ? enriched2 : p; });
          onUpdate({ manualPartnerships: finalMP });
        }
      }
    } catch(e) {}
    setEnrichingPartnerIdx(null);
  }

  function deleteManualPartnership(idx) {
    var newMP = manualPartnershipsLocal.filter(function(_, i) { return i !== idx; });
    setManualPartnershipsLocal(newMP);
    if (onUpdate) onUpdate({ manualPartnerships: newMP });
  }

  function saveAnalysisPartnership(form, idx) {
    var updated = localPartnerships.slice();
    updated[idx] = Object.assign({}, updated[idx], { partner: form.partnerName || updated[idx].partner, type: form.type || updated[idx].type, notes: form.notes });
    setLocalPartnerships(updated);
    setEditingAPartnerIdx(null);
    if (onUpdate) onUpdate({ analysisPartnerships: updated });
  }

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

  var totalContacts = contacts.length + manualContactsLocal.length;
  var totalPartnerships = localPartnerships.length + manualPartnershipsLocal.length;

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
          {data.model_used === 'grok-3'
            ? <span style={{ background:"#06B6D422", border:"1px solid #06B6D460", color:"#06B6D4", borderRadius:20, padding:"2px 10px", fontSize:10, fontWeight:700 }}>⚡ Powered by Grok</span>
            : data.model_used === 'claude'
              ? <span title={data.grok_error || ''} style={{ background:"#F59E0B22", border:"1px solid #F59E0B60", color:"#F59E0B", borderRadius:20, padding:"2px 10px", fontSize:10, fontWeight:700, cursor:"help" }}>🤖 Claude{data.grok_error ? " (Grok: " + data.grok_error.slice(0, 60) + ")" : " (Grok unavailable)"}</span>
              : null}
        </div>
        {data.executive_summary && <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.7 }}>{data.executive_summary}</div>}
      </div>

      {/* ARR */}
      {(t.projected_arr || t.likely_arr_usd) && (
        <Sec title="💰 ARR Potential" accent={C.green}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
            {t.tam_usd && <Chip label="TAM (ref)" value={t.tam_usd} color={C.muted} />}
            {(t.som || t.som_usd) && <Chip label="SOM" value={t.som || t.som_usd} color={C.accent} />}
            {(t.projected_arr || t.likely_arr_usd) && <Chip label="Projected ARR" value={t.projected_arr || t.likely_arr_usd} color={C.green} />}
            {(t.upside_arr || t.upside_arr_usd) && <Chip label="Upside ARR" value={t.upside_arr || t.upside_arr_usd} color={C.gold} />}
          </div>
          {t.som_calculation && (
            <div style={{ background: C.bg, border: "1px solid " + C.border, borderRadius: 6, padding: "8px 12px", marginBottom: 8 }}>
              <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>📐 Bottoms-Up Calculation</div>
              <div style={{ color: C.cyan, fontSize: 11, lineHeight: 1.7, fontFamily: "monospace" }}>{t.som_calculation}</div>
            </div>
          )}
          {(t.assumptions || []).map(function(a, i) { return <div key={i} style={{ color: C.dim, fontSize: 11, marginBottom: 4 }}>• {a}</div>; })}
        </Sec>
      )}

      {/* Key Contacts */}
      <Sec title={"👥 Key Contacts" + (totalContacts ? " (" + totalContacts + ")" : "")} accent={C.cyan} open={true}>
        {/* Analysis contacts */}
        {contacts.length === 0 && manualContactsLocal.length === 0 && !addingContact && (
          <div style={{ color: C.dim, fontSize: 11, textAlign: "center", padding: 20 }}>No contacts found. Add a NinjaPear key for verified executives, or add manually below.</div>
        )}
        {contacts.map(function(c, i) {
          return (function(){
            if (editingAContactIdx === i) {
              return (
                <ContactInlineForm
                  key={"edit-ac-" + i}
                  initial={{ name: c.name, title: c.title, email: c.email || "", linkedin: c.linkedin || "", phone: c.phone || "", notes: c.outreach_angle || "", status: c.verified_source === "ninjapear" ? "Confirmed" : "Unverified" }}
                  onSave={function(form) { saveAnalysisContact(form, i); }}
                  onCancel={function() { setEditingAContactIdx(null); }}
                  accentColor={C.cyan}
                />
              );
            }
            return (
              <ContactCard
                key={i}
                contact={c}
                company={data.company}
                onRemove={function(){ setContacts(function(prev){ return prev.filter(function(_,j){ return j!==i; }); }); }}
                onEdit={function() { setEditingAContactIdx(i); setEditingContactIdx(null); setAddingContact(false); }}
              />
            );
          })();
        })}

        {/* Manual contacts */}
        {manualContactsLocal.length > 0 && contacts.length > 0 && (
          <div style={{ borderTop: "1px solid " + C.border, marginTop: 8, paddingTop: 8, marginBottom: 4 }}>
            <div style={{ color: C.purple, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>✏️ Added Manually</div>
          </div>
        )}
        {manualContactsLocal.map(function(c, i) {
          return (function(){
            if (editingContactIdx === i) {
              return (
                <ContactInlineForm
                  key={"edit-mc-" + i}
                  initial={c}
                  onSave={function(form) { saveManualContact(form, i); }}
                  onCancel={function() { setEditingContactIdx(null); }}
                />
              );
            }
            return (
              <ContactCard
                key={"mc-" + i}
                contact={c}
                company={data.company}
                enriching={enrichingContactIdx === i}
                onEdit={function() { setEditingContactIdx(i); setEditingAContactIdx(null); setAddingContact(false); }}
                onRemove={function() { deleteManualContact(i); }}
              />
            );
          })();
        })}

        {/* Add contact form */}
        {addingContact && (
          <ContactInlineForm
            onSave={function(form) { saveManualContact(form, null); }}
            onCancel={function() { setAddingContact(false); }}
          />
        )}

        {!addingContact && editingContactIdx === null && editingAContactIdx === null && (
          <button
            onClick={function() { setAddingContact(true); }}
            style={{ background: "transparent", border: "1px dashed " + C.border, color: C.dim, borderRadius: 7, padding: "7px 14px", fontSize: 10, cursor: "pointer", fontFamily: "inherit", width: "100%", marginTop: (totalContacts > 0) ? 8 : 0 }}>
            + Add Contact
          </button>
        )}
      </Sec>

      {/* Partnerships */}
      <Sec title={"🤝 Partnerships" + (totalPartnerships ? " (" + totalPartnerships + ")" : "")} accent={C.purple} open={totalPartnerships > 0}>
        {/* Analysis partnerships */}
        {localPartnerships.map(function(p, i) {
          return (function(){
            if (editingAPartnerIdx === i) {
              return (
                <PartnershipInlineForm
                  key={"edit-ap-" + i}
                  initial={{ partnerName: p.partner || "", type: p.type || "Other", status: "Active", dateAnnounced: "", sourceUrl: "", notes: p.cp_angle || p.what_they_provide || "" }}
                  onSave={function(form) { saveAnalysisPartnership(form, i); }}
                  onCancel={function() { setEditingAPartnerIdx(null); }}
                />
              );
            }
            return (
              <div key={i} style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", marginBottom: 8, border: "1px solid " + C.border }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>{p.partner}</span>
                      <Badge color="purple" sm>{p.type}</Badge>
                      {p.dependency && <Badge color={p.dependency === "Critical" ? "red" : p.dependency === "Important" ? "gold" : "muted"} sm>{p.dependency}</Badge>}
                    </div>
                    {p.what_they_provide && <div style={{ color: C.muted, fontSize: 11, marginBottom: 4 }}>{p.what_they_provide}</div>}
                    {p.cp_angle && <div style={{ color: C.accent, fontSize: 11 }}>🎯 {p.cp_angle}</div>}
                  </div>
                  <button onClick={function() { setEditingAPartnerIdx(i); setEditingPartnerIdx(null); setAddingPartner(false); }}
                    style={{ background: "transparent", border: "1px solid " + C.purple + "60", color: C.purple, borderRadius: 6, padding: "4px 8px", fontSize: 9, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, marginLeft: 8 }}>
                    ✏ Edit
                  </button>
                </div>
              </div>
            );
          })();
        })}

        {/* Manual partnerships */}
        {manualPartnershipsLocal.length > 0 && localPartnerships.length > 0 && (
          <div style={{ borderTop: "1px solid " + C.border, marginTop: 8, paddingTop: 8, marginBottom: 4 }}>
            <div style={{ color: C.purple, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>✏️ Added Manually</div>
          </div>
        )}
        {manualPartnershipsLocal.map(function(p, i) {
          return (function(){
            if (editingPartnerIdx === i) {
              return (
                <PartnershipInlineForm
                  key={"edit-mp-" + i}
                  initial={p}
                  onSave={function(form) { saveManualPartnership(form, i); }}
                  onCancel={function() { setEditingPartnerIdx(null); }}
                />
              );
            }
            if (enrichingPartnerIdx === i) {
              return (
                <div key={"enrich-mp-" + i} style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", marginBottom: 8, border: "1px solid " + C.purple + "40" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>{p.partnerName}</span>
                    <span style={{ color: C.purple, fontSize: 10, fontStyle: "italic" }}>🔍 Verifying partnership...</span>
                  </div>
                </div>
              );
            }
            return (
              <div key={"mp-" + i} style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", marginBottom: 8, border: "1px solid " + C.border }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ color: C.text, fontWeight: 700, fontSize: 12 }}>{p.partnerName}</span>
                      <Badge color="purple" sm>{p.type}</Badge>
                      <Badge color={p.status === "Active" ? "green" : p.status === "Expired" ? "red" : "muted"} sm>{p.status}</Badge>
                      <Badge color="purple" sm>✏️ Manual</Badge>
                      {isCryptoProvider(p.partnerName) && <Badge color="cyan" sm>🔐 Crypto</Badge>}
                    </div>
                    {p.dateAnnounced && <div style={{ color: C.dim, fontSize: 10, marginBottom: 2 }}>📅 {p.dateAnnounced}</div>}
                    {p.notes && <div style={{ color: C.muted, fontSize: 11, marginBottom: 4 }}>{p.notes}</div>}
                    {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" style={{ color: C.accent, fontSize: 10, textDecoration: "none" }}>🔗 Source</a>}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: 8 }}>
                    <button onClick={function() { setEditingPartnerIdx(i); setEditingAPartnerIdx(null); setAddingPartner(false); }}
                      style={{ background: "transparent", border: "1px solid " + C.purple + "60", color: C.purple, borderRadius: 6, padding: "4px 8px", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
                      ✏ Edit
                    </button>
                    <button onClick={function() { deleteManualPartnership(i); }}
                      style={{ background: "transparent", border: "1px solid " + C.red + "40", color: C.red, borderRadius: 6, padding: "4px 8px", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })();
        })}

        {totalPartnerships === 0 && !addingPartner && (
          <div style={{ color: C.dim, fontSize: 11, textAlign: "center", padding: "12px 0" }}>No partnerships found in analysis. Add manually below.</div>
        )}

        {addingPartner && (
          <PartnershipInlineForm
            onSave={function(form) { saveManualPartnership(form, null); }}
            onCancel={function() { setAddingPartner(false); }}
          />
        )}

        {!addingPartner && editingPartnerIdx === null && editingAPartnerIdx === null && (
          <button
            onClick={function() { setAddingPartner(true); }}
            style={{ background: "transparent", border: "1px dashed " + C.border, color: C.dim, borderRadius: 7, padding: "7px 14px", fontSize: 10, cursor: "pointer", fontFamily: "inherit", width: "100%", marginTop: totalPartnerships > 0 ? 8 : 0 }}>
            + Add Partnership
          </button>
        )}
      </Sec>

      {/* Upcoming Events */}
      <EventsSection
        initEvents={data.upcoming_events || []}
        contactNames={(data.key_contacts || contacts).map(function(c){ return c.name; })}
        onEventsUpdate={onEventsUpdate}
      />

      {/* Competitive */}
      {cc.coinpayments && (
        <Sec title="💡 Value Prop & Comparison" accent={C.gold} open={false}>
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
            var srcType = s.source_type || (s.type === "X_Signal" ? "X Post" : "Web");
            var srcColor = srcType === "X Post" ? C.text : srcType.startsWith("News") ? C.accent : srcType.startsWith("LinkedIn") ? "#0A66C2" : srcType === "Press Release" ? C.green : C.muted;
            var rawUrl = s.source_url;
            var urlPath = rawUrl ? rawUrl.replace(/https?:\/\/(www\.)?[^/]+/, '').replace(/\/$/, '') : '';
            var hasUrl = rawUrl && rawUrl.startsWith("http") && urlPath.length >= 3;
            var isVerified = hasUrl && s.verified !== false;
            var isGrokKnowledge = !hasUrl || srcType === "Grok real-time knowledge";
            return (
              <div key={i} style={{ padding: "10px 12px", background: C.surface, borderRadius: 7, marginBottom: 6, border: "1px solid " + (isVerified ? C.cyan + "40" : C.border) }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
                  <Badge color="cyan" sm>{s.type}</Badge>
                  <span style={{ background: srcColor + "22", border: "1px solid " + srcColor + "50", color: srcColor, borderRadius: 10, padding: "1px 7px", fontSize: 9, fontWeight: 700 }}>{srcType}</span>
                  {isVerified && <span style={{ fontSize: 10, color: C.green }} title="Source URL verified">✅</span>}
                  {isGrokKnowledge && <span style={{ fontSize: 10, color: C.muted }} title="Based on Grok real-time knowledge — no specific URL available">🧠</span>}
                  {s.date && <span style={{ color: C.dim, fontSize: 10 }}>{s.date}</span>}
                </div>
                <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.5, marginBottom: 4 }}>{s.signal}</div>
                {s.implication && <div style={{ color: C.accent, fontSize: 10, marginBottom: 5 }}>→ {s.implication}</div>}
                {isVerified
                  ? <a href={s.source_url} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan, fontSize: 10, textDecoration: "none", fontWeight: 600 }}>→ View Source</a>
                  : <span style={{ color: C.dim, fontSize: 10 }}>Source: Grok real-time knowledge</span>}
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
