// Provider-neutral connector shared by OpenAI and Claude. The AI providers
// generate the SAME action JSON; only this service talks to WordPress.
const { getWordPressContext, sendActionToWordPress } = require('./wordpress');

const READ_ACTIONS = new Set(['list_plugins', 'list_themes']);
const PAGE_ACTIONS = new Set([
  'create_page', 'update_page', 'create_elementor_page',
  'update_elementor_page', 'upload_media_from_url',
  'create_menu', 'add_menu_item', 'set_homepage', 'update_site_option',
]);
const SENSITIVE_ACTIONS = new Set([
  'install_plugin', 'activate_plugin', 'install_theme',
  'activate_theme', 'delete_page',
]);
const ALL_ACTIONS = new Set([...READ_ACTIONS, ...PAGE_ACTIONS, ...SENSITIVE_ACTIONS]);
const ACTION_APPROVALS = {
  install_plugin: 'plugin installation', activate_plugin: 'plugin activation',
  install_theme: 'theme installation', activate_theme: 'theme activation',
  delete_page: 'page deletion',
};

function validateAction(actionObj) {
  if (!actionObj || typeof actionObj !== 'object' || Array.isArray(actionObj)) {
    throw new Error('Action must be an object');
  }
  const { action, ...params } = actionObj;
  if (!ALL_ACTIONS.has(action)) throw new Error(`Unsupported action: ${String(action)}`);
  if (JSON.stringify(actionObj).length > 3_000_000) throw new Error('Action payload too large');
  if (['update_page','update_elementor_page','set_homepage','delete_page'].includes(action) &&
      (!Number.isSafeInteger(Number(params.page_id)) || Number(params.page_id) <= 0)) {
    throw new Error(`${action} requires a valid page_id`);
  }
  if (['install_plugin', 'install_theme'].includes(action) &&
      !/^[a-z0-9-]+$/.test(params.slug || '')) throw new Error('Invalid plugin/theme slug');
  if (action === 'activate_theme' && !/^[a-z0-9-]+$/.test(params.stylesheet || params.slug || '')) {
    throw new Error('Invalid theme stylesheet');
  }
  return { action, params, sensitive: SENSITIVE_ACTIONS.has(action) };
}

async function inspectSite(site) {
  const context = await getWordPressContext(site.site_url, site.site_token);
  if (!context || context.code) throw new Error(context?.message || 'Unable to inspect WordPress site');
  return context;
}

async function executeAction(site, actionObj, { approved = false } = {}) {
  const { action, params, sensitive } = validateAction(actionObj);
  if (sensitive && !approved) {
    return { success: false, requires_confirmation: true, action,
      error: `Explicit confirmation required for ${ACTION_APPROVALS[action]}` };
  }
  return sendActionToWordPress(site.site_url, site.site_token, action, params);
}

function listCapabilities() {
  return {
    providers: ['openai', 'claude'],
    connection: 'Existing X-AIWPB-Token (unchanged)',
    readonly: [...READ_ACTIONS, 'inspect_site'],
    standard: [...PAGE_ACTIONS],
    requires_confirmation: [...SENSITIVE_ACTIONS],
    unavailable_without_additional_adapters: ['create_woocommerce_product', 'update_woocommerce_product', 'edit_divi_page', 'edit_wpbakery_page'],
  };
}

module.exports = { validateAction, executeAction, inspectSite, listCapabilities };
