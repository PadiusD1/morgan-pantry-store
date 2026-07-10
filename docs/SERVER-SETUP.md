# Morgan Pantry Store — Server Setup Guide

Deploy the Morgan Pantry Store on a dedicated server so multiple devices can access it on the campus network during shop days.

## Requirements

- Any x86_64 machine with 2GB+ RAM and 20GB disk (a used desktop is fine)
- Ubuntu Server 24.04 LTS (or Debian 12)
- Static IP on the campus network (ask Morgan State IT)
- Internet access during setup (for installing packages)

## 1. Install Node.js and SQLite

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs sqlite3 build-essential python3
```

Verify:
```bash
node --version   # should be v20.x
sqlite3 --version
```

## 2. Create a Service User

```bash
sudo useradd -r -m -d /opt/morgan-pantry -s /bin/bash pantry
```

## 3. Deploy the App

Copy the project files to the server (via USB, `scp`, or `git clone`):

```bash
sudo su - pantry
cd /opt/morgan-pantry

# If using git:
# git clone <your-repo-url> .

# Install dependencies, run checks, and build the production bundle
npm ci
npm run check

npm run build

# Keep only runtime dependencies after the build
npm prune --omit=dev

# Create required directories
mkdir -p logs data backups
```

Use a clean repository clone when possible. Do not copy `node_modules`, `dist`, or any nested backup copy of the project; `npm ci` and `npm run build` recreate what the server needs.

## 4. Configure Environment (Optional)

```bash
cp .env.example .env
nano .env
```

Default settings work out of the box. Edit if you need to change the port, use a custom database path, or add barcode API keys.

## 5. Start the App

### Option A: PM2 (Recommended)

PM2 auto-restarts on crash and survives reboots.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the app
pm2 start ecosystem.config.cjs

# Save the process list
pm2 save

# Enable auto-start on boot (run the command PM2 prints)
pm2 startup
```

### Option B: systemd

```bash
# Copy service file
sudo cp /opt/morgan-pantry/deploy/morgan-pantry.service /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now morgan-pantry
```

## 6. Verify

```bash
curl http://localhost:5000/api/health
# Should return: {"status":"ok","uptime":...}
```

Open a browser on the server: `http://localhost:5000`

## 7. Open Firewall

```bash
sudo ufw allow 5000/tcp
sudo ufw enable
```

## 8. Access from Other Devices

1. Find the server's IP: `ip addr show`
2. On any phone/laptop on the campus WiFi, open: `http://SERVER_IP:5000`
3. Optional: Ask campus IT to create a DNS alias like `pantry.morgan.local`

## 9. Set Up Daily Backups

```bash
chmod +x /opt/morgan-pantry/scripts/backup-db.sh

# Add to cron (runs daily at 3 AM)
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/morgan-pantry/scripts/backup-db.sh") | crontab -
```

Backups are saved to `/opt/morgan-pantry/backups/` and kept for 30 days.

## 10. Optional: HTTPS via Caddy

```bash
sudo apt install -y caddy
sudo cp /opt/morgan-pantry/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo ufw allow 443/tcp
```

Browsers will show a one-time certificate warning (self-signed). Accept it and it won't appear again.

## Maintenance Cheat Sheet

| Task | Command |
|------|---------|
| View logs (PM2) | `pm2 logs morgan-pantry` |
| View logs (systemd) | `journalctl -u morgan-pantry -f` |
| Restart | `pm2 restart morgan-pantry` or `sudo systemctl restart morgan-pantry` |
| Stop | `pm2 stop morgan-pantry` or `sudo systemctl stop morgan-pantry` |
| Update code | `cd /opt/morgan-pantry && git pull && npm ci && npm run check && npm run build && npm prune --omit=dev && pm2 restart morgan-pantry` |
| Run backup now | `/opt/morgan-pantry/scripts/backup-db.sh` |
| Restore backup | `gunzip backups/app_YYYYMMDD.db.gz && cp backups/app_YYYYMMDD.db data/app.db && pm2 restart morgan-pantry` |
| Check disk space | `df -h /opt/morgan-pantry` |
| Check DB size | `ls -lh /opt/morgan-pantry/data/app.db` |
| Check health | `curl http://localhost:5000/api/health` |

## Troubleshooting

**App won't start / "better-sqlite3" error:**
```bash
# Rebuild native modules
npm rebuild better-sqlite3
```

**"Port already in use":**
```bash
# Find what's using port 5000
sudo lsof -i :5000
# Kill it if needed
sudo kill <PID>
```

**Can't access from other devices:**
- Verify firewall: `sudo ufw status`
- Verify server IP: `ip addr show`
- Make sure devices are on the same network
- Try pinging the server from another device

**Database seems corrupted:**
```bash
# Stop the app first
pm2 stop morgan-pantry
# Restore from latest backup
ls -lt backups/
gunzip backups/app_LATEST.db.gz
cp backups/app_LATEST.db data/app.db
pm2 start morgan-pantry
```
