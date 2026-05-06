import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import AnalysisView from "./AnalysisView";

const BULK_LS = "cp_bulk_progress";
const BATCH_SIZE = 3;

const C = {
  bg:"#07090F", surface:"#0D1117", card:"#111827", border:"#1F2937",
  accent:"#00C2FF", accentDim:"#00C2FF12", gold:"#F59E0B", goldDim:"#F59E0B12",
  green:"#10B981", greenDim:"#10B98112", red:"#EF4444", redDim:"#EF444412",
  purple:"#8B5CF6", cyan:"#06B6D4", text:"#F1F5F9", muted:"#94A3B8", dim:"#334155",
};

var SEGMENT_OPTS = [
  { id: "", label: "Auto-detect" },
  { id: "financial_services", label: "Financial Services" },
  { id: "luxury_travel", label: "Luxury Travel" },
  { id: "luxury_goods", label: "Luxury Goods" },
  { id: "gaming_casinos", label: "Gaming & Casinos" },
];

var PRIORITY_OPTS = [
  { id: "p1", label: "P1 - High" },
  { id: "p2", label: "P2 - Standard" },
];

var STATUS_ICON = { queued: "⏳", analyzing: "🔄", done: "✅", failed: "❌" };
var STATUS_COLOR = { queued: C.muted, analyzing: C.accent, done: C.green, failed: C.red };

