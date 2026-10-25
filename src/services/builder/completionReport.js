function formatCompletion(aiMessage, results) {
  if (!results.length) return aiMessage || 'How can I help with your WordPress website?';
  const successes = results.filter(x => x.success);
  const failures = results.filter(x => !x.success);
  const lines = [];
  lines.push(`WordPress results: ${successes.length} completed, ${failures.length} not completed.`);
  for (const r of successes) {
    const data = r.data?.result || r.result || {};
    const what = r.title || r.slug || r.action;
    lines.push(`✓ ${what}${data.url ? ` — ${data.url}` : ''}${data.preview_url ? ` (preview: ${data.preview_url})` : ''}`);
  }
  for (const r of failures) {
    lines.push(`✗ ${r.title || r.action}: ${r.error || 'Not completed'}${r.requires_confirmation ? ' (needs explicit approval)' : ''}`);
  }
  if (failures.length) lines.push('The remaining dependent actions were not attempted. Please review the issue before retrying.');
  lines.push('Note: Live visual/mobile inspection has not been performed. Open the page previews to review the design.');
  return [aiMessage && !/\b(done|completed|live|published|built)\b/i.test(aiMessage) ? aiMessage : '', ...lines].filter(Boolean).join('\n');
}
module.exports = { formatCompletion };
