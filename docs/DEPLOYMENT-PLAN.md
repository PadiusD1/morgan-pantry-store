# Morgan Pantry Store — Full Deployment Plan

## Hardware Shopping List

Buy these 4 items online. Total: ~$340-400.

### 1. Beelink EQ14 Mini PC (~$130-189)
**This runs your app 24/7.**

- Amazon: https://www.amazon.com/dp/B0D5XNYVHN
- Also check: https://www.amazon.com/dp/B0G62YYHBJ
- Specs: Intel N150, 16GB RAM, 500GB SSD, Dual 2.5G LAN, WiFi 6
- Look for the "$40 off coupon" on the Amazon page — brings it to ~$130-150

### 2. QNAP TS-133 with 4TB Drive (~$170-200)
**This stores your backups on a real hard drive.**

Pick ONE (both come with a 4TB NAS drive pre-installed):
- WD Red Plus version: https://www.amazon.com/dp/B0CZ9QBYMZ
- Seagate IronWolf version: https://www.amazon.com/dp/B09YSM9J6H
- Either drive brand is fine. Both are designed for 24/7 NAS use.

### 3. APC Back-UPS 600VA (~$50-60)
**Keeps everything running during power outages.**

- Amazon: https://www.amazon.com/dp/B01FWAZEIU
- 600VA gives ~20 minutes of battery for both devices
- Enough time for a clean shutdown if power stays out
- Also protects against electrical surges

### 4. Ethernet Cable CAT6 (~$8-10)
- Get a 25ft or 50ft depending on how far the nearest network jack is
- Amazon: search "Cat6 ethernet cable" — any brand works
- You need ONE cable: from the Beelink to the campus network wall jack

---

## What I Already Built (Software — Done)

All of this is already in your Morgan-Pantry-Store project, ready to deploy:

| What | File | Status |
|------|------|--------|
| Health check endpoint | `server/index.ts` → `/api/health` | Done |
| CORS for LAN access | `server/index.ts` | Done |
| Graceful shutdown (protects database) | `server/index.ts` | Done |
| PM2 process manager config | `ecosystem.config.cjs` | Done |
| systemd service file (alternative) | `deploy/morgan-pantry.service` | Done |
| Daily backup script (local + NAS) | `scripts/backup-db.sh` | Done |
| HTTPS reverse proxy config | `deploy/Caddyfile` | Done |
| Environment config template | `.env.example` | Done |
| Step-by-step setup guide | `docs/SERVER-SETUP.md` | Done |
| .gitignore for prod paths | `.gitignore` | Done |

---

## Step-by-Step Deployment

### Phase 1: Unbox and Set Up Hardware (30 minutes)

#### Step 1: Connect the UPS
1. Unbox the APC Back-UPS
2. Plug it into a wall outlet near the campus network jack
3. Let it charge for 4+ hours before relying on it (can set up while charging)

