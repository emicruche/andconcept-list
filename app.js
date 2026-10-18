'use strict';

const STORE_KEY = 'andconcept_lists_v1';
const GUEST_KEY = 'andconcept_guest_name';
const RES_KEY = 'andconcept_reservations_v1';
const ADMIN_KEY = 'andconcept_admin_tokens_v1';

const app = document.getElementById('app');

// ---- Détection backend ----
let backendReady = null;
function hasBackend() {
  if (backendReady === null) {
    backendReady = fetch('api/health')
      .then(r => r.ok)
      .catch(() => false);
  }
  return backendReady;
}

// ---- Stockage local ----
function loadLists() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveLists(l) { localStorage.setItem(STORE_KEY, JSON.stringify(l)); }
function loadAdmin() {
  try { return JSON.parse(localStorage.getItem(ADMIN_KEY)) || {}; } catch { return {}; }
}
function saveAdmin(a) { localStorage.setItem(ADMIN_KEY, JSON.stringify(a)); }

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtPrice(p) {
  const n = Number(p);
  if (!n || n <= 0) return 'Prix libre';
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- Routage ----
// #/            : accueil
// #/l/<id>      : ma liste (mode serveur)
// #/e/<token>   : ma liste (mode autonome encodé)
// #/s/<token>   : liste partagée reçue
async function route() {
  const h = location.hash || '#/';
  const shareM = h.match(/^#\/s\/(.+)$/);
  const editM = h.match(/^#\/e\/(.+)$/);
  if (shareM) {
    // Liens serveur (srv:<id>) : pas de base64 à décoder, le contenu
    // vient de l'API. On passe une liste vide en attendant le chargement.
    const srvM = shareM[1].match(/^srv:(.+)$/);
    if (srvM) return renderShared({ name: '', items: [] }, shareM[1]);
    return renderShared(decodeToken(shareM[1]), shareM[1]);
  }
  if (editM) return renderOwnerList(decodeToken(editM[1]), null);
  const listM = h.match(/^#\/l\/([^/]+)$/);
  if (listM && (await hasBackend())) {
    const r = await fetch('api/lists/' + listM[1]).catch(() => null);
    if (r && r.ok) return renderServerList(await r.json());
  }
  renderHome();
}

function headerHtml(sub) {
  return `<div class="header">
    <img class="logo" src="icon.svg" alt="">
    <div style="flex:1;min-width:0"><h1>AndConcept List</h1><div class="subtitle">${esc(sub)}</div></div>
    <select id="lang-select" title="${esc(t('lang_label'))}" aria-label="${esc(t('lang_label'))}" style="align-self:center;border:1px solid var(--violet-light);border-radius:8px;padding:2px 4px;font-size:11px;font-weight:700;background:#fff;color:var(--violet-dark);flex-shrink:0;max-width:52px;-webkit-appearance:none;appearance:none;text-align:center">
      <option value="fr" ${LANG === 'fr' ? 'selected' : ''}>FR</option>
      <option value="nl" ${LANG === 'nl' ? 'selected' : ''}>NL</option>
      <option value="en" ${LANG === 'en' ? 'selected' : ''}>EN</option>
    </select>
  </div>`;
}

function installTip() {
  const sa = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return sa ? '' : `<div class="install-tip"><span>${t('install_tip')}</span></div>`;
}

// ---- Accueil ----
async function renderHome() {
  const online = await hasBackend();
  const lists = loadLists();
  let html = headerHtml(t('subtitleHome')) + installTip();

  html += `<div class="card">
    <h2>${t('new_list_title')}</h2>
    <p class="hint">${t('new_list_hint_a')} <a href="https://andconceptstore.com/" target="_blank" rel="noopener" style="color:var(--rose-dark);font-weight:700">And Concept Store</a> ${t('new_list_hint_b')}</p>
    <label class="field">${t('new_list_label')}</label>
    <input type="text" id="new-list-name" placeholder="${esc(t('new_list_placeholder'))}" maxlength="60">
    <div style="margin-top:14px"><button class="btn btn-primary btn-block" id="create-list-btn">${t('create_list')}</button></div>
  </div>`;

  const entries = Object.values(lists);
  if (entries.length) {
    html += `<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:16px;margin:18px 4px 10px">${t('my_lists')}</h2>`;
    for (const l of entries) {
      const count = l.items.length;
      html += `<div class="card" style="cursor:pointer" data-open="${l.id}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(l.name)}</strong>
          <div style="font-size:12.5px;color:var(--muted)">${t('idea_count', count)}${l.mode === 'server' ? ' · ' + t('synced') : ''}</div></div>
          <span style="color:var(--violet)">›</span>
        </div>
      </div>`;
    }
  }

  if (!online) {
    html += `<div class="reservation-note">ℹ️ Mode autonome : les listes vivent dans le lien de partage. Lancez le serveur (<code>node server/server.js</code>) pour activer la synchronisation multi-appareils.</div>`;
  }

  app.innerHTML = html;

  document.getElementById('create-list-btn').onclick = async () => {
    const name = document.getElementById('new-list-name').value.trim();
    if (!name) return toast(t('give_list_name'));
    if (await hasBackend()) {
      const r = await fetch('api/lists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (r.ok) {
        const { id, adminToken } = await r.json();
        const admins = loadAdmin(); admins[id] = adminToken; saveAdmin(admins);
        const lists = loadLists();
        lists[id] = { id, name, items: [], mode: 'server', createdAt: Date.now() };
        saveLists(lists);
        location.hash = `#/l/${id}`;
      }
    } else {
      const lists = loadLists();
      const id = uid();
      lists[id] = { id, name, items: [], mode: 'local', createdAt: Date.now() };
      saveLists(lists);
      location.hash = `#/e/${encodeToken({ name, items: [] })}|${id}`;
    }
  };

  app.querySelectorAll('[data-open]').forEach(el => el.onclick = () => {
    const l = loadLists()[el.dataset.open];
    if (!l) return;
    location.hash = l.mode === 'server' ? `#/l/${l.id}` : `#/e/${encodeToken(l)}|${l.id}`;
  });
}

// ---- Liste en mode autonome (encodée dans l'URL) ----
function renderOwnerList(payload, listId) {
  const raw = location.hash.match(/^#\/e\/(.+)$/)[1];
  listId = listId || (raw.includes('|') ? raw.split('|')[1] : null);
  let list = payload;
  const lists = loadLists();
  if (listId && lists[listId]) list = lists[listId];
  if (!listId || !lists[listId]) {
    // Liste inconnue en local (lien ouvert depuis un autre appareil/URL) :
    // on l'enregistre pour que les ajouts soient bien persistés.
    listId = listId || uid();
    lists[listId] = { ...list, id: listId, mode: 'local', createdAt: Date.now() };
    saveLists(lists);
    list = lists[listId];
  }

  let html = `<a class="back-link" href="#/">‹ Mes listes</a>` + headerHtml(esc(list.name));

  html += `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <h2 style="margin:0">${esc(list.name)}</h2>
      <button class="btn btn-danger" id="delete-list-btn" style="padding:8px 12px;font-size:13px">${t('delete_list')}</button>
    </div>
    <div class="share-section" style="margin-top:12px">
      <strong style="font-size:14px;color:var(--violet-dark)">${t('share_title')}</strong>
      <p class="hint" style="margin:6px 0 0">${t('share_hint_local')}</p>
      <div class="share-link-box">
        <input type="text" readonly id="share-url" value="${esc(shareUrl(list))}">
        <button class="btn btn-primary" id="copy-btn" style="padding:10px 14px">${t('copy')}</button>
      </div>
      <div style="margin-top:10px"><button class="btn btn-rose btn-block" id="native-share-btn">${t('share_btn')}</button></div>
    </div>
  </div>`;

  html += `<button class="btn btn-primary btn-block" id="add-gift-btn" style="margin-bottom:16px">${t('add_gift')}</button>`;

  if (!list.items.length) {
    html += `<div class="empty-state"><div class="big">🛍️</div>${t('empty_list')}</div>`;
  } else {
    for (const it of list.items) {
      html += `<div class="gift-item" data-id="${it.id}">
        ${it.photo ? `<img class="thumb" src="${it.photo}" alt="">` : `<div class="no-photo">🎁</div>`}
        <div class="info">
          <div class="title">${esc(it.title)}</div>
          <div class="price">${fmtPrice(it.price)}</div>
          ${it.store ? `<div class="meta">📍 ${esc(it.store)}</div>` : ''}
          ${it.note ? `<div class="note">« ${esc(it.note)} »</div>` : ''}
        </div>
        <div class="gift-actions">
          <button class="icon-btn" data-edit="${it.id}" title="Modifier">✏️</button>
          <button class="icon-btn" data-del="${it.id}" title="Supprimer">🗑️</button>
        </div>
      </div>`;
    }
  }
  app.innerHTML = html;

  const persist = () => {
    lists[listId] = list;
    saveLists(lists);
    history.replaceState(null, '', `#/e/${encodeToken(list)}|${listId}`);
  };
  const refresh = () => { persist(); renderOwnerList(list, listId); };

  document.getElementById('delete-list-btn').onclick = () => {
    if (!confirm(t('confirm_delete_local'))) return;
    const lists = loadLists();
    delete lists[listId];
    saveLists(lists);
    location.hash = '#/';
    toast(t('list_deleted'));
  };

  document.getElementById('add-gift-btn').onclick = () => renderEditForm(item => {
    list.items.push(item); refresh(); toast(t('idea_added'));
  });
  app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    list.items = list.items.filter(x => x.id !== b.dataset.del); refresh();
  });
  app.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const item = list.items.find(x => x.id === b.dataset.edit);
    renderEditForm(updated => { Object.assign(item, updated); refresh(); }, item);
  });
  app.querySelectorAll('.gift-item .info').forEach(el => el.onclick = () => {
    const card = el.closest('.gift-item');
    const item = list.items.find(x => x.id === card.dataset.id);
    if (item) renderGiftDetail(item);
  });

  const sUrl = document.getElementById('share-url');
  document.getElementById('copy-btn').onclick = async () => {
    try { await navigator.clipboard.writeText(sUrl.value); toast(t('link_copied')); }
    catch { sUrl.select(); document.execCommand('copy'); toast(t('link_copied')); }
  };
  document.getElementById('native-share-btn').onclick = async () => {
    if (navigator.share) {
      const lightUrl = location.origin + location.pathname + '#/s/' + lightToken(list);
      try {
        await navigator.share({ title: 'AndConcept List', text: t('share_msg', list.name), url: lightUrl });
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        sUrl.value = lightUrl;
        sUrl.select(); document.execCommand('copy');
        toast(t('link_copied_paste'));
      }
    } else { sUrl.select(); document.execCommand('copy'); toast(t('link_copied_paste')); }
  };
}

// ---- Liste en mode serveur (synchronisée) ----
async function renderServerList(list, adminToken) {
  const lists = loadLists();
  if (!adminToken) adminToken = loadAdmin()[list.id];
  let html = `<a class="back-link" href="#/">‹ Mes listes</a>` +
    headerHtml(esc(list.name) + ' · ☁');

  html += `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <h2 style="margin:0">${esc(list.name)}</h2>
      <button class="btn btn-danger" id="delete-list-btn" style="padding:8px 12px;font-size:13px">${t('delete_list')}</button>
    </div>
    <div class="share-section">
      <strong style="font-size:14px;color:var(--violet-dark)">${t('share_title')}</strong>
      <p class="hint" style="margin:6px 0 0">${t('share_hint_server')}</p>
      <div class="share-link-box">
        <input type="text" readonly id="share-url" value="${esc(location.origin + location.pathname + '#/s/srv:' + list.id)}">
        <button class="btn btn-primary" id="copy-btn" style="padding:10px 14px">${t('copy')}</button>
      </div>
      <div style="margin-top:10px"><button class="btn btn-rose btn-block" id="native-share-btn">${t('share_btn')}</button></div>
    </div>
  </div>`;

  html += `<button class="btn btn-primary btn-block" id="add-gift-btn" style="margin-bottom:16px">${t('add_gift')}</button>`;

  if (!list.items.length) {
    html += `<div class="empty-state"><div class="big">🛍️</div>Aucune idée pour l'instant.</div>`;
  } else {
    for (const it of list.items) {
      const reserved = (list.reservedIds || []).includes(it.id);
      html += `<div class="gift-item ${reserved ? 'reserved' : ''}" data-id="${it.id}">
        ${it.photo ? `<img class="thumb" src="${it.photo}" alt="">` : `<div class="no-photo">🎁</div>`}
        <div class="info">
          <div class="title">${esc(it.title)}</div>
          <div class="price">${fmtPrice(it.price)}</div>
          ${it.store ? `<div class="meta">📍 ${esc(it.store)}</div>` : ''}
          ${it.note ? `<div class="note">« ${esc(it.note)} »</div>` : ''}
          ${adminToken ? `<span class="badge ${reserved ? 'reserved' : 'available'}">${reserved ? t('reserved_by_whom') : t('available')}</span>` : ''}
        </div>
        <div class="gift-actions">
          <button class="icon-btn" data-edit="${it.id}" title="Modifier">✏️</button>
          <button class="icon-btn" data-del="${it.id}" title="Supprimer">🗑️</button>
        </div>
      </div>`;
    }
  }
  app.innerHTML = html;

  async function sync() {
    let ok = false;
    try {
      const put = await fetch('api/lists/' + list.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
        body: JSON.stringify({ items: list.items })
      });
      ok = put.ok;
    } catch { ok = false; }
    if (!ok) {
      // Le serveur n'a pas confirmé : on garde l'écran tel quel (l'idée est
      // déjà dans list.items) et on avertit plutôt que de tout effacer.
      toast(t('server_unreachable'));
      renderServerList({ ...list, reservedIds: [] }, adminToken);
      return;
    }
    const r = await fetch('api/lists/' + list.id);
    if (r.ok) {
      const fresh = await r.json();
      // Mettre à jour la copie locale (nom + idées) pour que l'accueil
      // affiche le bon compte d'idées et survive hors-ligne.
      const lists = loadLists();
      lists[list.id] = { ...(lists[list.id] || {}), id: list.id, name: fresh.name, items: fresh.items, mode: 'server' };
      saveLists(lists);
      renderServerList(fresh, adminToken);
    }
  }

  document.getElementById('add-gift-btn').onclick = () => renderEditForm(async item => {
    list.items.push(item); await sync(); toast(t('idea_added_sync'));
  });
  app.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    list.items = list.items.filter(x => x.id !== b.dataset.del); await sync();
  });
  app.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const item = list.items.find(x => x.id === b.dataset.edit);
    renderEditForm(async updated => { Object.assign(item, updated); await sync(); }, item);
  });
  app.querySelectorAll('.gift-item .info').forEach(el => el.onclick = () => {
    const card = el.closest('.gift-item');
    const item = list.items.find(x => x.id === card.dataset.id);
    if (item) renderGiftDetail(item, { reserved: (list.reservedIds || []).includes(item.id) });
  });

  const sUrl = document.getElementById('share-url');
  document.getElementById('copy-btn').onclick = async () => {
    try { await navigator.clipboard.writeText(sUrl.value); toast(t('link_copied')); }
    catch { sUrl.select(); document.execCommand('copy'); toast(t('link_copied')); }
  };
  const nativeBtn = document.getElementById('native-share-btn');
  if (nativeBtn) nativeBtn.onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'AndConcept List', text: t('share_msg', list.name), url: sUrl.value });
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        sUrl.select(); document.execCommand('copy');
        toast(t('share_fallback'));
      }
    } else {
      sUrl.select(); document.execCommand('copy');
      toast(t('link_copied_paste'));
    }
  };

  document.getElementById('delete-list-btn').onclick = async () => {
    if (!confirm(t('confirm_delete'))) return;
    if (adminToken) {
      await fetch('api/lists/' + list.id, {
        method: 'DELETE', headers: { 'X-Admin-Token': adminToken }
      }).catch(() => {});
    }
    const lists = loadLists();
    delete lists[list.id];
    saveLists(lists);
    const admins = loadAdmin();
    delete admins[list.id];
    saveAdmin(admins);
    location.hash = '#/';
    toast(t('list_deleted'));
  };
}

