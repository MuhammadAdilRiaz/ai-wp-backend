// Non-mutating WordPress environment check. No theme/plugin is installed without approval.
function preflight(context, prompt = '') {
  if (!context || typeof context !== 'object' || context.code || context.error) {
    return { ready: false, error: 'WordPress inspection failed. No page will be published.' };
  }
  const plugins = Array.isArray(context.plugins) ? context.plugins : [];
  const installed = slug => plugins.find(p => String(p.file || '').startsWith(`${slug}/`));
  const detected = context.builder || (context.elementor ? 'elementor' : context.wpbakery ? 'wpbakery' : context.divi ? 'divi' : 'classic');
  const preferences = context.preferences || {};
  const selected = preferences.prefer_existing_builder !== false && ['elementor','wpbakery','divi'].includes(detected)
    ? detected : (preferences.default_builder && preferences.default_builder !== 'auto' ? preferences.default_builder : detected);
  const builder = ['elementor','wpbakery','divi'].includes(selected) ? selected : 'elementor';
  const wantsStore = /\b(woocommerce|ecommerce|e-commerce|online store|shopping cart|checkout|sell products|online shop|product store)\b/i.test(prompt);
  const needs = [];
  if (builder === 'elementor' && !context.elementor) {
    const plugin = installed('elementor');
    needs.push({ action: plugin ? 'activate_plugin' : 'install_plugin', slug:'elementor', ...(plugin ? {plugin_file:plugin.file}:{}), reason:'Elementor is required to create editable Elementor-native pages.' });
  }
  if (wantsStore && !context.woocommerce) {
    const plugin = installed('woocommerce');
    needs.push({ action:plugin ? 'activate_plugin':'install_plugin', slug:'woocommerce', ...(plugin ? {plugin_file:plugin.file}:{}), reason:'WooCommerce is required for product catalog, cart and checkout.' });
  }
  return { ready: needs.length === 0 && builder === 'elementor', builder, wantsStore, needs,
    error: ['divi','wpbakery'].includes(builder) ? `${builder} page generation requires a builder-specific adapter. Nothing has been published.` : undefined };
}
module.exports = { preflight };
