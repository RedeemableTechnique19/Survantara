import { branding } from './branding.js?v=20261005-branding-v1';

export { branding };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

// Return readable guidance instead of an empty or institution-specific link
// when a deployment has not configured a contact yet.
export function contactLink(kind, label, fallback = 'Hubungi pengelola layanan') {
  const contact = branding.contacts[kind];
  return contact
    ? `<a href="${escapeHtml(contact.href)}" rel="noopener">${escapeHtml(label)}</a>`
    : escapeHtml(fallback);
}

export function brandWordmark() {
  const { prefix, accent } = branding.wordmark;
  return `<span class="brand-text" aria-hidden="true"><span class="brand-copy">${escapeHtml(prefix)}${accent ? `<span class="brand-number" data-text="${escapeHtml(accent)}">${escapeHtml(accent)}</span>` : ''}</span>${branding.locationLabel ? `<span class="brand-location">${escapeHtml(branding.locationLabel)}</span>` : ''}</span>`;
}
