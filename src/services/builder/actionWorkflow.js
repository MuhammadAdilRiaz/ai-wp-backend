const { executeAction } = require('../wordpressConnector');
const { validatePagePayload } = require('../quality/pageValidator');
function key(s) { return String(s || '').trim().toLowerCase(); }
function resolveParams(action, pages, menus) {
  const resolved = { ...action };
  for (const field of ['page_id','menu_id']) {
    const val = resolved[field];
    if (typeof val !== 'string' || !val.startsWith('@')) continue;
    if (field === 'page_id' && val.startsWith('@page:')) resolved[field] = pages.get(key(val.slice(6)));
    else if (field === 'menu_id' && val.startsWith('@menu:')) resolved[field] = menus.get(key(val.slice(6)));
    if (!Number.isInteger(resolved[field]) || resolved[field] <= 0) {
      throw new Error(`Unresolved reference ${val}; create the referenced resource first`);
    }
  }
  return resolved;
}
async function executeWorkflow(site, actions) {
  const results = [], pages = new Map(), menus = new Map();
  const limited = Array.isArray(actions) ? actions.slice(0, 18) : [];
  for (const original of limited) {
    try {
      const action = resolveParams(original, pages, menus);
      const validationErrors = validatePagePayload(action);
      if (validationErrors.length) throw new Error(validationErrors.join('; '));
      const result = await executeAction(site, action);
      const output = result.data?.result || result.result || {};
      const entry = { action: action.action, title: original.title || null, slug: original.slug || null, ...result };
      results.push(entry);
      if (result.success && Number(output.page_id) > 0) pages.set(key(original.slug || original.title), Number(output.page_id));
      if (result.success && Number(output.menu_id) > 0) menus.set(key(original.name), Number(output.menu_id));
      // When an action fails, subsequent steps may depend on it. Stop safely.
      if (!result.success) break;
    } catch (error) {
      results.push({ action: original?.action || 'unknown', success: false, error: error.message });
      break;
    }
  }
  if (Array.isArray(actions) && actions.length > limited.length) {
    results.push({ action: 'remaining_actions', success: false, error: 'Workflow action limit reached; remaining actions were not executed' });
  }
  return results;
}
module.exports = { executeWorkflow };
