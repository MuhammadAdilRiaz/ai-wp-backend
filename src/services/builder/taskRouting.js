// Explicit build intent only. Generic questions about pages/themes are not builds.
function isWebsiteBuildRequest(message = '') {
  const text = String(message).toLowerCase();
  const intent = /\b(build|create|design|redesign|develop|make|generate|rebuild|update|edit|modify|banao|bana|bnado|bnana|change|setup|set up)\b/.test(text);
  const target = /\b(website|site|webpage|web page|landing page|homepage|home page|elementor|page|pages|store|shop|layout|hero section|section|footer|header)\b/.test(text);
  return intent && target;
}
module.exports = { isWebsiteBuildRequest };
