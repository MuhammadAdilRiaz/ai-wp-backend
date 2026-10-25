// Structural validation is not a substitute for browser screenshots/visual QA.
function validatePagePayload(action) {
  if (!['create_elementor_page','update_elementor_page'].includes(action.action)) return [];
  const errors = [];
  let data = action.elementor_data;
  try { if (typeof data === 'string') data = JSON.parse(data); }
  catch { return ['Elementor JSON is malformed']; }
  if (!Array.isArray(data) || data.length === 0) errors.push('Elementor layout must contain at least one element');
  const ids = new Set();
  const walk = (items) => {
    for (const item of items || []) {
      if (!item || typeof item !== 'object' || !item.id || !item.elType) { errors.push('Element missing id/elType'); continue; }
      if (ids.has(item.id)) errors.push(`Duplicate element id: ${item.id}`);
      ids.add(item.id);
      if (item.elType === 'widget' && !item.widgetType) errors.push(`Widget ${item.id} missing widgetType`);
      if (item.elements) walk(item.elements);
    }
  };
  if (Array.isArray(data)) walk(data);
  return errors.slice(0, 12);
}
module.exports = { validatePagePayload };
