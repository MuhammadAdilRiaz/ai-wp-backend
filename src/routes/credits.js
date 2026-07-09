const express      = require('express');
const supabase     = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const router       = express.Router();

router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/credits — get current credit balance + transaction history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const { data: profile } = await supabase
        .from('profiles')
        .select('credits, plan')
        .eq('id', req.user.id)
        .single();

    const { data: history } = await supabase
        .from('credit_transactions')
        .select('amount, type, description, created_at')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

    res.json({
        credits: profile?.credits || 0,
        plan:    profile?.plan || 'free',
        history: history || [],
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/credits/packages — list available top-up packages
// ─────────────────────────────────────────────────────────────────────────────
router.get('/packages', (req, res) => {
    res.json({
        packages: [
            { id: 'starter',  credits: 500,  price_usd: 9,  label: 'Starter',     popular: false },
            { id: 'pro',      credits: 1500, price_usd: 19, label: 'Pro',          popular: true  },
            { id: 'agency',   credits: 5000, price_usd: 49, label: 'Agency',       popular: false },
        ]
    });
});

module.exports = router;