// ---- Formulaire article (commun) ----
// ---- Fiche détail d'une idée ----
function renderGiftDetail(item, opts = {}) {
  const overlay = document.createElement('div');
  overlay.id = 'detail-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(58,26,158,0.55);z-index:60;display:flex;align-items:flex-end;justify-content:center';
  overlay.innerHTML = `<div style="background:#fff;width:100%;max-width:560px;border-radius:20px 20px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:18px;margin:0">${esc(item.title)}</h2>
      <button class="icon-btn" id="close-detail" style="font-size:20px">✕</button>
    </div>
    ${item.photo ? `<img src="${item.photo}" alt="" style="width:100%;max-height:300px;object-fit:contain;border-radius:14px;background:#f7f3ee;margin-bottom:12px">` : ''}
    <div style="font-size:17px;font-weight:800;color:var(--rose-dark);margin-bottom:6px">${fmtPrice(item.price)}</div>
    ${item.store ? `<div style="font-size:14px;color:var(--text);margin-bottom:4px">📍 ${esc(item.store)}</div>` : ''}
    ${item.note ? `<div style="font-size:14px;color:var(--muted);font-style:italic;margin:8px 0">« ${esc(item.note)} »</div>` : ''}
    ${opts.reserved ? `<span class="badge reserved">${t('reserved')}</span>` : `<span class="badge available">${t('available')}</span>`}
    <button class="btn btn-secondary btn-block" id="close-detail-btn" style="margin-top:16px">${t('close')}</button>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#close-detail').onclick = close;
  overlay.querySelector('#close-detail-btn').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function renderEditForm(onSave, existing) {
  const isEdit = !!existing;
  const overlay = document.createElement('div');
  overlay.innerHTML = `<div style="position:fixed;inset:0;background:rgba(214,49,99,0.45);z-index:50;display:flex;align-items:flex-end;justify-content:center" id="form-overlay">
    <div style="background:#fff;width:100%;max-width:560px;border-radius:20px 20px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto">
      <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:17px;margin-bottom:6px">${isEdit ? t('edit_idea') : t('new_idea')}</h2>
      <label class="field">${t('photo_label')}</label>
      <label class="photo-box" for="photo-input">
        ${t('take_photo')}
        <input type="file" id="photo-input" accept="image/*" capture="environment">
      </label>
      <div id="photo-preview"></div>
      <label class="field">${t('title_label')}</label>
      <input type="text" id="f-title" placeholder="${esc(t('title_placeholder'))}" maxlength="80" value="${esc(existing?.title || '')}">
      <label class="field">${t('price_label')}</label>
      <input type="number" id="f-price" placeholder="Ex. 25" min="0" step="0.01" inputmode="decimal" value="${existing?.price ?? ''}">
      <label class="field">${t('store_label')}</label>
      <input type="text" id="f-store" placeholder="${esc(t('store_placeholder'))}" maxlength="80" value="${esc(existing?.store || '')}">
      <label class="field">${t('note_label')}</label>
      <textarea id="f-note" placeholder="${esc(t('note_placeholder'))}" maxlength="200">${esc(existing?.note || '')}</textarea>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn btn-secondary" id="cancel-btn" style="flex:1">${t('cancel')}</button>
        <button class="btn btn-primary" id="save-btn" style="flex:1">${isEdit ? t('save_edit') : t('save_new')}</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  let photo = existing?.photo || null;
  const preview = overlay.querySelector('#photo-preview');
  const showPreview = () => {
    preview.innerHTML = photo
      ? `<div class="photo-preview"><img src="${photo}" alt=""><button class="remove-photo" id="rm-photo">✕</button></div>`
      : '';
    if (photo) preview.querySelector('#rm-photo').onclick = () => { photo = null; showPreview(); };
  };
  showPreview();

  overlay.querySelector('#photo-input').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const max = 600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      photo = canvas.toDataURL('image/jpeg', 0.7);
      showPreview();
    };
    img.src = URL.createObjectURL(f);
    e.target.value = '';
  };

  const close = () => overlay.remove();
  overlay.querySelector('#cancel-btn').onclick = close;
  overlay.addEventListener('click', e => { if (e.target.id === 'form-overlay') close(); });

  overlay.querySelector('#save-btn').onclick = () => {
    const title = overlay.querySelector('#f-title').value.trim();
    if (!title) return toast(t('give_item_name'));
    const price = parseFloat(overlay.querySelector('#f-price').value);
    onSave({
      id: existing?.id || uid(),
      title,
      price: price > 0 ? price : null,
      store: overlay.querySelector('#f-store').value.trim(),
      note: overlay.querySelector('#f-note').value.trim(),
      photo
    });
    close();
  };
}

