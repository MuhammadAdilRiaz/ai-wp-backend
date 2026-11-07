// Explicit plugin requests produce an approval plan; never install from a model response.
const KNOWN = [
  ['woocommerce', /\bwoo\s?commerce\b|\bwoo\b/i],
  ['elementor', /\belementor\b/i],
  ['contact-form-7', /\bcontact\s+form\s*7\b/i],
  ['wordpress-seo', /\byoast\s+seo\b/i],
  ['wpforms-lite', /\bwpforms\b/i],
  ['classic-editor', /\bclassic\s+editor\b/i],
];
function getPluginRequest(message = '') {
  const text = String(message).trim();
  if (/\b(product|products|catalog|inventory|sku)\b/i.test(text) &&
      !/\b(install|activate|enable)\b/i.test(text)) return null;
  if (!/\b(install|activate|enable|add|setup|set up)\b/i.test(text) ||
      !/\b(plugin|extension|elementor|woocommerce|woo\s?commerce|wpforms|yoast|contact form 7|classic editor)\b/i.test(text)) return null;
  const matched = KNOWN.find(([, pattern]) => pattern.test(text));
  const slugMatch = text.match(/\bplugin\s+(?:slug\s*)?[:=]\s*([a-z0-9-]{2,80})\b/i);
  const slug = matched?.[0] || slugMatch?.[1] || null;
  return { slug, error: slug ? null : 'Which WordPress.org plugin do you want? Please send its exact plugin slug (for example: plugin slug: contact-form-7).' };
}
function isProductTask(text = '') {
  return /\b(product|products|catalog|inventory|sku|woocommerce|woo\s?commerce)\b/i.test(String(text)) &&
    /\b(add|upload|import|create|list|publish|update|insert|save|banao|banana)\b/i.test(String(text));
}
module.exports = { getPluginRequest, isProductTask };
