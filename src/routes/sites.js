const express      = require('express');
const supabase     = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { pingWordPressSite } = require('../services/wordpress');
const router       = express.Router();

// All routes require login
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sites/connect
// Body: { site_url, site_token }
// Verifies the WP plugin is reachable then saves the connection
// ─────────────────────────────────────────────────────────────────────────────
router.post('/connect', async (req, res) => {
    const { site_url, site_token } = req.body;

    if (!site_url || !site_token) {
        return res.status(400).json({ error: 'site_url and site_token are required.' });
    }

    // Ping the WP site to verify the plugin is installed and token is correct
    const pingResult = await pingWordPressSite(site_url, site_token);
    if (!pingResult.success) {
        return res.status(400).json({
            error: 'Could not connect to WordPress site. Make sure the plugin is installed and the token is correct.',
            detail: pingResult.error,
        });
    }

    // Save or update the site connection for this user
    const { data, error } = await supabase
        .from('sites')
        .upsert({
            user_id:    req.user.id,
            site_url:   site_url.replace(/\/$/, ''), // remove trailing slash
            site_token: site_token,
            site_name:  pingResult.data.site_name,
            elementor:  pingResult.data.elementor,
            connected:  true,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,site_url' })
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to save site.' });

    res.json({ site: data, wp_info: pingResult.data });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sites — list all connected sites for this user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const { data, error } = await supabase
        .from('sites')
        .select('id, site_url, site_name, elementor, connected, updated_at')
        .eq('user_id', req.user.id)
        .order('updated_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'Failed to load sites.' });

    res.json({ sites: data });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sites/:id/context
// Fetch current pages, theme, menus from the WP site (for Claude's context)
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/sites/:id — disconnect a site
// ─────────────────────────────────────────────────────────────────────────────
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
