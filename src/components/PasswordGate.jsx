import React, { useState, useEffect, useRef } from 'react';

var C = {
  bg: '#07090F', surface: '#0D1117', card: '#111827', border: '#1F2937',
  accent: '#00C2FF', text: '#F1F5F9', muted: '#94A3B8', dim: '#334155',
  red: '#EF4444', purple: '#8B5CF6',
};

export default function PasswordGate({ children }) {
  var sStatus = useState('checking'); var status = sStatus[0]; var setStatus = sStatus[1];
  var sPassword = useState(''); var password = sPassword[0]; var setPassword = sPassword[1];
  var sError = useState(''); var error = sError[0]; var setError = sError[1];
  var sSubmitting = useState(false); var submitting = sSubmitting[0]; var setSubmitting = sSubmitting[1];
  var inputRef = useRef(null);
  var checkedRef = useRef(false);

  useEffect(function() {
    if (checkedRef.current) return;
    checkedRef.current = true;
    console.log('[PasswordGate] mount, checking auth');
    fetch('/api/auth/check')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        console.log('[PasswordGate] check result:', d);
        setStatus(d.authenticated ? 'authed' : 'login');
      })
      .catch(function(e) {
        console.log('[PasswordGate] check error:', e);
        setStatus('login');
      });
  }, []);

  useEffect(function() {
    if (status === 'login' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [status]);

  async function handleSubmit() {
    if (!password.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      var r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password }),
      });
      var data = await r.json();
      if (r.ok && data.ok) {
        setStatus('authed');
      } else if (r.status === 429) {
        setError('Too many attempts. Please wait a minute.');
        setSubmitting(false);
      } else {
        setError(data.error || 'Invalid password');
        setSubmitting(false);
      }
    } catch (err) {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') handleSubmit();
  }

  if (status === 'checking') {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace' }}>
        <div style={{ color: C.dim, fontSize: 12 }}>Loading…</div>
      </div>
    );
  }

  if (status === 'authed') {
    return children;
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace', padding: 16 }}>
      <div style={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>

        {/* Logo */}
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,' + C.accent + ',' + C.purple + ')', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 20 }}>₿</div>

        {/* Title */}
        <div style={{ color: C.text, fontWeight: 800, fontSize: 14, letterSpacing: '0.05em', marginBottom: 4 }}>COINPAYMENTS</div>
        <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.12em', marginBottom: 28 }}>SALES INTELLIGENCE</div>

        <div style={{ color: C.muted, fontSize: 12, marginBottom: 20 }}>Enter access password</div>

        {/* Input */}
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={function(e) { setPassword(e.target.value); setError(''); }}
          onKeyDown={onKeyDown}
          placeholder="Password"
          disabled={submitting}
          style={{ width: '100%', background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '11px 14px', color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
        />

        {/* Button */}
        <button
          onClick={handleSubmit}
          disabled={!password.trim() || submitting}
          style={{ width: '100%', padding: '11px', borderRadius: 8, background: (!password.trim() || submitting) ? C.card : C.accent, color: (!password.trim() || submitting) ? C.dim : '#000', border: '1px solid ' + ((!password.trim() || submitting) ? C.border : C.accent), fontWeight: 800, fontSize: 13, cursor: (!password.trim() || submitting) ? 'default' : 'pointer', fontFamily: 'inherit', letterSpacing: '0.03em' }}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>

        {/* Error */}
        {error && (
          <div style={{ marginTop: 12, color: C.red, fontSize: 11, textAlign: 'center' }}>{error}</div>
        )}
      </div>
    </div>
  );
}
