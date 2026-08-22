// DISPLAY credits are what the customer sees ("you have 100 credits").
// REAL credits are what's actually stored/deducted in `profiles.credits`.
// Ratio is fixed per spec: 10 display credits = 1 real credit.
const DISPLAY_MULTIPLIER = 10;

const toDisplay = (real) => (real || 0) * DISPLAY_MULTIPLIER;
const toReal    = (display) => Math.round((display || 0) / DISPLAY_MULTIPLIER);

module.exports = { DISPLAY_MULTIPLIER, toDisplay, toReal };
