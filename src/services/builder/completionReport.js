// User-visible summaries come from verified connector results, never from AI claims.
function formatCompletion(aiMessage, results, options = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    return options.buildIntent
      ? 'No WordPress changes were made. Please provide the missing details or retry the build.'
      : (String(aiMessage || 'What would you like me to change?').trim().slice(0, 420));
  }
  const ok = results.filter(r => r && r.success);
  const failed = results.filter(r => !r || !r.success);
  const pages = ok.filter(r => /(?:create|update)_elementor_page|(?:create|update)_page/.test(r.action || ''));
  const parts = [];
  if (failed.length) parts.push(`${ok.length} WordPress action(s) completed; ${failed.length} failed.`);
  else parts.push(`${ok.length} WordPress action(s) completed successfully.`);
  if (pages.length) parts.push(`Pages: ${pages.map(r => r.title || r.slug || 'Page').slice(0, 8).join(', ')}${pages.length > 8 ? '…' : ''}.`);
  const urls = ok.map(r => (r.data?.result || r.result || {}).url).filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 3);
  if (urls.length) parts.push(`Review: ${urls.join(' | ')}`);
  if (failed.length) {
    const problem = failed[0];
    parts.push(`Needs attention: ${problem.title || problem.action || 'WordPress action'} — ${String(problem.error || 'not completed').slice(0, 180)}.`);
    parts.push('Would you like me to retry the failed step?');
  } else {
    parts.push('Please review the published pages on desktop and mobile. Would you like any design changes?');
  }
  return parts.join('\n');
}
module.exports = { formatCompletion };
