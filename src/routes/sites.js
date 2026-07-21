const express      = require('express');
const supabase     = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { pingWordPressSite } = require('../services/wordpress');
const router       = express.Router();

router.use(requireAuth);

// POST /api/sites/connect
router.post('/connect', async (req, res) => {
    const { site_url, site_token } = req.body;

    console.log('Connect attempt:', { site_url, user_id: req.user.id });

    if (!site_url || !site_token) {
        return res.status(400).json({ error: 'site_url and site_token are required.' });
    }

    // Clean URL
    const cleanUrl = site_url.replace(/\/$/, '');

    // Ping WordPress plugin
    console.log('Pinging WordPress:', cleanUrl);
    const pingResult = await pingWordPressSite(cleanUrl, site_token);
    console.log('Ping result:', JSON.stringify(pingResult));

    if (!pingResult.success) {
        return res.status(400).json({
            error: `Cannot reach WordPress site. ${pingResult.error || 'Check plugin is installed and token is correct.'}`,
        });
    }

    // Save to Supabase
    console.log('Saving site to Supabase...');
    const { data, error } = await supabase
        .from('sites')
        .upsert({
            user_id:    req.user.id,
            site_url:   cleanUrl,
            site_token: site_token,
            site_name:  pingResult.data?.site_name || cleanUrl,
            elementor:  !!pingResult.data?.elementor,
            connected:  true,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,site_url' })
        .select()
        .single();

    if (error) {
        console.error('Supabase error:', JSON.stringify(error));
        return res.status(500).json({
            error: `Database error: ${error.message || error.code || 'Unknown error'}`,
        });
    }

    console.log('Site saved successfully:', data.id);
    res.json({ site: data, wp_info: pingResult.data });
});

// GET /api/sites
router.get('/', async (req, res) => {
    const { data, error } = await supabase
        .from('sites')
        .select('id, site_url, site_name, elementor, connected, updated_at')
        .eq('user_id', req.user.id)
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Get sites error:', error);
        return res.status(500).json({ error: 'Failed to load sites.' });
    }

    res.json({ sites: data || [] });
});

// GET /api/sites/:id/context
router.get('/:id/context', async (req, res) => {
    const { data: site, error } = await supabase
        .from('sites')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .single();

    if (error || !site) return res.status(404).json({ error: 'Site not found.' });

    try {
        const response = await fetch(`${site.site_url}/wp-json/aiwpb/v1/context`, {
            headers: { 'X-AIWPB-Token': site.site_token },
        });
        const context = await response.json();
        res.json({ context });
    } catch (err) {
        res.status(500).json({ error: 'Could not reach WordPress site.' });
    }
});

// DELETE /api/sites/:id
router.delete('/:id', async (req, res) => {
    const { error } = await supabase
        .from('sites')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: 'Failed to disconnect site.' });
    res.json({ success: true });
});

module.exports = router;
