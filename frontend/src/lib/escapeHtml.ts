const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for interpolation into an HTML string.
 *
 * React escapes automatically, so this is only needed where we hand raw markup
 * to a library that parses it — Leaflet's `bindPopup`, chart tooltip
 * formatters, anything reached via `dangerouslySetInnerHTML`. In those places
 * user-controlled text is markup unless it is escaped first.
 *
 * Quotes are encoded as well as angle brackets, so the result is also safe
 * inside a double- or single-quoted attribute value. It is NOT sufficient for
 * an unquoted attribute, a `javascript:` URL, or inside a `<script>` or
 * `<style>` block — do not use it for those.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';

  return String(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

export default escapeHtml;
