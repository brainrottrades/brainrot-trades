# Brainrot Trades — public website

A standalone public website for the Fortnite **Steal the Brainrot** trading
community (the Fortnite Creative map — **not** the Roblox game "Steal a
Brainrot"; Roblox prices do not apply).

Members get: price list of all 88 Eternal brainrots with pictures, a trade
checker (28 mutations, 16 traits), a rarity chart (Eternals + Absolute +
GOAT), live chat, a trade board, For Sale listings, **private messages**
between members, a **friends** section, verified badges, and owner/co-owner
moderation. Subscription is **$3/month USD via PayPal**. Visitors who are not
logged in see a landing page that explains what the site offers and invites
them to sign up.

## Quick start (local)

```bash
cd brainrot-website
npm install
npm start
# open http://localhost:3000
```

Requirements: **Node.js 22+** (uses the built-in `node:sqlite` — no native
dependencies to compile). Dependencies: `express`, `nodemailer`.

On first run the server creates `data/app.db` (SQLite) automatically.
**Dev mode:** if `config/email.json` is missing, verification codes are
printed to the server console instead of emailed. Do NOT run dev mode in
production — anyone reading the console could verify any account.

## Configuration

| File / env var | What it is |
|---|---|
| `config/paypal.json` | Live PayPal **Client ID** + **Plan ID** (`P-4FY51890T0371135UNMBZT4A`, "Brainrot Trades Monthly", $3.00/month). The Client ID is public by design — it ships in the PayPal checkout button. |
| `config/admins.json` | Owner email (`pgevil22@gmail.com`) and co-owner emails (`amber_fenton@yahoo.com`). These accounts get full access free and the Admin panel. |
| `config/email.json` | SMTP settings — copy from `config/email.json.example` and fill in. See "Email setup" below. |
| `PAYPAL_CLIENT_SECRET` (env) | The PayPal REST app **Secret**. Optional but recommended: with it, the server verifies each subscription against PayPal's API before granting access. Without it, access is granted from the checkout approval in the member's browser and the owner panel says so plainly. **Never commit the Secret or put it in a chat message.** |
| `PORT` (env, default 3000), `HOST` (default 0.0.0.0), `SESSION_SECRET` (env — set a long random value in production) | Server settings. |

### Email setup

The site emails 6-digit verification codes. Pick one:

- **Gmail (easiest if you already have one):** `config/email.json` with
  `host: "smtp.gmail.com"`, `port: 587`, `secure: false`,
  `user: "youraddress@gmail.com"`, `pass: "<Gmail app password>"`.
  An app password is made at Google Account → Security → 2-Step
  Verification → App passwords. Your normal Gmail password will not work.
- **SendGrid / Mailgun / any SMTP service:** same file, with that service's
  host, port, user and password/API key.
- **No email yet:** the server runs in dev mode and prints codes to its own
  console (local testing only).

### PayPal Secret

The REST app "Brainrot Trades" (Client ID in `config/paypal.json`) already
exists in PayPal with a live $3/month plan. The Secret was created in the
PayPal dashboard but never shared with Muse. To finish server-side
verification:

1. In PayPal: Developer → My Apps & Credentials → Live → "Brainrot Trades"
   → show/copy **Secret**.
2. On the server: `export PAYPAL_CLIENT_SECRET='<secret>'` before starting
   (or add it to the systemd unit / host env vars — never to a file in git).
3. Restart the server. The admin panel then shows "PayPal Secret configured:
   yes".

Without the Secret, members who cancel in the app are told to also cancel in
PayPal, because this site cannot cancel a PayPal subscription by itself.

## What is in this repo

- `server.js` — Express server + SQLite. All API routes (auth, subscription,
  prices, checker, rarity, chat, trades, sales, **private messages**,
  **friends**, members, reports, admin). No other server files.
- `data/brainrots.json` — the 88 Eternal brainrots with prices, 29 mutations
  (Default + 28), 16 traits, the trait pricing rule, and rarity data
  (47 Eternals, 6 Absolutes, GOAT Skibidi Toilet). Prices are sellers'
  **asking** prices from Nov 2026 research (`~/workspace/brainrot-prices/`),
  not sold prices; 9 are labelled ballpark estimates.
- `public/` — the whole frontend: `index.html`, `app.js` (single-page app),
  `styles.css` (mobile-first), `img/brainrots/` (86 brainrot pictures),
  `img/skibidi-toilet.png` (app icon / GOAT picture).
- `config/` — PayPal, owner/co-owner, and email example configs.

## Features and the rules behind them

- **Paywall:** the full price list, checker, rarity, chat, trades, sales,
  messages and friends need a verified account + an active $3/month
  subscription. Owner and co-owner accounts get everything free.
- **Private messages:** only verified subscribed members can send. A
  conversation is private between the two people in it. Each conversation
  has **report** (on any message) and **block** buttons. The scam checklist
  must be confirmed before a buyer contacts a seller from a For Sale
  listing. The no-liability fine print covers private deals too.
- **Admins and privacy:** the owner/co-owner can see **reported messages**
  in the admin panel (one message at a time, only when a member reported
  it). They **cannot** read other members' private chats — there is no
  endpoint for it.
- **Friends:** verified subscribed members can send friend requests (from
  chat, the trade board, listings or a member profile), accept/decline,
  see their friends list, message a friend directly, and remove friends.
  Blocked members cannot add each other.
- **Safety:** the owner can delete/hide chat messages, remove trades and
  listings, review/resolve reports, warn/ban/unban members, grant or remove
  30 days of access, edit brainrot prices, add new brainrots and update
  rarity. The owner can never be warned or banned; a co-owner cannot
  warn/ban another co-owner.
- **Pricing engine:** confirmed variant listing first; otherwise the
  typical price × mutation factor, then a trait uplift of 5% / 12% / 20%
  per extra trait (base under $10 / $10–$50 / over $50), capped at 3.5×.
- **Mobile:** mobile-first layout from 320px wide up — no horizontal
  scrolling, 48px tap targets, 16px inputs (stops iOS auto-zoom), bottom
  navigation bar, floating chat button.

## Deploying to a public server

### Free hosting (Render) — the live site

The cheapest way to get a real live URL, with no payment details:

- **`render.yaml` in this repo** defines a free Render web service
  (Node 22, `npm install`, `node server.js`). Render reads it when you
  connect the repo.
- Deploy from a Git repo (GitHub or GitLab): push this folder, then in
  Render → New → Web Service → pick the repo → Render picks up
  `render.yaml` → Create. The service gets a URL like
  `https://brainrot-trades.onrender.com`.
- In Render → Environment, fill in the `sync: false` values:
  `PAYPAL_CLIENT_SECRET` (from the PayPal dashboard, for server-side
  subscription verification), and the `SMTP_*` values (Gmail app password
  or SendGrid/Mailgun) so verification codes are emailed. `SESSION_SECRET`
  is generated for you.
- **Free-tier caveats, stated plainly:**
  - The service **sleeps after 15 minutes with no traffic** and takes
    ~30–60 seconds to wake up on the first visit after a sleep.
  - The **filesystem is ephemeral**: the SQLite database (`data/app.db`)
    resets whenever the service redeploys. Members, chats, trades, sales,
    messages and friends created on the free tier can be lost on a
    redeploy. That is fine for launching and testing, but before the site
    has real paying members it should move to the paid option below
    (a VPS with a disk that persists, or Render's paid plan with a
    persistent disk).
  - Email still needs real SMTP credentials (see "Email setup") — the
    free tier does not include email sending.

### Paid hosting (VPS) — for the real thing

#### Hosting comparison (checked Nov 23, 2026; prices in USD)

The site needs almost nothing: 1 vCPU, 512 MB–1 GB RAM, ~10 GB disk,
Node.js 22. Any small VPS works. Prices below are the providers' own
listings as reported in Nov 2026 comparisons — re-check at checkout.

| Provider | Cheapest plan | What you get | Ongoing price |
|---|---|---|---|
| **DigitalOcean — recommended** | Basic Droplet | 1 vCPU, 512 MB RAM, 10 GB SSD, 500 GB transfer, Toronto datacentre available | **$4/month**, same every month (per-second billing, no renewal jump). $200 free credit for new accounts (check the current offer). |
| **Vultr** | Regular Cloud Compute | 1 vCPU, 1 GB RAM, 25 GB SSD, 1 TB transfer, Toronto available | **$5/month**, same every month (hourly billing). $300 credit for new accounts (check the current offer). |
| **IONOS** | VPS S+ | 1 vCore, 2 GB RAM, 60 GB NVMe | **$2/month for the first 3 months, then $6/month** (1-year term). Cheapest start, dearer after the intro. |

**Recommendation: DigitalOcean $4/month.** Flat price forever, a big-name
cloud, Toronto location (fast for Ontario visitors), and the $200 new-account
credit covers roughly four years at $4/month if the offer still applies.
Vultr is the fallback if you want more RAM for $1 more.

### Domain

A `.com` costs about **$11–12/year**, same every year at the flat-price
registrars (checked Nov 2026):

| Registrar | .com price |
|---|---|
| **Porkbun — recommended** | **$11.81/year**, flat (registration = renewal = transfer, ICANN fee included). Simple to use. |
| Cloudflare Registrar | ~$11.17/year, at cost (registry + ICANN only). Cheapest, but the domain must use Cloudflare's nameservers. |
| Namecheap | ~$12 first year, **renews ~$19.98/year** — dearer after year one. |

So the running cost is roughly **$4/month hosting + ~$12/year domain ≈
$60/year total** (less while any free credit lasts).

### What Patrick has to do (Muse cannot do these)

1. **Create the hosting account** (in his name, with his payment method):
   DigitalOcean at digitalocean.com — sign up, verify, add a card.
   Pick the $4 Basic Droplet, Ubuntu 24.04, Toronto region.
2. **Buy the domain** (his name, his payment method): Porkbun at
   porkbun.com — search for a name (e.g. `brainrottrades.com`), buy it,
   then point its DNS `A` record at the Droplet's IP address.
3. **PayPal Secret:** copy it from the PayPal dashboard (see "PayPal
   Secret" above) and set it as an environment variable on the server.
4. **Email credentials:** a Gmail app password (or SendGrid/Mailgun) in
   `config/email.json` so verification codes actually reach members.

### Deploy steps (on the server, Ubuntu 24.04)

```bash
# 1. Install Node.js 22 and git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx

# 2. Copy this folder to the server (from your computer)
scp -r brainrot-website your-server:/home/brainrot/

# 3. Install and start the app (runs on port 3000)
cd /home/brainrot/brainrot-website
npm install
cp config/email.json.example config/email.json   # then fill in real SMTP details
export PAYPAL_CLIENT_SECRET='<secret from PayPal>'   # optional but recommended
export SESSION_SECRET='<a long random string>'
npm start

# 4. Keep it running after you log out (systemd)
sudo tee /etc/systemd/system/brainrot.service > /dev/null <<'EOF'
[Unit]
Description=Brainrot Trades website
After=network.target
[Service]
WorkingDirectory=/home/brainrot/brainrot-website
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
Environment=PAYPAL_CLIENT_SECRET=<secret from PayPal>
Environment=SESSION_SECRET=<a long random string>
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now brainrot

# 5. Put it behind HTTPS with your domain (free certificate)
sudo tee /etc/nginx/sites-available/brainrot > /dev/null <<'EOF'
server {
    listen 80;
    server_name brainrottrades.com www.brainrottrades.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/brainrot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d brainrottrades.com -d www.brainrottrades.com
```

Replace `brainrottrades.com` with the domain actually bought. After
`certbot` runs, the site is live at `https://brainrottrades.com`.

### Updating prices later

- **In the app:** the owner/co-owner Admin panel edits any brainrot price,
  adds new brainrots and updates rarity — no deploy needed.
- **In the code:** edit `data/brainrots.json` (same fields) and restart
  the server. The daily price-research job that updates the live app can
  be pointed at this file as well.

## What still needs Patrick

- **To go live free:** a Render account (free, no payment details) +
  this folder pushed to a GitHub/GitLab repo so Render can deploy it
  (see "Free hosting (Render)" above). If Render asks for an email
  verification code, that code goes to Patrick's email.
- **To go live properly (later):** a hosting account + payment method
  (DigitalOcean $4/month recommended), a domain (~$12/year, Porkbun
  recommended) + its DNS pointed at the server.
- The PayPal REST app Secret (from the PayPal dashboard) for server-side
  subscription verification.
- Email credentials (Gmail app password, or SendGrid/Mailgun) so
  verification codes reach members.
- Nothing else: the code, data, pictures, PayPal plan and owner/co-owner
  setup are all in this repo and ready to deploy.
