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
  { id: "tier_1", label: "Tier 1" },
  { id: "tier_2", label: "Tier 2" },
  { id: "tier_3", label: "Tier 3" },
];

var STATUS_ICON = { queued: "⏳", analyzing: "🔄", done: "✅", failed: "❌" };
var STATUS_COLOR = { queued: C.muted, analyzing: C.accent, done: C.green, failed: C.red };

var FS_TIER_MAP = [
  { id:"brokerage",    terms:["brokerage","broker","fx","fxbroker","proptrading","marketmaker","fxbroker","prop"] },
  { id:"escrow",       terms:["escrow","trust","escrowservice"] },
  { id:"remittance",   terms:["remittance","remittancefintech","remittancefintechs","crossborder","moneytransfer","mto","moneytransferoperator"] },
  { id:"regional_bank",terms:["regionalbank","corporatetreasury","treasury","corporatebanking","bank","corporatebank"] },
  { id:"neobanks",     terms:["neobanks","neobank","neobanking","digitalbank","digitalbanking","challengerbank"] },
];
var OTHER_TIER_MAP = [
  { id:"tier1", terms:["tier1","t1","premium","enterprise","top"] },
  { id:"tier2", terms:["tier2","t2","standard","midmarket","mid"] },
  { id:"tier3", terms:["tier3","t3","growth","emerging","small"] },
];

function normalizeTier(raw, vertical, rowNum) {
  if (!raw) return "";
  var lower = String(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!lower) return "";
  var isFS = !vertical || vertical === "financial_services";
  var map = isFS ? FS_TIER_MAP.concat(OTHER_TIER_MAP) : OTHER_TIER_MAP.concat(FS_TIER_MAP);
  // Exact id match
  for (var i = 0; i < map.length; i++) {
    if (lower === map[i].id.replace(/_/g, "")) return map[i].id;
  }
  // Exact term match
  for (var i = 0; i < map.length; i++) {
    for (var j = 0; j < map[i].terms.length; j++) {
      if (lower === map[i].terms[j]) return map[i].id;
    }
  }
  // Partial contains
  for (var i = 0; i < map.length; i++) {
    for (var j = 0; j < map[i].terms.length; j++) {
      var t = map[i].terms[j];
      if (lower.includes(t) || t.includes(lower)) return map[i].id;
    }
  }
  if (rowNum !== undefined) console.log("[BulkAnalyze] Row", rowNum + 1, "unmatched tier value:", JSON.stringify(raw));
  return "";
}

function normalizePriority(raw) {
  if (!raw) return "";
  var lower = String(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!lower) return "";
  if (lower === "1" || lower === "t1" || lower === "tier1" || lower === "p1" || lower === "tierone" || lower === "high" || lower === "priority1") return "tier_1";
  if (lower === "2" || lower === "t2" || lower === "tier2" || lower === "p2" || lower === "tiertwo" || lower === "standard" || lower === "priority2") return "tier_2";
  if (lower === "3" || lower === "t3" || lower === "tier3" || lower === "p3" || lower === "tierthree" || lower === "growth" || lower === "priority3") return "tier_3";
  return "";
}

