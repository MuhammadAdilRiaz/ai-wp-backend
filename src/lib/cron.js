const cron     = require('node-cron');
const supabase = require('../lib/supabase');
const { sendTrialEndingEmail } = require('./email');

// Runs hourly. Catches any trial account whose trial_ends_at is within the
// next 24h and hasn't been emailed yet. Hourly (not daily) so someone who
// signs up mid-afternoon still gets a reminder roughly a day before expiry,
// not whenever the next midnight job happens to run.
async function sendTrialEndingReminders() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const { data: expiringTrials, error } = await supabase
        .from('profiles')
        .select('id, email')
        .eq('plan', 'trial')
        .eq('trial_reminder_sent', false)
        .gte('trial_ends_at', now.toISOString())
        .lte('trial_ends_at', in24h.toISOString());

    if (error) {
        console.error('Trial reminder query failed:', error);
        return;
    }

    for (const profile of expiringTrials || []) {
        await sendTrialEndingEmail(profile.email);
        await supabase.from('profiles').update({ trial_reminder_sent: true }).eq('id', profile.id);
    }
}

// Runs once at process start, then per the schedule below. If Railway
// restarts your service several times a day, this still only ever emails
// someone once — trial_reminder_sent is the guard, not the schedule.
function startCronJobs() {
    cron.schedule('0 * * * *', sendTrialEndingReminders); // every hour, on the hour
    console.log('Cron jobs started: trial-ending reminders (hourly)');
}

module.exports = { startCronJobs, sendTrialEndingReminders };