// ---- Tokens autonomes ----
function encodeToken(list) {
  const payload = { n: list.name, i: list.items.map(it => ({ t: it.title, p: it.price, s: it.store, o: it.note, ph: it.photo })) };
  let b64;
  try {
    b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch {
    // Trop volumineux (photos) : réessayer sans les photos du tout.
    const light = { n: list.name, i: payload.i.map(x => ({ ...x, ph: null })) };
    b64 = btoa(unescape(encodeURIComponent(JSON.stringify(light))));
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function lightToken(list) {
  // Version compacte pour les partageurs stricts (WhatsApp, SMS…) : miniatures minuscules.
  const items = list.items.map(it => ({ t: it.title, p: it.price, s: it.store, o: it.note, ph: shrinkPhoto(it.photo, 96, 0.45) }));
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ n: list.name, i: items }))));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function shrinkPhoto(dataUrl, max, quality) {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return null;
  try {
    const img = new Image();
    img.src = dataUrl;
    if (!img.width || !img.height) return null;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch { return null; }
}

function decodeToken(token) {
  try {
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return {
      name: payload.n || 'Liste de cadeaux',
      items: (payload.i || []).map((it, idx) => ({ id: 'i' + idx, title: it.t, price: it.p, store: it.s, note: it.o, photo: it.ph }))
    };
  } catch { return null; }
}

function shareUrl(list) {
  return location.origin + location.pathname + '#/s/' + encodeToken(list);
}

// ---- Vue partagée (proches) ----
async function renderShared(list, token) {
  if (!list) {
    app.innerHTML = headerHtml(t('invalid_title')) +
      `<div class="empty-state"><div class="big">😕</div>${t('invalid_link')}</div>`;
    return;
  }

  const serverM = token.match(/^srv:(.+)$/);
  let serverList = null, adminToken = null;
  if (serverM && (await hasBackend())) {
    const r = await fetch('api/lists/' + serverM[1]);
    if (r.ok) serverList = await r.json();
  }

  const resKey = 't_' + token.slice(0, 32);
  const reservations = JSON.parse(localStorage.getItem(RES_KEY) || '{}')[resKey] || {};
  let currentFilter = null;
  const guestName = localStorage.getItem(GUEST_KEY) || '';

  async function reserve(itemId) {
    const name = prompt(t('your_name'), guestName);
    if (name === null) return;
    const n = name.trim() || t('someone');
    localStorage.setItem(GUEST_KEY, n);
    if (serverList) {
      await fetch(`api/lists/${serverList.id}/reserve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, by: n })
      });
      const r = await fetch('api/lists/' + serverList.id);
      if (r.ok) { serverList = await r.json(); render(); toast(t('reserved_secret')); return; }
    }
    reservations[itemId] = { name: n, ts: Date.now() };
    const all = JSON.parse(localStorage.getItem(RES_KEY) || '{}');
    all[resKey] = reservations;
    localStorage.setItem(RES_KEY, JSON.stringify(all));
    render();
    toast(t('reserved_secret'));
  }

  function render() {
    const res = serverList
      ? Object.fromEntries((serverList.reservedIds || []).map(id => [id, true]))
      : reservations;
    const items = serverList ? serverList.items : list.items;
    const visible = currentFilter
      ? items.filter(it => !res[it.id] && it.price && it.price <= currentFilter)
      : items;

    let html = headerHtml(t('guest_header', serverList?.name || list.name));
    const myAdmin = serverList ? loadAdmin()[serverList.id] : null;
    if (myAdmin) {
      html += `<button class="btn btn-primary btn-block" id="open-as-owner-btn" style="margin-bottom:14px">${t('open_owner')}</button>`;
    }
    html += `<div class="card">
      <h2>${esc(t('guest_card', serverList?.name || list.name))}</h2>
      <p class="hint">${t('guest_hint')}</p>
      <div class="budget-filter">
        <input type="number" id="budget-input" placeholder="${esc(t('budget_placeholder'))}" min="0" step="1" inputmode="decimal" value="${currentFilter ?? ''}">
        <button class="chip ${!currentFilter ? 'active' : ''}" data-budget="">${t('all')}</button>
        <button class="chip" data-budget="20">≤ 20 €</button>
        <button class="chip" data-budget="50">≤ 50 €</button>
      </div>`;

    if (currentFilter) {
      const ok = visible.length;
      html += `<div class="result-line">${t('still_available', ok)} <strong>${t('available').toLowerCase()}</strong> ${currentFilter} €</div>`;
    }

    if (!items.length) {
      html += `<div class="empty-state"><div class="big">📭</div>${t('empty_shared')}</div>`;
    } else if (!visible.length && currentFilter) {
      html += `<div class="empty-state"><div class="big">🤷</div>${t('no_match_budget')}</div>`;
    } else {
      for (const it of visible) {
        const r = res[it.id];
        html += `<div class="gift-item ${r ? 'reserved' : ''}" data-id="${it.id}">
          ${it.photo ? `<img class="thumb" src="${it.photo}" alt="">` : `<div class="no-photo">🎁</div>`}
          <div class="info">
            <div class="title">${esc(it.title)}</div>
            <div class="price">${fmtPrice(it.price)}</div>
            ${it.store ? `<div class="meta">📍 ${esc(it.store)}</div>` : ''}
            ${it.note ? `<div class="note">« ${esc(it.note)} »</div>` : ''}
            <span class="badge ${r ? 'reserved' : 'available'}">${r ? t('reserved') : t('available')}</span>
          </div>
          <div class="gift-actions">
            ${r
              ? (reservations[it.id] ? `<button class="btn btn-danger" data-unres="${it.id}" style="padding:8px 12px;font-size:13px">${t('unreserve')}</button>` : '')
              : `<button class="btn btn-rose" data-res="${it.id}" style="padding:8px 12px;font-size:13px">${t('reserve')}</button>`}
          </div>
        </div>`;
      }
    }
    html += `</div>`;
    if (Object.keys(res).length) {
      html += `<div class="reservation-note">${t('secret_note')}</div>`;
    }
    app.innerHTML = html;

    const input = document.getElementById('budget-input');
    input.oninput = () => {
      const v = parseFloat(input.value);
      currentFilter = v > 0 ? v : null;
      render();
      const el = document.getElementById('budget-input');
      el.focus(); el.setSelectionRange(el.value.length, el.value.length);
    };
    app.querySelectorAll('[data-budget]').forEach(c => c.onclick = () => {
      currentFilter = c.dataset.budget ? parseFloat(c.dataset.budget) : null;
      render();
    });
    const ownerBtn = document.getElementById('open-as-owner-btn');
    if (ownerBtn) ownerBtn.onclick = () => { location.hash = '#/l/' + serverList.id; };
    app.querySelectorAll('.gift-item .info').forEach(el => el.onclick = () => {
      const card = el.closest('.gift-item');
      const items = serverList ? serverList.items : list.items;
      const item = items.find(x => x.id === card.dataset.id);
      if (item) renderGiftDetail(item, { reserved: !!res[item.id] });
    });
    app.querySelectorAll('[data-res]').forEach(b => b.onclick = () => reserve(b.dataset.res));
    app.querySelectorAll('[data-unres]').forEach(b => b.onclick = () => {
      delete reservations[b.dataset.unres];
      const all = JSON.parse(localStorage.getItem(RES_KEY) || '{}');
      all[resKey] = reservations;
      localStorage.setItem(RES_KEY, JSON.stringify(all));
      render();
    });
  }
  render();
}

// ---- Démarrage ----
// Délégation d'événement: un seul listener permanent sur le document,
// insensible aux re-rendus de l'interface et fiable sur iOS Safari.
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'lang-select') setLang(e.target.value);
});

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
