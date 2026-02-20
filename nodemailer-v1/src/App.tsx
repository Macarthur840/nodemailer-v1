import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

/* ─── Types ──────────────────────────── */
interface Smtp { host: string; port: string; user: string; pass: string; }
interface Template { id: string; name: string; subject: string; html: string; savedAt?: string; }
interface LogEntry { type: string; msg: string; ts: string; }

/* ─── Spintax helper ─────────────────── */
function spintax(t: string) {
  return t.replace(/\{([^{}]+)\}/g, (_, c) => {
    const o = c.split('|');
    return o[Math.floor(Math.random() * o.length)];
  });
}

/* ─── Styles ─────────────────────────── */
const S = {
  page: { minHeight:'100vh', background:'linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%)', color:'#e2e8f0', fontFamily:'-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif' } as React.CSSProperties,
  loginWrap: { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', padding:'20px' } as React.CSSProperties,
  loginBox: { background:'rgba(30,41,59,0.95)', borderRadius:'16px', padding:'40px', width:'100%', maxWidth:'400px', border:'1px solid rgba(99,102,241,0.3)', boxShadow:'0 25px 50px rgba(0,0,0,0.5)' } as React.CSSProperties,
  loginTitle: { textAlign:'center' as const, fontSize:'28px', fontWeight:700, marginBottom:'8px', background:'linear-gradient(135deg,#818cf8,#c084fc)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' },
  loginSub: { textAlign:'center' as const, color:'#94a3b8', marginBottom:'24px', fontSize:'14px' },
  label: { display:'block', fontSize:'12px', fontWeight:600, color:'#94a3b8', marginBottom:'6px', textTransform:'uppercase' as const, letterSpacing:'0.5px' },
  input: { width:'100%', padding:'12px 16px', background:'#0f172a', border:'1px solid #334155', borderRadius:'8px', color:'#e2e8f0', fontSize:'14px', outline:'none', boxSizing:'border-box' as const, marginBottom:'16px' },
  btnPrimary: { width:'100%', padding:'14px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', border:'none', borderRadius:'10px', fontSize:'16px', fontWeight:600, cursor:'pointer', letterSpacing:'0.5px' } as React.CSSProperties,
  sidebar: { width:'240px', background:'rgba(15,23,42,0.95)', borderRight:'1px solid #1e293b', padding:'20px 0', display:'flex', flexDirection:'column' as const, flexShrink:0, height:'100vh', position:'sticky' as const, top:0 },
  logo: { padding:'0 20px 20px', borderBottom:'1px solid #1e293b', marginBottom:'8px' },
  navBtn: (a: boolean) => ({ display:'flex', alignItems:'center', gap:'10px', width:'100%', padding:'12px 20px', background: a ? 'linear-gradient(90deg,rgba(99,102,241,0.2),transparent)' : 'transparent', color: a ? '#818cf8' : '#94a3b8', border:'none', borderLeft: a ? '3px solid #818cf8' : '3px solid transparent', cursor:'pointer', fontSize:'14px', fontWeight: a ? 600 : 400, textAlign:'left' as const }),
  main: { flex:1, padding:'24px', overflowY:'auto' as const, height:'100vh' },
  card: { background:'rgba(30,41,59,0.7)', borderRadius:'12px', border:'1px solid #334155', padding:'20px', marginBottom:'16px' },
  cardTitle: { fontSize:'16px', fontWeight:600, marginBottom:'16px', display:'flex', alignItems:'center', gap:'8px' },
  textarea: { width:'100%', minHeight:'120px', padding:'12px', background:'#0f172a', border:'1px solid #334155', borderRadius:'8px', color:'#e2e8f0', fontFamily:'monospace', fontSize:'13px', resize:'vertical' as const, outline:'none', boxSizing:'border-box' as const },
  grid: (cols: number) => ({ display:'grid', gridTemplateColumns:`repeat(${cols},1fr)`, gap:'12px' }),
  stat: (bg: string) => ({ background:`linear-gradient(135deg,${bg})`, borderRadius:'12px', padding:'16px', textAlign:'center' as const }),
  statVal: { fontSize:'28px', fontWeight:700, color:'#fff' },
  statLbl: { fontSize:'11px', color:'rgba(255,255,255,0.7)', marginTop:'4px', textTransform:'uppercase' as const },
  portBtn: (a: boolean) => ({ padding:'12px 20px', borderRadius:'10px', border: a ? '2px solid #818cf8' : '2px solid #334155', background: a ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#0f172a', color:'#fff', cursor:'pointer', fontWeight:600, fontSize:'14px', textAlign:'center' as const, flex:1 }),
  logBox: { background:'#0f172a', borderRadius:'8px', padding:'12px', maxHeight:'300px', overflowY:'auto' as const, fontFamily:'monospace', fontSize:'12px', border:'1px solid #1e293b' },
  tag: (c: string) => ({ display:'inline-block', padding:'4px 10px', borderRadius:'20px', fontSize:'11px', background:c, color:'#fff', margin:'2px' }),
  progressBar: { width:'100%', height:'12px', background:'#1e293b', borderRadius:'6px', overflow:'hidden' as const },
  progressFill: (pct: number) => ({ width:`${pct}%`, height:'100%', background:'linear-gradient(90deg,#6366f1,#8b5cf6,#c084fc)', borderRadius:'6px', transition:'width 0.3s' }),
  badge: (c: string) => ({ padding:'2px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:600, background:c, color:'#fff' }),
  flexRow: { display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' as const },
  modal: { position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'20px' },
  modalBox: { background:'#1e293b', borderRadius:'16px', padding:'24px', width:'100%', maxWidth:'600px', maxHeight:'80vh', overflowY:'auto' as const, border:'1px solid #334155' },
};

export default function App() {
  /* ─── Auth ──────────────────────────── */
  const [loggedIn, setLoggedIn] = useState(() => sessionStorage.getItem('auth') === 'true');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  /* ─── Navigation ────────────────────── */
  const [tab, setTab] = useState('dashboard');

  /* ─── SMTP & Proxy ──────────────────── */
  const [smtpText, setSmtpText] = useState('');
  const [smtps, setSmtps] = useState<Smtp[]>([]);
  const [proxyText, setProxyText] = useState('');
  const [proxies, setProxies] = useState<string[]>([]);
  const [smtpPort, setSmtpPort] = useState('587');
  const [useProxies, setUseProxies] = useState(false);

  /* ─── Compose ───────────────────────── */
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('<h1>Hello!</h1><p>This is a test email.</p>');
  const [showPreview, setShowPreview] = useState(false);

  /* ─── Settings ──────────────────────── */
  const [minDelay, setMinDelay] = useState(1000);
  const [maxDelay, setMaxDelay] = useState(3000);
  const [emailsPerRotation, setEmailsPerRotation] = useState(10);
  const [totalMails, setTotalMails] = useState(0);

  /* ─── Templates (load from server on mount) ── */
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [templateName, setTemplateName] = useState('');

  /* ─── Sending State ─────────────────── */
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0, pct: 0, currentSmtp: '', currentRecipient: '', currentProxy: '', currentPort: '' });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [tracking, setTracking] = useState({ opens: 0, clicks: 0 });

  /* ─── Socket ref ────────────────────── */
  const socketRef = useRef<Socket | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  /* ─── Load templates from server on login ── */
  useEffect(() => {
    if (!loggedIn) return;
    fetch('/api/templates').then(r => r.json()).then(data => {
      if (Array.isArray(data) && data.length > 0) setTemplates(data);
    }).catch(() => {});
    // Load tracking stats
    fetch('/api/tracking').then(r => r.json()).then(data => {
      if (data) setTracking(data);
    }).catch(() => {});
  }, [loggedIn]);

  /* ─── Socket.io connection ──────────── */
  useEffect(() => {
    if (!loggedIn) return;
    const s = io(window.location.origin, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000 });
    socketRef.current = s;

    s.on('connect', () => {
      addLog('info', '🔌 Connected to server');
    });
    s.on('connect_error', (err) => {
      addLog('error', `Connection error: ${err.message}`);
    });
    s.on('send-log', (data: { type: string; msg: string }) => {
      addLog(data.type, data.msg);
    });
    s.on('send-progress', (data: any) => {
      setProgress(data);
    });
    s.on('send-error', (msg: string) => {
      addLog('error', `🚫 ${msg}`);
      setSending(false);
    });
    s.on('send-complete', (data: { sent: number; failed: number; opens: number; clicks: number }) => {
      addLog('info', `🏁 Done! Sent: ${data.sent} | Failed: ${data.failed} | Opens: ${data.opens} | Clicks: ${data.clicks}`);
      setSending(false);
      setPaused(false);
      setTracking({ opens: data.opens, clicks: data.clicks });
    });

    return () => { s.disconnect(); };
  }, [loggedIn]);

  /* ─── Auto-scroll log ──────────────── */
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  /* ─── Helpers ───────────────────────── */
  const addLog = useCallback((type: string, msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-200), { type, msg, ts }]);
  }, []);

  const parseSmtps = (text: string) => {
    const list: Smtp[] = [];
    text.split('\n').forEach(line => {
      const t = line.trim();
      if (!t) return;
      const p = t.split('|');
      if (p.length >= 4) list.push({ host: p[0].trim(), port: p[1].trim(), user: p[2].trim(), pass: p[3].trim() });
    });
    setSmtps(list);
  };

  const parseRecipients = (text: string) => {
    const list = text.split('\n').map(l => l.trim()).filter(l => l && l.includes('@'));
    setRecipients(list);
  };

  /* ─── Login ─────────────────────────── */
  const doLogin = async () => {
    setLoginErr('');
    setLoginLoading(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass })
      });
      const d = await r.json();
      if (d.success) {
        sessionStorage.setItem('auth', 'true');
        setLoggedIn(true);
      } else {
        setLoginErr(d.error || 'Invalid credentials');
      }
    } catch {
      setLoginErr('Server not reachable. Make sure the Node.js server is running.');
    }
    setLoginLoading(false);
  };

  const doLogout = () => {
    sessionStorage.removeItem('auth');
    setLoggedIn(false);
    socketRef.current?.disconnect();
  };

  /* ─── Templates ─────────────────────── */
  const saveTemplate = async () => {
    if (!templateName.trim()) return;
    const tmpl: Template = { id: Date.now().toString(), name: templateName, subject, html: htmlBody, savedAt: new Date().toISOString() };
    const updated = [...templates, tmpl];
    setTemplates(updated);
    setShowSaveModal(false);
    setTemplateName('');
    try { await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) }); } catch {}
    addLog('info', `💾 Template "${tmpl.name}" saved`);
  };

  const loadTemplate = (t: Template) => {
    setSubject(t.subject);
    setHtmlBody(t.html);
    setShowLoadModal(false);
    addLog('info', `📂 Template "${t.name}" loaded`);
  };

  const deleteTemplate = async (id: string) => {
    const updated = templates.filter(t => t.id !== id);
    setTemplates(updated);
    try { await fetch(`/api/templates/${id}`, { method: 'DELETE' }); } catch {}
  };

  /* ─── File Upload ───────────────────── */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRecipientText(text);
      parseRecipients(text);
    };
    reader.readAsText(file);
  };

  /* ─── Sending Controls ─────────────── */
  const startSending = () => {
    const s = socketRef.current;
    if (!s || !s.connected) { addLog('error', '🚫 Not connected to server. Refresh the page.'); return; }
    if (smtps.length === 0) { addLog('error', '🚫 Add SMTP servers first'); return; }
    if (recipients.length === 0) { addLog('error', '🚫 Add recipients first'); return; }
    if (!subject.trim()) { addLog('error', '🚫 Enter a subject line'); return; }
    if (!htmlBody.trim()) { addLog('error', '🚫 Enter email body'); return; }

    setSending(true);
    setPaused(false);
    setLogs([]);
    setProgress({ sent: 0, failed: 0, total: 0, pct: 0, currentSmtp: '', currentRecipient: '', currentProxy: '', currentPort: '' });

    s.emit('start-sending', {
      smtps, proxies, recipients, fromName, fromEmail, replyTo,
      subject, htmlBody, minDelay, maxDelay, emailsPerRotation,
      totalMailsToSend: totalMails, useProxies, smtpPort
    });
  };

  const pauseSending = () => { socketRef.current?.emit('pause-sending'); setPaused(true); };
  const resumeSending = () => { socketRef.current?.emit('resume-sending'); setPaused(false); };
  const stopSending = () => { socketRef.current?.emit('stop-sending'); setSending(false); setPaused(false); };

  /* ─── Render: Login Screen ──────────── */
  if (!loggedIn) {
    return (
      <div style={S.page}>
        <div style={S.loginWrap}>
          <div style={S.loginBox}>
            <div style={{ textAlign: 'center', fontSize: '48px', marginBottom: '12px' }}>📧</div>
            <h1 style={S.loginTitle}>NodeMailer Pro</h1>
            <p style={S.loginSub}>Bulk Email System — Admin Login</p>
            {loginErr && <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', borderRadius: '8px', padding: '10px', marginBottom: '16px', color: '#fca5a5', fontSize: '13px', textAlign: 'center' }}>{loginErr}</div>}
            <label style={S.label}>Username</label>
            <input style={S.input} value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="Enter username" onKeyDown={e => e.key === 'Enter' && doLogin()} />
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Enter password" onKeyDown={e => e.key === 'Enter' && doLogin()} />
            <button style={{ ...S.btnPrimary, opacity: loginLoading ? 0.7 : 1 }} onClick={doLogin} disabled={loginLoading}>
              {loginLoading ? '⏳ Signing in...' : '🔐 Sign In'}
            </button>
            <p style={{ textAlign: 'center', color: '#64748b', fontSize: '11px', marginTop: '16px' }}>Authorized personnel only</p>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Render: Dashboard ─────────────── */
  const tabs = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'compose', icon: '✏️', label: 'Compose' },
    { id: 'smtp', icon: '⚙️', label: 'SMTP & Proxy' },
    { id: 'send', icon: '🚀', label: 'Send' },
  ];

  return (
    <div style={{ ...S.page, display: 'flex' }}>
      {/* ─── Sidebar ─── */}
      <div style={S.sidebar}>
        <div style={S.logo}>
          <div style={{ fontSize: '24px', marginBottom: '4px' }}>📧</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#e2e8f0' }}>NodeMailer Pro</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Bulk Email System</div>
        </div>
        <nav style={{ flex: 1, paddingTop: '8px' }}>
          {tabs.map(t => (
            <button key={t.id} style={S.navBtn(tab === t.id)} onClick={() => setTab(t.id)}>
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>👤 Admin</div>
          <button onClick={doLogout} style={{ width: '100%', padding: '8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#fca5a5', cursor: 'pointer', fontSize: '12px' }}>🚪 Logout</button>
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <div style={S.main}>
        {/* ─── DASHBOARD TAB ─── */}
        {tab === 'dashboard' && (
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>📊 Dashboard</h2>
            <div style={S.grid(3)}>
              <div style={S.stat('#6366f1,#8b5cf6')}><div style={S.statVal}>{smtps.length}</div><div style={S.statLbl}>SMTP Servers</div></div>
              <div style={S.stat('#8b5cf6,#a855f7')}><div style={S.statVal}>{proxies.length}</div><div style={S.statLbl}>Proxies</div></div>
              <div style={S.stat('#a855f7,#c084fc')}><div style={S.statVal}>{recipients.length}</div><div style={S.statLbl}>Recipients</div></div>
            </div>
            <div style={{ ...S.grid(3), marginTop: '12px' }}>
              <div style={S.stat('#059669,#10b981')}><div style={S.statVal}>{progress.sent}</div><div style={S.statLbl}>Emails Sent</div></div>
              <div style={S.stat('#0891b2,#06b6d4')}>
                <div style={S.statVal}>{tracking.opens}</div>
                <div style={S.statLbl}>Opened {progress.sent > 0 ? `(${Math.round(tracking.opens / progress.sent * 100)}%)` : ''}</div>
              </div>
              <div style={S.stat('#e11d48,#f43f5e')}>
                <div style={S.statVal}>{tracking.clicks}</div>
                <div style={S.statLbl}>Clicked {progress.sent > 0 ? `(${Math.round(tracking.clicks / progress.sent * 100)}%)` : ''}</div>
              </div>
            </div>

            {/* System Status */}
            <div style={{ ...S.card, marginTop: '16px' }}>
              <div style={S.cardTitle}>🔧 System Readiness</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { ok: smtps.length > 0, label: 'SMTP Servers loaded', detail: `${smtps.length} server(s)` },
                  { ok: recipients.length > 0, label: 'Recipients loaded', detail: `${recipients.length} email(s)` },
                  { ok: subject.trim().length > 0, label: 'Subject line set', detail: subject ? subject.substring(0, 40) : 'Not set' },
                  { ok: htmlBody.trim().length > 0, label: 'Email body ready', detail: htmlBody ? `${htmlBody.length} chars` : 'Empty' },
                  { ok: !useProxies || proxies.length > 0, label: 'Proxies configured', detail: useProxies ? `${proxies.length} proxy(es)` : 'Disabled' },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'rgba(15,23,42,0.5)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '16px' }}>{item.ok ? '✅' : '⬜'}</span>
                    <span style={{ flex: 1, fontSize: '13px', color: item.ok ? '#e2e8f0' : '#64748b' }}>{item.label}</span>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>{item.detail}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tracking Info */}
            <div style={{ ...S.card, marginTop: '16px' }}>
              <div style={S.cardTitle}>📬 Tracking System</div>
              <div style={S.grid(2)}>
                <div style={{ padding: '12px', background: 'rgba(8,145,178,0.1)', borderRadius: '8px', border: '1px solid rgba(8,145,178,0.2)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#06b6d4', marginBottom: '4px' }}>📖 Open Tracking</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>1×1 pixel beacon injected into each email. Tracked server-side via /track/open/:id endpoint.</div>
                </div>
                <div style={{ padding: '12px', background: 'rgba(225,29,72,0.1)', borderRadius: '8px', border: '1px solid rgba(225,29,72,0.2)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f43f5e', marginBottom: '4px' }}>🔗 Click Tracking</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Links wrapped with redirect URLs. Each click logged server-side via /track/click/:id endpoint.</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── COMPOSE TAB ─── */}
        {tab === 'compose' && (
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>✏️ Compose Email</h2>

            {/* From / Mask Info */}
            <div style={S.card}>
              <div style={S.cardTitle}>👤 Sender Configuration</div>
              <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '13px', color: '#a5b4fc' }}>
                💡 <strong>Auto Send-From:</strong> If "From Email (Mask)" is left blank, each SMTP's username will automatically be used as the sender email. The sender rotates with SMTP rotation.
              </div>
              <div style={S.grid(3)}>
                <div>
                  <label style={S.label}>From Name</label>
                  <input style={S.input} value={fromName} onChange={e => setFromName(e.target.value)} placeholder='e.g. John Doe' />
                </div>
                <div>
                  <label style={S.label}>From Email (Mask - Optional)</label>
                  <input style={S.input} value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder='Leave blank for auto SMTP rotation' />
                </div>
                <div>
                  <label style={S.label}>Reply-To (Optional)</label>
                  <input style={S.input} value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder='reply@example.com' />
                </div>
              </div>
              {smtps.length > 0 && !fromEmail && (
                <div style={{ marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Sender rotation queue: </span>
                  {smtps.map((s, i) => <span key={i} style={S.tag('rgba(99,102,241,0.3)')}>{s.user}</span>)}
                </div>
              )}
            </div>

            {/* Recipients */}
            <div style={S.card}>
              <div style={S.cardTitle}>📋 Recipients (Mail To)</div>
              <textarea style={S.textarea} value={recipientText} onChange={e => { setRecipientText(e.target.value); parseRecipients(e.target.value); }} placeholder={'Paste recipient emails (one per line):\njohn@example.com\njane@example.com'} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                <div>
                  <input type="file" accept=".txt,.csv" onChange={handleFileUpload} style={{ fontSize: '12px', color: '#94a3b8' }} />
                </div>
                <span style={S.badge(recipients.length > 0 ? '#059669' : '#64748b')}>{recipients.length} recipients loaded</span>
              </div>
            </div>

            {/* Subject */}
            <div style={S.card}>
              <div style={S.cardTitle}>📝 Subject Line</div>
              <input style={S.input} value={subject} onChange={e => setSubject(e.target.value)} placeholder='e.g. {Hello|Hi|Hey} — Check out our {offer|deal|promo}!' />
              {subject && (
                <div style={{ marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Preview: </span>
                  <span style={{ fontSize: '13px', color: '#a5b4fc', fontStyle: 'italic' }}>{spintax(subject)}</span>
                </div>
              )}
            </div>

            {/* HTML Body */}
            <div style={S.card}>
              <div style={{ ...S.cardTitle, justifyContent: 'space-between' }}>
                <span>📄 HTML Body</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setShowPreview(true)} style={{ padding: '6px 14px', background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: '6px', color: '#06b6d4', cursor: 'pointer', fontSize: '12px' }}>👁️ Preview</button>
                </div>
              </div>
              <textarea style={{ ...S.textarea, minHeight: '200px' }} value={htmlBody} onChange={e => setHtmlBody(e.target.value)} placeholder='<h1>Hello!</h1><p>Your HTML content here...</p>' />
            </div>

            {/* Template Manager */}
            <div style={S.card}>
              <div style={{ ...S.cardTitle, justifyContent: 'space-between' }}>
                <span>💾 Email Templates</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setShowSaveModal(true)} style={{ padding: '6px 14px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px', color: '#818cf8', cursor: 'pointer', fontSize: '12px' }}>💾 Save Current</button>
                  <button onClick={() => setShowLoadModal(true)} style={{ padding: '6px 14px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10b981', cursor: 'pointer', fontSize: '12px' }}>📂 Load Template</button>
                </div>
              </div>
              {templates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '13px' }}>No saved templates yet. Compose an email and click "Save Current".</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {templates.map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#a5b4fc' }}>📄 {t.name}</span>
                      <button onClick={() => loadTemplate(t)} style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: '12px', padding: '2px' }}>✅</button>
                      <button onClick={() => deleteTemplate(t.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', padding: '2px' }}>🗑️</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Session Settings */}
            <div style={S.card}>
              <div style={S.cardTitle}>⚙️ Session Settings</div>
              <div style={S.grid(3)}>
                <div>
                  <label style={S.label}>Min Delay (ms)</label>
                  <input style={S.input} type="number" value={minDelay} onChange={e => setMinDelay(Number(e.target.value))} />
                </div>
                <div>
                  <label style={S.label}>Max Delay (ms)</label>
                  <input style={S.input} type="number" value={maxDelay} onChange={e => setMaxDelay(Number(e.target.value))} />
                </div>
                <div>
                  <label style={S.label}>Emails Per SMTP Rotation</label>
                  <input style={S.input} type="number" value={emailsPerRotation} onChange={e => setEmailsPerRotation(Number(e.target.value))} />
                </div>
              </div>
              <div style={{ marginTop: '4px' }}>
                <label style={S.label}>Total Mails to Send (0 = Send All)</label>
                <input style={{ ...S.input, maxWidth: '300px' }} type="number" value={totalMails} onChange={e => setTotalMails(Number(e.target.value))} placeholder='0 = send to all recipients' />
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '-10px' }}>Set to 0 to send to all loaded recipients. Set a number to limit this session.</div>
              </div>
            </div>
          </div>
        )}

        {/* ─── SMTP & PROXY TAB ─── */}
        {tab === 'smtp' && (
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>⚙️ SMTP & Proxy Configuration</h2>

            {/* SMTP */}
            <div style={S.card}>
              <div style={S.cardTitle}>📡 SMTP Servers</div>
              <textarea style={S.textarea} value={smtpText} onChange={e => { setSmtpText(e.target.value); parseSmtps(e.target.value); }} placeholder={'Paste SMTP credentials (one per line):\nhost|port|user|pass\nsmtp.gmail.com|587|user@gmail.com|app-password\nsmtp.office365.com|587|user@outlook.com|password'} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Format: host|port|user|pass</span>
                <span style={S.badge(smtps.length > 0 ? '#6366f1' : '#64748b')}>{smtps.length} SMTP(s) parsed</span>
              </div>
              {smtps.length > 0 && (
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {smtps.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(15,23,42,0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                      <span style={{ fontSize: '14px' }}>🟢</span>
                      <span style={{ flex: 1, fontSize: '13px', color: '#e2e8f0' }}>{s.host}:{s.port}</span>
                      <span style={{ fontSize: '12px', color: '#a5b4fc' }}>{s.user}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* PORT SELECTION - PROMINENT */}
            <div style={{ ...S.card, background: 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1))', border: '1px solid rgba(99,102,241,0.3)' }}>
              <div style={S.cardTitle}>🔌 SMTP Port Selection</div>
              <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>Select the default port for SMTP connections. If the selected port fails, the system will automatically try alternative ports.</p>
              <div style={{ display: 'flex', gap: '12px' }}>
                {[
                  { port: '25', label: 'Port 25', sub: 'Standard', warn: '⚠️ Often blocked' },
                  { port: '465', label: 'Port 465', sub: 'SSL/TLS', warn: '🔒 Encrypted' },
                  { port: '587', label: 'Port 587', sub: 'STARTTLS', warn: '✅ Recommended' },
                  { port: '2525', label: 'Port 2525', sub: 'Alternative', warn: '🔄 Fallback' },
                ].map(p => (
                  <button key={p.port} onClick={() => setSmtpPort(p.port)} style={S.portBtn(smtpPort === p.port)}>
                    <div style={{ fontSize: '18px', fontWeight: 700 }}>{p.port}</div>
                    <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>{p.sub}</div>
                    <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.7 }}>{p.warn}</div>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(15,23,42,0.5)', borderRadius: '8px', fontSize: '12px', color: '#a5b4fc' }}>
                ℹ️ <strong>Port Fallback Order:</strong> {smtpPort} → {['587', '465', '2525', '25'].filter(p => p !== smtpPort).join(' → ')}
              </div>
            </div>

            {/* Proxies */}
            <div style={S.card}>
              <div style={{ ...S.cardTitle, justifyContent: 'space-between' }}>
                <span>🛡️ Proxy Configuration</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={useProxies} onChange={e => setUseProxies(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: '#6366f1' }} />
                  <span style={{ fontSize: '13px', color: useProxies ? '#10b981' : '#64748b' }}>{useProxies ? 'Proxies Enabled' : 'Proxies Disabled'}</span>
                </label>
              </div>
              <textarea style={S.textarea} value={proxyText} onChange={e => { setProxyText(e.target.value); setProxies(e.target.value.split('\n').map(l => l.trim()).filter(Boolean)); }} placeholder={'Paste proxies (one per line):\nhost:port\nhost:port:username:password\n192.168.1.1:1080\n10.0.0.1:1080:user:pass'} disabled={!useProxies} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Format: host:port or host:port:user:pass (SOCKS5)</span>
                <span style={S.badge(proxies.length > 0 && useProxies ? '#8b5cf6' : '#64748b')}>{useProxies ? `${proxies.length} proxies` : 'Disabled'}</span>
              </div>
            </div>
          </div>
        )}

        {/* ─── SEND TAB ─── */}
        {tab === 'send' && (
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>🚀 Send Campaign</h2>

            {/* Controls */}
            <div style={S.card}>
              <div style={S.cardTitle}>🎛️ Campaign Controls</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {!sending && (
                  <button onClick={startSending} style={{ ...S.btnPrimary, width: 'auto', padding: '14px 32px', fontSize: '15px' }}>
                    🚀 Start Sending
                  </button>
                )}
                {sending && !paused && (
                  <button onClick={pauseSending} style={{ padding: '14px 28px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: '10px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>⏸️ Pause</button>
                )}
                {sending && paused && (
                  <button onClick={resumeSending} style={{ padding: '14px 28px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: '10px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>▶️ Resume</button>
                )}
                {sending && (
                  <button onClick={stopSending} style={{ padding: '14px 28px', background: 'linear-gradient(135deg,#ef4444,#dc2626)', border: 'none', borderRadius: '10px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>⏹️ Stop</button>
                )}
              </div>
            </div>

            {/* Status Display */}
            <div style={S.card}>
              <div style={S.cardTitle}>📡 Current Status</div>
              <div style={S.grid(2)}>
                <div style={{ padding: '12px', background: 'rgba(15,23,42,0.5)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>FROM (SMTP)</div>
                  <div style={{ fontSize: '14px', color: '#a5b4fc', fontWeight: 600 }}>{progress.currentSmtp || (smtps.length > 0 ? smtps[0].user : 'No SMTP loaded')}</div>
                </div>
                <div style={{ padding: '12px', background: 'rgba(15,23,42,0.5)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>TO (RECIPIENT)</div>
                  <div style={{ fontSize: '14px', color: '#10b981', fontWeight: 600 }}>{progress.currentRecipient || (recipients.length > 0 ? recipients[0] : 'No recipients loaded')}</div>
                </div>
                <div style={{ padding: '12px', background: 'rgba(15,23,42,0.5)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>PROXY</div>
                  <div style={{ fontSize: '14px', color: '#c084fc', fontWeight: 600 }}>{progress.currentProxy || (useProxies && proxies.length > 0 ? proxies[0] : 'Direct (No Proxy)')}</div>
                </div>
                <div style={{ padding: '12px', background: 'rgba(15,23,42,0.5)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>PORT</div>
                  <div style={{ fontSize: '14px', color: '#fbbf24', fontWeight: 600 }}>Port {progress.currentPort || smtpPort}</div>
                </div>
              </div>
            </div>

            {/* Progress */}
            <div style={S.card}>
              <div style={S.cardTitle}>📈 Progress</div>
              <div style={S.progressBar}>
                <div style={S.progressFill(progress.pct)} />
              </div>
              <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '20px', fontWeight: 700, color: '#818cf8' }}>{progress.pct}%</div>
              <div style={{ ...S.grid(4), marginTop: '12px' }}>
                <div style={{ textAlign: 'center', padding: '10px', background: 'rgba(16,185,129,0.1)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981' }}>{progress.sent}</div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>SENT</div>
                </div>
                <div style={{ textAlign: 'center', padding: '10px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#ef4444' }}>{progress.failed}</div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>FAILED</div>
                </div>
                <div style={{ textAlign: 'center', padding: '10px', background: 'rgba(6,182,212,0.1)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#06b6d4' }}>{tracking.opens}</div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>OPENED</div>
                </div>
                <div style={{ textAlign: 'center', padding: '10px', background: 'rgba(244,63,94,0.1)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#f43f5e' }}>{tracking.clicks}</div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>CLICKED</div>
                </div>
              </div>
            </div>

            {/* Activity Log */}
            <div style={S.card}>
              <div style={{ ...S.cardTitle, justifyContent: 'space-between' }}>
                <span>📋 Activity Log</span>
                <button onClick={() => setLogs([])} style={{ padding: '4px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#fca5a5', cursor: 'pointer', fontSize: '11px' }}>Clear</button>
              </div>
              <div ref={logBoxRef} style={S.logBox}>
                {logs.length === 0 ? (
                  <div style={{ color: '#475569', textAlign: 'center', padding: '30px' }}>Waiting for campaign to start...</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(30,41,59,0.5)', color: log.type === 'success' ? '#10b981' : log.type === 'error' ? '#ef4444' : log.type === 'warn' ? '#f59e0b' : '#94a3b8' }}>
                      <span style={{ color: '#475569', marginRight: '8px' }}>[{log.ts}]</span>
                      {log.msg}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── PREVIEW MODAL ─── */}
      {showPreview && (
        <div style={S.modal} onClick={() => setShowPreview(false)}>
          <div style={{ ...S.modalBox, maxWidth: '700px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>👁️ Email Preview</h3>
              <button onClick={() => setShowPreview(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>
            <div style={{ background: '#0f172a', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px' }}>
              <div><strong style={{ color: '#64748b' }}>From:</strong> <span style={{ color: '#a5b4fc' }}>{fromName || 'Sender'} &lt;{fromEmail || (smtps[0]?.user || 'smtp@example.com')}&gt;</span></div>
              <div><strong style={{ color: '#64748b' }}>Subject:</strong> <span style={{ color: '#e2e8f0' }}>{spintax(subject) || '(No subject)'}</span></div>
            </div>
            <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', color: '#000', minHeight: '200px' }} dangerouslySetInnerHTML={{ __html: spintax(htmlBody) || '<p style="color:#999">No content to preview</p>' }} />
          </div>
        </div>
      )}

      {/* ─── SAVE TEMPLATE MODAL ─── */}
      {showSaveModal && (
        <div style={S.modal} onClick={() => setShowSaveModal(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>💾 Save Template</h3>
            <label style={S.label}>Template Name</label>
            <input style={S.input} value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder='e.g. Welcome Email, Promo Blast' onKeyDown={e => e.key === 'Enter' && saveTemplate()} autoFocus />
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>
              This will save the current Subject and HTML Body for later use.
              Templates are stored permanently on the server.
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSaveModal(false)} style={{ padding: '10px 20px', background: '#334155', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveTemplate} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>💾 Save Template</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── LOAD TEMPLATE MODAL ─── */}
      {showLoadModal && (
        <div style={S.modal} onClick={() => setShowLoadModal(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>📂 Load Template</h3>
            {templates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>No saved templates. Save one first in the Compose tab.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {templates.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', padding: '14px', background: 'rgba(15,23,42,0.5)', borderRadius: '8px', border: '1px solid #334155' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>📄 {t.name}</div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Subject: {t.subject || '(none)'}</div>
                      {t.savedAt && <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{new Date(t.savedAt).toLocaleString()}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => loadTemplate(t)} style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Load</button>
                      <button onClick={() => deleteTemplate(t.id)} style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#fca5a5', cursor: 'pointer', fontSize: '12px' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button onClick={() => setShowLoadModal(false)} style={{ padding: '10px 20px', background: '#334155', border: 'none', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
