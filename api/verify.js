// api/verify.js
// Called by each tool to verify a user's subscription token
// Returns: { valid: true/false, plan, validUntil, email }

import { MongoClient } from 'mongodb';

let cachedClient = null;
async function getDB() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db('vectrasource');
}

// Which plans have access to which products
const PLAN_ACCESS = {
  'tutorai':    ['tutorai', 'suite'],
  'vlogsource': ['vlogsource', 'suite'],
  'ledgerai':   ['ledgerai', 'suite'],
  'vakeel':     ['vakeel', 'suite'],
  'taxdraftai': ['taxdraftai', 'suite'],
  'suite':      ['tutorai', 'vlogsource', 'ledgerai', 'vakeel', 'taxdraftai', 'suite'],
};

export default async function handler(req, res) {
  // Allow CORS from all Vectrasource tools
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, product } = req.body;

  if (!token || !product) {
    return res.status(400).json({ valid: false, error: 'Token and product required' });
  }

  try {
    const db = await getDB();
    const subscriptions = db.collection('subscriptions');

    const subscription = await subscriptions.findOne({ token });

    if (!subscription) {
      return res.status(200).json({ valid: false, error: 'Invalid token' });
    }

    // Check if subscription is still valid
    const now = new Date();
    if (new Date(subscription.validUntil) < now) {
      return res.status(200).json({ 
        valid: false, 
        error: 'Subscription expired',
        expiredOn: subscription.validUntil
      });
    }

    // Check if this plan has access to the requested product
    const allowedProducts = PLAN_ACCESS[subscription.plan] || [];
    if (!allowedProducts.includes(product)) {
      return res.status(200).json({ 
        valid: false, 
        error: 'This plan does not include ' + product
      });
    }

    // All good — return subscription details
    return res.status(200).json({
      valid: true,
      plan: subscription.plan,
      planName: subscription.planName,
      validUntil: subscription.validUntil,
      email: subscription.email,
    });

  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
}
