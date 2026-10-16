const express = require('express');
const supabase = require('../lib/supabase');
const router = express.Router();

// Public, read-only catalog. No secrets, no user information.
router.get('/', async (req, res) => {
    const { data, error } = await supabase.from('website_templates')
        .select('slug,name,category,emoji,description,prompt,design_config,is_free,sort_order')
        .eq('is_active', true).order('sort_order', { ascending: true });
    if (error) {
        console.error('Template catalog read failed:', error.message);
        return res.status(503).json({ error: 'Template catalog is unavailable. Apply template-catalog-migration.sql to Supabase.' });
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ templates: data || [] });
});

router.get('/:slug', async (req, res) => {
    if (!/^[a-z0-9-]{1,80}$/.test(req.params.slug)) return res.status(400).json({ error: 'Invalid template slug.' });
    const { data, error } = await supabase.from('website_templates')
        .select('slug,name,category,emoji,description,prompt,design_config,is_free')
        .eq('slug', req.params.slug).eq('is_active', true).maybeSingle();
    if (error) return res.status(503).json({ error: 'Template catalog unavailable.' });
    if (!data) return res.status(404).json({ error: 'Template not found.' });
    res.json({ template: data });
});
module.exports = router;
