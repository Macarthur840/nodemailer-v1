import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import nodemailer from 'nodemailer';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = createServer(app);

// ─── FIXED: Proper CORS configuration for Socket.io ─────────────────
const io = new Server(server, {
  cors: { 
    origin: '*',  // Allow all origins (safe for bulk email tool)
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false  // Must be false when using origin: '*'
  },
  // Transport configuration - try WebSocket first, fallback to polling
  transports: ['websocket', 'polling'],
  pingTimeout: 120000,    // Increased from default
  pingInterval: 30000,    // Increased from default
  upgradeTimeout: 30000,
  allowEIO3: true,        // Allow older clients
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;
const TEMPLATES_FILE = path.join(__dirname, 'templates.json');
const TRACKING_FILE = path.join(__dirname, 'tracking.json');

// Ensure data files exist
try { if (!fs.existsSync(TEMPLATES_FILE)) fs.writeFileSync(TEMPLATES_FILE, '[]'); } catch(e) { console.log('templates.json init:', e.message); }
try { if (!fs.existsSync(TRACKING_FILE)) fs.writeFileSync(TRACKING_FILE, '{"opens":{},"clicks":{}}'); } catch(e) { console.log('tracking.json init:', e.message); }

// ─── FIXED: Add CORS middleware to Express ─────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Helpers
function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch(e) { console.error('Save error:', e.message); }
}
function spintax(text) {
  if (!text) return '';
  return text.replace(/\{([^\{}]+)\}/g, (_, c) => {
    const o = c.split('|');
    return o[Math.floor(Math.random() * o.length)];
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── API: Login ────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'Admin' && password === 'Admin@2025') {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// ─── API: Templates (persistent) ───────
app.get('/api/templates', (req, res) => {
  const templates = loadJSON(TEMPLATES_FILE, []);
  res.json(templates);
});

app.post('/api/templates', (req, res) => {
  const templates = req.body;
  saveJSON(TEMPLATES_FILE, templates);
  res.json({ success: true, count: templates.length });
});

app.post('/api/templates/save', (req, res) => {
  const { id, name, subject, html } = req.body;
  const templates = loadJSON(TEMPLATES_FILE, []);
  const existing = templates.findIndex(t => t.id === id);
  const tmpl = { id: id || Date.now().toString(), name, subject, html, savedAt: new Date().toISOString() };
  if (existing >= 0) templates[existing] = tmpl;
  else templates.push(tmpl);
  saveJSON(TEMPLATES_FILE, templates);
  res.json({ success: true, template: tmpl, total: templates.length });
});

app.delete('/api/templates/:id', (req, res) => {
  let templates = loadJSON(TEMPLATES_FILE, []);
  templates = templates.filter(t => t.id !== req.params.id);
  saveJSON(TEMPLATES_FILE, templates);
  res.json({ success: true, remaining: templates.length });
});

// ─── API: Tracking ─────────────────────
app.get('/track/open/:id', (req, res) => {
  const tracking = loadJSON(TRACKING_FILE, { opens: {}, clicks: {} });
  if (!tracking.opens[req.params.id]) {
    tracking.opens[req.params.id] = { ts: Date.now(), ip: req.ip };
    saveJSON(TRACKING_FILE, tracking);
    console.log('📬 Open tracked:', req.params.id);
  }
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': pixel.length, 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  res.end(pixel);
});

app.get('/track/click/:id', (req, res) => {
  const tracking = loadJSON(TRACKING_FILE, { opens: {}, clicks: {} });
  if (!tracking.clicks[req.params.id]) {
    tracking.clicks[req.params.id] = { ts: Date.now(), url: req.query.url, ip: req.ip };
    saveJSON(TRACKING_FILE, tracking);
    console.log('🔗 Click tracked:', req.params.id);
  }
  const url = req.query.url ? decodeURIComponent(req.query.url) : 'https://google.com';
  res.redirect(302, url);
});

app.get('/api/tracking', (req, res) => {
  const tracking = loadJSON(TRACKING_FILE, { opens: {}, clicks: {} });
  res.json({
    opens: Object.keys(tracking.opens).length,
    clicks: Object.keys(tracking.clicks).length
  });
});

// ─── Socket.io: Real-time Email Sending ─
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id, '| Transport:', socket.conn.transport.name);

  // Handle transport upgrade
  socket.conn.on('upgrade', (transport) => {
    console.log('⬆️ Transport upgraded to:', transport.name);
  });

  let isActive = false;
  let isPaused = false;

  socket.on('start-sending', async (data) => {
    console.log('📨 Campaign start request received');

    const {
      smtps = [], proxies = [], recipients = [],
      fromName = '', fromEmail = '', replyTo = '',
      subject = '', htmlBody = '',
      minDelay = 1000, maxDelay = 3000,
      emailsPerRotation = 10,
      totalMailsToSend = 0,
      useProxies = false,
      smtpPort = '587'
    } = data;

    if (isActive) {
      socket.emit('send-error', 'Campaign already running');
      return;
    }
    if (!smtps.length) {
      socket.emit('send-error', 'No SMTP servers configured');
      return;
    }
    if (!recipients.length) {
      socket.emit('send-error', 'No recipient emails loaded');
      return;
    }

    isActive = true;
    isPaused = false;

    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const total = totalMailsToSend > 0 ? Math.min(totalMailsToSend, recipients.length) : recipients.length;
    const activeProxies = useProxies && proxies.length > 0 ? proxies : [];
    let sent = 0;
    let failed = 0;
    let smtpIdx = 0;
    let proxyIdx = 0;
    let smtpCount = 0;

    socket.emit('send-log', {
      type: 'info',
      msg: `🚀 Campaign started | ${total} emails | ${smtps.length} SMTP(s) | ${activeProxies.length} proxies | Port ${smtpPort}`
    });

    for (let i = 0; i < total; i++) {
      if (!isActive) break;

      // Handle pause
      while (isPaused && isActive) {
        await sleep(300);
      }
      if (!isActive) break;

      const recipient = recipients[i].trim();
      if (!recipient || !recipient.includes('@')) {
        socket.emit('send-log', { type: 'warn', msg: `⚠️ Skipped invalid: ${recipient}` });
        continue;
      }

      const smtp = smtps[smtpIdx % smtps.length];
      const proxy = activeProxies.length > 0 ? activeProxies[proxyIdx % activeProxies.length] : null;
      const senderEmail = fromEmail || smtp.user;
      const proxyLabel = proxy || 'Direct';

      // Emit current state BEFORE sending
      socket.emit('send-progress', {
        sent, failed, total,
        pct: Math.round(((sent + failed) / total) * 100),
        currentSmtp: smtp.user,
        currentRecipient: recipient,
        currentProxy: proxyLabel,
        currentPort: smtpPort
      });

      try {
        // Try ports in fallback order
        const ports = [...new Set([smtpPort, '587', '465', '2525', '25'])];
        let success = false;
        let usedPort = smtpPort;
        let lastError = null;

        for (const port of ports) {
          try {
            const portNum = parseInt(port);
            const transportConfig = {
              host: smtp.host,
              port: portNum,
              secure: portNum === 465,
              auth: { user: smtp.user, pass: smtp.pass },
              tls: { rejectUnauthorized: false },
              connectionTimeout: 15000,
              greetingTimeout: 10000,
              socketTimeout: 30000
            };

            // Apply proxy if available
            if (proxy) {
              try {
                const parts = proxy.split(':');
                let proxyUrl;
                if (parts.length >= 4) {
                  proxyUrl = `socks5://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
                } else if (parts.length >= 2) {
                  proxyUrl = `socks5://${parts[0]}:${parts[1]}`;
                }
                if (proxyUrl) {
                  const agent = new SocksProxyAgent(proxyUrl);
                  transportConfig.proxy = proxyUrl;
                  transportConfig.tls = { ...transportConfig.tls, socket: agent };
                }
              } catch (proxyErr) {
                socket.emit('send-log', { type: 'warn', msg: `⚠️ Proxy error: ${proxyErr.message}, sending direct` });
              }
            }

            const transport = nodemailer.createTransport(transportConfig);

            // Generate unique tracking ID
            const trackId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

            // Process body with spintax and tracking
            let body = spintax(htmlBody);
            // Add tracking pixel before closing </body> or at end
            const trackPixel = `<img src="${baseUrl}/track/open/${trackId}" width="1" height="1" style="display:none;opacity:0" alt="" />`;
            if (body.includes('</body>')) {
              body = body.replace('</body>', `${trackPixel}</body>`);
            } else {
              body += trackPixel;
            }

            // Wrap links for click tracking
            body = body.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url) => {
              return `href="${baseUrl}/track/click/${trackId}?url=${encodeURIComponent(url)}"`;
            });

            const fromHeader = fromName ? `"${fromName}" <${senderEmail}>` : senderEmail;
            const domain = senderEmail.split('@')[1] || 'example.com';

            await transport.sendMail({
              from: fromHeader,
              to: recipient,
              replyTo: replyTo || senderEmail,
              subject: spintax(subject),
              html: body,
              headers: {
                'X-Priority': '3',
                'X-Mailer': 'NodeMailer-Pro',
                'List-Unsubscribe': `<mailto:unsubscribe@${domain}>`,
                'X-Entity-Ref-ID': trackId
              }
            });

            transport.close();
            usedPort = port;
            success = true;
            break;
          } catch (portErr) {
            lastError = portErr;
          }
        }

        if (!success) {
          throw lastError || new Error('All ports failed');
        }

        sent++;
        smtpCount++;

        socket.emit('send-log', {
          type: 'success',
          msg: `✅ [${sent}/${total}] ${senderEmail} → ${recipient} | Port: ${usedPort} | Proxy: ${proxyLabel}`
        });

      } catch (err) {
        failed++;
        smtpCount++;
        socket.emit('send-log', {
          type: 'error',
          msg: `❌ [${sent + failed}/${total}] Failed → ${recipient}: ${err.message}`
        });
      }

      // Update progress after each email
      socket.emit('send-progress', {
        sent, failed, total,
        pct: Math.round(((sent + failed) / total) * 100),
        currentSmtp: smtp.user,
        currentRecipient: recipient,
        currentProxy: proxyLabel,
        currentPort: smtpPort
      });

      // Rotate SMTP after emailsPerRotation
      if (smtpCount >= emailsPerRotation) {
        smtpIdx++;
        smtpCount = 0;
        if (activeProxies.length > 0) {
          proxyIdx++;
        }
        if (smtps.length > 1) {
          socket.emit('send-log', {
            type: 'info',
            msg: `🔄 Rotated to SMTP ${(smtpIdx % smtps.length) + 1}/${smtps.length}: ${smtps[smtpIdx % smtps.length].user}`
          });
        }
      }

      // Random delay between sends
      const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
      await sleep(delay);
    }

    // Get final tracking stats
    const tracking = loadJSON(TRACKING_FILE, { opens: {}, clicks: {} });
    const opens = Object.keys(tracking.opens).length;
    const clicks = Object.keys(tracking.clicks).length;

    socket.emit('send-complete', { sent, failed, opens, clicks, total });
    socket.emit('send-log', {
      type: 'info',
      msg: `🏁 Campaign complete! Sent: ${sent} | Failed: ${failed} | Opens: ${opens} | Clicks: ${clicks}`
    });

    isActive = false;
    isPaused = false;
    console.log(`📊 Campaign finished: ${sent} sent, ${failed} failed`);
  });

  socket.on('pause-sending', () => {
    isPaused = true;
    socket.emit('send-log', { type: 'warn', msg: '⏸️ Campaign paused' });
  });

  socket.on('resume-sending', () => {
    isPaused = false;
    socket.emit('send-log', { type: 'info', msg: '▶️ Campaign resumed' });
  });

  socket.on('stop-sending', () => {
    isActive = false;
    isPaused = false;
    socket.emit('send-log', { type: 'warn', msg: '⏹️ Campaign stopped by user' });
  });

  socket.on('disconnect', (reason) => {
    isActive = false;
    isPaused = false;
    console.log('❌ Client disconnected:', socket.id, '| Reason:', reason);
  });

  socket.on('error', (err) => {
    console.log('⚠️ Socket error:', socket.id, err.message);
  });
});

// ─── Catch-all: Serve frontend (Express v4 syntax) ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     NodeMailer Pro - Bulk Email System    ║');
  console.log('║                                          ║');
  console.log(`║  🌐 http://localhost:${PORT}                 ║`);
  console.log('║  👤 Login: Admin / Admin@2025             ║');
  console.log('║                                          ║');
  console.log('║  ✅ Express v4 Server                     ║');
  console.log('║  ✅ Socket.io Real-time                   ║');
  console.log('║  ✅ Nodemailer Engine                     ║');
  console.log('║  ✅ SMTP Rotation + Proxy                 ║');
  console.log('║  ✅ Open & Click Tracking                 ║');
  console.log('║  ✅ Persistent Templates                  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});

export default app;