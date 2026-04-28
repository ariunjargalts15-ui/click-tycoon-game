# 👑 TAP TYCOON — One Click Idle Empire

A full-featured mobile-first idle clicker game with world themes, prestige system,
star shop, achievements, Firebase authentication, cloud saves, and PayPal payments.

---

## 📁 Project Structure

```
tap-tycoon/
├── public/
│   ├── index.html        ← The entire game (single-file frontend)
│   └── manifest.json     ← PWA manifest (add icons before deploying)
├── server/
│   ├── index.js          ← Express backend (PayPal + Firebase Admin)
│   └── package.json
├── firestore.rules       ← Paste into Firebase Console → Firestore → Rules
├── .env.example          ← Copy to .env and fill in values
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Deployment Steps (do these IN ORDER)

### Step 1 — Firebase Project

1. Go to **https://console.firebase.google.com**
2. Click **Add project** → name it `tap-tycoon` → Continue
3. **Enable Google Analytics** (optional but recommended)

**Enable Authentication:**
4. Left sidebar → Build → **Authentication** → Get started
5. Sign-in method tab:
   - Enable **Email/Password**
   - Enable **Google** (add your support email: `ariunjargal.ts15@gmail.com`)
6. Authorized domains tab → Add your frontend domain (e.g. `tap-tycoon.vercel.app`)

**Enable Firestore:**
7. Left sidebar → Build → **Firestore Database** → Create database
8. Start in **production mode** → choose a region close to your users → Enable
9. Rules tab → paste the entire contents of `firestore.rules` → Publish

**Get Web App config:**
10. Project Overview → click `</>` (Web app) → Register app → name it `Tap Tycoon Web`
11. Copy the `firebaseConfig` object
12. Open `public/index.html`, find `window.FIREBASE_CONFIG = {` and replace the placeholder values

**Get Service Account (for backend):**
13. Project settings (gear icon) → Service accounts tab
14. Click **Generate new private key** → download the JSON file
15. You'll paste this JSON into the `FIREBASE_SERVICE_ACCOUNT` env var later

---

### Step 2 — PayPal Business Account

1. Log into **https://www.paypal.com** with `ariunjargal.ts15@gmail.com`
2. If not already Business: **Settings** → Upgrade to Business account (free)
3. Go to **https://developer.paypal.com** and log in
4. **Apps & Credentials** → switch to **Live** tab → **Create App**
   - App name: `Tap Tycoon`
   - App type: Merchant
5. Copy the **Client ID** and **Client Secret**
6. In `public/index.html` find `window.PAYPAL_CLIENT_ID = 'YOUR_PAYPAL_LIVE_CLIENT_ID'` and replace it
7. In `.env`, set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`

**Configure Webhook (do this AFTER deploying the backend):**
8. PayPal developer dashboard → Webhooks → Add Webhook
9. URL: `https://your-api-domain.com/api/paypal-webhook`
10. Select event: **Payment capture completed**
11. Copy the **Webhook ID** → set `PAYPAL_WEBHOOK_ID` in `.env`

---

### Step 3 — Deploy the Backend

The backend is a small Node.js Express server. Cheapest options:

#### Option A — Render (recommended, free tier)
1. Push code to GitHub
2. Go to **https://render.com** → New → Web Service
3. Connect your repo → select the `server/` folder as root
4. Build command: `npm install`
5. Start command: `node index.js`
6. Add environment variables (all from `.env.example`)
7. Deploy → copy the URL (e.g. `https://tap-tycoon-api.onrender.com`)

#### Option B — Railway
1. **https://railway.app** → New Project → Deploy from GitHub
2. Set root directory to `server/`
3. Add env vars → Deploy

#### Option C — Fly.io
```bash
cd server
fly launch
fly secrets set PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... ...
fly deploy
```

After deploying:
- Copy your backend URL into `public/index.html` → `window.BACKEND_URL = 'https://...'`
- Go back and set the PayPal webhook URL (Step 2, point 9)

---

### Step 4 — Deploy the Frontend

The frontend is a single HTML file. Easiest options:

#### Option A — Vercel (recommended)
```bash
npm i -g vercel
cd tap-tycoon
vercel --prod
```
Then in Vercel dashboard → Settings → Add your custom domain if you have one.

#### Option B — Netlify
1. Drag and drop the `public/` folder at **https://app.netlify.com/drop**
2. Or: `npm i -g netlify-cli && netlify deploy --prod --dir=public`

#### Option C — GitHub Pages
1. Push `public/index.html` to the `gh-pages` branch
2. Settings → Pages → deploy from `gh-pages` branch

**After deploying the frontend:**
- Add the frontend URL to Firebase → Authentication → Authorized domains

---

### Step 5 — Final Checklist Before Going Live

- [ ] `window.FIREBASE_CONFIG` filled in with real values (not placeholders)
- [ ] `window.PAYPAL_CLIENT_ID` set to your LIVE PayPal Client ID
- [ ] `window.BACKEND_URL` set to your deployed backend URL
- [ ] Backend deployed and accessible at `/health` endpoint
- [ ] PayPal webhook configured and pointing to your backend
- [ ] Firestore security rules published
- [ ] Firebase Auth — Email/Password and Google providers enabled
- [ ] Your frontend domain added to Firebase Auth authorized domains
- [ ] Add app icons: `public/icon-192.png` and `public/icon-512.png`
- [ ] **Privacy Policy** published (required for Firebase Auth + PayPal)
- [ ] **Terms of Service** published (required for payments)
- [ ] Test a real $1.99 purchase end-to-end before promoting

---

## 🔒 Security Model

| Layer | Responsibility |
|---|---|
| Firestore rules | Clients can NEVER write pack/badge fields |
| Backend verify-purchase | Validates PayPal order directly with PayPal's API before granting rewards |
| Backend webhook | Safety net — grants rewards even if client closes mid-checkout |
| Firebase Auth tokens | Backend verifies every request is from an authenticated user |
| Idempotency | Each PayPal order ID is stored; duplicate processing is blocked by transaction |

**Never trust the client for pack state.** `starterPackPurchased`, `legendPackPurchased`,
`tapIncomeMultiplier`, `badge`, etc. live in Firestore's main user doc which only the
backend Admin SDK can write. Clients get a read-only view of it.

---

## 🎮 Game Features

- **12 World Themes** — 3 free, 4 in Starter Pack, 5 in Legend Pack
- **Animated backdrops** — Dubai sunset, Tokyo neon, NYC gold, Paris royal, + 5 legend fantasy worlds
- **Per-theme buttons** — each equipped theme transforms the tap button completely
- **7 Coin Tiers** — Bronze → Silver → Gold → Ruby → Emerald → Diamond → Cosmic
- **Star Shop** — 10 permanent upgrades bought with prestige stars, survive every reset
- **24 Achievements** — across 6 categories, each gives +1% earnings permanently
- **Prestige system** — earn stars, spend in Star Shop, multiply earnings forever
- **Lucky Wheel** — free spin every 5 min (reducible via Star Shop), bonus spins from packs
- **Golden buttons** — random bonus events on screen
- **Offline earnings** — earn while away, cap varies by pack (2h → 6h → 24h)
- **Daily rewards** — 7-day streak with escalating prizes
- **Leaderboard** — ranked by total coins earned
- **Firebase Auth** — Email/Password + Google Sign-In
- **Cloud save** — progress syncs across devices for signed-in players
- **PayPal payments** — backend-verified, webhook-backed, idempotent

---

## 💡 After Publishing

Once live, the first things to add:

1. **Daily Quests** — rotating tasks for bonus stars
2. **Push Notifications** — "your idle earnings are waiting!" via Firebase Cloud Messaging
3. **Analytics** — add Firebase Analytics to track retention, prestige rate, pack conversion
4. **Real icons** — replace the placeholder manifest icons with proper 192/512px PNGs
5. **More Legend-pack theme images** — Dragon/Cyberpunk/Galaxy etc can get backdrop SVG scenes like the 4 city themes
