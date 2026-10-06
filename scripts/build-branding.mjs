import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { project } from '../public/project.js';
const root = resolve(import.meta.dirname, '..');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function validateBranding(profile) {
  if (!profile || typeof profile !== 'object') throw Error('Profil branding tidak valid.');
  for (const field of ['projectName', 'displayName', 'shortName', 'description', 'institution', 'purpose', 'copyrightYear', 'tagline']) {
    if (typeof profile[field] !== 'string' || !profile[field].trim()) throw Error(`Branding ${field} wajib diisi.`);
  }
  for (const field of ['locationLabel', 'unit']) {
    if (typeof profile[field] !== 'string') throw Error(`Branding ${field} harus berupa teks.`);
  }
  if (!profile.wordmark || typeof profile.wordmark.prefix !== 'string' || !profile.wordmark.prefix.trim()
    || typeof profile.wordmark.accent !== 'string') throw Error('Wordmark tidak valid.');
  if (!profile.contacts || !profile.assets) throw Error('Kontak dan aset wajib didefinisikan.');
  for (const kind of ['emergency', 'information']) {
    const contact = profile.contacts[kind];
    if (contact === null) continue;
    if (!contact || !['label', 'display', 'href'].every(key => typeof contact[key] === 'string' && contact[key].trim())) {
      throw Error(`Kontak ${kind} tidak valid.`);
    }
    if (contact.channelLabel !== undefined && typeof contact.channelLabel !== 'string') throw Error(`Label kanal ${kind} harus berupa teks.`);
    const url = new URL(contact.href);
    if (!['https:', 'tel:'].includes(url.protocol) || url.username || url.password) throw Error(`URL kontak ${kind} tidak aman.`);
  }
  for (const key of ['favicon', 'logo', 'heroImage', 'serviceAreaShapes']) {
    const asset = profile.assets[key];
    if (asset !== null && (typeof asset !== 'string' || !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(asset)
      || asset.split('/').includes('..'))) throw Error(`Aset ${key} harus menggunakan path lokal /assets/.`);
  }
  if (typeof profile.assets.logoAlt !== 'string' || (profile.assets.logo && !profile.assets.logoAlt.trim())) throw Error('Teks alternatif logo wajib diisi.');
  if (profile.projectName !== project.name) throw Error('Nama karya asli harus tetap Survantara.');
  const guide = profile.links?.w2Guide;
  if (guide != null) {
    const url = new URL(guide);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('URL panduan tidak aman.');
  }
  const map = profile.map;
  if (!map || !Array.isArray(map.center) || map.center.length !== 2 || !map.center.every(Number.isFinite)
    || Math.abs(map.center[0]) > 90 || Math.abs(map.center[1]) > 180
    || !Number.isInteger(map.zoom) || map.zoom < 1 || map.zoom > 19) throw Error('Pusat peta atau zoom tidak valid.');
  return profile;
}

function link(contact, label) {
  return `<a href="${escapeHtml(contact.href)}" rel="noopener">${escapeHtml(label)}</a>`;
}

export async function buildBranding(profileName = 'umum', outputDir = join(root, 'public')) {
  if (!/^[a-z0-9-]+$/.test(profileName)) throw Error('Nama profil tidak valid.');
  const profile = validateBranding(JSON.parse(await readFile(join(root, 'branding', 'profiles', `${profileName}.json`), 'utf8')));
  // Validate before writing anything; a typo must not replace a working shell.
  for (const key of ['favicon', 'logo', 'heroImage', 'serviceAreaShapes']) {
    if (profile.assets[key]) await access(join(root, 'public', profile.assets[key]));
  }
  const template = await readFile(join(root, 'branding', 'index.template.html'), 'utf8');
  const version = createHash('sha256').update(JSON.stringify(profile)).digest('hex').slice(0, 12);
  const { emergency, information } = profile.contacts;
  const wordmark = `<span class="brand-text" aria-hidden="true"><span class="brand-copy">${escapeHtml(profile.wordmark.prefix)}${profile.wordmark.accent ? `<span class="brand-number" data-text="${escapeHtml(profile.wordmark.accent)}">${escapeHtml(profile.wordmark.accent)}</span>` : ''}</span>${profile.locationLabel ? `<span class="brand-location">${escapeHtml(profile.locationLabel)}</span>` : ''}</span>`;
  const tokens = {
    displayName: escapeHtml(profile.displayName), description: escapeHtml(profile.description), wordmark,
    favicon: profile.assets.favicon ? `<link rel="icon" href="${escapeHtml(profile.assets.favicon)}?v=${version}" type="image/svg+xml">` : '',
    logo: profile.assets.logo ? `<span class="footer-logo"><img src="${escapeHtml(profile.assets.logo)}" width="191" height="242" alt="${escapeHtml(profile.assets.logoAlt)}"></span>` : '',
    institution: escapeHtml(profile.institution), unit: profile.unit ? `<span>${escapeHtml(profile.unit)}</span>` : '',
    purpose: escapeHtml(profile.purpose), tagline: escapeHtml(profile.tagline),
    copyright: escapeHtml(`© ${profile.copyrightYear} ${profile.displayName}${profile.locationLabel ? ` · ${profile.institution}` : ''}`),
    contacts: [emergency, information].filter(Boolean).map(contact => `<a href="${escapeHtml(contact.href)}" rel="noopener"><strong>${escapeHtml(contact.label)}</strong><span>${escapeHtml(contact.display)}</span></a>`).join('\n            '),
    noscriptContacts: emergency
      ? `<p><strong>Gawat darurat?</strong> Hubungi ${escapeHtml(emergency.label)} ${escapeHtml(profile.institution)}: ${link(emergency, emergency.display)}.${information ? ` Informasi umum: ${link(information, information.display)}.` : ''}</p>`
      : '<p><strong>Gawat darurat?</strong> Hubungi layanan darurat setempat atau datangi fasilitas kesehatan terdekat.</p>',
    developerCredit: escapeHtml(`Pemilik ${project.name}: ${project.author}`),
    brandingVersion: version,
  };
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in tokens)) throw Error(`Token template tidak dikenal: ${key}`);
    return tokens[key];
  });
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'LICENSE.txt'), await readFile(join(root, 'LICENSE'), 'utf8'), 'utf8');
  await writeFile(join(outputDir, 'index.html'), html.replace(/[ \t]+$/gm, ''), 'utf8');
  await writeFile(join(outputDir, 'branding.js'), `// Generated by scripts/build-branding.mjs; edit branding/profiles/${profileName}.json.\nexport const branding = ${JSON.stringify(profile, null, 2)};\n`, 'utf8');
  await writeFile(join(outputDir, 'branding.css'), `/* Generated from profile ${profileName}. */\n:root { --institution-hero-image: ${profile.assets.heroImage ? `url("${profile.assets.heroImage}")` : 'none'}; }\n`, 'utf8');
  return profile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let profileName = 'umum';
  let outputDir = join(root, 'public');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) profileName = args[++i];
    else if (args[i] === '--out' && args[i + 1]) outputDir = resolve(args[++i]);
    else throw Error(`Argumen tidak dikenal: ${args[i]}`);
  }
  await buildBranding(profileName, outputDir);
  console.log(`Branding ${profileName} dibuat di ${outputDir}`);
}
