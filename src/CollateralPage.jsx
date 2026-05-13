import React, { useState, useEffect, useRef, useCallback } from 'react';

const C = {
  bg: '#07090F', surface: '#0D1117', card: '#111827', border: '#1F2937',
  accent: '#00C2FF', accentDim: '#00C2FF12', gold: '#F59E0B', goldDim: '#F59E0B12',
  green: '#10B981', greenDim: '#10B98112', red: '#EF4444', redDim: '#EF444412',
  purple: '#8B5CF6', cyan: '#06B6D4', text: '#F1F5F9', muted: '#94A3B8', dim: '#334155',
};

function fmtBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fmtRelTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var now = Date.now();
  var diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fileIcon(filename) {
  var ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📄';
  if (ext === 'docx' || ext === 'doc') return '📝';
  if (ext === 'pptx' || ext === 'ppt') return '📊';
  if (ext === 'xlsx' || ext === 'xls') return '📈';
  if (ext === 'csv') return '🗂';
  if (ext === 'txt' || ext === 'md') return '📃';
  return '📁';
}

// ─── Document Library Pane ───────────────────────────────────────────────────
function DocLibrary({ docs, onDelete, onRefresh }) {
  var sUpload = useState('idle'); var uploadStatus = sUpload[0]; var setUploadStatus = sUpload[1];
  var sUploadMsg = useState(''); var uploadMsg = sUploadMsg[0]; var setUploadMsg = sUploadMsg[1];
  var sDrag = useState(false); var isDragging = sDrag[0]; var setIsDragging = sDrag[1];
  var sDeleting = useState({}); var deleting = sDeleting[0]; var setDeleting = sDeleting[1];
  var fileInputRef = useRef(null);

  async function processFile(file) {
    if (!file) return;
    setUploadStatus('uploading');
    setUploadMsg('Uploading & indexing ' + file.name + '…');
    try {
      var formData = new FormData();
      formData.append('file', file);
      var r = await fetch('/api/collateral/process', { method: 'POST', body: formData });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Processing failed');

      setUploadStatus('done');
      setUploadMsg(file.name + ' indexed (' + data.chunkCount + ' chunks)');
      onRefresh();
      setTimeout(function() { setUploadStatus('idle'); setUploadMsg(''); }, 3000);
    } catch (err) {
      setUploadStatus('error');
      setUploadMsg(err.message);
      setTimeout(function() { setUploadStatus('idle'); setUploadMsg(''); }, 5000);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    var file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function onInputChange(e) {
    var file = e.target.files[0];
    if (file) processFile(file);
    e.target.value = '';
  }

  async function handleDelete(doc) {
    if (!window.confirm('Delete "' + doc.filename + '" and all its embeddings?')) return;
    setDeleting(function(p) { var n = Object.assign({}, p); n[doc.id] = true; return n; });
    try {
      var r = await fetch('/api/collateral/delete?id=' + doc.id, { method: 'DELETE' });
      if (!r.ok) { var d = await r.json(); throw new Error(d.error); }
      onRefresh();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
    setDeleting(function(p) { var n = Object.assign({}, p); delete n[doc.id]; return n; });
  }

  var uploading = uploadStatus === 'uploading' || uploadStatus === 'processing';
  var statusColor = uploadStatus === 'done' ? C.green : uploadStatus === 'error' ? C.red : C.accent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      {/* Drop zone */}
      <div
        onDragOver={function(e) { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={function() { setIsDragging(false); }}
        onDrop={onDrop}
        onClick={function() { if (!uploading) fileInputRef.current && fileInputRef.current.click(); }}
        style={{ border: '2px dashed ' + (isDragging ? C.accent : C.border), borderRadius: 10, padding: '18px 12px', textAlign: 'center', cursor: uploading ? 'default' : 'pointer', background: isDragging ? C.accentDim : 'transparent', transition: 'all 0.15s', flexShrink: 0 }}
      >
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md" onChange={onInputChange} />
        <div style={{ fontSize: 22, marginBottom: 6 }}>📎</div>
        <div style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}>Drop file or click to upload</div>
        <div style={{ color: C.dim, fontSize: 9, marginTop: 4 }}>PDF · DOCX · PPTX · XLSX · CSV · TXT · MD · up to 50MB</div>
      </div>

      {/* Upload status */}
      {uploadMsg && (
        <div style={{ background: statusColor + '15', border: '1px solid ' + statusColor + '40', borderRadius: 8, padding: '8px 12px', fontSize: 10, color: statusColor, lineHeight: 1.4 }}>
          {uploading && <span style={{ marginRight: 6 }}>⟳</span>}
          {uploadMsg}
        </div>
      )}

      {/* Progress steps during upload */}
      {uploading && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {[['uploading', '⬆ Upload'], ['processing', '⚙ Index'], ['done', '✓ Done']].map(function(step) {
            var active = uploadStatus === step[0];
            var done = uploadStatus === 'done' && step[0] !== 'done';
            return (
              <div key={step[0]} style={{ flex: 1, padding: '5px 4px', borderRadius: 6, background: active ? C.accentDim : done ? C.greenDim : C.surface, border: '1px solid ' + (active ? C.accent : done ? C.green : C.border), textAlign: 'center', fontSize: 9, color: active ? C.accent : done ? C.green : C.dim, fontWeight: 700 }}>
                {step[1]}
              </div>
            );
          })}
        </div>
      )}

      {/* Document list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {docs.length === 0 && (
          <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: '24px 8px' }}>No documents yet.<br/>Upload your first file above.</div>
        )}
        {docs.map(function(doc) {
          var isDel = deleting[doc.id];
          return (
            <div key={doc.id} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
              <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{fileIcon(doc.filename)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.text, fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.filename}>{doc.filename}</div>
                <div style={{ color: C.dim, fontSize: 9, marginTop: 2 }}>
                  {fmtBytes(doc.size)} · {doc.chunkCount} chunks · {fmtRelTime(doc.uploadedAt)}
                </div>
              </div>
              <button onClick={function() { handleDelete(doc); }} disabled={isDel}
                style={{ flexShrink: 0, background: 'transparent', border: 'none', color: isDel ? C.dim : C.red, cursor: isDel ? 'default' : 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1, opacity: isDel ? 0.4 : 1 }}>
                {isDel ? '⟳' : '🗑'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Conversation History Pane ────────────────────────────────────────────────
function ConvHistory({ conversations, activeId, onSelect, onNew, onDelete, onClearAll }) {
  var sDeleting = useState({}); var deleting = sDeleting[0]; var setDeleting = sDeleting[1];
  var sClearing = useState(false); var clearing = sClearing[0]; var setClearing = sClearing[1];

  async function handleDelete(e, conv) {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation?')) return;
    setDeleting(function(p) { var n = Object.assign({}, p); n[conv.id] = true; return n; });
    try {
      var r = await fetch('/api/collateral/conversation?id=' + conv.id, { method: 'DELETE' });
      if (!r.ok) { var d = await r.json(); throw new Error(d.error); }
      onDelete(conv.id);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
    setDeleting(function(p) { var n = Object.assign({}, p); delete n[conv.id]; return n; });
  }

  async function handleClearAll() {
    if (!window.confirm('Delete all ' + conversations.length + ' conversation' + (conversations.length === 1 ? '' : 's') + '? This cannot be undone.')) return;
    setClearing(true);
    try {
      var r = await fetch('/api/collateral/conversations', { method: 'DELETE' });
      if (!r.ok) { var d = await r.json(); throw new Error(d.error); }
      onClearAll();
    } catch (err) {
      alert('Clear failed: ' + err.message);
    }
    setClearing(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      <button onClick={onNew}
        style={{ flexShrink: 0, background: C.accent, color: '#000', border: 'none', borderRadius: 8, padding: '9px 12px', fontWeight: 800, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
        + New Chat
      </button>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {conversations.length === 0 && (
          <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: '24px 8px' }}>No conversations yet.</div>
        )}
        {conversations.map(function(conv) {
          var isActive = conv.id === activeId;
          var isDel = deleting[conv.id];
          return (
            <div key={conv.id} onClick={function() { if (!isDel) onSelect(conv.id); }}
              style={{ background: isActive ? C.accentDim : C.card, border: '1px solid ' + (isActive ? C.accent : C.border), borderRadius: 8, padding: '9px 10px', cursor: isDel ? 'default' : 'pointer', transition: 'all 0.1s', display: 'flex', alignItems: 'flex-start', gap: 6, opacity: isDel ? 0.5 : 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: isActive ? C.accent : C.text, fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title || 'Untitled'}</div>
                <div style={{ color: C.dim, fontSize: 9, marginTop: 2 }}>
                  {conv.messageCount || 0} msgs · {fmtRelTime(conv.lastMessageAt)}
                </div>
              </div>
              <button onClick={function(e) { handleDelete(e, conv); }} disabled={isDel}
                style={{ flexShrink: 0, background: 'transparent', border: 'none', color: isDel ? C.dim : C.red, cursor: isDel ? 'default' : 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1, opacity: isDel ? 0.4 : 1, marginTop: 1 }}>
                {isDel ? '⟳' : '🗑'}
              </button>
            </div>
          );
        })}
      </div>
      {conversations.length > 0 && (
        <button onClick={handleClearAll} disabled={clearing}
          style={{ flexShrink: 0, background: 'transparent', border: 'none', color: clearing ? C.dim : C.muted, fontSize: 10, cursor: clearing ? 'default' : 'pointer', fontFamily: 'inherit', padding: '4px 0', textAlign: 'center', textDecoration: 'underline', opacity: clearing ? 0.5 : 0.7 }}>
          {clearing ? 'Clearing…' : 'Clear all'}
        </button>
      )}
    </div>
  );
}

// ─── Chat Pane ────────────────────────────────────────────────────────────────
function ChatPane({ conversationId, messages, streaming, onSend, onConvIdSet }) {
  var sInput = useState(''); var input = sInput[0]; var setInput = sInput[1];
  var bottomRef = useRef(null);

  useEffect(function() {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  function handleSend() {
    var text = input.trim();
    if (!text || streaming) return;
    setInput('');
    onSend(text);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Message thread */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '48px 16px', lineHeight: 1.8 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>💬</div>
            Ask anything about your sales collateral.<br/>
            The AI searches your document library to answer.
          </div>
        )}
        {messages.map(function(msg, idx) {
          var isUser = msg.role === 'user';
          return (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 4 }}>
              <div style={{ background: isUser ? C.accent : C.card, color: isUser ? '#000' : C.text, borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: '10px 14px', maxWidth: '85%', fontSize: 12, lineHeight: 1.6, border: isUser ? 'none' : '1px solid ' + C.border, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.content}
                {msg.streaming && <span style={{ color: C.accent, marginLeft: 4, animation: 'none' }}>▍</span>}
              </div>
              {/* Citations */}
              {!isUser && msg.citations && msg.citations.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: '85%' }}>
                  {msg.citations.map(function(c, ci) {
                    return (
                      <span key={ci} style={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 10, padding: '2px 8px', fontSize: 9, color: C.muted }}>
                        📄 {c.filename} · chunk {c.chunkIndex} · {Math.round(c.score * 100)}%
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {streaming && (
          <div style={{ color: C.dim, fontSize: 10, marginLeft: 4 }}>⟳ Thinking…</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{ flexShrink: 0, borderTop: '1px solid ' + C.border, padding: '10px 0 0' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={function(e) { setInput(e.target.value); }}
            onKeyDown={onKeyDown}
            placeholder="Ask about your collateral… (Enter to send, Shift+Enter for newline)"
            style={{ flex: 1, background: C.surface, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 12, outline: 'none', fontFamily: 'inherit', resize: 'none', minHeight: 42, maxHeight: 120, lineHeight: 1.5 }}
            rows={1}
            disabled={streaming}
          />
          <button onClick={handleSend} disabled={!input.trim() || streaming}
            style={{ flexShrink: 0, padding: '10px 18px', borderRadius: 8, background: (!input.trim() || streaming) ? C.surface : C.accent, color: (!input.trim() || streaming) ? C.dim : '#000', border: '1px solid ' + ((!input.trim() || streaming) ? C.border : C.accent), fontWeight: 800, fontSize: 12, cursor: (!input.trim() || streaming) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Search Pane ──────────────────────────────────────────────────────────────
function SearchPane() {
  var sQuery = useState(''); var query = sQuery[0]; var setQuery = sQuery[1];
  var sResults = useState([]); var results = sResults[0]; var setResults = sResults[1];
  var sLoading = useState(false); var loading = sLoading[0]; var setLoading = sLoading[1];
  var sExpanded = useState(null); var expanded = sExpanded[0]; var setExpanded = sExpanded[1];

  async function doSearch() {
    if (!query.trim() || loading) return;
    setLoading(true);
    try {
      var r = await fetch('/api/collateral/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), topK: 12 }),
      });
      var data = await r.json();
      setResults(data.results || []);
    } catch (e) {
      setResults([]);
    }
    setLoading(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') doSearch();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <input
          value={query}
          onChange={function(e) { setQuery(e.target.value); }}
          onKeyDown={onKeyDown}
          placeholder="Search across all documents…"
          style={{ flex: 1, background: C.surface, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
        />
        <button onClick={doSearch} disabled={!query.trim() || loading}
          style={{ padding: '10px 18px', borderRadius: 8, background: loading ? C.surface : C.accent, color: loading ? C.dim : '#000', border: '1px solid ' + (loading ? C.border : C.accent), fontWeight: 800, fontSize: 12, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {loading ? '⟳' : '🔍 Search'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.length === 0 && !loading && query && (
          <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: 32 }}>No results found.</div>
        )}
        {results.map(function(r, i) {
          var isExp = expanded === i;
          var preview = r.text.slice(0, 200) + (r.text.length > 200 ? '…' : '');
          return (
            <div key={i} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 10, overflow: 'hidden' }}>
              <div onClick={function() { setExpanded(isExp ? null : i); }} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ color: C.accent, fontWeight: 700, fontSize: 11 }}>{fileIcon(r.filename)} {r.filename}</span>
                    <span style={{ color: C.dim, fontSize: 9 }}>chunk {r.chunkIndex}</span>
                    <span style={{ background: C.accentDim, border: '1px solid ' + C.accent + '40', color: C.accent, borderRadius: 10, padding: '1px 7px', fontSize: 9, fontWeight: 700 }}>{Math.round(r.score * 100)}%</span>
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.5 }}>{isExp ? r.text : preview}</div>
                </div>
                <div style={{ color: C.dim, fontSize: 10, flexShrink: 0 }}>{isExp ? '▲' : '▼'}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Build Modal ─────────────────────────────────────────────────────────────
function BuildModal({ docs, onClose, onSuccess }) {
  var sPrompt = useState(''); var prompt = sPrompt[0]; var setPrompt = sPrompt[1];
  var sStyle = useState('pitch'); var style = sStyle[0]; var setStyle = sStyle[1];
  var sCardCount = useState(8); var cardCount = sCardCount[0]; var setCardCount = sCardCount[1];
  var sDocIds = useState([]); var selectedDocIds = sDocIds[0]; var setSelectedDocIds = sDocIds[1];
  var sExtra = useState(''); var extra = sExtra[0]; var setExtra = sExtra[1];
  var sStep = useState('form'); var step = sStep[0]; var setStep = sStep[1];
  var sStepMsg = useState(''); var stepMsg = sStepMsg[0]; var setStepMsg = sStepMsg[1];
  var sError = useState(''); var error = sError[0]; var setError = sError[1];
  var sResultDeck = useState(null); var resultDeck = sResultDeck[0]; var setResultDeck = sResultDeck[1];

  var STYLES = [
    { value: 'pitch', label: '📊 Pitch Deck' },
    { value: 'pricing', label: '💲 Pricing Sheet' },
    { value: 'overview', label: '🧩 Product Overview' },
    { value: 'custom', label: '✏️ Custom' },
  ];

  var STEPS = [
    ['searching', '🔍 Searching'],
    ['building', '🧠 Building'],
    ['sending', '📡 Sending'],
    ['generating', '🎨 Generating'],
    ['saving', '💾 Saving'],
  ];

  var stepOrder = ['searching', 'building', 'sending', 'generating', 'saving', 'done'];
  var stepIdx = stepOrder.indexOf(step);

  function toggleDoc(id) {
    setSelectedDocIds(function(prev) {
      if (prev.indexOf(id) !== -1) return prev.filter(function(d) { return d !== id; });
      return prev.concat([id]);
    });
  }

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setStep('searching');
    setStepMsg('Starting...');
    setError('');
    setResultDeck(null);

    try {
      var r = await fetch('/api/collateral/build-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          docIds: selectedDocIds,
          cardCount: cardCount,
          style: style,
          additionalInstructions: extra.trim(),
        }),
      });

      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var parts = buf.split('\n\n');
        buf = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var line = parts[i].split('\n').find(function(l) { return l.startsWith('data: '); });
          if (!line) continue;
          try {
            var evt = JSON.parse(line.slice(6));
            if (evt.step === 'done') {
              setResultDeck(evt.deck);
              setStep('done');
            } else if (evt.step === 'error') {
              setError(evt.error);
              setStep('error');
            } else {
              setStep(evt.step);
              setStepMsg(evt.message || '');
            }
          } catch (pe) {}
        }
      }
    } catch (err) {
      setError(err.message);
      setStep('error');
    }
  }

  var isGenerating = step !== 'form' && step !== 'done' && step !== 'error';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 14, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>🎨 Build New Collateral Deck</div>
          {!isGenerating && (
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
          )}
        </div>

        {/* Form */}
        {step === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>Topic / Prompt *</label>
              <textarea value={prompt} onChange={function(e) { setPrompt(e.target.value); }}
                placeholder="e.g. CoinPayments stablecoin settlement for FX brokers"
                rows={3}
                style={{ width: '100%', background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>Style</label>
                <select value={style} onChange={function(e) { setStyle(e.target.value); }}
                  style={{ width: '100%', background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
                  {STYLES.map(function(s) { return <option key={s.value} value={s.value}>{s.label}</option>; })}
                </select>
              </div>
              <div style={{ width: 90 }}>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>Slides</label>
                <input type="number" min={4} max={20} value={cardCount}
                  onChange={function(e) { setCardCount(Math.min(20, Math.max(4, parseInt(e.target.value) || 8))); }}
                  style={{ width: '100%', background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {docs.length > 0 && (
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Source Docs <span style={{ color: C.dim, fontWeight: 400 }}>(leave all unchecked = use all)</span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 110, overflowY: 'auto', background: C.card, borderRadius: 8, border: '1px solid ' + C.border, padding: '8px 12px' }}>
                  {docs.map(function(doc) {
                    var checked = selectedDocIds.indexOf(doc.id) !== -1;
                    return (
                      <label key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: checked ? C.text : C.muted, fontSize: 11 }}>
                        <input type="checkbox" checked={checked} onChange={function() { toggleDoc(doc.id); }} style={{ accentColor: C.accent }} />
                        {fileIcon(doc.filename)} {doc.filename}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>Additional Instructions <span style={{ color: C.dim, fontWeight: 400 }}>(optional)</span></label>
              <textarea value={extra} onChange={function(e) { setExtra(e.target.value); }}
                placeholder="e.g. Focus on compliance, include competitive comparison"
                rows={2}
                style={{ width: '100%', background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, background: 'transparent', border: '1px solid ' + C.border, color: C.muted, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleGenerate} disabled={!prompt.trim()}
                style={{ padding: '9px 22px', borderRadius: 8, background: prompt.trim() ? C.accent : C.surface, color: prompt.trim() ? '#000' : C.dim, border: '1px solid ' + (prompt.trim() ? C.accent : C.border), fontWeight: 800, fontSize: 12, cursor: prompt.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                ✨ Generate Deck
              </button>
            </div>
          </div>
        )}

        {/* Progress */}
        {isGenerating && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', padding: '20px 0' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {STEPS.map(function(s) {
                var idx = stepOrder.indexOf(s[0]);
                var isActive = s[0] === step;
                var isDone = idx < stepIdx;
                return (
                  <div key={s[0]} style={{ padding: '5px 12px', borderRadius: 20, background: isActive ? C.accentDim : isDone ? C.greenDim : C.card, border: '1px solid ' + (isActive ? C.accent : isDone ? C.green : C.border), color: isActive ? C.accent : isDone ? C.green : C.dim, fontSize: 10, fontWeight: 700 }}>
                    {isDone ? '✓ ' : isActive ? '⟳ ' : ''}{s[1]}
                  </div>
                );
              })}
            </div>
            <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 1.7 }}>{stepMsg}</div>
            <div style={{ color: C.dim, fontSize: 10 }}>Gamma takes 60-90s — keep this window open.</div>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: C.redDim, border: '1px solid ' + C.red + '40', borderRadius: 8, padding: '12px 16px', color: C.red, fontSize: 12 }}>⚠️ {error}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: '1px solid ' + C.border, color: C.muted, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
              <button onClick={function() { setStep('form'); setError(''); }}
                style={{ padding: '8px 16px', borderRadius: 8, background: C.accent, color: '#000', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Try Again</button>
            </div>
          </div>
        )}

        {/* Done */}
        {step === 'done' && resultDeck && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: C.greenDim, border: '1px solid ' + C.green + '40', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ color: C.green, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>✓ Deck generated successfully!</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{resultDeck.cardCount} slides · {resultDeck.chunkCount} chunks · {resultDeck.sourceDocs.length} doc(s)</div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={function() { onSuccess(resultDeck); }}
                style={{ flex: 1, padding: '10px 16px', borderRadius: 8, background: C.accent, color: '#000', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', minWidth: 120 }}>
                View Deck →
              </button>
              <a href={resultDeck.gammaUrl} target="_blank" rel="noreferrer"
                style={{ flex: 1, padding: '10px 16px', borderRadius: 8, background: C.surface, color: C.accent, border: '1px solid ' + C.accent, fontWeight: 700, fontSize: 12, textDecoration: 'none', textAlign: 'center', minWidth: 120 }}>
                Open in Gamma ↗
              </a>
            </div>
            <button onClick={onClose} style={{ padding: '7px', borderRadius: 8, background: 'transparent', border: '1px solid ' + C.border, color: C.muted, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Deck Card ────────────────────────────────────────────────────────────────
function DeckCard({ deck, onClick }) {
  var styleLabel = { pitch: 'Pitch', pricing: 'Pricing', overview: 'Overview', custom: 'Custom' }[deck.style] || deck.style;
  return (
    <div onClick={onClick}
      style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 10, cursor: 'pointer', overflow: 'hidden', transition: 'border-color 0.15s' }}
      onMouseEnter={function(e) { e.currentTarget.style.borderColor = C.accent; }}
      onMouseLeave={function(e) { e.currentTarget.style.borderColor = C.border; }}>
      <div style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d2244 50%, #0a1628 100%)', height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid ' + C.border }}>
        <span style={{ fontSize: 34 }}>🎨</span>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ color: C.text, fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }} title={deck.title}>{deck.title}</div>
        <div style={{ color: C.dim, fontSize: 9 }}>{styleLabel} · {deck.cardCount} slides · {fmtRelTime(deck.createdAt)}</div>
        {deck.sourceDocs && deck.sourceDocs.length > 0 && (
          <div style={{ color: C.dim, fontSize: 9, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📄 {deck.sourceDocs.slice(0, 2).join(', ')}{deck.sourceDocs.length > 2 ? ' +' + (deck.sourceDocs.length - 2) : ''}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Deck Viewer ──────────────────────────────────────────────────────────────
function DeckViewer({ deck, onBack, onDelete }) {
  var sDeleting = useState(false); var deleting = sDeleting[0]; var setDeleting = sDeleting[1];
  var styleLabel = { pitch: 'Pitch', pricing: 'Pricing', overview: 'Overview', custom: 'Custom' }[deck.style] || deck.style;

  async function handleDelete() {
    if (!window.confirm('Delete "' + deck.title + '"?')) return;
    setDeleting(true);
    try {
      var r = await fetch('/api/collateral/deck?id=' + deck.id, { method: 'DELETE' });
      if (!r.ok) { var d = await r.json(); throw new Error(d.error); }
      onDelete(deck.id);
    } catch (err) {
      alert('Delete failed: ' + err.message);
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ flexShrink: 0, background: 'transparent', border: '1px solid ' + C.border, borderRadius: 6, padding: '5px 10px', color: C.muted, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
        <div style={{ flex: 1, color: C.text, fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{deck.title}</div>
        <a href={deck.gammaUrl} target="_blank" rel="noreferrer"
          style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 6, background: 'transparent', color: C.accent, border: '1px solid ' + C.accent, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
          Open in Gamma ↗
        </a>
        <button onClick={handleDelete} disabled={deleting}
          style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid ' + C.border, color: deleting ? C.dim : C.red, fontSize: 11, cursor: deleting ? 'default' : 'pointer', fontFamily: 'inherit', opacity: deleting ? 0.5 : 1 }}>
          {deleting ? '⟳' : '🗑 Delete'}
        </button>
      </div>

      {/* Metadata chips */}
      <div style={{ flexShrink: 0, display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 10, padding: '2px 8px', fontSize: 9, color: C.muted }}>{styleLabel}</span>
        <span style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 10, padding: '2px 8px', fontSize: 9, color: C.muted }}>{deck.cardCount} slides</span>
        <span style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 10, padding: '2px 8px', fontSize: 9, color: C.muted }}>{deck.chunkCount} chunks</span>
        <span style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 10, padding: '2px 8px', fontSize: 9, color: C.muted }}>{fmtRelTime(deck.createdAt)}</span>
        {(deck.sourceDocs || []).map(function(f) {
          return <span key={f} style={{ background: C.accentDim, border: '1px solid ' + C.accent + '30', borderRadius: 10, padding: '2px 8px', fontSize: 9, color: C.accent }}>📄 {f}</span>;
        })}
      </div>

      {/* Iframe viewer */}
      <div style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid ' + C.border, background: '#000', minHeight: 0 }}>
        <iframe src={deck.gammaUrl} style={{ width: '100%', height: '100%', border: 'none' }} title={deck.title} allow="fullscreen" />
      </div>
    </div>
  );
}

// ─── Deck Pane ────────────────────────────────────────────────────────────────
function DeckPane({ decks, onDeckDeleted }) {
  var sActive = useState(null); var activeDeck = sActive[0]; var setActiveDeck = sActive[1];

  if (activeDeck && !decks.find(function(d) { return d.id === activeDeck.id; })) {
    setActiveDeck(null);
  }

  if (activeDeck) {
    return (
      <DeckViewer
        deck={activeDeck}
        onBack={function() { setActiveDeck(null); }}
        onDelete={function(id) { onDeckDeleted(id); setActiveDeck(null); }}
      />
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {decks.length === 0 && (
        <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '60px 16px', lineHeight: 1.9 }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>🎨</div>
          No decks yet.<br />
          Click <strong style={{ color: C.accent }}>+ Build New Collateral</strong> to create your first.
        </div>
      )}
      {decks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          {decks.map(function(deck) {
            return <DeckCard key={deck.id} deck={deck} onClick={function() { setActiveDeck(deck); }} />;
          })}
        </div>
      )}
    </div>
  );
}

// ─── CollateralPage ───────────────────────────────────────────────────────────
export default function CollateralPage() {
  // ALL hooks first
  var sWinW = useState(typeof window !== 'undefined' ? window.innerWidth : 1200); var winW = sWinW[0]; var setWinW = sWinW[1];
  var sDocs = useState([]); var docs = sDocs[0]; var setDocs = sDocs[1];
  var sConvs = useState([]); var convs = sConvs[0]; var setConvs = sConvs[1];
  var sActiveConvId = useState(null); var activeConvId = sActiveConvId[0]; var setActiveConvId = sActiveConvId[1];
  var sMessages = useState([]); var messages = sMessages[0]; var setMessages = sMessages[1];
  var sStreaming = useState(false); var streaming = sStreaming[0]; var setStreaming = sStreaming[1];
  var sMode = useState('chat'); var mode = sMode[0]; var setMode = sMode[1];
  var sMobPane = useState('right'); var mobPane = sMobPane[0]; var setMobPane = sMobPane[1];
  var sDecks = useState([]); var decks = sDecks[0]; var setDecks = sDecks[1];
  var sShowBuild = useState(false); var showBuildModal = sShowBuild[0]; var setShowBuildModal = sShowBuild[1];

  var isMob = winW < 768;

  useEffect(function() {
    function onResize() { setWinW(window.innerWidth); }
    window.addEventListener('resize', onResize);
    return function() { window.removeEventListener('resize', onResize); };
  }, []);

  useEffect(function() { loadDocs(); loadConvs(); loadDecks(); }, []);

  async function loadDocs() {
    try {
      var r = await fetch('/api/collateral/list');
      var d = await r.json();
      setDocs(d.docs || []);
    } catch (e) {}
  }

  async function loadConvs() {
    try {
      var r = await fetch('/api/collateral/conversations');
      var d = await r.json();
      setConvs(d.conversations || []);
    } catch (e) {}
  }

  async function loadDecks() {
    try {
      var r = await fetch('/api/collateral/decks');
      var d = await r.json();
      setDecks(d.decks || []);
    } catch (e) {}
  }

  async function loadConversation(convId) {
    setActiveConvId(convId);
    try {
      var r = await fetch('/api/collateral/conversation?id=' + convId);
      var d = await r.json();
      if (d.conversation) setMessages(d.conversation.messages || []);
    } catch (e) {}
    if (isMob) setMobPane('right');
  }

  function newChat() {
    setActiveConvId(null);
    setMessages([]);
    if (isMob) setMobPane('right');
  }

  function handleConvDeleted(convId) {
    setConvs(function(prev) { return prev.filter(function(c) { return c.id !== convId; }); });
    if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
  }

  function handleConvsCleared() {
    setConvs([]);
    setActiveConvId(null);
    setMessages([]);
  }

  function handleDeckDeleted(deckId) {
    setDecks(function(prev) { return prev.filter(function(d) { return d.id !== deckId; }); });
  }

  function handleBuildSuccess(deck) {
    setDecks(function(prev) { return [deck].concat(prev); });
    setShowBuildModal(false);
    setMode('decks');
    if (isMob) setMobPane('right');
  }

  async function sendMessage(text) {
    var userMsg = { role: 'user', content: text };
    var assistantMsg = { role: 'assistant', content: '', streaming: true, citations: [] };
    var updatedMessages = messages.concat([userMsg, assistantMsg]);
    setMessages(updatedMessages);
    setStreaming(true);

    try {
      var r = await fetch('/api/collateral/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConvId,
          message: text,
          messages: messages,
        }),
      });

      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      var accText = '';
      var newConvId = null;

      while (true) {
        var res = await reader.read();
        if (res.done) break;
        buf += decoder.decode(res.value, { stream: true });
        var parts = buf.split('\n\n');
        buf = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var line = parts[i].split('\n').find(function(l) { return l.startsWith('data: '); });
          if (!line) continue;
          try {
            var evt = JSON.parse(line.slice(6));
            if (evt.token) {
              accText += evt.token;
              (function(t) {
                setMessages(function(prev) {
                  var copy = prev.slice();
                  var last = copy[copy.length - 1];
                  if (last && last.streaming) {
                    copy[copy.length - 1] = Object.assign({}, last, { content: t });
                  }
                  return copy;
                });
              })(accText);
            }
            if (evt.done) {
              newConvId = evt.convId || null;
              var finalCitations = evt.citations || [];
              setMessages(function(prev) {
                var copy = prev.slice();
                var last = copy[copy.length - 1];
                if (last && last.streaming) {
                  copy[copy.length - 1] = Object.assign({}, last, { streaming: false, citations: finalCitations });
                }
                return copy;
              });
              if (newConvId && newConvId !== activeConvId) {
                setActiveConvId(newConvId);
                loadConvs();
              }
            }
            if (evt.error) throw new Error(evt.error);
          } catch (parseErr) {}
        }
      }
    } catch (err) {
      setMessages(function(prev) {
        var copy = prev.slice();
        var last = copy[copy.length - 1];
        if (last && last.streaming) {
          copy[copy.length - 1] = Object.assign({}, last, { content: 'Error: ' + err.message, streaming: false });
        }
        return copy;
      });
    }
    setStreaming(false);
  }

  // ─── Styles
  var paneStyle = { background: C.surface, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
  var modeBtn = function(active) { return { padding: '6px 16px', borderRadius: 20, border: '1px solid ' + (active ? C.accent : C.border), background: active ? C.accentDim : 'transparent', color: active ? C.accent : C.muted, fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }; };

  // Mobile pane switcher
  var mobTabs = [['left', '📁 Docs'], ['mid', '🕐 History'], ['right', mode === 'chat' ? '🗨 Chat' : mode === 'search' ? '🔍 Search' : '🎨 Decks']];

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Header bar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>📚 Sales Collateral</div>
        <button onClick={function() { setShowBuildModal(true); }}
          style={{ padding: '8px 18px', borderRadius: 8, background: C.accent, color: '#000', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          + Build New Collateral
        </button>
      </div>

      {/* Mobile tab switcher */}
      {isMob && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {mobTabs.map(function(t) {
            var active = mobPane === t[0];
            return (
              <button key={t[0]} onClick={function() { setMobPane(t[0]); }}
                style={{ flex: 1, padding: '7px 4px', borderRadius: 7, background: active ? C.accent : C.surface, color: active ? '#000' : C.muted, border: '1px solid ' + (active ? C.accent : C.border), fontSize: 10, fontWeight: active ? 800 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                {t[1]}
              </button>
            );
          })}
        </div>
      )}

      {/* 3-pane layout */}
      <div style={{ flex: 1, display: 'flex', gap: 10, minHeight: 0 }}>

        {/* Left — Document Library */}
        {(!isMob || mobPane === 'left') && (
          <div style={Object.assign({}, paneStyle, { width: isMob ? '100%' : '20%', minWidth: isMob ? '100%' : 190, flexShrink: 0 })}>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 12, marginBottom: 10, flexShrink: 0 }}>📚 Document Library</div>
            <DocLibrary docs={docs} onDelete={function() {}} onRefresh={loadDocs} />
          </div>
        )}

        {/* Middle — Conversation History */}
        {(!isMob || mobPane === 'mid') && (
          <div style={Object.assign({}, paneStyle, { width: isMob ? '100%' : '20%', minWidth: isMob ? '100%' : 170, flexShrink: 0 })}>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 12, marginBottom: 10, flexShrink: 0 }}>🕐 Conversations</div>
            <ConvHistory
              conversations={convs}
              activeId={activeConvId}
              onSelect={loadConversation}
              onNew={newChat}
              onDelete={handleConvDeleted}
              onClearAll={handleConvsCleared}
            />
          </div>
        )}

        {/* Right — Chat / Search */}
        {(!isMob || mobPane === 'right') && (
          <div style={Object.assign({}, paneStyle, { flex: 1, minWidth: 0 })}>
            {/* Mode toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
              <button onClick={function() { setMode('chat'); }} style={modeBtn(mode === 'chat')}>💬 Chat</button>
              <button onClick={function() { setMode('search'); }} style={modeBtn(mode === 'search')}>🔍 Search</button>
              <button onClick={function() { setMode('decks'); }} style={modeBtn(mode === 'decks')}>🎨 Decks {decks.length > 0 ? '(' + decks.length + ')' : ''}</button>
              {mode === 'chat' && activeConvId && (
                <span style={{ color: C.dim, fontSize: 9, marginLeft: 'auto' }}>conv: {activeConvId.slice(0, 8)}…</span>
              )}
            </div>

            {mode === 'chat'
              ? <ChatPane
                  conversationId={activeConvId}
                  messages={messages}
                  streaming={streaming}
                  onSend={sendMessage}
                  onConvIdSet={setActiveConvId}
                />
              : mode === 'search'
                ? <SearchPane />
                : <DeckPane decks={decks} onDeckDeleted={handleDeckDeleted} />
            }
          </div>
        )}
      </div>

      {showBuildModal && (
        <BuildModal
          docs={docs}
          onClose={function() { setShowBuildModal(false); }}
          onSuccess={handleBuildSuccess}
        />
      )}
    </div>
  );
}
