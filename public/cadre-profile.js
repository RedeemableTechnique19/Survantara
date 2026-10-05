export async function renderCadreProfile(options) {
  const { app, api, esc, alertBox, messageBox, submitForm, pageFailure, setLeaveGuard, onSaved, onExpired } = options;
  try {
    let me = await api('/api/cadre/profile');
    if (location.hash.split('?')[0] !== '#cadre-profile') return;
    const pinField = (id, name, label, current = false) => `<div class="field"><label for="${id}">${label}</label><div class="password-control"><input id="${id}" name="${name}" type="password" inputmode="numeric" minlength="6" maxlength="${current ? 8 : 6}" pattern="${current ? '[0-9]{6}([0-9]{2})?' : '[0-9]{6}'}" autocomplete="${current ? 'current-password' : 'new-password'}" required><button type="button" class="password-toggle" data-toggle-pin="${id}" aria-pressed="false" aria-label="Tampilkan ${label.toLowerCase()}">Tampilkan</button></div></div>`;
    app.innerHTML = `<section class="card hero"><p class="eyebrow">Portal kader</p><h1>Profil Saya</h1><p>Perbarui identitas dan PIN akun Anda.</p></section>
      <div class="cadre-profile-layout">
        <section class="card" aria-labelledby="cadreProfileTitle"><h2 id="cadreProfileTitle">Identitas Anda</h2>
          <div id="cadreProfileReminder">${!me.profile_complete ? alertBox('warning', 'Lengkapi nama panggilan sebelum mengirim laporan baru.') : ''}</div>
          <p class="section-intro">Nama lengkap dicantumkan pada laporan. Nama panggilan digunakan untuk sapaan di portal. Kolom bertanda * wajib diisi.</p>
          ${messageBox('cadreProfileMessage')}
          <form id="cadreProfileForm">
            <div class="field"><label for="cadreProfileName">Nama lengkap *</label><input id="cadreProfileName" name="name" autocomplete="name" maxlength="100" value="${esc(me.name)}" required></div>
            <div class="field"><label for="cadreProfileNickname">Nama Panggilan *</label><input id="cadreProfileNickname" name="nickname" autocomplete="nickname" maxlength="50" value="${esc(me.nickname)}" aria-describedby="cadreNicknameHelp" required><p id="cadreNicknameHelp" class="help">Tuliskan nama yang Anda gunakan sehari-hari.</p></div>
            <div class="field"><label for="cadreProfilePhone">Nomor WhatsApp <small>Opsional</small></label><input id="cadreProfilePhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="30" placeholder="08xx atau +62…" value="${esc(me.phone)}"></div>
            <div class="form-actions"><button type="submit">Simpan profil</button><a class="button secondary" href="#cadre-home">Kembali ke portal</a></div>
          </form>
        </section>
        <div class="cadre-profile-aside">
          <section class="card" aria-labelledby="cadreAssignmentTitle"><h2 id="cadreAssignmentTitle">Akun dan wilayah</h2>
            <dl class="detail-grid"><div><dt>Kode kader</dt><dd>${esc(me.cadre_code)}</dd></div><div><dt>Desa</dt><dd>${esc(me.village_name || me.village_code)}</dd></div><div><dt>Posyandu</dt><dd>${esc(me.posyandu_name || 'Belum ditetapkan')}</dd></div></dl>
            <p class="help">Hubungi administrator instalasi untuk perubahan kode kader, desa, atau posyandu.</p>
          </section>
          <section class="card" aria-labelledby="cadrePinTitle"><h2 id="cadrePinTitle">Ganti PIN</h2><p class="section-intro">Gunakan PIN baru 6 digit. Setelah disimpan, sesi masuk di perangkat lain akan berakhir.</p>
            ${messageBox('cadrePinMessage')}
            <form id="cadrePinForm">${pinField('cadreCurrentPin', 'current_pin', 'PIN lama', true)}${pinField('cadreNewPin', 'new_pin', 'PIN baru')}${pinField('cadreConfirmPin', 'confirm_pin', 'Ulangi PIN baru')}
              <div class="form-actions"><button type="submit" class="secondary">Simpan PIN baru</button></div>
            </form>
          </section>
        </div>
      </div>`;
    const profileForm = app.querySelector('#cadreProfileForm');
    const pinForm = app.querySelector('#cadrePinForm');
    const identity = () => Object.fromEntries(new FormData(profileForm));
    let baseline = JSON.stringify(identity());
    setLeaveGuard(() => JSON.stringify(identity()) !== baseline || [...pinForm.querySelectorAll('input')].some(input => input.value));
    const show = (id, type, text) => {
      if (!profileForm.isConnected) return;
      const target = app.querySelector(`#${id}`);
      target.innerHTML = alertBox(type, text);
      target.tabIndex = -1; target.focus({ preventScroll: true });
    };
    profileForm.addEventListener('submit', event => submitForm(event, async () => {
      try {
        me = await api('/api/cadre/profile', { method: 'PATCH', body: JSON.stringify(identity()) });
        if (!profileForm.isConnected) return;
        for (const key of ['name', 'nickname', 'phone']) profileForm.elements[key].value = me[key] || '';
        baseline = JSON.stringify(identity());
        app.querySelector('#cadreProfileReminder').replaceChildren();
        await onSaved(me);
        show('cadreProfileMessage', 'success', 'Profil disimpan. Identitas pada laporan yang sudah dikirim tetap tersimpan seperti sebelumnya.');
      } catch (error) { show('cadreProfileMessage', 'error', error.message); }
    }));
    const confirmation = pinForm.elements.confirm_pin;
    const checkConfirmation = () => confirmation.setCustomValidity(confirmation.value && confirmation.value !== pinForm.elements.new_pin.value ? 'PIN baru dan pengulangannya harus sama.' : '');
    pinForm.addEventListener('input', checkConfirmation);
    app.querySelectorAll('[data-toggle-pin]').forEach(button => button.addEventListener('click', () => {
      const input = app.querySelector(`#${button.dataset.togglePin}`);
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'Sembunyikan' : 'Tampilkan';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', `${visible ? 'Sembunyikan' : 'Tampilkan'} ${app.querySelector(`label[for="${input.id}"]`).textContent.toLowerCase()}`);
    }));
    pinForm.addEventListener('submit', event => submitForm(event, async () => {
      checkConfirmation();
      if (!pinForm.reportValidity()) return;
      try {
        await api('/api/cadre/change-pin', { method: 'POST', body: JSON.stringify({ current_pin: pinForm.elements.current_pin.value, new_pin: pinForm.elements.new_pin.value }) });
        if (!pinForm.isConnected) return;
        pinForm.reset();
        pinForm.querySelectorAll('input').forEach(input => { input.type = 'password'; });
        pinForm.querySelectorAll('[data-toggle-pin]').forEach(button => {
          button.textContent = 'Tampilkan'; button.setAttribute('aria-pressed', 'false');
          const label = app.querySelector(`label[for="${button.dataset.togglePin}"]`).textContent;
          button.setAttribute('aria-label', `Tampilkan ${label.toLowerCase()}`);
        });
        await onSaved(me);
        show('cadrePinMessage', 'success', 'PIN berhasil diganti. Anda tetap masuk di perangkat ini; sesi lainnya telah berakhir.');
      } catch (error) { show('cadrePinMessage', 'error', error.message); }
    }));
  } catch (error) {
    if (location.hash.split('?')[0] !== '#cadre-profile') return;
    if (error.status === 401 || error.status === 403) return onExpired();
    pageFailure(error, () => renderCadreProfile(options), '#cadre-home');
  }
}
