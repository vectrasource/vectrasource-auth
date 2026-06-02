// api/webhook.js
// Razorpay webhook — fires when payment is successful
// Saves subscription to MongoDB, emails token to user

import crypto from 'crypto';
import { MongoClient } from 'mongodb';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// MongoDB connection cache
let cachedClient = null;
async function getDB() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db('vectrasource');
}

// Generate a secure random token
function generateToken() {
  return 'vs_' + crypto.randomBytes(24).toString('hex');
}

// Plan configs
const PLANS = {
  'tutorai-pro':    { name: 'TutorAI Pro',    product: 'tutorai',    days: 30 },
  'vlogsource-pro': { name: 'VlogSource Pro', product: 'vlogsource', days: 30 },
  'ledgerai-pro':   { name: 'Ledger AI Pro',  product: 'ledgerai',   days: 30 },
  'vakeel-pro':     { name: 'Vakeel AI Pro',  product: 'vakeel',     days: 30 },
  'suite-pro':      { name: 'Suite Pro',      product: 'suite',      days: 30 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = JSON.stringify(req.body);
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;

    // Only process successful payments
    if (event.event !== 'payment_link.paid') {
      return res.status(200).json({ received: true });
    }

    const payment = event.payload.payment_link.entity;
    const referenceId = payment.reference_id; // This is our plan key e.g. 'tutorai-pro'
    const email = payment.customer?.email || payment.notes?.email;
    const amount = payment.amount / 100; // Razorpay sends paise

    if (!email) {
      console.error('No email in payment:', payment);
      return res.status(200).json({ received: true, warning: 'No email found' });
    }

    const plan = PLANS[referenceId];
    if (!plan) {
      console.error('Unknown plan:', referenceId);
      return res.status(200).json({ received: true, warning: 'Unknown plan' });
    }

    // Generate token and set expiry
    const token = generateToken();
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + plan.days);

    // Save to MongoDB
    const db = await getDB();
    const subscriptions = db.collection('subscriptions');

    // Upsert — if user already exists, update their subscription
    await subscriptions.updateOne(
      { email: email.toLowerCase() },
      {
        $set: {
          email: email.toLowerCase(),
          plan: plan.product,
          planName: plan.name,
          token,
          validUntil,
          amount,
          razorpayPaymentId: payment.id,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    // Send token email
    await resend.emails.send({
      from: 'Vectrasource <noreply@vectrasource.com>',
      to: email,
      subject: `Your ${plan.name} Access Token — Vectrasource`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"/></head>
        <body style="font-family:'DM Sans',Arial,sans-serif;background:#f8fafc;padding:40px 20px;margin:0;">
          <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
            
            <div style="background:linear-gradient(135deg,#F59E0B,#D97706);padding:32px;text-align:center;">
              <div style="font-size:36px;margin-bottom:8px;">⚡</div>
              <div style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#fff;">Vectrasource</div>
              <div style="font-size:14px;color:rgba(255,255,255,0.8);margin-top:4px;">AI Productivity Suite</div>
            </div>

            <div style="padding:32px;">
              <h2 style="font-size:20px;color:#0f172a;margin:0 0 8px;">Payment Confirmed! 🎉</h2>
              <p style="font-size:14px;color:#6b7280;margin:0 0 24px;">
                Thank you for subscribing to <strong>${plan.name}</strong>. 
                Your access token is below — copy it and paste it in the tool to unlock unlimited access.
              </p>

              <div style="background:#f8fafc;border:2px dashed #F59E0B;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
                <div style="font-size:11px;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Your Access Token</div>
                <div style="font-family:monospace;font-size:16px;font-weight:700;color:#0f172a;word-break:break-all;background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e7eb;">
                  ${token}
                </div>
              </div>

              <div style="background:#eff4ff;border-radius:10px;padding:16px;margin-bottom:24px;">
                <div style="font-size:13px;color:#1a56db;font-weight:600;margin-bottom:8px;">📋 How to use your token:</div>
                <ol style="font-size:13px;color:#374151;margin:0;padding-left:18px;line-height:1.8;">
                  <li>Go to your tool — <strong>${plan.product === 'suite' ? 'any Vectrasource tool' : plan.name}</strong></li>
                  <li>Click "I have a token" when the paywall appears</li>
                  <li>Paste this token and click Verify</li>
                  <li>Enjoy unlimited access until <strong>${validUntil.toLocaleDateString('en-IN')}</strong></li>
                </ol>
              </div>

              <div style="font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px;">
                <strong>Plan:</strong> ${plan.name} &nbsp;·&nbsp;
                <strong>Valid until:</strong> ${validUntil.toLocaleDateString('en-IN')} &nbsp;·&nbsp;
                <strong>Amount paid:</strong> ₹${amount}
              </div>
            </div>

            <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #f3f4f6;">
              <div style="font-size:11px;color:#9ca3af;">
                Vectrasource Digital Suite &nbsp;·&nbsp; Built in Kerala, India<br/>
                Questions? Reply to this email.
              </div>
            </div>

          </div>
        </body>
        </html>
      `
    });

    console.log(`✅ Subscription created: ${email} → ${plan.name} → ${token}`);
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
