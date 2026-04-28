/**
 * TAP TYCOON — Production Backend
 * Node.js / Express
 *
 * Handles:
 *   POST /api/verify-purchase   — client calls after PayPal onApprove
 *   POST /api/paypal-webhook    — PayPal server-to-server notification
 *   GET  /api/restore-purchases — called on login to sync pack state
 *   GET  /health                — uptime check
 *
 * Deploy to: Render / Railway / Fly.io / any Node host
 * Required env vars: see .env.example
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const axios      = require('axios');
const admin      = require('firebase-admin');

// ── Environment ────────────────────────────────────────────────
const {
  PORT                    = 3000,
  CLIENT_ORIGIN           = '*',          // e.g. https://tap-tycoon.vercel.app
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID,
  PAYPAL_API_BASE         = 'https://api-m.sandbox.paypal.com', // change to api-m.paypal.com for live
  FIREBASE_SERVICE_ACCOUNT,              // full JSON string of service account key
} = process.env;

// ── Firebase Admin ──────────────────────────────────────────────
if (!FIREBASE_SERVICE_ACCOUNT) {
  console.error('FATAL: FIREBASE_SERVICE_ACCOUNT env var missing');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)),
});
const db = admin.firestore();

// ── Pack Catalogue ──────────────────────────────────────────────
// Keep in sync with PACKS in public/index.html
const PACK_PRICES = { starter: '1.99', legend: '2.99' };

const PACK_REWARDS = {
  starter: {
    coinsBonus:       50000,
    themesToAdd:      ['dubai','tokyo','newyork','paris'],
    skinsToAdd:       ['🎁'],
    starterBoostHours: 24,
    offlineHours:     6,
    bonusWheelSpins:  3,
    adRemoveHours:    24,
    badge:            'starter',
  },
  legend: {
    coinsBonus:            500000,
    themesToAdd:           ['dragon','cyberpunk','galaxy','atlantis','inferno'],
    skinsToAdd:            ['💠','🏆','🌌'],
    permanentTapMult:      2,
    permanentAutoMult:     2,
    offlineHours:          24,
    bonusWheelSpins:       10,
    permanentAdsRemoved:   true,
    goldenButtonChanceMult:2,
    badge:                 'legend',
  },
};

// ── PayPal helpers ──────────────────────────────────────────────
let _ppToken     = null;
let _ppTokenExp  = 0;

async function getPayPalToken() {
  if (_ppToken && Date.now() < _ppTokenExp) return _ppToken;
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const { data } = await axios.post(
    `${PAYPAL_API_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  _ppToken    = data.access_token;
  _ppTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return _ppToken;
}

async function verifyOrder(orderID, expectedAmount, expectedPackId) {
  const token  = await getPayPalToken();
  const { data } = await axios.get(
    `${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (data.status !== 'COMPLETED')
    throw new Error(`Order not completed (status: ${data.status})`);

  const unit = data.purchase_units?.[0];
  if (!unit) throw new Error('No purchase unit');

  const capture = unit.payments?.captures?.[0];
  if (!capture || capture.status !== 'COMPLETED')
    throw new Error('Capture not completed');

  if (capture.amount.value !== expectedAmount)
    throw new Error(`Amount mismatch: paid ${capture.amount.value}, expected ${expectedAmount}`);

  if (capture.amount.currency_code !== 'USD')
    throw new Error('Wrong currency');

  // custom_id should be "userId|packId"
  if (unit.custom_id) {
    const [, packIdFromOrder] = unit.custom_id.split('|');
    if (packIdFromOrder && packIdFromOrder !== expectedPackId)
      throw new Error(`Pack ID mismatch: ${packIdFromOrder} vs ${expectedPackId}`);
  }

  return { captureID: capture.id, payerEmail: data.payer?.email_address };
}

// ── Firestore: apply pack rewards (idempotent transaction) ──────
async function applyPackToUser(userId, email, packId, orderID, captureID) {
  const userRef     = db.collection('users').doc(userId);
  const purchaseRef = db.collection('purchases').doc(orderID);

  let finalUserData;

  await db.runTransaction(async (tx) => {
    // Idempotency guard: refuse to process the same order twice
    const existing = await tx.get(purchaseRef);
    if (existing.exists) throw new Error('ORDER_ALREADY_PROCESSED');

    const snap = await tx.get(userRef);
    const user = snap.exists ? snap.data() : {
      userId, email,
      coins: 0, totalCoins: 0,
      packType: 'free',
      starterPackPurchased: false,
      legendPackPurchased:  false,
      adsRemovedUntil: 0,
      permanentAdsRemoved: false,
      tapIncomeMultiplier:  1,
      autoIncomeMultiplier: 1,
      offlineEarningLimitHours: 2,
      bonusWheelSpins: 0,
      ownedSkins:   ['💰'],
      ownedThemes:  ['default','forest','space_lite'],
      badge: null,
      goldenButtonChanceMult: 1,
    };

    if (packId === 'starter' && user.starterPackPurchased)
      throw new Error('ALREADY_OWNS_STARTER');
    if (packId === 'legend'  && user.legendPackPurchased)
      throw new Error('ALREADY_OWNS_LEGEND');

    const r   = PACK_REWARDS[packId];
    const now = Date.now();

    user.coins      = (user.coins      || 0) + r.coinsBonus;
    user.totalCoins = (user.totalCoins || 0) + r.coinsBonus;

    r.themesToAdd.forEach(t => { if (!user.ownedThemes.includes(t)) user.ownedThemes.push(t); });
    r.skinsToAdd.forEach(s => { if (!user.ownedSkins.includes(s))  user.ownedSkins.push(s);  });

    if (packId === 'starter') {
      user.starterPackPurchased = true;
      if (user.packType !== 'legend') user.packType = 'starter';
      user.starterBoostUntil        = Math.max(user.starterBoostUntil || 0, now + r.starterBoostHours * 3600 * 1000);
      user.offlineEarningLimitHours = Math.max(user.offlineEarningLimitHours || 2, r.offlineHours);
      user.bonusWheelSpins          = (user.bonusWheelSpins || 0) + r.bonusWheelSpins;
      user.adsRemovedUntil          = Math.max(user.adsRemovedUntil || 0, now + r.adRemoveHours * 3600 * 1000);
      if (user.badge !== 'legend') user.badge = r.badge;
    } else {
      user.legendPackPurchased   = true;
      user.packType              = 'legend';
      user.tapIncomeMultiplier   = r.permanentTapMult;
      user.autoIncomeMultiplier  = r.permanentAutoMult;
      user.offlineEarningLimitHours = r.offlineHours;
      user.permanentAdsRemoved   = r.permanentAdsRemoved;
      user.bonusWheelSpins       = (user.bonusWheelSpins || 0) + r.bonusWheelSpins;
      user.goldenButtonChanceMult = r.goldenButtonChanceMult;
      user.badge                 = r.badge;
    }

    user.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    finalUserData  = user;

    tx.set(userRef, user, { merge: true });
    tx.set(purchaseRef, {
      userId, packId, orderID, captureID,
      amount: PACK_PRICES[packId],
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return finalUserData;
}

// ── Firebase Auth middleware ────────────────────────────────────
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ success: false, error: 'Missing token' });
  try {
    const decoded = await admin.auth().verifyIdToken(header.split(' ')[1]);
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

// ── Express app ─────────────────────────────────────────────────
const app = express();

// PayPal webhook needs raw body for signature verification
app.use('/api/paypal-webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors({ origin: CLIENT_ORIGIN, methods: ['GET','POST','OPTIONS'] }));

// ── Routes ──────────────────────────────────────────────────────

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/**
 * POST /api/verify-purchase
 * Called by the client right after PayPal onApprove fires.
 * We verify the order directly with PayPal's API, then atomically
 * apply rewards in Firestore.
 */
