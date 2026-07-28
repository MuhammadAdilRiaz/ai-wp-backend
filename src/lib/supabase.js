/*const { createClient } = require('@supabase/supabase-js');

// Single shared Supabase client used across the whole app.
// Uses the SERVICE KEY (bypasses row-level security) — keep this secret.
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

module.exports = supabase;*/

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
        auth: {
            flowType: 'pkce',
        },
    }
);

module.exports = supabase;