function parseText(text) {
  var lines = text.trim().split(/\r?\n/).filter(function(l) { return l.trim(); });
  if (!lines.length) return [];
  var firstLower = lines[0].toLowerCase();
  var hasHeader = firstLower.includes("company") || firstLower.includes("name") || firstLower.includes("website");
  var firstCells = lines[0].split(",");
  var isMultiCol = firstCells.length > 1;
  if (isMultiCol && hasHeader) {
    var headers = firstCells.map(function(h) { return h.trim().toLowerCase().replace(/['"]/g, ""); });
    var nameIdx = headers.findIndex(function(h) { return h.includes("company") || h === "name"; });
    var websiteIdx = headers.findIndex(function(h) { return h.includes("website") || h.includes("domain"); });
    var segmentIdx = headers.findIndex(function(h) { return h.includes("segment") || h.includes("vertical"); });
    var priorityIdx = headers.findIndex(function(h) { return h.includes("priority"); });
    if (nameIdx < 0) nameIdx = 0;
    return lines.slice(1).map(function(line, i) {
      var cells = line.split(",").map(function(c) { return c.trim().replace(/^["']|["']$/g, ""); });
      var name = cells[nameIdx] || "";
      if (!name) return null;
      return {
        id: "c_" + i + "_" + Date.now(),
        name: name,
        website: websiteIdx >= 0 ? (cells[websiteIdx] || "") : "",
        segment: segmentIdx >= 0 ? (cells[segmentIdx] || "") : "",
        priority: priorityIdx >= 0 ? (cells[priorityIdx] || "") : "",
      };
    }).filter(Boolean);
  }
  var startIdx = hasHeader ? 1 : 0;
  return lines.slice(startIdx).map(function(line, i) {
    var name = line.split(",")[0].trim().replace(/^["']|["']$/g, "");
    return name ? { id: "c_" + i + "_" + Date.now(), name: name, website: "", segment: "", priority: "" } : null;
  }).filter(Boolean);
}

function parseXLSXBuffer(buffer) {
  try {
    var wb = XLSX.read(buffer, { type: "array" });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    return rows.map(function(row, i) {
      var name = String(row["Company Name"] || row["company_name"] || row["Company"] || row["Name"] || row["company"] || row["name"] || "").trim();
      if (!name) return null;
      return {
        id: "c_" + i + "_" + Date.now(),
        name: name,
        website: String(row["Website"] || row["website"] || row["Domain"] || row["domain"] || ""),
        segment: String(row["Segment"] || row["segment"] || row["Vertical"] || row["vertical"] || ""),
        priority: String(row["Priority"] || row["priority"] || ""),
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

function downloadTemplate() {
  var wb = XLSX.utils.book_new();
  var data = [
    ["Company Name", "Website", "Segment", "Priority"],
    ["Stripe", "stripe.com", "financial_services", "p1"],
    ["Revolut", "revolut.com", "financial_services", "p1"],
    ["MGM Resorts", "mgmresorts.com", "gaming_casinos", "p2"],
  ];
  var ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 25 }, { wch: 20 }, { wch: 25 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "Companies");
  XLSX.writeFile(wb, "bulk_analysis_template.xlsx");
}

export default function BulkAnalyze({ runAnalysis, tKey, njKey, addResultsToPipeline }) {
  var s1 = useState(function() {
    try {
      var saved = JSON.parse(localStorage.getItem(BULK_LS) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch(e) { return []; }
  }); var companies = s1[0]; var setCompanies = s1[1];

  var s2 = useState(false); var running = s2[0]; var setRunning = s2[1];
  var s3 = useState(""); var pasteText = s3[0]; var setPasteText = s3[1];
  var s4 = useState(""); var defSegment = s4[0]; var setDefSegment = s4[1];
  var s5 = useState("p1"); var defPriority = s5[0]; var setDefPriority = s5[1];
  var s6 = useState({}); var checked = s6[0]; var setChecked = s6[1];
  var s7 = useState(null); var viewingResult = s7[0]; var setViewingResult = s7[1];
  var s8 = useState(false); var multiFailWarn = s8[0]; var setMultiFailWarn = s8[1];
  var s9 = useState(false); var showPaste = s9[0]; var setShowPaste = s9[1];
  var s10 = useState(false); var addedMsg = s10[0]; var setAddedMsg = s10[1];

  var runningRef = useRef(false);
  var stopRef = useRef(false);
  var fileRef = useRef(null);

  useEffect(function() {
    try { localStorage.setItem(BULK_LS, JSON.stringify(companies)); } catch(e) {}
  }, [companies]);

  var totalCount = companies.length;
  var doneCount   = companies.filter(function(c) { return c.status === "done"; }).length;
  var failedCount = companies.filter(function(c) { return c.status === "failed"; }).length;
  var analyzingCount = companies.filter(function(c) { return c.status === "analyzing"; }).length;
  var queuedCount = companies.filter(function(c) { return c.status === "queued"; }).length;
  var allDone     = companies.filter(function(c) { return c.status === "done"; });
  var checkedDone = companies.filter(function(c) { return c.status === "done" && checked[c.id]; });
  var canStart    = queuedCount > 0 && !running;

  function loadRows(rows) {
    var withDefaults = rows.map(function(r) {
      return Object.assign({}, r, {
        segment: r.segment || defSegment,
        priority: r.priority || defPriority,
        status: "queued",
        result: null,
        error: null,
      });
    });
    setCompanies(withDefaults);
    setChecked({});
  }

  function handleFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var rows = file.name.match(/\.xlsx?$/i)
        ? parseXLSXBuffer(new Uint8Array(ev.target.result))
        : parseText(ev.target.result);
      loadRows(rows);
      setShowPaste(false);
      e.target.value = "";
    };
    if (file.name.match(/\.xlsx?$/i)) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  function handlePaste() {
    if (!pasteText.trim()) return;
    loadRows(parseText(pasteText));
    setPasteText("");
    setShowPaste(false);
  }

  async function processOne(idx, companyName) {
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var data = await runAnalysis(companyName, function() {}, { tavily: tKey, ninjapear: njKey });
        setCompanies(function(prev) {
          var upd = prev.slice();
          upd[idx] = Object.assign({}, upd[idx], { status: "done", result: data, error: null });
          return upd;
        });
        return true;
      } catch(e) {
        var msg = (e && e.message) || String(e);
        var isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many");
        if (isRateLimit && attempt < 2) {
          await new Promise(function(resolve) { setTimeout(resolve, 30000); });
          continue;
        }
        setCompanies(function(prev) {
          var upd = prev.slice();
          upd[idx] = Object.assign({}, upd[idx], { status: "failed", error: msg.slice(0, 140), result: null });
          return upd;
        });
        return false;
      }
    }
    return false;
  }

  async function startBulk() {
    if (runningRef.current || queuedCount === 0) return;
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setMultiFailWarn(false);

    var snapshot = companies.slice();
    var queue = [];
    snapshot.forEach(function(c, idx) {
      if (c.status === "queued") queue.push({ idx: idx, name: c.name });
    });

    for (var i = 0; i < queue.length; i += BATCH_SIZE) {
      if (stopRef.current) break;
      var batch = queue.slice(i, i + BATCH_SIZE);

      setCompanies(function(prev) {
        var upd = prev.slice();
        batch.forEach(function(b) {
          if (upd[b.idx] && upd[b.idx].status === "queued") {
            upd[b.idx] = Object.assign({}, upd[b.idx], { status: "analyzing" });
          }
        });
        return upd;
      });

      var results = await Promise.all(batch.map(function(b) { return processOne(b.idx, b.name); }));
      var allFailed = results.every(function(r) { return !r; });
      if (allFailed && batch.length > 1) { setMultiFailWarn(true); break; }
    }

    runningRef.current = false;
    setRunning(false);
  }

  async function retryOne(idx) {
    if (runningRef.current) return;
    setMultiFailWarn(false);
    setCompanies(function(prev) {
      var upd = prev.slice();
      upd[idx] = Object.assign({}, upd[idx], { status: "analyzing", error: null });
      return upd;
    });
    await processOne(idx, companies[idx].name);
  }

  function handleAddSelected() {
    var toAdd = checkedDone.map(function(c) { return { result: c.result, segment: c.segment, priority: c.priority }; });
    addResultsToPipeline(toAdd);
    setAddedMsg(true);
    setTimeout(function() { setAddedMsg(false); }, 2500);
  }

  function handleAddAll() {
    var toAdd = allDone.map(function(c) { return { result: c.result, segment: c.segment, priority: c.priority }; });
    addResultsToPipeline(toAdd);
    setAddedMsg(true);
    setTimeout(function() { setAddedMsg(false); }, 2500);
  }

  var inp = { background: C.bg, border: "1px solid " + C.border, borderRadius: 6, padding: "5px 8px", color: C.text, fontSize: 10, fontFamily: "inherit", outline: "none" };
  var btn = { border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

  if (viewingResult) {
    return (
      <div>
        <button onClick={function() { setViewingResult(null); }}
          style={{ background: "transparent", border: "1px solid " + C.border, color: C.muted, borderRadius: 7, padding: "6px 14px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", marginBottom: 16 }}>
          ← Back to Bulk Results
        </button>
        <AnalysisView data={viewingResult} />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ color: C.text, fontSize: 16, fontWeight: 800 }}>📋 Bulk Analyze</div>
          <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>Upload a CSV or Excel file to analyze multiple companies in parallel batches of {BATCH_SIZE}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={downloadTemplate}
            style={Object.assign({}, btn, { background: "transparent", border: "1px solid " + C.border, color: C.muted, padding: "5px 12px", fontSize: 10 })}>
            ⬇️ Download Template
          </button>
          {totalCount > 0 && (
            <button onClick={function() { if (!running) { setCompanies([]); setChecked({}); setMultiFailWarn(false); } }}
              disabled={running}
              style={Object.assign({}, btn, { background: "transparent", border: "1px solid " + C.border, color: running ? C.dim : C.red, padding: "5px 12px", fontSize: 10, opacity: running ? 0.4 : 1, cursor: running ? "default" : "pointer" })}>
              ✕ Clear All
            </button>
          )}
        </div>
      </div>

      {/* Upload section */}
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: "16px", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} style={{ display: "none" }} />
          <button onClick={function() { if (fileRef.current) fileRef.current.click(); }}
            style={Object.assign({}, btn, { background: C.accentDim, color: C.accent, border: "1px solid " + C.accent + "50" })}>
            📁 Upload CSV / Excel
          </button>
          <button onClick={function() { setShowPaste(!showPaste); }}
            style={Object.assign({}, btn, { background: showPaste ? C.surface : "transparent", color: showPaste ? C.text : C.muted, border: "1px solid " + C.border })}>
            {showPaste ? "▲ Hide" : "📝 Paste List"}
          </button>
          <span style={{ color: C.dim, fontSize: 10 }}>Supports .csv and .xlsx — columns: Company Name | Website | Segment | Priority</span>
        </div>

        {showPaste && (
          <div style={{ marginBottom: 12 }}>
            <textarea
              value={pasteText}
              onChange={function(e) { setPasteText(e.target.value); }}
              placeholder={"Stripe\nRevolut\nN26\nMonzo"}
              style={{ width: "100%", background: C.bg, border: "1px solid " + C.border, borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 12, outline: "none", fontFamily: "inherit", resize: "vertical", minHeight: 100, boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={handlePaste} disabled={!pasteText.trim()}
                style={Object.assign({}, btn, { background: C.accent, color: "#000", opacity: pasteText.trim() ? 1 : 0.4, cursor: pasteText.trim() ? "pointer" : "default" })}>
                Load Companies
              </button>
              <button onClick={function() { setShowPaste(false); setPasteText(""); }}
                style={Object.assign({}, btn, { background: "transparent", border: "1px solid " + C.border, color: C.muted })}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Default Segment</div>
            <select value={defSegment} onChange={function(e) { setDefSegment(e.target.value); }}
              style={Object.assign({}, inp, { cursor: "pointer" })}>
              {SEGMENT_OPTS.map(function(o) { return <option key={o.id} value={o.id}>{o.label}</option>; })}
            </select>
          </div>
          <div>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Default Priority</div>
            <select value={defPriority} onChange={function(e) { setDefPriority(e.target.value); }}
              style={Object.assign({}, inp, { cursor: "pointer" })}>
              {PRIORITY_OPTS.map(function(o) { return <option key={o.id} value={o.id}>{o.label}</option>; })}
            </select>
          </div>
          {totalCount > 0 && (
            <div style={{ color: C.muted, fontSize: 10, paddingBottom: 2 }}>
              <strong style={{ color: C.text }}>{totalCount}</strong> companies loaded
              {doneCount > 0 && <span style={{ color: C.green }}> · {doneCount} done</span>}
              {failedCount > 0 && <span style={{ color: C.red }}> · {failedCount} failed</span>}
              {queuedCount > 0 && <span> · {queuedCount} queued</span>}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar (visible while running) */}
      {running && (
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: C.text, fontSize: 11, fontWeight: 700 }}>
              Analyzing {doneCount + failedCount} of {totalCount} companies…
            </span>
            <span style={{ color: C.muted, fontSize: 10 }}>
              🔄 {analyzingCount} · ✅ {doneCount} · ❌ {failedCount}
            </span>
          </div>
          <div style={{ background: C.border, borderRadius: 999, height: 6, overflow: "hidden" }}>
            <div style={{
              background: "linear-gradient(90deg, " + C.accent + ", " + C.green + ")",
              height: "100%",
              width: Math.round((doneCount + failedCount) / Math.max(totalCount, 1) * 100) + "%",
              transition: "width 0.4s ease",
              borderRadius: 999,
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={function() { stopRef.current = true; }}
              style={Object.assign({}, btn, { background: C.redDim, color: C.red, border: "1px solid " + C.red + "40", padding: "4px 12px", fontSize: 10 })}>
              ⬛ Stop
            </button>
          </div>
        </div>
      )}

      {/* Multi-fail warning */}
      {multiFailWarn && !running && (
        <div style={{ background: C.goldDim, border: "1px solid " + C.gold + "50", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ color: C.gold, fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Multiple failures detected — API may be overloaded</div>
            <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.5 }}>All companies in the last batch failed. The Grok or Anthropic API may be temporarily overloaded. Wait a few minutes before retrying.</div>
            <button onClick={function() { setMultiFailWarn(false); startBulk(); }}
              style={Object.assign({}, btn, { background: C.gold, color: "#000", marginTop: 10, padding: "5px 14px", fontSize: 10 })}>
              🔄 Resume Analysis
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {totalCount > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={startBulk} disabled={!canStart}
            style={Object.assign({}, btn, { background: canStart ? C.accent : C.surface, color: canStart ? "#000" : C.dim, border: "1px solid " + (canStart ? C.accent : C.border), opacity: canStart ? 1 : 0.5, cursor: canStart ? "pointer" : "default" })}>
            {running ? "⟳ Running…" : ("▶ Start Bulk Analysis" + (queuedCount > 0 ? " (" + queuedCount + ")" : ""))}
          </button>
          {allDone.length > 0 && (
            <button onClick={handleAddAll}
              style={Object.assign({}, btn, { background: C.greenDim, color: C.green, border: "1px solid " + C.green + "50" })}>
              ✚ Add All to Pipeline ({allDone.length})
            </button>
          )}
          {checkedDone.length > 0 && (
            <button onClick={handleAddSelected}
              style={Object.assign({}, btn, { background: C.surface, color: C.accent, border: "1px solid " + C.accent + "50" })}>
              ✚ Add Selected ({checkedDone.length})
            </button>
          )}
          {addedMsg && <span style={{ color: C.green, fontSize: 10 }}>✅ Added to pipeline!</span>}
        </div>
      )}

      {/* Companies table */}
      {totalCount > 0 && (
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: C.surface }}>
                <th style={{ width: 36, padding: "8px 10px", borderBottom: "1px solid " + C.border, textAlign: "center" }}>
                  <input type="checkbox"
                    checked={allDone.length > 0 && checkedDone.length === allDone.length}
                    onChange={function(e) {
                      var next = {};
                      if (e.target.checked) allDone.forEach(function(c) { next[c.id] = true; });
                      setChecked(next);
                    }} />
                </th>
                {["Company", "Segment", "Priority", "Status", "ARR / Notes", ""].map(function(h, i) {
                  return <th key={i} style={{ padding: "8px 10px", textAlign: "left", color: C.dim, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid " + C.border }}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {companies.map(function(c, idx) {
                return (function() {
                  var arr = c.result && c.result.tam_som_arr ? (c.result.tam_som_arr.projected_arr || c.result.tam_som_arr.likely_arr_usd || "") : "";
                  var isChecked = !!(checked[c.id] && c.status === "done");
                  return (
                    <tr key={c.id} style={{ borderBottom: "1px solid " + C.border, background: idx % 2 === 0 ? "transparent" : C.surface + "50" }}>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        {c.status === "done" && (
                          <input type="checkbox" checked={isChecked}
                            onChange={function(e) { setChecked(function(prev) { return Object.assign({}, prev, { [c.id]: e.target.checked }); }); }} />
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", minWidth: 160 }}>
                        {c.status === "done"
                          ? <button onClick={function() { setViewingResult(c.result); }}
                              style={{ background: "none", border: "none", color: C.accent, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textAlign: "left" }}>
                              {c.name}
                            </button>
                          : <span style={{ color: C.text, fontWeight: 600 }}>{c.name}</span>
                        }
                        {c.result && c.result.hq && <div style={{ color: C.dim, fontSize: 9, marginTop: 1 }}>📍 {c.result.hq}</div>}
                        {c.website && <div style={{ color: C.dim, fontSize: 9 }}>🌐 {c.website}</div>}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <select value={c.segment || ""} onChange={function(e) {
                          setCompanies(function(prev) {
                            var upd = prev.slice(); upd[idx] = Object.assign({}, upd[idx], { segment: e.target.value }); return upd;
                          });
                        }} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 10, cursor: "pointer", fontFamily: "inherit", outline: "none", maxWidth: 130 }}>
                          {SEGMENT_OPTS.map(function(o) { return <option key={o.id} value={o.id}>{o.label}</option>; })}
                        </select>
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <select value={c.priority || "p1"} onChange={function(e) {
                          setCompanies(function(prev) {
                            var upd = prev.slice(); upd[idx] = Object.assign({}, upd[idx], { priority: e.target.value }); return upd;
                          });
                        }} style={{ background: "transparent", border: "none", color: c.priority === "p1" ? C.accent : C.muted, fontSize: 10, cursor: "pointer", fontFamily: "inherit", outline: "none" }}>
                          {PRIORITY_OPTS.map(function(o) { return <option key={o.id} value={o.id}>{o.label}</option>; })}
                        </select>
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        <span style={{ color: STATUS_COLOR[c.status] || C.muted, fontWeight: 700 }}>
                          {STATUS_ICON[c.status] || "⏳"} {c.status === "analyzing" ? "Analyzing…" : c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px", maxWidth: 200 }}>
                        {arr && <span style={{ color: C.green, fontWeight: 700 }}>{arr}</span>}
                        {c.result && c.result.segment && <div style={{ color: C.dim, fontSize: 9 }}>{c.result.segment}</div>}
                        {c.status === "failed" && c.error && (
                          <span style={{ color: C.red, fontSize: 9 }} title={c.error}>⚠ {c.error.slice(0, 50)}{c.error.length > 50 ? "…" : ""}</span>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {c.status === "failed" && (
                          <button onClick={function() { retryOne(idx); }}
                            style={{ background: "transparent", border: "1px solid " + C.border, color: C.accent, borderRadius: 5, padding: "3px 8px", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
                            🔄 Retry
                          </button>
                        )}
                        {c.status === "queued" && !running && (
                          <button onClick={function() { setCompanies(function(prev) { return prev.filter(function(x) { return x.id !== c.id; }); }); }}
                            style={{ background: "transparent", border: "none", color: C.dim, padding: "3px 6px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                        )}
                      </td>
                    </tr>
                  );
                })();
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {totalCount === 0 && (
        <div style={{ textAlign: "center", padding: "48px 20px", color: C.dim, background: C.card, borderRadius: 12, border: "1px solid " + C.border }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 13, marginBottom: 6, color: C.muted }}>Upload a CSV or Excel file to get started</div>
          <div style={{ fontSize: 11, marginBottom: 20, lineHeight: 1.6 }}>
            Or paste a list of company names above.
            <br />Expected columns: <strong style={{ color: C.text }}>Company Name</strong> | Website | Segment | Priority
          </div>
          <button onClick={downloadTemplate}
            style={Object.assign({}, btn, { background: C.accentDim, color: C.accent, border: "1px solid " + C.accent + "50" })}>
            ⬇️ Download Excel Template
          </button>
        </div>
      )}
    </div>
  );
}