app.post('/api/verify-purchase', requireAuth, async (req, res) => {
  const { packId, orderID } = req.body ?? {};

  if (!packId || !orderID)
    return res.status(400).json({ success: false, error: 'Missing packId or orderID' });
  if (!PACK_PRICES[packId])
    return res.status(400).json({ success: false, error: 'Invalid packId' });

  try {
    const verified = await verifyOrder(orderID, PACK_PRICES[packId], packId);
    const userState = await applyPackToUser(
      req.user.uid, req.user.email, packId, orderID, verified.captureID
    );
    res.json({ success: true, userState });
  } catch (err) {
    const msg = err.message;
    // Idempotent: client may retry — return success so they don't lose their pack
    if (msg === 'ORDER_ALREADY_PROCESSED') {
      const snap = await db.collection('users').doc(req.user.uid).get();
      return res.json({ success: true, userState: snap.data() });
    }
    if (msg === 'ALREADY_OWNS_STARTER' || msg === 'ALREADY_OWNS_LEGEND') {
      const snap = await db.collection('users').doc(req.user.uid).get();
      return res.json({ success: true, userState: snap.data() });
    }
    console.error('[verify-purchase]', msg);
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * POST /api/paypal-webhook
 * Server-to-server notification from PayPal.
 * Acts as a safety net: even if the client closes before calling
 * verify-purchase, we still apply the pack here.
 */
app.post('/api/paypal-webhook', async (req, res) => {
  // Always ack immediately so PayPal doesn't retry prematurely
  res.status(200).send('OK');

  try {
    const raw  = req.body;                    // Buffer
    const body = JSON.parse(raw.toString());

    // Verify webhook signature
    const token = await getPayPalToken();
    const { data: vData } = await axios.post(
      `${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`,
      {
        auth_algo:          req.headers['paypal-auth-algo'],
        cert_url:           req.headers['paypal-cert-url'],
        transmission_id:    req.headers['paypal-transmission-id'],
        transmission_sig:   req.headers['paypal-transmission-sig'],
        transmission_time:  req.headers['paypal-transmission-time'],
        webhook_id:         PAYPAL_WEBHOOK_ID,
        webhook_event:      body,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (vData.verification_status !== 'SUCCESS') {
      console.warn('[webhook] Signature verification FAILED');
      return;
    }

    if (body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource  = body.resource;
      const customId  = resource.custom_id ?? '';            // "userId|packId"
      const captureID = resource.id;
      const orderID   = resource.supplementary_data?.related_ids?.order_id ?? captureID;
      const amount    = resource.amount?.value;

      const [userId, packId] = customId.split('|');
      if (!userId || !packId || !PACK_PRICES[packId]) {
        console.warn('[webhook] Cannot identify user/pack from custom_id:', customId);
        return;
      }
      if (PACK_PRICES[packId] !== amount) {
        console.warn('[webhook] Amount mismatch', amount, 'vs', PACK_PRICES[packId]);
        return;
      }

      try {
        await applyPackToUser(userId, null, packId, orderID, captureID);
        console.log('[webhook] Pack applied:', { userId, packId });
      } catch (e) {
        if (!['ORDER_ALREADY_PROCESSED','ALREADY_OWNS_STARTER','ALREADY_OWNS_LEGEND'].includes(e.message))
          console.error('[webhook] applyPackToUser failed:', e.message);
      }
    }
  } catch (err) {
    console.error('[webhook] Error:', err.message);
  }
});

/**
 * GET /api/restore-purchases
 * Called on login / app resume to sync server-controlled pack state.
 */
app.get('/api/restore-purchases', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection('users').doc(req.user.uid).get();
    res.json({ success: true, userState: snap.exists ? snap.data() : { packType: 'free' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Tap Tycoon API running on port ${PORT}`);
  console.log(`PayPal API: ${PAYPAL_API_BASE}`);
});
