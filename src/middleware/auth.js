const supabase = require('../lib/supabase');

/**
 * requireAuth middleware
 * Reads the Bearer token from Authorization header,
 * verifies it with Supabase, and attaches user to req.user.
 * Call this on any route that needs a logged-in user.
 */
async function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token  = header.replace('Bearer ', '').trim();

    if (!token) {
        return res.status(401).json({ error: 'No token provided.' });
    }

    // Ask Supabase to verify the JWT and return the user
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return res.status(401).json({ error: 'Invalid or expired session.' });
    }

    req.user  = user;
    req.token = token;
    next();
}

module.exports = { requireAuth };
