# NodeMailer Pro — Bulk Email System

## Quick Start (VPS)

```bash
npm install
npm run build
node app.js
```

Visit: **http://your-server-ip:3000**
Login: **Admin** / **Admin@2025**

## cPanel Deployment

1. Upload all files to your domain directory
2. cPanel → Setup Node.js App
3. Set startup file: `app.js`
4. Click "Run NPM Install"
5. SSH in and run: `npm run build`
6. Start the app

## Features

- Admin login (Admin / Admin@2025)
- SMTP circular rotation
- Proxy support (SOCKS5)
- Port selection (25/465/587/2525) with auto-fallback
- From email masking
- Persistent email templates (server-side JSON storage)
- Open & click tracking
- Spintax support
- Real-time progress via Socket.io
- Session control (total mails limit)
# nodemailer-v1
