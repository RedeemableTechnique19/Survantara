import { project } from './project.js';
import { branding, contactLink, brandWordmark } from './brand.js?v=20261005-branding-v1';
const app = document.querySelector('#app');
import { createEbsViews, EBS_LABELS } from './ebs.js?v=20261005-branding-v1';
import { createEventWorkflow } from './event-workflow.js?v=20261005-story-quality';
import { renderCadreQuality } from './cadre-quality.js?v=20261005-story-quality';
import { mountCadreStatistics } from './cadre-statistics.js?v=20261005-branding-v1';
import { renderCadreProfile } from './cadre-profile.js?v=20261005-cadre-profile';
// Also support a cached document shell loading the newest static script.
if (!document.querySelector('#workspaceShell')) {
  const shell = document.createElement('div');
  shell.id = 'workspaceShell'; shell.className = 'workspace-shell';
  const navigation = document.createElement('aside');
  navigation.id = 'workspaceNavigation'; navigation.className = 'workspace-navigation'; navigation.hidden = true;
  app.before(shell); shell.append(navigation, app);
}
// When set, a function returning true means the current page has unsaved input;
// navigation via in-page links then asks before discarding it.
let leaveGuard = null;
// Retain the live public form across routes in this tab, without storing health
// or contact information in browser storage. Reload/close still uses its guard.
let publicReportDraft = null;
let cadreReportDraft = null;
let cadreActivePanel = 'summary';
let leaveDialogPending = false;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const W2_GUIDE_URL = branding.links?.w2Guide || null;
const UI_ICON_PATHS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  analytics: '<path d="M4 3v18h17M8 16v-5M13 16V7M18 16V4"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  incident: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M12 11v4M12 18h.01"/>',
  routine: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 9h18M8 15l2 2 5-5"/>',
  school: '<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-5h6v5M8 11h1M15 11h1"/>',
  status: '<path d="M6 3h8l4 4v5M14 3v5h5M11 21H6V3"/><circle cx="15" cy="16" r="3"/><path d="m17.4 18.4 2.1 2.1"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/>',
  warning: '<path d="M12 3 2.8 20h18.4z"/><path d="M12 9v4M12 17h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
const uiIcon = name => `<svg class="ui-icon ui-icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICON_PATHS[name] || UI_ICON_PATHS.info}</svg>`;
const STATUS_LABELS = {
  BARU: 'Menunggu ditinjau', DITERIMA: 'Diterima petugas', SEDANG_DIVERIFIKASI: 'Sedang diverifikasi',
  MEMERLUKAN_INFORMASI: 'Perlu informasi tambahan', TERVERIFIKASI: 'Terverifikasi',
  TERKAIT_EVENT: 'Dalam penanganan kejadian', DUPLIKAT: 'Laporan serupa', DITOLAK: 'Tidak ditindaklanjuti',
  SELESAI: 'Selesai', DIBATALKAN: 'Dibatalkan', DRAFT: 'Draf', SUBMITTED: 'Terkirim',
  PENDING: 'Menunggu keputusan', APPROVED: 'Disetujui', REJECTED: 'Tidak disetujui',
};
const labelStatus = value => STATUS_LABELS[value] || String(value || '').replaceAll('_', ' ');
const status = value => `<span class="status status-${esc(value)}">${esc(labelStatus(value))}</span>`;
const NOTIFICATION_LABELS = {
  NOT_REQUIRED: 'Tidak diperlukan', PENDING: 'Menunggu pengiriman', SENT: 'Terkirim',
  FAILED: 'Gagal dikirim', UNCONFIGURED: 'Belum dikonfigurasi', UNKNOWN: 'Riwayat tidak diketahui',
};
const notificationLabel = value => NOTIFICATION_LABELS[value] || labelStatus(value);
const notificationBadge = report => Number(report.immediate_notification)
  ? `<span class="status status-${esc(report.notification_status)}">Segera · ${esc(notificationLabel(report.notification_status))}</span>`
  : '';
const priority = value => `<span class="priority-pill priority-${esc(value)}">${esc(value || '—')}</span>`;
const alertBox = (type, text) => `<div class="${type} feedback" role="${type === 'error' ? 'alert' : 'status'}"><span class="feedback-icon" aria-hidden="true">${uiIcon(type)}</span><span class="feedback-copy">${esc(text)}</span></div>`;
const messageBox = id => `<div id="${id}" class="message" aria-live="polite"></div>`;
function actionDialog({ title, message, confirmLabel = 'Lanjutkan', cancelLabel = 'Batal', danger = false, inputLabel = '', inputValue = '', inputRequired = false, inputReadonly = false }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'account-dialog action-dialog';
    dialog.setAttribute('aria-labelledby', 'actionDialogTitle');
    dialog.setAttribute('aria-describedby', 'actionDialogMessage');
    const input = inputLabel
      ? `<div class="field"><label for="actionDialogInput">${esc(inputLabel)}</label><textarea id="actionDialogInput" rows="3" ${inputRequired ? 'required' : ''} ${inputReadonly ? 'readonly' : ''}>${esc(inputValue)}</textarea><p id="actionDialogError" class="step-error hidden" role="alert"></p></div>`
      : '';
    dialog.innerHTML = `<form method="dialog" aria-labelledby="actionDialogTitle" aria-describedby="actionDialogMessage"><h2 id="actionDialogTitle">${esc(title)}</h2><p id="actionDialogMessage">${esc(message)}</p>${input}<div class="form-actions"><button id="actionDialogConfirm" type="button" class="${danger ? 'danger' : ''}">${esc(confirmLabel)}</button><button id="actionDialogCancel" value="cancel" class="secondary">${esc(cancelLabel)}</button></div></form>`;
    document.body.append(dialog);
    const field = dialog.querySelector('#actionDialogInput');
    dialog.querySelector('#actionDialogConfirm').addEventListener('click', () => {
      if (inputRequired && !field.value.trim()) {
        const error = dialog.querySelector('#actionDialogError');
        error.textContent = `${inputLabel} wajib diisi.`;
        error.classList.remove('hidden');
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', error.id);
        field.focus();
        return;
      }
      dialog.close('confirm');
    });
    dialog.addEventListener('close', () => {
      const result = { confirmed: dialog.returnValue === 'confirm', value: field?.value.trim() || '' };
      dialog.remove();
      resolve(result);
    }, { once: true });
    dialog.showModal();
    (field || dialog.querySelector(danger ? '#actionDialogCancel' : '#actionDialogConfirm')).focus();
    if (inputReadonly) field.select();
  });
}
const confirmAction = async (title, message, confirmLabel = 'Lanjutkan', danger = false) =>
  (await actionDialog({ title, message, confirmLabel, danger })).confirmed;
const requestReason = async (title, message, label = 'Alasan') => {
  const result = await actionDialog({ title, message, confirmLabel: 'Simpan alasan', inputLabel: label, inputRequired: true });
  return result.confirmed ? result.value : null;
};

function bindSecretToggle(inputId, buttonId, noun = 'nilai') {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  button?.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Sembunyikan' : 'Tampilkan';
    button.setAttribute('aria-pressed', String(reveal));
    button.setAttribute('aria-label', `${reveal ? 'Sembunyikan' : 'Tampilkan'} ${noun}`);
    input.focus();
  });
}
const valueOrDash = value => value === null || value === undefined || value === '' ? '—' : esc(value);
const empty = (title, hint = '') => `<div class="empty" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13h4l2 3h6l2-3h4"/><path d="M5.5 6h13l2.5 7v5H3v-5z"/></svg><strong>${esc(title)}</strong>${hint ? `<span>${esc(hint)}</span>` : ''}</div>`;

function pageFailure(error, retry, back = '#staff-home') {
  app.innerHTML = `<section class="card page-failure"><span class="state-icon" aria-hidden="true">${uiIcon('incident')}</span><h1>Halaman belum dapat dimuat</h1><p>Periksa koneksi Anda, lalu coba lagi.</p>${alertBox('error', error.message)}<div class="actions"><button type="button" id="retryPage">Coba lagi</button><a class="button secondary" href="${back}">Kembali</a></div></section>`;
  document.querySelector('#retryPage').addEventListener('click', retry);
}

// Only authorized rows are present; paging changes presentation, never access.
function bindDirectory(inputSelector, rowSelector, feedbackId = '', pageSize = 12, noun = 'akun') {
  const input = document.querySelector(inputSelector);
  if (!input) return;
  const groups = [...new Set([...app.querySelectorAll(rowSelector)].map(row => row.closest('.table-wrap')))];
  const states = groups.map((group, index) => {
    const rows = [...group.querySelectorAll(rowSelector)];
    const pager = document.createElement('div');
    pager.className = 'directory-pager';
    pager.setAttribute('role', 'group');
    const title = group.closest('.admin-subsection')?.querySelector('h3')?.textContent || 'Daftar';
    pager.setAttribute('aria-label', `Halaman ${title}`);
    pager.innerHTML = `<span role="status"></span><div><button type="button" class="secondary" data-page-prev aria-label="Halaman sebelumnya ${esc(title)}">←</button><button type="button" class="secondary" data-page-next aria-label="Halaman berikutnya ${esc(title)}">→</button></div>`;
    group.after(pager);
    const state = { rows, pager, page: 0, matches: rows };
    const paint = () => {
      state.page = Math.min(state.page, Math.max(0, Math.ceil(state.matches.length / pageSize) - 1));
      const visible = new Set(state.matches.slice(state.page * pageSize, (state.page + 1) * pageSize));
      rows.forEach(row => { row.hidden = !visible.has(row); });
      pager.querySelector('span').textContent = state.matches.length ? `${state.page * pageSize + 1}–${Math.min((state.page + 1) * pageSize, state.matches.length)} dari ${state.matches.length}` : 'Tidak ada hasil';
      pager.querySelector('[data-page-prev]').disabled = state.page === 0;
      pager.querySelector('[data-page-next]').disabled = (state.page + 1) * pageSize >= state.matches.length;
      pager.querySelector('div').hidden = state.matches.length <= pageSize;
    };
    pager.querySelector('[data-page-prev]').addEventListener('click', () => { state.page--; paint(); input.focus({ preventScroll: true }); });
    pager.querySelector('[data-page-next]').addEventListener('click', () => { state.page++; paint(); input.focus({ preventScroll: true }); });
    state.paint = paint;
    return state;
  });
  let feedback = feedbackId && document.querySelector(`#${feedbackId}`);
  if (!feedback) {
    feedback = document.createElement('p'); feedback.className = 'help'; feedback.setAttribute('role', 'status');
    if (feedbackId) feedback.id = feedbackId;
    input.after(feedback);
  }
  const filter = () => {
    const query = input.value.trim().toLocaleLowerCase('id-ID');
    let total = 0;
    states.forEach(state => {
      state.matches = state.rows.filter(row => !query || row.dataset.search.includes(query));
      state.page = 0; total += state.matches.length; state.paint();
    });
    feedback.textContent = query ? total ? `${total} hasil sesuai pencarian.` : noun !== 'akun' ? `Tidak ada ${noun} sesuai pencarian. Coba nama atau kode.` : 'Tidak ada akun atau data sesuai pencarian. Coba nama, kode, desa, atau Posyandu lain.' : `${total} ${noun} ditemukan.`;
  };
  input.addEventListener('input', filter); filter();
}

function watchAdminForms() {
  const forms = [...app.querySelectorAll('form')];
  const signature = form => JSON.stringify([...new FormData(form)]);
  const baselines = new Map(forms.map(form => [form, signature(form)]));
  forms.forEach(form => form.addEventListener('reset', () => queueMicrotask(() => baselines.set(form, signature(form)))));
  leaveGuard = () => forms.some(form => form.isConnected && signature(form) !== baselines.get(form))
    || [...app.querySelectorAll('.indicatorIdentityPolicy')].some(field => field.value !== field.dataset.original)
    || [...app.querySelectorAll('.indicatorLabTracking')].some(field => Number(field.checked) !== Number(field.dataset.original));
  return { reset: form => baselines.set(form, signature(form)) };
}

function compactRowActions(selector) {
  app.querySelectorAll(selector).forEach(actions => {
    const details = document.createElement('details'); details.className = 'row-actions';
    const summary = document.createElement('summary'); summary.textContent = 'Tindakan';
    const name = actions.closest('tr')?.querySelector('td')?.textContent.trim();
    summary.setAttribute('aria-label', `Tindakan untuk ${name || 'akun'}`);
    actions.before(details); details.append(summary, actions);
  });
}
const storageRead = (storage, key) => { try { return storage.getItem(key) || ''; } catch { return ''; } };
const storageWrite = (storage, key, value) => { try { if (value) storage.setItem(key, value); else storage.removeItem(key); } catch {} };
const rememberedLoginKey = kind => `sbm.remembered-login.${kind}`;
let w2LoginAcknowledgementPending = false;
let accountLoginAcknowledgement = '';
const AUTH_RETURN_KEY = 'sbm.auth.return';
const AUTH_NOTICE_KEY = 'sbm.auth.notice';
const ACTIVE_ROLE_KEY = 'sbm.active-role';
const EXPIRED_LOGIN_KEY = 'sbm.expired-login';
let activeSession = null;
let sessionState = 'checking';
let sessionRequest = null;
const accountRole = me => me.kind === 'cadre' ? 'Kader' : me.kind === 'routine' ? me.source_type === 'SEKOLAH' ? 'Sekolah' : 'Faskes' : me.role === 'ADMIN' ? 'Admin' : 'Petugas';
const accountName = me => (me.kind === 'cadre' && me.nickname) || me.name || me.source_name || me.email || me.cadre_code || me.source_code;
const accountPortal = me => me.kind === 'cadre' ? '#cadre-home' : me.kind === 'routine' ? '#ibs-home' : '#staff-home';
const accountLogin = me => me.kind === 'cadre' ? '#cadre' : me.kind === 'routine' ? me.source_type === 'SEKOLAH' ? '#ibs-login-school' : '#ibs-login-w2' : '#staff';
function renderSessionNavigation() {
  let host = document.querySelector('#sessionNavigation');
  if (!host) {
    host = document.createElement('nav'); host.id = 'sessionNavigation'; host.className = 'session-navigation';
    document.querySelector('#themeToggle').before(host);
  }
  document.querySelector('.brand').href = '#home';
  host.setAttribute('role', 'navigation'); host.setAttribute('aria-label', 'Akun dan portal');
  host.hidden = sessionState === 'anonymous' && !authNotice();
  document.body.classList.toggle('has-session-navigation', Boolean(activeSession) || sessionState !== 'anonymous' || Boolean(authNotice()));
  if (sessionState === 'anonymous' && !authNotice()) { host.innerHTML = ''; updateHomeSession(); return; }
  const identity = activeSession ? `${accountRole(activeSession)} · ${accountName(activeSession)}` : sessionState === 'checking' ? 'Memeriksa akun' : sessionState === 'anonymous' ? 'Sesi berakhir' : 'Status akun';
  host.innerHTML = `${activeSession ? `<a class="session-portal-link" href="${accountPortal(activeSession)}">Portal saya</a>` : ''}<details class="session-account"><summary aria-label="${esc(activeSession ? `Masuk sebagai ${identity}` : identity)}">${uiIcon('users')}<span class="session-role">${esc(activeSession ? accountRole(activeSession) : 'Akun')}</span><span class="session-name">${esc(activeSession ? accountName(activeSession) : identity)}</span><span class="session-chevron" aria-hidden="true">⌄</span></summary><div class="session-account-panel">${activeSession ? `<p class="eyebrow">Masuk sebagai ${esc(accountRole(activeSession).toLowerCase())}</p><strong>${esc(accountName(activeSession))}</strong><a href="${accountPortal(activeSession)}">Ringkasan portal</a>${activeSession.kind === 'cadre' ? '<a href="#cadre-profile">Profil Saya</a>' : ''}<a href="#home">Beranda publik</a><a href="${accountLogin(activeSession)}">Ganti akun</a><details class="home-account-options"><summary>Jenis akun lain</summary><div><a href="#cadre" data-home-switch="cadre">Akun kader</a><a href="#ibs-login-w2" data-home-switch="facility">Akun faskes</a><a href="#ibs-login-school" data-home-switch="school">Akun sekolah</a><a href="#staff" data-home-switch="staff">Akun petugas</a></div></details><button type="button" class="secondary" id="sessionLogout">Keluar dari akun</button>` : ''}${sessionState === 'checking' ? '<p role="status">Memeriksa sesi Anda…</p>' : sessionState === 'unavailable' ? '<p role="status">Status masuk belum dapat diperiksa. Periksa koneksi lalu coba lagi.</p><button type="button" class="secondary" id="retrySession">Periksa akun lagi</button>' : ''}</div></details>`;
  host.querySelector('#sessionLogout')?.addEventListener('click', logout);
  if (sessionState === 'anonymous' && authNotice()) host.querySelector('.session-account-panel').innerHTML = `<p>${esc(authNotice())}</p><a href="${storageRead(sessionStorage, EXPIRED_LOGIN_KEY) || '#cadre'}">Masuk kembali</a>`;
  host.querySelector('#retrySession')?.addEventListener('click', refreshActiveSession);
  host.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { const details = host.querySelector('details'); if (details) details.open = false; }));
  host.onkeydown = event => { const details = host.querySelector('details'); if (event.key === 'Escape' && details?.open) { details.open = false; details.querySelector('summary').focus(); } };
  updateHomeSession();
}
function updateHomeSession() {
  const banner = document.querySelector('#homeSession');
  if (!banner) return;
  document.querySelector('#homePublicServices').hidden = Boolean(activeSession);
  document.querySelector('#homeSignedInServices').hidden = !activeSession;
  banner.classList.toggle('is-signed-in', Boolean(activeSession));
  banner.hidden = false;
  const portalLabel = activeSession?.kind === 'cadre' ? 'Buka ruang kerja kader' : activeSession?.kind === 'routine' ? activeSession.source_type === 'FASKES' ? 'Buka ruang kerja faskes' : 'Buka pelaporan sekolah' : 'Buka ruang kerja petugas';
  const introduction = activeSession?.kind === 'cadre' ? 'Lanjutkan pelaporan dan tindak lanjut di ruang kerja kader Anda.' : activeSession?.kind === 'routine' ? activeSession.source_type === 'FASKES' ? 'Lanjutkan laporan W2 mingguan dan lihat riwayat pengiriman faskes Anda.' : 'Lanjutkan laporan absensi sakit mingguan sekolah Anda.' : 'Tinjau laporan dan tindak lanjut yang membutuhkan perhatian Anda.';
  if (activeSession) banner.innerHTML = `<div class="home-welcome"><p class="eyebrow">Anda sudah masuk · ${esc(accountRole(activeSession))}</p><h1>Selamat datang kembali.</h1><p class="home-welcome-description">${introduction}</p><p class="home-session-label">${uiIcon('status')} Sesi aktif · Beranda publik ${esc(branding.shortName)}</p>${sessionState === 'unavailable' ? '<p class="home-session-notice" role="status">Status sesi belum dapat diperiksa ulang. Coba lagi melalui menu akun.</p>' : ''}</div><div class="home-workspace-entry"><p class="home-session-identity"><strong class="home-account-name">${esc(accountName(activeSession))}</strong><span class="home-role">${esc(accountRole(activeSession))}${activeSession.posyandu_name ? ` · Posyandu ${esc(activeSession.posyandu_name)}` : ''}</span></p><a class="button" href="${accountPortal(activeSession)}">${portalLabel} <span aria-hidden="true">→</span></a><p>Pelaporan dan tugas Anda tersedia di ruang kerja.</p></div>`;
  else if (sessionState === 'checking') banner.innerHTML = '<p role="status">Memeriksa status masuk Anda…</p>';
  else if (sessionState === 'unavailable') banner.innerHTML = '<p>Status masuk belum dapat diperiksa. Gunakan menu Akun untuk mencoba lagi.</p>';
  else if (authNotice()) {
    const returnPage = storageRead(sessionStorage, AUTH_RETURN_KEY);
    const login = storageRead(sessionStorage, EXPIRED_LOGIN_KEY) || (returnPage.startsWith('#cadre') ? '#cadre' : returnPage.startsWith('#ibs') ? '#ibs-login-w2' : '#staff');
    banner.innerHTML = `<div><strong>Sesi Anda telah berakhir</strong><p>Silakan masuk kembali untuk membuka portal Anda.</p></div><a class="button" href="${login}">Masuk kembali</a>`;
  } else { banner.hidden = true; banner.innerHTML = ''; }
  for (const [selector, kind, label, login, portal] of [['[data-home-account="cadre"]','cadre','kader','#cadre','#cadre-home'],['[data-home-account="facility"]','routine','faskes','#ibs-login-w2','#ibs-home']]) {
    const card = document.querySelector(selector);
    if (!card) continue;
    const same = activeSession?.kind === kind && (kind !== 'routine' || activeSession.source_type === 'FASKES');
    card.href = same ? portal : login;
    card.querySelector('strong').textContent = same ? 'Buka portal saya' : activeSession ? `Ganti akun ke ${label}` : label === 'kader' ? 'Kader' : 'Faskes jejaring';
    card.setAttribute('aria-label', same ? `Buka portal ${label} saya` : activeSession ? `Ganti akun dan masuk sebagai ${label}` : `Masuk sebagai ${label}`);
  }
}
async function refreshActiveSession() {
  if (sessionRequest) return sessionRequest;
  sessionRequest = (async () => {
    try {
      activeSession = await api('/api/me'); sessionState = 'authenticated';
      storageWrite(sessionStorage, ACTIVE_ROLE_KEY, `${activeSession.kind}:${activeSession.source_type || ''}`);
      storageWrite(sessionStorage, AUTH_NOTICE_KEY, '');
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        const previous = activeSession;
        const marker = storageRead(sessionStorage, ACTIVE_ROLE_KEY);
        activeSession = null; sessionState = 'anonymous';
        if (previous || marker) {
          storageWrite(sessionStorage, EXPIRED_LOGIN_KEY, previous ? accountLogin(previous) : marker.startsWith('cadre:') ? '#cadre' : marker.startsWith('routine:') ? marker.includes('SEKOLAH') ? '#ibs-login-school' : '#ibs-login-w2' : '#staff');
          storageWrite(sessionStorage, AUTH_NOTICE_KEY, 'Sesi Anda telah berakhir. Silakan masuk kembali.');
          if (!storageRead(sessionStorage, AUTH_RETURN_KEY)) storageWrite(sessionStorage, AUTH_RETURN_KEY, previous ? accountPortal(previous) : marker.startsWith('cadre:') ? '#cadre-home' : marker.startsWith('routine:') ? '#ibs-home' : '#staff-home');
        }
        storageWrite(sessionStorage, ACTIVE_ROLE_KEY, '');
      } else sessionState = 'unavailable';
    } finally { sessionRequest = null; renderSessionNavigation(); }
    return activeSession;
  })();
  return sessionRequest;
}
async function guardAccountEntry(kind, sourceType = '') {
  const entryPage = location.hash;
  await refreshActiveSession();
  if (location.hash !== entryPage) return true;
  if (sessionState === 'unavailable') {
    app.innerHTML = `<section class="card"><h1>Periksa sesi sebelum masuk</h1><p>Status akun belum dapat diperiksa. Sesi yang ada tidak akan diganti tanpa konfirmasi.</p><button type="button" id="retryAccountEntry">Coba lagi</button><a class="button secondary" href="#home">Kembali ke beranda</a></section>`;
    document.querySelector('#retryAccountEntry').addEventListener('click', () => route(true));
    return true;
  }
  if (!activeSession) return false;
  const target = location.hash || (kind === 'cadre' ? '#cadre' : kind === 'routine' ? sourceType === 'SEKOLAH' ? '#ibs-login-school' : '#ibs-login-w2' : '#staff');
  const label = kind === 'cadre' ? 'kader' : kind === 'routine' ? sourceType === 'SEKOLAH' ? 'sekolah' : 'faskes' : 'petugas';
  app.innerHTML = `<section class="card account-entry-guard"><p class="eyebrow">Sesi aktif</p><h1>Anda sudah masuk</h1><p>Anda masih masuk sebagai ${esc(accountRole(activeSession).toLowerCase())}: <strong>${esc(accountName(activeSession))}</strong>.</p><p>Untuk menggunakan akun ${label} lain, keluar dari akun ini terlebih dahulu. Membuka beranda tidak mengakhiri sesi Anda.</p><div class="actions"><a class="button" href="${accountPortal(activeSession)}">Buka portal saya</a><button type="button" class="secondary" id="confirmAccountSwitch">Keluar dan masuk sebagai ${label}</button><a class="button secondary" href="#home">Kembali ke beranda</a></div>${messageBox('accountSwitchMessage')}</section>`;
  document.querySelector('#confirmAccountSwitch').addEventListener('click', async event => {
    await completeLogout(event.currentTarget, '', target);
  });
  return true;
}
document.addEventListener('click', event => { const details = document.querySelector('.session-account'); if (details?.open && !details.contains(event.target)) details.open = false; });
const authNotice = () => storageRead(sessionStorage, AUTH_NOTICE_KEY);
function redirectForExpiredSession(kind, sourceType = 'FASKES') {
  activeSession = null; sessionState = 'anonymous'; storageWrite(sessionStorage, ACTIVE_ROLE_KEY, ''); renderSessionNavigation();
  storageWrite(sessionStorage, AUTH_RETURN_KEY, location.hash || '');
  storageWrite(sessionStorage, AUTH_NOTICE_KEY, 'Sesi Anda telah berakhir untuk menjaga keamanan akun. Silakan masuk kembali.');
  const destination = kind === 'staff' ? '#staff' : kind === 'cadre' ? '#cadre' : sourceType === 'SEKOLAH' ? '#ibs-login-school' : sourceType === 'FASKES' ? '#ibs-login-w2' : '#home';
  storageWrite(sessionStorage, EXPIRED_LOGIN_KEY, destination);
  if (location.hash === destination) render(); else location.hash = destination;
}
function destinationAfterLogin(fallback, allowedPrefixes) {
  const remembered = storageRead(sessionStorage, AUTH_RETURN_KEY);
  storageWrite(sessionStorage, AUTH_RETURN_KEY, '');
  storageWrite(sessionStorage, AUTH_NOTICE_KEY, '');
  return remembered && allowedPrefixes.some(prefix => remembered.startsWith(prefix)) ? remembered : fallback;
}
const loginAcknowledgement = () => accountLoginAcknowledgement
  ? `<div class="interaction-toast interaction-toast-success account-login-toast" role="status" aria-live="polite"><span aria-hidden="true">✓</span><div><strong>Berhasil masuk</strong><p>${esc(accountLoginAcknowledgement)}</p></div></div>`
  : '';
function dismissLoginAcknowledgement() {
  if (!accountLoginAcknowledgement) return;
  accountLoginAcknowledgement = '';
  const toast = document.querySelector('.account-login-toast');
  if (toast) setTimeout(() => { toast.classList.add('is-leaving'); setTimeout(() => toast.remove(), 220); }, 4200);
}
const passwordCommonParts = ['password', 'qwerty', 'admin123', 'administrator', 'letmein', 'welcome', '123456789', '11111111', 'puskesmas', 'indonesia', 'rahasia'];
const passwordGuidance = id => `<ul id="${id}" class="password-guidance" aria-live="polite"><li data-password-rule="length">15 karakter atau lebih</li><li data-password-rule="identity">Tidak memuat nama atau bagian email</li><li data-password-rule="common">Tidak memakai frasa umum atau pengulangan</li></ul>`;
function bindPasswordGuidance(input, target, identity = () => '') {
  if (!input || !target) return;
  const update = () => {
    const value = String(input.value || '');
    const normalized = value.toLocaleLowerCase('id-ID');
    const identityText = String(identity() || '').toLocaleLowerCase('id-ID');
    const parts = identityText.split(/[^a-z0-9]+/).filter(part => part.length >= 5);
    const states = {
      length: value.length >= 15,
      identity: !parts.some(part => normalized.includes(part)),
      common: value.length > 0 && !passwordCommonParts.some(part => normalized.includes(part)) && !/^(.)\1+$/.test(value),
    };
    target.querySelectorAll('[data-password-rule]').forEach(rule => {
      const valid = states[rule.dataset.passwordRule];
      rule.classList.toggle('valid', valid);
      rule.textContent = `${valid ? '✓' : '○'} ${rule.textContent.replace(/^[✓○]\s*/, '')}`;
    });
  };
  input.addEventListener('input', update);
  update();
}
const THEME_KEY = 'sbm.theme';
const THEME_MODES = ['system', 'light', 'dark'];
const THEME_LABELS = { system: 'Sistem', light: 'Terang', dark: 'Gelap' };
const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const themeIconPaths = {
  system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20.5 14.2A8 8 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>',
};
const currentThemePreference = () => THEME_MODES.includes(document.documentElement.dataset.themePreference)
  ? document.documentElement.dataset.themePreference
  : 'light';
function applyTheme(preference, persist = true) {
  const mode = THEME_MODES.includes(preference) ? preference : 'light';
  const resolved = mode === 'system' ? (themeMedia.matches ? 'dark' : 'light') : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = mode;
  if (persist) {
    storageWrite(localStorage, THEME_KEY, mode);
    document.cookie = `sbm_theme=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
  document.querySelector('#themeColor')?.setAttribute('content', resolved === 'dark' ? '#121519' : '#f5f6f8');
  const button = document.querySelector('#themeToggle');
  const label = document.querySelector('#themeLabel');
  const icon = document.querySelector('#themeIcon');
  const next = THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];
  if (label) label.textContent = THEME_LABELS[mode];
  if (icon) icon.innerHTML = themeIconPaths[mode];
  if (button) {
    button.dataset.mode = mode;
    button.title = `Tema ${THEME_LABELS[mode]}. Klik untuk beralih ke ${THEME_LABELS[next]}.`;
    button.setAttribute('aria-label', `Tema saat ini ${THEME_LABELS[mode]}. Beralih ke ${THEME_LABELS[next]}.`);
  }
}
function setupThemeToggle() {
  applyTheme(currentThemePreference(), false);
  document.querySelector('#themeToggle')?.addEventListener('click', () => {
    const current = currentThemePreference();
    applyTheme(THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length]);
  });
  themeMedia.addEventListener?.('change', () => {
    if (currentThemePreference() === 'system') applyTheme('system', false);
  });
}

function jakartaDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

let headerCalendarMonth = null;
let headerCalendarSelectedIso = '';

function calendarMonthForIso(iso) {
  const [year, month] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function renderHeaderCalendar() {
  const title = document.querySelector('#headerCalendarTitle');
  const grid = document.querySelector('#headerCalendarGrid');
  const selection = document.querySelector('#headerCalendarSelection');
  if (!title || !grid || !selection) return;
  const todayIso = jakartaDateIso();
  headerCalendarSelectedIso ||= todayIso;
  headerCalendarMonth ||= calendarMonthForIso(headerCalendarSelectedIso);
  const monthYear = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(headerCalendarMonth);
  title.textContent = monthYear;
  const first = new Date(headerCalendarMonth);
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const weekdays = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const weeks = Array.from({ length: 6 }, (_, weekIndex) => {
    const sunday = new Date(gridStart);
    sunday.setUTCDate(gridStart.getUTCDate() + weekIndex * 7);
    const period = epiWeekOf(sunday.toISOString().slice(0, 10));
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(sunday);
      date.setUTCDate(sunday.getUTCDate() + dayIndex);
      const iso = date.toISOString().slice(0, 10);
      const outside = date.getUTCMonth() !== headerCalendarMonth.getUTCMonth();
      const classes = ['calendar-day', outside ? 'is-outside' : '', iso === todayIso ? 'is-today' : '', iso === headerCalendarSelectedIso ? 'is-selected' : ''].filter(Boolean).join(' ');
      const fullDate = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeZone: 'UTC' }).format(date);
      return `<span role="gridcell"><button type="button" class="${classes}" data-calendar-date="${iso}" aria-label="${esc(fullDate)}, Minggu Epidemiologi ${period.week}" aria-pressed="${iso === headerCalendarSelectedIso}" ${iso === todayIso ? 'aria-current="date"' : ''}>${date.getUTCDate()}</button></span>`;
    }).join('');
    return `<div class="calendar-week" role="row"><span class="calendar-week-number" role="rowheader" aria-label="Minggu Epidemiologi ${period.week}">ME ${period.week}</span>${days}</div>`;
  }).join('');
  grid.innerHTML = `<div class="calendar-weekdays" role="row"><span role="columnheader">ME</span>${weekdays.map(day => `<span role="columnheader">${day}</span>`).join('')}</div>${weeks}`;
  const selectedDate = new Date(`${headerCalendarSelectedIso}T00:00:00Z`);
  const selectedPeriod = epiWeekOf(headerCalendarSelectedIso);
  selection.textContent = `${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' }).format(selectedDate)} · ME ${selectedPeriod.week} · ${selectedPeriod.year}`;
}

function setupHeaderCalendar() {
  const calendar = document.querySelector('.header-calendar');
  const trigger = document.querySelector('#headerCalendarButton');
  const popover = document.querySelector('#headerCalendarPopover');
  if (!calendar || !trigger || !popover) return;
  const close = (restoreFocus = false) => {
    if (popover.hidden) return;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (document.body.classList.contains('has-workspace-navigation') && matchMedia('(max-width: 1000px)').matches ? document.querySelector('.portal-date') || trigger : trigger).focus({ preventScroll: true });
  };
  const open = () => {
    const todayIso = jakartaDateIso();
    headerCalendarSelectedIso ||= todayIso;
    headerCalendarMonth ||= calendarMonthForIso(headerCalendarSelectedIso);
    renderHeaderCalendar();
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    popover.focus({ preventScroll: true });
  };
  trigger.addEventListener('click', () => (popover.hidden ? open() : close(true)));
  popover.addEventListener('click', event => {
    const nav = event.target.closest('[data-calendar-nav]');
    if (nav) {
      headerCalendarMonth = new Date(Date.UTC(headerCalendarMonth.getUTCFullYear(), headerCalendarMonth.getUTCMonth() + Number(nav.dataset.calendarNav), 1));
      renderHeaderCalendar();
      return;
    }
    const day = event.target.closest('[data-calendar-date]');
    if (day) {
      headerCalendarSelectedIso = day.dataset.calendarDate;
      headerCalendarMonth = calendarMonthForIso(headerCalendarSelectedIso);
      renderHeaderCalendar();
      return;
    }
    if (event.target.closest('#headerCalendarToday')) {
      headerCalendarSelectedIso = jakartaDateIso();
      headerCalendarMonth = calendarMonthForIso(headerCalendarSelectedIso);
      renderHeaderCalendar();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!popover.hidden && !calendar.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !popover.hidden) close(true);
  });
}

function updateHeaderClock() {
  const current = new Date();
  const dateNode = document.querySelector('#headerDate');
  const weekNode = document.querySelector('#headerEpiWeek');
  const timeNode = document.querySelector('#headerTime');
  const calendarButton = document.querySelector('#headerCalendarButton');
  const dateText = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(current);
  const timeText = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(current).replaceAll('.', ':');
  const period = epiPeriod();
  if (dateNode) dateNode.textContent = dateText;
  if (weekNode) weekNode.textContent = `Saat ini · ME ${period.week} · ${period.year}`;
  if (calendarButton) calendarButton.setAttribute('aria-label', `Buka kalender epidemiologi. ${dateText}, Minggu Epidemiologi ${period.week}, ${period.year}.`);
  if (timeNode) { timeNode.textContent = `${timeText} WIB`; timeNode.dateTime = current.toISOString(); }
}
updateHeaderClock();
setInterval(updateHeaderClock, 1000);
const reporterLoginKey = rememberedLoginKey('reporter');
const rememberedReporter = () => {
  try {
    const saved = JSON.parse(storageRead(localStorage, reporterLoginKey) || 'null');
    if (saved?.identifier) return saved;
  } catch {}
  const legacyCadre = storageRead(localStorage, rememberedLoginKey('cadre'));
  if (legacyCadre) return { identifier: legacyCadre, label: legacyCadre, kind: 'cadre' };
  for (const kind of ['faskes', 'sekolah']) {
    const identifier = storageRead(localStorage, rememberedLoginKey(`ibs-${kind}`));
    if (identifier) return { identifier, label: identifier, kind: 'routine' };
  }
  return null;
};
let lastSubmittedReport = null;
const lastPublicReport = () => lastSubmittedReport;
const saveLastPublicReport = value => { lastSubmittedReport = value; };
let leafletPromise = null;

function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('#leafletStyles')) {
      const styles = document.createElement('link');
      styles.id = 'leafletStyles';
      styles.rel = 'stylesheet';
      styles.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      styles.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      styles.crossOrigin = '';
      document.head.append(styles);
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    script.onload = () => resolve(window.L);
    script.onerror = () => { leafletPromise = null; reject(new Error('Peta belum dapat dimuat.')); };
    document.head.append(script);
  });
  return leafletPromise;
}
const REPORT_STATUSES = ['BARU', 'DITERIMA', 'SEDANG_DIVERIFIKASI', 'MEMERLUKAN_INFORMASI', 'TERVERIFIKASI', 'TERKAIT_EVENT', 'DUPLIKAT', 'DITOLAK', 'SELESAI'];
// Plain-language meaning of each report status for the public status checker,
// so citizens aren't shown raw internal codes.
const PUBLIC_STATUS_LABELS = {
  BARU: 'Laporan sudah kami terima dan menunggu ditinjau petugas.',
  DITERIMA: 'Petugas sudah menerima laporan Anda.',
  SEDANG_DIVERIFIKASI: 'Petugas sedang memverifikasi laporan Anda.',
  MEMERLUKAN_INFORMASI: 'Petugas memerlukan informasi tambahan. Anda mungkin akan dihubungi.',
  TERVERIFIKASI: 'Laporan telah diverifikasi petugas.',
  TERKAIT_EVENT: 'Laporan Anda menjadi bagian dari penanganan kejadian.',
  DUPLIKAT: 'Laporan serupa sudah tercatat sebelumnya.',
  DITOLAK: 'Laporan tidak dapat ditindaklanjuti.',
  SELESAI: 'Penanganan laporan ini telah selesai.',
};
// Local calendar date (device timezone) for capping "start date" pickers.
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDate = value => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? esc(value) : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: String(value).includes('T') ? 'short' : undefined }).format(parsed);
};

const AFFECTED_GROUP_OPTIONS = [
  { code: 'NEWBORN', label: 'Bayi baru lahir (0–28 hari)' },
  { code: 'UNDER_FIVE', label: 'Bayi atau balita' },
  { code: 'SCHOOL_AGE', label: 'Anak usia sekolah' },
  { code: 'ADULT', label: 'Dewasa' },
  { code: 'OLDER_ADULT', label: 'Lansia' },
  { code: 'MIXED', label: 'Beragam kelompok usia' },
  { code: 'UNKNOWN', label: 'Belum diketahui' },
  { code: 'ANIMAL', label: 'Hewan atau unggas' },
];
const affectedGroupOptions = (includeAnimals = false) => selectOptions(
  AFFECTED_GROUP_OPTIONS.filter(item => includeAnimals || item.code !== 'ANIMAL'),
  'code',
  'label',
  'Pilih kelompok…'
);
const affectedGroupLabel = value => AFFECTED_GROUP_OPTIONS.find(item => item.code === value)?.label || valueOrDash(value);

async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  }); } catch {
    throw new Error(options.method && options.method !== 'GET'
      ? 'Koneksi terputus. Belum ada konfirmasi penyimpanan. Isian tetap di halaman ini; periksa riwayat atau status sebelum mengirim ulang.'
      : 'Data belum dapat dimuat. Periksa koneksi internet lalu coba lagi.');
  }
  const data = await response.json().catch(() => ({ error: 'Respons server tidak valid.' }));
  if (!response.ok) {
    const error = new Error(data.error || 'Permintaan gagal. Silakan coba lagi.');
    error.status = response.status;
    error.id = data.error_id || '';
    error.code = data.code || '';
    throw error;
  }
  return data;
}

function selectOptions(items, valueKey, labelKey, placeholder = 'Pilih…') {
  return `<option value="">${esc(placeholder)}</option>${items.map(item => `<option value="${esc(item[valueKey])}">${esc(item[labelKey])}</option>`).join('')}`;
}

function eventIcon(key) {
  const paths = {
    person: '<circle cx="12" cy="7" r="3"/><path d="M6 20c.5-5 2.5-7 6-7s5.5 2 6 7"/>',
    cluster: '<circle cx="8" cy="8" r="2.5"/><circle cx="16" cy="8" r="2.5"/><path d="M3 19c.4-4 2-6 5-6s4.6 2 5 6M11 19c.4-4 2-6 5-6s4.6 2 5 6"/>',
    food: '<path d="M4 13h16c-.4 4.4-3 7-8 7s-7.6-2.6-8-7ZM7 4c-1 1-.9 2.1.2 3.2M12 3c-1.2 1.3-1.1 2.6.2 4M17 4c-1 1-.9 2.1.2 3.2"/>',
    death: '<path d="M5 21h14M7 21V8l5-5 5 5v13M9 11h6M12 8v6"/>',
    'animal-exposure': '<path d="M5 14c-2-2-1-5 1-6 2-1 3 1 3 3 1-3 5-3 6 0 0-2 2-4 4-3 3 2 2 6-1 7-3 1-4 4-6 4s-3-3-6-4Z"/>',
    'animal-event': '<path d="M4 15c0-4 3-7 8-7 4 0 7 2 8 5M7 8 5 4l5 3M16 8l3-3M8 15v5M17 14v6M4 15h16"/>',
    'animal-human': '<circle cx="7" cy="6.5" r="2.5"/><path d="M2.5 19c.4-4 1.8-6 4.5-6s4.1 2 4.5 6M15.5 9.5c-1.8-1.4-.8-4 1.1-3.2.8-2.2 3.7-1.3 3.2.8 2.2.2 2.3 3.2.2 3.5-1.3 2.2-3.7 1.7-4.5-.2Z"/>',
    environment: '<path d="M12 3v18M12 8c-4 0-7-2-8-5 4 0 7 2 8 5ZM12 13c4 0 7-2 8-5-4 0-7 2-8 5ZM7 21h10"/>',
    school: '<path d="m3 10 9-6 9 6M5 10v10h14V10M3 20h18M9 20v-6h6v6"/>',
    other: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.2 2.1c-.7.4-1 1-1 1.9M12 17h.01"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] || paths.other}</svg>`;
}

// Keep the first view approachable while preserving access to every EBS
// observation/context through the "show all" controls.
const EVENT_FORM_CONFIG = {
  PERSON_ILLNESS: {
    observations: ['FEVER', 'BREATHING_DIFFICULTY', 'RASH_LESION', 'JAUNDICE', 'NEUROLOGIC', 'SUDDEN_PARALYSIS', 'BLEEDING', 'OTHER_OBSERVATION'],
    contexts: ['SHARED_FOOD', 'FLOOD_SEWER', 'ANIMAL_BITE', 'TRAVEL_CONTACT', 'CHEMICAL_EXPOSURE'],
    casesLabel: 'Perkiraan orang terdampak', casesMin: 1,
  },
  CLUSTER: {
    observations: ['FEVER', 'DIARRHEA', 'BLOODY_DIARRHEA', 'VOMITING', 'COUGH_COLD', 'BREATHING_DIFFICULTY', 'RASH_LESION', 'OTHER_OBSERVATION'],
    contexts: ['SHARED_FOOD', 'SHARED_WATER', 'SCHOOL_WORKPLACE_CLUSTER', 'TRAVEL_CONTACT'],
    casesLabel: 'Perkiraan orang terdampak', casesMin: 2,
  },
  UNUSUAL_DEATH: {
    observations: ['FEVER', 'DIARRHEA', 'BREATHING_DIFFICULTY', 'RASH_LESION', 'JAUNDICE', 'RENAL_PROBLEM', 'NEUROLOGIC', 'BLEEDING', 'OTHER_OBSERVATION'],
    contexts: ['SHARED_FOOD', 'SHARED_WATER', 'FLOOD_SEWER', 'ANIMAL_BITE', 'SICK_DEAD_POULTRY', 'SICK_DEAD_ANIMALS', 'RODENT_CONTACT', 'TRAVEL_CONTACT', 'CHEMICAL_EXPOSURE', 'UNKNOWN_CONTEXT'],
    casesLabel: 'Perkiraan orang terdampak', casesMin: 1, deathsMin: 1,
  },
  ANIMAL_EXPOSURE: {
    observations: ['FEVER', 'RASH_LESION', 'NEUROLOGIC', 'OTHER_OBSERVATION'],
    contexts: ['ANIMAL_BITE', 'SNAKE_BITE', 'SICK_DEAD_ANIMAL_CONTACT'],
    casesLabel: 'Perkiraan orang yang tergigit/terpapar', casesMin: 1,
    contextsRequired: true,
  },
  ANIMAL_EVENT: {
    observations: [],
    contexts: ['SICK_DEAD_POULTRY', 'SICK_DEAD_ANIMALS', 'UNKNOWN_CONTEXT'],
    casesLabel: 'Perkiraan hewan/unggas terdampak', casesMin: 1,
    hideHumanOutcomes: true, contextsRequired: true,
  },
  ENVIRONMENTAL: {
    observations: ['FEVER', 'DIARRHEA', 'VOMITING', 'BREATHING_DIFFICULTY', 'RASH_LESION', 'HEADACHE_MYALGIA', 'OTHER_OBSERVATION'],
    contexts: ['SHARED_WATER', 'FLOOD_SEWER', 'CHEMICAL_EXPOSURE'],
    casesLabel: 'Perkiraan orang terdampak', casesMin: 0,
  },
  SCHOOL_WORKPLACE: {
    observations: ['FEVER', 'DIARRHEA', 'VOMITING', 'COUGH_COLD', 'BREATHING_DIFFICULTY', 'RASH_LESION', 'RED_EYES', 'OTHER_OBSERVATION'],
    contexts: ['SHARED_FOOD', 'SHARED_WATER', 'SCHOOL_WORKPLACE_CLUSTER'],
    casesLabel: 'Perkiraan jumlah orang yang tidak masuk karena sakit', casesMin: 2,
    hideHumanOutcomes: true,
  },
  OTHER: {
    observations: null,
    contexts: null,
    casesLabel: 'Perkiraan orang terdampak', casesMin: 0,
  },
};

const CADRE_SIGNAL_EVENT_MAP = {
  PERSON_ILLNESS: 'PERSON_ILLNESS',
  FOOD: 'CLUSTER',
  CLUSTER: 'CLUSTER',
  DEATH: 'UNUSUAL_DEATH',
  SCHOOL: 'SCHOOL_WORKPLACE',
  ENV: 'ENVIRONMENTAL',
  ZOONOSIS: 'ANIMAL_EVENT',
  ZOONOSIS_HUMAN: 'PERSON_ILLNESS',
  ANIMAL_EXPOSURE: 'ANIMAL_EXPOSURE',
  OTHER: 'OTHER',
};

// Keep operational signal codes intact while giving cadre reporters shorter,
// more scannable language and a distinct visual cue for each choice.
const CADRE_SIGNAL_PRESENTATION = {
  PERSON_ILLNESS: { label: 'Seseorang sakit dengan tanda tidak biasa', help: 'Tanda kesehatan yang berat, mendadak, atau tidak biasa pada satu orang.', icon: 'person' },
  FOOD: { label: 'Keluhan setelah makan bersama', help: 'Beberapa orang muntah atau diare setelah menyantap makanan yang sama.', icon: 'food' },
  CLUSTER: { label: 'Keluhan berkelompok', help: 'Beberapa orang mengalami keluhan serupa dalam waktu berdekatan di tempat yang sama atau berdekatan.', icon: 'cluster' },
  DEATH: { label: 'Kematian tidak biasa', help: 'Kematian mendadak atau tidak wajar yang perlu segera dilaporkan.', icon: 'death' },
  SCHOOL: { label: 'Absensi sakit meningkat', help: 'Banyak siswa atau pekerja tidak hadir dengan keluhan serupa.', icon: 'school' },
  ENV: { label: 'Paparan lingkungan', help: 'Risiko dari air, udara, limbah, atau bahan kimia.', icon: 'environment' },
  ZOONOSIS: { label: 'Hewan/unggas sakit atau mati', help: 'Kejadian mendadak atau tidak biasa pada hewan atau unggas.', icon: 'animal-event' },
  ZOONOSIS_HUMAN: { label: 'Sakit setelah kontak hewan', help: 'Seseorang sakit setelah kontak dengan hewan atau unggas sakit/mati.', icon: 'animal-human' },
  ANIMAL_EXPOSURE: { label: 'Gigitan atau pajanan hewan', help: 'Gigitan, cakaran, liur, gigitan ular, atau kontak langsung dengan hewan sakit/mati.', icon: 'animal-exposure' },
  OTHER: { label: 'Kejadian lainnya', help: 'Pilih jika kejadian tidak sesuai dengan pilihan di atas.', icon: 'other' },
};

function cadreSignalPresentation(signal) {
  return CADRE_SIGNAL_PRESENTATION[signal.signal_code] || {
    label: signal.cadre_definition,
    help: signal.community_definition,
    icon: 'other',
  };
}

const CADRE_SIGNAL_DEFAULT_CONTEXT = {
  FOOD: 'SHARED_FOOD',
  SCHOOL: 'SCHOOL_WORKPLACE_CLUSTER',
  ZOONOSIS_HUMAN: 'SICK_DEAD_ANIMAL_CONTACT',
};

const CADRE_SIGNAL_FORM_CONFIG = {
  FOOD: {
    ...EVENT_FORM_CONFIG.CLUSTER,
    observations: ['DIARRHEA', 'BLOODY_DIARRHEA', 'VOMITING', 'FEVER', 'OTHER_OBSERVATION'],
    contexts: ['SHARED_FOOD', 'SHARED_WATER'],
  },
  DEATH: {
    ...EVENT_FORM_CONFIG.UNUSUAL_DEATH,
    observations: ['FEVER', 'BREATHING_DIFFICULTY', 'NEUROLOGIC', 'BLEEDING', 'OTHER_OBSERVATION'],
    contexts: ['SHARED_FOOD', 'ANIMAL_BITE', 'SICK_DEAD_POULTRY', 'SICK_DEAD_ANIMALS', 'CHEMICAL_EXPOSURE', 'UNKNOWN_CONTEXT'],
  },
  SCHOOL: {
    ...EVENT_FORM_CONFIG.SCHOOL_WORKPLACE,
    observations: ['FEVER', 'DIARRHEA', 'COUGH_COLD', 'RASH_LESION', 'RED_EYES', 'OTHER_OBSERVATION'],
  },
  ZOONOSIS_HUMAN: {
    ...EVENT_FORM_CONFIG.PERSON_ILLNESS,
    observations: ['FEVER', 'BREATHING_DIFFICULTY', 'RASH_LESION', 'NEUROLOGIC', 'JAUNDICE', 'OTHER_OBSERVATION'],
    contexts: ['SICK_DEAD_ANIMAL_CONTACT', 'SICK_DEAD_POULTRY', 'SICK_DEAD_ANIMALS', 'ANIMAL_BITE', 'RODENT_CONTACT', 'UNKNOWN_CONTEXT'],
    casesLabel: 'Perkiraan orang yang sakit atau terpapar',
  },
  OTHER: {
    ...EVENT_FORM_CONFIG.OTHER,
    observations: ['FEVER', 'DIARRHEA', 'COUGH_COLD', 'BREATHING_DIFFICULTY', 'RASH_LESION', 'NEUROLOGIC', 'OTHER_OBSERVATION'],
    contexts: ['SHARED_FOOD', 'SHARED_WATER', 'FLOOD_SEWER', 'ANIMAL_BITE', 'TRAVEL_CONTACT', 'UNKNOWN_CONTEXT'],
  },
};

// Master data (signals/villages) rarely changes; cache it for the session so
// navigating between pages doesn't refetch on every render.
let mastersCache = null;
async function getMasters() {
  if (!mastersCache) mastersCache = await api('/api/public/masters');
  return mastersCache;
}

function setBusy(button, busy, text = 'Memproses…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = text;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function submitForm(event, action, busyText = 'Menyimpan…') {
  event.preventDefault();
  const button = event.submitter || event.currentTarget.querySelector('button[type="submit"], button:not([type])');
  setBusy(button, true, busyText);
  try { await action(); } finally { setBusy(button, false); }
}

async function deleteWithReason(button, label, endpoint) {
  const reason = await requestReason(`Hapus permanen ${label}?`, 'Tindakan ini tidak dapat dibatalkan.', 'Alasan penghapusan');
  if (reason === null) return false;
  setBusy(button, true, 'Menghapus…');
  try {
    await api(endpoint, { method: 'DELETE', body: JSON.stringify({ reason: String(reason).trim() }) });
    return true;
  } finally { setBusy(button, false); }
}

function focusMessage(id) {
  const element = document.querySelector(`#${id}`);
  if (element?.textContent) {
    element.tabIndex = -1;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function setupTabKeyboard(selector) {
  const tabs = [...document.querySelectorAll(selector)];
  tabs.forEach(tab => {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (!panel) return;
    if (!tab.id) tab.id = `${panel.id}-tab`;
    panel.setAttribute('aria-labelledby', tab.id);
  });
  const sync = () => tabs.forEach(tab => { tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1; });
  sync();
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', sync);
    tab.addEventListener('keydown', event => {
      let nextIndex = null;
      if (['ArrowRight', 'ArrowDown'].includes(event.key)) nextIndex = (index + 1) % tabs.length;
      if (['ArrowLeft', 'ArrowUp'].includes(event.key)) nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      tabs[nextIndex].click();
      tabs[nextIndex].focus();
    });
  });
}

function setupMapPicker({ buttonId, panelId, mapId, latitudeId, longitudeId, messageId, geolocateId, closeId }) {
  const button = document.querySelector(`#${buttonId}`);
  const panel = document.querySelector(`#${panelId}`);
  const latitude = document.querySelector(`#${latitudeId}`);
  const longitude = document.querySelector(`#${longitudeId}`);
  const message = document.querySelector(`#${messageId}`);
  const geolocate = geolocateId ? document.querySelector(`#${geolocateId}`) : null;
  const close = closeId ? document.querySelector(`#${closeId}`) : null;
  let map;
  let marker;
  let tileLayer;
  let tilesReady = false;
  const mapUnavailableMessage = 'Peta tidak dapat ditampilkan saat ini. Isi lokasi kejadian secara tertulis, atau gunakan lokasi perangkat jika tersedia.';

  const coordinates = () => {
    if (!latitude.value || !longitude.value) return branding.map.center;
    const lat = Number(latitude.value);
    const lng = Number(longitude.value);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : branding.map.center;
  };
  const setCoords = ([lat, lng]) => {
    latitude.value = lat.toFixed(6);
    longitude.value = lng.toFixed(6);
    latitude.dispatchEvent(new Event('input', { bubbles: true }));
    longitude.dispatchEvent(new Event('input', { bubbles: true }));
    if (!map) return;
    if (marker) marker.setLatLng([lat, lng]);
    else marker = L.marker([lat, lng]).addTo(map);
  };
  const openMap = async () => {
    panel.classList.remove('hidden');
    try { await ensureLeaflet(); }
    catch {
      message.innerHTML = alertBox('error', 'Peta belum dapat dimuat. Periksa koneksi internet lalu coba lagi.');
      return false;
    }
    if (!map) {
      map = L.map(mapId).setView(coordinates(), branding.map.zoom);
      tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
      });
      tileLayer.on('loading', () => { tilesReady = false; });
      tileLayer.on('tileload', () => {
        tilesReady = true;
        if (message.textContent?.includes(mapUnavailableMessage)) message.innerHTML = '';
      });
      tileLayer.on('load', () => {
        if (!tilesReady) message.innerHTML = alertBox('error', mapUnavailableMessage);
      });
      tileLayer.addTo(map);
      if (latitude.value && longitude.value) setCoords(coordinates());
      map.on('click', event => {
        if (!tilesReady) {
          message.innerHTML = alertBox('error', mapUnavailableMessage);
          return;
        }
        setCoords([event.latlng.lat, event.latlng.lng]);
      });
    } else if (!tilesReady) tileLayer.redraw();
    requestAnimationFrame(() => map.invalidateSize());
    return true;
  };

  button?.addEventListener('click', () => openMap());
  close?.addEventListener('click', () => panel.classList.add('hidden'));
  geolocate?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      openMap();
      message.innerHTML = alertBox('error', 'Perangkat tidak mendukung deteksi lokasi. Silakan pilih lokasi di peta.');
      return;
    }
    setBusy(geolocate, true, 'Mencari lokasi…');
    navigator.geolocation.getCurrentPosition(
      async position => {
        setBusy(geolocate, false);
        const point = [position.coords.latitude, position.coords.longitude];
        if (await openMap()) {
          setCoords(point);
          map.setView(point, 16);
          message.innerHTML = alertBox('success', 'Lokasi Anda terisi. Geser atau ketuk peta bila belum tepat.');
        } else {
          latitude.value = point[0].toFixed(6);
          longitude.value = point[1].toFixed(6);
        }
      },
      async () => {
        setBusy(geolocate, false);
        await openMap();
        message.innerHTML = alertBox('error', 'Tidak dapat mengambil lokasi. Izinkan akses lokasi di peramban, atau pilih lokasi di peta.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

function updateNavigation(page) {
  const route = page.slice(1);
  const section = route.startsWith('ibs') ? 'ibs' : route.startsWith('cadre') ? 'cadre' : route.startsWith('staff') ? 'staff' : route.startsWith('home') ? 'home' : 'public';
  document.querySelectorAll('nav a[data-route]').forEach(link => {
    if (link.dataset.route === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function defaultPage() {
  return '#home';
}

function homePage() {
  app.innerHTML = `
    <div class="landing-page">
    <section id="homeSession" class="card home-session" aria-label="Status masuk" hidden></section>
    <section id="homePublicServices" class="landing-actions" aria-labelledby="landingActionTitle">
      <div class="landing-hero">
      <div class="landing-action-copy">
        <p class="eyebrow">Surveilans kesehatan · ${esc(branding.institution)}</p>
        <h1 id="landingActionTitle">Kejadian kesehatan?<br>Laporkan sejak dini.</h1>
        <p>Bantu petugas mengenali dan menindaklanjuti kejadian kesehatan di lingkungan Anda.</p>
        <p class="landing-trust">${uiIcon('status')} Bisa anonim · Nama pasien tidak diperlukan</p>
      </div>
      <div class="landing-service-grid" aria-label="Pilih layanan pelaporan">
        <h2>Sampaikan kejadian di sekitar Anda</h2><p>Gunakan formulir singkat untuk mengirim informasi awal.</p>
        <a class="landing-service-card landing-primary-action" href="#public">
          <span>Laporkan kejadian</span><span aria-hidden="true">→</span>
        </a>
        <a class="landing-status-action button secondary" href="#status">${uiIcon('status')} Cek status laporan</a>
      </div>
      </div>
      <div class="landing-entry-links"><span>Akses pelapor terdaftar</span><a href="#cadre" data-home-account="cadre"><strong>Kader</strong><span aria-hidden="true">↗</span></a><a href="#ibs-login-w2" data-home-account="facility"><strong>Faskes jejaring</strong><span aria-hidden="true">↗</span></a></div>
      <p class="home-emergency-note">Untuk keadaan darurat yang membutuhkan pertolongan segera, ${contactLink('emergency', `hubungi ${branding.contacts.emergency?.label || 'layanan darurat'} ↗`, 'hubungi layanan darurat setempat atau datangi fasilitas kesehatan terdekat')}</p>
    </section>
    <section id="homeSignedInServices" class="home-secondary-services" aria-labelledby="homeServicesTitle" hidden>
      <div class="home-services-heading"><h2 id="homeServicesTitle">Layanan warga</h2><p>Untuk kejadian di lingkungan masyarakat.</p></div>
      <div class="home-public-links"><a href="#public">${uiIcon('incident')}<span><strong>Laporkan kejadian</strong><small>Laporan warga dapat dikirim anonim.</small></span><span aria-hidden="true">→</span></a><a href="#status">${uiIcon('status')}<span><strong>Cek status laporan</strong><small>Gunakan nomor laporan dan PIN.</small></span><span aria-hidden="true">→</span></a></div>
      <p class="home-public-privacy">Laporan warga dapat anonim dan nama pasien tidak diperlukan.</p>
      <p class="home-emergency-note">Keadaan darurat membutuhkan respons segera. ${contactLink('emergency', `Hubungi ${branding.contacts.emergency?.label || 'layanan darurat'} ↗`, 'hubungi layanan darurat setempat atau datangi fasilitas kesehatan terdekat')}</p>
    </section>
    <section class="home-disease-teaser" aria-labelledby="homeDiseaseTitle">
      <a class="home-disease-link" href="#situation"><div><span class="eyebrow">Informasi wilayah</span><h2 id="homeDiseaseTitle">Lihat situasi penyakit terbaru</h2><p>Ringkasan mingguan, tren, dan laporan menurut desa.</p><small id="homeDiseaseUpdate" role="status">Memuat tanggal pembaruan…</small></div><span class="home-disease-arrow" aria-hidden="true">→</span></a>
    </section>

    </div>`;
  loadDiseaseTeaser();
  updateHomeSession();
}

function faqPage() {
  app.innerHTML = `
    <section id="homeFaq" class="home-faq faq-page" aria-labelledby="homeFaqTitle">
      <div class="home-faq-heading public-page-heading">
        <p class="eyebrow">Bantuan menggunakan layanan</p>
        <h1 id="homeFaqTitle" tabindex="-1">Pertanyaan yang sering diajukan</h1>
        <p>Temukan jawaban tentang pelaporan kejadian dan akses layanan.</p>

      </div>
      <div class="home-faq-list">
        <details class="home-faq-item"><summary>Apa itu ${esc(branding.displayName)}?</summary><p>${esc(branding.displayName)} membantu ${esc(branding.institution)} menerima laporan kejadian kesehatan, memantau situasi penyakit, dan mengelola pelaporan rutin jejaring.</p></details>
        <details class="home-faq-item"><summary>Siapa yang dapat menggunakan layanan ini?</summary><p>Masyarakat dapat melaporkan kejadian tanpa akun. Kader, fasilitas kesehatan, sekolah, dan petugas menggunakan akses sesuai perannya.</p></details>
        <details class="home-faq-item"><summary>Kejadian apa yang dapat saya laporkan?</summary><p>Laporkan kejadian kesehatan yang mengkhawatirkan di lingkungan Anda. Pilih jenis kejadian yang tersedia pada <a href="#public">formulir laporan</a> dan ceritakan apa yang Anda ketahui.</p></details>
        <details class="home-faq-item"><summary>Apakah saya harus mengetahui diagnosis penyakitnya?</summary><p>Tidak. Anda dapat melaporkan gejala atau kejadian yang diketahui tanpa menentukan diagnosis.</p></details>
        <details class="home-faq-item"><summary>Apakah saya bisa melapor secara anonim?</summary><p>Ya. Laporan warga dapat dikirim secara anonim, dan nama pasien tidak diperlukan. Hindari mencantumkan nama pasien dalam uraian kejadian.</p></details>
        <details class="home-faq-item"><summary>Informasi apa yang perlu saya siapkan?</summary><p>Siapkan lokasi, waktu kejadian, uraian singkat, serta jumlah orang sakit atau meninggal jika diketahui. Isi sesuai informasi yang Anda miliki dan ikuti petunjuk pada formulir.</p></details>
        <details class="home-faq-item"><summary>Bagaimana cara mengetahui perkembangan laporan?</summary><p>Buka <a href="#status">Cek status laporan</a>, lalu masukkan ID laporan dan PIN yang diberikan setelah laporan berhasil dikirim. Simpan keduanya secara pribadi karena PIN hanya ditampilkan sekali.</p></details>
        <details class="home-faq-item"><summary>Apa yang terjadi setelah laporan dikirim?</summary><p>Petugas akan meninjau laporan untuk menentukan verifikasi dan tindak lanjut yang diperlukan. Pantau perkembangannya melalui <a href="#status">Cek status laporan</a>.</p><p>Untuk keadaan darurat yang membutuhkan pertolongan segera, ${contactLink('emergency', `hubungi ${branding.contacts.emergency?.label || 'layanan darurat'}`, 'hubungi layanan darurat setempat atau datangi fasilitas kesehatan terdekat')}.</p></details>
      </div>
      <details class="home-faq-more"><summary>Pertanyaan tambahan · Akun, laporan rutin, dan situasi penyakit</summary><div class="home-faq-list">
        <details class="home-faq-item"><summary>Bagaimana kader, fasilitas kesehatan, dan sekolah masuk?</summary><p><a href="#cadre">Kader</a> masuk melalui layanan pelaporan kejadian. <a href="#ibs-login-w2">Fasilitas kesehatan</a> dan <a href="#ibs-login-school">sekolah</a> memilih layanan laporan rutin sesuai jenis institusinya, kemudian menggunakan akun dan PIN yang diberikan.</p></details>
        <details class="home-faq-item"><summary>Bagaimana jika saya lupa PIN akun atau institusi saya tidak ditemukan?</summary><p>${contactLink('information', 'Hubungi pengelola', 'Hubungi pengelola layanan')} untuk mendapatkan bantuan akses akun kader atau institusi. Petugas tidak akan meminta PIN lama Anda.</p></details>
        <details class="home-faq-item"><summary>Apa perbedaan laporan kejadian dan laporan rutin?</summary><p>Laporan kejadian digunakan untuk menyampaikan kejadian kesehatan yang ditemukan. Laporan rutin digunakan oleh fasilitas kesehatan untuk W2 mingguan dan sekolah untuk absensi sakit.</p></details>
        <details class="home-faq-item"><summary>Di mana saya dapat melihat situasi penyakit di wilayah ini?</summary><p>Buka menu <a href="#situation">Situasi penyakit</a> dan perhatikan periode data serta tanggal pembaruan yang ditampilkan.</p></details>
      </div></details>
      <p class="home-faq-contact">Masih ada pertanyaan? ${contactLink('information', 'Hubungi pengelola ↗', 'Hubungi pengelola layanan')}</p>
    </section>
  `;
}

async function loadDiseaseTeaser() {
  const target = document.querySelector('#homeDiseaseUpdate');
  if (!target) return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('/api/public/disease-situation', { signal: controller.signal });
    if (!response.ok) throw new Error('Tanggal pembaruan belum dapat dimuat.');
    const data = await response.json();
    if (!target.isConnected) return;
    target.textContent = data.available && data.last_updated
      ? `Diperbarui ${publicUpdateDate(data.last_updated)}`
      : 'Data akan tersedia setelah dipublikasikan oleh petugas.';
  } catch {
    if (target.isConnected) target.textContent = 'Tanggal pembaruan belum dapat dimuat. Buka halaman situasi penyakit untuk mencoba kembali.';
  } finally { clearTimeout(timeoutId); }
}

function diseaseSituationPage() {
  app.innerHTML = `<div class="landing-page disease-page">
      <section class="disease-situation landing-disease-situation" aria-labelledby="diseaseSituationTitle">
      <div class="disease-situation-heading public-page-heading">
        <div>
          <p class="eyebrow">Informasi kesehatan wilayah</p><h1 id="diseaseSituationTitle">Situasi penyakit terkini</h1>
          <p>Ringkasan laporan penyakit di wilayah ${esc(branding.institution)}.</p>
        </div>
        <div id="diseaseSituationMeta" class="disease-situation-meta" aria-live="polite"></div>
      </div>
      <div id="diseaseSituationMessage" class="disease-situation-message" role="status" aria-live="polite">
        <span class="disease-loading-mark" aria-hidden="true"></span>
        <span>Memuat ringkasan situasi tervalidasi…</span>
      </div>
      <div id="diseaseSituationContent" class="disease-situation-loading" role="status" aria-live="polite">
        <span class="disease-loading-mark" aria-hidden="true"></span>
        <p>Memuat tren dan laporan menurut desa…</p>
      </div>
      </section>
    </div>`;
  initDiseaseSituation();
}

function publicCountLabel(cell) {
  if (!cell || cell.count_band === 'ZERO') return '0';
  if (cell.count_band === 'RANGE') return `${new Intl.NumberFormat('id-ID').format(cell.minimum)}–${new Intl.NumberFormat('id-ID').format(cell.maximum)}`;
  if (cell.count_band === 'SUPPRESSED') return '1–4';
  if (cell.count_band === 'COMPLEMENTARY_SUPPRESSED') return 'Disamarkan';
  return new Intl.NumberFormat('id-ID').format(Number(cell.case_count || 0));
}

function publicCountDescription(cell) {
  if (!cell || cell.count_band === 'ZERO') return 'tidak ada kasus';
  if (cell.count_band === 'RANGE') return `${publicCountLabel(cell)} kasus tercatat`;
  if (cell.count_band === 'SUPPRESSED') return '1 sampai 4 kasus';
  if (cell.count_band === 'COMPLEMENTARY_SUPPRESSED') return 'jumlah disamarkan untuk melindungi privasi';
  return `${new Intl.NumberFormat('id-ID').format(Number(cell.case_count || 0))} kasus`;
}

function publicBandClass(cell) {
  if (!cell || cell.count_band === 'ZERO') return 'band-zero';
  if (cell.count_band === 'SUPPRESSED') return 'band-suppressed';
  if (cell.count_band === 'COMPLEMENTARY_SUPPRESSED') return 'band-complementary';
  if (cell.count_band === 'RANGE') return 'band-range';
  const count = Number(cell.case_count || 0);
  if (count >= 20) return 'band-high';
  if (count >= 10) return 'band-medium';
  return 'band-low';
}

// Published small cells have no exact value. Combine only their public bounds;
// never invent an exact total or reveal a complementary-suppressed value.
function aggregatePublicCells(cells) {
  let minimum = 0;
  let maximum = 0;
  for (const cell of cells) {
    if (cell.count_band === 'COMPLEMENTARY_SUPPRESSED')
      return { count_band: 'COMPLEMENTARY_SUPPRESSED', case_count: null };
    if (cell.count_band === 'SUPPRESSED') {
      minimum += 1;
      maximum += 4;
    } else if (cell.count_band === 'EXACT') {
      minimum += Number(cell.case_count || 0);
      maximum += Number(cell.case_count || 0);
    }
  }
  if (!maximum) return { count_band: 'ZERO', case_count: 0 };
  if (minimum === maximum) return { count_band: 'EXACT', case_count: minimum };
  if (minimum === 1 && maximum === 4) return { count_band: 'SUPPRESSED', case_count: null };
  return { count_band: 'RANGE', case_count: null, minimum, maximum };
}

function publicUpdateDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric',
  }).format(parsed);
}

function diseaseTrendChart(periods, cells, diseaseName) {
  const cellsByPeriod = new Map(cells.map(cell => [`${cell.epi_year}-${cell.epi_week}`, cell]));
  const normalized = periods.map(period => ({
    period,
    cell: cellsByPeriod.get(`${period.epi_year}-${period.epi_week}`) || { case_count: 0, count_band: 'ZERO' },
  }));
  const exactMaximum = Math.max(5, ...normalized.map(item => item.cell.count_band === 'RANGE'
    ? item.cell.maximum : Number(item.cell.case_count || 0)));
  const bars = normalized.map(({ period, cell }, index) => {
    const estimated = cell.count_band === 'RANGE' ? (cell.minimum + cell.maximum) / 2
      : cell.count_band === 'EXACT' ? Number(cell.case_count) : null;
    const heightStep = estimated !== null ? Math.max(1, Math.min(10, Math.ceil((estimated / exactMaximum) * 10)))
      : cell.count_band === 'ZERO' ? 0 : 2;
    const visibleValue = cell.count_band === 'COMPLEMENTARY_SUPPRESSED' ? '—' : publicCountLabel(cell);
    const description = `ME ${period.epi_week}: ${publicCountDescription(cell)}`;
    return `<li class="${index === normalized.length - 1 ? 'is-latest' : ''}" title="${esc(description)}${index === normalized.length - 1 ? ' · Periode terbaru' : ''}">
      <span class="disease-trend-value">${esc(visibleValue)}</span>
      <span class="disease-trend-track"><i class="disease-trend-bar ${publicBandClass(cell)} height-${heightStep}"></i></span>
      <span class="disease-trend-week"><span>ME </span>${Number(period.epi_week)}</span>
    </li>`;
  }).join('');
  const description = normalized.map(({ period, cell }) => `ME ${period.epi_week}, ${publicCountDescription(cell)}`).join('; ');
  return `<div class="disease-trend-chart" role="img" tabindex="0" aria-label="Tren ${normalized.length} minggu ${esc(diseaseName)}. ${esc(description)}">
    <ol class="disease-trend-bars" style="--week-count:${normalized.length}" aria-hidden="true">${bars}</ol>
  </div><p class="disease-trend-scroll-hint">← Geser untuk melihat minggu sebelumnya</p>`;
}

function diseaseDistributionMap(shapeData, cells) {
  if (!branding.assets.serviceAreaShapes) return '<p class="help">Peta wilayah belum dikonfigurasi. Jumlah menurut desa tersedia pada tampilan Grafik.</p>';
  const byVillage = new Map(cells.map(cell => [String(cell.village_code || '').toUpperCase(), cell]));
  const shapes = shapeData.shapes.map((shape, index) => {
    const code = String(shape.name || '').toUpperCase();
    const cell = byVillage.get(code) || { case_count: 0, count_band: 'ZERO' };
    return `<path d="${esc(shape.d)}" class="disease-map-area ${publicBandClass(cell)}" fill-rule="evenodd"></path>`;
  }).join('');
  const labels = shapeData.shapes.map(shape => `<text x="${Number(shape.label[0])}" y="${Number(shape.label[1])}" text-anchor="middle" dominant-baseline="central">${esc(shape.name)}</text>`).join('');
  const list = shapeData.shapes.map(shape => {
    const cell = byVillage.get(String(shape.name || '').toUpperCase()) || { case_count: 0, count_band: 'ZERO' };
    return `<li><span class="disease-map-swatch ${publicBandClass(cell)}" aria-hidden="true"></span><span>${esc(shape.name)}</span><strong>${esc(publicCountLabel(cell))}</strong></li>`;
  }).join('');
  return `<div class="disease-map-wrap">
    <svg class="disease-map-svg" viewBox="${esc(shapeData.viewBox)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="diseaseMapSuppressed" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="disease-map-pattern-base" width="10" height="10"></rect><line class="disease-map-pattern-line" x1="0" y1="0" x2="0" y2="10"></line></pattern>
        <pattern id="diseaseMapComplementary" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect class="disease-map-pattern-base" width="10" height="10"></rect><line class="disease-map-pattern-line complementary" x1="0" y1="0" x2="0" y2="10"></line></pattern>
      </defs>
      <g>${shapes}</g><g class="disease-map-labels">${labels}</g>
    </svg>
    <ul class="disease-village-list" aria-label="Jumlah menurut desa">${list}</ul>
  </div>`;
}

function diseaseDistributionBars(shapeData, cells) {
  const byVillage = new Map(cells.map(cell => [String(cell.village_code || '').toUpperCase(), cell]));
  const publishedMaximum = cell => cell?.count_band === 'RANGE' ? Number(cell.maximum) : cell?.count_band === 'EXACT' ? Number(cell.case_count || 0) : cell?.count_band === 'SUPPRESSED' ? 4 : 0;
  const maximum = Math.max(1, ...cells.map(publishedMaximum));
  return `<ul class="disease-distribution-bars" aria-label="Jumlah menurut desa">${shapeData.shapes.map((shape, index) => {
    const cell = byVillage.get(String(shape.name || '').toUpperCase()) || { count_band: 'ZERO', case_count: 0 };
    const privateCount = cell.count_band === 'COMPLEMENTARY_SUPPRESSED';
    const estimate = cell.count_band === 'RANGE' ? (Number(cell.minimum) + Number(cell.maximum)) / 2 : cell.count_band === 'SUPPRESSED' ? 2.5 : Number(cell.case_count || 0);
    const width = privateCount ? 100 : Math.min(100, Math.max(0, estimate / maximum * 100));
    // SVG geometry attributes work with the production CSP; inline styles do not.
    return `<li><span>${esc(shape.name)}</span><svg class="disease-distribution-track" width="100%" height="7" aria-hidden="true">${privateCount ? `<defs><pattern id="diseaseBarPrivacy${index}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="disease-distribution-bg" width="6" height="6"></rect><path class="disease-distribution-hatch" d="M0 0V6"></path></pattern></defs>` : ''}<rect class="disease-distribution-bg" width="100%" height="7" rx="3.5"></rect><rect class="disease-distribution-fill ${publicBandClass(cell)}" width="${width}%" height="7" rx="3.5"${privateCount ? ` fill="url(#diseaseBarPrivacy${index})"` : ''}></rect></svg><strong>${esc(publicCountLabel(cell))}</strong></li>`;
  }).join('')}</ul>`;
}

let diseaseTrendObserver;
function renderDiseaseSituation(data, shapeData) {
  diseaseTrendObserver?.disconnect();
  const target = document.querySelector('#diseaseSituationContent');
  const metadata = document.querySelector('#diseaseSituationMeta');
  const message = document.querySelector('#diseaseSituationMessage');
  if (!target || !metadata || !message) return;
  const allPeriods = Array.isArray(data.window?.periods) ? data.window.periods : [];
  const completedPeriods = allPeriods.filter(period =>
    Date.parse(`${period.end}T23:59:59+07:00`) <= Date.now());
  const periods = completedPeriods.length ? completedPeriods : allPeriods;
  const latestPeriod = periods.at(-1);
  const diseases = Array.isArray(data.diseases) ? data.diseases : [];
  if (!diseases.length || !latestPeriod) throw new Error('Snapshot publik belum memuat periode yang dapat ditampilkan.');
  const trend = periods.map(period => ({ ...period, ...aggregatePublicCells(data.trend.filter(cell =>
    cell.epi_year === period.epi_year && cell.epi_week === period.epi_week)) }));
  const distribution = data.villages.map(villageCode => ({ village_code: villageCode,
    ...aggregatePublicCells(data.distribution.filter(cell => cell.village_code === villageCode
      && cell.epi_year === latestPeriod.epi_year && cell.epi_week === latestPeriod.epi_week)) }));
  const latestCell = trend.at(-1);
  const staleDays = Math.floor((Date.now() - Date.parse(`${latestPeriod.end}T23:59:59+07:00`)) / 86400000);

  metadata.innerHTML = `<span><strong>Periode data:</strong> Minggu ${Number(latestPeriod.epi_week)}, ${Number(latestPeriod.epi_year)} · sampai ${esc(publicUpdateDate(latestPeriod.end))}</span><span><strong>Diperbarui:</strong> ${esc(publicUpdateDate(data.last_updated))}</span>`;
  message.className = `disease-situation-message${staleDays > 14 ? ' is-warning' : ' is-ready'}`;
  message.innerHTML = staleDays > 14
    ? '<strong>Data belum diperbarui lebih dari dua minggu.</strong>'
    : `<span>Ringkasan ${diseases.length} kategori penyakit yang dilaporkan faskes jejaring.</span>`;
  target.className = 'disease-situation-content';
  target.removeAttribute('role');
  target.removeAttribute('aria-live');
  target.innerHTML = `
    <div class="disease-summary-intro"><p class="disease-aggregate-total"><strong>${esc(publicCountLabel(latestCell))}</strong><span>kasus dilaporkan pada minggu ${Number(latestPeriod.epi_week)}</span></p>
    <p class="disease-count-context">${latestCell.count_band === 'RANGE' || latestCell.count_band === 'SUPPRESSED' ? 'Jumlah ditampilkan sebagai rentang untuk melindungi privasi. ' : latestCell.count_band === 'COMPLEMENTARY_SUPPRESSED' ? 'Jumlah disamarkan untuk melindungi privasi. ' : ''}Gabungan laporan seluruh kategori, bukan jumlah orang unik.</p></div>
    <div class="disease-visual-grid">
      <section class="disease-visual-panel" aria-labelledby="diseaseTrendHeading">
        <div class="disease-panel-heading"><div><span>Tren mingguan</span><h2 id="diseaseTrendHeading">Tren kasus yang dilaporkan</h2></div><small>${periods.length} minggu terakhir</small></div>
        ${diseaseTrendChart(periods, trend, 'seluruh kategori pemantauan')}
      </section>
      <section class="disease-visual-panel" aria-labelledby="diseaseMapHeading">
        <div class="disease-panel-heading"><div><h2 id="diseaseMapHeading">Laporan menurut desa</h2><small>Minggu ${Number(latestPeriod.epi_week)} · ${data.villages.length} desa</small></div><div class="disease-view-switch" role="tablist" aria-label="Tampilan laporan menurut desa"><button type="button" id="diseaseGraphTab" role="tab" aria-selected="true" aria-controls="diseaseVillageBars" data-disease-view="bars">Grafik</button><button type="button" id="diseaseMapTab" role="tab" aria-selected="false" aria-controls="diseaseVillageMap" tabindex="-1" data-disease-view="map">Peta</button></div></div>
        <div id="diseaseVillageBars" role="tabpanel" aria-labelledby="diseaseGraphTab">${diseaseDistributionBars(shapeData, distribution)}</div>
        <div id="diseaseVillageMap" role="tabpanel" aria-labelledby="diseaseMapTab" hidden>${diseaseDistributionMap(shapeData, distribution)}</div>
      </section>
    </div>
    <div class="disease-situation-footer">
      <p>Angka menunjukkan kasus yang dilaporkan, bukan seluruh orang yang sakit. Angka 0 tidak berarti wilayah bebas risiko.</p>
      <details class="data-explanation"><summary>Cara membaca angka dan peta</summary><p>Rentang seperti 1–4 dan arsiran pada peta melindungi privasi ketika jumlah kasus kecil. “Disamarkan” berarti jumlah tidak ditampilkan untuk melindungi privasi. Angka desa tidak selalu dapat dijumlahkan; ukuran batang untuk rentang adalah perkiraan.</p><p>Jumlah merupakan gabungan kategori, bukan jumlah orang unik. Minggu epidemiologi (ME) adalah periode pelaporan mingguan. Informasi ini bukan diagnosis atau pengganti nasihat medis.</p></details>
    </div>`;
  target.querySelectorAll('[data-disease-view]').forEach(button => button.addEventListener('click', () => {
    target.querySelectorAll('[data-disease-view]').forEach(tab => { const selected = tab === button; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
    target.querySelector('#diseaseVillageBars').hidden = button.dataset.diseaseView !== 'bars';
    target.querySelector('#diseaseVillageMap').hidden = button.dataset.diseaseView !== 'map';
  }));
  setupTabKeyboard('[data-disease-view]');
  const chart = target.querySelector('.disease-trend-chart');
  if (chart) {
    // Keep the latest period visible on initial render and responsive resize.
    diseaseTrendObserver = new ResizeObserver(() => { chart.scrollLeft = chart.scrollWidth - chart.clientWidth; });
    diseaseTrendObserver.observe(chart);
  }
}

async function initDiseaseSituation() {
  const target = document.querySelector('#diseaseSituationContent');
  const metadata = document.querySelector('#diseaseSituationMeta');
  const message = document.querySelector('#diseaseSituationMessage');
  if (!target || !metadata || !message) return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const [snapshotResponse, shapeResponse] = await Promise.all([
      fetch('/api/public/disease-situation', { signal: controller.signal }),
      branding.assets.serviceAreaShapes ? fetch(branding.assets.serviceAreaShapes, { signal: controller.signal }) : Promise.resolve(null),
    ]);
    if (!snapshotResponse.ok || (shapeResponse && !shapeResponse.ok)) throw new Error('Data situasi belum dapat dimuat.');
    const [data, shapeData] = await Promise.all([snapshotResponse.json(), shapeResponse ? shapeResponse.json() : null]);
    if (document.querySelector('#diseaseSituationContent') !== target) return;
    if (!data.available) {
      metadata.innerHTML = '';
      target.hidden = true;
      message.className = 'disease-situation-message is-empty';
      message.innerHTML = '<strong>Belum ada snapshot tervalidasi.</strong><span>Informasi situasi penyakit akan tampil setelah data dipublikasikan oleh petugas surveilans.</span>';
      return;
    }
    target.hidden = false;
    renderDiseaseSituation(data, shapeData || {shapes: data.villages.map(code => ({name: code})), viewBox: ''});
  } catch (error) {
    if (document.querySelector('#diseaseSituationContent') !== target) return;
    const message = error.name === 'AbortError'
      ? 'Waktu pemuatan habis. Periksa koneksi Anda, lalu coba lagi.'
      : error.message;
    metadata.innerHTML = '';
    target.hidden = true;
    const statusMessage = document.querySelector('#diseaseSituationMessage');
    if (!statusMessage) return;
    statusMessage.className = 'disease-situation-message is-error';
    statusMessage.innerHTML = `<span><strong>Situasi penyakit belum dapat dimuat.</strong> ${esc(message)}</span><button type="button" class="secondary" id="retryDiseaseSituation">Coba lagi</button>`;
    document.querySelector('#retryDiseaseSituation')?.addEventListener('click', () => {
      statusMessage.className = 'disease-situation-message';
      statusMessage.innerHTML = '<span class="disease-loading-mark" aria-hidden="true"></span><span>Memuat ringkasan situasi tervalidasi…</span>';
      target.hidden = false;
      initDiseaseSituation();
    }, { once: true });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function publicPage() {
  if (publicReportDraft?.isDirty()) {
    app.replaceChildren(...publicReportDraft.nodes);
    leaveGuard = publicReportDraft.isDirty;
    return;
  }
  app.innerHTML = `
    <section class="card hero page-hero public-report-hero">
      <div class="page-head public-page-heading">
        <div class="public-report-intro">
          <p class="eyebrow">Laporan warga · tanpa akun</p>
          <h1>Laporkan kejadian kesehatan</h1>
          <p>Ceritakan yang Anda ketahui. Tidak perlu mengetahui diagnosisnya.</p>

        </div>
        <div class="actions page-hero-actions"><button id="startPublicReport" type="button">Mulai laporan</button><a class="button secondary" href="#status">Cek status laporan</a><a class="button secondary cadre-entry" href="#cadre">Kader? Masuk untuk melapor</a></div>
      </div>
      <aside class="emergency-callout" aria-label="Informasi kegawatdaruratan">
        <span class="emergency-callout-icon" aria-hidden="true">!</span>
        <div class="emergency-callout-copy"><h2>Darurat? Jangan gunakan formulir.</h2><span>${branding.contacts.emergency ? `Hubungi ${esc(branding.contacts.emergency.label)}` : 'Hubungi layanan darurat setempat'} atau datangi fasilitas kesehatan terdekat.</span></div>
        ${branding.contacts.emergency ? `<a class="emergency-callout-action" href="${esc(branding.contacts.emergency.href)}" rel="noopener"><span>Hubungi ${esc(branding.contacts.emergency.label)}</span><strong>${branding.contacts.emergency.channelLabel ? `${esc(branding.contacts.emergency.channelLabel)} ` : ''}${esc(branding.contacts.emergency.display)}</strong></a>` : '<p>Hubungi layanan darurat setempat atau datangi fasilitas kesehatan terdekat.</p>'}
      </aside>
    </section>
    <section id="publicReportSection" class="card" aria-labelledby="report-title">
      <h2 id="report-title" tabindex="-1">Formulir laporan singkat</h2>
      <p class="section-intro">Empat langkah singkat. Isi yang Anda ketahui dan hindari menuliskan nama pasien.</p>
      ${messageBox('message')}
      <form id="publicForm" novalidate>
        <div class="sr-only" aria-hidden="true" inert><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <input type="hidden" name="form_started_at" value="${Date.now()}">
        <ol class="report-progress" aria-label="Tahapan laporan">
          <li data-progress-step="1" aria-current="step"><span>1</span><small>Kejadian</small></li>
          <li data-progress-step="2"><span>2</span><small id="stepTwoProgress">Tanda</small></li>
          <li data-progress-step="3"><span>3</span><small>Detail</small></li>
          <li data-progress-step="4"><span>4</span><small>Pelapor</small></li>
        </ol>
        <p class="required-guide"><span aria-hidden="true">*</span> Wajib diisi</p>

        <fieldset class="form-step" data-step="1">
          <legend>Pilih jenis kejadian <small class="required-label">Wajib</small></legend>
          <p class="fieldset-intro">Pilih gambaran yang paling mendekati. Ini bukan pilihan diagnosis.</p>
          <div id="eventTypes" class="event-choice-grid" role="radiogroup" aria-label="Jenis kejadian"><p class="muted">Memuat pilihan…</p></div>
          <div id="eventGuidance" class="selection-guidance hidden" aria-live="polite"></div>
          <div class="step-actions"><button id="stepOneNext" type="button" data-step-next="2">Lanjut: tanda yang terlihat</button></div>
        </fieldset>

        <fieldset class="form-step" data-step="2" hidden>
          <legend><span id="stepTwoTitle">Apa yang terlihat?</span> <small class="required-label conditional-required">Sesuai kejadian</small></legend>
          <p id="stepTwoIntro" class="fieldset-intro">Pilih semua tanda yang Anda lihat atau ketahui. Petugas akan menilai penyakitnya setelah verifikasi.</p>
          <div id="observationBlock">
            <div class="option-heading-row"><h3 class="option-heading">Tanda atau keluhan</h3><button id="showAllObservations" type="button" class="text-button hidden" aria-expanded="false">Tampilkan semua tanda</button></div>
            <div id="observations" class="option-list"><p class="muted">Memuat pilihan…</p></div>
          </div>
          <details id="contextBlock" class="optional-details">
            <summary>Konteks yang berkaitan <small id="contextRequirement">Opsional</small></summary>
            <div class="option-heading-row"><p id="contextIntro" class="help">Tambahkan bila ada makanan, lingkungan, perjalanan, atau hewan yang berkaitan.</p><button id="showAllContexts" type="button" class="text-button hidden" aria-expanded="false">Tampilkan semua konteks</button></div>
            <div id="contexts" class="option-list"><p class="muted">Memuat pilihan…</p></div>
          </details>
          <div id="urgencyHint" class="urgency-hint hidden" role="status"><strong>Segera cari pertolongan medis bila kondisi memburuk.</strong> Laporan tetap dapat dikirim agar petugas surveilans mengetahuinya.</div>
          <div class="step-actions split"><button type="button" class="secondary" data-step-back="1">Kembali</button><button type="button" data-step-next="3">Lanjut: detail kejadian</button></div>
        </fieldset>

        <fieldset class="form-step" data-step="3" hidden>
          <legend>Detail kejadian</legend>
          <div class="grid">
            <div class="field"><label for="village">Desa/wilayah <span class="required-mark" aria-hidden="true">*</span></label><select name="village_code" id="village" required><option>Memuat…</option></select></div>
            <div class="field"><label for="eventDate">Tanggal mulai atau pertama diketahui <span class="required-mark" aria-hidden="true">*</span><small>Jika tanggal mulai tidak diketahui, pilih tanggal pertama Anda mengetahui kejadian.</small></label><input id="eventDate" type="date" name="event_start_date" max="${todayLocal()}" required></div>
            <div class="field" id="affectedGroupField"><label for="affectedGroup">Kelompok yang terdampak <span class="required-mark" aria-hidden="true">*</span></label><select id="affectedGroup" name="affected_group" required>${affectedGroupOptions(true)}</select></div>
            <div class="field" id="estimatedCasesField"><label id="estimatedCasesLabel" for="estimatedCases">Perkiraan orang terdampak <span class="required-mark" aria-hidden="true">*</span></label><input id="estimatedCases" type="number" name="estimated_cases" min="0" inputmode="numeric" required><label class="check"><input type="checkbox" name="estimated_cases_unknown" data-unknown-for="estimatedCases"><span id="estimatedCasesUnknownLabel">Jumlah orang terdampak belum diketahui</span></label></div>
            <div class="field" id="estimatedDeathsField"><label for="estimatedDeaths">Perkiraan orang meninggal</label><input id="estimatedDeaths" type="number" name="estimated_deaths" min="0" inputmode="numeric" required><label class="check"><input type="checkbox" name="estimated_deaths_unknown" data-unknown-for="estimatedDeaths"><span>Jumlah meninggal belum diketahui</span></label></div>
            <div class="field" id="hospitalizedCasesField"><label for="hospitalizedCases">Perkiraan orang dirawat</label><input id="hospitalizedCases" type="number" name="hospitalized_cases" min="0" inputmode="numeric" required><label class="check"><input type="checkbox" name="hospitalized_cases_unknown" data-unknown-for="hospitalizedCases"><span>Jumlah dirawat belum diketahui</span></label></div>
            <label class="check" id="severeCaseField"><input type="checkbox" name="has_severe_case"><span>Ada kondisi berat<small>Misalnya sesak atau penurunan kesadaran.</small></span></label>
          </div>
          <div class="field"><label for="location">Lokasi kejadian <small>Isi RT/RW, nama tempat, atau patokan agar petugas dapat menindaklanjuti.</small></label><input id="location" name="location_text" maxlength="300" autocomplete="street-address" placeholder="Contoh: RT 03/RW 02 dekat pasar"></div>
          <input id="latitude" name="latitude" type="hidden"><input id="longitude" name="longitude" type="hidden">
          <div class="actions"><button id="usePublicLocation" type="button" class="secondary">Gunakan lokasi saya</button><button id="openPublicMap" type="button" class="secondary">Pilih di peta</button></div>
          <p id="coordinateStatus" class="location-privacy">Koordinat hanya dikirim bila Anda menggunakan lokasi perangkat atau memilih titik pada peta.</p>
          <p id="detailLocationHint" class="followup-hint" role="status">Lokasi belum diisi. Pada langkah berikutnya, pilih “Bersedia dihubungi” dan isi nomor telepon agar laporan dapat dikirim.</p>
          <div id="publicMapPicker" class="map-picker hidden"><p>Ketuk lokasi kejadian pada peta. Menggunakan peta OpenStreetMap dan memerlukan koneksi internet.</p>${messageBox('publicMapMessage')}<div id="publicMap" class="map-canvas" aria-label="Peta pemilih lokasi"></div><div class="actions"><button id="closePublicMap" type="button" class="secondary">Tutup peta</button></div></div>
          <div class="field"><label for="description">Ceritakan kejadian <span class="required-mark" aria-hidden="true">*</span><small>Jangan menuliskan nama pasien.</small></label><textarea id="description" name="event_description" maxlength="2000" placeholder="Apa yang terjadi, di mana, dan sejak kapan?" required></textarea></div>
          <div class="step-actions split"><button type="button" class="secondary" data-step-back="2">Kembali</button><button type="button" data-step-next="4">Lanjut: data pelapor</button></div>
        </fieldset>

        <fieldset class="form-step" data-step="4" hidden>
          <legend>Data pelapor dan konfirmasi</legend>
          <p class="fieldset-intro">Nama boleh tidak dicantumkan. Agar laporan dapat diverifikasi, berikan lokasi yang cukup jelas atau bersedia dihubungi.</p>
          <div class="grid">
            <div>
              <label class="check"><input id="anonymous" type="checkbox" name="anonymous"><span>Jangan cantumkan nama saya<small>Nama tidak akan disimpan dalam laporan.</small></span></label>
              <div class="field"><label for="reporterName">Nama pelapor <span id="reporterNameRequired" class="required-mark" aria-hidden="true">*</span></label><input id="reporterName" name="reporter_name" maxlength="100" autocomplete="name" required></div>
            </div>
            <div>
              <label class="check"><input id="contact" type="checkbox" name="allow_contact"><span>Bersedia dihubungi untuk verifikasi<small>Nomor tetap disimpan meskipun nama tidak dicantumkan.</small></span></label>
              <div class="field"><label for="phone">Nomor telepon <span id="phoneRequired" class="required-mark hidden" aria-hidden="true">*</span></label><input id="phone" name="reporter_phone" type="tel" inputmode="tel" maxlength="30" autocomplete="tel" placeholder="08xx atau +62…" disabled></div>
            </div>
          </div>
          <div id="followupHint" class="followup-hint" role="status">Tambahkan lokasi kejadian atau pilih “Bersedia dihubungi” agar petugas dapat memverifikasi laporan.</div>
          <section class="report-review" aria-labelledby="reviewTitle"><h3 id="reviewTitle">Periksa laporan Anda</h3><div id="reportReview" class="review-groups"></div></section>
          <details class="privacy-details"><summary>Bagaimana data laporan digunakan?</summary><ul><li>Hanya petugas berwenang yang dapat membuka laporan lengkap.</li><li>Nomor telepon hanya disimpan bila Anda bersedia dihubungi.</li><li>Koordinat hanya disimpan bila Anda menggunakan lokasi perangkat atau peta.</li><li>Data digunakan untuk verifikasi, surveilans, dan tindak lanjut kesehatan serta disimpan sebagai bagian dari pencatatan surveilans pengelola layanan.</li></ul><p>Pertanyaan tentang data dapat disampaikan melalui kontak informasi ${esc(branding.institution)}: ${contactLink('information', branding.contacts.information?.display || 'Hubungi pengelola layanan', 'Hubungi pengelola layanan')}.</p></details>
          <label class="check consent-check"><input type="checkbox" name="privacy_consent" required><span>Saya setuju data laporan digunakan untuk verifikasi, surveilans, dan tindak lanjut kesehatan. <span class="required-mark" aria-hidden="true">*</span></span></label>
          <div class="step-actions split"><button type="button" class="secondary" data-step-back="3">Kembali</button><button type="submit">Kirim laporan</button></div>
        </fieldset>
      </form>
    </section>`;

  document.querySelector('#startPublicReport').addEventListener('click', () => {
    const reportSection = document.querySelector('#publicReportSection');
    reportSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector('#report-title')?.focus({ preventScroll: true });
  });

  let publicMasters = null;
  // getMasters() only caches on success, so a failed load can simply be retried.
  const loadMasters = async () => {
    try {
      const masters = await getMasters();
      publicMasters = masters;
      document.querySelector('#eventTypes').innerHTML = masters.event_types.map(item => `
        <label class="select-card event-choice">
          <input class="sr-only" type="radio" name="event_type" value="${esc(item.event_type)}" required>
          <span class="event-choice-icon">${eventIcon(item.icon_key)}</span>
          <span class="select-card-copy"><strong>${esc(item.public_label)}</strong><small>${esc(item.public_help)}</small></span>
          <span class="choice-check" aria-hidden="true">✓</span>
        </label>`).join('');
      document.querySelector('#observations').innerHTML = masters.observations.map(item => `
        <label class="select-card multi-option" data-option-code="${esc(item.observation_code)}">
          <input class="sr-only" type="checkbox" name="observation_codes" value="${esc(item.observation_code)}">
          <span class="select-card-copy"><strong>${esc(item.public_label)}</strong><small>${esc(item.public_help)}</small></span>
          <span class="choice-check" aria-hidden="true">✓</span>
        </label>`).join('');
      document.querySelector('#contexts').innerHTML = masters.contexts.map(item => `
        <label class="select-card multi-option" data-option-code="${esc(item.context_code)}">
          <input class="sr-only" type="checkbox" name="context_codes" value="${esc(item.context_code)}">
          <span class="select-card-copy"><strong>${esc(item.public_label)}</strong><small>${esc(item.public_help)}</small></span>
          <span class="choice-check" aria-hidden="true">✓</span>
        </label>`).join('');
      document.querySelector('#village').innerHTML = selectOptions(masters.villages, 'village_code', 'village_name');
      document.querySelector('#message').innerHTML = '';
    } catch (error) {
      document.querySelector('#eventTypes').innerHTML = '<p class="error">Pilihan jenis kejadian gagal dimuat.</p>';
      document.querySelector('#observations').innerHTML = '<p class="error">Pilihan tanda gagal dimuat.</p>';
      document.querySelector('#contexts').innerHTML = '<p class="error">Pilihan konteks gagal dimuat.</p>';
      document.querySelector('#village').innerHTML = '<option value="">Gagal memuat</option>';
      document.querySelector('#message').innerHTML = `<div class="error" role="alert">${esc(error.message)} <button type="button" class="secondary" id="retryMasters">Coba lagi</button></div>`;
      document.querySelector('#retryMasters')?.addEventListener('click', loadMasters);
    }
  };
  await loadMasters();

  let dirty = false;
  let currentStep = 1;
  let editingReview = false;
  let showAllObservations = false;
  let showAllContexts = false;
  const publicForm = document.querySelector('#publicForm');

  const showFormMessage = (text, target) => {
    publicForm.querySelectorAll('.public-step-error').forEach(message => message.remove());
    publicForm.querySelectorAll('[aria-invalid="true"]').forEach(input => {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });
    const field = target?.closest('.field, .check') || target;
    const message = document.createElement('div');
    message.id = 'publicStepError';
    message.className = 'step-error public-step-error';
    message.setAttribute('role', 'alert');
    message.textContent = text;
    field.before(message);
    const control = target.matches('input, select, textarea') ? target : target.querySelector('input, select, textarea');
    control?.setAttribute('aria-invalid', 'true');
    control?.setAttribute('aria-describedby', message.id);
    control?.focus({ preventScroll: true });
    message.scrollIntoView({ behavior: 'auto', block: 'start' });
  };

  const selectedLabels = name => [...publicForm.querySelectorAll(`[name="${name}"]:checked`)]
    .map(input => input.closest('label')?.querySelector('strong')?.textContent || input.value);

  const updateFollowupHint = () => {
    const hasLocation = Boolean(publicForm.elements.location_text.value.trim() || (publicForm.elements.latitude.value && publicForm.elements.longitude.value));
    const canContact = publicForm.elements.allow_contact.checked && Boolean(publicForm.elements.reporter_phone.value.trim());
    const hint = document.querySelector('#followupHint');
    hint.classList.toggle('ready', hasLocation || canContact);
    hint.textContent = hasLocation || canContact
      ? 'Informasi tindak lanjut sudah cukup: petugas dapat menggunakan lokasi atau nomor kontak yang diberikan.'
      : 'Tambahkan lokasi kejadian atau pilih “Bersedia dihubungi” agar petugas dapat memverifikasi laporan.';
    const detailHint = document.querySelector('#detailLocationHint');
    detailHint.classList.toggle('ready', hasLocation);
    detailHint.textContent = hasLocation
      ? 'Lokasi kejadian sudah terisi. Anda dapat melanjutkan ke data pelapor.'
      : 'Lokasi belum diisi. Pada langkah berikutnya, pilih “Bersedia dihubungi” dan isi nomor telepon agar laporan dapat dikirim.';
    const coordinateStatus = document.querySelector('#coordinateStatus');
    coordinateStatus.textContent = publicForm.elements.latitude.value && publicForm.elements.longitude.value
      ? 'Titik lokasi sudah dipilih dan akan dikirim bersama laporan.'
      : 'Koordinat hanya dikirim bila Anda menggunakan lokasi perangkat atau memilih titik pada peta.';
  };

  const updateReview = () => {
    const event = publicForm.querySelector('[name="event_type"]:checked');
    const village = publicForm.elements.village_code;
    const observations = selectedLabels('observation_codes');
    const contexts = selectedLabels('context_codes');
    const contact = publicForm.elements.allow_contact.checked
      ? `Dapat dihubungi melalui ${publicForm.elements.reporter_phone.value.trim() || 'nomor belum diisi'}`
      : 'Tidak bersedia dihubungi';
    const rows = [
      ['Kejadian', event?.closest('label')?.querySelector('strong')?.textContent || 'Belum dipilih'],
      ['Tanda', event?.value === 'ANIMAL_EVENT' ? 'Tidak berlaku untuk kejadian hewan' : observations.length ? observations.join(', ') : 'Tidak ada tanda yang dipilih'],
      ['Konteks', contexts.length ? contexts.join(', ') : 'Tidak diketahui/tidak dipilih'],
      ['Wilayah', village?.selectedOptions?.[0]?.textContent || 'Belum dipilih'],
      ['Tanggal mulai', formatDate(publicForm.elements.event_start_date.value)],
      ['Kelompok terdampak', affectedGroupLabel(publicForm.elements.affected_group.value)],
      [document.querySelector('#estimatedCasesLabel')?.textContent.replace('*', '').trim() || 'Perkiraan terdampak', publicForm.elements.estimated_cases_unknown.checked ? 'Belum diketahui' : publicForm.elements.estimated_cases.value || 'Belum diisi'],
      ['Meninggal', publicForm.elements.estimated_deaths_unknown.checked ? 'Belum diketahui' : publicForm.elements.estimated_deaths.value || 'Belum diisi'],
      ['Dirawat', publicForm.elements.hospitalized_cases_unknown.checked ? 'Belum diketahui' : publicForm.elements.hospitalized_cases.value || 'Belum diisi'],
      ['Kondisi berat', publicForm.elements.has_severe_case.checked ? 'Ada' : 'Tidak dilaporkan'],
      ['Lokasi', publicForm.elements.location_text.value.trim() || (publicForm.elements.latitude.value ? 'Titik peta/lokasi perangkat' : 'Belum diberikan')],
      ['Cerita kejadian', publicForm.elements.event_description.value.trim() || 'Belum diisi'],
      ['Pelapor', publicForm.elements.anonymous.checked ? 'Nama tidak dicantumkan' : (publicForm.elements.reporter_name.value.trim() || 'Nama belum diisi')],
      ['Kontak', contact],
    ];
    // Match the four form steps so each edit opens the complete related group.
    const groups = [
      { title: 'Kejadian', step: 1, target: 'eventTypes', rows: rows.slice(0, 1) },
      { title: event?.value === 'ANIMAL_EVENT' ? 'Konteks hewan' : 'Tanda dan konteks', step: 2, target: event?.value === 'ANIMAL_EVENT' ? 'contexts' : 'observations', rows: event?.value === 'ANIMAL_EVENT' ? rows.slice(2, 3) : rows.slice(1, 3) },
      { title: 'Detail kejadian', step: 3, target: 'village', rows: event?.value === 'ANIMAL_EVENT' ? [...rows.slice(3, 7), ...rows.slice(10, 12)] : rows.slice(3, 12) },
      { title: 'Pelapor', step: 4, target: 'anonymous', rows: rows.slice(12) },
    ];
    document.querySelector('#reportReview').innerHTML = groups.map(group => {
      const values = group.rows.map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`).join('');
      return `<section class="review-group" aria-labelledby="reviewGroup${group.step}"><div class="review-group-head"><h4 id="reviewGroup${group.step}">${esc(group.title)}</h4><button type="button" class="text-button review-edit" data-review-edit="${group.step}" data-review-target="${group.target}" aria-label="Ubah ${esc(group.title)}">Ubah</button></div><dl>${values}</dl></section>`;
    }).join('');
    updateFollowupHint();
  };

  const showStep = stepNumber => {
    currentStep = stepNumber;
    if (stepNumber === 4) editingReview = false;
    publicForm.querySelectorAll('.public-step-error').forEach(message => message.remove());
    publicForm.querySelectorAll('[aria-invalid="true"]').forEach(input => {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });
    publicForm.querySelectorAll('[data-step-next]').forEach(button => {
      button.dataset.normalLabel ||= button.textContent;
      button.textContent = editingReview ? 'Kembali ke konfirmasi' : button.dataset.normalLabel;
    });
    publicForm.querySelectorAll('.form-step').forEach(step => { step.hidden = Number(step.dataset.step) !== stepNumber; });
    publicForm.querySelectorAll('[data-progress-step]').forEach(item => {
      const step = Number(item.dataset.progressStep);
      if (step === stepNumber) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('complete', step < stepNumber);
    });
    if (stepNumber === 4) updateReview();
    document.querySelector('#message').innerHTML = '';
    const targetStep = publicForm.querySelector(`[data-step="${stepNumber}"]`);
    targetStep?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const legend = targetStep?.querySelector('legend');
    if (legend) {
      legend.tabIndex = -1;
      legend.focus({ preventScroll: true });
    }
  };

  const applyOptionVisibility = (containerId, allowedCodes, expanded, buttonId) => {
    const options = [...document.querySelectorAll(`#${containerId} [data-option-code]`)];
    const hasFilter = Array.isArray(allowedCodes) && allowedCodes.length < options.length;
    options.forEach(option => {
      const input = option.querySelector('input');
      option.hidden = hasFilter && !expanded && !allowedCodes.includes(option.dataset.optionCode) && !input.checked;
    });
    const button = document.querySelector(`#${buttonId}`);
    button.classList.toggle('hidden', !hasFilter);
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Tampilkan pilihan utama' : containerId === 'observations' ? 'Tampilkan semua tanda' : 'Tampilkan semua konteks';
  };

  const updateEventGuidance = () => {
    const eventType = publicForm.elements.event_type?.value || '';
    const config = EVENT_FORM_CONFIG[eventType] || EVENT_FORM_CONFIG.OTHER;
    const selectedEvent = publicMasters?.event_types?.find(item => item.event_type === eventType);
    const guidance = document.querySelector('#eventGuidance');
    guidance.classList.toggle('hidden', !selectedEvent);
    guidance.innerHTML = selectedEvent ? `<span class="event-choice-icon">${eventIcon(selectedEvent.icon_key)}</span><span><strong>${esc(selectedEvent.public_label)}</strong><small>${esc(selectedEvent.public_help)} Pertanyaan berikut akan disesuaikan dengan pilihan ini.</small></span>` : '';

    const observationBlock = document.querySelector('#observationBlock');
    observationBlock.classList.toggle('hidden', Array.isArray(config.observations) && config.observations.length === 0);
    const animalEvent = eventType === 'ANIMAL_EVENT';
    document.querySelector('#stepTwoProgress').textContent = animalEvent ? 'Konteks' : 'Tanda';
    document.querySelector('#stepOneNext').textContent = animalEvent ? 'Lanjut: hewan terdampak' : 'Lanjut: tanda yang terlihat';
    document.querySelector('#stepTwoTitle').textContent = animalEvent ? 'Hewan apa yang terdampak?' : 'Apa yang terlihat?';
    document.querySelector('#stepTwoIntro').textContent = animalEvent ? 'Pilih jenis hewan atau unggas yang sakit atau mati. Ceritakan jumlah dan lokasi pada langkah berikutnya.' : 'Pilih semua tanda yang Anda lihat atau ketahui. Petugas akan menilai penyakitnya setelah verifikasi.';
    document.querySelector('#contextIntro').textContent = animalEvent ? 'Pilih jenis hewan atau unggas yang berkaitan dengan kejadian.' : 'Tambahkan bila ada makanan, lingkungan, perjalanan, atau hewan yang berkaitan.';
    applyOptionVisibility('observations', config.observations, showAllObservations, 'showAllObservations');
    applyOptionVisibility('contexts', config.contexts, showAllContexts, 'showAllContexts');
    const contextBlock = document.querySelector('#contextBlock');
    const contextRequired = Boolean(config.contextsRequired);
    document.querySelector('#contextRequirement').textContent = contextRequired ? 'Wajib untuk kejadian ini' : 'Opsional';
    if (contextRequired) contextBlock.open = true;

    const cases = document.querySelector('#estimatedCases');
    const deaths = document.querySelector('#estimatedDeaths');
    const hospitalized = document.querySelector('#hospitalizedCases');
    const severe = publicForm.elements.has_severe_case;
    document.querySelector('#estimatedCasesLabel').innerHTML = `${esc(config.casesLabel)} <span class="required-mark" aria-hidden="true">*</span>`;
    document.querySelector('#estimatedCasesUnknownLabel').textContent = eventType === 'ANIMAL_EVENT'
      ? 'Jumlah hewan/unggas terdampak belum diketahui'
      : 'Jumlah orang terdampak belum diketahui';
    cases.min = String(config.casesMin ?? 0);
    if (cases.value !== '' && Number(cases.value) < Number(cases.min)) cases.value = cases.min;
    deaths.min = String(config.deathsMin ?? 0);
    if (deaths.value !== '' && Number(deaths.value) < Number(deaths.min)) deaths.value = deaths.min;
    ['#estimatedDeathsField', '#hospitalizedCasesField', '#severeCaseField'].forEach(selector => document.querySelector(selector).classList.toggle('hidden', Boolean(config.hideHumanOutcomes)));
    if (config.hideHumanOutcomes) {
      deaths.value = '0';
      hospitalized.value = '0';
      publicForm.elements.estimated_deaths_unknown.checked = false;
      publicForm.elements.hospitalized_cases_unknown.checked = false;
      deaths.disabled = false;
      hospitalized.disabled = false;
      deaths.required = true;
      hospitalized.required = true;
      severe.checked = false;
    }
    const affectedGroupField = document.querySelector('#affectedGroupField');
    const affectedGroup = publicForm.elements.affected_group;
    affectedGroupField.classList.toggle('hidden', eventType === 'ANIMAL_EVENT');
    affectedGroup.querySelector('option[value="ANIMAL"]').hidden = eventType !== 'ANIMAL_EVENT';
    if (eventType === 'ANIMAL_EVENT') affectedGroup.value = 'ANIMAL';
    else if (affectedGroup.value === 'ANIMAL') affectedGroup.value = '';

    const urgentEvent = Boolean(Number(publicMasters?.event_types.find(item => item.event_type === eventType)?.immediate_notification));
    const urgentSign = [...publicForm.querySelectorAll('[name="observation_codes"]:checked')].some(input =>
      Boolean(Number(publicMasters?.observations.find(item => item.observation_code === input.value)?.immediate_notification)));
    const urgentContext = [...publicForm.querySelectorAll('[name="context_codes"]:checked')].some(input =>
      Boolean(Number(publicMasters?.contexts.find(item => item.context_code === input.value)?.immediate_notification)));
    const urgencyHint = document.querySelector('#urgencyHint');
    urgencyHint.innerHTML = eventType === 'ANIMAL_EVENT'
      ? '<strong>Hindari menyentuh hewan yang sakit atau mati tanpa pelindung.</strong> Jauhkan anak-anak dan laporkan agar petugas dapat menindaklanjuti.'
      : eventType === 'ANIMAL_EXPOSURE'
        ? '<strong>Segera cari pertolongan medis setelah gigitan, cakaran, atau kontak berisiko dengan hewan.</strong> Jangan menunggu gejala atau kondisi memburuk. Laporan tetap dapat dikirim.'
      : eventType === 'ENVIRONMENTAL'
        ? '<strong>Jauhi sumber paparan bila masih berbahaya.</strong> Cari pertolongan medis bila ada keluhan atau kondisi memburuk.'
        : '<strong>Segera cari pertolongan medis bila kondisi memburuk.</strong> Laporan tetap dapat dikirim agar petugas surveilans mengetahuinya.';
    urgencyHint.classList.toggle('hidden', !(urgentEvent || urgentSign || urgentContext || publicForm.elements.has_severe_case.checked));
  };

  const validateStep = stepNumber => {
    if (stepNumber === 1 && !publicForm.querySelector('[name="event_type"]:checked')) {
      showFormMessage('Pilih satu jenis kejadian yang paling mendekati.', document.querySelector('#eventTypes'));
      return false;
    }
    if (stepNumber === 2) {
      const eventType = publicForm.elements.event_type.value;
      if (['PERSON_ILLNESS', 'CLUSTER', 'SCHOOL_WORKPLACE'].includes(eventType) && !publicForm.querySelector('[name="observation_codes"]:checked')) {
        showFormMessage('Pilih sedikitnya satu tanda atau keluhan yang terlihat.', document.querySelector('#observations'));
        return false;
      }
      const config = EVENT_FORM_CONFIG[eventType] || EVENT_FORM_CONFIG.OTHER;
      if (config.contextsRequired && !publicForm.querySelector('[name="context_codes"]:checked')) {
        document.querySelector('#contextBlock').open = true;
        showFormMessage('Pilih konteks gigitan, kontak, atau jenis hewan yang berkaitan.', document.querySelector('#contexts'));
        return false;
      }
    }
    if (stepNumber === 3 || stepNumber === 4) {
      const invalid = publicForm.querySelector(`[data-step="${stepNumber}"] :invalid`);
      if (invalid) {
        const labels = {
          village_code: 'Pilih desa atau wilayah kejadian.', event_start_date: 'Isi tanggal mulai atau pertama diketahui.',
          affected_group: 'Pilih kelompok yang terdampak.', estimated_cases: 'Isi perkiraan jumlah terdampak atau pilih “Jumlah belum diketahui”.',
          estimated_deaths: 'Isi perkiraan jumlah meninggal, tulis 0 bila tidak ada, atau pilih “Jumlah belum diketahui”.',
          hospitalized_cases: 'Isi perkiraan jumlah dirawat, tulis 0 bila tidak ada, atau pilih “Jumlah belum diketahui”.',
          event_description: 'Ceritakan singkat kejadian tanpa nama pasien.', reporter_name: 'Isi nama pelapor atau pilih anonim.',
          reporter_phone: 'Isi nomor telepon bila bersedia dihubungi.', privacy_consent: 'Setujui penggunaan data laporan untuk melanjutkan.',
        };
        const label = labels[invalid.name] || 'Periksa kembali isian ini.';
        const message = invalid.validity.rangeUnderflow ? `Jumlah minimal ${invalid.min} untuk kejadian ini, atau pilih “Jumlah belum diketahui” bila belum tahu.`
          : invalid.validity.rangeOverflow ? 'Tanggal tidak boleh melewati hari ini.' : label;
        showFormMessage(message, invalid);
        return false;
      }
    }
    return true;
  };

  publicForm.addEventListener('input', event => {
    dirty = true;
    if (event.target.dataset.unknownFor) {
      const count = document.getElementById(event.target.dataset.unknownFor);
      count.disabled = event.target.checked;
      count.required = !event.target.checked;
      if (event.target.checked) count.value = '';
    }
    if (event.target.name === 'event_type') {
      showAllObservations = false;
      showAllContexts = false;
      publicForm.querySelectorAll('[data-unknown-for]').forEach(input => {
        input.checked = false;
        const count = document.getElementById(input.dataset.unknownFor);
        count.value = '';
        count.disabled = false;
        count.required = true;
      });
      publicForm.querySelectorAll('[name="observation_codes"], [name="context_codes"]').forEach(input => { input.checked = false; });
      document.querySelector('#contextBlock').open = false;
    }
    if (event.target.name === 'context_codes' && event.target.checked) {
      const contexts = [...publicForm.querySelectorAll('[name="context_codes"]')];
      if (event.target.value === 'UNKNOWN_CONTEXT') contexts.forEach(input => { if (input !== event.target) input.checked = false; });
      else {
        const unknown = contexts.find(input => input.value === 'UNKNOWN_CONTEXT');
        if (unknown) unknown.checked = false;
      }
    }
    if (['event_type', 'observation_codes', 'context_codes', 'has_severe_case'].includes(event.target.name)) updateEventGuidance();
    if (currentStep === 4) updateReview();
    else updateFollowupHint();
  });
  leaveGuard = () => dirty;

  document.querySelector('#showAllObservations').addEventListener('click', () => {
    showAllObservations = !showAllObservations;
    updateEventGuidance();
  });
  document.querySelector('#showAllContexts').addEventListener('click', () => {
    showAllContexts = !showAllContexts;
    updateEventGuidance();
  });
  publicForm.querySelectorAll('[data-step-next]').forEach(button => button.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    if (editingReview) {
      // An event edit can invalidate signs or counts on a different step.
      for (let step = 1; step <= 3; step++) {
        showStep(step);
        if (!validateStep(step)) return;
      }
      showStep(4);
      const reviewTitle = document.querySelector('#reviewTitle');
      reviewTitle.tabIndex = -1;
      reviewTitle.focus({ preventScroll: true });
      reviewTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else showStep(Number(button.dataset.stepNext));
  }));
  document.querySelector('#reportReview').addEventListener('click', event => {
    const button = event.target.closest('[data-review-edit]');
    if (!button) return;
    const step = Number(button.dataset.reviewEdit);
    editingReview = step !== 4;
    showStep(step);
    const target = document.getElementById(button.dataset.reviewTarget);
    if (target.tagName === 'DETAILS') target.open = true;
    const control = target.matches('input, select, textarea') ? target : target.querySelector('input, select, textarea');
    control?.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  publicForm.querySelectorAll('[data-step-back]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.stepBack))));

  document.querySelector('#anonymous').addEventListener('change', event => {
    const name = document.querySelector('#reporterName');
    name.disabled = event.target.checked;
    name.required = !event.target.checked;
    document.querySelector('#reporterNameRequired').classList.toggle('hidden', event.target.checked);
    if (event.target.checked) name.value = '';
  });
  document.querySelector('#contact').addEventListener('change', event => {
    const phone = document.querySelector('#phone');
    phone.disabled = !event.target.checked;
    phone.required = event.target.checked;
    document.querySelector('#phoneRequired').classList.toggle('hidden', !event.target.checked);
    if (!event.target.checked) phone.value = '';
    updateReview();
  });
  setupMapPicker({ buttonId: 'openPublicMap', panelId: 'publicMapPicker', mapId: 'publicMap', latitudeId: 'latitude', longitudeId: 'longitude', messageId: 'publicMapMessage', geolocateId: 'usePublicLocation', closeId: 'closePublicMap' });
  updateEventGuidance();
  updateFollowupHint();
  publicForm.addEventListener('submit', event => submitForm(event, async () => {
    const form = event.currentTarget;
    if (!validateStep(4)) return;
    const data = Object.fromEntries(new FormData(form));
    data.observation_codes = [...form.querySelectorAll('[name="observation_codes"]:checked')].map(input => input.value);
    data.context_codes = [...form.querySelectorAll('[name="context_codes"]:checked')].map(input => input.value);
    if (['PERSON_ILLNESS', 'CLUSTER', 'SCHOOL_WORKPLACE'].includes(data.event_type) && !data.observation_codes.length) {
      showStep(2);
      document.querySelector('#message').innerHTML = alertBox('error', 'Pilih sedikitnya satu tanda atau keluhan yang terlihat.');
      document.querySelector('#observations').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const eventConfig = EVENT_FORM_CONFIG[data.event_type] || EVENT_FORM_CONFIG.OTHER;
    if (eventConfig.contextsRequired && !data.context_codes.length) {
      showStep(2);
      document.querySelector('#contextBlock').open = true;
      document.querySelector('#message').innerHTML = alertBox('error', 'Pilih konteks gigitan, kontak, atau jenis hewan yang berkaitan.');
      document.querySelector('#contexts').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    ['anonymous', 'allow_contact', 'has_severe_case', 'privacy_consent', 'estimated_cases_unknown', 'estimated_deaths_unknown', 'hospitalized_cases_unknown'].forEach(key => data[key] = form.elements[key].checked);
    const hasLocation = Boolean(String(data.location_text || '').trim() || (data.latitude && data.longitude));
    const canContact = data.allow_contact && Boolean(String(data.reporter_phone || '').trim());
    if (!hasLocation && !canContact) {
      showFormMessage('Tambahkan lokasi melalui “Ubah Detail kejadian”, atau pilih “Bersedia dihubungi” dan isi nomor telepon.', document.querySelector('#contact'));
      return;
    }
    const phoneText = String(data.reporter_phone || '').trim();
    const phoneDigits = phoneText.replace(/\D/g, '');
    if (canContact && (!/^\+?[0-9][0-9\s().-]*$/.test(phoneText) || phoneDigits.length < 8 || phoneDigits.length > 15)) {
      showFormMessage('Periksa kembali nomor telepon. Gunakan 8–15 angka.', document.querySelector('#phone'));
      return;
    }
    // Client-measured seconds spent on the form (clock-skew-proof anti-spam signal).
    data.form_elapsed_ms = Date.now() - Number(form.elements.form_started_at.value || Date.now());
    try {
      const result = await api('/api/public/reports', { method: 'POST', body: JSON.stringify(data) });
      dirty = false;
      form.reset();
      form.querySelectorAll('[data-unknown-for]').forEach(input => { const count = document.getElementById(input.dataset.unknownFor); count.disabled = false; count.required = true; });
      document.querySelector('#phone').disabled = true;
      document.querySelector('#reporterName').disabled = false;
      document.querySelector('#reporterNameRequired').classList.remove('hidden');
      document.querySelector('#phoneRequired').classList.add('hidden');
      showAllObservations = false;
      showAllContexts = false;
      updateEventGuidance();
      showStep(1);
      saveLastPublicReport({ report_id: result.report_id, pin: result.pin });
      document.querySelector('#message').innerHTML = `<div class="success public-report-success" role="status">
        <div class="report-completion-heading">
          <strong>Laporan berhasil dikirim.</strong>
          <p>Simpan ID dan PIN berikut — PIN hanya ditampilkan sekali dan diperlukan untuk mengecek status.</p>

        </div>
        <div class="credentials"><div class="credential"><span>ID laporan</span><code>${esc(result.report_id)}</code><button type="button" class="text-button" id="copyReportId">Salin ID</button></div><div class="credential"><span>PIN</span><code>${esc(result.pin)}</code><button type="button" class="text-button" id="copyReportPin">Salin PIN</button></div></div>
        <div class="actions credential-actions"><button type="button" id="checkSubmittedReport">Cek status sekarang</button><button type="button" class="secondary" id="copyCredentials">Salin semuanya</button></div>
        <p class="help">ID dan PIN akan terisi otomatis saat Anda membuka cek status di tab ini.</p>
      </div>`;
      const copyValue = async (buttonId, value, successText) => {
        const button = document.querySelector(`#${buttonId}`);
        try { await navigator.clipboard.writeText(value); button.textContent = successText; }
        catch { button.textContent = 'Gagal menyalin'; }
      };
      document.querySelector('#copyReportId')?.addEventListener('click', () => copyValue('copyReportId', result.report_id, 'ID tersalin ✓'));
      document.querySelector('#copyReportPin')?.addEventListener('click', () => copyValue('copyReportPin', result.pin, 'PIN tersalin ✓'));
      document.querySelector('#copyCredentials')?.addEventListener('click', () => copyValue('copyCredentials', `ID laporan: ${result.report_id}\nPIN: ${result.pin}`, 'Semua tersalin ✓'));
      document.querySelector('#checkSubmittedReport')?.addEventListener('click', () => { location.hash = '#status'; });
      document.querySelector('#message .credentials').insertAdjacentHTML('beforebegin', '<p>Petugas akan meninjau laporan ini. Pantau perkembangannya melalui cek status; petugas dapat menghubungi Anda bila Anda bersedia dihubungi.</p>');
      document.querySelector('#message .credential-actions').insertAdjacentHTML('beforeend', '<button type="button" class="secondary" id="saveReportReceipt">Unduh bukti laporan</button>');
      document.querySelector('#message .success').insertAdjacentHTML('beforeend', '<div class="completion-next"><a class="button secondary" href="#home">Kembali ke beranda</a><button type="button" class="text-button" id="newPublicReport">Buat laporan lain</button></div>');
      document.querySelector('#saveReportReceipt').addEventListener('click', () => {
        const blob = new Blob([`${branding.displayName}\nLaporan berhasil dikirim\nID laporan: ${result.report_id}\nPIN: ${result.pin}\n\nSimpan ID dan PIN secara pribadi.\nCek status: ${location.origin}/#status\nPetugas akan meninjau laporan Anda.`], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `bukti-laporan-${result.report_id}.txt`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      form.hidden = true;
      document.querySelector('.public-report-hero').hidden = true;
      const completionTitle = document.createElement('h1');
      completionTitle.id = 'report-title'; completionTitle.className = 'public-completion-title';
      completionTitle.textContent = 'Laporan Anda sudah diterima';
      document.querySelector('#report-title').replaceWith(completionTitle);
      document.querySelector('#publicReportSection > .section-intro').hidden = true;
      document.querySelector('#newPublicReport').addEventListener('click', () => publicPage());
      focusMessage('message');
    } catch (error) {
      document.querySelector('#message').innerHTML = alertBox('error', error.message);
      focusMessage('message');
    }
  }, 'Mengirim…'));
  publicReportDraft = { nodes: [...app.childNodes], isDirty: () => dirty };
}

function statusPage() {
  const savedReport = lastPublicReport();
  app.innerHTML = `
    <div class="status-shell">
      <section class="status-intro public-page-heading">
        <div class="status-intro-heading">
          <p class="eyebrow">Tindak lanjut laporan</p>
          <h1>Cek perkembangan laporan</h1>
          <p>Masukkan ID laporan dan PIN 8 digit yang diterima setelah laporan dikirim.</p>

        </div>
        <div class="status-assurance"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z"/><path d="M9 11V9a3 3 0 0 1 6 0v2M8 11h8v6H8z"/></svg></span><p><strong>ID dan PIN bersifat pribadi.</strong> Jangan membagikannya kepada orang lain.</p></div>
      </section>
      <section class="card status-panel" aria-labelledby="status-title">
        <h2 id="status-title">Masukkan data laporan</h2>
        <p class="section-intro">Gunakan informasi yang ditampilkan setelah laporan berhasil dikirim.</p>
        ${savedReport?.report_id && savedReport?.pin ? `<div class="saved-report-hint" role="status"><span>ID dan PIN laporan terakhir sudah terisi selama halaman ini tetap terbuka.</span><button id="forgetSavedReport" type="button" class="text-button">Hapus</button></div>` : ''}
        ${messageBox('statusError')}
        <form id="statusForm">
          <div class="field"><label for="statusId">ID laporan <small>Contoh: RPT-20260714-ABC123DEF456</small></label><input id="statusId" autocomplete="off" autocapitalize="characters" maxlength="40" placeholder="RPT-20260714-ABC123DEF456" value="${esc(savedReport?.report_id || '')}" required></div>
          <div class="field"><label for="statusPin">PIN laporan <small>PIN terdiri dari 8 digit</small></label><div class="password-control"><input id="statusPin" type="password" inputmode="numeric" minlength="8" maxlength="8" pattern="[0-9]{8}" autocomplete="one-time-code" placeholder="8 digit PIN" value="${esc(savedReport?.pin || '')}" required><button id="toggleStatusPin" type="button" class="password-toggle" aria-pressed="false" aria-label="Tampilkan PIN laporan">Tampilkan</button></div></div>
          <div class="form-actions status-submit"><button type="submit">Cek perkembangan</button></div>
        </form>
        <div id="statusResult" class="message" aria-live="polite"></div>
        <p class="status-new-report">Belum membuat laporan? <a href="#public">Laporkan kejadian kesehatan</a></p>
      </section>
    </div>`;

  document.querySelector('#forgetSavedReport')?.addEventListener('click', () => {
    saveLastPublicReport(null);
    document.querySelector('#statusId').value = '';
    document.querySelector('#statusPin').value = '';
    document.querySelector('.saved-report-hint')?.remove();
    document.querySelector('#statusId').focus();
  });
  bindSecretToggle('statusPin', 'toggleStatusPin', 'PIN laporan');

  document.querySelector('#statusForm').addEventListener('submit', event => submitForm(event, async () => {
    const errorTarget = document.querySelector('#statusError');
    const resultTarget = document.querySelector('#statusResult');
    const reportId = document.querySelector('#statusId').value.trim().toUpperCase();
    const pin = document.querySelector('#statusPin').value.trim();
    errorTarget.innerHTML = '';
    resultTarget.innerHTML = '';
    try {
      const result = await api('/api/public/status', { method: 'POST', body: JSON.stringify({ report_id: reportId, pin }) });
      const meaning = PUBLIC_STATUS_LABELS[result.current_status] || 'Status laporan telah diperbarui oleh petugas.';
      resultTarget.innerHTML = `<div class="status-result-card" role="status"><div class="status-result-head"><div><span>ID laporan</span><strong>${esc(result.report_id)}</strong></div>${status(result.current_status)}</div><p class="status-meaning">${esc(meaning)}</p><div class="status-meta"><div><span>Terakhir diperbarui</span><strong>${formatDate(result.updated_at)}</strong></div><div><span>Kesediaan dihubungi</span><strong>${result.allow_contact ? 'Bersedia' : 'Tidak bersedia'}</strong></div></div></div>`;
      focusMessage('statusResult');
    } catch (error) {
      errorTarget.innerHTML = alertBox('error', error.message);
      focusMessage('statusError');
    }
  }, 'Memeriksa…'));
}

async function loginPage(kind) {
  if (await guardAccountEntry(kind)) return;
  if (kind === 'cadre') return cadreLogin();
  const identifierField = `<div class="field"><label for="loginId">Email</label><input id="loginId" name="email" type="email" autocomplete="username" required></div>`;
  app.innerHTML = `
    <div class="auth-shell">
      <section class="auth-intro">
        <a class="back-link" href="#home">← Pilih peran lain</a>
        <div><p class="eyebrow">Akses aman</p><h1>Ruang kerja petugas</h1><p>Tinjau laporan, kelola prioritas, dan koordinasikan tindak lanjut.</p></div>
        <p class="auth-assurance"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>Akses dilindungi dan aktivitas tercatat.</p>
      </section>
      <section class="card auth"><p class="eyebrow">Masuk ke akun</p><h2>Selamat datang kembali</h2><p class="section-intro">Gunakan akun yang diberikan administrator.</p>${authNotice() ? alertBox('error', authNotice()) : ''}${messageBox('message')}<form id="login">
        ${identifierField}
        <div class="field"><label for="loginPassword">Kata sandi</label><div class="password-control"><input id="loginPassword" name="password" type="password" autocomplete="current-password" required><button id="toggleLoginPassword" type="button" class="password-toggle" aria-pressed="false" aria-label="Tampilkan kata sandi">Tampilkan</button></div></div>
        <div class="form-actions"><button type="submit">Masuk <span aria-hidden="true">→</span></button></div>
      </form><p class="auth-recovery">Kesulitan masuk? ${contactLink('information', 'Hubungi administrator instalasi', 'Hubungi pengelola layanan')}. Petugas tidak akan meminta kata sandi lama Anda.</p></section>
    </div>`;
  bindSecretToggle('loginPassword', 'toggleLoginPassword', 'kata sandi');
  document.querySelector('#login').addEventListener('submit', event => submitForm(event, async () => {
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(values) });
      accountLoginAcknowledgement = `Anda masuk sebagai ${result.user.name || result.user.email}.`;
      const destination = destinationAfterLogin('#staff-home', ['#staff-', '#admin-']);
      if (location.hash === destination) staffHome(); else location.hash = destination;
    } catch (error) { document.querySelector('#message').innerHTML = alertBox('error', error.message); }
  }, 'Masuk…'));
}

function cadreLogin() {
  const hashQuery = location.hash.includes('?') ? new URLSearchParams(location.hash.split('?')[1]) : new URLSearchParams();
  const quickCode = String(hashQuery.get('account') || '').trim().toUpperCase();
  const unifiedSaved = rememberedReporter();
  const rememberedCode = quickCode || storageRead(localStorage, rememberedLoginKey('cadre')) || (unifiedSaved?.kind === 'cadre' ? unifiedSaved.identifier : '');
  const identifierField = rememberedCode
    ? `<div class="remembered-identity"><span>Masuk sebagai kader</span><strong>${esc(rememberedCode)}</strong><input type="hidden" name="cadre_code" value="${esc(rememberedCode)}"><button id="forgetCadreCode" type="button" class="text-button">Ganti kode</button></div>`
    : `<div class="field"><label for="cadreLoginCode">Kode kader</label><input id="cadreLoginCode" name="cadre_code" autocapitalize="characters" autocomplete="username" placeholder="Contoh: KDR-01" required></div><label class="check compact-check"><input type="checkbox" name="remember_identifier"><span>Ingat kode di perangkat pribadi ini<small>Jangan pilih pada perangkat bersama.</small></span></label>`;
  app.innerHTML = `<div class="auth-shell"><section class="auth-intro"><a class="back-link" href="#home">← Pilih layanan lain</a><div><p class="eyebrow">Pelapor kader</p><h1>Portal Kader</h1><p>Kirim laporan kejadian lapangan dan pantau perkembangannya.</p></div><p class="auth-assurance"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>PIN tidak pernah disimpan di perangkat ini.</p></section><section class="card auth"><p class="eyebrow">Masuk ke akun</p><h2>${rememberedCode ? 'Selamat datang kembali' : 'Masuk sebagai kader'}</h2><p class="section-intro">${rememberedCode ? 'Masukkan PIN untuk melanjutkan.' : 'Gunakan kode kader yang diberikan pengelola layanan.'}</p>${authNotice() ? alertBox('error', authNotice()) : ''}${messageBox('message')}<form id="cadreLogin">${identifierField}<div class="field"><label for="cadreLoginPin">PIN 6 digit</label><div class="password-control"><input id="cadreLoginPin" name="pin" type="password" inputmode="numeric" minlength="6" maxlength="8" pattern="[0-9]{6}([0-9]{2})?" autocomplete="current-password" required><button id="toggleCadrePin" type="button" class="password-toggle">Tampilkan</button></div><p class="help">PIN kader lama 8 digit tetap dapat digunakan sampai diatur ulang. Lupa PIN? ${contactLink('information', 'Hubungi pengelola', 'Hubungi pengelola layanan')}. Petugas tidak akan meminta PIN lama Anda.</p></div><div class="form-actions"><button type="submit">Masuk <span aria-hidden="true">→</span></button></div></form></section></div>`;
  document.querySelector('#forgetCadreCode')?.addEventListener('click', () => {
    storageWrite(localStorage, rememberedLoginKey('cadre'), '');
    if (unifiedSaved?.kind === 'cadre') storageWrite(localStorage, reporterLoginKey, '');
    location.hash = '#cadre';
    cadreLogin();
  });
  bindSecretToggle('cadreLoginPin', 'toggleCadrePin', 'PIN kader');
  document.querySelector('#cadreLogin').addEventListener('submit', event => submitForm(event, async () => {
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const result = await api('/api/auth/cadre-login', { method: 'POST', body: JSON.stringify(values) });
      storageWrite(localStorage, rememberedLoginKey('cadre'), rememberedCode || values.remember_identifier ? String(values.cadre_code).trim().toUpperCase() : '');
      accountLoginAcknowledgement = `Anda masuk sebagai ${result.reporter.name || values.cadre_code}.`;
      const destination = result.reporter.profile_complete ? destinationAfterLogin('#home', ['#cadre-home','#cadre-report/','#cadre-profile']) : '#cadre-profile';
      if (location.hash === destination) render(); else location.hash = destination;
    } catch (error) { document.querySelector('#message').innerHTML = alertBox('error', error.message); }
  }, 'Memeriksa…'));
  document.querySelector('#cadreLoginPin').focus();
}

async function copyReporterAccessLink(button, identifier, destination = '#cadre') {
  const url = new URL(location.href);
  url.hash = `${destination}?account=${encodeURIComponent(identifier)}`;
  try {
    await navigator.clipboard.writeText(url.href);
    const original = button.textContent;
    button.textContent = 'Tautan disalin';
    setTimeout(() => { button.textContent = original; }, 1800);
  } catch {
    await actionDialog({ title: 'Salin tautan masuk pelapor', message: 'Salin tautan berikut secara manual.', confirmLabel: 'Tutup', cancelLabel: 'Batal', inputLabel: 'Tautan masuk', inputValue: url.href, inputReadonly: true });
  }
}

async function cadreHome() {
  try {
    const me = await api('/api/me');
    if (location.hash.split('?')[0]!=='#cadre-home')return;
    if (me.kind !== 'cadre') return loginPage('cadre');
    if (!me.profile_complete && portalView() !== 'history') { location.replace('#cadre-profile'); return; }
    ebsViews.syncCadreOwner(me.cadre_code);
    if(cadreReportDraft?.owner!==me.cadre_code)cadreReportDraft=null;
    if (cadreReportDraft?.isDirty()) {
      app.replaceChildren(...cadreReportDraft.nodes);
      const greeting = `Halo, ${me.nickname || me.name || 'Kader'}`;
      app.querySelector('.cadre-hero h1').textContent = greeting;
      app.querySelector('#cadreWelcomeTitle').textContent = greeting;
      leaveGuard = cadreReportDraft.isDirty;
      await cadreReportDraft.restore(portalView(), me);
      return;
    }
    const masters = await getMasters();
    if(location.hash.split('?')[0]!=='#cadre-home')return;
    app.innerHTML = `
      <div class="portal-introduction">
      <section class="card hero cadre-hero"><div class="page-head"><div><nav class="cadre-report-context" aria-label="Lokasi laporan"><a href="#cadre-home?view=history">Laporan saya</a><span aria-hidden="true">/</span><span>Buat laporan</span></nav><p class="eyebrow">Portal kader</p><h1>Halo, ${esc(me.nickname || me.name || 'Kader')}</h1><div class="cadre-identity"><span>${esc(me.cadre_code)}</span><span>${esc(me.village_name || me.village_code || 'Wilayah belum ditetapkan')}</span>${me.posyandu_name ? `<span>Posyandu ${esc(me.posyandu_name)}</span>` : ''}</div></div><button id="logout" class="secondary">Keluar</button></div></section>
      </div>
      ${loginAcknowledgement()}
      <div class="cadre-workspace-tabs" role="tablist" aria-label="Portal kader">
        <button id="cadreSummaryTab" class="cadre-workspace-tab active" type="button" role="tab" aria-selected="true" aria-controls="cadreSummaryPanel">Ringkasan</button>
        <button id="cadreReportTab" class="cadre-workspace-tab" type="button" role="tab" aria-selected="false" aria-controls="cadreReportPanel">Buat laporan</button>
        <button id="cadreHistoryTab" class="cadre-workspace-tab" type="button" role="tab" aria-selected="false" aria-controls="cadreHistoryPanel">Riwayat laporan <span id="cadreHistoryTabCount" class="tab-count">0</span></button>
      </div>
      ${messageBox('message')}
      <section id="cadreSummaryPanel" class="cadre-workspace-panel" role="tabpanel" aria-labelledby="cadreSummaryTab">
        <section id="cadreWelcome" class="card cadre-welcome" aria-labelledby="cadreWelcomeTitle">
          <div class="cadre-welcome-heading"><p class="eyebrow">Kabar laporan Anda</p><h2 id="cadreWelcomeTitle">Halo${me.nickname || me.name ? ', ' + esc(me.nickname || me.name) : ''}</h2><p>Terima kasih sudah membantu menjaga kesehatan warga${me.village_name ? ' di ' + esc(me.village_name) : ''}.</p></div>
          <div id="cadreWelcomeStatus" aria-live="polite" aria-atomic="true" aria-busy="true"><p class="help">Memuat perkembangan laporan Anda…</p></div>
        </section>
        <section class="card cadre-score-card"><h2>Kualitas laporan Anda</h2><div id="cadreMyScore" aria-live="polite" aria-busy="true"><p class="help">Memuat penilaian…</p></div><div id="cadreScoreMessage" aria-live="polite"></div><button id="refreshCadreScore" type="button" class="secondary">Perbarui penilaian</button></section>
        <section id="cadreStatistics" class="card cadre-statistics-card" aria-labelledby="cadreStatisticsTitle"><div class="section-heading"><div><p class="eyebrow">Catatan kepedulian Anda</p><h2 id="cadreStatisticsTitle">Bagikan cerita Anda</h2><p class="section-intro">Enam bulan terakhir dalam satu Story. Simpan dan bagikan saat Anda ingin.</p></div></div><p data-statistics-status role="status">Memuat statistik Anda…</p><div data-statistics-content hidden><div class="cadre-statistics-layout"><figure class="cadre-statistics-preview"><img data-statistics-image width="1080" height="1920" alt=""><figcaption>Siap untuk Story · PNG 1080 × 1920</figcaption></figure><div class="cadre-statistics-controls"><p data-statistics-period class="help"></p><dl data-statistics-counts class="cadre-statistics-counts"></dl><label class="check"><input data-statistics-name type="checkbox"><span>Tampilkan nama saya pada kartu</span></label><p class="help">Selesai ditinjau berarti peninjauan berakhir, termasuk laporan yang tidak ditindaklanjuti. Laporan sumber kejadian sudah terkait dengan kejadian terverifikasi.</p><a data-statistics-download class="button" download>Unduh Story PNG</a></div></div></div><button type="button" data-statistics-refresh class="secondary">Perbarui statistik</button></section>
      </section>
      <section id="cadreReportPanel" class="card cadre-workspace-panel" role="tabpanel" aria-labelledby="cadreReportTab">
        <div class="section-heading cadre-form-heading"><div><h2>Informasi kejadian</h2><p class="section-intro">Ceritakan kejadian yang ditemukan. Petugas akan meninjau laporan Anda.</p></div></div>
        <div class="form-state-line"><span id="cadreStepCaption">Langkah 1 dari 4</span><span id="cadreDraftState" class="draft-state" role="status">Belum ada isian baru</span></div><p class="form-storage-help">Isian belum dikirim ke petugas. Selesaikan sebelum menutup atau memuat ulang halaman.</p><form id="cadreForm" novalidate>
          <ol class="report-progress cadre-progress" aria-label="Tahapan laporan kader">
            <li data-cadre-progress="1" aria-current="step"><span>1</span><small>Kejadian</small></li>
            <li data-cadre-progress="2"><span>2</span><small>Tanda</small></li>
            <li data-cadre-progress="3"><span>3</span><small>Dampak</small></li>
            <li data-cadre-progress="4"><span>4</span><small>Tinjau</small></li>
          </ol>
          <p class="required-guide"><span aria-hidden="true">*</span> Wajib diisi</p>
        <fieldset class="cadre-section cadre-form-step" data-cadre-step="1">
          <legend>Pilih jenis kejadian <small class="required-label">Wajib</small></legend>
          <p class="fieldset-intro">Pilih satu jenis kejadian yang paling sesuai dengan kejadian yang ditemukan.</p>
          <div class="step-error hidden" data-cadre-error="1" role="alert"></div>
          <div id="cadreSignals" class="cadre-signal-options">
            <div class="event-choice-grid cadre-signal-grid">${masters.signals.map(item => {
              const presentation = cadreSignalPresentation(item);
              return `<label class="select-card event-choice"><input class="sr-only" type="radio" name="signal_code" value="${esc(item.signal_code)}" required><span class="event-choice-icon">${eventIcon(presentation.icon)}</span><span class="select-card-copy"><strong>${esc(presentation.label)}</strong><small>${esc(presentation.help)}</small></span><span class="choice-check" aria-hidden="true">✓</span></label>`;
            }).join('')}</div>
          </div>
          <div id="cadreSignalGuidance" class="selection-guidance hidden" aria-live="polite"></div>
          <div class="step-actions"><button type="button" data-cadre-next="2">Lanjut: tanda dan konteks</button></div>
        </fieldset>
        <fieldset class="cadre-section cadre-form-step" data-cadre-step="2" hidden>
          <legend>Tanda dan konteks</legend>
          <p class="fieldset-intro">Pilih informasi yang diketahui. Petugas akan menentukan klasifikasi setelah verifikasi.</p>
          <div class="step-error hidden" data-cadre-error="2" role="alert"></div>
          <div id="cadreStructured">
            <div id="cadreObservationBlock"><div class="option-heading-row"><h3 class="option-heading">Tanda yang terlihat</h3><button id="cadreShowAllObservations" type="button" class="text-button hidden" aria-expanded="false">Tampilkan semua tanda</button></div><p class="help">Pilih semua yang sesuai. Informasi ini membantu petugas menilai kejadian.</p><div id="cadreObservations" class="option-list">${masters.observations.map(item => `<label class="select-card multi-option" data-option-code="${esc(item.observation_code)}"><input class="sr-only" type="checkbox" name="observation_codes" value="${esc(item.observation_code)}"><span class="select-card-copy"><strong>${esc(item.public_label)}</strong><small>${esc(item.public_help)}</small></span><span class="choice-check" aria-hidden="true">✓</span></label>`).join('')}</div></div>
            <div id="cadreContextBlock"><div class="option-heading-row"><h3 class="option-heading">Konteks yang berkaitan <small id="cadreContextRequirement">Opsional</small></h3><button id="cadreShowAllContexts" type="button" class="text-button hidden" aria-expanded="false">Tampilkan semua konteks</button></div><p id="cadreImpliedContextHelp" class="help hidden">Konteks utama otomatis mengikuti jenis kejadian.</p><div id="cadreContexts" class="option-list">${masters.contexts.map(item => `<label class="select-card multi-option" data-option-code="${esc(item.context_code)}"><input class="sr-only" type="checkbox" name="context_codes" value="${esc(item.context_code)}"><span class="select-card-copy"><strong>${esc(item.public_label)}</strong><small>${esc(item.public_help)}</small></span><span class="choice-check" aria-hidden="true">✓</span></label>`).join('')}</div></div>
            <div id="cadreUrgency" class="urgency-hint hidden" role="status"></div>
          </div>
          <div class="step-actions split"><button type="button" class="secondary" data-cadre-back="1">Kembali</button><button type="button" data-cadre-next="3">Lanjut: lokasi dan dampak</button></div>
        </fieldset>
        <fieldset class="cadre-section cadre-form-step" data-cadre-step="3" hidden>
          <legend>Lokasi dan dampak</legend>
          <p class="fieldset-intro">Isi yang Anda ketahui. Pilih Belum diketahui jika jumlahnya belum dapat dipastikan.</p>
          <div class="step-error hidden" data-cadre-error="3" role="alert"></div>
          <section class="cadre-impact-block" aria-labelledby="cadreTimeTitle"><h3 id="cadreTimeTitle">Kapan mulai diketahui?</h3>
            <div class="field"><label for="cadreDate">Tanggal mulai atau pertama diketahui <span class="required-mark" aria-hidden="true">*</span></label><input id="cadreDate" type="date" name="event_start_date" max="${todayLocal()}" value="${todayLocal()}" required></div>
          </section>
          <section class="cadre-impact-block" aria-labelledby="cadrePlaceTitle"><h3 id="cadrePlaceTitle">Di mana kejadiannya?</h3>
            <div class="field"><label for="cadreVillage">Desa <span class="required-mark" aria-hidden="true">*</span><small>Desa binaan sudah dipilih. Ubah hanya bila melapor di desa lain.</small></label><select id="cadreVillage" name="village_code" required>${selectOptions(masters.villages, 'village_code', 'village_name')}</select></div>
          <div class="grid cadre-location-selects"><div class="field"><label for="cadreDukuh">Dukuh</label><select id="cadreDukuh" name="dukuh_id"><option value="">Belum diketahui</option></select></div><div class="field"><label for="cadreRW">RW</label><select id="cadreRW" name="rw_id"><option value="">Belum diketahui</option></select></div><div class="field"><label for="cadreRT">RT</label><select id="cadreRT" name="rt_id"><option value="">Belum diketahui</option></select></div></div><p id="cadreAreaHelp" class="help">Daftar Dukuh, RW, dan RT belum tersedia. Pilih Belum diketahui; titik peta dapat ditambahkan bila tersedia.</p><input id="cadreLocation" type="hidden" name="location_text">
          <input id="cadreLatitude" name="latitude" type="hidden"><input id="cadreLongitude" name="longitude" type="hidden">
          <details class="cadre-map-details"><summary>Tambahkan titik lokasi <span>Opsional</span></summary>
          <div class="actions"><button id="useCadreLocation" type="button" class="secondary">Gunakan lokasi saya</button><button id="openCadreMap" type="button" class="secondary">Pilih di peta</button></div>
          <p id="cadreCoordinateStatus" class="location-privacy">Koordinat hanya dikirim bila menggunakan lokasi perangkat atau peta.</p>
          <div id="cadreMapPicker" class="map-picker hidden"><p>Ketuk lokasi kejadian pada peta. Menggunakan peta OpenStreetMap dan memerlukan koneksi internet.</p>${messageBox('cadreMapMessage')}<div id="cadreMap" class="map-canvas" aria-label="Peta pemilih lokasi"></div><div class="actions"><button id="closeCadreMap" type="button" class="secondary">Tutup peta</button></div></div>
          </details></section>
          <section class="cadre-impact-block" aria-labelledby="cadreImpactTitle"><h3 id="cadreImpactTitle">Dampak yang diketahui</h3><p class="help">Gunakan jumlah yang Anda ketahui, tanpa menghitung orang yang sama lebih dari sekali.</p>
            <div class="field" id="cadreAffectedGroupField"><label for="cadreAffectedGroup">Kelompok yang terdampak <span class="required-mark" aria-hidden="true">*</span></label><select id="cadreAffectedGroup" name="affected_group" required>${affectedGroupOptions(true)}</select></div>
            <div class="grid cadre-impact-counts">
              <div class="field cadre-impact-count"><label id="cadreCasesLabel" for="cadreCases">Jumlah orang terdampak <span class="required-mark" aria-hidden="true">*</span></label><input id="cadreCases" type="number" name="reported_cases" min="0" step="1" placeholder="Isi jumlah" inputmode="numeric" aria-describedby="cadreCasesHelp" required><p id="cadreCasesHelp" class="help">Belum tahu jumlahnya? Pilih opsi di bawah.</p><label class="check cadre-unknown-choice"><input id="cadreCasesUnknown" type="checkbox" name="estimated_cases_unknown"><span>Jumlah terdampak belum diketahui</span></label></div>
              <div class="field cadre-impact-count" id="cadreDeathsField"><label for="cadreDeaths">Jumlah orang meninggal <span class="required-mark" aria-hidden="true">*</span></label><input id="cadreDeaths" type="number" name="reported_deaths" min="0" step="1" placeholder="Isi jumlah" inputmode="numeric" aria-describedby="cadreDeathsHelp" required><p id="cadreDeathsHelp" class="help">Isi 0 jika diketahui tidak ada yang meninggal.</p><label class="check cadre-unknown-choice"><input id="cadreDeathsUnknown" type="checkbox" name="estimated_deaths_unknown"><span>Jumlah meninggal belum diketahui</span></label></div>
            </div>
          </section>
          <div class="step-actions split"><button type="button" class="secondary" data-cadre-back="2">Kembali</button><button type="button" data-cadre-next="4">Lanjut: uraian dan tinjauan</button></div>
        </fieldset>
        <fieldset class="cadre-section cadre-form-step" data-cadre-step="4" hidden>
          <legend>Uraian, tindakan, dan tinjauan</legend>
          <div class="step-error hidden" data-cadre-error="4" role="alert"></div>
          <div class="field"><label for="cadreDescription">Apa yang diamati? <span class="required-mark" aria-hidden="true">*</span></label><textarea id="cadreDescription" name="description" maxlength="2000" aria-describedby="cadreDescriptionHelp cadreWordCount" placeholder="Ceritakan apa yang terjadi, sejak kapan, dan bagaimana Anda mengetahuinya." required></textarea><p id="cadreDescriptionHelp" class="help">Ceritakan apa yang terjadi, sejak kapan, dan bagaimana Anda mengetahui kejadian ini. Gunakan fakta yang Anda ketahui.</p><p id="cadreWordCount" class="help" aria-live="polite">0 kata · Tambahkan penjelasan bila kurang dari 20 kata. Laporan tetap dapat dikirim.</p></div>
          <div class="field"><label for="cadreAction">Tindakan awal <small>Jika sudah dilakukan</small></label><textarea id="cadreAction" name="initial_action" maxlength="1000" placeholder="Contoh: menghubungi bidan desa, mengarahkan ke fasilitas kesehatan, atau mengamankan lokasi."></textarea></div>
          <section class="report-review cadre-report-review" aria-labelledby="cadreReviewTitle"><div class="cadre-review-heading"><span class="cadre-review-symbol" aria-hidden="true">✓</span><div><p class="eyebrow">Tinjauan sebelum dikirim</p><h3 id="cadreReviewTitle">Periksa laporan Anda</h3><p>Periksa lokasi, jumlah, dan cerita Anda. Pilih Ubah untuk memperbaiki bagian tertentu.</p></div></div><dl id="cadreReportReview" aria-live="polite"></dl><p class="cadre-review-footnote">Petugas akan menilai informasi ini dan meminta klarifikasi bila diperlukan.</p></section>
          <div class="step-actions split"><button type="button" class="secondary" data-cadre-back="3">Kembali</button><button type="submit">Kirim laporan kader</button></div>
        </fieldset>
        </form>
      </section>
      <section id="cadreHistoryPanel" class="card cadre-workspace-panel" role="tabpanel" aria-labelledby="cadreHistoryTab" hidden><div class="section-heading cadre-history-heading"><div><h2>Daftar laporan</h2><p class="section-intro">Lihat perkembangan dan hasil laporan Anda. Laporan yang perlu dijawab selalu tampil lebih dahulu.</p></div><div class="actions"><button type="button" id="refreshCadreHistory" class="secondary">Perbarui</button><button type="button" data-cadre-open="report">${uiIcon('incident')} Buat laporan</button></div></div><div id="cadreHistoryFilters" class="cadre-history-filters" role="group" aria-label="Filter riwayat laporan">${[['all','Semua laporan'],['pending','Perlu jawaban'],['review','Dalam peninjauan'],['closed','Selesai']].map(([value,label])=>`<button type="button" class="secondary" data-history-view="${value}" aria-pressed="${value==='all'}">${label}<span class="tab-count" data-history-count="${value}">—</span></button>`).join('')}</div><p id="cadreHistoryNotice" class="help" role="status"></p><div id="cadreHistoryMessage" class="message" aria-live="polite"></div><p id="cadreReportCount" class="help" role="status">Memuat riwayat…</p><div id="mine" aria-live="polite"><p class="muted">Memuat laporan…</p></div><div id="cadrePagination" class="pagination"></div></section>`;

    cadreRefreshController?.abort();
    cadreRefreshController = new AbortController();
    let refreshCadrePanel = () => {};
    const setCadrePanel = (panel, focus = true, refresh = true) => {
      const panels = {summary:'Summary',report:'Report',history:'History'};
      panel = panel === 'followup' ? 'history' : panel in panels ? panel : 'summary';
      cadreActivePanel = panel;
      document.body.dataset.portalView = panel;
      const pageHeading = document.querySelector('.cadre-hero h1');
      const reportContext = document.querySelector('.cadre-report-context');
      if (reportContext) reportContext.hidden = panel !== 'report';
      if (pageHeading) pageHeading.textContent = {summary:'Ringkasan Anda', report: 'Buat laporan kejadian', history: 'Riwayat laporan' }[panel];
      document.title = `${pageHeading.textContent} · ${branding.displayName}`;
      for (const [key, part] of Object.entries(panels)) {
        const active=key===panel, tab=document.querySelector(`#cadre${part}Tab`);
        document.querySelector(`#cadre${part}Panel`).hidden=!active;
        tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      setPortalLocation(panel);
      if(refresh)refreshCadrePanel(panel);
      if (focus) {
        const heading = document.querySelector(`#cadre${panels[panel]}Panel h2`);
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    };
    document.querySelector('#cadreReportTab').addEventListener('click', () => setCadrePanel('report'));
    document.querySelector('#cadreSummaryTab').addEventListener('click', () => setCadrePanel('summary'));
    const openCadrePanel = event => {
      const button = event.target.closest('[data-cadre-open]');
      if (button) setCadrePanel(button.dataset.cadreOpen);
    };
    document.querySelector('#cadreHistoryPanel').addEventListener('click', openCadrePanel);
    document.querySelector('#cadreHistoryTab').addEventListener('click', () => setCadrePanel('history'));
    setupTabKeyboard('.cadre-workspace-tab');
    setCadrePanel(portalView(), false);

    const historyPageSize = 8;
    const historyOptions=cadreHistoryOptions();
    let historyOffset = historyOptions.offset;
    let historyRevision = 0;
    let lastHistoryCheck = 0;
    let historyView = historyOptions.filter;
    let historyFocusId = '';
    let loadedHistoryView = historyView, loadedHistoryOffset = historyOffset;
    const historyContainer = document.querySelector('#mine');
    const welcomeStatus = document.querySelector('#cadreWelcomeStatus');
    let scoreRevision=0;
    let qualityMarkup='';
    const loadMyScore=async()=>{
      const revision=++scoreRevision,target=document.querySelector('#cadreMyScore'),message=document.querySelector('#cadreScoreMessage');
      target.setAttribute('aria-busy','true');
      try{
        const score=await api('/api/sbm/my-score');if(!target.isConnected||revision!==scoreRevision)return;
        const markup=renderCadreQuality(score);
        if(markup!==qualityMarkup){
          const details=target.querySelector('details'),wasOpen=details?.open,wasFocused=document.activeElement===details?.querySelector('summary');
          target.innerHTML=markup;qualityMarkup=markup;
          const nextDetails=target.querySelector('details');if(nextDetails){nextDetails.open=Boolean(wasOpen);if(wasFocused)nextDetails.querySelector('summary').focus({preventScroll:true});}
        }
        message.replaceChildren();
      }catch(error){
        if(target.isConnected&&revision===scoreRevision){
          if(!qualityMarkup)target.innerHTML='<p class="help">Penilaian belum tersedia saat ini.</p>';
          message.innerHTML=alertBox('warning',qualityMarkup?'Pembaruan belum dapat dimuat. Penilaian yang tampil berasal dari pemuatan terakhir. Gunakan Perbarui penilaian untuk mencoba lagi.':'Penilaian belum dapat dimuat. Gunakan Perbarui penilaian untuk mencoba lagi.');
        }
      }finally{if(target.isConnected&&revision===scoreRevision)target.setAttribute('aria-busy','false');}
    };
    document.querySelector('#refreshCadreScore').addEventListener('click',()=>void loadMyScore());
    void loadMyScore();
    const statistics=mountCadreStatistics(document.querySelector('#cadreStatistics'),{name:()=>me.nickname || me.name,load:()=>api('/api/sbm/my-statistics')});
    void statistics.refresh();
    let welcomeSummary = null;
    let welcomeMarkup = '';
    const updateWelcome = (summary, failed = false) => {
      const known = value => value !== null && value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
      const complete = summary && ['total','pending','review','closed'].every(key => known(summary[key]));
      if (complete) welcomeSummary = Object.fromEntries(['total','pending','review','closed'].map(key => [key,Number(summary[key])]));
      const counts = welcomeSummary;
      let heading = 'Perkembangan laporan belum dapat dimuat';
      let message = 'Coba lagi saat koneksi Anda tersedia. Anda tetap bisa membuat laporan.';
      if (counts) {
        heading = counts.pending ? 'Perlu perhatian Anda' : counts.total ? 'Kabar laporan Anda' : 'Mari mulai dari kejadian yang Anda temukan';
        message = counts.pending ? `${counts.pending} laporan perlu jawaban Anda. Informasi tambahan membantu petugas meninjau kejadian.`
          : counts.review ? `Petugas masih meninjau ${counts.review} laporan Anda. Saat ini tidak ada pertanyaan yang perlu Anda jawab.`
          : counts.total ? 'Peninjauan laporan Anda sudah selesai. Anda bisa melihat hasil dan catatan petugas.'
          : 'Laporan Anda membantu petugas mengetahui kejadian di masyarakat. Setelah mengirim, Anda bisa mengikuti perkembangannya di sini.';
      }
      const mainAction = counts?.pending ? '<button type="button" data-welcome-filter="pending">Jawab pertanyaan</button>'
        : counts?.closed ? '<button type="button" data-welcome-filter="closed">Lihat hasil peninjauan</button>'
        : counts?.total ? '<button type="button" data-welcome-filter="all">Lihat laporan saya</button>' : '';
      const metrics = counts?.total ? `<div class="cadre-welcome-counts" role="group" aria-label="Ringkasan laporan Anda">${[['pending','Perlu jawaban'],['review','Belum selesai'],['closed','Selesai ditinjau']].map(([key,label]) => `<button type="button" class="secondary cadre-welcome-count${key==='pending' && counts[key] ? ' needs-answer' : ''}" data-welcome-filter="${key}"${counts[key] ? '' : ' disabled'}><strong>${counts[key]}</strong><span>${label}</span></button>`).join('')}</div>` : '';
      const notice = failed ? `<p class="cadre-welcome-refresh-notice">${counts ? 'Pembaruan belum dapat dimuat. Ringkasan ini berasal dari pemuatan terakhir.' : 'Ringkasan belum tersedia.'} <button type="button" class="text-button" data-welcome-retry>Coba lagi</button></p>` : '';
      const markup = `<div class="cadre-welcome-content"><div class="cadre-welcome-copy"><h3>${heading}</h3><p>${message}</p><div class="actions">${mainAction}<button type="button" class="${mainAction ? 'secondary' : ''}" data-cadre-open="report">Buat laporan</button></div></div>${metrics}</div>${notice}`;
      // Keep keyboard focus on the current action when a refresh changes nothing.
      if (markup !== welcomeMarkup) { welcomeStatus.innerHTML = markup; welcomeMarkup = markup; }
      welcomeStatus.setAttribute('aria-busy','false');
      document.querySelector('#cadreWelcome').classList.toggle('has-pending', !failed && Boolean(counts?.pending));
    };
    document.querySelector('#cadreWelcome').addEventListener('click', event => {
      const filter = event.target.closest('[data-welcome-filter]');
      if (filter) {
        historyView = filter.dataset.welcomeFilter; historyOffset = 0; historyFocusId = '';
        setCadrePanel('history');
      } else if (event.target.closest('[data-welcome-retry]')) { void loadHistory(); }
      else { openCadrePanel(event); }
    });
    const load = async () => {
      const revision = ++historyRevision;
      lastHistoryCheck = Date.now();
      let offset = historyOffset;
      const focusId=historyFocusId;
      const data = await api(`/api/cadre/reports?limit=${historyPageSize}&offset=${offset}&view=${historyView}${focusId?'&focus_report='+encodeURIComponent(focusId):''}`);
      if (!historyContainer.isConnected || revision !== historyRevision) return;
      if (focusId) {historyFocusId='';offset=data.offset ?? offset;historyOffset=offset;}
      if (offset > 0 && offset >= data.total) {
        historyOffset=data.total?Math.floor((data.total-1)/historyPageSize)*historyPageSize:0;
        void loadHistory();return;
      }
      loadedHistoryView=historyView;loadedHistoryOffset=offset;
      const params=new URLSearchParams(location.hash.split('?')[1] || '');
      if(params.get('view')==='history'){params.set('filter',historyView);params.set('offset',String(offset));history.replaceState(null,'','#cadre-home?'+params);}
      document.querySelectorAll('[data-history-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.historyView===historyView)));
      const summary=data.summary || {total:data.total,pending:null,review:null,closed:null};
      updateWelcome(summary);
      document.querySelector('#cadreReportCount').textContent = `${data.total} laporan${historyView==='all'?'': ' pada filter ini'}`;
      document.querySelector('#cadreHistoryTabCount').textContent = summary.total;
      document.querySelector('#cadreHistoryMessage').replaceChildren();
      document.querySelector('#cadreHistoryNotice').textContent=Number(summary.pending)>0?`${summary.pending} laporan membutuhkan jawaban Anda. Buka Jawab pertanyaan untuk melengkapinya.`:'Tidak ada pertanyaan yang menunggu jawaban Anda.';
      document.querySelectorAll('[data-history-count]').forEach(el=>{el.textContent=summary[el.dataset.historyCount==='all'?'total':el.dataset.historyCount] ?? '—';});
      historyContainer.innerHTML = data.rows.length ? ebsViews.cadreList(data.rows) : empty(historyView==='all'?'Belum ada laporan':'Tidak ada laporan pada filter ini',historyView==='all'?'Laporan yang Anda kirim akan tercatat di sini.':'Pilih Semua laporan untuk melihat riwayat lainnya.');
      historyContainer.querySelectorAll('[data-cadre-detail-action]').forEach(link=>link.addEventListener('click',()=>{
        const scroll=Math.round(window.scrollY),params=new URLSearchParams({view:'history',filter:historyView,offset:historyOffset,scroll});
        history.replaceState(null,'','#cadre-home?'+params);
        link.href=link.getAttribute('href').split('?')[0]+'?'+new URLSearchParams({filter:historyView,offset:historyOffset,scroll});
      }));
      const start = data.total ? historyOffset + 1 : 0;
      const end = Math.min(historyOffset + data.rows.length, data.total);
      document.querySelector('#cadrePagination').innerHTML = data.total > historyPageSize ? `<span>${start}–${end} dari ${data.total}</span><div class="actions"><button type="button" class="secondary" data-cadre-page="previous" ${historyOffset === 0 ? 'disabled' : ''}>Sebelumnya</button><button type="button" class="secondary" data-cadre-page="next" ${historyOffset + historyPageSize >= data.total ? 'disabled' : ''}>Berikutnya</button></div>` : '';
      document.querySelectorAll('[data-cadre-page]').forEach(button => button.addEventListener('click', async () => {
        historyOffset = button.dataset.cadrePage === 'next' ? historyOffset + historyPageSize : Math.max(0, historyOffset - historyPageSize);
        await loadHistory();
        document.querySelector('#mine').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
    };
    const loadHistory = async (failureNotice = '') => {
      const revision = historyRevision + 1;
      try { await load(); }
      catch (error) {
        if (!historyContainer.isConnected || revision !== historyRevision) return;
        updateWelcome(null, true);
        const notice=typeof failureNotice==='string'?failureNotice:'';
        document.querySelector('#cadreHistoryMessage').innerHTML=alertBox(notice?'warning':'error',notice || error.message)+'<button type="button" class="secondary" id="retryCadreHistory">Muat ulang riwayat</button>';
        document.querySelector('#retryCadreHistory').addEventListener('click',loadHistory);
        if (historyContainer.querySelector('.cadre-report-row')) {
          historyView=loadedHistoryView;historyOffset=loadedHistoryOffset;
          document.querySelectorAll('[data-history-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.historyView===historyView)));
          return;
        }
        document.querySelector('#cadreReportCount').textContent = '—';
        document.querySelector('#cadreHistoryTabCount').textContent = '—';
        historyContainer.replaceChildren();
      }
    };
    document.querySelector('#refreshCadreHistory').addEventListener('click',()=>void loadHistory());
    document.querySelectorAll('[data-history-view]').forEach(button=>button.addEventListener('click',()=>{
      historyView=button.dataset.historyView;historyOffset=0;
      historyFocusId='';
      document.querySelectorAll('[data-history-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      void loadHistory();
    }));
    refreshCadrePanel = panel => {
      if (panel === 'history' || panel === 'summary') {
        void loadHistory();
        if(panel==='summary'){void loadMyScore();void statistics.refresh();}
        }
    };
    app.addEventListener('cadre-report-updated', () => { void loadHistory(); void loadMyScore(); void statistics.refresh(); }, {signal: cadreRefreshController.signal});
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible' && historyContainer.isConnected && Date.now() - lastHistoryCheck >= 60000) { void loadHistory(); if(cadreActivePanel==='summary'){void loadMyScore();void statistics.refresh();} }
    };
    window.addEventListener('focus', refreshOnReturn, {signal: cadreRefreshController.signal});
    document.addEventListener('visibilitychange', refreshOnReturn, {signal: cadreRefreshController.signal});
    if(portalView()==='history')await loadHistory();else void loadHistory();
    const cadreForm = document.querySelector('#cadreForm');
    const cadreVillage = document.querySelector('#cadreVillage');
    if (me.village_code && [...cadreVillage.options].some(option => option.value === me.village_code)) cadreVillage.value = me.village_code;
    const locations=masters.locations||[],dukuh=document.querySelector('#cadreDukuh'),rw=document.querySelector('#cadreRW'),rt=document.querySelector('#cadreRT');
    const fillArea=(select,level,parent)=>{const selected=select.value,rows=locations.filter(r=>r.village_code===cadreVillage.value&&r.level===level&&(r.parent_id||'')===(parent||''));select.innerHTML='<option value="">Belum diketahui</option>'+rows.map(r=>`<option value="${esc(r.location_id)}">${esc(r.label)}</option>`).join('');if(rows.some(r=>r.location_id===selected))select.value=selected;select.disabled=level!=='DUKUH'&&!parent;};
    const syncAreas=(changed='')=>{if(['village','dukuh'].includes(changed)){rw.value='';rt.value='';}if(changed==='village'){dukuh.value='';cadreForm.elements.latitude.value='';cadreForm.elements.longitude.value='';}if(changed==='rw')rt.value='';fillArea(dukuh,'DUKUH','');fillArea(rw,'RW',dukuh.value);fillArea(rt,'RT',rw.value);cadreForm.elements.location_text.value=[[dukuh,'Dukuh'],[rw,'RW'],[rt,'RT']].filter(([s])=>s.value).map(([s,label])=>`${label} ${s.selectedOptions[0].textContent}`).join(' · ')||'Dukuh / RW / RT belum diketahui';document.querySelector('#cadreAreaHelp').textContent=locations.some(r=>r.village_code===cadreVillage.value)?'Pilih wilayah yang diketahui. RW mengikuti Dukuh, dan RT mengikuti RW.':'Daftar Dukuh, RW, dan RT belum tersedia. Pilih Belum diketahui; titik peta dapat ditambahkan bila tersedia.';};
    cadreVillage.addEventListener('change',()=>{syncAreas('village');updateCadreReview();});dukuh.addEventListener('change',()=>{syncAreas('dukuh');updateCadreReview();});rw.addEventListener('change',()=>{syncAreas('rw');updateCadreReview();});rt.addEventListener('change',()=>{syncAreas();updateCadreReview();});syncAreas();
    let showAllCadreObservations = false;
    let showAllCadreContexts = false;
    let currentCadreSignal = '';
    const cadreSelectionMemory = new Map();
    let cadreStep = 1;
    let editingCadreReview = false;

    const filterCadreOptions = (containerId, allowedCodes, expanded, buttonId) => {
      const options = [...document.querySelectorAll(`#${containerId} [data-option-code]`)];
      const hasFilter = Array.isArray(allowedCodes) && allowedCodes.length < options.length;
      options.forEach(option => {
        const input = option.querySelector('input');
        option.hidden = hasFilter && !expanded && !allowedCodes.includes(option.dataset.optionCode) && !input.checked;
      });
      const button = document.querySelector(`#${buttonId}`);
      button.classList.toggle('hidden', !hasFilter);
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? 'Tampilkan pilihan utama' : containerId === 'cadreObservations' ? 'Tampilkan semua tanda' : 'Tampilkan semua konteks';
    };

    const selectedCodes = name => [...cadreForm.querySelectorAll(`[name="${name}"]:checked`)].map(input => input.value);

    const signalConfig = signalCode => {
      const eventType = CADRE_SIGNAL_EVENT_MAP[signalCode] || '';
      return CADRE_SIGNAL_FORM_CONFIG[signalCode] || EVENT_FORM_CONFIG[eventType] || EVENT_FORM_CONFIG.OTHER;
    };

    const rememberCadreSelections = signalCode => {
      if (!signalCode) return;
      cadreSelectionMemory.set(signalCode, {
        observations: selectedCodes('observation_codes'),
        contexts: selectedCodes('context_codes'),
      });
    };

    const restoreCadreSelections = signalCode => {
      const config = signalConfig(signalCode);
      const previous = {
        observations: selectedCodes('observation_codes'),
        contexts: selectedCodes('context_codes'),
      };
      const remembered = cadreSelectionMemory.get(signalCode);
      const compatible = (values, allowed) => Array.isArray(allowed) ? values.filter(value => allowed.includes(value)) : values;
      const next = remembered || {
        observations: compatible(previous.observations, config.observations),
        contexts: compatible(previous.contexts, config.contexts),
      };
      cadreForm.querySelectorAll('[name="observation_codes"], [name="context_codes"]').forEach(input => {
        input.disabled = false;
        input.checked = input.name === 'observation_codes' ? next.observations.includes(input.value) : next.contexts.includes(input.value);
        input.closest('label')?.classList.remove('is-implied');
      });
    };

    const updateCadreReview = () => {
      const signal = masters.signals.find(item => item.signal_code === cadreForm.elements.signal_code.value);
      const village = cadreForm.elements.village_code.selectedOptions[0]?.textContent || 'Belum dipilih';
      const hasCoordinates = cadreForm.elements.latitude.value && cadreForm.elements.longitude.value;
      const location = cadreForm.elements.location_text.value.trim() || (hasCoordinates ? 'Titik peta/lokasi perangkat' : 'Lokasi belum diberikan');
      const eventType = CADRE_SIGNAL_EVENT_MAP[cadreForm.elements.signal_code.value] || '';
      const animalEvent = eventType === 'ANIMAL_EVENT';
      const observationLabels = selectedCodes('observation_codes').map(code => masters.observations.find(item => item.observation_code === code)?.public_label || code);
      const contextLabels = selectedCodes('context_codes').map(code => masters.contexts.find(item => item.context_code === code)?.public_label || code);
      document.querySelector('#cadreCoordinateStatus').textContent = hasCoordinates
        ? 'Titik lokasi sudah dipilih dan akan dikirim bersama laporan.'
        : 'Koordinat hanya dikirim bila menggunakan lokasi perangkat atau peta.';
      const rows = [
        ['Jenis kejadian', signal?.cadre_definition || 'Belum dipilih', 1, 'cadreSignals'],
        ['Tanggal mulai', formatDate(cadreForm.elements.event_start_date.value), 3, 'cadreDate'],
        ['Desa', village, 3, 'cadreVillage'],
        ['Lokasi', location, 3, 'cadreDukuh'],
        ['Kelompok terdampak', affectedGroupLabel(cadreForm.elements.affected_group.value), 3, 'cadreAffectedGroup'],
        [animalEvent ? 'Hewan/unggas terdampak' : 'Orang terdampak', cadreForm.elements.estimated_cases_unknown.checked?'Belum diketahui':cadreForm.elements.reported_cases.value || 'Belum diisi', 3, 'cadreCasesUnknown'],
        ...(!animalEvent ? [
          ['Meninggal', cadreForm.elements.estimated_deaths_unknown.checked?'Belum diketahui':cadreForm.elements.reported_deaths.value || 'Belum diisi', 3, 'cadreDeathsUnknown'],
        ] : []),
      ];
      const editButton = (label, step, target) => `<button type="button" class="text-button review-edit" data-cadre-review-edit="${step}" data-cadre-review-target="${target}" aria-label="Ubah ${esc(label)}">Ubah</button>`;
      document.querySelector('#cadreReportReview').innerHTML = `${rows.map(([label, value, step, target]) => `<div><dt>${esc(label)} ${editButton(label, step, target)}</dt><dd>${esc(value)}</dd></div>`).join('')}
        <div class="span-2"><dt>Tanda yang terlihat ${editButton('tanda yang terlihat', 2, 'cadreObservations')}</dt><dd>${esc(observationLabels.join(', ') || 'Tidak ada tanda yang dipilih')}</dd></div>
        <div class="span-2"><dt>Konteks ${editButton('konteks', 2, 'cadreContexts')}</dt><dd>${esc(contextLabels.join(', ') || 'Tidak ada konteks yang dipilih')}</dd></div>
        <div class="span-2"><dt>Uraian ${editButton('uraian', 4, 'cadreDescription')}</dt><dd class="preserve-lines">${esc(cadreForm.elements.description.value.trim() || 'Belum diisi')}</dd></div>
        <div class="span-2"><dt>Tindakan awal ${editButton('tindakan awal', 4, 'cadreAction')}</dt><dd class="preserve-lines">${esc(cadreForm.elements.initial_action.value.trim() || 'Belum ada tindakan yang dicatat')}</dd></div>`;
      const words=cadreForm.elements.description.value.trim().split(/\s+/u).filter(Boolean).length;
      document.querySelector('#cadreWordCount').textContent=words<20?`${words} kata · Tambahkan penjelasan bila kurang dari 20 kata. Laporan tetap dapat dikirim.`:`${words} kata · Periksa kembali fakta, waktu, dan sumber informasi Anda.`;
      document.querySelector('#cadreWordCount').classList.toggle('description-needs-detail',words>0&&words<20);
    };

    const updateCadreSignal = () => {
      const signalCode = cadreForm.elements.signal_code.value;
      const eventType = CADRE_SIGNAL_EVENT_MAP[signalCode] || '';
      const config = signalConfig(signalCode);
      const signal = masters.signals.find(item => item.signal_code === signalCode);
      const event = masters.event_types.find(item => item.event_type === eventType);
      cadreForm.querySelectorAll('[name="context_codes"]').forEach(input => {
        input.disabled = false;
        input.closest('label')?.classList.remove('is-implied');
      });
      const defaultContext = CADRE_SIGNAL_DEFAULT_CONTEXT[signalCode];
      const defaultInput = defaultContext ? cadreForm.querySelector(`[name="context_codes"][value="${defaultContext}"]`) : null;
      if (defaultInput) {
        const unknown = cadreForm.querySelector('[name="context_codes"][value="UNKNOWN_CONTEXT"]');
        if (unknown) unknown.checked = false;
        defaultInput.checked = true;
        defaultInput.disabled = true;
        defaultInput.closest('label')?.classList.add('is-implied');
      }
      const guidance = document.querySelector('#cadreSignalGuidance');
      guidance.classList.toggle('hidden', !signalCode);
      guidance.innerHTML = signal ? `<span class="event-choice-icon">${eventIcon(event?.icon_key || 'other')}</span><span><strong>Dicatat sebagai ${esc(event?.public_label || 'kejadian kesehatan')}</strong><small>Lengkapi tanda dan konteks yang diketahui sebelum melanjutkan.</small></span>` : '';
      document.querySelector('#cadreObservationBlock').classList.toggle('hidden', Array.isArray(config.observations) && config.observations.length === 0);
      filterCadreOptions('cadreObservations', config.observations, showAllCadreObservations, 'cadreShowAllObservations');
      const allowedContexts = defaultContext && Array.isArray(config.contexts)
        ? config.contexts.filter(code => code !== 'UNKNOWN_CONTEXT')
        : config.contexts;
      filterCadreOptions('cadreContexts', allowedContexts, showAllCadreContexts, 'cadreShowAllContexts');
      const unknownContextCard = cadreForm.querySelector('[name="context_codes"][value="UNKNOWN_CONTEXT"]')?.closest('[data-option-code]');
      if (defaultContext && unknownContextCard) unknownContextCard.hidden = true;
      document.querySelector('#cadreImpliedContextHelp').classList.toggle('hidden', !defaultContext);
      document.querySelector('#cadreContextRequirement').textContent = config.contextsRequired ? 'Wajib' : 'Opsional';

      const cases = document.querySelector('#cadreCases');
      const deaths = document.querySelector('#cadreDeaths');
      document.querySelector('#cadreCasesLabel').innerHTML = `${esc(config.casesLabel || 'Jumlah orang terdampak')} <span class="required-mark" aria-hidden="true">*</span>`;
      cases.min = String(config.casesMin ?? 0);
      deaths.min = String(config.deathsMin ?? 0);
      const hideHumanOutcomes = eventType === 'ANIMAL_EVENT';
      const wasAnimal=document.querySelector('#cadreDeathsField').classList.contains('hidden');
      document.querySelector('#cadreDeathsField').classList.toggle('hidden', hideHumanOutcomes);
      if (hideHumanOutcomes){deaths.value='0';cadreForm.elements.estimated_deaths_unknown.checked=false;}
      else if(wasAnimal)deaths.value='';
      deaths.disabled=hideHumanOutcomes||cadreForm.elements.estimated_deaths_unknown.checked;
      deaths.required=!deaths.disabled;
      const affectedGroupField = document.querySelector('#cadreAffectedGroupField');
      const affectedGroup = cadreForm.elements.affected_group;
      affectedGroupField.classList.toggle('hidden', hideHumanOutcomes);
      affectedGroup.querySelector('option[value="ANIMAL"]').hidden = !hideHumanOutcomes;
      if (hideHumanOutcomes) affectedGroup.value = 'ANIMAL';
      else if (affectedGroup.value === 'ANIMAL') affectedGroup.value = '';
      document.querySelector('#cadreDescription').placeholder = hideHumanOutcomes
        ? 'Jelaskan jenis hewan/unggas, jumlah yang sakit atau mati, sejak kapan, dan kondisi lingkungannya.'
        : 'Jelaskan apa yang terjadi, sejak kapan, dan kelompok yang terdampak.';

      const urgent = Boolean(Number(event?.immediate_notification))
        || [...cadreForm.querySelectorAll('[name="observation_codes"]:checked')].some(input =>
          Boolean(Number(masters.observations.find(item => item.observation_code === input.value)?.immediate_notification)))
        || [...cadreForm.querySelectorAll('[name="context_codes"]:checked')].some(input =>
          Boolean(Number(masters.contexts.find(item => item.context_code === input.value)?.immediate_notification)));
      const urgency = document.querySelector('#cadreUrgency');
      urgency.innerHTML = eventType === 'ANIMAL_EVENT'
        ? '<strong>Hindari kontak langsung dengan hewan sakit atau mati.</strong> Catat jenis hewan dan jumlahnya pada uraian.'
        : '<strong>Laporan ini perlu segera diteruskan.</strong> Pastikan lokasi dan uraian cukup jelas untuk verifikasi.';
      urgency.classList.toggle('hidden', !urgent);
      updateCadreReview();
    };

    const clearCadreStepError = step => {
      const error = document.querySelector(`[data-cadre-error="${step}"]`);
      error.textContent = '';
      error.classList.add('hidden');
      document.querySelector(`[data-cadre-step="${step}"]`)?.querySelectorAll('[aria-invalid="true"]').forEach(element => element.removeAttribute('aria-invalid'));
    };

    const failCadreStep = (step, message, target) => {
      const error = document.querySelector(`[data-cadre-error="${step}"]`);
      error.textContent = message;
      error.classList.remove('hidden');
      target?.setAttribute?.('aria-invalid', 'true');
      target?.focus?.({ preventScroll: true });
      error.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    };

    const validateCadreStep = step => {
      clearCadreStepError(step);
      if (step === 1 && !cadreForm.elements.signal_code.value) return failCadreStep(1, 'Pilih jenis kejadian sebelum melanjutkan.', document.querySelector('#cadreSignals'));
      if (step === 2) {
        const eventType = CADRE_SIGNAL_EVENT_MAP[cadreForm.elements.signal_code.value];
        const config = signalConfig(cadreForm.elements.signal_code.value);
        if (['PERSON_ILLNESS', 'CLUSTER', 'SCHOOL_WORKPLACE'].includes(eventType) && !selectedCodes('observation_codes').length) {
          return failCadreStep(2, 'Pilih sedikitnya satu tanda yang terlihat.', document.querySelector('#cadreObservations'));
        }
        if (config.contextsRequired && !selectedCodes('context_codes').length) {
          return failCadreStep(2, 'Pilih konteks gigitan, kontak, atau jenis hewan yang berkaitan.', document.querySelector('#cadreContexts'));
        }
      }
      if (step === 3) {
        const requiredFields = [
          [cadreForm.elements.village_code, 'Pilih desa lokasi kejadian.'],
          [cadreForm.elements.event_start_date, 'Isi tanggal mulai atau pertama diketahui.'],
          [cadreForm.elements.affected_group, 'Pilih kelompok yang terdampak.'],
          ...(!cadreForm.elements.estimated_cases_unknown.checked?[[cadreForm.elements.reported_cases, 'Isi jumlah yang terdampak.']]:[]),
          ...(!cadreForm.elements.reported_deaths.disabled?[[cadreForm.elements.reported_deaths, 'Isi jumlah meninggal, isi 0 jika tidak ada, atau pilih Belum diketahui.']]:[]),
        ];
        for (const [field, message] of requiredFields) {
          if (!String(field.value || '').trim() || !field.validity.valid) return failCadreStep(3, message, field);
        }
        if(!cadreForm.elements.estimated_cases_unknown.checked&&!cadreForm.elements.reported_deaths.disabled&&Number(cadreForm.elements.reported_deaths.value)>Number(cadreForm.elements.reported_cases.value))return failCadreStep(3,'Jumlah meninggal tidak boleh melebihi jumlah terdampak.',cadreForm.elements.reported_deaths);
        if (!cadreForm.elements.location_text.value.trim() && !(cadreForm.elements.latitude.value && cadreForm.elements.longitude.value)) {
          return failCadreStep(3, 'Pilih lokasi yang diketahui atau gunakan Belum diketahui.', cadreForm.elements.dukuh_id);
        }
      }
      if (step === 4 && !cadreForm.elements.description.value.trim()) return failCadreStep(4, 'Jelaskan apa yang diamati sebelum mengirim laporan.', cadreForm.elements.description);
      return true;
    };

    const showCadreStep = (step, focus = true) => {
      cadreStep = step;
      document.querySelector('#cadreStepCaption').textContent = `Langkah ${step} dari 4`;
      cadreForm.querySelectorAll('[data-cadre-next]').forEach(button => {
        button.dataset.normalLabel ||= button.textContent;
        button.textContent = editingCadreReview ? 'Kembali ke tinjauan' : button.dataset.normalLabel;
      });
      cadreForm.querySelectorAll('[data-cadre-step]').forEach(fieldset => { fieldset.hidden = Number(fieldset.dataset.cadreStep) !== step; });
      document.querySelectorAll('[data-cadre-progress]').forEach(item => {
        const itemStep = Number(item.dataset.cadreProgress);
        item.classList.toggle('complete', itemStep < step);
        if (itemStep === step) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
      if (step === 4) updateCadreReview();
      if (focus) cadreForm.querySelector(`[data-cadre-step="${step}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    document.querySelectorAll('[data-cadre-next]').forEach(button => button.addEventListener('click', () => {
      if (!validateCadreStep(cadreStep)) return;
      if (editingCadreReview) {
        for (let step = 1; step <= 3; step += 1) {
          showCadreStep(step, false);
          if (!validateCadreStep(step)) return;
        }
        editingCadreReview = false;
        showCadreStep(4, false);
        const title = document.querySelector('#cadreReviewTitle');
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
        title.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else showCadreStep(Number(button.dataset.cadreNext));
    }));
    document.querySelectorAll('[data-cadre-back]').forEach(button => button.addEventListener('click', () => showCadreStep(Number(button.dataset.cadreBack))));
    document.querySelector('#cadreReportReview').addEventListener('click', event => {
      const button = event.target.closest('[data-cadre-review-edit]');
      if (!button) return;
      const step = Number(button.dataset.cadreReviewEdit);
      editingCadreReview = step !== 4;
      showCadreStep(step, false);
      const target = document.getElementById(button.dataset.cadreReviewTarget);
      const control = target.matches('input, select, textarea') ? target : target.querySelector('input, select, textarea');
      control?.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.querySelector('#cadreShowAllObservations').addEventListener('click', () => {
      showAllCadreObservations = !showAllCadreObservations;
      updateCadreSignal();
    });
    document.querySelector('#cadreShowAllContexts').addEventListener('click', () => {
      showAllCadreContexts = !showAllCadreContexts;
      updateCadreSignal();
    });
    setupMapPicker({ buttonId: 'openCadreMap', panelId: 'cadreMapPicker', mapId: 'cadreMap', latitudeId: 'cadreLatitude', longitudeId: 'cadreLongitude', messageId: 'cadreMapMessage', geolocateId: 'useCadreLocation', closeId: 'closeCadreMap' });
    let dirty = false;
    for(const [unknownId,name] of [['cadreCasesUnknown','reported_cases'],['cadreDeathsUnknown','reported_deaths']])document.getElementById(unknownId).addEventListener('change',event=>{const field=cadreForm.elements[name];field.disabled=event.target.checked;field.required=!event.target.checked;field.closest('.cadre-impact-count').classList.toggle('is-unknown',event.target.checked);updateCadreReview();});
    cadreForm.addEventListener('input', event => {
      dirty = true;
      document.querySelector('#cadreDraftState').textContent = 'Isian belum dikirim';
      clearCadreStepError(cadreStep);
      if (event.target.name === 'signal_code') {
        rememberCadreSelections(currentCadreSignal);
        restoreCadreSelections(event.target.value);
        currentCadreSignal = event.target.value;
        showAllCadreObservations = false;
        showAllCadreContexts = false;
        updateCadreSignal();
      } else {
        if (event.target.name === 'context_codes' && event.target.checked) {
          const contexts = [...cadreForm.querySelectorAll('[name="context_codes"]')];
          if (event.target.value === 'UNKNOWN_CONTEXT') contexts.forEach(input => { if (input !== event.target) input.checked = false; });
          const unknown = contexts.find(input => input.value === 'UNKNOWN_CONTEXT');
          if (unknown && event.target.value !== 'UNKNOWN_CONTEXT') unknown.checked = false;
        }
        if (['observation_codes', 'context_codes'].includes(event.target.name)) updateCadreSignal();
        else updateCadreReview();
      }
    });
    leaveGuard = () => dirty;
    updateCadreReview();
    showCadreStep(1, false);
    cadreForm.addEventListener('submit', event => submitForm(event, async () => {
      const form = event.currentTarget;
      for (let step = 1; step <= 4; step += 1) {
        showCadreStep(step, false);
        if (!validateCadreStep(step)) {
          return;
        }
      }
      const data = Object.fromEntries(new FormData(form));
      data.dukuh_id=dukuh.value;data.rw_id=rw.value;data.rt_id=rt.value;
      data.estimated_cases_unknown=form.elements.estimated_cases_unknown.checked;
      data.estimated_deaths_unknown=form.elements.estimated_deaths_unknown.checked;
      if(CADRE_SIGNAL_EVENT_MAP[data.signal_code]==='ANIMAL_EVENT')data.reported_deaths=0;
      data.observation_codes = [...form.querySelectorAll('[name="observation_codes"]:checked')].map(input => input.value);
      data.context_codes = [...form.querySelectorAll('[name="context_codes"]:checked')].map(input => input.value);
      try {
        const result = await api('/api/cadre/reports', { method: 'POST', body: JSON.stringify(data) });
        dirty = false;
        document.querySelector('#cadreDraftState').textContent = 'Belum ada isian baru';
        form.reset();
        if (me.village_code) cadreVillage.value = me.village_code;
        syncAreas('village');cadreForm.elements.reported_cases.disabled=false;cadreForm.elements.reported_cases.required=true;
        cadreForm.elements.reported_deaths.disabled=false;cadreForm.elements.reported_deaths.required=true;
        cadreForm.querySelectorAll('.cadre-impact-count').forEach(field=>field.classList.remove('is-unknown'));
        showAllCadreObservations = false;
        showAllCadreContexts = false;
        currentCadreSignal = '';
        cadreSelectionMemory.clear();
        form.querySelectorAll('[name="observation_codes"], [name="context_codes"]').forEach(input => {
          input.checked = false;
          input.disabled = false;
          input.closest('label')?.classList.remove('is-implied');
        });
        updateCadreSignal();
        showCadreStep(1, false);
        historyOffset = 0;
        document.querySelector('#message').innerHTML = `<div class="success completion-card" role="status"><h2>Laporan berhasil dikirim</h2><p><strong>${esc(result.report_id)}</strong> · Menunggu ditinjau petugas</p><p>Terima kasih sudah melaporkan kejadian ini. Petugas akan meninjau laporan Anda. Ikuti perkembangannya di Riwayat laporan dan jawab jika petugas membutuhkan informasi tambahan.</p><div class="actions"><button type="button" id="cadreReceiptReport" class="secondary">Buka laporan ini</button><button type="button" id="cadreReceiptNew" class="text-button">Buat laporan lain</button></div></div>`;
        document.querySelector('#cadreReceiptReport').addEventListener('click',()=>{location.hash='#cadre-report/'+encodeURIComponent(result.report_id);});
        document.querySelector('#cadreReceiptNew').addEventListener('click', () => { document.querySelector('#message').innerHTML = ''; setCadrePanel('report'); });
        setCadrePanel('history', false);
        focusMessage('message');
        await loadHistory('Laporan berhasil dikirim, tetapi riwayat belum dapat dimuat. Muat ulang setelah koneksi pulih.');
      } catch (error) { document.querySelector('#message').innerHTML = alertBox('error', error.message); }
    }, 'Mengirim…'));
    document.querySelector('#logout').addEventListener('click', async event => {
      logout(event);
    });
    const hasUnsavedCadreWork=()=>dirty || ebsViews.hasCadreDrafts();
    cadreReportDraft={owner:me.cadre_code,nodes:[...app.childNodes],isDirty:hasUnsavedCadreWork,restore:async (view,identity)=>{if(identity)Object.assign(me,identity);view=view==='followup'?'history':view;const options=cadreHistoryOptions();historyView=options.filter;historyOffset=options.offset;setCadrePanel(view,false,false);if(view==='summary'){void loadMyScore();void statistics.refresh();}if(view==='history')await loadHistory();else void loadHistory();}};
    leaveGuard=hasUnsavedCadreWork;
    dismissLoginAcknowledgement();
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('cadre');
    app.innerHTML = `<section class="card">${alertBox('error', error.message)}<button id="retryCadreHome" type="button">Coba lagi</button></section>`;
    document.querySelector('#retryCadreHome').addEventListener('click', cadreHome);
  }
}

function cadreHistoryOptions() {
  const params=new URLSearchParams(location.hash.split('?')[1] || '');
  const filter=['all','pending','review','closed'].includes(params.get('filter'))?params.get('filter'):'all';
  const number=(key,max)=>{const value=Number(params.get(key));return Number.isSafeInteger(value)&&value>=0&&value<=max?value:0;};
  return {filter,offset:number('offset',1000000),scroll:number('scroll',10000000)};
}

// Report-list filters survive re-renders so staff keep their view while working.
const reportFilters = { q: '', status: '', priority: '', notification: '', date_from: '', date_to: '', offset: 0 };
const REPORTS_PAGE_SIZE = 50;
let staffHomeActivePanel = 'home-reports-panel';

async function staffHome(mode = 'overview') {
  try {
    const me = await api('/api/me');
    if (me.kind !== 'staff') return loginPage('staff');
    const params = new URLSearchParams(Object.entries(reportFilters).filter(([, value]) => value));
    params.set('limit', REPORTS_PAGE_SIZE);
    const isAdmin = me.role === 'ADMIN';
    const currentPeriod = epiPeriod();
    const [summary, page, events, ibsSummary, revisionRequests] = await Promise.all([
      api('/api/dashboard'), api(`/api/reports?${params.toString()}`), api('/api/events'),
      isAdmin ? api(`/api/ibs/dashboard?epi_year=${currentPeriod.year}&epi_week=${currentPeriod.week}`) : Promise.resolve(null),
      isAdmin ? api('/api/admin/ibs/revision-requests') : Promise.resolve([]),
    ]);
    const reports = page.rows;
    const csvParams = new URLSearchParams(Object.entries(reportFilters).filter(([key, value]) => key !== 'offset' && value));
    const total = summary.reports.reduce((sum, item) => sum + Number(item.count), 0);
    const high = summary.reports.filter(item => item.current_priority === 'TINGGI').reduce((sum, item) => sum + Number(item.count), 0);
    const pending = Number(summary.pending_reports || 0);
    const notificationAttention = Number(summary.notification_attention_reports || 0);
    const canEvent = isAdmin;
    const missingW2 = ibsSummary ? Math.max(0, Number(ibsSummary.completeness.w2.expected) - Number(ibsSummary.completeness.w2.submitted)) : 0;
    const missingSchools = ibsSummary ? Math.max(0, Number(ibsSummary.completeness.schools.expected) - Number(ibsSummary.completeness.schools.submitted)) : 0;
    const ibsFollowUp = ibsSummary ? Number(ibsSummary.pending_details || 0) + (ibsSummary.markers || []).filter(row => row.target_type === 'W2' && !row.reviewed_at).length + revisionRequests.length : 0;
    const advancedFiltersActive = Boolean(reportFilters.priority || reportFilters.notification || reportFilters.date_from || reportFilters.date_to);
    const reportTable = reports.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>ID</th><th>Jenis/lokasi</th><th>Prioritas</th><th>Notifikasi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${reports.map(report => `<tr><td data-label="ID"><strong>${esc(report.report_id)}</strong><br><small>${formatDate(report.submitted_at)}</small></td><td data-label="Jenis/lokasi">${esc(report.submission_channel === 'PUBLIC' ? report.event_type_label || report.event_type : report.signal_code)}<br><small>${valueOrDash(report.village_code)} · ${valueOrDash(report.location_text)}</small></td><td data-label="Prioritas"><span class="priority-pill priority-${esc(report.current_priority)}">${esc(report.current_priority)}</span></td><td data-label="Notifikasi">${notificationBadge(report) || '<span class="muted">Biasa</span>'}</td><td data-label="Status">${status(report.current_status)}</td><td class="action-cell">${report.can_open_detail ? `<button class="secondary reportDetail" data-id="${esc(report.report_id)}">Buka detail</button>` : '<span class="muted">Ringkasan saja</span>'}</td></tr>`).join('')}</tbody></table></div>${page.total > REPORTS_PAGE_SIZE ? `<div class="pager"><button id="pagePrev" class="secondary" ${page.offset ? '' : 'disabled'}>← Sebelumnya</button><span class="muted">${page.offset + 1}–${page.offset + reports.length} dari ${page.total}</span><button id="pageNext" class="secondary" ${page.offset + reports.length < page.total ? '' : 'disabled'}>Berikutnya →</button></div>` : ''}` : empty('Tidak ada laporan yang cocok', reportFilters.q || reportFilters.status || reportFilters.priority || reportFilters.notification || reportFilters.date_from || reportFilters.date_to ? 'Coba longgarkan filter pencarian.' : 'Laporan baru akan muncul di sini.');
    const eventTable = events.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>ID</th><th>Event</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${events.map(event => `<tr><td data-label="ID"><strong>${esc(event.event_id)}</strong></td><td data-label="Event">${esc(event.event_title)}</td><td data-label="Status">${status(event.current_status)}</td><td class="action-cell"><a class="button secondary" href="#staff-event/${encodeURIComponent(event.event_id)}">Buka detail</a></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada event', 'Event dibuat dari satu atau lebih laporan yang sudah terverifikasi.');
    const dashboardActions = `<section class="card overview-next"><h2>Pengelolaan laporan</h2><p class="section-intro">Pilih sumber laporan yang ingin dikelola.</p><div class="overview-action-grid"><a href="#staff-reports"><span class="choice-icon">${uiIcon('incident')}</span><span><strong>Laporan Kader</strong><small>Kejadian dari kader dan warga · ${pending} laporan perlu diperiksa</small></span><span aria-hidden="true">→</span></a><a href="#staff-w2-management"><span class="choice-icon">${uiIcon('routine')}</span><span><strong>Laporan W2 Faskes</strong><small>${isAdmin ? `${missingW2} faskes belum mengirim · ${ibsFollowUp} tindak lanjut` : 'Pantau kelengkapan W2 dan rincian kasus faskes'}</small></span><span aria-hidden="true">→</span></a></div></section>`;
    const overview = isAdmin ? `<section class="grid metrics admin-overview-metrics" aria-label="Prioritas administrator"><div class="metric metric-high${notificationAttention ? ' is-alert' : ''}"><span>Notifikasi laporan kejadian</span><strong>${notificationAttention}</strong><small>perlu perhatian</small></div><div class="metric metric-pending${pending ? ' is-alert' : ''}"><span>Laporan kejadian</span><strong>${pending}</strong><small>perlu ditangani dari ${total}</small></div><div class="metric metric-high${high ? ' is-alert' : ''}"><span>Prioritas tinggi</span><strong>${high}</strong><small>laporan kejadian</small></div><div class="metric${missingW2 ? ' is-alert' : ''}"><span>W2 belum masuk</span><strong>${missingW2}</strong><small>dari ${ibsSummary.completeness.w2.expected} faskes</small></div><div class="metric${missingSchools ? ' is-alert' : ''}"><span>Sekolah belum masuk</span><strong>${missingSchools}</strong><small>dari ${ibsSummary.completeness.schools.expected} sekolah</small></div><div class="metric metric-events${ibsFollowUp ? ' is-alert' : ''}"><span>Tindak lanjut W2</span><strong>${ibsFollowUp}</strong><small>rincian, penanda, atau revisi</small></div></section>` : `<section class="grid metrics" aria-label="Ringkasan"><div class="metric metric-total"><span>Semua laporan kejadian</span><strong>${total}</strong></div><div class="metric metric-high${high ? ' is-alert' : ''}"><span>Prioritas tinggi</span><strong>${high}</strong></div><div class="metric metric-pending"><span>Perlu ditangani</span><strong>${pending}</strong></div><div class="metric metric-events"><span>Event aktif</span><strong>${summary.active_events}</strong></div></section>`;
    app.innerHTML = `
      <section class="card hero workspace-hero"><div class="page-head"><div><p class="eyebrow">${isAdmin ? 'Ruang kerja administrator' : 'Ruang kerja petugas'}</p><h1>${mode === 'reports' ? 'Laporan kejadian' : 'Ringkasan surveilans'}</h1><p>${isAdmin ? `Laporan kejadian dan pelaporan rutin · ME ${esc(currentPeriod.week)}, ${esc(currentPeriod.year)}` : `${esc(me.email)} · ${esc(me.role)}`}</p></div><div class="actions"><span class="staff-identity">${esc(me.email)} · <strong>${esc(me.role)}</strong></span><button id="logout" class="secondary">Keluar</button></div></div></section>
      ${loginAcknowledgement()}

      ${mode === 'overview' ? dashboardActions + `<details class="dashboard-numbers"><summary>Ringkasan angka surveilans</summary>${overview}</details>` : ''}
      ${mode === 'reports' ? `<section class="card staff-home-worklist"><div class="section-heading"><div><p class="eyebrow">Pemantauan kejadian</p><h2>Daftar laporan & event</h2><p class="section-intro">Cari laporan, lanjutkan verifikasi, atau kelola event dari laporan terkonfirmasi.</p></div>${canEvent ? `<a class="button" href="#staff-event" >Buat event</a>` : ''}</div><div class="staff-home-tabs" role="tablist" aria-label="Daftar pemantauan"><button type="button" role="tab" aria-selected="${staffHomeActivePanel === 'home-reports-panel'}" aria-controls="home-reports-panel" data-home-tab="home-reports-panel">Laporan kejadian <span class="count">${page.total}</span></button><button type="button" role="tab" aria-selected="${staffHomeActivePanel === 'home-events-panel'}" aria-controls="home-events-panel" data-home-tab="home-events-panel">Event <span class="count">${events.length}</span></button></div>
        <section id="home-reports-panel" class="staff-home-panel" role="tabpanel" ${staffHomeActivePanel === 'home-reports-panel' ? '' : 'hidden'}><h3 class="sr-only" tabindex="-1">Daftar laporan kejadian</h3><form id="filters" class="dashboard-filters" role="search"><div class="dashboard-filter-primary"><input name="q" value="${esc(reportFilters.q)}" placeholder="Cari ID atau uraian…" aria-label="Kata kunci" maxlength="100"><select name="status" aria-label="Saring status"><option value="">Semua status</option>${REPORT_STATUSES.map(item => `<option value="${item}"${reportFilters.status === item ? ' selected' : ''}>${esc(labelStatus(item))}</option>`).join('')}</select><button type="submit" class="secondary">Tampilkan</button></div><details class="dashboard-advanced-filters" ${advancedFiltersActive ? 'open' : ''}><summary>Filter lainnya${advancedFiltersActive ? ' · aktif' : ''}</summary><div><select name="priority" aria-label="Saring prioritas"><option value="">Semua prioritas</option>${['TINGGI', 'SEDANG', 'RENDAH'].map(item => `<option value="${item}"${reportFilters.priority === item ? ' selected' : ''}>${item}</option>`).join('')}</select><select name="notification" aria-label="Saring notifikasi"><option value="">Semua notifikasi</option><option value="ATTENTION"${reportFilters.notification === 'ATTENTION' ? ' selected' : ''}>Perlu perhatian</option><option value="SENT"${reportFilters.notification === 'SENT' ? ' selected' : ''}>Sudah terkirim</option></select><label>Dari tanggal<input name="date_from" type="date" value="${esc(reportFilters.date_from)}"></label><label>Sampai tanggal<input name="date_to" type="date" value="${esc(reportFilters.date_to)}"></label><a class="button secondary" href="/api/reports.csv${csvParams.toString() ? `?${csvParams.toString()}` : ''}" download>Unduh CSV</a></div></details>${reportFilters.q || reportFilters.status || advancedFiltersActive ? '<button id="resetFilters" type="button" class="text-button">Hapus semua filter</button>' : ''}</form>${reportTable}</section>
        <section id="home-events-panel" class="staff-home-panel" role="tabpanel" ${staffHomeActivePanel === 'home-events-panel' ? '' : 'hidden'}><h3 class="sr-only" tabindex="-1">Daftar event</h3>${eventTable}</section>
      </section>` : ''}`;
    document.querySelector('#logout').addEventListener('click', logout);
    dismissLoginAcknowledgement();
    const activateHomePanel = (panelId, focus = true) => {
      staffHomeActivePanel = panelId;
      document.querySelectorAll('[data-home-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.homeTab === panelId)));
      document.querySelectorAll('.staff-home-panel').forEach(panel => { panel.hidden = panel.id !== panelId; });
      if (focus) document.querySelector(`#${panelId} h3`)?.focus({ preventScroll: true });
    };
    document.querySelectorAll('[data-home-tab]').forEach(button => button.addEventListener('click', () => activateHomePanel(button.dataset.homeTab)));
    setupTabKeyboard('[data-home-tab]');
    document.querySelector('#filters')?.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      reportFilters.q = String(data.get('q') || '').trim();
      reportFilters.status = String(data.get('status') || '');
      reportFilters.priority = String(data.get('priority') || '');
      reportFilters.notification = String(data.get('notification') || '');
      reportFilters.date_from = String(data.get('date_from') || '');
      reportFilters.date_to = String(data.get('date_to') || '');
      reportFilters.offset = 0;
      staffHome(mode);
    });
    document.querySelector('#resetFilters')?.addEventListener('click', () => {
      Object.assign(reportFilters, { q: '', status: '', priority: '', notification: '', date_from: '', date_to: '', offset: 0 });
      staffHome(mode);
    });
    document.querySelector('#pagePrev')?.addEventListener('click', () => {
      reportFilters.offset = Math.max(page.offset - REPORTS_PAGE_SIZE, 0);
      staffHome(mode);
    });
    document.querySelector('#pageNext')?.addEventListener('click', () => {
      reportFilters.offset = page.offset + REPORTS_PAGE_SIZE;
      staffHome(mode);
    });
    document.querySelectorAll('.reportDetail').forEach(button => button.addEventListener('click', () => { location.hash = `#staff-report/${button.dataset.id}`; }));
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('staff');
    pageFailure(error, () => staffHome(mode));
  }
}

function presentReportDetail(report, data, masters, canVerify, canEvent) {
  const original = app.querySelector('section.card');
  const details = original.querySelector('.details');
  const village = masters.villages.find(item => item.village_code === report.village_code)?.village_name || report.village_code || 'Lokasi belum ditentukan';
  const signal = report.submission_channel === 'PUBLIC'
    ? report.event_type_label || masters.event_types.find(item => item.event_type === report.event_type)?.public_label || EVENT_FORM_CONFIG[report.event_type]?.label || 'Kejadian kesehatan'
    : masters.signals.find(item => item.signal_code === report.signal_code)?.community_label || 'Kejadian kesehatan';
  const header = document.createElement('section');
  header.className = 'hero report-detail-header';
  header.innerHTML = `<a class="back-link" href="#staff-reports">← Kejadian</a><p class="eyebrow">Laporan kejadian</p><h1>${esc(signal)} · ${esc(village)}</h1><div class="report-detail-meta">${status(report.current_status)}<span>${formatDate(report.submitted_at)}</span><span>${esc(report.report_id)}</span></div>`;
  original.before(header);
  original.className = 'card report-summary-card';
  original.innerHTML = `<h2>Ringkasan laporan</h2><dl class="report-summary-facts"><div><dt>Lokasi</dt><dd>${esc(village)}${report.location_text ? ` · ${esc(report.location_text)}` : ''}</dd></div><div><dt>Mulai kejadian</dt><dd>${formatDate(report.event_start_date)}</dd></div><div><dt>Sumber laporan</dt><dd>${report.submission_channel === 'PUBLIC' ? 'Warga' : 'Kader'}</dd></div><div><dt>Prioritas</dt><dd>${valueOrDash(report.current_priority)}</dd></div></dl><div class="report-summary-counts"><div><strong>${report.reported_cases_known === 0 ? '—' : valueOrDash(report.reported_cases)}</strong><span>Terdampak${report.reported_cases_known === 0 ? ' · belum diketahui' : ''}</span></div><div><strong>${report.reported_deaths_known === 0 ? '—' : valueOrDash(report.reported_deaths)}</strong><span>Meninggal${report.reported_deaths_known === 0 ? ' · belum diketahui' : ''}</span></div><div><strong>${valueOrDash(report.severe_cases)}</strong><span>Kondisi berat</span></div></div>`;
  const narrative = document.createElement('section'); narrative.className = 'card report-narrative';
  narrative.innerHTML = '<h2>Informasi dari pelapor</h2>';
  details.querySelectorAll('.detail-item').forEach(item => {
    const label = item.querySelector('span')?.textContent;
    if (['Uraian', 'Tanda yang dilaporkan', 'Konteks kejadian'].includes(label)) narrative.append(item);
    else if (label === 'Sinyal kader' || label === 'Jenis kejadian warga') item.querySelector('strong').textContent = signal;
    else if (label === 'Desa') item.querySelector('strong').textContent = village;
  });
  const sections = [...app.querySelectorAll(':scope > section.card')].filter(section => section !== original);
  const targets = {};
  const wrap = (section, id, title, opened = false) => {
    const disclosure = document.createElement('details'); disclosure.className = 'report-supporting'; disclosure.id = id; disclosure.open = opened;
    const heading = section.querySelector('h2');
    disclosure.innerHTML = `<summary>${esc(title || heading?.textContent || 'Rincian')}<span aria-hidden="true">⌄</span></summary>`;
    section.before(disclosure); disclosure.append(section); heading?.remove(); targets[id] = disclosure;
  };
  sections.forEach(section => {
    if (section.querySelector('#statusActions')) wrap(section, 'reportVerification', 'Verifikasi dan status', report.current_status === 'SEDANG_DIVERIFIKASI');
    else if (section.querySelector('#linkEvent')) wrap(section, 'reportEventLink', 'Hubungkan ke kejadian');
    else if (section.querySelector('a[href^="#staff-sbm/"]')) wrap(section, 'reportFieldwork', 'Penilaian awal dan kegiatan lapangan');
    else if (section.classList.contains('danger-zone')) wrap(section, 'reportAdministration', 'Administrasi laporan');
    else wrap(section, `reportSupporting${Object.keys(targets).length}`, section.querySelector('h2')?.textContent, Boolean(section.querySelector('#notificationMessage') && report.notification_status !== 'SENT'));
  });
  const detailsPanel = document.createElement('details'); detailsPanel.className = 'report-supporting';
  detailsPanel.innerHTML = '<summary>Rincian tambahan laporan<span aria-hidden="true">⌄</span></summary>';
  detailsPanel.append(details);
  const layout = document.createElement('div'); layout.className = 'report-detail-layout'; original.before(layout); layout.append(original);
  const canStart = canVerify && (data.transitions || []).includes('SEDANG_DIVERIFIKASI');
  const verifying = canVerify && report.current_status === 'SEDANG_DIVERIFIKASI';
  const notConfirmed = data.verifications?.[0]?.verification_result === 'NOT_CONFIRMED';
  if (notConfirmed) original.insertAdjacentHTML('beforeend', `<div class="report-verification-outcome"><strong>Sinyal tidak terkonfirmasi</strong><p>Verifikasi pada ${formatDate(data.verifications[0].verified_at)} tidak mengonfirmasi sinyal awal. Penilaian kualitas laporan tetap terpisah.</p></div>`);
  else if (report.verified_ebs_name) original.insertAdjacentHTML('beforeend', `<div class="report-verification-outcome"><span>Klasifikasi terverifikasi</span><strong>${esc(report.verified_ebs_name)}</strong></div>`);
  const canLink = canEvent && report.current_status === 'TERVERIFIKASI' && !notConfirmed;
  const target = canStart || verifying ? targets.reportVerification : canLink ? targets.reportEventLink : targets.reportFieldwork;
  const title = canStart ? 'Verifikasi informasi awal' : verifying ? 'Catat hasil verifikasi' : canLink ? 'Hubungkan laporan terverifikasi' : target ? 'Tinjau penilaian awal' : 'Pantau penanganan laporan';
  const copy = canStart ? 'Konfirmasi lokasi, jumlah orang terdampak, dan waktu kejadian kepada pelapor.' : verifying ? 'Lengkapi hasil konfirmasi dan klasifikasi berdasarkan penilaian petugas.' : canLink ? 'Pilih kejadian yang sesuai untuk mengelompokkan tindak lanjut laporan ini.' : target ? 'Lihat kebutuhan tindak lanjut dan kegiatan lapangan untuk laporan ini.' : 'Rincian dan riwayat penanganan tersedia di bawah.';
  const next = document.createElement('section'); next.className = 'card report-next-action';
  next.innerHTML = `<p class="eyebrow">Langkah berikutnya</p><h2>${title}</h2><p>${copy}</p>${target ? `<button id="reportNextAction" type="button">${canStart ? 'Mulai verifikasi' : verifying ? 'Isi hasil verifikasi' : canLink ? 'Pilih kejadian' : 'Buka penilaian awal'} ${uiIcon('status')}</button>` : ''}`;
  layout.append(next); layout.after(narrative, detailsPanel);
  next.querySelector('button')?.addEventListener('click', () => {
    target.open = true;
    if (canStart) target.querySelector('.statusChoice[data-status="SEDANG_DIVERIFIKASI"]')?.click();
    else { const control = target.querySelector('input:not([type="hidden"]), select, textarea, a, button'); control?.focus({ preventScroll: true }); }
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

async function legacyStaffReport(id) {
  try {
    const [me, data, events, masters] = await Promise.all([api('/api/me'), api(`/api/reports/${encodeURIComponent(id)}`), api('/api/events'), getMasters()]);
    if (me.kind !== 'staff') return loginPage('staff');
    const report = data.report;
    const canVerify = ['ADMIN', 'VERIFIKATOR'].includes(me.role);
    const canEvent = me.role === 'ADMIN';
    const suggestions = data.ebs_suggestions || [];
    const ebsCatalog = data.ebs_options?.[0] || {};
    const suggestedIds = new Set(suggestions.map(item => String(item.ebs_id)));
    const otherEbs = (data.ebs_options || []).filter(item => !suggestedIds.has(String(item.ebs_id)));
    const ebsLevelLabels = {
      SYNDROME: 'Sindrom dan tanda klinis',
      SUSPECT: 'Klasifikasi suspek',
      EXPOSURE: 'Pajanan dan gigitan',
      ANIMAL_SIGNAL: 'Sinyal pada hewan',
      EVENT: 'Kejadian dan kluster',
      DISEASE: 'Penyakit atau kondisi',
      OBSERVATION: 'Klasifikasi observasi',
      PROBABLE: 'Klasifikasi probable',
      LAB_CONFIRMED: 'Konfirmasi laboratorium',
      OTHER: 'Lain-lain',
    };
    const ebsLevelOrder = ['SYNDROME', 'SUSPECT', 'EXPOSURE', 'ANIMAL_SIGNAL', 'EVENT', 'DISEASE', 'OBSERVATION', 'PROBABLE', 'LAB_CONFIRMED', 'OTHER'];
    const groupedEbsOptions = ebsLevelOrder.map(level => {
      const items = otherEbs.filter(item => item.classification_level === level);
      return items.length ? `<optgroup label="${esc(ebsLevelLabels[level])}">${items.map(item => `<option value="${esc(item.ebs_id)}">${esc(item.disease_name)} — ${esc(item.ebs_id)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const ebsOptions = `<option value="">Pilih klasifikasi EBS…</option>${suggestions.length ? `<optgroup label="Saran berdasarkan laporan">${suggestions.map(item => `<option value="${esc(item.ebs_id)}">${esc(item.disease_name)} — ${esc(item.ebs_id)}</option>`).join('')}</optgroup>` : ''}${groupedEbsOptions}`;
    const ebsSuggestionCards = suggestions.length ? `<div class="ebs-suggestion-list" aria-label="Saran klasifikasi berdasarkan laporan">${suggestions.map(item => `<article><span>${esc(ebsLevelLabels[item.classification_level] || 'Saran klasifikasi')}</span><strong>${esc(item.disease_name)}</strong><small>${esc(item.matched_rules)} kecocokan terstruktur · ID ${esc(item.ebs_id)}</small></article>`).join('')}</div>` : '';
    const observationTags = (data.observations || []).map(item => `<span class="data-tag" title="${esc(item.public_help)}">${esc(item.public_label)}</span>`).join('');
    const contextTags = (data.contexts || []).map(item => `<span class="data-tag context-tag" title="${esc(item.public_help)}">${esc(item.public_label)}</span>`).join('');
    app.innerHTML = `
      <section class="card"><a class="back-link" href="#staff-reports">← Kembali ke laporan</a><div class="page-head"><div><p class="eyebrow">Detail laporan</p><h1>${esc(report.report_id)}</h1></div><div>${status(report.current_status)}</div></div>
        <div class="details"><div class="detail-item"><span>Prioritas</span><strong>${valueOrDash(report.current_priority)}</strong></div><div class="detail-item"><span>Notifikasi segera</span><strong>${report.immediate_notification ? notificationLabel(report.notification_status) : 'Tidak diperlukan'}</strong><small>${report.immediate_notification ? `${Number(report.notification_attempts || 0)} percobaan` : ''}</small></div><div class="detail-item"><span>${report.submission_channel === 'PUBLIC' ? 'Jenis kejadian warga' : 'Sinyal kader'}</span><strong>${valueOrDash(report.submission_channel === 'PUBLIC' ? report.event_type_label || report.event_type : report.signal_code)}</strong></div><div class="detail-item"><span>Desa</span><strong>${valueOrDash(report.village_code)}</strong></div><div class="detail-item"><span>Tanggal mulai</span><strong>${formatDate(report.event_start_date)}</strong></div><div class="detail-item"><span>Kelompok terdampak</span><strong>${esc(affectedGroupLabel(report.affected_group))}</strong></div><div class="detail-item span-3"><span>Tanda yang dilaporkan</span>${observationTags ? `<div class="tag-list">${observationTags}</div>` : '<strong>—</strong>'}</div><div class="detail-item span-3"><span>Konteks kejadian</span>${contextTags ? `<div class="tag-list">${contextTags}</div>` : '<strong>—</strong>'}</div><div class="detail-item span-3"><span>Lokasi</span><strong>${valueOrDash(report.location_text)}</strong></div><div class="detail-item span-3"><span>Uraian</span><strong class="prewrap">${valueOrDash(report.description)}</strong></div><div class="detail-item"><span>Terdampak</span><strong>${report.reported_cases_known === 0 ? 'Belum diketahui' : valueOrDash(report.reported_cases)}</strong></div><div class="detail-item"><span>Meninggal</span><strong>${report.reported_deaths_known === 0 ? 'Belum diketahui' : valueOrDash(report.reported_deaths)}</strong></div><div class="detail-item"><span>Kasus berat / dirawat</span><strong>${valueOrDash(report.severe_cases)} / ${report.hospitalized_cases_known === 0 ? 'Belum diketahui' : valueOrDash(report.hospitalized_cases)}</strong></div>${report.verified_ebs_id ? `<div class="detail-item span-3 verified-classification"><span>Klasifikasi EBS terverifikasi</span><strong>${esc(report.verified_ebs_name)} — ${esc(report.verified_ebs_id)}</strong></div>` : ''}</div>
      </section>
      ${report.immediate_notification ? `<section class="card"><h2>Pengiriman notifikasi</h2>${messageBox('notificationMessage')}<p>${notificationBadge(report)}${report.last_notification_attempt_at ? ` · Percobaan terakhir ${formatDate(report.last_notification_attempt_at)}` : ''}</p>${report.notification_error ? `<p class="error">${esc(report.notification_error)}</p>` : ''}${canVerify && report.notification_status !== 'SENT' ? '<button id="retryNotification" class="secondary">Kirim ulang notifikasi</button>' : ''}</section>` : ''}
      ${canVerify ? `<section class="card"><h2>Verifikasi</h2>${messageBox('message')}${report.current_status === 'SEDANG_DIVERIFIKASI' ? `<form id="verify"><div class="field classification-field"><label for="verifiedEbs">Klasifikasi EBS SKDR <small>Wajib dipilih oleh petugas berdasarkan hasil verifikasi, bukan oleh warga atau kader.</small></label><p class="help">Katalog ${esc(ebsCatalog.catalog_version || 'SKDR EBS')} · ${esc(ebsCatalog.source_authority || 'Kementerian Kesehatan RI')} · terbit ${esc(ebsCatalog.source_published_at || '—')}${ebsCatalog.source_url ? ` · <a href="${esc(ebsCatalog.source_url)}" target="_blank" rel="noopener">sumber</a>` : ''}</p>${ebsSuggestionCards}<select id="verifiedEbs" name="verified_ebs_id" required>${ebsOptions}</select>${suggestions.length ? `<p class="help">Saran otomatis hanya membantu penyaringan berdasarkan data terstruktur; petugas tetap menentukan klasifikasi final.</p>` : ''}</div><div class="grid"><div class="field"><label for="method">Metode</label><input id="method" name="verification_method" placeholder="Telepon atau kunjungan"></div><div class="field"><label for="contactResult">Hasil kontak</label><input id="contactResult" name="contact_result"></div><div class="field"><label for="actualCases">Kasus aktual</label><input id="actualCases" name="actual_cases" type="number" min="0" value="${report.reported_cases_known === 0 ? '' : esc(report.reported_cases)}" required></div><div class="field"><label for="actualDeaths">Meninggal aktual</label><input id="actualDeaths" name="actual_deaths" type="number" min="0" value="${report.reported_deaths_known === 0 ? '' : esc(report.reported_deaths)}" required></div><div class="field"><label for="actualSevere">Kasus berat aktual</label><input id="actualSevere" name="actual_severe_cases" type="number" min="0" value="${esc(report.severe_cases)}"></div></div><div class="field"><label for="verifyNotes">Catatan</label><textarea id="verifyNotes" name="notes"></textarea></div><div class="form-actions"><button type="submit">Simpan dan tandai sebagai terverifikasi</button></div></form>` : '<p class="section-intro">Ubah status ke Sedang diverifikasi terlebih dahulu. Hasil yang disimpan akan otomatis menandai laporan terverifikasi.</p>'}
        <h3>Ubah status</h3><p class="section-intro">Pilih status tujuan, lalu tulis catatan perubahan.</p><div class="actions" id="statusActions">${(data.transitions || []).map(next => `<button class="secondary statusChoice" data-status="${next}">${esc(labelStatus(next))}</button>`).join('') || '<span class="muted">Tidak ada perubahan status yang tersedia.</span>'}</div><div id="statusPanel" class="dialog-panel hidden">${messageBox('statusError')}<form id="statusForm"><input type="hidden" name="status"><div class="field"><label for="statusNotes">Catatan perubahan</label><textarea id="statusNotes" name="notes" maxlength="500" required></textarea></div><div class="actions"><button type="submit">Simpan status</button><button id="cancelStatus" type="button" class="secondary">Batal</button></div></form></div>
      </section>` : ''}
      ${canEvent ? `<section class="card"><h2>Hubungkan ke event</h2>${messageBox('eventMessage')}<div class="field"><label for="eventTarget">Pilih event</label><select id="eventTarget"><option value="">Pilih event…</option>${events.filter(event => !['SELESAI', 'DIBATALKAN'].includes(event.current_status)).map(event => `<option value="${esc(event.event_id)}">${esc(event.event_id)} — ${esc(event.event_title)}</option>`).join('')}</select></div><p class="help">Laporan harus berstatus TERVERIFIKASI.</p><div class="form-actions"><button id="linkEvent">Hubungkan</button></div></section>` : ''}
      ${data.verifications?.length ? `<section class="card"><h2>Hasil verifikasi <span class="count">${data.verifications.length}</span></h2><div class="table-wrap mobile-cards"><table><thead><tr><th>Waktu</th><th>Verifikator</th><th>Klasifikasi EBS</th><th>Metode/hasil</th><th>Kasus aktual</th><th>Catatan</th></tr></thead><tbody>${data.verifications.map(item => `<tr><td data-label="Waktu">${formatDate(item.verified_at)}</td><td data-label="Verifikator">${esc(item.verified_by)}</td><td data-label="Klasifikasi EBS"><strong>${valueOrDash((data.ebs_options || []).find(option => String(option.ebs_id) === String(item.verified_ebs_id))?.disease_name)}</strong><br><small>${valueOrDash(item.verified_ebs_id)}</small></td><td data-label="Metode/hasil">${valueOrDash(item.verification_method)}${item.contact_result ? `<br><small>${esc(item.contact_result)}</small>` : ''}</td><td data-label="Kasus aktual">${valueOrDash(item.actual_cases)} kasus · ${valueOrDash(item.actual_deaths)} meninggal · ${valueOrDash(item.actual_severe_cases)} berat</td><td data-label="Catatan">${valueOrDash(item.notes)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      <section class="card"><h2>Riwayat status</h2>${data.history.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>Waktu</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${data.history.map(item => `<tr><td data-label="Waktu">${formatDate(item.changed_at)}</td><td data-label="Status">${status(item.new_status)}</td><td data-label="Catatan">${valueOrDash(item.notes)}</td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada riwayat')}</section>${me.role === 'ADMIN' ? `<section class="card danger-zone"><h2>Administrasi laporan</h2><p>Hapus hanya laporan uji, duplikat, atau entri yang memang tidak boleh tersimpan. Alasan penghapusan masuk audit.</p><button id="deleteReport" class="danger-button">Hapus laporan permanen</button></section>` : ''}`;

    presentReportDetail(report, data, masters, canVerify, canEvent);
    document.querySelector('#retryNotification')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      setBusy(button, true, 'Mengirim…');
      try {
        const result = await api(`/api/reports/${encodeURIComponent(id)}/notification/retry`, { method: 'POST' });
        document.querySelector('#notificationMessage').innerHTML = alertBox(result.status === 'SENT' ? 'success' : 'error', result.status === 'SENT' ? 'Notifikasi berhasil dikirim.' : (result.error || 'Notifikasi belum berhasil dikirim.'));
        if (result.status === 'SENT') await legacyStaffReport(id);
      } catch (error) {
        document.querySelector('#notificationMessage').innerHTML = alertBox('error', error.message);
      } finally { setBusy(button, false); }
    });
    document.querySelector('#verify')?.addEventListener('submit', event => submitForm(event, async () => {
      try { await api(`/api/reports/${encodeURIComponent(id)}/verify`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await legacyStaffReport(id); }
      catch (error) { document.querySelector('#message').innerHTML = alertBox('error', error.message); }
    }));
    const verificationForm = document.querySelector('#verify');
    if (verificationForm) {
      verificationForm.insertAdjacentHTML('afterbegin', '<div class="field"><label for="verificationOutcome">Hasil verifikasi<select id="verificationOutcome" name="verification_result"><option value="CONFIRMED">Sinyal terkonfirmasi</option><option value="NOT_CONFIRMED">Sinyal tidak terkonfirmasi setelah verifikasi</option></select></label><p class="help">Hasil negatif tidak mengurangi penilaian kualitas sinyal yang wajar.</p></div>');
      document.querySelector('#verificationOutcome').addEventListener('change', event => {
        const classification = document.querySelector('#verifiedEbs');
        const negative = event.target.value === 'NOT_CONFIRMED';
        classification.required = !negative;
        classification.disabled = negative;
      });
    }
    document.querySelector('#deleteReport')?.addEventListener('click', async event => {
      try {
        if (await deleteWithReason(event.currentTarget, `laporan ${id}`, `/api/reports/${encodeURIComponent(id)}`)) location.hash = '#staff-home';
      } catch (error) { document.querySelector('#message').innerHTML = alertBox('error', error.message); }
    });
    document.querySelectorAll('.statusChoice').forEach(button => button.addEventListener('click', () => {
      document.querySelector('#statusForm').elements.status.value = button.dataset.status;
      document.querySelector('#statusPanel').classList.remove('hidden');
      document.querySelector('#statusNotes').focus();
    }));
    document.querySelector('#cancelStatus')?.addEventListener('click', () => document.querySelector('#statusPanel').classList.add('hidden'));
    document.querySelector('#statusForm')?.addEventListener('submit', event => submitForm(event, async () => {
      try { await api(`/api/reports/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await legacyStaffReport(id); }
      catch (error) { document.querySelector('#statusError').innerHTML = alertBox('error', error.message); }
    }));
    document.querySelector('#linkEvent')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const eventId = document.querySelector('#eventTarget').value;
      if (!eventId) { document.querySelector('#eventMessage').innerHTML = alertBox('error', 'Pilih event terlebih dahulu.'); return; }
      setBusy(button, true, 'Menghubungkan…');
      try { await api(`/api/reports/${encodeURIComponent(id)}/event`, { method: 'POST', body: JSON.stringify({ event_id: eventId, notes: 'Ditautkan dari dashboard.' }) }); await legacyStaffReport(id); }
      catch (error) { document.querySelector('#eventMessage').innerHTML = alertBox('error', error.message); setBusy(button, false); }
    });
  } catch (error) { app.innerHTML = `<section class="card">${alertBox('error', error.message)}<a class="back-link" href="#staff-reports">← Kembali ke laporan</a></section>`; }
}

async function eventForm() {
  try {
    const me = await api('/api/me');
    if (me.kind !== 'staff' || me.role !== 'ADMIN') return staffHome();
    const [masters, verifiedPage] = await Promise.all([getMasters(), api('/api/reports?status=TERVERIFIKASI&limit=100')]);
    const verifiedReports = verifiedPage.rows || [];
    app.innerHTML = `<section class="card"><a class="back-link" href="#staff-reports">← Kembali ke laporan</a><p class="eyebrow">Event surveilans</p><h1>Buat event</h1><p class="section-intro">Rangkum kejadian terverifikasi untuk tindak lanjut.</p>${messageBox('message')}<form id="eventForm">
      <fieldset class="event-source-reports"><legend>Laporan sumber <small>Wajib pilih sedikitnya satu laporan terverifikasi</small></legend>${verifiedReports.length ? `<div class="event-report-options">${verifiedReports.map(report => `<label><input type="checkbox" name="report_ids" value="${esc(report.report_id)}"><span><strong>${esc(report.report_id)}</strong><small>${esc(report.event_type_label || report.signal_code || 'Laporan')} · ${valueOrDash(report.village_code)} · ${formatDate(report.submitted_at)}</small></span></label>`).join('')}</div>` : empty('Belum ada laporan terverifikasi', 'Verifikasi laporan terlebih dahulu sebelum membuat event.')}</fieldset>
      <div class="field"><label for="eventProgram">Program pemilik</label><input id="eventProgram" name="program_owner" required placeholder="Contoh: P2P"></div>
      <div class="field"><label for="eventTitle">Judul event</label><input id="eventTitle" name="event_title" required></div><div class="grid"><div class="field"><label for="eventSignal">Sinyal</label><select id="eventSignal" name="verified_signal_code" required>${selectOptions(masters.signals, 'signal_code', 'community_label')}</select></div><div class="field"><label for="eventVillage">Desa</label><select id="eventVillage" name="village_code">${selectOptions(masters.villages, 'village_code', 'village_name', 'Semua/lebih dari satu')}</select></div><div class="field"><label for="eventDate">Tanggal mulai</label><input id="eventDate" type="date" name="event_start_date"></div><div class="field"><label for="eventCases">Kasus terverifikasi</label><input id="eventCases" type="number" name="verified_cases" min="0" value="0"></div><div class="field"><label for="eventDeaths">Kematian terverifikasi</label><input id="eventDeaths" type="number" name="verified_deaths" min="0" value="0"></div><div class="field"><label for="eventSevere">Kasus berat</label><input id="eventSevere" type="number" name="verified_severe_cases" min="0" value="0"></div><div class="field"><label for="riskLevel">Risiko</label><select id="riskLevel" name="risk_level"><option>RENDAH</option><option selected>SEDANG</option><option>TINGGI</option><option>SANGAT_TINGGI</option></select></div></div><div class="field"><label for="epiSummary">Ringkasan epidemiologi</label><textarea id="epiSummary" name="epidemiological_summary"></textarea></div><div class="form-actions"><button type="submit" ${verifiedReports.length ? '' : 'disabled'}>Buat event</button></div>
    </form></section>`;
    document.querySelector('#eventForm').addEventListener('submit', event => submitForm(event, async () => {
      try {
        const formData = new FormData(event.currentTarget);
        const reportIds = formData.getAll('report_ids').map(String);
        if (!reportIds.length) {
          document.querySelector('#message').innerHTML = alertBox('error', 'Pilih sedikitnya satu laporan terverifikasi sebagai sumber event.');
          document.querySelector('.event-source-reports')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        const payload = Object.fromEntries(formData);
        delete payload.report_ids;
        const created = await api('/api/events', { method: 'POST', body: JSON.stringify(payload) });
        await Promise.all(reportIds.map(reportId => api(`/api/reports/${encodeURIComponent(reportId)}/event`, { method: 'POST', body: JSON.stringify({ event_id: created.event_id, notes: 'Ditautkan saat event dibuat.' }) })));
        location.hash = `#staff-event/${encodeURIComponent(created.event_id)}`;
      }
      catch (error) { document.querySelector('#message').innerHTML = alertBox('error', error.message); }
    }, 'Membuat…'));
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('staff');
    app.innerHTML = `<section class="card"><a class="back-link" href="#staff-reports">← Laporan kejadian</a>${alertBox('error', error.message)}</section>`;
  }
}

async function eventDetail(id) {
  try {
    const [me, data] = await Promise.all([api('/api/me'), api(`/api/events/${encodeURIComponent(id)}`)]);
    if (me.kind !== 'staff') return loginPage('staff');
    const event = data.event;
    if((event.origin==='SIGNAL'||event.verified_source_revision!=null)&&me.role==='ADMIN'&&me.can_manage_surveillance===true)return eventWorkflow.detail(id);
    const canEvent = me.role === 'ADMIN';
    const returnReport = new URLSearchParams(location.hash.split('?')[1] || '').get('report');
    const returnEvents = new URLSearchParams(location.hash.split('?')[1] || '').get('from') === 'events';
    const backTo = returnReport ? '#staff-report/'+encodeURIComponent(returnReport) : returnEvents ? '#staff-events' : '#staff-reports';
    app.innerHTML = `
      <section class="card"><a class="back-link" href="${backTo}">← ${returnEvents?'Kembali ke kejadian':'Kembali ke laporan'}</a><div class="page-head"><div><p class="eyebrow">Detail event</p><h1>${esc(event.event_title)}</h1><p>${esc(event.event_id)}</p></div><div>${status(event.current_status)}</div></div>
        <div class="details">
          <div class="detail-item"><span>Risiko</span><strong>${valueOrDash(labelStatus(event.risk_level))}</strong></div>
          <div class="detail-item"><span>Sinyal</span><strong>${valueOrDash(event.verified_signal_code)}</strong></div>
          <div class="detail-item"><span>Desa</span><strong>${valueOrDash(event.village_code)}</strong></div>
          <div class="detail-item"><span>Program pemilik</span><strong>${valueOrDash(event.program_owner)}</strong></div>
          <div class="detail-item"><span>Penanggung jawab</span><strong>${valueOrDash(event.lead_investigator)}</strong></div>
          <div class="detail-item"><span>Tanggal mulai</span><strong>${formatDate(event.event_start_date)}</strong></div>
          <div class="detail-item"><span>Kasus terverifikasi</span><strong>${event.origin==='SIGNAL'?'Belum ditetapkan':valueOrDash(event.verified_cases)}</strong></div>
          <div class="detail-item"><span>Kematian</span><strong>${event.origin==='SIGNAL'?'Belum ditetapkan':valueOrDash(event.verified_deaths)}</strong></div>
          <div class="detail-item"><span>Kasus berat</span><strong>${event.origin==='SIGNAL'?'Belum ditetapkan':valueOrDash(event.verified_severe_cases)}</strong></div>
          <div class="detail-item span-3"><span>Ringkasan epidemiologi</span><strong class="prewrap">${valueOrDash(event.epidemiological_summary)}</strong></div>
          <div class="detail-item"><span>Dibuat</span><strong>${formatDate(event.created_at)}</strong></div>
          <div class="detail-item"><span>Ditutup</span><strong>${formatDate(event.closed_at)}</strong></div>
          ${me.role==='ADMIN'&&me.can_manage_surveillance===true?`<a class="button secondary" href="#staff-event-work/${encodeURIComponent(id)}">Penilaian & tindak lanjut kejadian</a>`:''}
        </div>
      </section>
      ${canEvent ? `<section class="card"><h2>Ubah status event</h2><p class="section-intro">Menutup event (Selesai/Dibatalkan) mengeluarkannya dari daftar event aktif. Laporan tertaut tidak berubah otomatis.</p><div class="actions" id="statusActions">${(data.transitions || []).map(next => `<button class="secondary statusChoice" data-status="${next}">${esc(labelStatus(next))}</button>`).join('') || '<span class="muted">Event sudah ditutup; tidak ada perubahan status yang tersedia.</span>'}</div><div id="statusPanel" class="dialog-panel hidden">${messageBox('statusError')}<form id="eventStatusForm"><input type="hidden" name="status"><div class="field"><label for="statusNotes">Catatan perubahan</label><textarea id="statusNotes" name="notes" maxlength="500" required></textarea></div><div class="actions"><button type="submit">Simpan status</button><button id="cancelStatus" type="button" class="secondary">Batal</button></div></form></div></section>` : ''}
      <section class="card"><h2>Laporan tertaut <span class="count">${data.reports.length}</span></h2>${data.reports.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>ID</th><th>Sinyal/lokasi</th><th>Prioritas</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${data.reports.map(report => `<tr><td data-label="ID"><strong>${esc(report.report_id)}</strong><br><small>${formatDate(report.submitted_at)}</small></td><td data-label="Sinyal/lokasi">${esc(report.signal_code)}<br><small>${valueOrDash(report.village_code)} · ${valueOrDash(report.location_text)}</small></td><td data-label="Prioritas"><span class="priority-pill priority-${esc(report.current_priority)}">${esc(report.current_priority)}</span></td><td data-label="Status">${status(report.current_status)}</td><td class="action-cell"><a class="button secondary" href="#staff-report/${encodeURIComponent(report.report_id)}">Buka</a></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada laporan tertaut', 'Tautkan laporan terverifikasi dari halaman detail laporan.')}</section>
      <section class="card"><h2>Riwayat status</h2>${data.history.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>Waktu</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${data.history.map(item => `<tr><td data-label="Waktu">${formatDate(item.changed_at)}</td><td data-label="Status">${status(item.new_status)}</td><td data-label="Catatan">${valueOrDash(item.notes)}</td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada riwayat')}</section>${canEvent ? `<section class="card danger-zone"><h2>Administrasi event</h2><p>Menghapus event akan melepaskan laporan tertaut dan mengembalikannya ke status Terverifikasi.</p><button id="deleteEvent" class="danger-button">Hapus event permanen</button></section>` : ''}`;

    document.querySelectorAll('.statusChoice').forEach(button => button.addEventListener('click', () => {
      document.querySelector('#eventStatusForm').elements.status.value = button.dataset.status;
      document.querySelector('#statusPanel').classList.remove('hidden');
      document.querySelector('#statusNotes').focus();
    }));
    document.querySelector('#deleteEvent')?.addEventListener('click', async clickEvent => {
      try {
        if (await deleteWithReason(clickEvent.currentTarget, `event ${id}`, `/api/events/${encodeURIComponent(id)}`)) location.hash = '#staff-home';
      } catch (error) { app.insertAdjacentHTML('afterbegin', alertBox('error', error.message)); }
    });
    document.querySelector('#cancelStatus')?.addEventListener('click', () => document.querySelector('#statusPanel').classList.add('hidden'));
    document.querySelector('#eventStatusForm')?.addEventListener('submit', event => submitForm(event, async () => {
      try { await api(`/api/events/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await eventDetail(id); }
      catch (error) { document.querySelector('#statusError').innerHTML = alertBox('error', error.message); }
    }));
  } catch (error) { app.innerHTML = `<section class="card">${alertBox('error', error.message)}<a class="back-link" href="${backTo}">← Kembali ke laporan</a></section>`; }
}

// Sunday-Saturday epidemiological week for a YYYY-MM-DD string. Week 1 is the
// week containing January 4 (and therefore at least four days of January).
function epiWeekOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  let year = d.getUTCFullYear();
  if (d < epiWeekBounds(year, 1).sunday) year -= 1;
  else if (d >= epiWeekBounds(year + 1, 1).sunday) year += 1;
  return { year, week: Math.floor((d - epiWeekBounds(year, 1).sunday) / (7 * 86400000)) + 1 };
}

// Weekly bar chart as inline SVG. Single brand-hue series (no legend needed);
// thin bars with rounded data-ends, 2px gaps, recessive grid, native tooltips,
// and selective labels on the peak and latest bars only.
function epiCurveSvg(weeks) {
  const width = 720, height = 240, left = 34, right = 8, top = 18, bottom = 24;
  const innerW = width - left - right, innerH = height - top - bottom;
  const max = Math.max(...weeks.map(w => w.count), 1);
  const slot = innerW / weeks.length;
  const barW = Math.max(slot - 6, 4);
  const y = value => top + innerH - (value / max) * innerH;
  const grid = [0.5, 1].map(f => Math.round(max * f)).filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  const maxIndex = weeks.reduce((best, w, i) => (w.count > weeks[best].count ? i : best), 0);
  const bars = weeks.map((w, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const h = (w.count / max) * innerH;
    const r = Math.min(4, barW / 2, h);
    const path = h ? `M${x},${top + innerH} V${y(w.count) + r} Q${x},${y(w.count)} ${x + r},${y(w.count)} H${x + barW - r} Q${x + barW},${y(w.count)} ${x + barW},${y(w.count) + r} V${top + innerH} Z` : '';
    const labelled = w.count > 0 && (i === maxIndex || i === weeks.length - 1);
    return `<g>${path ? `<path d="${path}" fill="var(--chart-bar)"></path>` : ''}<rect x="${left + i * slot}" y="${top}" width="${slot}" height="${innerH}" fill="transparent"><title>${esc(w.year)} ${esc(w.label)}: ${w.count} laporan</title></rect>${labelled ? `<text x="${x + barW / 2}" y="${y(w.count) - 5}" text-anchor="middle" class="chart-value">${w.count}</text>` : ''}<text x="${left + i * slot + slot / 2}" y="${height - 7}" text-anchor="middle" class="chart-axis">${esc(w.label)}</text></g>`;
  }).join('');
  const gridLines = grid.map(v => `<line x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"></line><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end" class="chart-axis">${v}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Jumlah laporan per minggu epidemiologi">${gridLines}<line x1="${left}" x2="${width - right}" y1="${top + innerH}" y2="${top + innerH}" class="chart-baseline"></line>${bars}</svg>`;
}

const PRIORITY_COLORS = { TINGGI: '#b3261e', SEDANG: '#b45309', RENDAH: '#0e7a46' };

async function staffAnalytics() {
  try {
    const [me, data, masters] = await Promise.all([api('/api/me'), api('/api/analytics'), getMasters()]);
    if (me.kind !== 'staff') return loginPage('staff');
    const taxonomyLabels = new Map([
      ...masters.signals.map(s => [s.signal_code, s.community_label]),
      ...masters.event_types.map(event => [event.event_type, event.public_label]),
    ]);
    const villageNames = new Map(masters.villages.map(v => [v.village_code, v.village_name]));

    // Last 12 epidemiological weeks, oldest first, keyed for bucketing.
    const weeks = [];
    const currentPeriod = epiPeriod();
    for (let i = 11; i >= 0; i--) {
      const { year, week } = shiftEpiPeriod(currentPeriod, -i);
      weeks.push({ year, week, key: `${year}-${week}`, label: `M${week}`, count: 0 });
    }
    const weekIndex = new Map(weeks.map((w, i) => [w.key, i]));
    const bySignal = new Map();
    for (const row of data.daily) {
      const { year, week } = epiWeekOf(row.day);
      const index = weekIndex.get(`${year}-${week}`);
      if (index === undefined) continue;
      weeks[index].count += Number(row.count);
      if (!bySignal.has(row.reporting_code)) bySignal.set(row.reporting_code, new Array(weeks.length).fill(0));
      bySignal.get(row.reporting_code)[index] += Number(row.count);
    }
    const total = weeks.reduce((sum, w) => sum + w.count, 0);

    app.innerHTML = `
      <section class="card hero"><div class="page-head"><div><p class="eyebrow">Analitik surveilans</p><h1>Tren dan sebaran laporan</h1><p>12 minggu epidemiologi terakhir (sejak ${formatDate(data.since)}).</p></div><a class="button secondary" href="#staff-home">← Dashboard</a></div></section>

      <section class="card"><h2>Kurva epidemiologi <span class="count">${total}</span></h2><p class="section-intro">Jumlah laporan masuk per minggu epidemiologi.</p>${total ? `<div class="chart-wrap">${epiCurveSvg(weeks)}</div>` : empty('Belum ada laporan pada periode ini')}</section>
      <section class="card"><h2>Laporan per jenis kejadian</h2>${bySignal.size ? `<div class="table-wrap" role="region" aria-label="Laporan per jenis kejadian dan minggu" tabindex="0"><table class="signal-matrix"><thead><tr><th class="signal-col">Jenis kejadian</th>${weeks.map(w => `<th>${esc(w.label)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${[...bySignal.entries()].sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0)).map(([code, counts]) => `<tr><td class="signal-col">${esc(taxonomyLabels.get(code) || code)}</td>${counts.map(v => `<td>${v || ''}</td>`).join('')}<td><strong>${counts.reduce((s, v) => s + v, 0)}</strong></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada data kejadian')}</section>
      <section class="card"><h2>Peta sebaran kasus <span class="count">${data.points.length}</span></h2><p class="section-intro">Laporan dengan titik koordinat, diwarnai menurut prioritas.</p>${data.points.length ? `<div id="analyticsMap" class="map-canvas" aria-label="Peta sebaran laporan"></div><div class="map-legend">${Object.keys(PRIORITY_COLORS).map(label => `<span class="map-legend-item"><span class="map-legend-dot dot-${label}"></span>${label}</span>`).join('')}</div>` : empty('Belum ada laporan dengan koordinat', 'Titik muncul saat pelapor mengisi lokasi di peta.')}</section>
      <section class="card"><h2>Desa terbanyak</h2>${data.villages.length ? `<div class="table-wrap"><table><thead><tr><th>Desa</th><th>Laporan</th></tr></thead><tbody>${data.villages.slice(0, 10).map(row => `<tr><td>${esc(villageNames.get(row.village_code) || row.village_code)}</td><td>${esc(row.count)}</td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada data desa')}</section>`;

    let mapReady = false;
    if (data.points.length) {
      try { await ensureLeaflet(); mapReady = Boolean(window.L); }
      catch { mapReady = false; }
    }
    if (data.points.length && mapReady) {
      const map = L.map('analyticsMap');
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
      const markers = data.points.map(point => L.circleMarker([point.latitude, point.longitude], {
        radius: 8, color: '#ffffff', weight: 2, fillColor: PRIORITY_COLORS[point.current_priority] || '#5c6b62', fillOpacity: 0.85,
      }).bindPopup(`<strong>${esc(point.report_id)}</strong><br>${esc(taxonomyLabels.get(point.reporting_code) || point.reporting_code)}<br>Prioritas ${esc(point.current_priority)} · ${esc(labelStatus(point.current_status))}<br>${formatDate(point.day)}`).addTo(map));
      requestAnimationFrame(() => {
        map.invalidateSize();
        map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [28, 28], maxZoom: 15 });
      });
    } else if (data.points.length) {
      document.querySelector('#analyticsMap').outerHTML = alertBox('error', 'Peta belum dapat dimuat. Periksa koneksi internet lalu muat ulang.');
    }
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('staff');
    pageFailure(error, () => route(), '#staff-home');
  }
}

function epiPeriod() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return epiWeekOf(`${value.year}-${value.month}-${value.day}`);
}

function epiWeekRangeLabel(year, week) {
  const { sunday, saturday } = epiWeekBounds(year, week);
  const format = value => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(value);
  return `${format(sunday)} – ${format(saturday)}`;
}

function epiWeekVisitRangeLabel(year, week) {
  const { sunday, saturday } = epiWeekBounds(year, week);
  const format = value => {
    const weekday = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'UTC' }).format(value);
    const date = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(value).replaceAll('/', '-');
    return `${weekday}, tanggal ${date}`;
  };
  return `${format(sunday)} hingga ${format(saturday)}`;
}

function epiWeekBounds(year, week) {
  const januaryFourth = new Date(Date.UTC(Number(year), 0, 4));
  const sundayOfWeekOne = new Date(januaryFourth);
  sundayOfWeekOne.setUTCDate(januaryFourth.getUTCDate() - januaryFourth.getUTCDay());
  const sunday = new Date(sundayOfWeekOne);
  sunday.setUTCDate(sundayOfWeekOne.getUTCDate() + (Number(week) - 1) * 7);
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  return { sunday, saturday, start: sunday.toISOString().slice(0, 10), end: saturday.toISOString().slice(0, 10) };
}

function shiftEpiPeriod(period, weeks) {
  const sunday = epiWeekBounds(period.year, period.week).sunday;
  sunday.setUTCDate(sunday.getUTCDate() + Number(weeks) * 7);
  return epiWeekOf(sunday.toISOString().slice(0, 10));
}

const sameEpiPeriod = (left, right) => Number(left.year) === Number(right.year) && Number(left.week) === Number(right.week);
const epiWeeksInYear = year => Math.round((epiWeekBounds(Number(year) + 1, 1).sunday - epiWeekBounds(Number(year), 1).sunday) / (7 * 86400000));
const isFutureEpiPeriod = period => epiWeekBounds(period.year, period.week).sunday > epiWeekBounds(epiPeriod().year, epiPeriod().week).sunday;

const periodFields = (period, prefix = 'ibs') => `<div class="grid"><div class="field"><label for="${prefix}Year">Tahun epidemiologi</label><input id="${prefix}Year" type="number" min="2020" max="2100" value="${period.year}"></div><div class="field"><label for="${prefix}Week">Minggu epidemiologi</label><input id="${prefix}Week" type="number" min="1" max="53" value="${period.week}"></div></div>`;

async function ibsLogin(expectedType) {
  if (await guardAccountEntry('routine', expectedType)) return;
  const label = expectedType === 'FASKES' ? 'Fasilitas kesehatan — Laporan W2' : 'Satuan pendidikan — Absensi sakit';
  const rememberKey = rememberedLoginKey(`ibs-${expectedType.toLowerCase()}`);
  const hashQuery = location.hash.includes('?') ? new URLSearchParams(location.hash.split('?')[1]) : new URLSearchParams();
  const quickCode = String(hashQuery.get('account') || '').trim().toUpperCase();
  let accounts = [];
  try {
    accounts = ((await api('/api/public/reporter-accounts?v=2')).institutions || []).filter(item => item.source_type === expectedType);
  } catch (error) {
    app.innerHTML = `<section class="card auth"><a class="back-link" href="#home">← Kembali ke beranda</a>${alertBox('error', error.message)}</section>`;
    return;
  }
  const unifiedSaved = rememberedReporter();
  const migratedCode = unifiedSaved?.kind === 'routine' && accounts.some(item => item.source_code === unifiedSaved.identifier) ? unifiedSaved.identifier : '';
  const rememberedCode = quickCode || storageRead(localStorage, rememberKey) || migratedCode;
  const rememberedAccount = accounts.find(item => item.source_code === rememberedCode);
  const identifierField = rememberedCode
    ? `<div class="remembered-identity"><span>Masuk sebagai institusi</span><strong>${esc(rememberedAccount?.source_name || rememberedCode)}</strong><small>${esc(rememberedCode)}</small><input type="hidden" name="source_code" value="${esc(rememberedCode)}"><button id="forgetIbsCode" type="button" class="text-button">Ganti institusi</button></div>`
    : `<div class="field routine-account-field"><label for="sourceSearch">Pilih ${expectedType === 'FASKES' ? 'fasilitas kesehatan' : 'satuan pendidikan'}</label><div class="routine-combobox"><input id="sourceSearch" type="search" role="combobox" aria-autocomplete="list" aria-controls="routineAccountList" aria-expanded="false" autocomplete="off" placeholder="Cari nama, kode, atau desa" required><input id="sourceCode" name="source_code" type="hidden"><div id="routineAccountList" class="routine-account-list" role="listbox" aria-label="Daftar institusi" hidden></div></div><p class="help">Daftar ini hanya menampilkan ${expectedType === 'FASKES' ? 'fasilitas kesehatan jejaring W2' : 'sekolah'}.</p></div><label class="check compact-check"><input type="checkbox" name="remember_identifier"><span>Ingat institusi di perangkat pribadi ini<small>Jangan pilih pada perangkat bersama.</small></span></label>`;
  app.innerHTML = `<div class="auth-shell routine-auth-shell"><section class="auth-intro"><a class="back-link" href="#home">← Kembali ke beranda</a><div><p class="eyebrow">Laporan rutin jejaring</p><h1>${label}</h1><p>${expectedType === 'FASKES' ? 'Pelaporan penyakit W2 mingguan, termasuk laporan nihil.' : 'Pelaporan jumlah siswa tidak hadir karena sakit setiap minggu.'}</p></div><p class="auth-assurance"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>Daftar institusi telah disaring sesuai jenis jejaring.</p></section><section class="card auth"><p class="eyebrow">Akses institusi</p><h2>${rememberedCode ? `Halo, ${esc(rememberedAccount?.source_name || rememberedCode)}` : 'Pilih institusi Anda'}</h2><p class="section-intro">${rememberedCode ? 'Masukkan PIN untuk melanjutkan.' : `${accounts.length} institusi tersedia dalam kelompok ini.`}</p>${expectedType === 'FASKES' && W2_GUIDE_URL ? `<div class="w2-guide-prompt"><strong>Perlu bantuan mengisi W2?</strong><a class="button secondary" href="${esc(W2_GUIDE_URL)}" target="_blank" rel="noopener noreferrer" aria-label="Buka panduan W2 PDF di tab baru">Buka panduan W2 (PDF) <span aria-hidden="true">↗</span></a></div>` : ''}${authNotice() ? alertBox('error', authNotice()) : ''}${messageBox('message')}<form id="ibsLogin">${identifierField}<div class="field"><label for="sourcePin">PIN 6 digit</label><div class="password-control"><input id="sourcePin" name="pin" type="password" inputmode="numeric" minlength="6" maxlength="6" pattern="[0-9]{6}" autocomplete="current-password" required><button id="toggleIbsPin" type="button" class="password-toggle" aria-pressed="false" aria-label="Tampilkan PIN institusi">Tampilkan</button></div><p class="help">Lupa PIN atau tidak menemukan institusi Anda? ${contactLink('information', 'Hubungi pengelola', 'Hubungi pengelola layanan')}. Petugas tidak akan meminta PIN lama Anda.</p></div><div class="form-actions"><button type="submit">Masuk <span aria-hidden="true">→</span></button></div></form></section></div>`;
  document.querySelector('#forgetIbsCode')?.addEventListener('click', () => {
    storageWrite(localStorage, rememberKey, '');
    if (migratedCode) storageWrite(localStorage, reporterLoginKey, '');
    location.hash = expectedType === 'FASKES' ? '#ibs-login-w2' : '#ibs-login-school';
    ibsLogin(expectedType);
  });
  let selectedAccount = rememberedAccount || null;
  const sourceSearch = document.querySelector('#sourceSearch');
  const sourceCode = document.querySelector('#sourceCode');
  const accountList = document.querySelector('#routineAccountList');
  if (sourceSearch && sourceCode && accountList) {
    let visibleAccounts = [];
    let activeOption = -1;
    const normalized = value => String(value || '').trim().toLocaleLowerCase('id-ID');
    const closeAccounts = () => {
      accountList.hidden = true;
      sourceSearch.setAttribute('aria-expanded', 'false');
      sourceSearch.removeAttribute('aria-activedescendant');
      activeOption = -1;
    };
    const chooseAccount = account => {
      selectedAccount = account;
      sourceSearch.value = account.source_name;
      sourceCode.value = account.source_code;
      sourceSearch.setCustomValidity('');
      sourceSearch.focus();
      closeAccounts();
    };
    const highlightOption = index => {
      const options = [...accountList.querySelectorAll('[role="option"]')];
      if (!options.length) return;
      activeOption = Math.max(0, Math.min(index, options.length - 1));
      options.forEach((option, optionIndex) => {
        const active = optionIndex === activeOption;
        option.classList.toggle('active', active);
        option.setAttribute('aria-selected', String(active));
      });
      sourceSearch.setAttribute('aria-activedescendant', options[activeOption].id);
      options[activeOption].scrollIntoView({ block: 'nearest' });
    };
    const renderAccounts = () => {
      const query = normalized(sourceSearch.value);
      visibleAccounts = accounts.filter(account => [account.source_name, account.source_code, account.village_code]
        .some(value => normalized(value).includes(query)));
      accountList.innerHTML = visibleAccounts.length
        ? `<div class="routine-account-count">${visibleAccounts.length} institusi ditemukan</div>${visibleAccounts.map((account, index) => `<button id="routineAccountOption${index}" class="routine-account-option" type="button" role="option" aria-selected="false" data-account-index="${index}"><span><strong>${esc(account.source_name)}</strong><small>${esc(account.source_code)}</small></span><em>${esc(account.village_code || 'Wilayah belum ditetapkan')}</em></button>`).join('')}`
        : `<div class="routine-account-empty">Institusi tidak ditemukan. Periksa kata pencarian.</div>`;
      accountList.hidden = false;
      sourceSearch.setAttribute('aria-expanded', 'true');
      activeOption = -1;
      accountList.querySelectorAll('.routine-account-option').forEach(option => option.addEventListener('click', () => chooseAccount(visibleAccounts[Number(option.dataset.accountIndex)])));
    };
    sourceSearch.addEventListener('focus', renderAccounts);
    sourceSearch.addEventListener('input', () => {
      const query = normalized(sourceSearch.value);
      const exact = accounts.find(account => normalized(account.source_name) === query || normalized(account.source_code) === query);
      selectedAccount = exact || null;
      sourceCode.value = exact?.source_code || '';
      sourceSearch.setCustomValidity('');
      renderAccounts();
    });
    sourceSearch.addEventListener('keydown', event => {
      if (event.key === 'Escape') return closeAccounts();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (accountList.hidden) renderAccounts();
        highlightOption(event.key === 'ArrowDown' ? activeOption + 1 : activeOption <= 0 ? visibleAccounts.length - 1 : activeOption - 1);
      } else if (event.key === 'Enter' && activeOption >= 0) {
        event.preventDefault();
        chooseAccount(visibleAccounts[activeOption]);
      }
    });
    document.querySelector('.routine-combobox').addEventListener('focusout', () => {
      setTimeout(() => { if (!document.querySelector('.routine-combobox')?.contains(document.activeElement)) closeAccounts(); }, 0);
    });
  }
  bindSecretToggle('sourcePin', 'toggleIbsPin', 'PIN institusi');
  document.querySelector('#ibsLogin').addEventListener('submit', event => submitForm(event, async () => {
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const rawCode = String(values.source_code || '').trim();
      const account = selectedAccount || accounts.find(item => item.source_code.toUpperCase() === rawCode.toUpperCase());
      if (!account) {
        sourceSearch?.setCustomValidity('Pilih institusi dari daftar yang tersedia.');
        sourceSearch?.reportValidity();
        sourceSearch?.focus();
        return;
      }
      values.source_code = account.source_code;
      const result = await api('/api/auth/ibs-login', { method: 'POST', body: JSON.stringify(values) });
      if (result.source.type !== expectedType) { await api('/api/auth/logout', { method: 'POST' }); throw new Error(`Akun ini bukan akun ${label}.`); }
      const shouldRemember = Boolean(rememberedCode || values.remember_identifier);
      storageWrite(localStorage, rememberKey, shouldRemember ? String(values.source_code || '').trim().toUpperCase() : '');
      if (expectedType === 'FASKES') w2LoginAcknowledgementPending = true;
      if (expectedType === 'SEKOLAH') accountLoginAcknowledgement = `Anda masuk sebagai ${result.source.name}.`;
      const destination = destinationAfterLogin(expectedType === 'FASKES' ? '#home' : '#ibs-home', ['#ibs-home']);
      if (location.hash === destination) await render(); else location.hash = destination;
    } catch (error) { document.querySelector('#message').innerHTML = alertBox('error', error.message); }
  }, 'Memeriksa…'));
}

async function ibsW2(period = epiPeriod(), adminSourceId = '', periodChanged = false) {
  try {
    const sourceQuery = adminSourceId ? `&source_id=${encodeURIComponent(adminSourceId)}` : '';
    const data = await api(`/api/ibs/w2?epi_year=${period.year}&epi_week=${period.week}${sourceQuery}`);
    if (!data.indicators.length) {
      app.innerHTML = `<section class="card">${empty('Katalog W2 belum tersedia', 'Administrator perlu mengaktifkan penyakit W2 terlebih dahulu.')}</section>`;
      return;
    }
    const deadlineLabel = `Senin pukul ${String(data.deadline_policy?.deadline_hour ?? 9).padStart(2, '0')}.${String(data.deadline_policy?.deadline_minute ?? 0).padStart(2, '0')} WIB`;
    let showLoginAcknowledgement = !adminSourceId && w2LoginAcknowledgementPending;
    let highlightPeriodChange = Boolean(periodChanged);
    if (showLoginAcknowledgement) w2LoginAcknowledgementPending = false;

    const values = Object.fromEntries(data.indicators.map(item => [item.indicator_code, {
      cases: Number(item.value || 0), lab: Number(item.lab_examined_count || 0),
    }]));
    let details = (data.case_details || []).map(item => ({ ...item }));
    let step = 1;
    let dirty = false;
    let changeVersion = 0;
    let autosaveTimer = null;
    let saveQueue = Promise.resolve();
    let scheduleAutosave = () => {};
    let receipt = null;
    let notes = data.submission?.notes || '';
    let saveState = data.submission?.submission_status === 'SUBMITTED' ? `Revisi ${data.submission.revision}` : data.submission ? 'Draf tersimpan' : 'Belum disimpan';
    const saveStateTone = text => /mencoba lagi|Draf belum tersimpan|Pengiriman belum berhasil|Periksa input/.test(text) ? 'error' : /belum|Perubahan/i.test(text) ? 'unsaved' : /Menyimpan|Mengirim/.test(text) ? 'saving' : /menunggu/.test(text) ? 'pending' : 'saved';
    const updateSaveState = text => {
      saveState = text;
      const state = document.querySelector('.w2-save-state');
      if (state) { state.textContent = text; state.dataset.state = saveStateTone(text); }
    };
    const diseases = data.indicators.filter(item => !Number(item.is_total));
    const totalIndicator = data.indicators.find(item => Number(item.is_total));
    const canSaveDraft = data.submission?.submission_status !== 'SUBMITTED';
    const periodBounds = epiWeekBounds(data.period.year, data.period.week);
    const visitDateMax = [periodBounds.end, todayLocal()].sort()[0];
    let mobileEntryIndex = 0;
    let activeDetailIndex = null;
    let totalVisitsReviewed = data.submission?.submission_status === 'SUBMITTED' || Boolean(Number(data.submission?.total_visits_reviewed));
    let zeroVisitsConfirmed = false;
    const storedReviewedCodes = Array.isArray(data.submission?.reviewed_codes) ? data.submission.reviewed_codes : [];
    const reviewedDiseases = new Set(data.submission?.submission_status === 'SUBMITTED'
      ? diseases.map(item => item.indicator_code)
      : storedReviewedCodes.filter(code => diseases.some(item => item.indicator_code === code)));
    const policyLabels = { REQUIRED: 'Wajib untuk tindak lanjut', CONDITIONAL: 'Tindak lanjut bila lab/ambang', OPTIONAL: 'Opsional', NONE: 'Tanpa rincian' };
    const positives = () => diseases.filter(item => Number(values[item.indicator_code]?.cases || 0) > 0);
    const totalCases = () => diseases.reduce((sum, item) => sum + Number(values[item.indicator_code]?.cases || 0), 0);
    const requiredCount = item => {
      const cases = Number(values[item.indicator_code]?.cases || 0);
      const lab = Number(values[item.indicator_code]?.lab || 0);
      if (!cases || ['NONE', 'OPTIONAL'].includes(item.identity_policy)) return 0;
      if (item.identity_policy === 'REQUIRED') return cases;
      const thresholdReached = item.alert_minimum !== null && item.alert_minimum !== undefined && cases >= Number(item.alert_minimum);
      return thresholdReached ? cases : Math.min(cases, lab);
    };
    const detailComplete = detail => Boolean(detail.patient_name && detail.address && detail.age_value !== '' && detail.age_value !== null && detail.age_unit && detail.sex && detail.sex !== 'UNKNOWN' && detail.onset_date && detail.visit_date);
    const completeCount = code => details.filter(item => item.indicator_code === code && detailComplete(item)).length;
    const detailsForSave = () => {
      const included = new Map();
      return details.filter(item => {
        const limit = Number(values[item.indicator_code]?.cases || 0);
        const count = included.get(item.indicator_code) || 0;
        const hasContent = item.patient_name || item.address || item.age_value !== undefined && item.age_value !== '' || item.onset_date || item.visit_date || item.phone;
        if (!limit || count >= limit || !hasContent) return false;
        included.set(item.indicator_code, count + 1);
        return true;
      });
    };
    const setDirty = value => { dirty = value; leaveGuard = () => dirty; };
    const markChanged = () => {
      changeVersion += 1;
      setDirty(true);
      updateSaveState('Perubahan belum tersimpan');
      scheduleAutosave();
    };
    const ensureRequiredRows = () => positives().forEach(item => {
      const existing = details.filter(detail => detail.indicator_code === item.indicator_code).length;
      for (let index = existing; index < requiredCount(item); index += 1) {
        details.push({ indicator_code: item.indicator_code, age_unit: 'YEAR', sex: 'UNKNOWN', lab_status: 'NOT_TESTED' });
      }
    });
    const syncDetails = () => document.querySelectorAll('.w2-person-card').forEach(card => {
      const detail = details[Number(card.dataset.detailIndex)];
      card.querySelectorAll('[data-key]').forEach(input => { detail[input.dataset.key] = input.value; });
    });

    const calendarStatuses = {
      ON_TIME: { label: 'Tepat waktu', className: 'on-time' },
      LATE: { label: 'Terlambat', className: 'late' },
      DRAFT: { label: 'Draf', className: 'draft' },
      MISSING: { label: 'Belum dilaporkan', className: 'missing' },
      OPEN: { label: 'Minggu berjalan', className: 'open' },
      UPCOMING: { label: 'Minggu mendatang', className: 'upcoming' },
      NOT_REQUIRED: { label: 'Belum diwajibkan', className: 'not-required' },
    };
    let reportingHistoryFilter = 'ALL';
    let reportingHistoryPage = 0;
    let reportingYearGridOpen = false;
    const reportingHistoryRows = () => (data.reporting_calendar?.weeks || []).filter(item => {
      if (['UPCOMING', 'NOT_REQUIRED'].includes(item.status)) return false;
      return reportingHistoryFilter === 'ALL' || (reportingHistoryFilter === 'SUBMITTED' ? ['ON_TIME', 'LATE'].includes(item.status) : reportingHistoryFilter === 'MISSING' ? ['MISSING', 'OPEN'].includes(item.status) : item.status === 'DRAFT');
    }).sort((a, b) => Number(b.week) - Number(a.week));
    const renderReportingHistoryList = () => {
      const rows = reportingHistoryRows(), pageSize = 6;
      reportingHistoryPage = Math.min(reportingHistoryPage, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
      const start = reportingHistoryPage * pageSize;
      return `<div class="w2-history-list">${rows.slice(start, start + pageSize).map(item => {
        const info = calendarStatuses[item.status] || calendarStatuses.OPEN;
        const sent = ['ON_TIME', 'LATE'].includes(item.status);
        const selected = sameEpiPeriod(data.period, {year: data.reporting_calendar.year, week: item.week});
        const label = item.status === 'DRAFT' && item.deadline_passed ? 'Draf melewati batas' : info.label;
        return `<article class="w2-history-row${selected ? ' is-selected' : ''}"><div><h3>Minggu ${esc(item.week)}, ${esc(data.reporting_calendar.year)}${selected ? '<span class="history-selected">Terpilih</span>' : ''}</h3><p>${esc(epiWeekRangeLabel(data.reporting_calendar.year, item.week))}</p><small>${sent ? `Dikirim ${esc(formatDate(item.first_submitted_at))}` : item.last_saved_at ? `Draf disimpan ${esc(formatDate(item.last_saved_at))}` : `Batas ${esc(formatDate(item.deadline_at))}`}</small></div><div class="w2-history-row-actions"><span class="history-status ${info.className}">${esc(label)}</span><button type="button" class="text-button" data-reporting-week="${esc(item.week)}" aria-label="${sent ? 'Lihat laporan' : item.status === 'DRAFT' ? 'Lanjutkan draf' : 'Isi laporan'} minggu ${esc(item.week)}, ${esc(data.reporting_calendar.year)}">${sent ? 'Lihat laporan' : item.status === 'DRAFT' ? 'Lanjutkan draf' : 'Isi laporan'} <span aria-hidden="true">→</span></button></div></article>`;
      }).join('') || '<p class="compact-empty">Tidak ada minggu dengan status ini. Pilih status lain untuk melihat riwayat.</p>'}</div><div class="pagination"><span role="status">${rows.length ? start + 1 : 0}–${Math.min(start + pageSize, rows.length)} dari ${rows.length} minggu</span>${rows.length > pageSize ? `<div class="actions"><button type="button" class="secondary" data-history-page="previous" ${!reportingHistoryPage ? 'disabled' : ''}>Sebelumnya</button><button type="button" class="secondary" data-history-page="next" ${start + pageSize >= rows.length ? 'disabled' : ''}>Berikutnya</button></div>` : ''}</div>`;
    };
    const renderReportingCalendar = () => {
      const calendar = data.reporting_calendar;
      if (!calendar?.weeks?.length) return '';
      const assessed = calendar.weeks.filter(item => item.expected && (item.deadline_passed || ['ON_TIME', 'LATE'].includes(item.status)));
      const submitted = calendar.weeks.filter(item => ['ON_TIME', 'LATE'].includes(item.status));
      const onTime = calendar.weeks.filter(item => item.status === 'ON_TIME');
      const overdue = assessed.filter(item => !['ON_TIME', 'LATE'].includes(item.status));
      const timeliness = assessed.length ? Math.round((onTime.length / assessed.length) * 100) : null;
      const weeks = calendar.weeks.map(item => {
        const statusInfo = calendarStatuses[item.status] || calendarStatuses.OPEN;
        const statusLabel = item.status === 'DRAFT' && item.deadline_passed ? 'Draf, sudah melewati batas waktu' : statusInfo.label;
        const selected = sameEpiPeriod(data.period, { year: calendar.year, week: item.week });
        const sentLabel = item.first_submitted_at ? ` Dikirim ${formatDate(item.first_submitted_at)}.` : '';
        const title = `${statusLabel}.${sentLabel} Batas waktu ${formatDate(item.deadline_at)}.`;
        return `<button type="button" class="w2-calendar-week ${statusInfo.className}${selected ? ' selected' : ''}" data-calendar-week="${esc(item.week)}" aria-label="Minggu ${esc(item.week)}, ${esc(calendar.year)}: ${esc(statusLabel)}" ${selected ? 'aria-current="date"' : ''} title="${esc(title)}" ${item.status === 'UPCOMING' ? 'disabled' : ''}><span>ME</span><strong>${String(item.week).padStart(2, '0')}</strong><i aria-hidden="true"></i></button>`;
      }).join('');
      return `<details class="w2-calendar-card"><summary class="w2-calendar-head"><span class="w2-calendar-copy"><strong>Riwayat pelaporan ${esc(calendar.year)}</strong><small>Lihat status dan lanjutkan laporan per minggu</small></span><span class="w2-calendar-metrics"><span><small>Terkirim</small><strong>${submitted.length}</strong></span><span class="timeliness"><small>Ketepatan</small><strong>${timeliness === null ? '—' : `${timeliness}%`}</strong></span><span><small>Lewat</small><strong>${overdue.length}</strong></span></span></summary><div class="w2-calendar-body"><p class="w2-calendar-deadline">Batas periode terpilih: ${esc(deadlineLabel)}.${assessed.length ? ` ${onTime.length} dari ${assessed.length} minggu dinilai tepat waktu.` : ' Belum ada minggu yang dinilai.'}</p><div class="w2-history-toolbar"><label for="reportingHistoryFilter">Status laporan<select id="reportingHistoryFilter">${[['ALL','Semua status'],['SUBMITTED','Sudah terkirim'],['DRAFT','Draf'],['MISSING','Belum dikirim']].map(([value,label]) => `<option value="${value}" ${reportingHistoryFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p class="help">Minggu terbaru tampil lebih dahulu. Minggu mendatang tersedia di kalender lengkap.</p></div><div id="reportingHistoryRows">${renderReportingHistoryList()}</div><details class="w2-year-grid" ${reportingYearGridOpen ? 'open' : ''}><summary>Kalender lengkap ${esc(calendar.year)}</summary><div class="w2-calendar-grid" aria-label="Status laporan per minggu epidemiologi">${weeks}</div><div class="w2-calendar-legend">${Object.entries(calendarStatuses).map(([key, item]) => `<span class="${item.className}"><i aria-hidden="true"></i>${esc(key === 'OPEN' ? 'Belum dikirim' : item.label)}</span>`).join('')}</div></details></div></details>`;
    };

    const progress = () => `<ol class="report-progress w2-progress" aria-label="Tahapan laporan">${[
      ['1', 'Jumlah kasus'], ['2', 'Rincian lokal'], ['3', 'Tinjau dan kirim'],
    ].map(([number, label], index) => `<li class="${step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}" ${step === index + 1 ? 'aria-current="step"' : ''}><span>${step > index + 1 ? '✓' : number}</span><small>${label}</small></li>`).join('')}</ol>`;

    const reportingTask = () => {
      const submitted = data.submission?.submission_status === 'SUBMITTED';
      const pending = data.pending_revision || receipt?.approval_status === 'PENDING';
      const week = data.reporting_calendar?.weeks?.find(item => Number(item.week) === Number(data.period.week));
      const title = pending ? 'Revisi menunggu persetujuan' : submitted ? 'Laporan sudah terkirim' : data.submission ? 'Draf belum dikirim' : 'Laporan belum dikirim';
      const hasMissingDetails = submitted && data.submission.local_detail_status === 'NEEDS_DETAILS';
      const needsDetails = hasMissingDetails && !pending;
      const description = pending ? 'Laporan aktif tetap berlaku sampai admin menyetujui revisi. Periksa hasil keputusan melalui riwayat pelaporan.'
        : submitted ? `Laporan minggu ${data.period.week} sudah tercatat.${data.submission.local_detail_status === 'NEEDS_DETAILS' ? ' Rincian lokal masih perlu dilengkapi.' : ' Periksa riwayat jika perlu melihat atau memperbaiki data.'}`
        : data.locked ? 'Periode sudah dikunci. Hubungi pengelola untuk bantuan pelaporan terlambat.'
        : data.submission ? 'Isian sudah tersimpan sebagai draf. Tinjau dan kirim agar tercatat sebagai laporan masuk.'
        : 'Isi jumlah kasus dan kunjungan, kemudian tinjau dan kirim. Jika tidak ada kasus, gunakan laporan nihil.';
      const required = Number(data.submission?.detail_required_count || 0), provided = Number(data.submission?.detail_provided_count || 0);
      const facts = `<dl class="workspace-task-facts"><div><dt>Batas pelaporan</dt><dd>${week?.deadline_at ? esc(formatDate(week.deadline_at)) : esc(deadlineLabel)}</dd></div><div><dt>Kiriman pertama</dt><dd>${submitted ? esc(formatDate(data.submission.first_submitted_at)) : 'Belum dikirim'}</dd></div><div><dt>${pending ? 'Rincian laporan aktif' : 'Rincian tindak lanjut'}</dt><dd>${submitted ? hasMissingDetails ? `${Math.max(0, required - provided)} belum lengkap` : 'Lengkap' : 'Ditinjau sebelum dikirim'}</dd></div></dl>`;
      return `<div class="portal-task-summary w2-task-summary${hasMissingDetails ? ' needs-attention' : ''}" aria-labelledby="w2TaskTitle"><div class="workspace-task-copy"><p class="task-kicker">Langkah berikutnya</p><h2 id="w2TaskTitle">${title}</h2><p>${esc(description)}</p>${facts}</div><div class="actions">${!data.locked ? `<button type="button" class="secondary" id="openW2Task" ${needsDetails ? 'data-needs-details' : ''}>${needsDetails ? 'Lengkapi rincian' : pending || submitted ? 'Lihat laporan' : data.submission ? 'Lanjutkan draf' : 'Isi laporan minggu ini'}</button>` : ''}<button type="button" class="text-button" id="openW2History">Buka riwayat <span aria-hidden="true">→</span></button></div></div>`;
    };
    const bindReportingTask = () => {
      if (!adminSourceId) applyRoutineView();
      document.querySelector('#openW2Task')?.addEventListener('click', event => { if (event.currentTarget.hasAttribute('data-needs-details')) { receipt = null; step = 2; renderDetails(); } if (!adminSourceId) { setPortalLocation('report'); applyRoutineView('report'); } focusW2Workspace(); });
      document.querySelector('#openW2History')?.addEventListener('click', () => {
        if (!adminSourceId) { setPortalLocation('history'); applyRoutineView('history'); }
        const history = document.querySelector('.w2-calendar-card');
        if (history) { history.open = true; history.querySelector('summary').focus(); history.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      });
    };

    const shell = content => {
      const currentPeriod = epiPeriod();
      const previousPeriod = shiftEpiPeriod(data.period, -1);
      const nextPeriod = shiftEpiPeriod(data.period, 1);
      const isCurrentPeriod = sameEpiPeriod(data.period, currentPeriod);
      const loginAcknowledgement = showLoginAcknowledgement
        ? `<div id="w2LoginAcknowledgement" class="interaction-toast interaction-toast-success" role="status" aria-live="polite"><span aria-hidden="true">✓</span><div><strong>Berhasil masuk</strong><p>Anda masuk sebagai ${esc(data.source?.source_name || data.source?.source_code || 'fasilitas kesehatan')}. Laporan Minggu ${esc(data.period.week)} siap diisi.</p></div></div>`
        : '';
      const periodAnnouncement = highlightPeriodChange
        ? `<span class="sr-only" role="status">Periode laporan berubah ke Minggu ${esc(data.period.week)}, ${esc(data.period.year)}.</span>`
        : '';
      app.innerHTML = `${loginAcknowledgement}<section class="card hero w2-hero"><div class="page-head"><div><p class="eyebrow">${adminSourceId ? 'Entri administratif W2' : 'Laporan rutin fasilitas kesehatan'}</p><h1>W2 mingguan</h1><p><strong>${esc(data.source?.source_name || data.source?.source_code || 'Faskes jejaring')}</strong>${adminSourceId ? ` · Katalog ${esc(data.catalog_version)}` : ''}</p></div><div class="w2-hero-actions">${adminSourceId || !W2_GUIDE_URL ? '' : `<a class="w2-guide-link" href="${esc(W2_GUIDE_URL)}" target="_blank" rel="noopener noreferrer" aria-label="Buka panduan W2 PDF di tab baru">Panduan W2 (PDF) <span aria-hidden="true">↗</span></a>`}<button id="logout" class="secondary">${adminSourceId ? 'Kembali' : 'Keluar'}</button></div></div></section>
        <section class="card w2-period-card${highlightPeriodChange ? ' is-updated' : ''}">${periodAnnouncement}
          <div class="w2-period-main"><div class="w2-period-summary"><span class="w2-period-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v3M18 3v3M4 9h16"/><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 13h3M13 13h3M8 17h3"/></svg></span><div><span class="w2-period-label">Periode dan rekam jejak</span><div class="w2-period-title"><strong>Minggu ${esc(data.period.week)}, ${esc(data.period.year)}</strong><span class="w2-period-status">${isCurrentPeriod ? 'Minggu berjalan' : 'Riwayat laporan'}</span></div><small>${esc(epiWeekRangeLabel(data.period.year, data.period.week))}</small></div></div>
          <div class="w2-period-actions"><div class="w2-period-nav" role="group" aria-label="Navigasi periode laporan"><button id="previousW2" type="button" class="secondary" aria-label="Buka minggu sebelumnya"><span aria-hidden="true">←</span><span>Minggu ${esc(previousPeriod.week)}</span></button><button id="currentW2" type="button" class="secondary" ${isCurrentPeriod ? 'disabled' : ''}>Minggu ini</button><button id="nextW2" type="button" class="secondary" ${isCurrentPeriod ? 'disabled' : ''} aria-label="Buka minggu berikutnya"><span>Minggu ${esc(nextPeriod.week)}</span><span aria-hidden="true">→</span></button></div></div></div>
          ${reportingTask()}${renderReportingCalendar()}
        </section>
        <div class="w2-content-stack">${data.locked ? `<div class="notice w2-lock-notice"><strong>Periode sudah dikunci.</strong> Batas pelaporan adalah ${esc(deadlineLabel)}. Hubungi admin untuk entri terlambat.</div>` : data.pending_revision ? `<div class="notice w2-lock-notice"><strong>Revisi ${esc(data.pending_revision.proposed_revision)} menunggu keputusan admin.</strong> Laporan aktif belum berubah. Anda dapat memperbarui pengajuan selama belum diputuskan.</div>` : data.revision_requires_approval ? `<div class="notice"><strong>Revisi memerlukan persetujuan admin.</strong> Karena batas ${esc(deadlineLabel)} telah lewat, perubahan yang dikirim tidak langsung menggantikan laporan aktif.</div>` : ''}
        <section class="card w2-workspace">${messageBox('message')}<div class="w2-heading"><div><p class="eyebrow">Entri W2</p><h2>${receipt ? 'Bukti pelaporan' : step === 1 ? 'Catat jumlah kasus' : step === 2 ? 'Lengkapi rincian lokal' : 'Periksa sebelum dikirim'}</h2></div><span class="w2-save-state" data-state="${saveStateTone(saveState)}" aria-live="polite">${esc(saveState)}</span></div>${receipt ? '' : `<div class="form-state-line"><span>Langkah ${step} dari 3</span><span>${data.submission?.submission_status === 'SUBMITTED' ? 'Perubahan dikirim sebagai revisi' : 'Draf perlu dikirim agar menjadi laporan masuk'}</span></div><p class="form-storage-help">${data.submission?.submission_status === 'SUBMITTED' ? 'Periksa perubahan, lalu kirim revisi agar laporan diperbarui.' : data.locked ? 'Periode ini dikunci. Hubungi pengelola jika perlu memperbarui isian.' : 'Perubahan disimpan otomatis sebagai draf. Periksa status penyimpanan sebelum meninggalkan halaman.'}</p>${progress()}`}${content}</section></div>`;
      document.querySelector('#logout').addEventListener('click', async event => {
        if (adminSourceId) {
          if (dirty && !await confirmAction('Isian W2 belum disimpan', 'Kembali sekarang? Perubahan yang belum disimpan akan hilang.', 'Kembali', true)) return;
          location.hash = '#staff-w2-management';
        } else logout(event);
      });
      const openPeriod = async period => {
        if (dirty && !await confirmAction('Ganti periode laporan?', 'Perubahan W2 yang belum disimpan akan hilang.', 'Ganti periode', true)) return;
        if (!adminSourceId) setPortalLocation('report', period);
        ibsW2(period, adminSourceId, true);
      };
      document.querySelector('#previousW2').addEventListener('click', () => openPeriod(previousPeriod));
      document.querySelector('#currentW2').addEventListener('click', () => openPeriod(currentPeriod));
      document.querySelector('#nextW2').addEventListener('click', () => openPeriod(nextPeriod));
      bindReportingTask();
      document.querySelectorAll('[data-calendar-week]').forEach(button => button.addEventListener('click', () => openPeriod({ year: Number(data.reporting_calendar.year), week: Number(button.dataset.calendarWeek) })));
      const bindHistoryRows = () => {
        document.querySelectorAll('[data-reporting-week]').forEach(button => button.addEventListener('click', () => openPeriod({ year: Number(data.reporting_calendar.year), week: Number(button.dataset.reportingWeek) })));
        document.querySelectorAll('[data-history-page]').forEach(button => button.addEventListener('click', () => {
          reportingHistoryPage += button.dataset.historyPage === 'next' ? 1 : -1;
          document.querySelector('#reportingHistoryRows').innerHTML = renderReportingHistoryList();
          bindHistoryRows();
          const heading = document.querySelector('.w2-calendar-head'); heading.focus({preventScroll: true});
          heading.scrollIntoView({block: 'start', behavior: 'smooth'});
        }));
      };
      bindHistoryRows();
      document.querySelector('#reportingHistoryFilter')?.addEventListener('change', event => {
        reportingHistoryFilter = event.currentTarget.value; reportingHistoryPage = 0;
        document.querySelector('#reportingHistoryRows').innerHTML = renderReportingHistoryList(); bindHistoryRows();
      });
      document.querySelector('.w2-year-grid')?.addEventListener('toggle', event => { reportingYearGridOpen = event.currentTarget.open; });
      const loginToast = document.querySelector('#w2LoginAcknowledgement');
      if (loginToast) {
        showLoginAcknowledgement = false;
        setTimeout(() => {
          if (!loginToast.isConnected) return;
          loginToast.classList.add('is-leaving');
          setTimeout(() => loginToast.remove(), 200);
        }, 5000);
      }
      highlightPeriodChange = false;
    };

    const focusW2Workspace = () => requestAnimationFrame(() => {
      const heading = document.querySelector('.w2-heading h2');
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start', behavior: 'auto' });
    });

    const performSave = async (action, triggerButton = null, options = {}) => {
      if (action === 'DRAFT' && !canSaveDraft) {
        const message = document.querySelector('#message');
        if (message) message.innerHTML = alertBox('warning', 'Laporan sudah terkirim. Tinjau perubahan lalu gunakan Kirim revisi W2.');
        return;
      }
      const button = triggerButton || document.querySelector(action === 'DRAFT' ? '#saveDraft' : '#submitW2');
      const versionAtStart = changeVersion;
      const invalidField = [...document.querySelectorAll('.w2-person-card [data-key]')]
        .find(field => field.value && field.validity && !field.validity.valid);
      if (invalidField) {
        updateSaveState('Periksa input yang ditandai');
        if (!options.checkpoint) invalidField.reportValidity();
        return;
      }
      if (!options.checkpoint && autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
      setBusy(button, true, action === 'DRAFT' ? 'Menyimpan draf…' : 'Mengirim…');
      updateSaveState(action === 'DRAFT' ? options.checkpoint ? 'Menyimpan otomatis…' : 'Menyimpan draf…' : 'Mengirim laporan…');
      try {
        const result = await api('/api/ibs/w2', { method: 'POST', body: JSON.stringify({
          source_id: adminSourceId || undefined,
          epi_year: data.period.year, epi_week: data.period.week, values,
          case_details: detailsForSave(), notes, action,
          reviewed_codes: [...reviewedDiseases], total_visits_reviewed: totalVisitsReviewed,
          zero_visits_confirmed: zeroVisitsConfirmed,
          checkpoint: Boolean(options.checkpoint),
        }) });
        if (versionAtStart === changeVersion) setDirty(false);
        if (action === 'DRAFT') {
          data.submission = { ...(data.submission || {}), ...result, notes };
          document.querySelector('.w2-task-summary').outerHTML = reportingTask();
          bindReportingTask();
          const clock = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date());
          updateSaveState(dirty ? 'Perubahan terbaru belum tersimpan' : result.submission_status === 'SUBMITTED' ? `Revisi ${result.revision}`
            : options.checkpoint ? `Tersimpan otomatis ${clock}` : `Draf tersimpan ${clock}`);
          setBusy(button, false);
          if (dirty && options.checkpoint) scheduleAutosave();
          return;
        }
        receipt = result;
        updateSaveState(result.approval_status === 'PENDING' ? 'Revisi menunggu persetujuan' : `Revisi ${result.revision}`);
        if (result.approval_status === 'PENDING') data.pending_revision = result;
        else data.submission = { ...(data.submission || {}), ...result, notes };
        step = 3;
        renderReview();
        focusMessage('w2Receipt');
      } catch (error) {
        if (options.checkpoint) {
          updateSaveState('Belum tersimpan — mencoba lagi');
          scheduleAutosave();
        } else {
          updateSaveState(action === 'DRAFT' ? 'Draf belum tersimpan' : 'Pengiriman belum berhasil');
          document.querySelector('#message').innerHTML = alertBox('error', error.message);
          focusMessage('message');
        }
        setBusy(button, false);
      }
    };
    const save = (action, triggerButton = null, options = {}) => {
      const run = () => performSave(action, triggerButton, options);
      saveQueue = saveQueue.then(run, run);
      return saveQueue;
    };
    scheduleAutosave = () => {
      if (!canSaveDraft || data.locked || !dirty) return;
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        autosaveTimer = null;
        syncDetails();
        save('DRAFT', null, { checkpoint: true });
      }, 1200);
    };

    const renderCounts = () => {
      const mobileEntryCount = diseases.length + (totalIndicator ? 1 : 0);
      const remainingDiseaseCount = () => Math.max(0, diseases.length - reviewedDiseases.size);
      const definitionText = item => item.definition || 'Definisi operasional belum tersedia untuk penyakit ini.';
      const renderDefinition = (item, variant) => {
        const text = definitionText(item);
        const definitionPreviewLimit = 100;
        const compactText = text.replace(/\s+/g, ' ').trim();
        const previewCharacters = [...compactText];
        const longDefinition = previewCharacters.length > definitionPreviewLimit;
        const preview = longDefinition
          ? `${previewCharacters.slice(0, definitionPreviewLimit - 1).join('').trimEnd()}…`
          : compactText;
        const body = longDefinition
          ? `<details class="w2-definition-toggle"><summary><span class="w2-definition-preview">${esc(preview)}</span><span class="w2-definition-more">Lihat selengkapnya</span><span class="w2-definition-less">Sembunyikan</span></summary><p class="w2-definition-full">${esc(text)}</p></details>`
          : `<p class="w2-definition-copy">${esc(preview)}</p>`;
        return variant === 'mobile'
          ? `<section class="w2-flash-definition" aria-label="Definisi operasional ${esc(item.indicator_name)}"><strong>Definisi operasional</strong>${body}</section>`
          : body;
      };
      const mobileDraftControl = canSaveDraft
        ? `<button type="button" class="secondary w2-mobile-save" data-mobile-save ${data.locked ? 'disabled' : ''}>Simpan draf</button>`
        : '<p class="w2-revision-note">Perubahan belum diterapkan. Tinjau lalu kirim revisi W2.</p>';
      const hasLabTracking = diseases.some(item => Number(item.lab_tracking));
      const desktopRows = diseases.map(item => `<div class="w2-count-row${hasLabTracking ? '' : ' w2-count-row-no-lab'}" data-w2-disease-row data-search="${esc(`${item.indicator_code} ${item.indicator_name}`.toLowerCase())}"><div class="w2-disease-copy"><span class="w2-code">${esc(item.indicator_code)}</span><div><strong>${esc(item.indicator_name)}</strong>${item.definition ? renderDefinition(item, 'desktop') : ''}</div></div><div class="w2-number"><label for="case-desktop-${esc(item.indicator_code)}">Kasus</label><input id="case-desktop-${esc(item.indicator_code)}" aria-label="Kasus — ${esc(item.indicator_name)}" data-w2-code="${esc(item.indicator_code)}" data-w2-field="cases" type="number" inputmode="numeric" min="0" max="100000" value="${esc(values[item.indicator_code].cases)}" ${data.locked ? 'disabled' : ''}></div>${Number(item.lab_tracking) ? `<div class="w2-number"><label for="lab-desktop-${esc(item.indicator_code)}">Diperiksa lab</label><input id="lab-desktop-${esc(item.indicator_code)}" aria-label="Diperiksa lab — ${esc(item.indicator_name)}" data-w2-code="${esc(item.indicator_code)}" data-w2-field="lab" type="number" inputmode="numeric" min="0" max="${esc(values[item.indicator_code].cases)}" value="${esc(values[item.indicator_code].lab)}" ${data.locked ? 'disabled' : ''}></div>` : ''}</div>`).join('');
      const mobileCards = diseases.map((item, index) => `<article class="w2-flashcard" data-mobile-entry="${index}" ${index === mobileEntryIndex ? '' : 'hidden'}><div class="w2-flash-meta"><span>Penyakit ${index + 1} dari ${diseases.length}</span></div><div class="w2-flash-title"><span class="w2-code">${esc(item.indicator_code)}</span><h3 tabindex="-1">${esc(item.indicator_name)}</h3></div>${renderDefinition(item, 'mobile')}<div class="w2-flash-inputs"><div class="field"><label for="case-mobile-${esc(item.indicator_code)}">Jumlah kasus</label><input id="case-mobile-${esc(item.indicator_code)}" aria-label="Kasus — ${esc(item.indicator_name)}" data-w2-code="${esc(item.indicator_code)}" data-w2-field="cases" type="number" inputmode="numeric" min="0" max="100000" value="${esc(values[item.indicator_code].cases)}" ${data.locked ? 'disabled' : ''}></div>${Number(item.lab_tracking) ? `<div class="field"><label for="lab-mobile-${esc(item.indicator_code)}">Diperiksa laboratorium</label><input id="lab-mobile-${esc(item.indicator_code)}" aria-label="Diperiksa lab — ${esc(item.indicator_name)}" data-w2-code="${esc(item.indicator_code)}" data-w2-field="lab" type="number" inputmode="numeric" min="0" max="${esc(values[item.indicator_code].cases)}" value="${esc(values[item.indicator_code].lab)}" aria-describedby="lab-note-${esc(item.indicator_code)}" ${data.locked ? 'disabled' : ''}><small id="lab-note-${esc(item.indicator_code)}" class="w2-lab-note">Maksimal sama dengan jumlah kasus.</small></div>` : ''}</div>${mobileDraftControl}<div class="w2-flash-actions"><button type="button" class="secondary" data-mobile-prev="${index}" ${index === 0 ? 'disabled' : ''}>Sebelumnya</button><button type="button" data-mobile-next="${index}" ${data.locked ? 'disabled' : ''}>${Number(values[item.indicator_code].cases) ? 'Simpan dan lanjut' : 'Simpan 0 dan lanjut'}</button></div></article>`).join('');
      const mobileTotalCard = totalIndicator ? `<article class="w2-flashcard w2-flash-total" data-mobile-entry="${diseases.length}" ${mobileEntryIndex === diseases.length ? '' : 'hidden'}><div class="w2-flash-meta"><span>Langkah akhir</span></div><div class="w2-flash-title"><span class="w2-code">X</span><h3 tabindex="-1">Total kunjungan</h3></div><p class="w2-flash-help">Semua kunjungan pasien karena sakit pada periode ini.</p><div class="field"><label for="case-mobile-X">Jumlah seluruh kunjungan</label><input id="case-mobile-X" aria-label="Total kunjungan minggu ini" data-w2-code="X" data-w2-field="cases" type="number" inputmode="numeric" min="0" max="100000" value="${esc(values.X.cases)}" ${data.locked ? 'disabled' : ''}></div><div class="w2-completion-check" data-mobile-completion role="status"><strong>${remainingDiseaseCount() ? `${remainingDiseaseCount()} penyakit belum diperiksa` : 'Semua penyakit sudah diperiksa'}</strong><span>${remainingDiseaseCount() ? 'Periksa satu per satu atau tandai sisanya sebagai nihil.' : 'Anda dapat melanjutkan.'}</span></div><button type="button" class="secondary w2-zero-remaining" data-mobile-zero-remaining ${remainingDiseaseCount() ? '' : 'hidden'} ${data.locked ? 'disabled' : ''}>Tandai ${remainingDiseaseCount()} penyakit tersisa sebagai nihil</button>${mobileDraftControl}<div class="w2-flash-actions"><button type="button" class="secondary" data-mobile-prev="${diseases.length}">Sebelumnya</button><button type="button" data-mobile-finish ${data.locked || remainingDiseaseCount() ? 'disabled' : ''}>Lanjut</button></div></article>` : '';
      const jumpItems = diseases.map((item, index) => { const cases = Number(values[item.indicator_code].cases); const reviewed = reviewedDiseases.has(item.indicator_code); return `<button type="button" data-mobile-jump="${index}" class="${reviewed ? 'complete' : ''}${cases ? ' positive' : ''}"><span class="w2-code">${esc(item.indicator_code)}</span><span>${esc(item.indicator_name)}</span><small data-mobile-status>${reviewed ? (cases ? `${cases} kasus` : 'Nihil') : 'Belum diperiksa'}</small></button>`; }).join('');
      const totalJump = totalIndicator ? `<button type="button" data-mobile-jump="${diseases.length}" class="${totalVisitsReviewed ? 'complete' : ''}"><span class="w2-code">X</span><span>Total kunjungan</span><small data-mobile-status>${totalVisitsReviewed ? `${Number(values.X.cases)} kunjungan` : 'Belum diisi'}</small></button>` : '';

      shell(`<div class="w2-step-head"><p>Masukkan <span class="w2-help-tip"><button type="button" class="w2-help-term" aria-label="Kasus baru penyakit — tampilkan penjelasan" aria-describedby="w2-new-case-help">kasus baru penyakit</button><span id="w2-new-case-help" class="w2-help-content" role="tooltip">Kasus baru adalah orang sakit yang datang pada periode pelaporan dengan diagnosis baru, atau datang dengan penyakit yang sama setelah sebelumnya dinyatakan sembuh. Pasien dengan penyakit yang sama dan belum dinyatakan sembuh termasuk kasus lama dan tidak dihitung kembali.</span></span> berdasarkan data kunjungan Anda dari ${esc(epiWeekVisitRangeLabel(data.period.year, data.period.week))}. Jika tidak ada kasus penyakit yang dimaksud, bisa dikosongkan.</p><button id="zeroW2" type="button" class="secondary" ${data.locked ? 'disabled' : ''}>Jadikan laporan nihil</button></div>
        <div class="w2-live-summary" aria-label="Ringkasan entri"><span><strong id="w2CaseTotal">${totalCases()}</strong><small>Total kasus</small></span><span><strong id="w2PositiveTotal">${positives().length}</strong><small>Penyakit dengan kasus</small></span><span><strong id="w2VisitTotal">${Number(values.X?.cases || 0)}</strong><small>Total kunjungan</small></span></div>
        <div class="w2-disease-tools"><label class="field" for="w2DiseaseSearch"><span>Cari penyakit</span><input id="w2DiseaseSearch" type="search" placeholder="Ketik nama atau kode penyakit" autocomplete="off" aria-controls="w2DiseaseList"></label><p id="w2DiseaseSearchStatus" class="help" role="status" aria-live="polite">Menampilkan ${diseases.length} penyakit.</p></div>
        <div id="w2DiseaseList" class="w2-count-list${adminSourceId ? ' admin-w2-count-list' : ''}${hasLabTracking ? '' : ' w2-count-list-no-lab'}"><div class="w2-count-head${hasLabTracking ? '' : ' w2-count-head-no-lab'}"><span>Penyakit/sindrom</span><span>Kasus</span>${hasLabTracking ? '<span>Diperiksa lab</span>' : ''}</div>${desktopRows}</div>
        ${totalIndicator ? `<div class="w2-total-visits"><div><span class="w2-code">X</span><div><strong>Total kunjungan</strong><small>Semua kunjungan pasien karena sakit pada periode ini.</small></div></div><div class="w2-number"><label for="case-desktop-X">Kunjungan</label><input id="case-desktop-X" aria-label="Total kunjungan minggu ini" data-w2-code="X" data-w2-field="cases" type="number" inputmode="numeric" min="0" max="100000" value="${esc(values.X.cases)}" ${data.locked ? 'disabled' : ''}></div></div>` : ''}
        <div class="w2-mobile-entry"><div class="w2-mobile-progress"><div><strong id="w2MobileProgressText">${reviewedDiseases.size} dari ${diseases.length} penyakit selesai</strong><span>Data tetap tersimpan saat berpindah kartu.</span></div><progress id="w2MobileProgress" aria-label="Kemajuan pengisian penyakit" aria-valuetext="${reviewedDiseases.size} dari ${diseases.length} penyakit selesai" max="${diseases.length}" value="${reviewedDiseases.size}">${reviewedDiseases.size}/${diseases.length}</progress></div><details class="w2-mobile-jump"><summary>Lihat semua penyakit</summary><div>${jumpItems}${totalJump}</div></details><div class="w2-flashdeck" aria-live="polite">${mobileCards}${mobileTotalCard}</div></div>
        <div id="visitWarning"></div><div class="step-actions split w2-desktop-actions">${canSaveDraft ? `<button id="saveDraft" type="button" class="secondary" ${data.locked ? 'disabled' : ''}>Simpan draf</button>` : '<span class="w2-revision-note">Tinjau sebelum mengirim revisi.</span>'}<button id="nextDetails" type="button" ${data.locked ? 'disabled' : ''}>Lanjut</button></div>`);

      const syncMirroredInputs = activeInput => document.querySelectorAll('[data-w2-code]').forEach(field => {
        const current = values[field.dataset.w2Code];
        if (!current) return;
        if (field.dataset.w2Field === 'lab') field.max = current.cases;
        if (field !== activeInput) field.value = field.dataset.w2Field === 'lab' ? current.lab : current.cases;
      });
      const updateCountSummary = () => {
        document.querySelector('#w2CaseTotal').textContent = totalCases();
        document.querySelector('#w2PositiveTotal').textContent = positives().length;
        document.querySelector('#w2VisitTotal').textContent = Number(values.X?.cases || 0);
        document.querySelector('#visitWarning').innerHTML = Number(values.X?.cases || 0) < totalCases() ? alertBox('warning', 'Total kunjungan lebih kecil daripada total kasus W2. Periksa kembali sebelum mengirim.') : '';
      };
      const updateMobileState = () => {
        const progressText = document.querySelector('#w2MobileProgressText');
        const progressBar = document.querySelector('#w2MobileProgress');
        if (progressText) progressText.textContent = `${reviewedDiseases.size} dari ${diseases.length} penyakit selesai`;
        if (progressBar) {
          progressBar.value = reviewedDiseases.size;
          progressBar.textContent = `${reviewedDiseases.size}/${diseases.length}`;
          progressBar.setAttribute('aria-valuetext', `${reviewedDiseases.size} dari ${diseases.length} penyakit selesai`);
        }
        document.querySelectorAll('[data-mobile-jump]').forEach(button => {
          const index = Number(button.dataset.mobileJump);
          const status = button.querySelector('[data-mobile-status]');
          if (index < diseases.length) {
            const item = diseases[index];
            const cases = Number(values[item.indicator_code].cases);
            const reviewed = reviewedDiseases.has(item.indicator_code);
            button.classList.toggle('complete', reviewed);
            button.classList.toggle('positive', cases > 0);
            status.textContent = reviewed ? (cases ? `${cases} kasus` : 'Nihil') : 'Belum diperiksa';
          } else {
            button.classList.toggle('complete', totalVisitsReviewed);
            status.textContent = totalVisitsReviewed ? `${Number(values.X.cases)} kunjungan` : 'Belum diisi';
          }
        });
        document.querySelectorAll('[data-mobile-next]').forEach(button => {
          const item = diseases[Number(button.dataset.mobileNext)];
          button.textContent = Number(values[item.indicator_code].cases) ? 'Simpan dan lanjut' : 'Simpan 0 dan lanjut';
        });
        const remaining = remainingDiseaseCount();
        const completion = document.querySelector('[data-mobile-completion]');
        if (completion) {
          completion.classList.toggle('complete', remaining === 0);
          completion.querySelector('strong').textContent = remaining ? `${remaining} penyakit belum diperiksa` : 'Semua penyakit sudah diperiksa';
          completion.querySelector('span').textContent = remaining ? 'Periksa satu per satu atau tandai sisanya sebagai nihil.' : 'Anda dapat melanjutkan ke rincian lokal.';
        }
        const zeroRemaining = document.querySelector('[data-mobile-zero-remaining]');
        if (zeroRemaining) {
          zeroRemaining.hidden = remaining === 0;
          zeroRemaining.textContent = `Tandai ${remaining} penyakit tersisa sebagai nihil`;
        }
        const finish = document.querySelector('[data-mobile-finish]');
        if (finish) finish.disabled = Boolean(data.locked || remaining);
      };
      const showMobileEntry = (index, moveFocus = true) => {
        mobileEntryIndex = Math.max(0, Math.min(index, mobileEntryCount - 1));
        document.querySelectorAll('[data-mobile-entry]').forEach(card => { card.hidden = Number(card.dataset.mobileEntry) !== mobileEntryIndex; });
        syncMirroredInputs();
        document.querySelector('.w2-mobile-jump')?.removeAttribute('open');
        updateMobileState();
        if (moveFocus) requestAnimationFrame(() => {
          const card = document.querySelector(`[data-mobile-entry="${mobileEntryIndex}"]`);
          card?.scrollIntoView({ block: 'start', behavior: 'auto' });
          card?.querySelector('h3')?.focus({ preventScroll: true });
        });
      };
      const goToDetails = () => { ensureRequiredRows(); step = 2; renderDetails(); focusW2Workspace(); };
      const refresh = event => {
        const input = event.currentTarget;
        const current = values[input.dataset.w2Code];
        if (input.dataset.w2Field === 'lab') {
          current.lab = Math.min(Math.max(0, Number(input.value || 0)), current.cases);
          input.value = current.lab;
        }
        else { current.cases = Math.max(0, Number(input.value || 0)); current.lab = Math.min(current.lab, current.cases); }
        if (input.dataset.w2Code === 'X') {
          totalVisitsReviewed = true;
          zeroVisitsConfirmed = false;
        }
        else reviewedDiseases.add(input.dataset.w2Code);
        markChanged();
        syncMirroredInputs(input);
        updateCountSummary();
        updateMobileState();
      };

      document.querySelectorAll('[data-w2-code]').forEach(input => input.addEventListener('input', refresh));
      document.querySelector('#w2DiseaseSearch')?.addEventListener('input', event => {
        const query = String(event.currentTarget.value || '').trim().toLowerCase();
        let visibleCount = 0;
        document.querySelectorAll('[data-w2-disease-row]').forEach(row => {
          row.hidden = Boolean(query && !row.dataset.search.includes(query));
          if (!row.hidden) visibleCount += 1;
        });
        const searchStatus = document.querySelector('#w2DiseaseSearchStatus');
        if (searchStatus) searchStatus.textContent = visibleCount
          ? `Menampilkan ${visibleCount} dari ${diseases.length} penyakit.`
          : 'Penyakit tidak ditemukan. Periksa nama atau kode pencarian.';
      });
      document.querySelectorAll('[data-mobile-jump]').forEach(button => button.addEventListener('click', () => showMobileEntry(Number(button.dataset.mobileJump))));
      document.querySelectorAll('[data-mobile-prev]').forEach(button => button.addEventListener('click', () => showMobileEntry(Number(button.dataset.mobilePrev) - 1)));
      document.querySelectorAll('[data-mobile-next]').forEach(button => button.addEventListener('click', () => {
        const index = Number(button.dataset.mobileNext);
        reviewedDiseases.add(diseases[index].indicator_code);
        markChanged();
        updateMobileState();
        if (index + 1 < mobileEntryCount) showMobileEntry(index + 1);
        else {
          const nextUnreviewed = diseases.findIndex(item => !reviewedDiseases.has(item.indicator_code));
          if (nextUnreviewed >= 0) showMobileEntry(nextUnreviewed);
          else goToDetails();
        }
      }));
      document.querySelector('[data-mobile-zero-remaining]')?.addEventListener('click', () => {
        diseases.filter(item => !reviewedDiseases.has(item.indicator_code)).forEach(item => {
          values[item.indicator_code] = { cases: 0, lab: 0 };
          reviewedDiseases.add(item.indicator_code);
        });
        markChanged();
        syncMirroredInputs();
        updateCountSummary();
        updateMobileState();
      });
      document.querySelector('[data-mobile-finish]')?.addEventListener('click', () => {
        if (remainingDiseaseCount()) return;
        totalVisitsReviewed = true;
        markChanged();
        goToDetails();
      });
      document.querySelectorAll('[data-mobile-save]').forEach(button => button.addEventListener('click', event => save('DRAFT', event.currentTarget)));
      document.querySelector('#zeroW2').addEventListener('click', async () => {
        const positiveCount = positives().length;
        if (positiveCount && !await confirmAction('Jadikan laporan nihil?', `Angka pada ${positiveCount} penyakit akan dihapus.`, 'Jadikan nihil', true)) return;
        const previousValues = Object.fromEntries(Object.entries(values).map(([code, value]) => [code, { ...value }]));
        const previousReviewed = [...reviewedDiseases];
        const previousTotalVisitsReviewed = totalVisitsReviewed;
        const previousEntryIndex = mobileEntryIndex;
        diseases.forEach(item => { values[item.indicator_code] = { cases: 0, lab: 0 }; reviewedDiseases.add(item.indicator_code); });
        markChanged();
        syncMirroredInputs();
        updateCountSummary();
        showMobileEntry(totalIndicator ? diseases.length : diseases.length - 1);
        const message = document.querySelector('#message');
        if (message) {
          message.innerHTML = '<div class="warning w2-undo-notice" role="status"><span>Seluruh penyakit ditandai nihil.</span><button id="undoZeroW2" type="button" class="secondary">Urungkan</button></div>';
          const undo = document.querySelector('#undoZeroW2');
          undo?.addEventListener('click', () => {
            Object.entries(previousValues).forEach(([code, value]) => { values[code] = { ...value }; });
            reviewedDiseases.clear();
            previousReviewed.forEach(code => reviewedDiseases.add(code));
            totalVisitsReviewed = previousTotalVisitsReviewed;
            mobileEntryIndex = previousEntryIndex;
            markChanged();
            renderCounts();
            focusW2Workspace();
          });
          setTimeout(() => undo?.closest('.w2-undo-notice')?.remove(), 10000);
        }
      });
      document.querySelector('#saveDraft')?.addEventListener('click', event => save('DRAFT', event.currentTarget));
      document.querySelector('#nextDetails').addEventListener('click', () => {
        diseases.forEach(item => reviewedDiseases.add(item.indicator_code));
        totalVisitsReviewed = true;
        markChanged();
        goToDetails();
      });
      syncMirroredInputs();
      showMobileEntry(mobileEntryIndex, false);
    };

    const legacyDetailCard = (item, detail, index, displayIndex, open) => {
      const villages = [...(data.villages || []), { village_code: 'LUAR_WILAYAH', village_name: 'Luar wilayah kerja' }];
      const patientNumber = displayIndex + 1;
      const prefix = `w2-person-${index}`;
      const fieldId = key => `${prefix}-${key}`;
      const complete = detailComplete(detail);
      const patientLabel = `Pasien ${patientNumber} — ${item.indicator_name}`;
      return `<details class="w2-person-card" data-detail-index="${index}" ${open ? 'open' : ''}><summary class="w2-person-summary"><span><strong>Pasien ${patientNumber}</strong><small>${detail.patient_name ? esc(detail.patient_name) : 'Identitas belum lengkap'}</small></span><span class="w2-person-status ${complete ? 'complete' : ''}" data-person-status>${complete ? 'Lengkap' : 'Belum lengkap'}</span></summary><div class="w2-person-body"><div class="w2-person-tools"><button type="button" class="text-button removeDetail" data-index="${index}" aria-label="Hapus ${esc(patientLabel)}">Hapus pasien</button></div><div class="w2-person-fields"><div class="field span-2"><label for="${fieldId('name')}">Nama pasien</label><input id="${fieldId('name')}" data-key="patient_name" value="${esc(detail.patient_name || '')}" autocomplete="off"></div><div class="field"><label for="${fieldId('age')}">Usia</label><div class="w2-age"><input id="${fieldId('age')}" data-key="age_value" type="number" inputmode="numeric" min="0" value="${esc(detail.age_value ?? '')}"><select id="${fieldId('age-unit')}" data-key="age_unit" aria-label="Satuan usia ${esc(patientLabel)}"><option value="YEAR" ${detail.age_unit === 'YEAR' ? 'selected' : ''}>Tahun</option><option value="MONTH" ${detail.age_unit === 'MONTH' ? 'selected' : ''}>Bulan</option><option value="DAY" ${detail.age_unit === 'DAY' ? 'selected' : ''}>Hari</option></select></div></div><div class="field"><label for="${fieldId('sex')}">Jenis kelamin</label><select id="${fieldId('sex')}" data-key="sex"><option value="UNKNOWN">Pilih</option><option value="L" ${detail.sex === 'L' ? 'selected' : ''}>Laki-laki</option><option value="P" ${detail.sex === 'P' ? 'selected' : ''}>Perempuan</option></select></div><div class="field"><label for="${fieldId('village')}">Desa domisili</label><select id="${fieldId('village')}" data-key="village_code"><option value="">Pilih desa</option>${villages.map(village => `<option value="${esc(village.village_code)}" ${detail.village_code === village.village_code ? 'selected' : ''}>${esc(village.village_name)}</option>`).join('')}</select></div><div class="field span-2"><label for="${fieldId('address')}">Alamat lengkap</label><textarea id="${fieldId('address')}" data-key="address" rows="2">${esc(detail.address || '')}</textarea></div><div class="field"><label for="${fieldId('onset')}">Tanggal mulai sakit</label><input id="${fieldId('onset')}" data-key="onset_date" type="date" max="${todayLocal()}" value="${esc(detail.onset_date || '')}"></div><div class="field"><label for="${fieldId('visit')}">Tanggal kunjungan</label><input id="${fieldId('visit')}" data-key="visit_date" type="date" max="${todayLocal()}" value="${esc(detail.visit_date || '')}"></div>${Number(item.lab_tracking) ? `<div class="field"><label for="${fieldId('lab')}">Status laboratorium</label><select id="${fieldId('lab')}" data-key="lab_status"><option value="NOT_TESTED">Belum diperiksa</option><option value="PENDING" ${detail.lab_status === 'PENDING' ? 'selected' : ''}>Menunggu hasil</option><option value="POSITIVE" ${detail.lab_status === 'POSITIVE' ? 'selected' : ''}>Positif</option><option value="NEGATIVE" ${detail.lab_status === 'NEGATIVE' ? 'selected' : ''}>Negatif</option><option value="INCONCLUSIVE" ${detail.lab_status === 'INCONCLUSIVE' ? 'selected' : ''}>Inkonklusif</option></select></div>` : ''}<div class="field"><label for="${fieldId('phone')}">Nomor kontak <small>(opsional)</small></label><input id="${fieldId('phone')}" data-key="phone" inputmode="tel" value="${esc(detail.phone || '')}" autocomplete="off"></div></div></div></details>`;
    };

    const detailCard = (item, detail, index, displayIndex, totalPatients, open, previousIndex, nextIndex) => {
      const villages = [...(data.villages || []), { village_code: 'LUAR_WILAYAH', village_name: 'Luar wilayah kerja' }];
      const patientNumber = displayIndex + 1;
      const prefix = `w2-person-${index}`;
      const fieldId = key => `${prefix}-${key}`;
      const complete = detailComplete(detail);
      const patientLabel = `Pasien ${patientNumber} — ${item.indicator_name}`;
      const ageUnit = detail.age_unit || 'YEAR';
      const ageMax = ageUnit === 'DAY' ? 365 : ageUnit === 'MONTH' ? 240 : 130;
      const onsetMax = detail.visit_date && detail.visit_date < visitDateMax ? detail.visit_date : visitDateMax;
      const requiredTag = '<small class="w2-required">Wajib</small>';
      const previousButton = previousIndex === null
        ? '<button type="button" class="secondary" disabled>Sebelumnya</button>'
        : `<button type="button" class="secondary" data-patient-move="${previousIndex}">Sebelumnya</button>`;
      const nextButton = nextIndex === null
        ? '<button type="button" data-patient-review>Simpan dan tinjau laporan</button>'
        : `<button type="button" data-patient-move="${nextIndex}">Simpan dan lanjut ke pasien berikutnya</button>`;
      return `<details class="w2-person-card" data-detail-index="${index}" ${open ? 'open' : ''}>
        <summary class="w2-person-summary"><span><strong>Pasien ${patientNumber} dari ${totalPatients}</strong><small>${detail.patient_name ? esc(detail.patient_name) : 'Identitas belum lengkap'}</small></span><span class="w2-person-status ${complete ? 'complete' : ''}" data-person-status>${complete ? 'Lengkap' : 'Belum lengkap'}</span></summary>
        <div class="w2-person-body"><div class="w2-person-tools"><button type="button" class="text-button removeDetail" data-index="${index}" aria-label="Hapus ${esc(patientLabel)}">Hapus pasien</button></div>
        <div class="w2-person-fields">
          <div class="field span-2"><label for="${fieldId('name')}">Nama pasien ${requiredTag}</label><input id="${fieldId('name')}" data-key="patient_name" value="${esc(detail.patient_name || '')}" aria-label="Nama ${esc(patientLabel)}" autocomplete="off" required></div>
          <div class="field"><label for="${fieldId('age')}">Usia ${requiredTag}</label><div class="w2-age"><input id="${fieldId('age')}" data-key="age_value" type="number" inputmode="numeric" min="0" max="${ageMax}" value="${esc(detail.age_value ?? '')}" aria-label="Usia ${esc(patientLabel)}" required><select id="${fieldId('age-unit')}" data-key="age_unit" aria-label="Satuan usia ${esc(patientLabel)}"><option value="YEAR" ${ageUnit === 'YEAR' ? 'selected' : ''}>Tahun</option><option value="MONTH" ${ageUnit === 'MONTH' ? 'selected' : ''}>Bulan</option><option value="DAY" ${ageUnit === 'DAY' ? 'selected' : ''}>Hari</option></select></div></div>
          <div class="field"><label for="${fieldId('sex')}">Jenis kelamin ${requiredTag}</label><select id="${fieldId('sex')}" data-key="sex" aria-label="Jenis kelamin ${esc(patientLabel)}" required><option value="UNKNOWN">Pilih</option><option value="L" ${detail.sex === 'L' ? 'selected' : ''}>Laki-laki</option><option value="P" ${detail.sex === 'P' ? 'selected' : ''}>Perempuan</option></select></div>
          <div class="field"><label for="${fieldId('village')}">Desa domisili</label><select id="${fieldId('village')}" data-key="village_code" aria-label="Desa domisili ${esc(patientLabel)}"><option value="">Pilih desa</option>${villages.map(village => `<option value="${esc(village.village_code)}" ${detail.village_code === village.village_code ? 'selected' : ''}>${esc(village.village_name)}</option>`).join('')}</select></div>
          <div class="field span-2"><label for="${fieldId('address')}">Alamat lengkap ${requiredTag}</label><textarea id="${fieldId('address')}" data-key="address" rows="2" aria-label="Alamat lengkap ${esc(patientLabel)}" required>${esc(detail.address || '')}</textarea></div>
          <div class="field"><label for="${fieldId('onset')}">Tanggal mulai sakit ${requiredTag}</label><input id="${fieldId('onset')}" data-key="onset_date" type="date" max="${onsetMax}" value="${esc(detail.onset_date || '')}" aria-label="Tanggal mulai sakit ${esc(patientLabel)}" required></div>
          <div class="field"><label for="${fieldId('visit')}">Tanggal kunjungan ${requiredTag}</label><input id="${fieldId('visit')}" data-key="visit_date" type="date" min="${periodBounds.start}" max="${visitDateMax}" value="${esc(detail.visit_date || '')}" aria-label="Tanggal kunjungan ${esc(patientLabel)}" required><small>${esc(epiWeekRangeLabel(data.period.year, data.period.week))}</small></div>
          ${Number(item.lab_tracking) ? `<div class="field"><label for="${fieldId('lab')}">Status laboratorium</label><select id="${fieldId('lab')}" data-key="lab_status" aria-label="Status laboratorium ${esc(patientLabel)}"><option value="NOT_TESTED">Belum diperiksa</option><option value="PENDING" ${detail.lab_status === 'PENDING' ? 'selected' : ''}>Menunggu hasil</option><option value="POSITIVE" ${detail.lab_status === 'POSITIVE' ? 'selected' : ''}>Positif</option><option value="NEGATIVE" ${detail.lab_status === 'NEGATIVE' ? 'selected' : ''}>Negatif</option><option value="INCONCLUSIVE" ${detail.lab_status === 'INCONCLUSIVE' ? 'selected' : ''}>Inkonklusif</option></select></div>` : ''}
          <div class="field"><label for="${fieldId('phone')}">Nomor kontak <small>(opsional)</small></label><input id="${fieldId('phone')}" data-key="phone" type="tel" inputmode="tel" value="${esc(detail.phone || '')}" aria-label="Nomor kontak ${esc(patientLabel)}" autocomplete="off"></div>
        </div><div class="w2-person-navigation"><span>Pasien ${patientNumber} dari ${totalPatients}</span><div>${previousButton}${nextButton}</div></div></div>
      </details>`;
    };

    const renderDetails = () => {
      ensureRequiredRows();
      const rowsFor = item => details.map((detail, index) => ({ detail, index }))
        .filter(row => row.detail.indicator_code === item.indicator_code)
        .slice(0, Number(values[item.indicator_code].cases || 0));
      const detailOrder = positives().flatMap(rowsFor).map(row => row.index);
      if (!detailOrder.includes(activeDetailIndex)) {
        activeDetailIndex = detailOrder.find(index => !detailComplete(details[index])) ?? detailOrder[0] ?? null;
      }
      const renderDetailGroup = item => {
        const rows = rowsFor(item);
        const required = requiredCount(item);
        const cards = rows.map((row, displayIndex) => {
          const orderIndex = detailOrder.indexOf(row.index);
          return detailCard(item, row.detail, row.index, displayIndex, rows.length, row.index === activeDetailIndex,
            orderIndex > 0 ? detailOrder[orderIndex - 1] : null,
            orderIndex >= 0 && orderIndex < detailOrder.length - 1 ? detailOrder[orderIndex + 1] : null);
        }).join('');
        return `<section class="w2-detail-group"><div class="w2-detail-head"><div><span class="w2-code">${esc(item.indicator_code)}</span><h3>${esc(item.indicator_name)}</h3></div><span class="w2-policy ${String(item.identity_policy).toLowerCase()}">${esc(policyLabels[item.identity_policy] || 'Opsional')}</span></div><div class="w2-detail-progress"><span>${values[item.indicator_code].cases} kasus dilaporkan</span><span>${completeCount(item.indicator_code)}/${required || values[item.indicator_code].cases} rincian lengkap${required ? ' untuk tindak lanjut' : ''}</span></div><div class="w2-person-list">${cards}</div><button type="button" class="secondary addDetail" data-code="${esc(item.indicator_code)}" ${rows.length >= values[item.indicator_code].cases ? 'disabled' : ''}>+ Tambah rincian pasien</button></section>`;
      };
      shell(`<p class="section-intro">Untuk penyakit bertanda wajib, identitas pasien diperlukan untuk tindak lanjut. Angka agregat W2 tetap dapat dikirim bila rincian belum lengkap.</p>
        ${positives().length ? positives().map(renderDetailGroup).join('') : empty('Tidak ada kasus penyakit yang dilaporkan', 'Anda dapat langsung meninjau dan mengirim laporan nihil.')}
        <div class="step-actions split w2-detail-footer"><button id="backCounts" type="button" class="secondary">Kembali</button><div class="actions">${canSaveDraft ? `<button id="saveDraft" type="button" class="secondary" ${data.locked ? 'disabled' : ''}>Simpan draf</button>` : '<span class="w2-revision-note">Perubahan diterapkan setelah revisi dikirim.</span>'}<button id="nextReview" type="button" ${data.locked ? 'disabled' : ''}>Tinjau laporan</button></div></div>`);
      const goToReview = () => { syncDetails(); step = 3; renderReview(); focusW2Workspace(); };
      const moveToPatient = targetIndex => {
        syncDetails();
        activeDetailIndex = Number(targetIndex);
        renderDetails();
        requestAnimationFrame(() => {
          const card = document.querySelector(`.w2-person-card[data-detail-index="${activeDetailIndex}"]`);
          card?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          card?.querySelector('[data-key="patient_name"]')?.focus({ preventScroll: true });
        });
      };
      document.querySelectorAll('.w2-person-summary').forEach(summary => summary.addEventListener('click', event => {
        if (window.matchMedia('(max-width: 760px)').matches) event.preventDefault();
      }));
      document.querySelectorAll('[data-key]').forEach(input => input.addEventListener('input', event => {
        syncDetails();
        if (event.currentTarget.dataset.key === 'age_unit') {
          const age = event.currentTarget.closest('.w2-age')?.querySelector('[data-key="age_value"]');
          if (age) age.max = event.currentTarget.value === 'DAY' ? '365' : event.currentTarget.value === 'MONTH' ? '240' : '130';
        }
        if (event.currentTarget.dataset.key === 'visit_date') {
          const onset = event.currentTarget.closest('.w2-person-fields')?.querySelector('[data-key="onset_date"]');
          if (onset) onset.max = event.currentTarget.value && event.currentTarget.value < visitDateMax ? event.currentTarget.value : visitDateMax;
        }
        markChanged();
        const card = event.currentTarget.closest('.w2-person-card');
        const detail = details[Number(card?.dataset.detailIndex)];
        const status = card?.querySelector('[data-person-status]');
        const complete = detail && detailComplete(detail);
        if (status) {
          status.textContent = complete ? 'Lengkap' : 'Belum lengkap';
          status.classList.toggle('complete', Boolean(complete));
        }
      }));
      document.querySelectorAll('[data-patient-move]').forEach(button => button.addEventListener('click', () => moveToPatient(button.dataset.patientMove)));
      document.querySelectorAll('[data-patient-review]').forEach(button => button.addEventListener('click', goToReview));
      document.querySelectorAll('.addDetail').forEach(button => button.addEventListener('click', () => {
        syncDetails();
        details.push({ indicator_code: button.dataset.code, age_unit: 'YEAR', sex: 'UNKNOWN', lab_status: 'NOT_TESTED' });
        activeDetailIndex = details.length - 1;
        markChanged();
        renderDetails();
      }));
      document.querySelectorAll('.removeDetail').forEach(button => button.addEventListener('click', () => {
        syncDetails();
        const removedIndex = Number(button.dataset.index);
        details.splice(removedIndex, 1);
        activeDetailIndex = null;
        markChanged();
        renderDetails();
      }));
      document.querySelector('#backCounts').addEventListener('click', () => { syncDetails(); step = 1; renderCounts(); focusW2Workspace(); });
      document.querySelector('#saveDraft')?.addEventListener('click', event => { syncDetails(); save('DRAFT', event.currentTarget); });
      document.querySelector('#nextReview').addEventListener('click', goToReview);
    };

    const renderReceipt = () => {
      const pending = receipt.approval_status === 'PENDING';
      return `<section id="w2Receipt" class="w2-receipt completion-card" role="status" aria-labelledby="w2ReceiptTitle"><span aria-hidden="true">✓</span><div><h2 id="w2ReceiptTitle">${pending ? 'Revisi berhasil diajukan' : 'Laporan W2 berhasil dikirim'}</h2><p><strong>Minggu ${esc(data.period.week)}, ${esc(data.period.year)}</strong> · ${esc(epiWeekRangeLabel(data.period.year, data.period.week))}</p><p>ID ${esc(receipt.submission_id)} · ${pending ? `Usulan revisi ${esc(receipt.proposed_revision)}` : `Revisi ${esc(receipt.revision)}`}</p><p>${pending ? 'Menunggu persetujuan admin. Laporan aktif belum berubah; periksa keputusan melalui riwayat.' : receipt.local_detail_status === 'NEEDS_DETAILS' ? `Angka W2 sudah tercatat. Lengkapi rincian lokal yang masih kurang (${esc(receipt.detail_provided_count)}/${esc(receipt.detail_required_count)}) melalui revisi laporan.` : 'Laporan dan rincian lokal yang diperlukan sudah lengkap. Anda dapat melihatnya kembali melalui riwayat pelaporan.'}</p><div class="actions">${!adminSourceId ? '<button type="button" id="receiptW2Overview">Kembali ke ringkasan</button>' : ''}<button type="button" class="secondary" id="receiptW2History">Lihat riwayat pelaporan</button></div></div></section>`;
    };
    const renderReview = () => {
      const hasLabTracking = diseases.some(item => Number(item.lab_tracking));
      const required = positives().reduce((sum, item) => sum + requiredCount(item), 0);
      const provided = positives().reduce((sum, item) => sum + Math.min(requiredCount(item), completeCount(item.indicator_code)), 0);
      const incompleteDetails = Math.max(0, required - provided);
      const calendarWeek = data.reporting_calendar?.weeks?.find(item => Number(item.week) === Number(data.period.week));
      const alreadySubmitted = data.submission?.submission_status === 'SUBMITTED';
      const timingStatus = alreadySubmitted && ['ON_TIME', 'LATE'].includes(calendarWeek?.status)
        ? calendarWeek.status : calendarWeek?.deadline_passed ? 'LATE' : 'ON_TIME';
      const timingTitle = alreadySubmitted
        ? `Kiriman pertama ${timingStatus === 'ON_TIME' ? 'tepat waktu' : 'terlambat'}`
        : timingStatus === 'ON_TIME' ? 'Masih dalam batas waktu' : 'Akan tercatat terlambat';
      const timingText = calendarWeek?.deadline_at
        ? `Batas pelaporan ${formatDate(calendarWeek.deadline_at)}.${alreadySubmitted ? (data.revision_requires_approval ? ' Revisi ini memerlukan persetujuan admin.' : ' Revisi tidak mengubah ketepatan kiriman pertama.') : ''}`
        : `Batas tepat waktu adalah ${deadlineLabel} setelah minggu laporan berakhir.`;
      const decisionPanel = `<div class="w2-decision-panel"><div class="${timingStatus === 'ON_TIME' ? 'on-time' : 'late'}"><strong>${esc(timingTitle)}</strong><span>${esc(timingText)}</span></div>${incompleteDetails ? `<div class="details-warning"><strong>${incompleteDetails} rincian tindak lanjut belum lengkap</strong><span>Angka agregat tetap dapat dikirim. Identitas tersebut tetap perlu dilengkapi untuk tindak lanjut lokal.</span></div>` : '<div class="details-complete"><strong>Rincian tindak lanjut lengkap</strong><span>Semua identitas yang diperlukan untuk tindak lanjut sudah terisi.</span></div>'}</div>`;
      const reviewLabHead = hasLabTracking ? '<th>Lab</th>' : '';
      const reviewLabCell = item => Number(item.lab_tracking) ? `<td data-label="Lab">${esc(values[item.indicator_code].lab)}</td>` : '';
      const reviewColspan = hasLabTracking ? 5 : 4;
      shell(`${receipt ? renderReceipt() : ''}<div class="w2-review-summary"><div><span>Total kasus</span><strong>${totalCases()}</strong></div><div><span>Total kunjungan</span><strong>${Number(values.X?.cases || 0)}</strong></div><div><span>Rincian lokal</span><strong>${required ? `${provided}/${required}` : 'Opsional'}</strong></div></div>${Number(values.X?.cases || 0) < totalCases() ? alertBox('warning', 'Total kunjungan lebih kecil daripada total kasus W2. Laporan tetap dapat dikirim, tetapi sebaiknya diperiksa kembali.') : ''}<div class="table-wrap mobile-cards"><table><thead><tr><th>Kode</th><th>Penyakit/sindrom</th><th>Kasus</th>${reviewLabHead}<th>Rincian</th></tr></thead><tbody>${positives().length ? positives().map(item => `<tr><td data-label="Kode"><strong>${esc(item.indicator_code)}</strong></td><td data-label="Penyakit">${esc(item.indicator_name)}</td><td data-label="Kasus">${esc(values[item.indicator_code].cases)}</td>${reviewLabCell(item)}<td data-label="Rincian">${completeCount(item.indicator_code)}/${requiredCount(item) || values[item.indicator_code].cases} ${requiredCount(item) ? 'diperlukan' : 'opsional'}</td></tr>`).join('') : `<tr><td colspan="${reviewColspan}">Laporan nihil — seluruh penyakit bernilai 0.</td></tr>`}</tbody></table></div><div class="field"><label for="w2Notes">Catatan untuk pengelola layanan <small>(opsional)</small></label><textarea id="w2Notes" maxlength="1000" ${data.locked || receipt ? 'disabled' : ''}>${esc(notes)}</textarea></div>${receipt ? '<div class="step-actions"><button id="editRevision" type="button" class="secondary">Buka dan revisi laporan</button></div>' : `<div class="step-actions split"><button id="backDetails" type="button" class="secondary">Kembali</button><div class="actions">${canSaveDraft ? `<button id="saveDraft" type="button" class="secondary" ${data.locked ? 'disabled' : ''}>Simpan draf</button>` : ''}<button id="submitW2" type="button" ${data.locked ? 'disabled' : ''}>${data.submission?.submission_status === 'SUBMITTED' ? 'Kirim revisi W2' : 'Kirim laporan W2'}</button></div></div>`}`);
      if (!receipt) document.querySelector('.w2-review-summary')?.insertAdjacentHTML('beforebegin', decisionPanel);
      else {
        const table = document.querySelector('.w2-workspace > .table-wrap');
        if (table) {
          const disclosure = document.createElement('details');
          disclosure.className = 'data-explanation';
          const summary = document.createElement('summary');
          summary.textContent = 'Lihat rincian jumlah kasus';
          table.before(disclosure); disclosure.append(summary, table);
        }
        if (!notes) document.querySelector('#w2Notes').closest('.field').hidden = true;
      }
      document.querySelector('#w2Notes')?.addEventListener('input', event => { notes = event.currentTarget.value; markChanged(); });
      document.querySelector('#backDetails')?.addEventListener('click', () => { step = 2; renderDetails(); focusW2Workspace(); });
      document.querySelector('#saveDraft')?.addEventListener('click', event => save('DRAFT', event.currentTarget));
      document.querySelector('#submitW2')?.addEventListener('click', async event => {
        const totalVisits = Number(values.X?.cases || 0);
        const actionLabel = data.submission?.submission_status === 'SUBMITTED'
          ? (data.revision_requires_approval ? 'Ajukan revisi' : 'Kirim revisi') : 'Kirim laporan';
        const zeroVisitWarning = totalVisits === 0
          ? `PERHATIAN: Total Kunjungan adalah 0.\nKonfirmasikan bahwa benar-benar tidak ada kunjungan pasien di faskes ini selama minggu epidemiologi tersebut.\n\n`
          : '';
        const confirmation = `${zeroVisitWarning}${actionLabel} W2 minggu ${data.period.week}, ${data.period.year}?\n\nTotal kasus: ${totalCases()}\nTotal kunjungan: ${totalVisits}\nRincian tindak lanjut: ${provided}/${required || 0}\nKetepatan: ${timingTitle}`;
        if (!await confirmAction(`${actionLabel} W2?`, confirmation, actionLabel)) return;
        zeroVisitsConfirmed = totalVisits === 0;
        save('SUBMIT', event.currentTarget);
      });
      document.querySelector('#editRevision')?.addEventListener('click', () => ibsW2(data.period, adminSourceId));
      document.querySelector('#receiptW2Overview')?.addEventListener('click', () => { setPortalLocation('overview'); applyRoutineView('overview', true); });
      document.querySelector('#receiptW2History')?.addEventListener('click', async () => {
        await ibsW2(data.period, adminSourceId);
        document.querySelector('#openW2History')?.click();
      });
    };

    renderCounts();
    if (!adminSourceId) applyRoutineView();
  } catch (error) {
    if (!adminSourceId && error.status === 401) return redirectForExpiredSession('routine', 'FASKES');
    app.innerHTML = `<section class="card"><a class="back-link" href="${adminSourceId ? '#staff-w2-management' : '#home'}">← Kembali</a>${alertBox('error', error.message)}<button type="button" class="secondary" id="retryW2">Muat ulang laporan W2</button></section>`;
    document.querySelector('#retryW2').addEventListener('click', () => ibsW2(period, adminSourceId, periodChanged));
  }
}

async function ibsSchool(period = epiPeriod(), notice = null, adminSourceId = '') {
  try {
    const sourceQuery = adminSourceId ? `&source_id=${encodeURIComponent(adminSourceId)}` : '';
    const data = await api(`/api/ibs/school?epi_year=${period.year}&epi_week=${period.week}${sourceQuery}`);
    const submission = data.submission || null;
    const enrollmentInfo = data.enrollment || {};
    const enrollmentReviewRequired = Boolean(enrollmentInfo.review_required);
    const defaultEnrollment = submission?.enrolled_count ?? (enrollmentInfo.has_default ? enrollmentInfo.default_count : '');
    const currentPeriod = epiPeriod();
    const previousPeriod = shiftEpiPeriod(data.period, -1);
    const nextPeriod = shiftEpiPeriod(data.period, 1);
    const isCurrentPeriod = sameEpiPeriod(data.period, currentPeriod);
    const statusLabels = { ON_TIME: 'Tepat waktu', LATE: 'Terlambat', MISSING: 'Belum masuk', OPEN: 'Belum dikirim', NOT_REQUIRED: 'Belum wajib', UPCOMING: 'Akan datang' };
    const calendarWeeks = (data.calendar?.weeks || []).map(item => {
      const selected = Number(item.week) === Number(data.period.week);
      const label = statusLabels[item.status] || item.status;
      const statusClass = String(item.status).toLowerCase().replaceAll('_', '-');
      return `<button type="button" class="w2-calendar-week ${esc(statusClass)}${selected ? ' selected' : ''}" data-school-week="${esc(item.week)}" aria-label="Minggu ${esc(item.week)}: ${esc(label)}" ${selected ? 'aria-current="date"' : ''} ${item.status === 'UPCOMING' ? 'disabled' : ''}><span>ME</span><strong>${String(item.week).padStart(2, '0')}</strong><i aria-hidden="true"></i></button>`;
    }).join('');
    app.innerHTML = `<section class="card hero school-hero"><div class="page-head"><div><p class="eyebrow">${adminSourceId ? 'Entri administratif sekolah' : 'IBS Satuan Pendidikan'}</p><h1>Absensi sakit mingguan</h1><p><strong>${esc(data.source?.source_name || 'Satuan pendidikan')}</strong> · ${esc(data.source?.source_code || '')}</p></div><button id="logout" class="secondary">${adminSourceId ? 'Kembali' : 'Keluar'}</button></div></section>
      ${adminSourceId ? '' : loginAcknowledgement()}
      <section class="card school-period-card"><div class="school-period-summary"><div><span class="school-period-label">Periode laporan</span><h2>Minggu ${esc(data.period.week)}, ${esc(data.period.year)}</h2><p>${esc(epiWeekRangeLabel(data.period.year, data.period.week))}</p></div><span class="status ${submission ? 'status-TERVERIFIKASI' : 'status-MEMERLUKAN_INFORMASI'}">${submission ? `TERKIRIM · REVISI ${esc(submission.revision)}` : 'BELUM DIKIRIM'}</span></div>
        <div class="school-period-actions" role="group" aria-label="Navigasi periode laporan"><button id="previousSchool" type="button" class="secondary">← Minggu ${esc(previousPeriod.week)}</button><button id="currentSchool" type="button" class="secondary" ${isCurrentPeriod ? 'disabled' : ''}>Minggu ini</button><button id="nextSchool" type="button" class="secondary" ${isCurrentPeriod ? 'disabled' : ''}>Minggu ${esc(nextPeriod.week)} →</button></div>
        <details class="school-period-chooser"><summary>Pilih minggu lain dan lihat riwayat</summary><div class="school-period-controls">${periodFields(data.period, 'school')}<button id="loadSchool" type="button" class="secondary">Tampilkan</button></div><p class="help">Batas tepat waktu: ${esc(data.calendar?.deadline_rule || 'Senin pukul 12.00 WIB setelah minggu laporan berakhir')}.</p><div class="w2-calendar-grid school-calendar" aria-label="Riwayat laporan sekolah">${calendarWeeks}</div></details>
      </section>
      <section class="card school-workspace">${messageBox('message')}${data.locked ? '<div class="notice"><strong>Periode sudah dikunci.</strong> Hubungi petugas pengelola layanan untuk koreksi.</div>' : ''}
        <div class="school-heading"><div><p class="eyebrow">Data agregat sekolah</p><h2>${submission ? 'Periksa atau revisi laporan' : 'Isi laporan minggu ini'}</h2></div>${submission ? `<div class="school-saved-meta"><span>Terakhir disimpan</span><strong>${formatDate(submission.submitted_at)}</strong></div>` : ''}</div>
        ${enrollmentReviewRequired ? `<div class="school-enrollment-review"><div><strong>Perbarui data tahun ajaran ${esc(enrollmentInfo.academic_year_label)}</strong><p>${enrollmentInfo.has_default ? `Jumlah ${esc(enrollmentInfo.default_count)} siswa diambil dari laporan sebelumnya. Periksa dan ubah jika jumlah siswa tahun ajaran baru berbeda.` : 'Masukkan jumlah siswa aktif, lalu konfirmasikan sebagai jumlah awal untuk tahun ajaran ini.'}</p></div><label><input id="enrollmentConfirmed" type="checkbox" ${data.locked ? 'disabled' : ''} required> Saya sudah memeriksa jumlah siswa tahun ajaran ${esc(enrollmentInfo.academic_year_label)}</label></div>` : `<div class="school-enrollment-default"><span>Jumlah siswa tahun ajaran ${esc(enrollmentInfo.academic_year_label)} terisi otomatis.</span><small>Ubah hanya jika ada perubahan siswa. Angka baru akan digunakan pada laporan berikutnya.${enrollmentInfo.updated_at ? ` Terakhir diperbarui ${formatDate(enrollmentInfo.updated_at)}.` : ''}</small></div>`}
        <p class="school-definition"><strong>Yang dihitung:</strong> siswa yang tidak masuk karena sakit sedikitnya satu hari pada minggu ini. Hitung setiap siswa satu kali meskipun absen beberapa hari.</p>
        <form id="schoolForm"><div class="grid school-count-grid"><div class="field"><label for="enrolled">Jumlah siswa terdaftar</label><input id="enrolled" name="enrolled_count" type="number" inputmode="numeric" min="0" max="100000" value="${esc(defaultEnrollment)}" aria-describedby="enrolledHelp" ${data.locked ? 'disabled' : ''} required><small id="enrolledHelp">${enrollmentReviewRequired ? 'Periksa untuk tahun ajaran baru. Setelah disimpan, angka ini terisi otomatis setiap minggu.' : 'Terisi otomatis; dapat diubah jika jumlah siswa berubah.'}</small></div><div class="field"><label for="sick">Siswa tidak masuk karena sakit</label><input id="sick" name="sick_absent_count" type="number" inputmode="numeric" min="0" max="${esc(defaultEnrollment === '' ? 100000 : defaultEnrollment)}" value="${esc(submission?.sick_absent_count ?? '')}" aria-describedby="sickHelp" ${data.locked ? 'disabled' : ''} required><small id="sickHelp">Siswa unik, bukan jumlah hari ketidakhadiran.</small></div></div>
          <div class="school-live-summary" role="status" aria-live="polite"><span>Persentase siswa yang tidak masuk karena sakit</span><strong id="schoolPercentage">${submission ? esc(submission.sick_percentage) : '0'}%</strong><small id="schoolCountSummary">${submission ? `${esc(submission.sick_absent_count)} dari ${esc(submission.enrolled_count)} siswa` : 'Lengkapi kedua angka di atas'}</small></div>
          <div class="field"><label for="schoolNotes">Catatan <small>(opsional)</small></label><textarea id="schoolNotes" name="notes" maxlength="1000" rows="3" placeholder="Contoh: keluhan yang sering dilaporkan atau kelas yang terdampak" ${data.locked ? 'disabled' : ''}>${esc(submission?.notes || '')}</textarea></div>
          <div class="step-actions split school-form-actions"><button id="zeroSchool" type="button" class="secondary" ${data.locked ? 'disabled' : ''}>Isi 0 siswa absen karena sakit</button><button type="submit" ${data.locked ? 'disabled' : ''}>${submission ? 'Tinjau revisi' : 'Tinjau laporan'}</button></div>
        </form>
        <section id="schoolReview" class="school-review" hidden aria-labelledby="schoolReviewTitle"><div class="section-heading"><div><p class="eyebrow">Konfirmasi</p><h2 id="schoolReviewTitle" tabindex="-1">Periksa sebelum dikirim</h2></div><span class="status status-MEMERLUKAN_INFORMASI">BELUM DIKIRIM</span></div><div id="schoolReviewValues" class="school-review-values"></div><div class="step-actions split"><button id="editSchool" type="button" class="secondary">Kembali mengedit</button><button id="confirmSchool" type="button">${submission ? 'Kirim revisi' : 'Kirim laporan'}</button></div></section>
      </section>`;
    if (notice) {
      document.querySelector('#message').innerHTML = alertBox(notice.type || 'success', notice.text);
      focusMessage('message');
    }
    dismissLoginAcknowledgement();
    const form = document.querySelector('#schoolForm');
    const review = document.querySelector('#schoolReview');
    const enrolled = document.querySelector('#enrolled');
    const sick = document.querySelector('#sick');
    const notes = document.querySelector('#schoolNotes');
    const enrollmentConfirmed = document.querySelector('#enrollmentConfirmed');
    let dirty = false;
    let pendingValues = null;
    const setMessage = (type, text) => { document.querySelector('#message').innerHTML = alertBox(type, text); focusMessage('message'); };
    const updateSummary = () => {
      const enrolledCount = Number(enrolled.value || 0);
      const sickCount = Number(sick.value || 0);
      sick.max = String(enrolledCount);
      const percentage = enrolledCount ? Number(((sickCount / enrolledCount) * 100).toFixed(2)) : 0;
      document.querySelector('#schoolPercentage').textContent = `${percentage}%`;
      document.querySelector('#schoolCountSummary').textContent = enrolled.value === '' || sick.value === '' ? 'Lengkapi kedua angka di atas' : `${sickCount} dari ${enrolledCount} siswa`;
    };
    const confirmLeave = async () => !dirty || await confirmAction('Perubahan belum dikirim', 'Berpindah sekarang? Perubahan laporan sekolah akan hilang.', 'Tetap berpindah', true);
    const openPeriod = async target => { if (await confirmLeave()) ibsSchool(target, null, adminSourceId); };
    [enrolled, sick, notes].forEach(input => input.addEventListener('input', () => { dirty = true; updateSummary(); }));
    enrollmentConfirmed?.addEventListener('change', () => { dirty = true; });
    document.querySelector('#zeroSchool').addEventListener('click', () => { sick.value = '0'; dirty = true; updateSummary(); sick.focus(); });
    document.querySelector('#previousSchool').addEventListener('click', () => openPeriod(previousPeriod));
    document.querySelector('#currentSchool').addEventListener('click', () => openPeriod(currentPeriod));
    document.querySelector('#nextSchool').addEventListener('click', () => openPeriod(nextPeriod));
    document.querySelector('#loadSchool').addEventListener('click', () => {
      const target = { year: Number(document.querySelector('#schoolYear').value), week: Number(document.querySelector('#schoolWeek').value) };
      if (target.year < 2020 || target.year > 2100 || target.week < 1 || target.week > epiWeeksInYear(target.year)) return setMessage('error', 'Periode epidemiologi tidak valid.');
      if (isFutureEpiPeriod(target)) return setMessage('error', 'Minggu tersebut belum dimulai. Pilih minggu berjalan atau sebelumnya.');
      openPeriod(target);
    });
    document.querySelectorAll('[data-school-week]').forEach(button => button.addEventListener('click', () => openPeriod({ year: data.period.year, week: Number(button.dataset.schoolWeek) })));
    document.querySelector('#logout').addEventListener('click', async event => {
      if (!await confirmLeave()) return;
      if (adminSourceId) location.hash = '#staff-school-management'; else logout(event);
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const enrolledCount = Number(enrolled.value);
      const sickCount = Number(sick.value);
      if (!Number.isInteger(enrolledCount) || enrolledCount < 0) return setMessage('error', 'Jumlah siswa terdaftar harus berupa angka bulat nol atau lebih.');
      if (!Number.isInteger(sickCount) || sickCount < 0 || sickCount > enrolledCount) { sick.focus(); return setMessage('error', 'Jumlah siswa sakit tidak boleh melebihi jumlah siswa terdaftar.'); }
      if (enrollmentReviewRequired && !enrollmentConfirmed?.checked) { enrollmentConfirmed?.focus(); return setMessage('error', `Konfirmasikan jumlah siswa tahun ajaran ${enrollmentInfo.academic_year_label} terlebih dahulu.`); }
      pendingValues = { enrolled_count: enrolledCount, sick_absent_count: sickCount, notes: notes.value.trim() };
      const percentage = enrolledCount ? Number(((sickCount / enrolledCount) * 100).toFixed(2)) : 0;
      document.querySelector('#schoolReviewValues').innerHTML = `<div><span>Sekolah</span><strong>${esc(data.source?.source_name)}</strong></div><div><span>Periode</span><strong>ME ${esc(data.period.week)}, ${esc(data.period.year)}</strong><small>${esc(epiWeekRangeLabel(data.period.year, data.period.week))}</small></div><div><span>Siswa terdaftar</span><strong>${enrolledCount}</strong></div><div><span>Siswa sakit</span><strong>${sickCount}</strong></div><div><span>Persentase</span><strong>${percentage}%</strong></div><div class="span-2"><span>Catatan</span><strong>${pendingValues.notes ? esc(pendingValues.notes) : 'Tidak ada catatan'}</strong></div>`;
      form.hidden = true;
      review.hidden = false;
      document.querySelector('#schoolReviewTitle').focus?.();
      review.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    document.querySelector('#editSchool').addEventListener('click', () => { review.hidden = true; form.hidden = false; enrolled.focus(); });
    document.querySelector('#confirmSchool').addEventListener('click', async event => {
      if (!pendingValues) return;
      const button = event.currentTarget;
      setBusy(button, true, 'Mengirim…');
      try {
        const result = await api('/api/ibs/school', { method: 'POST', body: JSON.stringify({
          epi_year: data.period.year,
          epi_week: data.period.week,
          source_id: adminSourceId || undefined,
          expected_revision: Number(submission?.revision || 0),
          confirmed: true,
          enrollment_confirmed: !enrollmentReviewRequired || Boolean(enrollmentConfirmed?.checked),
          ...pendingValues,
        }) });
        dirty = false;
        await ibsSchool(data.period, { type: 'success', text: `${result.message} Persentase sakit: ${result.sick_percentage}%.` }, adminSourceId);
      } catch (error) {
        review.hidden = true;
        form.hidden = false;
        setMessage('error', error.message);
        setBusy(button, false);
      }
    });
    updateSummary();
  } catch (error) {
    if (!adminSourceId && error.status === 401) return redirectForExpiredSession('routine', 'SEKOLAH');
    app.innerHTML = `<section class="card"><a class="back-link" href="${adminSourceId ? '#staff-school-management' : '#home'}">← Kembali</a>${alertBox('error', error.message)}<div class="form-actions"><button id="retrySchool" type="button">Coba lagi</button></div></section>`;
    document.querySelector('#retrySchool').addEventListener('click', () => ibsSchool(period, null, adminSourceId));
  }
}

async function ibsHome() {
  try {
    const me = await api('/api/ibs/me');
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const year = Number(params.get('epi_year')), week = Number(params.get('epi_week'));
    const selectedPeriod = Number.isInteger(year) && year >= 2020 && year <= 2100 && Number.isInteger(week) && week >= 1 && week <= epiWeeksInYear(year) ? { year, week } : epiPeriod();
    return me.source_type === 'FASKES' ? ibsW2(selectedPeriod) : ibsSchool();
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('routine');
    app.innerHTML = `<section class="card"><a class="back-link" href="#home">← Kembali ke beranda</a>${alertBox('error', error.message)}<div class="form-actions"><button id="retryIbsHome" type="button">Coba lagi</button></div></section>`;
    document.querySelector('#retryIbsHome').addEventListener('click', ibsHome);
  }
}

async function staffIbs(period = epiPeriod(), workspace = 'w2') {
  try {
    const [me, data] = await Promise.all([api('/api/me'), api(`/api/ibs/dashboard?epi_year=${period.year}&epi_week=${period.week}`)]);
    if (me.kind !== 'staff') return loginPage('staff');
    const isW2 = workspace === 'w2';
    const workspaceTitle = isW2 ? 'Laporan W2 Faskes' : 'Laporan Sekolah';
    if (isW2) data.school_completeness = [];
    else {
      data.w2_completeness = [];
      data.w2_submissions = [];
      data.pending_details = 0;
    }
    data.markers = (data.markers || []).filter(row => row.target_type === (isW2 ? 'W2' : 'SEKOLAH'));
    data.pending_marker_count = data.markers.filter(row => !row.reviewed_at).length;
    const canReviewMarkers = ['ADMIN', 'VERIFIKATOR'].includes(me.role);
    const w2Rate = data.completeness.w2.expected ? Math.round(100 * data.completeness.w2.submitted / data.completeness.w2.expected) : 0;
    const schoolRate = data.completeness.schools.expected ? Math.round(100 * data.completeness.schools.submitted / data.completeness.schools.expected) : 0;
    const w2Completeness = data.w2_completeness || [];
    const schoolCompleteness = data.school_completeness || [];
    const schoolSummary = data.school_summary || {};
    const w2Submissions = data.w2_submissions || [];
    const w2SubmissionById = new Map(w2Submissions.map(row => [row.submission_id, row]));
    const missingW2 = w2Completeness.filter(row => !row.submission_id);
    const missingSchools = schoolCompleteness.filter(row => !row.submission_id);
    const incompleteW2 = w2Submissions.filter(row => row.local_detail_status !== 'COMPLETE');
    const pendingMarkers = (data.markers || []).filter(row => !row.reviewed_at);
    const actionCount = missingW2.length + missingSchools.length + incompleteW2.length + pendingMarkers.length;
    const adminEntryAction = (type, row) => me.role === 'ADMIN'
      ? `<a class="button secondary" href="#admin-${type}/${encodeURIComponent(row.source_id)}">Isi laporan</a>`
      : '<span class="muted">Menunggu laporan</span>';
    const actionRows = [
      ...pendingMarkers.map(row => `<tr data-worklist-item><td data-label="Prioritas"><span class="priority-pill priority-TINGGI">Tinjau</span></td><td data-label="Tugas"><strong>Periksa penanda ambang</strong><br><small>${esc(row.target_code)}: ${esc(row.observed_value)} (ambang ${esc(row.threshold_value)})</small></td><td data-label="Institusi">${esc(row.source_name)}</td><td class="action-cell">${canReviewMarkers ? `<button class="secondary reviewMarker" data-id="${esc(row.marker_id)}">Tandai ditinjau</button>` : '<span class="muted">Hanya lihat</span>'}</td></tr>`),
      ...incompleteW2.map(row => `<tr data-worklist-item><td data-label="Prioritas"><span class="priority-pill priority-SEDANG">Lengkapi</span></td><td data-label="Tugas"><strong>Lengkapi rincian lokal</strong><br><small>${esc(row.detail_provided_count)}/${esc(row.detail_required_count)} rincian lengkap</small></td><td data-label="Institusi">${esc(row.source_name)}<br><small>${esc(row.source_code)}</small></td><td class="action-cell"><a class="button secondary" href="#staff-w2/${encodeURIComponent(row.submission_id)}">Buka laporan</a></td></tr>`),
      ...missingW2.map(row => `<tr data-worklist-item><td data-label="Prioritas"><span class="priority-pill priority-SEDANG">Belum masuk</span></td><td data-label="Tugas"><strong>W2 belum dikirim</strong><br><small>Faskes jejaring</small></td><td data-label="Institusi">${esc(row.source_name)}<br><small>${esc(row.source_code)}</small></td><td class="action-cell">${adminEntryAction('w2', row)}</td></tr>`),
      ...missingSchools.map(row => `<tr data-worklist-item><td data-label="Prioritas"><span class="priority-pill priority-RENDAH">Belum masuk</span></td><td data-label="Tugas"><strong>Laporan sekolah belum dikirim</strong><br><small>Satuan pendidikan</small></td><td data-label="Institusi">${esc(row.source_name)}<br><small>${esc(row.source_code)}</small></td><td class="action-cell">${adminEntryAction('school', row)}</td></tr>`),
    ];
    const faskesRows = w2Completeness.map(row => {
      const submission = w2SubmissionById.get(row.submission_id);
      const search = `${row.source_name} ${row.source_code} ${row.village_code || ''} ${row.subvillage_name || ''}`.toLowerCase();
      return `<tr data-filter-row data-search="${esc(search)}" data-status="${row.submission_id ? 'submitted' : 'missing'}"><td data-label="Institusi"><strong>${esc(row.source_name)}</strong><br><small>${esc(row.source_code)}</small></td><td data-label="Wilayah">${valueOrDash(row.village_code)}${row.subvillage_name ? `<br><small>${esc(row.subvillage_name)}</small>` : ''}</td><td data-label="Status">${row.submission_id ? '<span class="status status-TERVERIFIKASI">SUDAH MASUK</span>' : '<span class="status status-MEMERLUKAN_INFORMASI">BELUM MASUK</span>'}</td><td data-label="Kasus">${submission ? esc(submission.total_cases) : '—'}</td><td data-label="Rincian">${submission ? (submission.local_detail_status === 'COMPLETE' ? '<span class="status complete">Lengkap</span>' : `<span class="status needs-details">${esc(submission.detail_provided_count)}/${esc(submission.detail_required_count)} lengkap</span>`) : '—'}</td><td data-label="Waktu kirim">${row.submitted_at ? `${formatDate(row.submitted_at)}${row.revision ? `<br><small>Revisi ${esc(row.revision)}</small>` : ''}` : '—'}</td><td class="action-cell"><div class="actions">${row.submission_id ? `<a class="button secondary" href="#staff-w2/${encodeURIComponent(row.submission_id)}">Buka</a>` : ''}${me.role === 'ADMIN' ? `<a class="button secondary" href="#admin-w2/${encodeURIComponent(row.source_id)}">${row.submission_id ? 'Edit data' : 'Isi laporan'}</a>` : !row.submission_id ? '<span class="muted">Menunggu laporan</span>' : ''}</div></td></tr>`;
    }).join('');
    const schoolRows = schoolCompleteness.map(row => {
      const search = `${row.source_name} ${row.source_code} ${row.village_code || ''}`.toLowerCase();
      return `<tr data-filter-row data-search="${esc(search)}" data-status="${row.submission_id ? 'submitted' : 'missing'}"><td data-label="Sekolah"><strong>${esc(row.source_name)}</strong><br><small>${esc(row.source_code)}</small></td><td data-label="Wilayah">${valueOrDash(row.village_code)}</td><td data-label="Status">${row.submission_id ? '<span class="status status-TERVERIFIKASI">SUDAH MASUK</span>' : '<span class="status status-MEMERLUKAN_INFORMASI">BELUM MASUK</span>'}</td><td data-label="Terdaftar">${row.submission_id ? esc(row.enrolled_count) : '—'}</td><td data-label="Sakit">${row.submission_id ? esc(row.sick_absent_count) : '—'}</td><td data-label="Persentase">${row.submission_id ? `${esc(row.sick_percentage)}%` : '—'}</td><td data-label="Waktu kirim">${row.submitted_at ? `${formatDate(row.submitted_at)}<br><small>Revisi ${esc(row.revision)}</small>` : '—'}</td><td class="action-cell"><div class="actions">${row.submission_id ? `<a class="button secondary" href="#staff-school/${encodeURIComponent(row.submission_id)}">Buka</a>` : ''}${me.role === 'ADMIN' ? `<a class="button secondary" href="#admin-school/${encodeURIComponent(row.source_id)}">${row.submission_id ? 'Edit data' : 'Isi laporan'}</a>` : !row.submission_id ? '<span class="muted">Menunggu laporan</span>' : ''}</div></td></tr>`;
    }).join('');
    app.innerHTML = `<section class="card hero"><div class="page-head"><div><p class="eyebrow">IBS rutin</p><h1>Dashboard mingguan</h1><p>Minggu ${esc(data.period.week)}, ${esc(data.period.year)} · ${esc(epiWeekRangeLabel(data.period.year, data.period.week))}</p></div><div class="actions"><button id="logout" class="secondary">Keluar</button></div></div></section>

      <section class="card ibs-period-toolbar"><div class="w2-period-controls">${periodFields(data.period, 'dash')}<button id="loadDash" type="button" class="secondary">Tampilkan periode</button></div></section>
      <section class="grid metrics ibs-priority-metrics"><button class="metric ibs-metric-tab" data-open-ibs-tab="faskes"><span>W2 masuk</span><strong>${data.completeness.w2.submitted}/${data.completeness.w2.expected}</strong><small>${w2Rate}% kelengkapan</small></button><button class="metric ibs-metric-tab" data-open-ibs-tab="school"><span>Sekolah masuk</span><strong>${data.completeness.schools.submitted}/${data.completeness.schools.expected}</strong><small>${schoolRate}% kelengkapan</small></button><button class="metric ibs-metric-tab${data.pending_details ? ' is-alert' : ''}" data-open-ibs-tab="actions"><span>Rincian perlu dilengkapi</span><strong>${data.pending_details || 0}</strong><small>laporan W2</small></button><button class="metric ibs-metric-tab${data.pending_marker_count ? ' is-alert' : ''}" data-open-ibs-tab="actions"><span>Penanda perlu ditinjau</span><strong>${data.pending_marker_count || 0}</strong><small>belum ditinjau</small></button></section>
      <section class="card ibs-workspace">
        <div class="ibs-workspace-tabs" role="tablist" aria-label="Bagian dashboard IBS"><button id="ibs-tab-actions" class="ibs-workspace-tab" type="button" role="tab" aria-selected="true" aria-controls="ibs-panel-actions" data-ibs-tab="actions">Perlu tindakan <span class="count">${actionCount}</span></button><button id="ibs-tab-faskes" class="ibs-workspace-tab" type="button" role="tab" aria-selected="false" aria-controls="ibs-panel-faskes" data-ibs-tab="faskes">Faskes W2 <span class="count">${w2Completeness.length}</span></button><button id="ibs-tab-school" class="ibs-workspace-tab" type="button" role="tab" aria-selected="false" aria-controls="ibs-panel-school" data-ibs-tab="school">Sekolah <span class="count">${schoolCompleteness.length}</span></button><button id="ibs-tab-summary" class="ibs-workspace-tab" type="button" role="tab" aria-selected="false" aria-controls="ibs-panel-summary" data-ibs-tab="summary">Ringkasan</button></div>
        <div id="ibs-panel-actions" class="ibs-workspace-panel" role="tabpanel" aria-labelledby="ibs-tab-actions" data-ibs-panel="actions"><div class="section-heading"><div><p class="eyebrow">Prioritas periode ini</p><h2>Perlu tindakan</h2><p class="section-intro">Tugas yang masih membutuhkan perhatian, diurutkan dari yang paling mendesak.</p></div><span class="count">${actionCount}</span></div>${actionRows.length ? `<div class="table-wrap mobile-cards ibs-limited-list" data-list-limit="10"><table><thead><tr><th>Prioritas</th><th>Tugas</th><th>Institusi</th><th>Aksi</th></tr></thead><tbody>${actionRows.join('')}</tbody></table></div><button class="secondary ibs-show-all" type="button" data-show-list hidden>Lihat semua</button>` : empty('Semua laporan untuk periode ini sudah tertangani.')}</div>
        <div id="ibs-panel-faskes" class="ibs-workspace-panel" role="tabpanel" aria-labelledby="ibs-tab-faskes" data-ibs-panel="faskes" hidden><div class="section-heading"><div><p class="eyebrow">Kelengkapan W2</p><h2>Faskes jejaring</h2><p class="section-intro">Status laporan dan rincian seluruh faskes yang wajib melapor.</p></div><span class="count" data-result-count>${w2Completeness.length}</span></div><div class="ibs-list-tools"><label class="field"><span>Cari faskes</span><input type="search" placeholder="Nama, kode, atau wilayah" data-list-search></label><label class="field"><span>Status laporan</span><select data-list-status><option value="all">Semua status</option><option value="missing">Belum masuk</option><option value="submitted">Sudah masuk</option></select></label></div>${w2Completeness.length ? `<div class="table-wrap mobile-cards ibs-limited-list" data-list-limit="10"><table><thead><tr><th>Institusi</th><th>Wilayah</th><th>Status</th><th>Kasus</th><th>Rincian</th><th>Waktu kirim</th><th>Aksi</th></tr></thead><tbody>${faskesRows}</tbody></table></div><p class="ibs-filter-empty" hidden>Tidak ada faskes yang cocok dengan pencarian.</p><button class="secondary ibs-show-all" type="button" data-show-list hidden>Lihat semua</button>` : empty('Belum ada faskes jejaring aktif')}</div>
        <div id="ibs-panel-school" class="ibs-workspace-panel" role="tabpanel" aria-labelledby="ibs-tab-school" data-ibs-panel="school" hidden><div class="grid metrics school-summary-metrics"><div class="metric"><span>Siswa terdaftar</span><strong>${esc(schoolSummary.enrolled ?? 0)}</strong><small>dari sekolah yang melapor</small></div><div class="metric"><span>Siswa sakit</span><strong>${esc(schoolSummary.sick ?? 0)}</strong><small>unik dalam minggu laporan</small></div><div class="metric"><span>Persentase sakit</span><strong>${esc(schoolSummary.sick_percentage ?? 0)}%</strong><small>agregat seluruh sekolah</small></div></div><div class="section-heading"><div><p class="eyebrow">Kelengkapan sekolah</p><h2>Satuan pendidikan</h2><p class="section-intro">Status dan angka yang dilaporkan oleh seluruh sekolah aktif.</p></div><span class="count" data-result-count>${schoolCompleteness.length}</span></div><div class="ibs-list-tools"><label class="field"><span>Cari sekolah</span><input type="search" placeholder="Nama, kode, atau wilayah" data-list-search></label><label class="field"><span>Status laporan</span><select data-list-status><option value="all">Semua status</option><option value="missing">Belum masuk</option><option value="submitted">Sudah masuk</option></select></label></div>${schoolCompleteness.length ? `<div class="table-wrap mobile-cards ibs-limited-list" data-list-limit="10"><table><thead><tr><th>Sekolah</th><th>Wilayah</th><th>Status</th><th>Terdaftar</th><th>Sakit</th><th>Persentase</th><th>Waktu kirim</th><th>Aksi</th></tr></thead><tbody>${schoolRows}</tbody></table></div><p class="ibs-filter-empty" hidden>Tidak ada sekolah yang cocok dengan pencarian.</p><button class="secondary ibs-show-all" type="button" data-show-list hidden>Lihat semua</button>` : empty('Belum ada sekolah aktif')}</div>
        <div id="ibs-panel-summary" class="ibs-workspace-panel" role="tabpanel" aria-labelledby="ibs-tab-summary" data-ibs-panel="summary" hidden><div class="section-heading"><div><p class="eyebrow">Rekap periode</p><h2>Total agregat W2</h2><p class="section-intro">Jumlah kasus per indikator tanpa identitas pasien.</p></div></div>${data.w2_totals.length ? `<div class="table-wrap"><table><thead><tr><th>Indikator</th><th>Kasus</th><th>Diperiksa lab</th></tr></thead><tbody>${data.w2_totals.map(row => `<tr><td>${esc(row.indicator_name)}</td><td>${esc(row.total)}</td><td>${esc(row.lab_total || 0)}</td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada W2 masuk')}<details class="ibs-export-panel"><summary>Unduh data periode ini</summary><div><p class="help">Ekspor sekolah memuat angka agregat dan catatan setiap sekolah. Ekspor W2 tidak pernah memuat identitas pasien.</p><div class="actions"><a class="button secondary" href="/api/ibs/w2-export?epi_year=${encodeURIComponent(data.period.year)}&epi_week=${encodeURIComponent(data.period.week)}">Unduh CSV W2</a><a class="button secondary" href="/api/ibs/school-export?epi_year=${encodeURIComponent(data.period.year)}&epi_week=${encodeURIComponent(data.period.week)}">Unduh CSV sekolah</a></div></div></details></div>
      </section>`;
    document.querySelector('#logout').addEventListener('click', logout);
    document.querySelector('.hero .eyebrow').textContent = isW2 ? 'Pelaporan mingguan faskes' : 'Pelaporan mingguan sekolah';
    document.querySelector('.hero h1').textContent = workspaceTitle;
    document.querySelector(`#ibs-tab-${isW2 ? 'school' : 'faskes'}`).remove();
    document.querySelector(`#ibs-panel-${isW2 ? 'school' : 'faskes'}`).remove();
    document.querySelectorAll('.ibs-priority-metrics [data-open-ibs-tab]').forEach(button => {
      if (button.dataset.openIbsTab === (isW2 ? 'school' : 'faskes') || (!isW2 && button.textContent.includes('Rincian'))) button.remove();
    });
    if (isW2) {
      document.querySelector('a[href^="/api/ibs/school-export"]').remove();
      document.querySelector('.ibs-export-panel .help').textContent = 'Ekspor W2 memuat angka agregat tanpa identitas pasien.';
      document.querySelector('#ibs-tab-faskes').childNodes[0].textContent = 'Daftar faskes ';
    } else {
      document.querySelector('#ibs-tab-summary').remove();
      document.querySelector('#ibs-panel-summary').remove();
      document.querySelector('#ibs-panel-school').insertAdjacentHTML('beforeend', `<a class="button secondary" href="/api/ibs/school-export?epi_year=${data.period.year}&epi_week=${data.period.week}">Unduh CSV sekolah</a>`);
    }
    document.querySelector('[role="tablist"]').setAttribute('aria-label', workspaceTitle);
    document.title = `${workspaceTitle} · ${branding.displayName}`;
    document.querySelector('#loadDash').addEventListener('click', () => staffIbs({ year: Number(document.querySelector('#dashYear').value), week: Number(document.querySelector('#dashWeek').value) }, workspace));
    const openIbsTab = name => {
      document.querySelectorAll('[data-ibs-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.ibsTab === name)));
      document.querySelectorAll('[data-ibs-panel]').forEach(panel => { panel.hidden = panel.dataset.ibsPanel !== name; });
    };
    document.querySelectorAll('[data-ibs-tab]').forEach(tab => tab.addEventListener('click', () => openIbsTab(tab.dataset.ibsTab)));
    document.querySelectorAll('[data-open-ibs-tab]').forEach(button => button.addEventListener('click', () => {
      openIbsTab(button.dataset.openIbsTab);
      document.querySelector('.ibs-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    openIbsTab(isW2 ? 'faskes' : 'school');
    setupTabKeyboard('[data-ibs-tab]');
    const refreshList = panel => {
      const list = panel.querySelector('[data-list-limit]');
      if (!list) return;
      const search = (panel.querySelector('[data-list-search]')?.value || '').trim().toLowerCase();
      const status = panel.querySelector('[data-list-status]')?.value || 'all';
      const expanded = list.dataset.expanded === 'true';
      const limit = Number(list.dataset.listLimit || 10);
      const rows = [...list.querySelectorAll('[data-filter-row], [data-worklist-item]')];
      let matches = 0;
      rows.forEach(row => {
        const matched = (!search || (row.dataset.search || '').includes(search)) && (status === 'all' || row.dataset.status === status);
        matches += matched ? 1 : 0;
        row.hidden = !matched || (!expanded && matches > limit);
      });
      const count = panel.querySelector('[data-result-count]');
      if (count) count.textContent = matches;
      const emptyState = panel.querySelector('.ibs-filter-empty');
      if (emptyState) emptyState.hidden = matches !== 0;
      const showAll = panel.querySelector('[data-show-list]');
      if (showAll) {
        showAll.hidden = matches <= limit;
        showAll.textContent = expanded ? 'Tampilkan lebih sedikit' : `Lihat semua (${matches})`;
      }
    };
    document.querySelectorAll('[data-ibs-panel]').forEach(panel => {
      panel.querySelectorAll('[data-list-search], [data-list-status]').forEach(control => control.addEventListener('input', () => refreshList(panel)));
      panel.querySelector('[data-show-list]')?.addEventListener('click', event => {
        const list = panel.querySelector('[data-list-limit]');
        list.dataset.expanded = String(list.dataset.expanded !== 'true');
        refreshList(panel);
        if (list.dataset.expanded !== 'true') list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      refreshList(panel);
    });
    document.querySelectorAll('.reviewMarker').forEach(button => button.addEventListener('click', async () => {
      await api(`/api/ibs/markers/${encodeURIComponent(button.dataset.id)}/review`, { method: 'POST', body: JSON.stringify({ notes: 'Ditinjau dari dashboard IBS.' }) });
      await staffIbs(data.period, workspace);
    }));
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('staff');
    pageFailure(error, () => route(), '#staff-home');
  }
}

async function staffSchoolDetail(submissionId) {
  try {
    const [me, data] = await Promise.all([api('/api/me'), api(`/api/ibs/school-submissions/${encodeURIComponent(submissionId)}`)]);
    const submission = data.submission;
    app.innerHTML = `<section class="card hero"><a class="back-link" href="#staff-school-management">← Pengelolaan laporan</a><p class="eyebrow">Detail laporan sekolah</p><h1>${esc(submission.source_name)}</h1><p>${esc(submission.source_code)} · Minggu ${esc(submission.epi_week)}, ${esc(submission.epi_year)} · ${esc(epiWeekRangeLabel(submission.epi_year, submission.epi_week))}</p></section>
      <section class="grid metrics school-summary-metrics"><div class="metric"><span>Siswa terdaftar</span><strong>${esc(submission.enrolled_count)}</strong></div><div class="metric"><span>Siswa sakit</span><strong>${esc(submission.sick_absent_count)}</strong></div><div class="metric"><span>Persentase</span><strong>${esc(submission.sick_percentage)}%</strong></div></section>
      <section class="card"><div class="section-heading"><div><h2>Laporan terkini</h2><p class="section-intro">Revisi ${esc(submission.revision)} · dikirim ${formatDate(submission.submitted_at)}</p></div><span class="status status-TERVERIFIKASI">TERKIRIM</span></div><dl class="detail-grid"><div><dt>Wilayah</dt><dd>${valueOrDash(submission.village_code)}</dd></div><div><dt>Pengirim</dt><dd>${esc(submission.submitted_by)}</dd></div><div><dt>Pertama dikirim</dt><dd>${formatDate(submission.first_submitted_at)}</dd></div><div><dt>Terakhir diperbarui</dt><dd>${formatDate(submission.submitted_at)}</dd></div><div class="span-2"><dt>Catatan</dt><dd>${submission.notes ? esc(submission.notes) : 'Tidak ada catatan'}</dd></div></dl></section>
      <section class="card"><div class="section-heading"><div><h2>Riwayat revisi</h2><p class="section-intro">Setiap perubahan angka dan catatan tetap dapat ditelusuri.</p></div><span class="count">${data.revisions.length}</span></div>${data.revisions.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>Revisi</th><th>Waktu</th><th>Terdaftar</th><th>Sakit</th><th>Persentase</th><th>Catatan</th></tr></thead><tbody>${data.revisions.map(row => `<tr><td data-label="Revisi"><strong>${esc(row.revision)}</strong></td><td data-label="Waktu">${formatDate(row.changed_at)}</td><td data-label="Terdaftar">${esc(row.enrolled ?? '—')}</td><td data-label="Sakit">${esc(row.sick ?? '—')}</td><td data-label="Persentase">${row.percentage === undefined ? '—' : `${esc(row.percentage)}%`}</td><td data-label="Catatan">${row.notes ? esc(row.notes) : '—'}</td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada riwayat revisi')}</section>${me.role === 'ADMIN' ? `<section class="card danger-zone"><h2>Administrasi laporan</h2><p>Admin dapat memperbaiki data atas nama sekolah atau menghapus laporan yang salah. Penghapusan dicatat secara permanen dalam log audit.</p><div class="actions"><a class="button secondary" href="#admin-school/${encodeURIComponent(submission.source_id)}">Edit data</a><button id="deleteSchoolSubmission" class="danger-button">Hapus laporan</button></div></section>` : ''}`;
    document.querySelector('#deleteSchoolSubmission')?.addEventListener('click', async event => {
      try {
        if (await deleteWithReason(event.currentTarget, `laporan sekolah ${submission.source_name} minggu ${submission.epi_week}`, `/api/admin/ibs/school-submissions/${encodeURIComponent(submissionId)}`)) location.hash = '#staff-school-management';
      } catch (error) { app.insertAdjacentHTML('afterbegin', alertBox('error', error.message)); }
    });
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('staff');
    pageFailure(error, () => route(), '#staff-school-management');
  }
}

async function staffW2Detail(submissionId) {
  try {
    const [me, data] = await Promise.all([api('/api/me'), api(`/api/ibs/w2-submissions/${encodeURIComponent(submissionId)}`)]);
    const submission = data.submission;
    const caseGroups = new Map();
    data.case_details.forEach(detail => {
      if (!caseGroups.has(detail.indicator_code)) caseGroups.set(detail.indicator_code, []);
      caseGroups.get(detail.indicator_code).push(detail);
    });
    const ageUnits = { DAY: 'hari', MONTH: 'bulan', YEAR: 'tahun' };
    const labLabels = { NOT_TESTED: 'Belum diperiksa', PENDING: 'Menunggu hasil', POSITIVE: 'Positif', NEGATIVE: 'Negatif', INCONCLUSIVE: 'Inkonklusif', UNKNOWN: 'Tidak diketahui' };
    app.innerHTML = `<section class="card hero"><a class="back-link" href="#staff-w2-management">← Pengelolaan laporan</a><p class="eyebrow">Detail laporan W2</p><h1>${esc(submission.source_name)}</h1><p>Minggu ${esc(submission.epi_week)}, ${esc(submission.epi_year)} · Revisi ${esc(submission.revision)}</p></section>
      <section class="grid metrics"><div class="metric"><span>Status laporan</span><strong>${esc(labelStatus(submission.submission_status))}</strong></div><div class="metric"><span>Rincian lokal</span><strong>${esc(submission.detail_provided_count)}/${esc(submission.detail_required_count)}</strong></div><div class="metric"><span>Dikirim</span><strong>${formatDate(submission.submitted_at)}</strong></div></section>
      <section class="card"><div class="w2-boundary"><div><strong>Agregat W2</strong><span>Dapat digunakan untuk rekap dan pelaporan berjenjang.</span></div><div><strong>Identitas lokal terlindungi</strong><span>Akses identitas dicatat dan hanya diberikan kepada petugas berwenang.</span></div></div><h2>Angka yang dilaporkan</h2><div class="table-wrap mobile-cards"><table><thead><tr><th>Kode</th><th>Penyakit/sindrom</th><th>Kasus</th><th>Lab</th></tr></thead><tbody>${data.values.map(row => `<tr><td data-label="Kode"><strong>${esc(row.indicator_code)}</strong></td><td data-label="Penyakit">${esc(row.indicator_name)}</td><td data-label="Kasus">${esc(row.case_count)}</td><td data-label="Lab">${Number(row.lab_examined_count) || 0}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card"><h2>Rincian untuk tindak lanjut lokal</h2>${!data.can_view_local_details ? alertBox('warning', 'Peran Anda dapat melihat agregat, tetapi tidak berwenang membuka identitas pasien.') : data.case_details.length ? [...caseGroups.entries()].map(([code, rows]) => `<section class="w2-detail-group"><h3>${esc(code)} · ${esc(data.values.find(item => item.indicator_code === code)?.indicator_name || code)}</h3><div class="table-wrap mobile-cards"><table><thead><tr><th>Nama</th><th>Usia/JK</th><th>Alamat</th><th>Tanggal</th><th>Lab</th></tr></thead><tbody>${rows.map(row => `<tr><td data-label="Nama"><strong>${esc(row.patient_name || 'Belum diisi')}</strong>${row.phone ? `<br><small>${esc(row.phone)}</small>` : ''}</td><td data-label="Usia/JK">${row.age_value !== null ? `${esc(row.age_value)} ${esc(ageUnits[row.age_unit] || '')}` : '—'} · ${row.sex === 'L' ? 'L' : row.sex === 'P' ? 'P' : '—'}</td><td data-label="Alamat">${esc(row.address || 'Belum diisi')}<br><small>${esc(row.village_code || '')}</small></td><td data-label="Tanggal">Mulai: ${formatDate(row.onset_date)}<br>Kunjungan: ${formatDate(row.visit_date)}</td><td data-label="Lab">${esc(labLabels[row.lab_status] || row.lab_status)}</td></tr>`).join('')}</tbody></table></div></section>`).join('') : empty('Belum ada rincian lokal', 'Angka agregat tetap sah dan sudah tercatat.')}</section>${me.role === 'ADMIN' ? `<section class="card danger-zone"><h2>Administrasi laporan</h2><p>Admin dapat memperbaiki W2 atas nama faskes atau menghapus seluruh agregat dan rincian lokal laporan ini.</p><div class="actions"><a class="button secondary" href="#admin-w2/${encodeURIComponent(submission.source_id)}">Edit data</a><button id="deleteW2Submission" class="danger-button">Hapus laporan</button></div></section>` : ''}`;
    document.querySelector('#deleteW2Submission')?.addEventListener('click', async event => {
      try {
        if (await deleteWithReason(event.currentTarget, `laporan W2 ${submission.source_name} minggu ${submission.epi_week}`, `/api/admin/ibs/w2-submissions/${encodeURIComponent(submissionId)}`)) location.hash = '#staff-w2-management';
      } catch (error) { app.insertAdjacentHTML('afterbegin', alertBox('error', error.message)); }
    });
  } catch (error) {
    pageFailure(error, () => route(), '#staff-w2-management');
  }
}

let ibsAdminActivePanel = 'admin-patient-policies';

function compactIndicatorPolicies() {
  const table = app.querySelector('.admin-policy-table');
  if (!table) return;
  const list = document.createElement('div');
  list.className = 'table-wrap indicator-policy-list';
  list.id = 'indicatorPolicyList';
  table.querySelectorAll('[data-indicator-row]').forEach(row => {
    const cells = [...row.cells];
    const select = row.querySelector('.indicatorIdentityPolicy');
    const lab = row.querySelector('.indicatorLabTracking');
    const item = document.createElement('details');
    item.className = 'indicator-policy-row';
    item.setAttribute('data-indicator-row', '');
    item.dataset.search = row.dataset.search;
    const name = cells[0].querySelector('.admin-disease-name');
    const policy = select ? select.selectedOptions[0].textContent : 'Total kunjungan';
    item.innerHTML = `<summary><span class="policy-row-name"></span><span class="policy-row-state">Aktif</span><span class="policy-row-chevron" aria-hidden="true">⌄</span></summary><div class="policy-row-editor"><div><h3>Rincian pasien</h3></div><div><h3>Pemeriksaan laboratorium</h3></div></div>`;
    item.querySelector('.policy-row-name').append(name);
    name.insertAdjacentHTML('beforeend', `<small>${esc(policy)}${lab ? ` · Lab ${lab.checked ? 'dicatat' : 'tidak dicatat'}` : ''}</small>`);
    const editors = item.querySelectorAll('.policy-row-editor > div');
    while (cells[1].firstChild) editors[0].append(cells[1].firstChild);
    while (cells[2].firstChild) editors[1].append(cells[2].firstChild);
    item.addEventListener('change', () => {
      const dirty = (select && select.value !== select.dataset.original) || (lab && Number(lab.checked) !== Number(lab.dataset.original));
      item.querySelector('.policy-row-state').textContent = dirty ? 'Belum disimpan' : 'Aktif';
      item.querySelector('.policy-row-state').classList.toggle('is-dirty', Boolean(dirty));
    });
    list.append(item);
  });
  table.replaceWith(list);
  const help = document.createElement('details');
  help.className = 'policy-reading-guide';
  help.innerHTML = '<summary>Penjelasan aturan dan pengaturan semua penyakit</summary><div></div>';
  const body = help.querySelector('div');
  app.querySelectorAll('.identity-policy-guide, .lab-policy-note, .admin-bulk-actions').forEach(node => body.append(node));
  list.closest('section').append(help);
}

function compactAdvancedDirectories(indicators) {
  const section = app.querySelector('#admin-advanced');
  const names = new Map(indicators.map(item => [item.indicator_code, item.indicator_name]));
  const toolbar = document.createElement('div');
  toolbar.className = 'admin-list-tools';
  toolbar.innerHTML = '<label class="field" for="advancedDataSearch"><span>Cari indikator atau ambang</span><input id="advancedDataSearch" type="search" placeholder="Ketik nama atau kode" autocomplete="off"></label>';
  section.querySelector('.admin-disclosure-grid').after(toolbar);
  section.querySelectorAll('.admin-subsection tbody tr').forEach(row => {
    row.setAttribute('data-advanced-row', '');
    row.dataset.search = `${row.textContent} ${names.get(row.querySelector('strong')?.textContent) || ''}`.toLocaleLowerCase('id-ID');
  });
  bindDirectory('#advancedDataSearch', '[data-advanced-row]', '', 6, 'data');
}

async function ibsAdmin(notice = null) {
  try {
    const me = await api('/api/me');
    if (me.kind !== 'staff' || me.role !== 'ADMIN') return staffHome();
    const [sources, indicators, thresholds, locks, revisionRequests, deadlineSettings, masters] = await Promise.all([
      api('/api/admin/ibs/sources'), api('/api/admin/ibs/indicators'), api('/api/admin/ibs/thresholds'),
      api('/api/admin/ibs/locks'), api('/api/admin/ibs/revision-requests'), api('/api/admin/ibs/deadline'), getMasters()
    ]);
    const identityPolicyLabels = {
      REQUIRED: 'Wajib untuk tindak lanjut (setiap kasus)',
      CONDITIONAL: 'Kondisional (lab/ambang)',
      OPTIONAL: 'Opsional',
      NONE: 'Tidak mengumpulkan rincian',
    };
    const identityPolicyOptions = selected => ['REQUIRED', 'CONDITIONAL', 'OPTIONAL']
      .map(policy => `<option value="${policy}" ${selected === policy ? 'selected' : ''}>${esc(identityPolicyLabels[policy])}</option>`).join('');
    const policyIndicators = indicators.filter(item => Number(item.active));
    app.innerHTML = `
      <section class="card ibs-admin-hero"><a class="back-link" href="#staff-ibs">← Pelaporan mingguan</a><p class="eyebrow">Administrasi</p><h1>Pengaturan pelaporan</h1><p>Atur rincian kasus dan pemeriksaan untuk laporan rutin.</p>${messageBox('message')}</section>

      <nav class="ibs-admin-task-nav" aria-label="Menu pengaturan IBS" role="tablist">
        <button type="button" role="tab" aria-selected="${ibsAdminActivePanel === 'admin-patient-policies'}" aria-controls="admin-patient-policies" data-admin-jump="admin-patient-policies"><span>1</span><strong>Indikator W2</strong><small>Rincian dan laboratorium</small></button>
        <button type="button" role="tab" aria-selected="${ibsAdminActivePanel === 'admin-reporting-rules'}" aria-controls="admin-reporting-rules" data-admin-jump="admin-reporting-rules"><span>2</span><strong>Aturan pelaporan</strong><small>Batas waktu dan kunci</small></button>
        <button type="button" role="tab" aria-selected="${ibsAdminActivePanel === 'admin-institutions'}" aria-controls="admin-institutions" data-admin-jump="admin-institutions"><span>3</span><strong>Institusi</strong><small>${sources.length} akun pelapor</small></button>
        <button type="button" role="tab" aria-selected="${ibsAdminActivePanel === 'admin-advanced'}" aria-controls="admin-advanced" data-admin-jump="admin-advanced"><span>4</span><strong>Pengaturan lanjutan</strong><small>Indikator dan ambang</small></button>
      </nav>

      <section id="admin-patient-policies" class="card ibs-admin-section admin-focus-card" role="tabpanel" ${ibsAdminActivePanel === 'admin-patient-policies' ? '' : 'hidden'}><div class="section-heading"><div><p class="eyebrow">Pengaturan utama</p><h2 tabindex="-1">Pengaturan per penyakit</h2><p class="section-intro">Atur kebutuhan rincian pasien dan pencatatan pemeriksaan laboratorium untuk setiap penyakit aktif.</p></div><span class="count">${policyIndicators.filter(item => !Number(item.is_total)).length} penyakit</span></div>
        <div class="identity-policy-guide"><div><strong>Wajib untuk tindak lanjut</strong><span>Lengkapi identitas setiap kasus; angka agregat tetap boleh dikirim lebih dulu.</span></div><div><strong>Kondisional</strong><span>Mengikuti pemeriksaan lab atau aturan katalog.</span></div><div><strong>Opsional</strong><span>Angka kasus dapat dikirim tanpa identitas.</span></div></div>
        <div class="lab-policy-note"><span aria-hidden="true">↔</span><div><strong>Diperiksa lab</strong><small>Jika dinonaktifkan, kolom laboratorium disembunyikan dan laporan baru atau revisi menyimpan nilai lab 0. Riwayat yang sudah tersimpan tidak dihapus.</small></div></div>
        <div class="admin-list-tools"><label class="field" for="indicatorPolicySearch"><span>Cari penyakit</span><input id="indicatorPolicySearch" type="search" placeholder="Ketik kode atau nama penyakit" autocomplete="off"></label><div class="admin-bulk-actions" role="group" aria-label="Atur pemeriksaan laboratorium semua penyakit"><span>Semua penyakit</span><button id="enableAllLabTracking" type="button" class="secondary">Aktifkan lab</button><button id="disableAllLabTracking" type="button" class="secondary">Nonaktifkan lab</button></div></div>
        ${policyIndicators.length ? `<div class="table-wrap mobile-cards admin-policy-table"><table><thead><tr><th>Penyakit</th><th>Rincian pasien</th><th>Diperiksa lab</th><th>Status</th></tr></thead><tbody>${policyIndicators.map(item => `<tr data-indicator-row data-search="${esc(`${item.indicator_code} ${item.indicator_name}`.toLowerCase())}"><td data-label="Penyakit"><div class="admin-disease-name"><span class="w2-code">${esc(item.indicator_code)}</span><strong>${esc(item.indicator_name)}</strong></div></td><td data-label="Rincian pasien">${Number(item.is_total) ? `<span class="muted">Tidak berlaku untuk total kunjungan</span>` : `<div class="admin-policy-control"><select class="indicatorIdentityPolicy" data-id="${esc(item.indicator_code)}" data-original="${esc(item.identity_policy)}" aria-label="Kebijakan rincian pasien ${esc(item.indicator_name)}">${identityPolicyOptions(item.identity_policy)}</select><button class="saveIndicatorIdentityPolicy" data-id="${esc(item.indicator_code)}" type="button" disabled>Simpan perubahan</button></div>`}</td><td data-label="Diperiksa lab">${Number(item.is_total) ? '<span class="muted">Tidak berlaku</span>' : `<div class="admin-lab-control"><label class="admin-switch"><input class="indicatorLabTracking" data-id="${esc(item.indicator_code)}" data-original="${Number(item.lab_tracking)}" type="checkbox" role="switch" aria-label="Catat pemeriksaan laboratorium ${esc(item.indicator_name)}" ${Number(item.lab_tracking) ? 'checked' : ''}><span class="admin-switch-track" aria-hidden="true"></span><span class="admin-switch-label">${Number(item.lab_tracking) ? 'Dicatat' : 'Tidak dicatat'}</span></label><button class="saveIndicatorLabTracking secondary" data-id="${esc(item.indicator_code)}" type="button" disabled>Simpan</button></div>`}</td><td data-label="Status"><span class="status status-TERVERIFIKASI">AKTIF</span></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada indikator aktif')}
        <p class="help admin-policy-footnote">Perubahan digunakan saat formulir W2 dimuat kembali. Laporan yang sudah terkirim tetap mempertahankan angka sebelumnya sampai direvisi.</p>
      </section>

      <section id="admin-reporting-rules" class="card ibs-admin-section" role="tabpanel" ${ibsAdminActivePanel === 'admin-reporting-rules' ? '' : 'hidden'}><div class="section-heading"><div><p class="eyebrow">Operasional mingguan</p><h2 tabindex="-1">Aturan pelaporan</h2><p class="section-intro">Kelola tenggat, periode terkunci, dan revisi yang menunggu keputusan.</p></div>${revisionRequests.length ? `<span class="count">${revisionRequests.length} revisi menunggu</span>` : ''}</div>
        ${revisionRequests.length ? `<div class="admin-subsection"><h3>Revisi menunggu persetujuan</h3><div class="table-wrap mobile-cards"><table><thead><tr><th>Faskes</th><th>Periode</th><th>Revisi</th><th>Diajukan</th><th>Aksi</th></tr></thead><tbody>${revisionRequests.map(row => `<tr><td data-label="Faskes"><strong>${esc(row.source_name)}</strong><br><small>${esc(row.source_code)}</small></td><td data-label="Periode">ME ${esc(row.epi_week)} · ${esc(row.epi_year)}</td><td data-label="Revisi">${esc(row.proposed_revision)}</td><td data-label="Diajukan">${formatDate(row.requested_at)}</td><td class="action-cell"><div class="actions"><button class="approveW2Revision" data-id="${esc(row.request_id)}">Setujui</button><button class="danger-button rejectW2Revision" data-id="${esc(row.request_id)}">Tolak</button></div></td></tr>`).join('')}</tbody></table></div></div>` : '<div class="admin-clear-state"><strong>Tidak ada revisi tertunda</strong><span>Semua laporan aktif sudah menggunakan revisi terakhir yang disetujui.</span></div>'}
        <div class="admin-settings-grid"><form id="deadlineForm" class="admin-setting-panel"><span class="admin-setting-number">1</span><h3>Batas waktu W2</h3><p>Berlaku mulai ME ${esc(deadlineSettings.current_period.week)} · ${esc(deadlineSettings.current_period.year)}. Riwayat tidak berubah.</p><div class="grid"><div class="field"><label for="deadlineHour">Jam (WIB)</label><input id="deadlineHour" name="deadline_hour" type="number" min="0" max="23" value="${esc(deadlineSettings.active.deadline_hour)}" required></div><div class="field"><label for="deadlineMinute">Menit</label><input id="deadlineMinute" name="deadline_minute" type="number" min="0" max="59" value="${esc(deadlineSettings.active.deadline_minute)}" required></div></div><div class="form-actions"><button type="submit">Simpan batas waktu</button></div></form>
          <form id="lockForm" class="admin-setting-panel"><span class="admin-setting-number">2</span><h3>Kunci satu minggu</h3><p>Gunakan setelah rekap selesai agar laporan pada periode tersebut tidak dapat direvisi.</p>${periodFields(epiPeriod(), 'lock')}<div class="form-actions"><button type="submit" class="danger">Kunci minggu</button></div></form></div>
        <details class="admin-disclosure" ${locks.length ? 'open' : ''}><summary><span><strong>Periode terkunci</strong><small>${locks.length ? `${locks.length} periode terkunci` : 'Belum ada periode yang dikunci'}</small></span></summary><div class="admin-disclosure-body">${locks.length ? `<form id="unlockForm" class="grid"><div class="field"><label for="unlockPeriod">Periode</label><select id="unlockPeriod" name="lock_key" required>${locks.map(lock => `<option value="${esc(lock.epi_year)}|${esc(lock.epi_week)}">Minggu ${esc(lock.epi_week)}, ${esc(lock.epi_year)} · ${formatDate(lock.locked_at)}</option>`).join('')}</select></div><div class="field"><label for="unlockReason">Alasan membuka kunci</label><textarea id="unlockReason" name="reason" maxlength="500" required></textarea></div><div class="form-actions"><button type="submit" class="secondary">Buka kunci periode</button></div></form>` : '<p class="muted">Periode yang dikunci akan tampil di sini.</p>'}</div></details>
      </section>

      <section id="admin-institutions" class="card ibs-admin-section" role="tabpanel" ${ibsAdminActivePanel === 'admin-institutions' ? '' : 'hidden'}><div class="section-heading"><div><p class="eyebrow">Akun pelapor</p><h2 tabindex="-1">Institusi</h2><p class="section-intro">Cari akun untuk mengedit identitas, menyalin tautan masuk, atau mengubah status.</p></div><span class="count">${sources.length}</span></div>
        <div class="admin-list-tools"><label class="field" for="sourceAdminSearch"><span>Cari institusi</span><input id="sourceAdminSearch" type="search" placeholder="Ketik nama, kode, atau desa" autocomplete="off"></label></div>
        ${sources.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>Institusi</th><th>Jenis</th><th>Program/wilayah</th><th>Lokasi</th><th>Status</th><th>Aktivitas</th><th>Aksi</th></tr></thead><tbody>${sources.map(row => `<tr data-source-row data-search="${esc(`${row.source_code} ${row.source_name} ${row.village_name || row.village_code || ''}`.toLowerCase())}"><td data-label="Institusi"><strong>${esc(row.source_name)}</strong><br><small>${esc(row.source_code)}</small></td><td data-label="Jenis">${esc(row.source_type)}${row.network_type ? `<br><small>${esc(row.network_type)}</small>` : ''}</td><td data-label="Program/wilayah">${valueOrDash(row.program_area)}</td><td data-label="Lokasi">${esc(row.village_name || row.village_code || '—')}${row.subvillage_name ? `<br><small>${esc(row.subvillage_name)}</small>` : ''}</td><td data-label="Status">${Number(row.active) ? '<span class="status status-TERVERIFIKASI">AKTIF</span>' : `<span class="status status-DITOLAK">NONAKTIF</span>${row.deactivation_reason ? `<br><small>${esc(row.deactivation_reason)}</small>` : ''}`}</td><td data-label="Aktivitas"><small>${row.last_login_at ? `Terakhir masuk ${formatDate(row.last_login_at)}` : 'Belum pernah masuk'}${Number(row.active_sessions) ? `<br>${esc(row.active_sessions)} sesi aktif` : ''}</small></td><td class="action-cell"><div class="actions"><button class="secondary copySourceLink" data-code="${esc(row.source_code)}">Salin tautan</button><button class="secondary editSource" data-id="${esc(row.source_id)}">Edit</button><button class="secondary revokeSourceSessions" data-id="${esc(row.source_id)}" data-label="${esc(row.source_name)}">Akhiri sesi</button><button class="secondary toggleSource" data-id="${esc(row.source_id)}" data-active="${Number(row.active) ? 0 : 1}">${Number(row.active) ? 'Nonaktifkan' : 'Aktifkan'}</button><button class="danger-button deleteSource" data-id="${esc(row.source_id)}" data-label="${esc(row.source_name)}">Hapus</button></div></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada institusi')}
        <div class="admin-disclosure-grid"><details id="sourceEditor" class="admin-disclosure"><summary><span><strong>Tambah atau edit institusi</strong><small>Buka formulir identitas dan PIN akun</small></span></summary><div class="admin-disclosure-body"><form id="sourceForm"><h3 id="sourceFormTitle">Tambah institusi</h3><div class="grid"><div class="field"><label for="sourceCode">Kode</label><input id="sourceCode" name="source_code" minlength="3" maxlength="40" pattern="[A-Za-z0-9-]{3,40}" autocapitalize="characters" required></div><div class="field"><label for="sourceName">Nama</label><input id="sourceName" name="source_name" maxlength="150" required></div><div class="field"><label for="sourceType">Jenis</label><select id="sourceType" name="source_type"><option value="FASKES">Faskes</option><option value="SEKOLAH">Sekolah</option></select></div><div class="field"><label for="sourceNetwork">Jejaring faskes</label><select id="sourceNetwork" name="network_type"><option value="JEJARING">Jejaring</option><option value="JARINGAN">Jaringan</option></select></div><div class="field"><label for="sourceProgram">Program/wilayah kerja</label><input id="sourceProgram" name="program_area" maxlength="100"></div><div class="field"><label for="sourceVillage">Desa</label><select id="sourceVillage" name="village_code"><option value="">Pilih desa</option>${selectOptions(masters.villages, 'village_code', 'village_name')}</select></div><div class="field"><label for="sourceSubvillage">Dusun/dukuh</label><input id="sourceSubvillage" name="subvillage_name" maxlength="100"></div><div class="field" id="sourcePinField"><label for="sourcePin">PIN 6 digit</label><input id="sourcePin" name="pin" inputmode="numeric" minlength="6" maxlength="6" pattern="[0-9]{6}" required></div></div><div class="form-actions"><button id="sourceSubmit" type="submit">Simpan institusi</button><button id="cancelSourceEdit" type="button" class="secondary" hidden>Batal mengedit</button></div></form></div></details>
          <details class="admin-disclosure"><summary><span><strong>Atur ulang PIN</strong><small>PIN lama dan semua sesi institusi akan dicabut</small></span></summary><div class="admin-disclosure-body"><form id="resetPinForm" class="grid"><div class="field"><label for="resetSource">Institusi</label><select id="resetSource" name="source_id" required>${sources.map(source => `<option value="${esc(source.source_id)}">${esc(source.source_name)} (${esc(source.source_code)})</option>`).join('')}</select></div><div class="field"><label for="resetPin">PIN baru 6 digit</label><input id="resetPin" name="pin" inputmode="numeric" minlength="6" maxlength="6" pattern="[0-9]{6}" required></div><div class="form-actions"><button type="submit" class="secondary">Atur ulang PIN</button></div></form></div></details></div>
      </section>

      <section id="admin-advanced" class="card ibs-admin-section" role="tabpanel" ${ibsAdminActivePanel === 'admin-advanced' ? '' : 'hidden'}><div class="section-heading"><div><p class="eyebrow">Jarang digunakan</p><h2 tabindex="-1">Pengaturan lanjutan</h2><p class="section-intro">Tambah indikator baru atau atur ambang yang menandai laporan untuk ditinjau petugas.</p></div></div>
        <div class="admin-disclosure-grid"><details class="admin-disclosure"><summary><span><strong>Tambah indikator W2</strong><small>Gunakan hanya saat katalog pelaporan berubah</small></span></summary><div class="admin-disclosure-body"><form id="indicatorForm"><div class="grid"><div class="field"><label for="indicatorCode">Kode</label><input id="indicatorCode" name="indicator_code" required></div><div class="field"><label for="indicatorName">Nama</label><input id="indicatorName" name="indicator_name" required></div><div class="field"><label for="indicatorOrder">Urutan</label><input id="indicatorOrder" name="sort_order" type="number" min="0" value="0"></div><div class="field"><label for="indicatorIdentityPolicy">Rincian pasien</label><select id="indicatorIdentityPolicy" name="identity_policy">${identityPolicyOptions('CONDITIONAL')}</select></div><div class="field"><label for="indicatorLabTracking">Diperiksa lab</label><select id="indicatorLabTracking" name="lab_tracking"><option value="1">Dicatat</option><option value="0">Tidak dicatat</option></select></div></div><div class="form-actions"><button type="submit">Tambah indikator</button></div></form></div></details>
          <details class="admin-disclosure"><summary><span><strong>Tambah atau ubah ambang tinjauan</strong><small>Ambang hanya membuat penanda untuk petugas</small></span></summary><div class="admin-disclosure-body"><form id="thresholdForm"><div class="grid"><div class="field"><label for="thresholdType">Jenis</label><select id="thresholdType" name="target_type"><option value="W2">W2</option><option value="SEKOLAH">Sekolah</option></select></div><div class="field"><label for="thresholdCode">Indikator</label><select id="thresholdCode" name="target_code" required></select></div><div class="field"><label for="thresholdMinimum">Nilai minimum</label><input id="thresholdMinimum" name="minimum_value" type="number" min="0" step="any" required></div></div><div class="form-actions"><button type="submit">Simpan ambang</button></div></form></div></details></div>
        <div class="admin-subsection"><div class="section-heading"><div><h3>Status indikator</h3><p class="section-intro">Nonaktifkan indikator yang tidak boleh muncul pada formulir W2 baru.</p></div><span class="count">${indicators.length}</span></div>${indicators.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>Kode</th><th>Nama</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${indicators.map(item => `<tr><td data-label="Kode"><strong>${esc(item.indicator_code)}</strong></td><td data-label="Nama">${esc(item.indicator_name)}</td><td data-label="Status">${Number(item.active) ? '<span class="status status-TERVERIFIKASI">AKTIF</span>' : '<span class="status status-DITOLAK">NONAKTIF</span>'}</td><td class="action-cell"><button class="secondary toggleIndicator" data-id="${esc(item.indicator_code)}" data-active="${Number(item.active) ? 0 : 1}">${Number(item.active) ? 'Nonaktifkan' : 'Aktifkan'}</button></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada indikator')}</div>
        <div class="admin-subsection"><div class="section-heading"><div><h3>Ambang aktif</h3><p class="section-intro">Menghapus aturan tidak menghapus riwayat penanda sebelumnya.</p></div><span class="count">${thresholds.length}</span></div>${thresholds.length ? `<div class="table-wrap mobile-cards"><table><thead><tr><th>Jenis</th><th>Indikator</th><th>Minimum</th><th>Aksi</th></tr></thead><tbody>${thresholds.map(item => `<tr><td data-label="Jenis">${esc(item.target_type)}</td><td data-label="Indikator"><strong>${esc(item.target_code)}</strong></td><td data-label="Minimum">${esc(item.minimum_value)}</td><td class="action-cell"><button class="danger-button deleteThreshold" data-id="${esc(item.threshold_id)}" data-label="${esc(`${item.target_type} ${item.target_code}`)}">Hapus</button></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada ambang.')}</div>
      </section>`;

    const message = document.querySelector('#message');
    const showMessage = (type, text) => { message.innerHTML = alertBox(type, text); focusMessage('message'); };
    if (notice) showMessage(notice.type || 'success', notice.text);

    document.querySelectorAll('[data-admin-jump]').forEach(button => button.addEventListener('click', () => {
      ibsAdminActivePanel = button.dataset.adminJump;
      document.querySelectorAll('[data-admin-jump]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
      document.querySelectorAll('.ibs-admin-section').forEach(panel => { panel.hidden = panel.id !== ibsAdminActivePanel; });
      const target = document.querySelector(`#${CSS.escape(ibsAdminActivePanel)}`);
      target?.querySelector('h2')?.focus({ preventScroll: true });
    }));
    setupTabKeyboard('[data-admin-jump]');

    compactIndicatorPolicies();
    compactAdvancedDirectories(indicators);
    bindDirectory('#indicatorPolicySearch', '[data-indicator-row]', '', 6, 'indikator');
    bindDirectory('#sourceAdminSearch', '[data-source-row]');
    compactRowActions('#admin-institutions .action-cell .actions');
    document.querySelectorAll('.indicatorIdentityPolicy').forEach(select => select.addEventListener('change', () => {
      const button = document.querySelector(`.saveIndicatorIdentityPolicy[data-id="${CSS.escape(select.dataset.id)}"]`);
      if (button) button.disabled = select.value === select.dataset.original;
    }));
    document.querySelectorAll('.indicatorLabTracking').forEach(input => input.addEventListener('change', () => {
      const button = document.querySelector(`.saveIndicatorLabTracking[data-id="${CSS.escape(input.dataset.id)}"]`);
      const label = input.closest('.admin-switch')?.querySelector('.admin-switch-label');
      if (label) label.textContent = input.checked ? 'Dicatat' : 'Tidak dicatat';
      if (button) button.disabled = Number(input.checked) === Number(input.dataset.original);
    }));

    document.querySelectorAll('.approveW2Revision').forEach(button => button.addEventListener('click', async () => {
      if (!await confirmAction('Setujui revisi W2?', 'Data revisi akan menjadi laporan W2 aktif.', 'Setujui revisi')) return;
      try {
        await api(`/api/admin/ibs/revision-requests/${encodeURIComponent(button.dataset.id)}/decision`, {
          method: 'POST', body: JSON.stringify({ decision: 'APPROVED', notes: 'Disetujui melalui Administrasi IBS.' }),
        });
        await ibsAdmin({ type: 'success', text: 'Revisi W2 disetujui dan laporan aktif telah diperbarui.' });
      } catch (error) { showMessage('error', error.message); }
    }));
    document.querySelectorAll('.rejectW2Revision').forEach(button => button.addEventListener('click', async () => {
      const notes = await requestReason('Tolak revisi W2?', 'Laporan aktif tidak akan berubah.', 'Alasan penolakan');
      if (notes === null) return;
      try {
        await api(`/api/admin/ibs/revision-requests/${encodeURIComponent(button.dataset.id)}/decision`, {
          method: 'POST', body: JSON.stringify({ decision: 'REJECTED', notes }),
        });
        await ibsAdmin({ type: 'success', text: 'Revisi W2 ditolak dan laporan aktif tidak berubah.' });
      } catch (error) { showMessage('error', error.message); }
    }));

    const sourceForm = document.querySelector('#sourceForm');
    const sourceType = document.querySelector('#sourceType');
    const sourceNetwork = document.querySelector('#sourceNetwork');
    const sourcePin = document.querySelector('#sourcePin');
    const cancelSourceEdit = document.querySelector('#cancelSourceEdit');
    const syncSourceType = () => {
      const school = sourceType.value === 'SEKOLAH';
      sourceNetwork.disabled = school;
      sourceNetwork.required = !school;
    };
    const resetSourceForm = () => {
      sourceForm.reset();
      sourceForm.dataset.sourceId = '';
      sourceType.disabled = false;
      sourcePin.disabled = false;
      sourcePin.required = true;
      document.querySelector('#sourcePinField').hidden = false;
      document.querySelector('#sourceFormTitle').textContent = 'Tambah institusi';
      document.querySelector('#sourceSubmit').textContent = 'Simpan institusi';
      cancelSourceEdit.hidden = true;
      syncSourceType();
    };
    sourceType.addEventListener('change', syncSourceType);
    cancelSourceEdit.addEventListener('click', resetSourceForm);
    syncSourceType();

    const thresholdType = document.querySelector('#thresholdType');
    const thresholdCode = document.querySelector('#thresholdCode');
    const syncThresholdTargets = () => {
      thresholdCode.innerHTML = thresholdType.value === 'SEKOLAH'
        ? '<option value="SICK_PERCENT">SICK_PERCENT · Persentase siswa yang tidak masuk karena sakit</option>'
        : indicators.filter(item => Number(item.active) && !Number(item.is_total)).map(item => `<option value="${esc(item.indicator_code)}">${esc(item.indicator_code)} · ${esc(item.indicator_name)}</option>`).join('');
    };
    thresholdType.addEventListener('change', syncThresholdTargets);
    syncThresholdTargets();

    document.querySelectorAll('.editSource').forEach(button => button.addEventListener('click', () => {
      const source = sources.find(item => item.source_id === button.dataset.id);
      if (!source) return;
      const sourceEditor = document.querySelector('#sourceEditor');
      if (sourceEditor) sourceEditor.open = true;
      sourceForm.dataset.sourceId = source.source_id;
      sourceForm.elements.source_code.value = source.source_code || '';
      sourceForm.elements.source_name.value = source.source_name || '';
      sourceForm.elements.source_type.value = source.source_type || 'FASKES';
      sourceForm.elements.network_type.value = source.network_type || 'JEJARING';
      sourceForm.elements.program_area.value = source.program_area || '';
      sourceForm.elements.village_code.value = source.village_code || '';
      sourceForm.elements.subvillage_name.value = source.subvillage_name || '';
      sourceType.disabled = true;
      sourcePin.disabled = true;
      sourcePin.required = false;
      document.querySelector('#sourcePinField').hidden = true;
      document.querySelector('#sourceFormTitle').textContent = `Edit ${source.source_name}`;
      document.querySelector('#sourceSubmit').textContent = 'Simpan perubahan';
      cancelSourceEdit.hidden = false;
      syncSourceType();
      sourceForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      sourceForm.elements.source_code.focus();
      adminDrafts.reset(sourceForm);
    }));

    sourceForm.addEventListener('submit', event => submitForm(event, async () => {
      try {
        const data = Object.fromEntries(new FormData(sourceForm));
        const sourceId = sourceForm.dataset.sourceId;
        await api(sourceId ? `/api/admin/ibs/sources/${encodeURIComponent(sourceId)}` : '/api/admin/ibs/sources', {
          method: sourceId ? 'PATCH' : 'POST', body: JSON.stringify(data)
        });
        await ibsAdmin({ type: 'success', text: sourceId ? 'Detail institusi diperbarui.' : 'Institusi ditambahkan.' });
      } catch (error) { showMessage('error', error.message); }
    }));

    const submitAdmin = (selector, endpoint, successText, confirmText = '') => document.querySelector(selector).addEventListener('submit', event => submitForm(event, async () => {
      if (confirmText && !await confirmAction('Konfirmasi tindakan', confirmText, 'Lanjutkan')) return;
      try {
        await api(endpoint, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
        await ibsAdmin({ type: 'success', text: successText });
      } catch (error) { showMessage('error', error.message); }
    }));
    submitAdmin('#indicatorForm', '/api/admin/ibs/indicators', 'Indikator W2 ditambahkan.');
    submitAdmin('#thresholdForm', '/api/admin/ibs/thresholds', 'Ambang tinjauan disimpan.');
    submitAdmin('#deadlineForm', '/api/admin/ibs/deadline', 'Batas waktu W2 diperbarui untuk minggu berjalan dan seterusnya.');
    submitAdmin('#lockForm', '/api/admin/ibs/locks', 'Periode berhasil dikunci.', 'Kunci periode ini? Institusi tidak dapat mengubah laporan setelah dikunci.');
    document.querySelector('#unlockForm')?.addEventListener('submit', event => submitForm(event, async () => {
      try {
        const data = Object.fromEntries(new FormData(event.currentTarget));
        const [epiYear, epiWeek] = String(data.lock_key).split('|').map(Number);
        await api('/api/admin/ibs/locks', { method: 'DELETE', body: JSON.stringify({ epi_year: epiYear, epi_week: epiWeek, reason: data.reason }) });
        await ibsAdmin({ type: 'success', text: 'Kunci periode dibuka dan alasannya dicatat.' });
      } catch (error) { showMessage('error', error.message); }
    }, 'Membuka…'));

    document.querySelector('#resetPinForm').addEventListener('submit', event => submitForm(event, async () => {
      const form = event.currentTarget;
      try {
        const data = Object.fromEntries(new FormData(form));
        await api(`/api/admin/ibs/sources/${encodeURIComponent(data.source_id)}/reset-pin`, { method: 'POST', body: JSON.stringify({ pin: data.pin }) });
        showMessage('success', 'PIN institusi diperbarui. Semua sesi lama institusi sudah dicabut.');
        form.reset();
      } catch (error) { showMessage('error', error.message); }
    }));

    document.querySelectorAll('.deleteSource').forEach(button => button.addEventListener('click', async () => {
      try {
        if (await deleteWithReason(button, `institusi ${button.dataset.label} beserta seluruh laporan rutinnya`, `/api/admin/ibs/sources/${encodeURIComponent(button.dataset.id)}`))
          await ibsAdmin({ type: 'success', text: 'Institusi dan data rutin terkait dihapus. Rekam audit penghapusan dipertahankan.' });
      } catch (error) { showMessage('error', error.message); }
    }));
    document.querySelectorAll('.copySourceLink').forEach(button => button.addEventListener('click', () => {
      const source = sources.find(item => item.source_code === button.dataset.code);
      copyReporterAccessLink(button, button.dataset.code, source?.source_type === 'SEKOLAH' ? '#ibs-login-school' : '#ibs-login-w2');
    }));
    document.querySelectorAll('.revokeSourceSessions').forEach(button => button.addEventListener('click', async () => {
      if (!await confirmAction('Akhiri semua sesi?', `Semua sesi ${button.dataset.label || 'institusi ini'} akan segera dicabut.`, 'Akhiri sesi', true)) return;
      try { await api(`/api/admin/ibs/sources/${encodeURIComponent(button.dataset.id)}/revoke-sessions`, { method: 'POST' }); await ibsAdmin({ type: 'success', text: 'Semua sesi institusi telah dicabut.' }); }
      catch (error) { document.querySelector('#message').innerHTML = alertBox('error', error.message); }
    }));
    document.querySelectorAll('.deleteThreshold').forEach(button => button.addEventListener('click', async () => {
      try {
        if (await deleteWithReason(button, `ambang ${button.dataset.label}`, `/api/admin/ibs/thresholds/${encodeURIComponent(button.dataset.id)}`))
          await ibsAdmin({ type: 'success', text: 'Ambang tinjauan dihapus.' });
      } catch (error) { showMessage('error', error.message); }
    }));
    document.querySelectorAll('.saveIndicatorIdentityPolicy').forEach(button => button.addEventListener('click', async () => {
      const select = document.querySelector(`.indicatorIdentityPolicy[data-id="${CSS.escape(button.dataset.id)}"]`);
      if (!select) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Menyimpan…';
      try {
        const result = await api(`/api/admin/ibs/indicators/${encodeURIComponent(button.dataset.id)}/identity-policy`, {
          method: 'POST', body: JSON.stringify({ identity_policy: select.value }),
        });
        await ibsAdmin({ type: 'success', text: result.unchanged
          ? 'Kebijakan rincian pasien tidak berubah.'
          : 'Kebijakan rincian pasien diperbarui.' });
      } catch (error) {
        button.disabled = false;
        button.textContent = originalText;
        showMessage('error', error.message);
      }
    }));
    document.querySelectorAll('.saveIndicatorLabTracking').forEach(button => button.addEventListener('click', async () => {
      const input = document.querySelector(`.indicatorLabTracking[data-id="${CSS.escape(button.dataset.id)}"]`);
      if (!input) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Menyimpan…';
      try {
        const result = await api(`/api/admin/ibs/indicators/${encodeURIComponent(button.dataset.id)}/lab-tracking`, {
          method: 'POST', body: JSON.stringify({ lab_tracking: Number(input.checked) }),
        });
        await ibsAdmin({ type: 'success', text: result.unchanged
          ? 'Pengaturan pemeriksaan laboratorium tidak berubah.'
          : `Pemeriksaan laboratorium ${input.checked ? 'diaktifkan' : 'dinonaktifkan'} untuk indikator tersebut.` });
      } catch (error) {
        button.disabled = false;
        button.textContent = originalText;
        showMessage('error', error.message);
      }
    }));

    const setAllLabTracking = async enabled => {
      const action = enabled ? 'mengaktifkan' : 'menonaktifkan';
      if (!await confirmAction(`${enabled ? 'Aktifkan' : 'Nonaktifkan'} pelacakan lab?`, `Tindakan ini akan ${action} kolom Diperiksa lab untuk semua penyakit W2.`, enabled ? 'Aktifkan semua' : 'Nonaktifkan semua', !enabled)) return;
      const buttons = [document.querySelector('#enableAllLabTracking'), document.querySelector('#disableAllLabTracking')].filter(Boolean);
      buttons.forEach(button => { button.disabled = true; });
      try {
        const result = await api('/api/admin/ibs/indicators/lab-tracking', {
          method: 'POST', body: JSON.stringify({ lab_tracking: Number(enabled) }),
        });
        await ibsAdmin({ type: 'success', text: result.unchanged
          ? 'Semua penyakit sudah menggunakan pengaturan tersebut.'
          : `${result.updated_count} pengaturan penyakit diperbarui.` });
      } catch (error) {
        buttons.forEach(button => { button.disabled = false; });
        showMessage('error', error.message);
      }
    };
    document.querySelector('#enableAllLabTracking')?.addEventListener('click', () => setAllLabTracking(true));
    document.querySelector('#disableAllLabTracking')?.addEventListener('click', () => setAllLabTracking(false));

    const bindIbsToggle = (cls, endpoint) => document.querySelectorAll(`.${cls}`).forEach(button => button.addEventListener('click', async () => {
      const activating = Number(button.dataset.active) === 1;
      const reason = activating
        ? (await confirmAction('Aktifkan item ini?', 'Item akan kembali tersedia pada alur pelaporan.', 'Aktifkan') ? '' : null)
        : await requestReason('Nonaktifkan item ini?', 'Item tidak akan tersedia pada alur pelaporan baru.', 'Alasan penonaktifan');
      if (reason === null) return;
      setBusy(button, true, 'Menyimpan…');
      try {
        await api(endpoint(button.dataset.id), { method: 'POST', body: JSON.stringify({ active: Number(button.dataset.active), reason }) });
        await ibsAdmin({ type: 'success', text: 'Status diperbarui.' });
      } catch (error) { showMessage('error', error.message); setBusy(button, false); }
    }));
    bindIbsToggle('toggleSource', id => `/api/admin/ibs/sources/${encodeURIComponent(id)}/status`);
    bindIbsToggle('toggleIndicator', id => `/api/admin/ibs/indicators/${encodeURIComponent(id)}/status`);
    const adminDrafts = watchAdminForms();
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('staff');
    pageFailure(error, () => route(), '#staff-home');
  }
}

const STAFF_ROLES = ['ADMIN', 'VERIFIKATOR', 'PETUGAS_PROGRAM', 'PIMPINAN', 'VIEWER'];
const STAFF_ROLE_LABELS = { ADMIN: 'Administrator', VERIFIKATOR: 'Verifikator', PETUGAS_PROGRAM: 'Petugas Program', PIMPINAN: 'Pimpinan', VIEWER: 'Pembaca' };
let usersAdminActivePanel = 'admin-users-directory';

async function usersAdmin(notice = null) {
  try {
    const me = await api('/api/me');
    if (me.kind !== 'staff' || me.role !== 'ADMIN') return staffHome();
    const [users, cadres, masters] = await Promise.all([api('/api/admin/users'), api('/api/admin/cadres'), getMasters()]);
    const activePill = active => Number(active) ? '<span class="status status-TERVERIFIKASI">AKTIF</span>' : '<span class="status status-DITOLAK">NONAKTIF</span>';
    const toggleButton = (cls, id, active) => `<button class="secondary ${cls}" data-id="${esc(id)}" data-active="${Number(active) ? 0 : 1}">${Number(active) ? 'Nonaktifkan' : 'Aktifkan'}</button>`;
    const roleOptions = () => `<option value="">Pilih peran…</option>${STAFF_ROLES.map(role => `<option value="${esc(role)}">${esc(STAFF_ROLE_LABELS[role])}</option>`).join('')}`;
    app.innerHTML = `
      <section class="card ibs-admin-hero"><p class="eyebrow">Administrasi pengguna</p><h1>Petugas dan kader</h1><p>Kelola identitas, status, dan akses akun petugas serta kader.</p>${messageBox('message')}</section>

      <div class="account-toolbar" role="group" aria-label="Tindakan akun">
        <button type="button" class="secondary" data-user-admin-jump="admin-users-directory">Daftar akun</button>
        <div class="actions">
          <button type="button" data-user-admin-jump="admin-users-staff">Tambah petugas</button>
          <button type="button" class="secondary" data-user-admin-jump="admin-users-cadres">Tambah kader</button>
          <button type="button" class="text-button" data-user-admin-jump="admin-users-access">Atur ulang akses</button>
        </div>
      </div>
      <section id="admin-users-staff" class="card user-admin-section" ${usersAdminActivePanel === 'admin-users-staff' ? '' : 'hidden'}>
          <form id="userForm"><p class="eyebrow">Akun internal</p><h2 id="userFormTitle" tabindex="-1">Tambah petugas</h2><p class="section-intro">Buat akun sesuai tanggung jawab petugas. Hak akses mengikuti peran yang dipilih.</p>
            <div class="field"><label for="newUserName">Nama</label><input id="newUserName" name="name" maxlength="100" required></div>
            <div class="field"><label for="newUserEmail">Email</label><input id="newUserEmail" name="email" type="email" required></div>
            <div class="field"><label for="newUserRole">Peran</label><select id="newUserRole" name="role" required>${roleOptions()}</select></div>
            <div class="field"><label for="newUserProgram">Program <small>Wajib hanya untuk Petugas Program</small></label><input id="newUserProgram" name="program" maxlength="100" disabled></div>
            <div class="field" id="newUserPasswordField"><label for="newUserPassword">Kata sandi <small>Minimal 15 karakter</small></label><input id="newUserPassword" name="password" type="password" minlength="15" autocomplete="new-password" required>${passwordGuidance('newUserPasswordRules')}</div>
            <div class="form-actions"><button id="userSubmit" type="submit">Simpan petugas</button><button id="cancelUserEdit" type="button" class="secondary" hidden>Batal mengedit</button></div>
          </form>
      </section>
      <section id="admin-users-cadres" class="card user-admin-section" ${usersAdminActivePanel === 'admin-users-cadres' ? '' : 'hidden'}>
          <form id="cadreForm2"><p class="eyebrow">Pelapor masyarakat</p><h2 id="cadreFormTitle" tabindex="-1">Tambah kader</h2><p class="section-intro">Buat identitas dan PIN untuk kader yang mengirim laporan berbasis masyarakat.</p>
            <div class="field"><label for="newCadreCode">Kode kader <small>Huruf besar/angka, contoh: KDR-01</small></label><input id="newCadreCode" name="cadre_code" autocapitalize="characters" required></div>
            <div class="field"><label for="newCadreName">Nama lengkap</label><input id="newCadreName" name="name" maxlength="100" autocomplete="name" required></div>
            <div class="field"><label for="newCadreNickname">Nama Panggilan <small>Wajib diisi</small></label><input id="newCadreNickname" name="nickname" maxlength="50" autocomplete="nickname" required></div>
            <div class="field"><label for="newCadrePhone">Nomor WhatsApp</label><input id="newCadrePhone" name="phone" type="tel" maxlength="30" autocomplete="tel"></div>
            <div class="field"><label for="newCadreVillage">Desa</label><select id="newCadreVillage" name="village_code" required>${selectOptions(masters.villages, 'village_code', 'village_name')}</select></div>
            <div class="field" id="newCadrePinField"><label for="newCadrePin">PIN 6 digit</label><input id="newCadrePin" name="pin" inputmode="numeric" minlength="6" maxlength="6" pattern="[0-9]{6}" required></div>
            <div class="form-actions"><button id="cadreSubmit" type="submit">Simpan kader</button><button id="cancelCadreEdit" type="button" class="secondary" hidden>Batal mengedit</button></div>
          </form>
      </section>
      <section id="admin-users-access" class="card user-admin-section" ${usersAdminActivePanel === 'admin-users-access' ? '' : 'hidden'}><h2 tabindex="-1">Atur ulang akses</h2><p class="section-intro">Gunakan hanya jika pemilik akun kehilangan akses. Semua sesi lama akun tersebut akan dicabut.</p>
        <div class="grid">
          <form id="resetPasswordForm"><h3>Atur ulang kata sandi petugas</h3>
            <div class="field"><label for="resetUser">Petugas</label><select id="resetUser" name="user_id" required><option value="">Pilih petugas…</option>${users.map(user => `<option value="${esc(user.user_id)}">${esc(user.name || user.email)} (${esc(user.email)})${user.email === me.email ? ' · akun Anda' : ''}</option>`).join('')}</select></div>
            <div class="field"><label for="resetUserPassword">Kata sandi baru <small>Minimal 15 karakter</small></label><input id="resetUserPassword" name="password" type="password" minlength="15" autocomplete="new-password" required>${passwordGuidance('resetUserPasswordRules')}</div>
            <div class="form-actions"><button type="submit" class="secondary">Atur ulang kata sandi</button></div>
          </form>
          <form id="resetCadrePinForm"><h3>Atur ulang PIN kader</h3>
            <div class="field"><label for="resetCadre">Kader</label><select id="resetCadre" name="reporter_id" required><option value="">Pilih kader…</option>${cadres.map(cadre => `<option value="${esc(cadre.reporter_id)}">${esc(cadre.name || cadre.cadre_code)} (${esc(cadre.cadre_code)})</option>`).join('')}</select></div>
            <div class="field"><label for="resetCadrePin">PIN baru 6 digit</label><input id="resetCadrePin" name="pin" inputmode="numeric" minlength="6" maxlength="6" pattern="[0-9]{6}" required></div>
            <div class="form-actions"><button type="submit" class="secondary">Atur ulang PIN</button></div>
          </form>
        </div>
      </section>
       <section id="admin-users-directory" class="card user-admin-section" ${usersAdminActivePanel === 'admin-users-directory' ? '' : 'hidden'}><div class="section-heading"><div><h2 tabindex="-1">Daftar akun</h2></div><span class="count">${users.length + cadres.length}</span></div><div class="admin-list-tools"><label class="field" for="accountAdminSearch"><span>Cari akun</span><input id="accountAdminSearch" type="search" placeholder="Ketik nama, email, kode, atau desa" autocomplete="off"></label></div>
         <div class="admin-subsection"><h3>Petugas <span class="count">${users.length}</span></h3>${users.length ? `<div class="table-wrap mobile-cards user-admin-table"><table><thead><tr><th>Email</th><th>Nama</th><th>Peran</th><th>Status</th><th>Aktivitas</th><th>Aksi</th></tr></thead><tbody>${users.map(user => `<tr data-account-row data-search="${esc(`${user.email} ${user.name || ''} ${STAFF_ROLE_LABELS[user.role] || user.role} ${user.program || ''}`.toLowerCase())}"><td data-label="Email">${esc(user.email)}</td><td data-label="Nama">${valueOrDash(user.name)}</td><td data-label="Peran">${esc(STAFF_ROLE_LABELS[user.role] || user.role)}${user.program ? `<br><small>${esc(user.program)}</small>` : ''}</td><td data-label="Status">${activePill(user.active)}${!Number(user.active) && user.deactivation_reason ? `<br><small>${esc(user.deactivation_reason)}</small>` : ''}</td><td data-label="Aktivitas"><small>${user.last_login_at ? `Terakhir masuk ${formatDate(user.last_login_at)}` : 'Belum pernah masuk'}${Number(user.active_sessions) ? `<br>${esc(user.active_sessions)} sesi aktif` : ''}</small></td><td class="action-cell">${user.email === me.email ? '<span class="muted">Akun Anda</span>' : `<div class="actions"><button class="secondary editUser" data-id="${esc(user.user_id)}">Edit</button><button class="secondary revokeUserSessions" data-id="${esc(user.user_id)}" data-label="${esc(user.name || user.email)}">Akhiri sesi</button>${toggleButton('toggleUser', user.user_id, user.active)}<button class="danger-button deleteUser" data-id="${esc(user.user_id)}" data-label="${esc(user.name || user.email)}">Hapus</button></div>`}</td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada petugas')}</div>
         <div class="admin-subsection"><h3>Kader <span class="count">${cadres.length}</span></h3>${cadres.length ? `<div class="table-wrap mobile-cards user-admin-table"><table><thead><tr><th>Kode</th><th>Nama</th><th>Desa</th><th>Status</th><th>Aktivitas</th><th>Aksi</th></tr></thead><tbody>${cadres.map(cadre => `<tr data-account-row data-search="${esc(`${cadre.cadre_code} ${cadre.name || ''} ${cadre.nickname || ''} ${cadre.village_code || ''} ${cadre.posyandu_name || ''} ${cadre.phone || ''}`.toLowerCase())}"><td data-label="Kode"><strong>${esc(cadre.cadre_code)}</strong></td><td data-label="Nama">${valueOrDash(cadre.name)}${cadre.nickname ? `<br><small>Panggilan: ${esc(cadre.nickname)}</small>` : '<br><small>Nama panggilan belum diisi</small>'}${cadre.phone ? `<br><small>${esc(cadre.phone)}</small>` : ''}</td><td data-label="Desa">${valueOrDash(cadre.village_code)}${cadre.posyandu_name ? `<br><small>Posyandu ${esc(cadre.posyandu_name)}</small>` : ''}</td><td data-label="Status">${activePill(cadre.active)}${!Number(cadre.active) && cadre.deactivation_reason ? `<br><small>${esc(cadre.deactivation_reason)}</small>` : ''}</td><td data-label="Aktivitas"><small>${cadre.last_login_at ? `Terakhir masuk ${formatDate(cadre.last_login_at)}` : 'Belum pernah masuk'}${Number(cadre.active_sessions) ? `<br>${esc(cadre.active_sessions)} sesi aktif` : ''}</small></td><td class="action-cell"><div class="actions"><button class="secondary copyCadreLink" data-code="${esc(cadre.cadre_code)}">Salin tautan masuk</button><button class="secondary editCadre" data-id="${esc(cadre.reporter_id)}">Edit</button><button class="secondary revokeCadreSessions" data-id="${esc(cadre.reporter_id)}" data-label="${esc(cadre.name || cadre.cadre_code)}">Akhiri sesi</button>${toggleButton('toggleCadre', cadre.reporter_id, cadre.active)}<button class="danger-button deleteCadre" data-id="${esc(cadre.reporter_id)}" data-label="${esc(cadre.name || cadre.cadre_code)}">Hapus</button></div></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada kader', 'Pilih Tambah kader untuk membuat akun.')}</div>
      </section>`;

    const showMessage = (type, text) => {
      document.querySelector('#message').innerHTML = alertBox(type, text);
      focusMessage('message');
    };
    if (notice) showMessage(notice.type || 'success', notice.text);
    const activateUserAdminPanel = (panelId, focus = true) => {
      usersAdminActivePanel = panelId;
      document.querySelectorAll('[data-user-admin-jump]').forEach(button => { button.setAttribute('aria-expanded', String(button.dataset.userAdminJump === panelId)); button.setAttribute('aria-controls', button.dataset.userAdminJump); });
      document.querySelectorAll('.user-admin-section').forEach(panel => { panel.hidden = panel.id !== panelId; });
      if (focus) document.querySelector(`#${panelId} h2`)?.focus({ preventScroll: true });
    };
    activateUserAdminPanel(usersAdminActivePanel, false);
    document.querySelectorAll('[data-user-admin-jump]').forEach(button => button.addEventListener('click', () => activateUserAdminPanel(button.dataset.userAdminJump)));
    // Action controls use ordinary button keyboard behavior.
    bindDirectory('#accountAdminSearch', '[data-account-row]', 'accountAdminSearchFeedback');
    document.querySelectorAll('#admin-users-directory .editUser, #admin-users-directory .editCadre').forEach(edit => {
      const cadre = edit.classList.contains('editCadre');
      const reset = document.createElement('button');
      reset.type = 'button'; reset.className = 'secondary';
      reset.textContent = cadre ? 'Atur ulang PIN' : 'Atur ulang sandi';
      reset.addEventListener('click', () => {
        activateUserAdminPanel('admin-users-access', false);
        const target = document.querySelector(cadre ? '#resetCadre' : '#resetUser');
        target.value = edit.dataset.id;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector(cadre ? '#resetCadrePin' : '#resetUserPassword').focus();
      });
      edit.after(reset);
    });
    compactRowActions('#admin-users-directory .action-cell .actions');

    const userForm = document.querySelector('#userForm');
    const userRole = document.querySelector('#newUserRole');
    const userProgram = document.querySelector('#newUserProgram');
    const userPassword = document.querySelector('#newUserPassword');
    bindPasswordGuidance(userPassword, document.querySelector('#newUserPasswordRules'), () => `${document.querySelector('#newUserEmail')?.value || ''} ${document.querySelector('#newUserName')?.value || ''}`);
    bindPasswordGuidance(document.querySelector('#resetUserPassword'), document.querySelector('#resetUserPasswordRules'), () => {
      const target = users.find(user => user.user_id === document.querySelector('#resetUser')?.value);
      return `${target?.email || ''} ${target?.name || ''}`;
    });
    const syncUserProgram = () => {
      const required = userRole.value === 'PETUGAS_PROGRAM';
      userProgram.disabled = !required;
      userProgram.required = required;
      if (!required) userProgram.value = '';
    };
    const resetUserForm = () => {
      userForm.reset(); userForm.dataset.userId = '';
      userPassword.disabled = false; userPassword.required = true;
      document.querySelector('#newUserPasswordField').hidden = false;
      document.querySelector('#userFormTitle').textContent = 'Tambah petugas';
      document.querySelector('#userSubmit').textContent = 'Simpan petugas';
      document.querySelector('#cancelUserEdit').hidden = true;
      syncUserProgram();
    };
    userRole.addEventListener('change', syncUserProgram);
    document.querySelector('#cancelUserEdit').addEventListener('click', resetUserForm);
    syncUserProgram();
    document.querySelectorAll('.editUser').forEach(button => button.addEventListener('click', () => {
      const user = users.find(item => item.user_id === button.dataset.id); if (!user) return;
      activateUserAdminPanel('admin-users-staff', false);
      userForm.dataset.userId = user.user_id;
      userForm.elements.name.value = user.name || ''; userForm.elements.email.value = user.email || '';
      userRole.value = user.role; syncUserProgram(); userProgram.value = user.program || '';
      userPassword.disabled = true; userPassword.required = false; document.querySelector('#newUserPasswordField').hidden = true;
      document.querySelector('#userFormTitle').textContent = `Edit ${user.name || user.email}`;
      document.querySelector('#userSubmit').textContent = 'Simpan perubahan'; document.querySelector('#cancelUserEdit').hidden = false;
      userForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); userForm.elements.name.focus();
      adminDrafts.reset(userForm);
    }));
    userForm.addEventListener('submit', event => submitForm(event, async () => {
      try {
        const userId = userForm.dataset.userId; const data = Object.fromEntries(new FormData(userForm));
        await api(userId ? `/api/admin/users/${encodeURIComponent(userId)}` : '/api/admin/users', { method: userId ? 'PATCH' : 'POST', body: JSON.stringify(data) });
        await usersAdmin({ type: 'success', text: userId ? 'Detail petugas diperbarui.' : 'Petugas ditambahkan.' });
      } catch (error) { showMessage('error', error.message); }
    }));

    const cadreForm = document.querySelector('#cadreForm2');
    const cadrePin = document.querySelector('#newCadrePin');
    const resetCadreForm = () => {
      cadreForm.reset(); cadreForm.dataset.reporterId = ''; cadrePin.disabled = false; cadrePin.required = true;
      document.querySelector('#newCadrePinField').hidden = false; document.querySelector('#cadreFormTitle').textContent = 'Tambah kader';
      document.querySelector('#cadreSubmit').textContent = 'Simpan kader'; document.querySelector('#cancelCadreEdit').hidden = true;
    };
    document.querySelector('#cancelCadreEdit').addEventListener('click', resetCadreForm);
    document.querySelectorAll('.editCadre').forEach(button => button.addEventListener('click', () => {
      const cadre = cadres.find(item => item.reporter_id === button.dataset.id); if (!cadre) return;
      activateUserAdminPanel('admin-users-cadres', false);
      cadreForm.dataset.reporterId = cadre.reporter_id; cadreForm.elements.cadre_code.value = cadre.cadre_code || '';
      cadreForm.elements.name.value = cadre.name || ''; cadreForm.elements.nickname.value = cadre.nickname || ''; cadreForm.elements.phone.value = cadre.phone || '';
      cadreForm.elements.village_code.value = cadre.village_code || ''; cadrePin.disabled = true; cadrePin.required = false;
      document.querySelector('#newCadrePinField').hidden = true; document.querySelector('#cadreFormTitle').textContent = `Edit ${cadre.name || cadre.cadre_code}`;
      document.querySelector('#cadreSubmit').textContent = 'Simpan perubahan'; document.querySelector('#cancelCadreEdit').hidden = false;
      cadreForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); cadreForm.elements.name.focus();
      adminDrafts.reset(cadreForm);
    }));
    document.querySelectorAll('.copyCadreLink').forEach(button => button.addEventListener('click', () => copyReporterAccessLink(button, button.dataset.code)));
    cadreForm.addEventListener('submit', event => submitForm(event, async () => {
      try {
        const reporterId = cadreForm.dataset.reporterId; const data = Object.fromEntries(new FormData(cadreForm));
        await api(reporterId ? `/api/admin/cadres/${encodeURIComponent(reporterId)}` : '/api/admin/cadres', { method: reporterId ? 'PATCH' : 'POST', body: JSON.stringify(data) });
        await usersAdmin({ type: 'success', text: reporterId ? 'Detail kader diperbarui.' : 'Kader ditambahkan.' });
      } catch (error) { showMessage('error', error.message); }
    }));

    const submitReset = (selector, endpoint, success, confirmation) => document.querySelector(selector).addEventListener('submit', event => submitForm(event, async () => {
      const form = event.currentTarget;
      try {
        const data = Object.fromEntries(new FormData(form));
        if (!await confirmAction('Atur ulang kredensial?', confirmation(data), 'Atur ulang', true)) return;
        await api(endpoint(data), { method: 'POST', body: JSON.stringify(data) }); showMessage('success', success); form.reset();
      }
      catch (error) { showMessage('error', error.message); }
    }));
    submitReset('#resetPasswordForm', data => `/api/admin/users/${encodeURIComponent(data.user_id)}/reset-password`, 'Kata sandi petugas diperbarui.', data => {
      const target = users.find(user => user.user_id === data.user_id);
      return `Atur ulang kata sandi ${target?.name || target?.email || 'petugas ini'}? Semua sesi akun tersebut akan dicabut.${target?.email === me.email ? '\n\nPERHATIAN: ini adalah akun administrator yang sedang Anda gunakan.' : ''}`;
    });
    submitReset('#resetCadrePinForm', data => `/api/admin/cadres/${encodeURIComponent(data.reporter_id)}/reset-pin`, 'PIN kader diperbarui.', data => {
      const target = cadres.find(cadre => cadre.reporter_id === data.reporter_id);
      return `Atur ulang PIN ${target?.name || target?.cadre_code || 'kader ini'}? Semua sesi akun tersebut akan dicabut.`;
    });
    document.querySelectorAll('.revokeUserSessions').forEach(button => button.addEventListener('click', async () => {
      if (!await confirmAction('Akhiri semua sesi?', `Semua sesi ${button.dataset.label || 'petugas ini'} akan segera dicabut.`, 'Akhiri sesi', true)) return;
      try { await api(`/api/admin/users/${encodeURIComponent(button.dataset.id)}/revoke-sessions`, { method: 'POST' }); await usersAdmin({ type: 'success', text: 'Semua sesi petugas telah dicabut.' }); }
      catch (error) { showMessage('error', error.message); }
    }));
    document.querySelectorAll('.revokeCadreSessions').forEach(button => button.addEventListener('click', async () => {
      if (!await confirmAction('Akhiri semua sesi?', `Semua sesi ${button.dataset.label || 'kader ini'} akan segera dicabut.`, 'Akhiri sesi', true)) return;
      try { await api(`/api/admin/cadres/${encodeURIComponent(button.dataset.id)}/revoke-sessions`, { method: 'POST' }); await usersAdmin({ type: 'success', text: 'Semua sesi kader telah dicabut.' }); }
      catch (error) { showMessage('error', error.message); }
    }));
    document.querySelectorAll('.deleteUser').forEach(button => button.addEventListener('click', async () => {
      try {
        if (await deleteWithReason(button, `akun petugas ${button.dataset.label}`, `/api/admin/users/${encodeURIComponent(button.dataset.id)}`))
          await usersAdmin({ type: 'success', text: 'Akun petugas dihapus dan tindakannya dicatat.' });
      } catch (error) { showMessage('error', error.message); }
    }));
    document.querySelectorAll('.deleteCadre').forEach(button => button.addEventListener('click', async () => {
      try {
        if (await deleteWithReason(button, `akun kader ${button.dataset.label}`, `/api/admin/cadres/${encodeURIComponent(button.dataset.id)}`))
          await usersAdmin({ type: 'success', text: 'Akun kader dihapus. Laporan historisnya tetap tersimpan.' });
      } catch (error) { showMessage('error', error.message); }
    }));
    const bindToggle = (cls, endpoint) => document.querySelectorAll(`.${cls}`).forEach(button => button.addEventListener('click', async () => {
      const activating = Number(button.dataset.active) === 1;
      const reason = activating
        ? (await confirmAction('Aktifkan akun ini?', 'Akun akan kembali dapat digunakan untuk masuk.', 'Aktifkan') ? '' : null)
        : await requestReason('Nonaktifkan akun ini?', 'Akun tidak akan dapat digunakan untuk masuk.', 'Alasan penonaktifan');
      if (reason === null) return;
      setBusy(button, true, 'Menyimpan…');
      try { await api(endpoint(button.dataset.id), { method: 'POST', body: JSON.stringify({ active: Number(button.dataset.active), reason }) }); await usersAdmin({ type: 'success', text: 'Status akses diperbarui.' }); }
      catch (error) { showMessage('error', error.message); setBusy(button, false); }
    }));
    bindToggle('toggleUser', id => `/api/admin/users/${encodeURIComponent(id)}/status`);
    bindToggle('toggleCadre', id => `/api/admin/cadres/${encodeURIComponent(id)}/status`);
    const adminDrafts = watchAdminForms();
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('staff');
    pageFailure(error, () => route(), '#staff-home');
  }
}

function rememberedKeyForSession(me) {
  if (me?.kind === 'cadre') return rememberedLoginKey('cadre');
  if (me?.kind === 'routine') return rememberedLoginKey(`ibs-${String(me.source_type || '').toLowerCase()}`);
  return '';
}

async function completeLogout(button, forgetKey = '', destination = '#home') {
  if (leaveGuard?.() && !await confirmAction('Isian belum disimpan', 'Keluar sekarang? Perubahan yang belum disimpan akan hilang.', 'Keluar', true)) return;
  setBusy(button, true, 'Keluar…');
  try {
    await api('/api/auth/logout', { method: 'POST' });
    if (forgetKey) {
      storageWrite(localStorage, forgetKey, '');
      storageWrite(localStorage, reporterLoginKey, '');
    }
    activeSession = null; sessionState = 'anonymous'; leaveGuard = null;
    ebsViews.clearCadreDrafts();
    cadreReportDraft = null; publicReportDraft = null; cadreActivePanel = 'summary';
    storageWrite(sessionStorage, ACTIVE_ROLE_KEY, '');
    storageWrite(sessionStorage, EXPIRED_LOGIN_KEY, '');
    storageWrite(sessionStorage, AUTH_RETURN_KEY, '');
    storageWrite(sessionStorage, AUTH_NOTICE_KEY, '');
    renderSessionNavigation();
    if (location.hash === destination) await route(true); else location.hash = destination;
  } catch (error) {
    const target = document.querySelector('#accountSwitchMessage') || document.querySelector('.session-account-panel') || document.querySelector('#message');
    if (target) {
      target.insertAdjacentHTML('beforeend', alertBox('error', `Keluar belum berhasil dikonfirmasi. ${error.message}`));
      target.closest('details')?.setAttribute('open', '');
    }
    setBusy(button, false);
  }
}

async function logout(event) {
  const button = event?.currentTarget;
  let me = null;
  try { me = await api('/api/me'); } catch {}
  const rememberKey = rememberedKeyForSession(me);
  if (!rememberKey || !storageRead(localStorage, rememberKey) || typeof HTMLDialogElement === 'undefined')
    return completeLogout(button);
  document.querySelector('#logoutChoice')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'logoutChoice';
  dialog.className = 'account-dialog';
  dialog.setAttribute('aria-label', 'Keluar dari akun');
  dialog.innerHTML = `<form method="dialog"><p class="eyebrow">Keluar dari akun</p><h2>Informasi akun tersimpan di perangkat ini</h2><p>PIN tidak pernah disimpan. Anda dapat menyimpan nama akun untuk proses masuk berikutnya atau menghapusnya dari perangkat ini.</p><div class="form-actions"><button id="logoutOnly" type="button">Keluar</button><button id="logoutForget" type="button" class="secondary">Keluar dan hapus akun dari perangkat</button><button value="cancel" class="text-button">Batal</button></div></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('#logoutOnly').addEventListener('click', () => { dialog.close(); completeLogout(button); });
  dialog.querySelector('#logoutForget').addEventListener('click', () => { dialog.close(); completeLogout(button, rememberKey); });
  dialog.showModal();
}

const PAGE_TITLES = {
  '#about': 'Tentang', '#home': 'Beranda', '#faq': 'FAQ', '#situation': 'Situasi penyakit', '#public': 'Lapor kejadian', '#status': 'Cek status laporan', '#cadre': 'Portal kader', '#cadre-home': 'Portal kader', '#cadre-profile': 'Profil Saya',
  '#ibs-login-w2': 'Masuk sebagai faskes', '#ibs-login-school': 'Masuk sebagai satuan pendidikan',
  '#ibs-home': 'Surveilans rutin', '#staff': 'Akses petugas', '#staff-home': 'Ringkasan surveilans',
  '#staff-reports': 'Laporan Kader', '#staff-ebs-all': 'Semua Laporan Kader', '#staff-ibs': 'Laporan W2 Faskes', '#staff-w2-management': 'Laporan W2 Faskes', '#staff-school-management': 'Laporan Sekolah', '#staff-analytics': 'Analitik', '#admin-ibs': 'Administrasi IBS', '#admin-users': 'Administrasi pengguna', '#staff-events': 'Penanganan kejadian', '#staff-event': 'Buat event', '#staff-sbm':'Verifikasi dan OH',
};
function setTitle(page) {
  const label = page.startsWith('#staff-cadre-selection/') ? 'Pemilihan kader' : page.startsWith('#staff-sbm/') ? 'Screening dan verifikasi' : page.startsWith('#staff-report/') ? 'Detail laporan' : page.startsWith('#staff-event/') ? 'Detail event' : page.startsWith('#staff-w2/') ? 'Detail W2' : page.startsWith('#staff-school/') ? 'Detail sekolah' : page.startsWith('#admin-w2/') ? 'Entri W2 administratif' : page.startsWith('#admin-school/') ? 'Entri sekolah administratif' : PAGE_TITLES[page];
  document.title = (label ? `${label} · ` : '') + branding.displayName;
}

async function adminEntry(renderEntry) {
  try {
    const me = await api('/api/me');
    if (me.kind === 'staff' && me.role === 'ADMIN') return renderEntry();
    if (me.kind === 'staff') return staffHome();
    return loginPage('staff');
  } catch (error) {
    if (error.status === 401) return redirectForExpiredSession('staff');
    app.innerHTML = `<section class="card">${alertBox('error', error.message)}<a class="back-link" href="#staff-home">← Kembali ke dashboard</a></section>`;
  }
}

let cadreRefreshController;

function aboutPage() {
  app.innerHTML = `<section class="card"><p class="eyebrow">Tentang aplikasi</p><h1>${esc(branding.displayName)}</h1><p>${esc(branding.description)}</p><h2>Pengembang asli</h2><p>Dikembangkan pertama kali oleh <strong>${esc(project.author)}</strong> melalui proyek <strong>${esc(project.name)}</strong>.</p><p>${esc(project.copyright)}</p><h2>Pengelola instalasi</h2><p>${esc(branding.institution)}</p>${branding.displayName !== project.name ? `<p>Instalasi ini merupakan adaptasi ${esc(project.name)}.</p>` : ''}<h2>Lisensi</h2><p>${esc(project.license)}. Penggunaan dan adaptasi diperbolehkan dengan kewajiban mempertahankan atribusi.</p><p><a href="/LICENSE.txt" target="_blank" rel="noopener">Baca ketentuan lisensi lengkap</a></p><a class="back-link" href="#home">← Kembali ke beranda</a></section>`;
}

function render() {
  if (location.hash === '#home?section=faq') history.replaceState(null, '', '#faq');
  const rawPage = location.hash || defaultPage();
  const requestedPage = rawPage.split('?')[0];
  const page = ['#ibs', '#reporter'].includes(requestedPage) ? '#home' : requestedPage;
  if (page !== requestedPage) history.replaceState(null, '', '#home');
  diseaseTrendObserver?.disconnect();
  document.body.classList.toggle('home-route', page === '#home');
  document.body.classList.toggle('situation-route', page === '#situation');
  document.body.classList.toggle('public-content-route', ['#home', '#situation', '#public', '#status', '#faq', '#about'].includes(page));
  document.body.classList.toggle('workspace-route', page.startsWith('#staff-') || page.startsWith('#admin-'));
  document.body.classList.toggle('cadre-route', page.startsWith('#cadre-'));
  document.body.classList.toggle('reporter-route', page === '#ibs-home');
  document.body.classList.toggle('public-task-route', page === '#public' || page === '#status');
  syncPublicNavigation(page);
  leaveGuard = null;
  updateNavigation(page);
  setTitle(page);
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (page === '#home') return homePage();
  if (page === '#faq') return faqPage();
  if (page === '#about') return aboutPage();
  if (page === '#situation') return diseaseSituationPage();
  if (page === '#status') return statusPage();
  if (page === '#cadre') return loginPage('cadre');
  if (page === '#cadre-home') return cadreHome();
  if (page === '#cadre-profile') return renderCadreProfile({ app, api, esc, alertBox, messageBox, submitForm, pageFailure,
    onExpired: () => redirectForExpiredSession('cadre'),
    setLeaveGuard: guard => { leaveGuard = guard; }, onSaved: async me => {
      activeSession = me; renderSessionNavigation(); await syncWorkspaceNavigation();
    } });
  if (page.startsWith('#cadre-report/')) return ebsViews.cadreDetail(decodeURIComponent(page.slice('#cadre-report/'.length)));
  if (page === '#ibs-login-w2') return ibsLogin('FASKES');
  if (page === '#ibs-login-school') return ibsLogin('SEKOLAH');
  if (page === '#ibs-home') return ibsHome();
  if (page === '#staff') return loginPage('staff');
  if (page === '#staff-home') return staffHome();
  if (page === '#staff-reports') return ebsViews.list('inbox');
  if (page === '#staff-ebs-all') return ebsViews.list('all');
  if (page === '#staff-events') return ebsViews.events();
  if (page === '#staff-legacy-reports') { location.replace('#staff-ebs-all'); return; }
  if (page.startsWith('#staff-legacy-report/')) { location.replace('#staff-report/'+page.slice('#staff-legacy-report/'.length)); return; }
  if (page === '#staff-sbm' || page.startsWith('#staff-sbm/')) {
    location.replace('#staff-reports');
    return;
  }
  if (page.startsWith('#staff-cadre-selection/')) {location.replace('#staff-report/'+page.slice('#staff-cadre-selection/'.length));return;}
  if (page.startsWith('#staff-event-work/')) return eventWorkflow.detail(decodeURIComponent(page.slice('#staff-event-work/'.length)));
  if (page === '#staff-ibs' || page === '#staff-w2-management') return staffIbs(epiPeriod(), 'w2');
  if (page === '#staff-school-management') return staffIbs(epiPeriod(), 'school');
  if (page.startsWith('#admin-w2/')) return adminEntry(() => ibsW2(epiPeriod(), decodeURIComponent(page.slice(10))));
  if (page.startsWith('#admin-school/')) return adminEntry(() => ibsSchool(epiPeriod(), null, decodeURIComponent(page.slice(14))));
  if (page.startsWith('#staff-w2/')) return staffW2Detail(decodeURIComponent(page.slice(10)));
  if (page.startsWith('#staff-school/')) return staffSchoolDetail(decodeURIComponent(page.slice(14)));
  if (page === '#staff-analytics') return staffAnalytics();
  if (page === '#admin-ibs') return ibsAdmin();
  if (page === '#admin-users') return usersAdmin();
  if (page === '#staff-event') return eventForm();
  if (page.startsWith('#staff-event/')) return eventDetail(decodeURIComponent(page.slice(13)));
  if (page.startsWith('#staff-report/')) return staffReport(decodeURIComponent(page.slice(14)));
  return publicPage();
}

// Public services retain their own wayfinding outside the account workspace.
function syncPublicNavigation(page) {
  let navigation = document.querySelector('#publicNavigation');
  if (!navigation) {
    navigation = document.createElement('nav');
    navigation.id = 'publicNavigation';
    navigation.className = 'public-navigation';
    navigation.setAttribute('aria-label', 'Layanan publik');
    document.querySelector('.site-header').after(navigation);
  }
  navigation.hidden = page.startsWith('#staff-') || page.startsWith('#admin-') || (page === '#cadre-home' || page === '#cadre-profile' || page.startsWith('#cadre-report/')) || page === '#ibs-home';
  const destinations = [['#home', 'Beranda'], ['#situation', 'Situasi penyakit'], ['#public', 'Lapor kejadian'], ['#status', 'Cek status'], ['#faq', 'FAQ']];
  const currentDestination = page;
  navigation.innerHTML = `<div>${destinations.map(([href, label]) => `<a href="${href}"${currentDestination === href ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>`;
  const viewport = navigation.firstElementChild;
  const current = viewport.querySelector('[aria-current="page"]');
  if (current) requestAnimationFrame(() => {
    // Keep the selected destination visible within the compact navigation row.
    if (viewport.isConnected) viewport.scrollLeft = Math.max(0, current.offsetLeft + current.offsetWidth - viewport.clientWidth);
  });
}

async function route(focusMain = false) {
  // `#app` is the skip-link target, not a route; leave the current page intact.
  if (location.hash === '#app') return;
  app.setAttribute('aria-busy', 'true');
  app.innerHTML = `<section class="page-loading" role="status"><p>Memuat halaman…</p><div class="loading-shape" aria-hidden="true"></div><div class="loading-shape" aria-hidden="true"></div></section>`;
  try {
    await render();
    await refreshActiveSession();
    await syncWorkspaceNavigation();
    if(location.hash.split('?')[0]==='#cadre-home' && portalView()==='history') {
      const scroll=cadreHistoryOptions().scroll;
      requestAnimationFrame(()=>{if(location.hash.split('?')[0]==='#cadre-home')window.scrollTo({top:scroll,behavior:'auto'});});
    }
    if (focusMain) app.focus({ preventScroll: true });
  } catch (error) { pageFailure(error, () => route(focusMain), '#home'); }
  finally { app.removeAttribute('aria-busy'); }
}

// Global destinations live outside the page so form/filter refreshes retain them.
function workspaceSection(page) {
  if (page === '#staff-events') return '#staff-reports';
  if (page === '#staff-ebs-all') return '#staff-reports';
  if (page.startsWith('#staff-legacy-')) return '#staff-reports';
  if (page.startsWith('#staff-report') || page.startsWith('#staff-event')) return '#staff-reports';
  if (page.startsWith('#staff-cadre-selection/')) return '#staff-reports';
  if (page.startsWith('#staff-sbm')) return '#staff-sbm';
  if (page === '#staff-ibs' || page.startsWith('#staff-w2') || page.startsWith('#admin-w2')) return '#staff-w2-management';
  if (page.startsWith('#staff-school') || page.startsWith('#admin-school')) return '#staff-school-management';
  return page;
}
const portalView = () => new URLSearchParams(location.hash.split('?')[1] || '').get('view') || (location.hash.split('?')[0] === '#cadre-home' ? 'summary' : 'overview');
function setPortalLocation(view, period = null) {
  const base = location.hash.split('?')[0];
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (view === 'overview') params.delete('view'); else params.set('view', view);
  if (period) { params.set('epi_year', period.year); params.set('epi_week', period.week); }
  const destination = `${base}${params.size ? `?${params}` : ''}`;
  if (location.hash !== destination) history.pushState(null, '', destination);
  document.body.dataset.portalView = view;
  void syncWorkspaceNavigation();
}
function applyRoutineView(view = portalView(), focus = false) {
  if (!document.querySelector('.w2-workspace')) return;
  if (!['overview', 'report', 'history'].includes(view)) view = 'overview';
  document.body.dataset.portalView = view;
  const heading = document.querySelector('.w2-hero h1');
  if (heading) heading.textContent = view === 'history' ? 'Riwayat pengiriman' : view === 'overview' ? 'Ringkasan pelaporan' : 'Laporan W2 mingguan';
  if (heading) document.title = `${heading.textContent} · ${branding.displayName}`;
  const calendar = document.querySelector('.w2-calendar-card');
  document.querySelector('#openW2Task')?.classList.toggle('secondary', view !== 'overview');
  if (calendar && view === 'history') calendar.open = true;
  if (focus) {
    const target = view === 'report' ? document.querySelector('.w2-heading h2') : heading;
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start', behavior: 'auto' }); }
  }
}
async function syncWorkspaceNavigation() {
  const page = (location.hash || defaultPage()).split('?')[0];
  const shell = document.querySelector('#workspaceShell');
  const host = document.querySelector('#workspaceNavigation');
  const privatePage = page.startsWith('#staff-') || page.startsWith('#admin-') || (page === '#cadre-home' || page === '#cadre-profile' || page.startsWith('#cadre-report/')) || page === '#ibs-home';
  let bottom = document.querySelector('#mobileNavigation');
  if (!bottom) { bottom = document.createElement('nav'); bottom.id = 'mobileNavigation'; bottom.className = 'mobile-navigation'; bottom.setAttribute('aria-label', 'Navigasi utama'); document.body.append(bottom); }
  document.body.classList.toggle('has-workspace-navigation', privatePage && Boolean(activeSession));
  if (!privatePage || !activeSession || app.querySelector('.auth-shell')) { shell.classList.remove('is-active'); host.hidden = true; bottom.hidden = true; return; }
  const me = activeSession;
  let items = [], administration = [], active;
  if (me.kind === 'staff') {
    items = [['#staff-home', 'Ringkasan', 'overview'], ['#staff-reports', 'Laporan Kader', 'incident'], ['#staff-w2-management', 'Laporan W2 Faskes', 'routine'], ['#staff-school-management', 'Laporan Sekolah', 'school'],
      ['#staff-analytics', 'Analisis', 'analytics']];
    administration = me.role === 'ADMIN' ? [['#admin-ibs', 'Pengaturan pelaporan', 'settings'], ['#admin-users', 'Petugas & kader', 'users']] : [];
    active = workspaceSection(page);
  } else if (me.kind === 'cadre') {
    const historyHref=page.startsWith('#cadre-report/')?ebsViews.cadreReturn():'#cadre-home?view=history';
    items = [['#cadre-home?view=summary', 'Ringkasan', 'overview'], ['#cadre-home?view=report', 'Buat laporan', 'incident'], [historyHref, 'Riwayat laporan', 'status'], ['#cadre-profile', 'Profil Saya', 'users']];
    active = page === '#cadre-profile' ? '#cadre-profile' : page.startsWith('#cadre-report/') || portalView() === 'history' || portalView() === 'followup' ? historyHref : portalView()==='report' ? '#cadre-home?view=report' : '#cadre-home?view=summary';
  } else {
    items = [['#ibs-home', 'Ringkasan', 'overview'], ['#ibs-home?view=report', 'Laporan W2', 'routine'], ['#ibs-home?view=history', 'Riwayat pengiriman', 'status']];
    active = items.find(([href]) => href.endsWith(`view=${portalView()}`))?.[0] || '#ibs-home';
    // School reporting keeps its established form and does not advertise W2 history.
    if (me.source_type === 'SEKOLAH') { items = [['#ibs-home', 'Pelaporan sekolah', 'school']]; active = '#ibs-home'; }
  }
  const compactLabels = { [ebsViews.cadreReturn()]:'Riwayat', '#staff-reports': 'Kader', '#staff-w2-management': 'W2 Faskes', '#cadre-home?view=history': 'Riwayat', '#ibs-home?view=history': 'Riwayat', '#cadre-profile': 'Profil' };
  const links = (list, compact = false) => list.map(([href,label,icon]) => `<a href="${href}"${href === active ? ' aria-current="page"' : ''}${compact && compactLabels[href] ? ` aria-label="${esc(label)}"` : ''}>${uiIcon(icon)}<span>${esc(compact ? compactLabels[href] || label : label)}</span></a>`).join('');
  const identityContext = me.kind === 'cadre' ? [me.posyandu_name ? `Posyandu ${me.posyandu_name}` : '', me.village_name || me.village_code].filter(Boolean).join(' · ')
    : me.kind === 'routine' ? (me.source_code !== accountName(me) ? me.source_code : '') : '';
  host.innerHTML = `<div class="workspace-menu-content"><div class="workspace-nav-title"><strong>Ruang kerja</strong><span>${esc(accountRole(me))}</span></div><div class="workspace-nav-identity"><strong>${esc(accountName(me))}</strong>${identityContext ? `<span>${esc(identityContext)}</span>` : ''}</div><nav aria-label="Navigasi ruang kerja">${links(items)}${administration.length ? `<p class="workspace-nav-group">Administrasi</p>${links(administration)}` : ''}</nav><a class="workspace-public-link" href="#home">${uiIcon('overview')}<span>Beranda publik</span></a></div>`;
  const primary = me.kind === 'staff' ? items.slice(0, 3) : items;
  const remaining = me.kind === 'staff' ? [...items.slice(3), ...administration] : [];
  bottom.innerHTML = `${links(primary, true)}${remaining.length ? `<button id="workspaceMenuToggle" class="mobile-more" type="button" aria-expanded="false" aria-controls="mobileMorePanel">${uiIcon('settings')}<span>Lainnya</span></button><div id="mobileMorePanel" class="mobile-more-panel" hidden><div class="mobile-more-heading"><strong>Menu lainnya</strong><button id="closeMobileMore" type="button" class="secondary" aria-label="Tutup menu lainnya">×</button></div>${links(remaining)}</div>` : ''}`;
  if (remaining.some(([href]) => href === active)) bottom.querySelector('#workspaceMenuToggle')?.setAttribute('aria-current', 'page');
  const more = bottom.querySelector('#mobileMorePanel'), toggle = bottom.querySelector('#workspaceMenuToggle');
  const close = () => { if (more) more.hidden = true; toggle?.setAttribute('aria-expanded', 'false'); };
  toggle?.addEventListener('click', () => { more.hidden = !more.hidden; toggle.setAttribute('aria-expanded', String(!more.hidden)); if (!more.hidden) more.querySelector('a')?.focus(); });
  bottom.querySelector('#closeMobileMore')?.addEventListener('click', () => { close(); toggle.focus(); });
  bottom.onkeydown = event => { if (event.key === 'Escape' && more && !more.hidden) { close(); toggle.focus(); } };
  bottom.querySelectorAll('a').forEach(link => link.addEventListener('click', close));
  host.hidden = false; bottom.hidden = false; shell.classList.add('is-active');
  document.body.classList.toggle('portal-overview', (me.kind === 'cadre' && page === '#cadre-home' && portalView()==='summary') || (me.kind === 'routine' && portalView() === 'overview'));
  if (me.kind === 'routine') applyRoutineView();
  app.querySelector('.portal-date')?.remove();
  if (document.body.classList.contains('portal-overview')) {
    const date = document.createElement('button'); date.type = 'button'; date.className = 'portal-date secondary';
    date.setAttribute('aria-haspopup', 'dialog'); date.setAttribute('aria-controls', 'headerCalendarPopover');
    date.textContent = `${document.querySelector('#headerDate')?.textContent || ''} · ${document.querySelector('#headerEpiWeek')?.textContent || ''}`;
    date.addEventListener('click', () => document.querySelector('#headerCalendarButton').click());
    app.prepend(date);
  }
}

// Local destinations retain the live form nodes and their handlers. Browser
// Back uses the same view switch; leaving the workspace still uses leaveGuard.
document.addEventListener('click', event => {
  const anchor = event.target.closest('a[href]');
  if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const href = anchor.getAttribute('href');
  const base = location.hash.split('?')[0];
  if (!['#cadre-home', '#ibs-home'].includes(base) || href?.split('?')[0] !== base) return;
  event.preventDefault();
  const view = new URLSearchParams(href.split('?')[1] || '').get('view') || 'overview';
  setPortalLocation(view);
  if (base === '#cadre-home') document.querySelector(`#cadre${{summary:'Summary',history:'History',followup:'History',report:'Report'}[view] || 'Summary'}Tab`)?.click();
  else applyRoutineView(view, true);
});
document.addEventListener('pointerdown', event => {
  const panel = document.querySelector('#mobileMorePanel');
  if (panel && !panel.hidden && !event.target.closest('#mobileNavigation')) {
    panel.hidden = true; document.querySelector('#workspaceMenuToggle')?.setAttribute('aria-expanded', 'false');
  }
});
const syncKeyboardNavigation = () => {
  const editable = document.activeElement?.matches('input, textarea, select');
  document.body.classList.toggle('is-keyboard-open', Boolean(editable && window.visualViewport && innerHeight - window.visualViewport.height > 140));
};
window.visualViewport?.addEventListener('resize', syncKeyboardNavigation);
document.addEventListener('focusout', () => requestAnimationFrame(syncKeyboardNavigation));


// Protect in-progress reports from an accidental refresh, tab close, or mobile
// browser eviction before the debounced checkpoint has completed.
window.addEventListener('beforeunload', event => {
  if (!leaveGuard || !leaveGuard()) return;
  event.preventDefault();
  event.returnValue = '';
});

// Skip link: move focus to the content without changing the route.
document.querySelector('.skip-link')?.addEventListener('click', event => {
  event.preventDefault();
  app.focus();
});

window.addEventListener('hashchange', async event => {
  if (location.hash === '#app') return;
  const previousHash = new URL(event.oldURL).hash.split('?')[0];
  const nextHash = location.hash.split('?')[0];
  const cadrePage=value=>value==='#cadre-home'||value==='#cadre-profile'||value.startsWith('#cadre-report/');
  if(previousHash!==nextHash&&previousHash!=='#cadre-profile'&&cadrePage(previousHash)&&cadrePage(nextHash)) {route(true);return;}
  if (previousHash === nextHash && nextHash === '#cadre-home' && document.querySelector('#cadreReportPanel')) {
    document.querySelector(`#cadre${{summary:'Summary',history:'History',followup:'History',report:'Report'}[portalView()] || 'Summary'}Tab`)?.click();
    return;
  }
  if (previousHash === nextHash && nextHash === '#ibs-home' && document.querySelector('.w2-workspace')) {
    const previousParams = new URLSearchParams(new URL(event.oldURL).hash.split('?')[1] || '');
    const nextParams = new URLSearchParams(location.hash.split('?')[1] || '');
    if (previousParams.get('epi_year') === nextParams.get('epi_year') && previousParams.get('epi_week') === nextParams.get('epi_week')) {
      applyRoutineView(portalView(), true); void syncWorkspaceNavigation(); return;
    }
  }
  if (leaveGuard?.()) {
    if (leaveDialogPending) return;
    leaveDialogPending = true;
    const retained = Boolean(document.querySelector('#publicForm, #cadreForm, .cadre-report-heading'));
    const message = retained
      ? 'Tinggalkan halaman ini? Isian tetap tersedia saat Anda kembali di tab ini. Isian akan hilang jika halaman dimuat ulang atau tab ditutup.'
      : 'Tinggalkan halaman ini? Perubahan yang belum disimpan akan hilang.';
    const leave = await confirmAction('Isian belum dikirim', message, 'Tinggalkan halaman', true);
    leaveDialogPending = false;
    if (leave) route(true);
    else history.pushState(null, '', event.oldURL);
    return;
  }
  route(true);
});
function setupBrandWordmark() {
  const brand = document.querySelector('.brand');
  // Update older cached document shells as well as the current markup.
  if (!brand) return;
  brand.innerHTML = brandWordmark();
  brand.setAttribute('aria-label', `${branding.displayName}, halaman beranda`);
  if (!branding.wordmark.accent) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const sweep = () => { if (!reducedMotion.matches) brand.classList.add('is-brand-sweeping'); };
  brand.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') sweep(); });
  brand.addEventListener('focus', sweep);
  brand.addEventListener('animationend', event => { if (event.animationName === 'brandLightSweep') brand.classList.remove('is-brand-sweeping'); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) brand.classList.remove('is-brand-sweeping'); });
  requestAnimationFrame(sweep);
}
const ebsViews = createEbsViews({app,api,esc,empty,formatDate,getMasters,pageFailure,submitForm,alertBox,setBusy,setLeaveGuard:guard=>{leaveGuard=guard;},affectedGroupLabel,confirmAction,deleteWithReason,onReportUpdated:()=>{app.dispatchEvent(new Event('cadre-report-updated'));}});
const eventWorkflow=createEventWorkflow({app,api,esc,formatDate,alertBox,submitForm,confirmAction,setLeaveGuard:guard=>{leaveGuard=guard;}});
function staffReport(reportId) { return ebsViews.detail(reportId); }
setupBrandWordmark();
setupThemeToggle();
setupHeaderCalendar();
renderSessionNavigation();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshActiveSession(); });
route();
