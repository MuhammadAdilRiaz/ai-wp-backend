const supabase = require('./supabase');

let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000;

async function getSettings() {
    const now = Date.now();
    if (cache && now < cacheExpiry) return cache;

    const { data, error } = await supabase.from('app_settings').select('key, value');
    if (error || !data) return cache || {}; // DB down ho to purani cached value (ya khali) use karo, crash na ho

    cache = {};
    for (const row of data) cache[row.key] = row.value;
    cacheExpiry = now + CACHE_TTL_MS;
    return cache;
}

module.exports = { getSettings };