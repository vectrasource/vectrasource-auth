// api/webhook.js
// Handles ALL Razorpay Subscription webhook events
// Events handled:
//   subscription.activated  → issue token (first payment)
//   subscription.charged    → extend token by 1 month (renewal)
//   subscription.cancelled  → deactivate token
//   subscription.halted     → deactivate token (payment failed repeatedly)

import { MongoClient } from 'mongodb';
import crypto from 'crypto';

let cachedClient = null;
async function getDB() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db('vectrasource');
}

const PLAN_NAMES = {
  'vlogsource': 'VlogSource Pro',
  'tutorai':    'TutorAI Pro',
  'vakeel':     'Vakeel AI Pro',
  'ledgerai':   'LedgerAI Pro',
  'suite':      'Vectrasource Suite Pro',
};

// Map your Razorpay Plan IDs to product keys
// Replace these with your actual plan IDs from Razorpay Dashboard → Subscriptions → Plans
const RAZORPAY_PLAN_MAP = {
  'plan_SxrzUFchScm8fi': 'vlogsource',   // VlogSource ₹269/month
  'plan_suite_699':      'suite',          // Suite Pro ₹699/month
  'plan_tutorai_269':    'tutorai',
  'plan_vakeel_269':     'vakeel',
};

function verifySignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

async function sendTokenEmail(email, token, planName, validUntil, isRenewal = false) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { console.warn('RESEND_API_KEY not set'); return; }

  const formattedDate = new Date(validUntil).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const subject = isRenewal
    ? `VlogSource renewed — valid until ${formattedDate}`
    : `Your VlogSource access token is ready ✓`;

  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#0D0D0D;color:#F0EAE8;padding:40px 20px;margin:0;">
<div style="max-width:480px;margin:0 auto;background:#1F1210;border-radius:16px;padding:32px;border:1px solid rgba(255,59,59,0.15);">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="font-size:32px;">🎬</div>
    <div style="font-size:22px;font-weight:800;color:#FF3B3B;">VlogSource</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.3);">Vectrasource Digital Suite</div>
  </div>
  <h2 style="font-size:18px;color:#F0EAE8;text-align:center;">
    ${isRenewal ? '🔄 Subscription Renewed!' : '✓ Your access token is ready'}
  </h2>
  <p style="font-size:14px;color:rgba(255,255,255,0.6);text-align:center;line-height:1.6;">
    ${isRenewal
      ? `Your <strong style="color:#FF3B3B;">${planName}</strong> has been renewed successfully.`
      : `Thank you for subscribing to <strong style="color:#FF3B3B;">${planName}</strong>.`
    }
  </p>
  <div style="background:rgba(255,59,59,0.08);border:1.5px solid rgba(255,59,59,0.2);border-radius:10px;padding:16px;text-align:center;margin:20px 0;">
    <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:8px;text-transform:uppercase;">Your Access Token</div>
    <div style="font-family:monospace;font-size:13px;color:#FF6B6B;word-break:break-all;font-weight:600;">${token}</div>
  </div>
  <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:16px;margin-bottom:20px;">
    <div style="font-size:12px;color:rgba(255,255,255,0.4);">Plan</div>
    <div style="font-size:14px;color:#F0EAE8;font-weight:600;margin-bottom:8px;">${planName}</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.4);">Valid Until</div>
    <div style="font-size:14px;color:#4ade80;font-weight:600;">${formattedDate}</div>
  </div>
  <div style="text-align:center;margin-bottom:20px;">
    <a href="https://vlogsource.vercel.app" style="background:#FF3B3B;color:white;text-decoration:none;padding:12px 28px;border-radius:30px;font-weight:700;font-size:14px;display:inline-block;">Open VlogSource →</a>
  </div>
  ${!isRenewal ? `
  <ol style="font-size:13px;color:rgba(255,255,255,0.5);line-height:1.8;padding-left:18px;">
    <li>Open VlogSource</li>
    <li>Click <strong style="color:#F0EAE8;">"I have a token"</strong> in the bottom bar</li>
    <li>Paste your token and click Verify</li>
    <li>Enjoy unlimited access!</li>
  </ol>` : ''}
  <div style="border-top:1px solid rgba(255,255,255,0.06);margin-top:24px;padding-top:16px;text-align:center;font-size:11px;color:rgba(255,255,255,0.25);">
    Need help? Reply to this email · Vectrasource Digital Suite · Built in Kerala 🌴
  </div>
</div></body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VlogSource <noreply@vectrasource.com>',
      to: [email],
      subject,
      html
    })
  });
}

