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

// ─── ContactCard ──────────────────────────────────────────────────────────────
export function ContactCard({ contact, company, onRemove }) {
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

// ─── AnalysisView (placeholder — replaced in next commit) ─────────────────────
export default function AnalysisView() { return null; }
