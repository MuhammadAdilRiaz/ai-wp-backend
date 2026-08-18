const express = require('express')
const router = express.Router()
const  supabase  = require('../lib/supabase')

// GET /api/plans — sab plans + unke credit tiers ek saath, grouped
router.get('/', async (req, res) => {
  try {
    // Step 1: plans table se active plans nikalna
    const { data: plans, error: plansError } = await supabase
      .from('plans')
      .select('id, name, description, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (plansError) throw plansError

    // Step 2: view se sab tiers nikalna (already calculated prices ke saath)
    const { data: tiers, error: tiersError } = await supabase
      .from('plan_credit_tiers_display')
      .select('*')
      .order('credits', { ascending: true })

    if (tiersError) throw tiersError

    // Step 3: har plan ke andar uske tiers group karna
    const result = plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      tiers: tiers
        .filter(t => t.plan_id === plan.id)
        .map(t => ({
          id: t.id,
          credits: t.credits,
          monthly_price: t.monthly_display_price,
          yearly_price: t.yearly_display_price,
          monthly_savings_percent: t.monthly_savings_percent,
          yearly_savings_percent: t.yearly_savings_percent,
        })),
    }))

    res.json({ plans: result })
  } catch (err) {
    console.error('Error fetching plans:', err.message)
    res.status(500).json({ error: 'Failed to fetch plans' })
  }
})

module.exports = router