async function sendCancellationEmail(email, planName) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VlogSource <noreply@vectrasource.com>',
      to: [email],
      subject: 'Your VlogSource subscription has been cancelled',
      html: `
<div style="font-family:Arial,sans-serif;background:#0D0D0D;color:#F0EAE8;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#1F1210;border-radius:16px;padding:32px;">
    <div style="text-align:center;font-size:32px;margin-bottom:16px;">😢</div>
    <h2 style="color:#F0EAE8;text-align:center;">Subscription Cancelled</h2>
    <p style="color:rgba(255,255,255,0.6);text-align:center;line-height:1.6;">
      Your <strong style="color:#FF3B3B;">${planName}</strong> subscription has been cancelled.
      You'll retain access until your current billing period ends.
    </p>
    <div style="text-align:center;margin-top:24px;">
      <a href="https://vlogsource.vercel.app" style="background:#FF3B3B;color:white;text-decoration:none;padding:12px 28px;border-radius:30px;font-weight:700;font-size:14px;display:inline-block;">Resubscribe →</a>
    </div>
    <p style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;margin-top:16px;">
      We'd love to know why you cancelled. Just reply to this email.
    </p>
  </div>
</div>`
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Razorpay signature
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (webhookSecret && signature) {
    const rawBody = JSON.stringify(req.body);
    if (!verifySignature(rawBody, signature, webhookSecret)) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  const event = req.body;
  const eventType = event.event;

  console.log('Webhook received:', eventType);

  try {
    const db = await getDB();
    const subscriptions = db.collection('subscriptions');

    // ─── SUBSCRIPTION ACTIVATED (first payment success) ───────────────────
    if (eventType === 'subscription.activated') {
      const sub = event.payload?.subscription?.entity;
      const payment = event.payload?.payment?.entity;

      const email = payment?.email || sub?.notes?.email;
      const razorpaySubId = sub?.id;
      const razorpayPlanId = sub?.plan_id;
      const plan = RAZORPAY_PLAN_MAP[razorpayPlanId] || 'vlogsource';

      if (!email) {
        console.error('No email in subscription.activated');
        return res.status(200).json({ received: true, error: 'No email' });
      }

      // Check for duplicate
      const existing = await subscriptions.findOne({ razorpaySubId });
      if (existing) {
        console.log('Duplicate activation for', razorpaySubId);
        return res.status(200).json({ received: true, action: 'duplicate_skipped' });
      }

      const token = 'vs_' + crypto.randomBytes(24).toString('hex');
      const validFrom = new Date();
      const validUntil = new Date();
      validUntil.setMonth(validUntil.getMonth() + 1);

      await subscriptions.insertOne({
        token, email, plan,
        planName: PLAN_NAMES[plan],
        validFrom, validUntil,
        createdAt: new Date(),
        source: 'razorpay_subscription',
        razorpaySubId,
        razorpayPlanId,
        active: true,
      });

      await sendTokenEmail(email, token, PLAN_NAMES[plan], validUntil, false);
      console.log(`Token issued for ${email} — ${plan}`);
      return res.status(200).json({ received: true, action: 'token_issued', email, plan });
    }

    // ─── SUBSCRIPTION CHARGED (monthly renewal) ───────────────────────────
    if (eventType === 'subscription.charged') {
      const sub = event.payload?.subscription?.entity;
      const payment = event.payload?.payment?.entity;

      const email = payment?.email;
      const razorpaySubId = sub?.id;

      if (!email || !razorpaySubId) {
        return res.status(200).json({ received: true, error: 'Missing email or subId' });
      }

      // Find existing subscription and extend it by 1 month
      const existing = await subscriptions.findOne({ razorpaySubId, active: true });

      if (existing) {
        const newValidUntil = new Date(existing.validUntil);
        newValidUntil.setMonth(newValidUntil.getMonth() + 1);

        await subscriptions.updateOne(
          { razorpaySubId },
          { $set: { validUntil: newValidUntil, lastRenewed: new Date() } }
        );

        await sendTokenEmail(email, existing.token, existing.planName, newValidUntil, true);
        console.log(`Subscription renewed for ${email} until ${newValidUntil}`);
        return res.status(200).json({ received: true, action: 'subscription_extended', email });
      } else {
        // Edge case: renewal but no existing record — create new token
        const plan = RAZORPAY_PLAN_MAP[sub?.plan_id] || 'vlogsource';
        const token = 'vs_' + crypto.randomBytes(24).toString('hex');
        const validUntil = new Date();
        validUntil.setMonth(validUntil.getMonth() + 1);

        await subscriptions.insertOne({
          token, email, plan,
          planName: PLAN_NAMES[plan],
          validFrom: new Date(), validUntil,
          createdAt: new Date(),
          source: 'razorpay_subscription_renewal',
          razorpaySubId, active: true,
        });

        await sendTokenEmail(email, token, PLAN_NAMES[plan], validUntil, true);
        return res.status(200).json({ received: true, action: 'token_reissued', email });
      }
    }

    // ─── SUBSCRIPTION CANCELLED ───────────────────────────────────────────
    if (eventType === 'subscription.cancelled') {
      const sub = event.payload?.subscription?.entity;
      const razorpaySubId = sub?.id;

      const existing = await subscriptions.findOne({ razorpaySubId });
      if (existing) {
        // Don't delete — just mark inactive, keep access until validUntil
        await subscriptions.updateOne(
          { razorpaySubId },
          { $set: { active: false, cancelledAt: new Date() } }
        );
        await sendCancellationEmail(existing.email, existing.planName);
        console.log(`Subscription cancelled for ${existing.email}`);
      }

      return res.status(200).json({ received: true, action: 'subscription_cancelled' });
    }

    // ─── SUBSCRIPTION HALTED (payment failed too many times) ──────────────
    if (eventType === 'subscription.halted') {
      const sub = event.payload?.subscription?.entity;
      const razorpaySubId = sub?.id;

      await subscriptions.updateOne(
        { razorpaySubId },
        { $set: { active: false, haltedAt: new Date() } }
      );

      console.log(`Subscription halted for subId: ${razorpaySubId}`);
      return res.status(200).json({ received: true, action: 'subscription_halted' });
    }

    // All other events — just acknowledge
    return res.status(200).json({ received: true, action: 'ignored', event: eventType });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ received: true, error: error.message });
  }
}
