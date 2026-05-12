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
function ConvHistory({ conversations, activeId, onSelect, onNew }) {
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
          return (
            <div key={conv.id} onClick={function() { onSelect(conv.id); }}
              style={{ background: isActive ? C.accentDim : C.card, border: '1px solid ' + (isActive ? C.accent : C.border), borderRadius: 8, padding: '9px 10px', cursor: 'pointer', transition: 'all 0.1s' }}>
              <div style={{ color: isActive ? C.accent : C.text, fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title || 'Untitled'}</div>
              <div style={{ color: C.dim, fontSize: 9, marginTop: 2 }}>
                {conv.messageCount || 0} msgs · {fmtRelTime(conv.lastMessageAt)}
              </div>
            </div>
          );
        })}
      </div>
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

  var isMob = winW < 768;

  useEffect(function() {
    function onResize() { setWinW(window.innerWidth); }
    window.addEventListener('resize', onResize);
    return function() { window.removeEventListener('resize', onResize); };
  }, []);

  useEffect(function() { loadDocs(); loadConvs(); }, []);

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
  var mobTabs = [['left', '📁 Docs'], ['mid', '💬 History'], ['right', mode === 'chat' ? '🗨 Chat' : '🔍 Search']];

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', gap: 10 }}>

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
              : <SearchPane />
            }
          </div>
        )}
      </div>
    </div>
  );
}