function normalizeName(n) {
  return (n || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/^the\s+/, "");
}

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
    var priorityIdx = headers.findIndex(function(h) {
      return h === "priority" || h.includes("priority tier") || h.includes("tier level") || h === "p-tier";
    });
    var tierIdx = headers.findIndex(function(h) {
      return h === "tier" || h.includes("tier selection") || h.includes("sub-segment") ||
             h.includes("sub segment") || h.includes("subsegment") || h.includes("category");
    });
    if (nameIdx < 0) nameIdx = 0;
    return lines.slice(1).map(function(line, i) {
      var cells = line.split(",").map(function(c) { return c.trim().replace(/^["']|["']$/g, ""); });
      var name = cells[nameIdx] || "";
      if (!name) return null;
      var seg = segmentIdx >= 0 ? (cells[segmentIdx] || "") : "";
      var rawTier = tierIdx >= 0 ? (cells[tierIdx] || "") : "";
      var rawPriority = priorityIdx >= 0 ? (cells[priorityIdx] || "") : "";
      return {
        id: "c_" + i + "_" + Date.now(),
        name: name,
        website: websiteIdx >= 0 ? (cells[websiteIdx] || "") : "",
        segment: seg,
        tier: normalizeTier(rawTier, seg, i),
        priority: normalizePriority(rawPriority),
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
      var seg = String(row["Segment"] || row["segment"] || row["Vertical"] || row["vertical"] || "");
      var rawTier = String(row["Tier"] || row["tier"] || row["TIER"] || row["Tier Selection"] || row["Sub-segment"] || row["Sub Segment"] || row["Category"] || "");
      var rawPriority = String(row["Priority"] || row["priority"] || row["Priority Tier"] || row["Tier Level"] || row["P-Tier"] || "");
      return {
        id: "c_" + i + "_" + Date.now(),
        name: name,
        website: String(row["Website"] || row["website"] || row["Domain"] || row["domain"] || ""),
        segment: seg,
        tier: normalizeTier(rawTier, seg, i),
        priority: normalizePriority(rawPriority),
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

function downloadTemplate() {
  var wb = XLSX.utils.book_new();
  var data = [
    ["Company Name", "Website", "Segment", "Tier", "Priority"],
    ["Stripe", "stripe.com", "financial_services", "neobanks", "tier_1"],
    ["Revolut", "revolut.com", "financial_services", "neobanks", "tier_1"],
    ["MGM Resorts", "mgmresorts.com", "gaming_casinos", "", "tier_2"],
  ];
  var ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 25 }, { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "Companies");
  XLSX.writeFile(wb, "bulk_analysis_template.xlsx");
}

export default function BulkAnalyze({ runAnalysis, tKey, njKey, pipelineDeals, addResultsToPipeline, updateExistingInPipeline, initialUpdateMode }) {
  var s1 = useState(function() {
    try {
      var saved = JSON.parse(localStorage.getItem(BULK_LS) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch(e) { return []; }
  }); var companies = s1[0]; var setCompanies = s1[1];

  var s2 = useState(false); var running = s2[0]; var setRunning = s2[1];
  var s3 = useState(""); var pasteText = s3[0]; var setPasteText = s3[1];
  var s4 = useState(""); var defSegment = s4[0]; var setDefSegment = s4[1];
  var s5 = useState("tier_1"); var defPriority = s5[0]; var setDefPriority = s5[1];
  var s6 = useState({}); var checked = s6[0]; var setChecked = s6[1];
  var s7 = useState(null); var viewingResult = s7[0]; var setViewingResult = s7[1];
  var s8 = useState(false); var multiFailWarn = s8[0]; var setMultiFailWarn = s8[1];
  var s9 = useState(false); var showPaste = s9[0]; var setShowPaste = s9[1];
  var s10 = useState(null); var addedMsg = s10[0]; var setAddedMsg = s10[1];
  var s11 = useState(null); var addingProgress = s11[0]; var setAddingProgress = s11[1];
  var s12 = useState(initialUpdateMode || false); var updateMode = s12[0]; var setUpdateMode = s12[1];
  var s13 = useState(null); var updatePreview = s13[0]; var setUpdatePreview = s13[1];
  var s14 = useState(null); var confirmModal = s14[0]; var setConfirmModal = s14[1];
  var s15 = useState(""); var capInput = s15[0]; var setCapInput = s15[1];

  var runningRef = useRef(false);
  var stopRef = useRef(false);
  var fileRef = useRef(null);
  var pendingItemsRef = useRef([]);
  var mountChecked = useRef(false);
  var abortControllersRef = useRef({});

  useEffect(function() {
    try {
      var slim = companies.map(function(c) {
        var arr = c.result && c.result.tam_som_arr
          ? (c.result.tam_som_arr.projected_arr || c.result.tam_som_arr.likely_arr_usd || "")
          : "";
        return {
          id: c.id, name: c.name, website: c.website || "",
          segment: c.segment || "", priority: c.priority || "tier_1",
          status: c.status, error: c.error || null,
          resultSummary: c.result ? {
            company: c.result.company, segment: c.result.segment || "",
            hq: c.result.hq || "", arr: arr
          } : null
        };
      });
      localStorage.setItem(BULK_LS, JSON.stringify(slim));
    } catch(e) {}
  }, [companies]);

  // Restore checked state for companies loaded from localStorage on mount
  useEffect(function() {
    if (mountChecked.current || companies.length === 0) return;
    mountChecked.current = true;
    if (Object.keys(checked).length === 0) {
      var all = {};
      companies.forEach(function(c) { all[c.id] = true; });
      setChecked(all);
    }
  }, [companies]);

  var totalCount    = companies.length;
  var doneCount     = companies.filter(function(c) { return c.status === "done"; }).length;
  var failedCount   = companies.filter(function(c) { return c.status === "failed"; }).length;
  var analyzingCount = companies.filter(function(c) { return c.status === "analyzing"; }).length;
  var queuedCount   = companies.filter(function(c) { return c.status === "queued"; }).length;
  var allDone       = companies.filter(function(c) { return c.status === "done"; });
  var checkedDone   = companies.filter(function(c) { return c.status === "done" && checked[c.id]; });
  var checkedQueued = companies.filter(function(c) { return c.status === "queued" && checked[c.id]; });
  var checkedAll    = companies.filter(function(c) { return !!checked[c.id]; });
  var canStart      = checkedQueued.length > 0 && !running;

  function loadRows(rows) {
    var withDefaults = rows.map(function(r) {
      return Object.assign({}, r, {
        segment: r.segment || defSegment,
        tier: r.tier || "",
        priority: r.priority || defPriority,
        status: "queued",
        result: null,
        error: null,
      });
    });
    setCompanies(withDefaults);
    var allChecked = {};
    withDefaults.forEach(function(r) { allChecked[r.id] = true; });
    setChecked(allChecked);
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
    var controller = new AbortController();
    abortControllersRef.current[idx] = controller;
    for (var attempt = 0; attempt < 3; attempt++) {
      if (controller.signal.aborted) break;
      try {
        var abortPromise = new Promise(function(_, reject) {
          controller.signal.addEventListener('abort', function() { reject(new Error('Aborted')); }, { once: true });
        });
        var data = await Promise.race([
          runAnalysis(companyName, function() {}, { tavily: tKey, ninjapear: njKey }),
          new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error("Timed out after 3 minutes")); }, 180000);
          }),
          abortPromise,
        ]);
        delete abortControllersRef.current[idx];
        setCompanies(function(prev) {
          var upd = prev.slice();
          upd[idx] = Object.assign({}, upd[idx], { status: "done", result: data, error: null });
          return upd;
        });
        return true;
      } catch(e) {
        var msg = (e && e.message) || String(e);
        if (msg === 'Aborted' || controller.signal.aborted) {
          delete abortControllersRef.current[idx];
          setCompanies(function(prev) {
            var upd = prev.slice();
            if (upd[idx]) upd[idx] = Object.assign({}, upd[idx], { status: "queued", error: null });
            return upd;
          });
          return false;
        }
        var isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many");
        if (isRateLimit && attempt < 2) {
          await new Promise(function(resolve) { setTimeout(resolve, 30000); });
          continue;
        }
        delete abortControllersRef.current[idx];
        setCompanies(function(prev) {
          var upd = prev.slice();
          upd[idx] = Object.assign({}, upd[idx], { status: "failed", error: msg.slice(0, 140), result: null });
          return upd;
        });
        return false;
      }
    }
    delete abortControllersRef.current[idx];
    return false;
  }

  async function startBulk() {
    if (runningRef.current || checkedQueued.length === 0) return;
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setMultiFailWarn(false);

    var snapshot = companies.slice();
    var checkedSnap = checked;
    var queue = [];
    snapshot.forEach(function(c, idx) {
      if (c.status === "queued" && checkedSnap[c.id]) queue.push({ idx: idx, name: c.name });
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

  var PIPE_BATCH_SIZE = 5;
  var pipe = Array.isArray(pipelineDeals) ? pipelineDeals : [];

  function pipeHas(name) {
    return pipe.some(function(d) { return d.company && d.company.toLowerCase() === (name || "").toLowerCase(); });
  }

  function pipeMatchNorm(name, vertical) {
    var nn = normalizeName(name);
    return pipe.find(function(d) {
      if (normalizeName(d.company || "") !== nn) return false;
      if (vertical && d.vertical && d.vertical !== vertical) return false;
      return true;
    }) || null;
  }

  async function batchAddToPipeline(items, startIdx) {
    var from = startIdx || 0;
    pendingItemsRef.current = items;
    var total = items.length;
    setAddingProgress({ current: from, total: total, failedAt: null });
    for (var i = from; i < total; i += PIPE_BATCH_SIZE) {
      try {
        var batch = items.slice(i, i + PIPE_BATCH_SIZE);
        addResultsToPipeline(batch);
        var current = Math.min(i + PIPE_BATCH_SIZE, total);
        setAddingProgress({ current: current, total: total, failedAt: null });
        if (current < total) {
          await new Promise(function(r) { setTimeout(r, 800); });
        }
      } catch(e) {
        setAddingProgress({ current: i, total: total, failedAt: i });
        return;
      }
    }
    pendingItemsRef.current = [];
    setAddingProgress(null);
    setAddedMsg("added:" + total);
    setTimeout(function() { setAddedMsg(null); }, 3000);
  }

  function buildAddList(rows, forUpdate) {
    var noResult = []; var toAdd = []; var toUpdate = []; var unmatched = [];
    rows.forEach(function(c) {
      if (!c.result) { noResult.push(c.name); return; }
      var companyName = c.result.company || c.name;
      if (forUpdate) {
        var match = pipeMatchNorm(companyName, c.segment || "");
        if (match) {
          toUpdate.push({ result: c.result, segment: c.segment, priority: c.priority, tier: c.tier || "", matchName: companyName });
        } else {
          unmatched.push(companyName);
        }
      } else {
        if (!pipeHas(companyName)) {
          toAdd.push({ result: c.result, segment: c.segment, priority: c.priority, tier: c.tier || "" });
        }
      }
    });
    return { toAdd: toAdd, toUpdate: toUpdate, noResult: noResult, unmatched: unmatched };
  }

  function buildUpdateList(rows) {
    var matched = []; var unmatched = [];
    rows.forEach(function(c) {
      var deal = pipeMatchNorm(c.name, "");
      if (deal) {
        matched.push({ matchName: deal.company, tier: c.tier || "", priority: c.priority || "", segment: c.segment || "", website: c.website || "" });
      } else {
        unmatched.push(c.name);
      }
    });
    return { matched: matched, unmatched: unmatched };
  }

  function handleUpdateExisting() {
    var r = buildUpdateList(checkedAll);
    setUpdatePreview({ matched: r.matched, unmatched: r.unmatched });
  }

  function triggerAnalysisConfirm(n) {
    if (n === 0) return;
    setConfirmModal({ count: n });
    setCapInput("");
  }

  function handleAddSelected() {
    var r = buildAddList(checkedDone, false);
    if (!r.toAdd.length) {
      if (r.noResult.length) setAddedMsg("rerun");
      else setAddedMsg("already");
      setTimeout(function() { setAddedMsg(null); }, 3500);
      return;
    }
    batchAddToPipeline(r.toAdd, 0);
  }

  function handleAddAll() {
    var r = buildAddList(allDone, false);
    if (!r.toAdd.length) {
      if (r.noResult.length) setAddedMsg("rerun");
      else setAddedMsg("already");
      setTimeout(function() { setAddedMsg(null); }, 3500);
      return;
    }
    batchAddToPipeline(r.toAdd, 0);
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
      {/* Confirmation modal */}
      {confirmModal && (
        <div style={{ position: "fixed", inset: 0, background: "#000000BB", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 14, padding: "28px 32px", maxWidth: 440, width: "90%", boxShadow: "0 20px 60px #000" }}>
            <div style={{ color: C.text, fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Confirm Analysis Run</div>
            <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.8, marginBottom: 16 }}>
              <div><strong style={{ color: C.text }}>{confirmModal.count}</strong> targets will be analyzed</div>
              <div>Estimated time: ~{Math.ceil(confirmModal.count / BATCH_SIZE * 30 / 60)} min at concurrency {BATCH_SIZE}</div>
            </div>
            {confirmModal.count > 25 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: C.red, fontSize: 11, marginBottom: 6 }}>⚠ More than 25 targets. Type <strong>{confirmModal.count}</strong> to confirm:</div>
                <input
                  autoFocus
                  value={capInput}
                  onChange={function(e) { setCapInput(e.target.value); }}
                  placeholder={"Type " + confirmModal.count + " to confirm"}
                  style={Object.assign({}, inp, { width: "100%", boxSizing: "border-box" })}
                />
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                autoFocus={confirmModal.count <= 25}
                onClick={function() { setConfirmModal(null); setCapInput(""); }}
                style={Object.assign({}, btn, { background: "transparent", border: "1px solid " + C.border, color: C.text })}>
                Cancel
              </button>
              <button
                disabled={confirmModal.count > 25 && capInput.trim() !== String(confirmModal.count)}
                onClick={function() {
                  if (confirmModal.count > 25 && capInput.trim() !== String(confirmModal.count)) return;
                  setConfirmModal(null);
                  setCapInput("");
                  startBulk();
                }}
                style={Object.assign({}, btn, {
                  background: (confirmModal.count <= 25 || capInput.trim() === String(confirmModal.count)) ? C.accent : C.surface,
                  color: (confirmModal.count <= 25 || capInput.trim() === String(confirmModal.count)) ? "#000" : C.dim,
                  opacity: (confirmModal.count <= 25 || capInput.trim() === String(confirmModal.count)) ? 1 : 0.5,
                  cursor: (confirmModal.count <= 25 || capInput.trim() === String(confirmModal.count)) ? "pointer" : "default",
                })}>
                Confirm &amp; Analyze
              </button>
            </div>
          </div>
        </div>
      )}
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
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 2 }}>
            <input type="checkbox" id="updateModeChk" checked={updateMode} onChange={function(e) { setUpdateMode(e.target.checked); setUpdatePreview(null); }} style={{ cursor: "pointer" }} />
            <label htmlFor="updateModeChk" style={{ color: C.muted, fontSize: 10, cursor: "pointer" }}>Update existing targets (match by company name, fill empty fields)</label>
          </div>
          {totalCount > 0 && (
            <div style={{ color: C.muted, fontSize: 10, paddingBottom: 2 }}>
              <strong style={{ color: C.text }}>{totalCount}</strong> loaded
              {queuedCount > 0 && <span> · <strong style={{ color: checkedQueued.length > 0 ? C.accent : C.red }}>{checkedQueued.length}</strong> of {queuedCount} selected to analyze</span>}
              {doneCount > 0 && <span style={{ color: C.green }}> · {doneCount} done</span>}
              {failedCount > 0 && <span style={{ color: C.red }}> · {failedCount} failed</span>}
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

      {/* Update preview confirmation */}
      {updatePreview && (
        <div style={{ background: C.greenDim, border: "1px solid " + C.green + "50", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: (updatePreview.unmatched && updatePreview.unmatched.length > 0) ? 10 : 0 }}>
            <span style={{ color: C.green, fontSize: 11, fontWeight: 700, flex: 1 }}>
              {(updatePreview.matched || []).length > 0 && <span>{(updatePreview.matched || []).length} matched · 0 will be analyzed</span>}
              {(updatePreview.unmatched && updatePreview.unmatched.length > 0) && <span style={{ color: C.gold }}> · {updatePreview.unmatched.length} unmatched (will be skipped)</span>}
              {(updatePreview.matched || []).length === 0 && (!updatePreview.unmatched || updatePreview.unmatched.length === 0) && <span>Nothing to update</span>}
            </span>
            {(updatePreview.matched || []).length > 0 && (
              <button onClick={function() {
                var n = (updatePreview.matched || []).length;
                if (updateExistingInPipeline) updateExistingInPipeline(updatePreview.matched);
                setUpdatePreview(null);
                setAddedMsg("updated:" + n);
                setTimeout(function() { setAddedMsg(null); }, 4000);
              }}
                style={Object.assign({}, btn, { background: C.green, color: "#000", padding: "5px 12px", fontSize: 10 })}>
                ✓ Confirm Update
              </button>
            )}
            <button onClick={function() { setUpdatePreview(null); }}
              style={Object.assign({}, btn, { background: "transparent", border: "1px solid " + C.border, color: C.muted, padding: "5px 10px", fontSize: 10 })}>
              ✕ Cancel
            </button>
          </div>
          {updatePreview.unmatched && updatePreview.unmatched.length > 0 && (
            <div style={{ background: C.card, borderRadius: 6, padding: "8px 10px", maxHeight: 120, overflowY: "auto" }}>
              <div style={{ color: C.gold, fontSize: 9, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.07em" }}>Unmatched — not in pipeline:</div>
              {updatePreview.unmatched.map(function(name, i) {
                return <div key={i} style={{ color: C.muted, fontSize: 10, lineHeight: 1.6 }}>{name}</div>;
              })}
            </div>
          )}
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

      {/* Pipeline add progress bar */}
      {addingProgress && (
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            {addingProgress.failedAt !== null
              ? <span style={{ color: C.red, fontSize: 11, fontWeight: 700 }}>⚠ Failed at batch {addingProgress.failedAt + 1} — {addingProgress.current} of {addingProgress.total} added</span>
              : <span style={{ color: C.text, fontSize: 11, fontWeight: 700 }}>Adding to pipeline… {addingProgress.current} of {addingProgress.total}</span>
            }
            {addingProgress.failedAt !== null && (
              <button onClick={function() { batchAddToPipeline(pendingItemsRef.current, addingProgress.failedAt); }}
                style={Object.assign({}, btn, { background: C.gold, color: "#000", padding: "4px 12px", fontSize: 10 })}>
                🔄 Retry from here
              </button>
            )}
          </div>
          <div style={{ background: C.border, borderRadius: 999, height: 6, overflow: "hidden" }}>
            <div style={{
              background: addingProgress.failedAt !== null
                ? "linear-gradient(90deg, " + C.red + ", " + C.gold + ")"
                : "linear-gradient(90deg, " + C.green + ", " + C.cyan + ")",
              height: "100%",
              width: Math.round(addingProgress.current / Math.max(addingProgress.total, 1) * 100) + "%",
              transition: "width 0.4s ease",
              borderRadius: 999,
            }} />
          </div>
        </div>
      )}

      {/* Action buttons */}
      {totalCount > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          {updateMode ? (
            <button onClick={handleUpdateExisting} disabled={checkedAll.length === 0 || !!addingProgress}
              style={Object.assign({}, btn, { background: "transparent", border: "1px solid " + C.green + "70", color: C.green, opacity: (checkedAll.length > 0 && !addingProgress) ? 1 : 0.5, cursor: (checkedAll.length > 0 && !addingProgress) ? "pointer" : "default" })}>
              ✓ Update Existing ({checkedAll.length})
            </button>
          ) : (
            <button onClick={function() { triggerAnalysisConfirm(checkedQueued.length); }} disabled={!canStart || !!addingProgress}
              style={Object.assign({}, btn, { background: canStart && !addingProgress ? C.accent : C.surface, color: canStart && !addingProgress ? "#000" : C.dim, border: "1px solid " + (canStart && !addingProgress ? C.accent : C.border), opacity: canStart && !addingProgress ? 1 : 0.5, cursor: canStart && !addingProgress ? "pointer" : "default" })}>
              {running ? "⟳ Running…" : ("▶ Analyze Selected (" + checkedQueued.length + ")")}
            </button>
          )}
          {totalCount > checkedAll.length && !running && (
            <button onClick={function() {
              var all = {};
              companies.forEach(function(c) { all[c.id] = true; });
              setChecked(all);
            }}
              style={Object.assign({}, btn, { background: "transparent", border: "1px solid " + C.border, color: C.muted, padding: "5px 10px", fontSize: 10 })}>
              ☑ Select All ({totalCount})
            </button>
          )}
          {!updateMode && allDone.length > 0 && (
            <button onClick={handleAddAll} disabled={!!addingProgress}
              style={Object.assign({}, btn, { background: addingProgress ? C.surface : C.greenDim, color: addingProgress ? C.dim : C.green, border: "1px solid " + (addingProgress ? C.border : C.green + "50"), opacity: addingProgress ? 0.5 : 1, cursor: addingProgress ? "default" : "pointer" })}>
              {addingProgress && addingProgress.failedAt === null ? "⟳ Adding…" : ("✚ Add All to Pipeline (" + allDone.length + ")")}
            </button>
          )}
          {!updateMode && checkedDone.length > 0 && checkedDone.length < allDone.length && (
            <button onClick={handleAddSelected} disabled={!!addingProgress}
              style={Object.assign({}, btn, { background: addingProgress ? C.surface : C.surface, color: addingProgress ? C.dim : C.accent, border: "1px solid " + (addingProgress ? C.border : C.accent + "50"), opacity: addingProgress ? 0.5 : 1, cursor: addingProgress ? "default" : "pointer" })}>
              ✚ Add Selected ({checkedDone.length})
            </button>
          )}
          {addedMsg && addedMsg.startsWith("added:") && <span style={{ color: C.green, fontSize: 10 }}>✅ Added {addedMsg.split(":")[1]} to pipeline!</span>}
          {addedMsg && addedMsg.startsWith("updated:") && <span style={{ color: C.green, fontSize: 10 }}>✓ Updated {addedMsg.split(":")[1]} target{addedMsg.split(":")[1]==="1"?"":"s"}</span>}
          {addedMsg === "already" && <span style={{ color: C.gold, fontSize: 10 }}>⚠ Already in pipeline</span>}
          {addedMsg === "rerun" && <span style={{ color: C.red, fontSize: 10 }}>⚠ Re-run analysis to add to pipeline</span>}
        </div>
      )}

      {/* Companies table */}
      {totalCount > 0 && (
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 540 }}>
            <thead>
              <tr style={{ background: C.surface }}>
                <th style={{ width: 36, padding: "8px 10px", borderBottom: "1px solid " + C.border, textAlign: "center" }}>
                  <input type="checkbox"
                    checked={totalCount > 0 && companies.every(function(c) { return checked[c.id]; })}
                    ref={function(el) { if (el) el.indeterminate = totalCount > 0 && companies.some(function(c) { return checked[c.id]; }) && !companies.every(function(c) { return checked[c.id]; }); }}
                    onChange={function(e) {
                      var next = {};
                      if (e.target.checked) companies.forEach(function(c) { next[c.id] = true; });
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
                  return (
                    <tr key={c.id} style={{ borderBottom: "1px solid " + C.border, background: idx % 2 === 0 ? "transparent" : C.surface + "50" }}>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        <input type="checkbox" checked={!!checked[c.id]}
                          onChange={function(e) { setChecked(function(prev) { return Object.assign({}, prev, { [c.id]: e.target.checked }); }); }} />
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
                        <select value={c.priority || "tier_1"} onChange={function(e) {
                          setCompanies(function(prev) {
                            var upd = prev.slice(); upd[idx] = Object.assign({}, upd[idx], { priority: e.target.value }); return upd;
                          });
                        }} style={{ background: "transparent", border: "none", color: c.priority === "tier_1" ? C.accent : c.priority === "tier_2" ? "#64748B" : C.dim, fontSize: 10, cursor: "pointer", fontFamily: "inherit", outline: "none" }}>
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
                        {c.status === "analyzing" && (
                          <button onClick={function() { var ctrl = abortControllersRef.current[idx]; if (ctrl) ctrl.abort(); }}
                            title="Abort this analysis"
                            style={{ background: "transparent", border: "none", color: C.red, padding: "3px 6px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
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
