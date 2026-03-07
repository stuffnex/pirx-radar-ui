# Cloudflare Tunnel — Pi → Public HTTPS

This guide connects your Raspberry Pi backend to a public domain via Cloudflare Tunnel (formerly Argo Tunnel). No port-forwarding, no static IP, no reverse proxy configuration needed.

---

## Prerequisites

- A domain managed by Cloudflare (free plan is fine)
- Raspberry Pi with the PIRX backend running on port 8080
- Pi connected to the internet (any NAT/LAN setup works)

---

## 1. Install cloudflared on the Pi

```bash
# Download the ARM64 binary (Pi 4 / Pi 5)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Verify
cloudflared --version
```

> **Pi 3B (32-bit OS):** use `cloudflared-linux-arm` instead of `arm64`.

---

## 2. Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser URL. Log in to your Cloudflare account and authorise the domain you want to use. A certificate is saved to `~/.cloudflared/cert.pem`.

---

## 3. Create the tunnel

```bash
cloudflared tunnel create pirx
```

Note the **Tunnel ID** printed (a UUID like `a1b2c3d4-...`). A credentials file is saved to `~/.cloudflared/<tunnel-id>.json`.

---

## 4. Configure the tunnel

Create the config file:

```bash
nano ~/.cloudflared/config.yml
```

Paste and adjust:

```yaml
tunnel: pirx                          # tunnel name from step 3
credentials-file: /home/pi/.cloudflared/<your-tunnel-id>.json

ingress:
  # WebSocket + REST traffic → PIRX backend
  - hostname: pirx.yourdomain.com     # ← your domain
    service: http://localhost:8080

  # Catch-all (required by cloudflared)
  - service: http_status:404
```

Save with `Ctrl+X → Y → Enter`.

---

## 5. Add the DNS record

```bash
cloudflared tunnel route dns pirx pirx.yourdomain.com
```

This creates a `CNAME` record in Cloudflare DNS pointing `pirx.yourdomain.com` → your tunnel. Cloudflare handles the TLS certificate automatically.

---

## 6. Test manually

```bash
cloudflared tunnel run pirx
```

Open `https://pirx.yourdomain.com` in a browser. You should see the PIRX frontend (if static files are also served by the backend) or the backend health endpoint at `https://pirx.yourdomain.com/health`.

---

## 7. Run as a systemd service (auto-start on boot)

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Check status:

```bash
sudo systemctl status cloudflared
journalctl -u cloudflared -f
```

---

## 8. Update app.js

Add your domain to `PRODUCTION_HOSTS` in `app.js`:

```js
const PRODUCTION_HOSTS = [
  'pirx.yourdomain.com',   // ← replace with your domain
];
```

The frontend will automatically use `wss://pirx.yourdomain.com/ws/traffic` (no port) when served from that hostname, and fall back to `ws://localhost:8080/ws/traffic` on LAN.

---

## Domain configuration notes

### WebSocket through Cloudflare

Cloudflare proxies WebSocket connections by default on paid plans. On the **free plan**, WebSocket is supported but connections time out after **100 seconds of inactivity**. The PIRX backend should send a heartbeat or the frontend will reconnect automatically (it does — `onclose` reconnects after 5 s).

To check: Cloudflare Dashboard → your domain → Network → WebSockets → ensure it is **On**.

### HTTP → HTTPS redirect

Cloudflare Dashboard → your domain → SSL/TLS → Edge Certificates → Always Use HTTPS → **On**.

This ensures `http://pirx.yourdomain.com` redirects to `https://` automatically.

### SSL mode

Cloudflare Dashboard → SSL/TLS → Overview → set to **Flexible** (traffic from Pi to Cloudflare edge is HTTP on port 8080; Cloudflare provides HTTPS to the browser). If your backend has its own TLS cert, set to **Full**.

---

## Multiple environments

| Context | How the frontend connects |
|---|---|
| `https://pirx.yourdomain.com` | `wss://pirx.yourdomain.com/ws/traffic` |
| `http://192.168.1.42:8080` | `ws://192.168.1.42:8080/ws/traffic` |
| `http://localhost:8080` | `ws://localhost:8080/ws/traffic` |

No code changes needed when switching between environments.

---

## Troubleshooting

**Tunnel not connecting:**
```bash
cloudflared tunnel info pirx
journalctl -u cloudflared -n 50
```

**WebSocket returns 1006 immediately:**
Check Cloudflare SSL mode — if set to Full/Strict but backend has no cert, the edge → origin leg fails.

**Backend not reachable after Pi reboot:**
Ensure both the PIRX backend service and `cloudflared` service are enabled:
```bash
sudo systemctl enable cloudflared
sudo systemctl enable pirx-backend   # your backend service name
```