#### Step 2: Set Up the QNAP NAS
1. Unbox the QNAP TS-133 (the 4TB drive is already installed)
2. Plug its power into the UPS (use a "battery backup" outlet, not "surge only")
3. Plug an ethernet cable from the NAS to the campus network jack (or a small switch)
4. Power it on — the LED will blink, then go solid
5. From your laptop, go to http://install.qnap.com or find the NAS on the network
6. Walk through the QNAP setup wizard:
   - Set an admin password (write it down somewhere safe)
   - Create a shared folder called `pantry-backups`
   - Enable SMB/CIFS file sharing (it's on by default)
   - Note the NAS IP address (e.g., `192.168.1.50`)

#### Step 3: Set Up the Beelink Mini PC
1. Unbox the Beelink EQ14
2. Plug its power into the UPS (use a "battery backup" outlet)
3. Plug the ethernet cable from the Beelink to the campus network jack
4. Connect a monitor + keyboard temporarily (just for initial setup)
5. Power it on — it comes with Windows 11 pre-installed

### Phase 2: Install Ubuntu Server (20 minutes)

#### Step 4: Create a USB Installer
On your current laptop:
1. Download Ubuntu Server 24.04 LTS: https://ubuntu.com/download/server
2. Download Rufus (Windows): https://rufus.ie
3. Plug in a USB flash drive (8GB+)
4. Open Rufus → select the Ubuntu ISO → click Start
5. This creates a bootable installer USB

#### Step 5: Install Ubuntu on the Beelink
1. Plug the USB into the Beelink
2. Restart → press DEL or F7 to enter BIOS
3. Set USB as first boot device → Save & Exit
4. Ubuntu installer starts:
   - Choose "Ubuntu Server (minimized)"
   - Use entire disk (the 500GB SSD)
   - Set hostname: `pantry-server`
   - Create user: `pantry` with a strong password
   - Enable OpenSSH server (check the box)
   - Don't install any extra snaps
5. Remove USB when done, reboot

#### Step 6: Set a Static IP
After Ubuntu boots, log in and run:
```bash
# Find your current IP and network interface name
ip addr show

# Edit the netplan config
sudo nano /etc/netplan/50-cloud-init.yaml
```

Replace contents with (adjust to your network — ask Morgan State IT for these values):
```yaml
network:
  version: 2
  ethernets:
    enp1s0:  # your interface name from ip addr
      dhcp4: no
      addresses:
        - 192.168.1.100/24  # your assigned static IP
      routes:
        - to: default
          via: 192.168.1.1    # your gateway
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

Apply:
```bash
sudo netplan apply
```

**From this point, you can unplug the monitor/keyboard and SSH in from your laptop:**
```bash
ssh pantry@192.168.1.100
```

### Phase 3: Deploy the App (15 minutes)

#### Step 7: Install Node.js and Dependencies
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs sqlite3 build-essential python3
```

#### Step 8: Copy Project Files
From your Windows laptop, copy the project to the server:
```bash
# From your laptop (PowerShell or Git Bash):
scp -r "C:\Users\pvale\Downloads\Morgan-Pantry-Store" pantry@192.168.1.100:/opt/morgan-pantry
```

Or use a USB drive:
```bash
# On the server, after plugging in USB:
sudo mount /dev/sda1 /mnt
cp -r /mnt/Morgan-Pantry-Store/* /opt/morgan-pantry/
sudo umount /mnt
```

Use a clean repository clone/copy when possible. Do not copy `node_modules`, `dist`, or any nested backup copy of the project; Linux should rebuild dependencies with `npm ci`.

#### Step 9: Build and Start
```bash
cd /opt/morgan-pantry
npm ci
npm run check
npm run build
npm prune --omit=dev
mkdir -p logs data backups

# Test it works
node dist/index.cjs &
curl http://localhost:5000/api/health
# Should return: {"status":"ok","uptime":...}
# Kill the test: kill %1
```

#### Step 10: Set Up PM2 (Auto-restart + Boot Persistence)
```bash
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save

# This prints a command — copy and run it:
pm2 startup
# Example output: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pantry --hp /opt/morgan-pantry
# Run whatever it prints ^
```

#### Step 11: Open Firewall
```bash
sudo ufw allow 22/tcp    # SSH access
sudo ufw allow 5000/tcp  # Pantry app
sudo ufw enable
```

### Phase 4: Connect NAS Backups (10 minutes)

#### Step 12: Mount the QNAP Share
```bash
sudo apt-get install -y cifs-utils

# Create mount point
sudo mkdir -p /mnt/nas/pantry-backups

# Add to fstab for auto-mount on boot
# Replace 192.168.1.50 with your NAS IP, and NASPASSWORD with your QNAP admin password
echo "//192.168.1.50/pantry-backups /mnt/nas/pantry-backups cifs username=admin,password=NASPASSWORD,uid=pantry,gid=pantry,iocharset=utf8 0 0" | sudo tee -a /etc/fstab

# Mount it now
sudo mount -a

# Verify
ls /mnt/nas/pantry-backups
# Should show empty directory (no errors)
```

#### Step 13: Set Up Daily Backups
```bash
chmod +x /opt/morgan-pantry/scripts/backup-db.sh

# Test the backup script
/opt/morgan-pantry/scripts/backup-db.sh
# Should print:
# [backup] Local: /opt/morgan-pantry/backups/app_XXXXXXXX_XXXXXX.db.gz
# [backup] NAS copy: /mnt/nas/pantry-backups/app_XXXXXXXX_XXXXXX.db.gz

# Schedule daily at 3 AM
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/morgan-pantry/scripts/backup-db.sh >> /opt/morgan-pantry/logs/backup.log 2>&1") | crontab -
```

### Phase 5: Verify Everything (10 minutes)

#### Step 14: Test from Another Device
1. On your phone or another laptop, connect to campus WiFi
2. Open browser: `http://192.168.1.100:5000`
3. You should see the Morgan Pantry Store dashboard
4. Try adding a client, scanning a barcode, doing a check-out

#### Step 15: Test Crash Recovery
```bash
# Simulate a crash
pm2 stop morgan-pantry
curl http://localhost:5000/api/health  # Should fail

# Wait 5 seconds — PM2 auto-restarts
sleep 5
curl http://localhost:5000/api/health  # Should work again
```

#### Step 16: Test Reboot Recovery
```bash
sudo reboot

# After 1-2 minutes, SSH back in
ssh pantry@192.168.1.100
curl http://localhost:5000/api/health  # Should work — PM2 started it on boot
```

---

## Architecture Diagram

```
  Campus WiFi                    Campus Ethernet
       |                              |
  [Phones/Laptops]              [Network Jack]
       |                              |
       +------------- LAN -----------+
                       |
                  [UPS Battery]
                   /        \
           [Beelink EQ14]  [QNAP TS-133]
           500GB SSD         4TB HDD
           Ubuntu Server     NAS Storage
           Node.js App       Nightly Backups
           SQLite DB         90-day retention
           Port 5000
```

**How data flows:**
1. Volunteers open `http://SERVER_IP:5000` on their phones/laptops
2. App runs on the Beelink, database stored on its SSD
3. Every night at 3 AM, backup script copies the DB to the QNAP NAS
4. If the SSD ever fails, restore from the NAS backup onto a new drive
5. UPS keeps both devices running during short outages

---

## Ongoing Maintenance (What to Do Monthly)

| When | What | How |
|------|------|-----|
| Monthly | Check the server is running | `curl http://192.168.1.100:5000/api/health` |
| Monthly | Check disk space | `ssh pantry@SERVER_IP "df -h"` |
| Monthly | Check backups exist on NAS | Log into QNAP web UI → check `pantry-backups` folder |
| Every 3 years | Replace UPS battery | Buy APC replacement battery APCRBC154 (~$25) |
| If app needs updating | Pull new code | `ssh pantry@SERVER_IP "cd /opt/morgan-pantry && git pull && npm ci && npm run check && npm run build && npm prune --omit=dev && pm2 restart morgan-pantry"` |

---

## Emergency: How to Restore from Backup

If the Beelink dies or the database gets corrupted:

1. Get a new Beelink (or any mini PC)
2. Follow Phase 2 and 3 again (install Ubuntu, deploy app)
3. Mount the QNAP NAS (Phase 4, Step 12)
4. Copy the latest backup:
```bash
# Find the newest backup on the NAS
ls -lt /mnt/nas/pantry-backups/ | head -5

# Restore it
gunzip -c /mnt/nas/pantry-backups/app_LATEST.db.gz > /opt/morgan-pantry/data/app.db
pm2 restart morgan-pantry
```
5. All your data is back. Total downtime: ~1 hour with a spare mini PC.

---

## Cost Summary

| Item | Est. Price | Where |
|------|-----------|-------|
| Beelink EQ14 N150 16GB/500GB | $130-189 | Amazon |
| QNAP TS-133 with 4TB WD Red | $170-200 | Amazon |
| APC Back-UPS 600VA (BE600M1) | $50-60 | Amazon |
| Cat6 Ethernet Cable 25ft | $8-10 | Amazon |
| **Total** | **$358-459** | |
| Ongoing electricity (both devices) | ~$3/month | ~25W total |
