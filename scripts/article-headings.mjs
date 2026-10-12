/** @param {import('satteri').PluginFactoryContext} document @returns {import('satteri').HastPluginEntry} */
export function articleHeadings(document) {
  if (!/\/src\/content\/(writing|archive|projects)\//.test(document.fileURL?.pathname ?? '')) return null;
  return {
    name: 'built-signal-article-heading-focus',
    element: { filter: ['h2','h3','h4','h5','h6'], visit(node, context) { context.setProperty(node, 'tabIndex', -1); } },
  };
}
