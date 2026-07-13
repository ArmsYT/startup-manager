(() => {
  'use strict';

  /** État en mémoire */
  let apps = [];
  let reorderMode = false;
  let editingId = null; // id en cours de modification (null = mode ajout)
  let pendingExec = null; // { execPath, name } choisi via le sélecteur de fichier
  let currentIcon = null; // icône (dataURL) actuellement retenue pour la modale
  let deleteTargetId = null;
  let dragSourceId = null;

  // --- Références DOM -------------------------------------------------
  const $list = document.getElementById('app-list');
  const $empty = document.getElementById('empty-state');
  const $autoToggle = document.getElementById('auto-launch-toggle');
  const $btnReorder = document.getElementById('btn-reorder');
  const $btnReorderDone = document.getElementById('btn-reorder-done');
  const $reorderBanner = document.getElementById('reorder-banner');
  const $btnAdd = document.getElementById('btn-add');

  const $modalOverlay = document.getElementById('modal-overlay');
  const $modalTitle = document.getElementById('modal-title');
  const $modalExecPath = document.getElementById('modal-exec-path');
  const $modalName = document.getElementById('modal-name');
  const $modalIconPreview = document.getElementById('modal-icon-preview');
  const $btnPickIcon = document.getElementById('btn-pick-icon');
  const $btnAutoIcon = document.getElementById('btn-auto-icon');
  const $modalArgs = document.getElementById('modal-args');
  const $modalDelay = document.getElementById('modal-delay');
  const $modalError = document.getElementById('modal-error');
  const $btnBrowse = document.getElementById('btn-browse');
  const $btnCancel = document.getElementById('btn-cancel');
  const $btnSave = document.getElementById('btn-save');

  const $confirmOverlay = document.getElementById('confirm-overlay');
  const $confirmText = document.getElementById('confirm-text');
  const $btnConfirmCancel = document.getElementById('btn-confirm-cancel');
  const $btnConfirmDelete = document.getElementById('btn-confirm-delete');

  const $updateOverlay = document.getElementById('update-overlay');
  const $updateTitle = document.getElementById('update-title');
  const $updateText = document.getElementById('update-text');
  const $btnUpdateClose = document.getElementById('btn-update-close');
  const $btnUpdateOpen = document.getElementById('btn-update-open');
  const $btnCheckUpdate = document.getElementById('btn-check-update');
  const $footerVersion = document.getElementById('footer-version');

  // --- Icônes inline ----------------------------------------------------
  const ICONS = {
    drag: `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="5" cy="3" r="1.3" fill="currentColor"/><circle cx="11" cy="3" r="1.3" fill="currentColor"/><circle cx="5" cy="8" r="1.3" fill="currentColor"/><circle cx="11" cy="8" r="1.3" fill="currentColor"/><circle cx="5" cy="13" r="1.3" fill="currentColor"/><circle cx="11" cy="13" r="1.3" fill="currentColor"/></svg>`,
    pencil: `<svg viewBox="0 0 20 20" width="14" height="14"><path d="M14.85 2.85a2.1 2.1 0 0 1 2.97 2.97L7.5 16.14 3 17l.86-4.5L14.85 2.85Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/></svg>`,
    trash: `<svg viewBox="0 0 20 20" width="14" height="14"><path d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.7 10a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`
  };

  // --- Chargement initial ------------------------------------------------
  async function init() {
    const config = await window.api.getConfig();
    apps = config.apps || [];
    $autoToggle.checked = !!config.autoLaunch;
    render();
    loadFooterInfo();
    loadAppVersion();
    runUpdateCheck(false); // vérification silencieuse : popup uniquement si une mise à jour existe
  }

  async function loadAppVersion() {
    try {
      const version = await window.api.getAppVersion();
      if (version) $footerVersion.textContent = 'v' + version;
    } catch (err) {
      console.error('Version indisponible :', err);
    }
  }

  async function loadFooterInfo() {
    try {
      const info = await window.api.getFooterInfo();
      if (!info) return;
      const $footerAvatar = document.getElementById('footer-avatar');
      const $footerName = document.getElementById('footer-name');
      const $footerRepo = document.getElementById('footer-repo');

      if (info.avatarUrl) $footerAvatar.src = info.avatarUrl;
      // Utilise le pseudo affiché sur le profil Gravatar s'il existe, sinon "Arms" par défaut.
      $footerName.textContent = info.displayName || 'Arms';
      if (info.githubRepoUrl) $footerRepo.href = info.githubRepoUrl;
    } catch (err) {
      console.error('Impossible de charger les infos du pied de page :', err);
    }
  }

  // --- Rendu de la liste ---------------------------------------------
  function render() {
    const sorted = [...apps].sort((a, b) => a.order - b.order);
    $list.innerHTML = '';
    $list.classList.toggle('reorder-mode', reorderMode);

    $empty.hidden = sorted.length > 0;

    sorted.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'card' + (item.enabled ? '' : ' disabled');
      li.dataset.id = item.id;
      li.draggable = reorderMode;

      li.innerHTML = `
        <span class="drag-handle">${ICONS.drag}</span>
        <span class="card-order">${index + 1}</span>
        <span class="card-icon">${
          item.icon
            ? `<img src="${item.icon}" alt="" />`
            : (item.name || '?').charAt(0).toUpperCase()
        }</span>
        <span class="card-meta">
          <span class="card-name">${escapeHtml(item.name)}</span>
          <span class="card-path">${escapeHtml(item.execPath)}</span>
          ${item.delay ? `<span class="card-delay">Délai ${item.delay} ms</span>` : ''}
        </span>
        <label class="auto-toggle" style="gap:0">
          <input type="checkbox" class="toggle-enabled" ${item.enabled ? 'checked' : ''} />
          <span class="switch"><span class="knob"></span></span>
        </label>
        <span class="card-actions">
          <button class="icon-btn btn-edit" title="Modifier">${ICONS.pencil}</button>
          <button class="icon-btn danger btn-delete" title="Retirer">${ICONS.trash}</button>
        </span>
      `;

      // Activer / désactiver
      li.querySelector('.toggle-enabled').addEventListener('change', (e) => {
        item.enabled = e.target.checked;
        li.classList.toggle('disabled', !item.enabled);
        persist();
      });

      // Modifier
      li.querySelector('.btn-edit').addEventListener('click', () => openEditModal(item.id));

      // Supprimer
      li.querySelector('.btn-delete').addEventListener('click', () => openDeleteConfirm(item.id));

      // Glisser-déposer (uniquement actif en mode réorganisation)
      li.addEventListener('dragstart', onDragStart);
      li.addEventListener('dragover', onDragOver);
      li.addEventListener('dragleave', onDragLeave);
      li.addEventListener('drop', onDrop);
      li.addEventListener('dragend', onDragEnd);

      $list.appendChild(li);
    });
  }

  function escapeHtml(str = '') {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function persist() {
    window.api.saveApps(apps);
  }

  // --- Mode réorganisation (façon Spotify) ----------------------------
  $btnReorder.addEventListener('click', () => setReorderMode(!reorderMode));
  $btnReorderDone.addEventListener('click', () => setReorderMode(false));

  function setReorderMode(active) {
    reorderMode = active;
    $btnReorder.dataset.active = String(active);
    $reorderBanner.hidden = !active;
    render();
  }

  function onDragStart(e) {
    if (!reorderMode) { e.preventDefault(); return; }
    dragSourceId = e.currentTarget.dataset.id;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e) {
    if (!reorderMode) return;
    e.preventDefault();
    const target = e.currentTarget;
    if (target.dataset.id === dragSourceId) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    target.classList.toggle('drag-over-top', before);
    target.classList.toggle('drag-over-bottom', !before);
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
  }

  function onDrop(e) {
    if (!reorderMode) return;
    e.preventDefault();
    const target = e.currentTarget;
    const targetId = target.dataset.id;
    target.classList.remove('drag-over-top', 'drag-over-bottom');
    if (!dragSourceId || dragSourceId === targetId) return;

    const rect = target.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;

    const sorted = [...apps].sort((a, b) => a.order - b.order);
    const sourceIndex = sorted.findIndex((a) => a.id === dragSourceId);
    const [moved] = sorted.splice(sourceIndex, 1);
    let insertIndex = sorted.findIndex((a) => a.id === targetId);
    if (!before) insertIndex += 1;
    sorted.splice(insertIndex, 0, moved);

    sorted.forEach((a, i) => { a.order = i; });
    apps = sorted;
    persist();
    render();
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drag-over-top, .drag-over-bottom')
      .forEach((el) => el.classList.remove('drag-over-top', 'drag-over-bottom'));
    dragSourceId = null;
  }

  // --- Auto-lancement au démarrage de Windows -------------------------
  $autoToggle.addEventListener('change', async (e) => {
    const desired = e.target.checked;
    const ok = await window.api.setAutoLaunch(desired);
    if (!ok) e.target.checked = !desired; // rollback si échec
  });

  // --- Modale ajout / modification ------------------------------------
  $btnAdd.addEventListener('click', openAddModal);
  $btnCancel.addEventListener('click', closeModal);
  $modalOverlay.addEventListener('click', (e) => { if (e.target === $modalOverlay) closeModal(); });

  function closeAllOverlays() {
    $modalOverlay.hidden = true;
    $confirmOverlay.hidden = true;
    $updateOverlay.hidden = true;
  }

  function updateIconPreview() {
    if (currentIcon) {
      $modalIconPreview.innerHTML = `<img src="${currentIcon}" alt="" />`;
    } else {
      const letter = ($modalName.value || '?').trim().charAt(0).toUpperCase() || '?';
      $modalIconPreview.textContent = letter;
    }
  }

  $modalName.addEventListener('input', () => { if (!currentIcon) updateIconPreview(); });

  function openAddModal() {
    closeAllOverlays();
    editingId = null;
    pendingExec = null;
    currentIcon = null;
    $modalTitle.textContent = 'Ajouter une application';
    $modalExecPath.value = '';
    $modalName.value = '';
    $modalArgs.value = '';
    $modalDelay.value = '0';
    $modalError.hidden = true;
    updateIconPreview();
    $modalOverlay.hidden = false;
  }

  function openEditModal(id) {
    const item = apps.find((a) => a.id === id);
    if (!item) return;
    closeAllOverlays();
    editingId = id;
    pendingExec = { execPath: item.execPath, name: item.name };
    currentIcon = item.icon || null;
    $modalTitle.textContent = 'Modifier l\'application';
    $modalExecPath.value = item.execPath;
    $modalName.value = item.name;
    $modalArgs.value = item.args || '';
    $modalDelay.value = String(item.delay || 0);
    $modalError.hidden = true;
    updateIconPreview();
    $modalOverlay.hidden = false;
  }

  function closeModal() {
    $modalOverlay.hidden = true;
  }

  $btnBrowse.addEventListener('click', async () => {
    const picked = await window.api.pickExecutable();
    if (!picked) return;
    pendingExec = { execPath: picked.execPath, name: picked.name };
    $modalExecPath.value = picked.execPath;
    if (!$modalName.value) $modalName.value = picked.name;
    if (picked.icon) currentIcon = picked.icon; // icône auto trouvée, sauf si l'utilisateur en choisit une manuellement ensuite
    updateIconPreview();
  });

  $btnPickIcon.addEventListener('click', async () => {
    const result = await window.api.pickIcon();
    if (!result || !result.icon) {
      showModalError("Impossible de lire une icône dans ce fichier.");
      return;
    }
    $modalError.hidden = true;
    currentIcon = result.icon;
    updateIconPreview();
  });

  $btnAutoIcon.addEventListener('click', async () => {
    const execPath = $modalExecPath.value.trim();
    if (!execPath) {
      showModalError('Choisissez d\'abord un exécutable.');
      return;
    }
    const result = await window.api.extractIcon(execPath);
    if (!result || !result.icon) {
      showModalError("Aucune icône n'a pu être extraite automatiquement. Choisissez un fichier manuellement.");
      return;
    }
    $modalError.hidden = true;
    currentIcon = result.icon;
    updateIconPreview();
  });

  $btnSave.addEventListener('click', () => {
    const execPath = pendingExec ? pendingExec.execPath : (editingId ? apps.find(a => a.id === editingId).execPath : null);
    const name = $modalName.value.trim();

    if (!execPath) {
      showModalError('Choisissez un exécutable.');
      return;
    }
    if (!name) {
      showModalError('Donnez un nom à cette application.');
      return;
    }

    const args = $modalArgs.value.trim();
    const delay = Math.max(0, parseInt($modalDelay.value, 10) || 0);

    if (editingId) {
      const item = apps.find((a) => a.id === editingId);
      item.execPath = execPath;
      item.name = name;
      item.args = args;
      item.delay = delay;
      item.icon = currentIcon;
    } else {
      apps.push({
        id: 'app-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name,
        execPath,
        args,
        delay,
        enabled: true,
        icon: currentIcon,
        order: apps.length
      });
    }

    persist();
    closeModal();
    render();
  });

  function showModalError(msg) {
    $modalError.textContent = msg;
    $modalError.hidden = false;
  }

  // --- Confirmation de suppression -------------------------------------
  function openDeleteConfirm(id) {
    const item = apps.find((a) => a.id === id);
    if (!item) return;
    closeAllOverlays();
    deleteTargetId = id;
    $confirmText.textContent = `« ${item.name} » ne sera plus lancée au démarrage.`;
    $confirmOverlay.hidden = false;
  }

  $btnConfirmCancel.addEventListener('click', () => { $confirmOverlay.hidden = true; deleteTargetId = null; });
  $confirmOverlay.addEventListener('click', (e) => { if (e.target === $confirmOverlay) { $confirmOverlay.hidden = true; deleteTargetId = null; } });

  $btnConfirmDelete.addEventListener('click', () => {
    if (!deleteTargetId) return;
    apps = apps.filter((a) => a.id !== deleteTargetId);
    apps.sort((a, b) => a.order - b.order).forEach((a, i) => { a.order = i; });
    deleteTargetId = null;
    $confirmOverlay.hidden = true;
    persist();
    render();
  });

  // --- Contrôles de fenêtre ---------------------------------------------
  document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.close());

  // --- Vérification des mises à jour ------------------------------------
  let latestReleaseUrl = null;

  async function runUpdateCheck(showPopupAlways) {
    let result;
    try {
      result = await window.api.checkForUpdates();
    } catch (err) {
      console.error('Vérification des mises à jour impossible :', err);
      if (!showPopupAlways) return;
      result = { status: 'error', message: 'Une erreur inattendue est survenue.' };
    }

    if (result.status === 'update-available') {
      latestReleaseUrl = result.releaseUrl;
      $updateTitle.textContent = 'Mise à jour disponible';
      $updateText.textContent = `La version ${result.latestVersion} est disponible ` +
        `(vous utilisez actuellement la v${result.currentVersion}).`;
      $btnUpdateOpen.hidden = false;
      closeAllOverlays();
      $updateOverlay.hidden = false;
      return;
    }

    if (!showPopupAlways) return; // vérification silencieuse : on ne dérange pas si tout va bien

    latestReleaseUrl = null;
    $btnUpdateOpen.hidden = true;
    if (result.status === 'up-to-date') {
      $updateTitle.textContent = 'Vous êtes à jour';
      $updateText.textContent = `Vous utilisez déjà la dernière version (v${result.currentVersion}).`;
    } else {
      $updateTitle.textContent = 'Vérification impossible';
      $updateText.textContent = result.message || 'Une erreur est survenue pendant la vérification.';
    }
    closeAllOverlays();
    $updateOverlay.hidden = false;
  }

  $btnCheckUpdate.addEventListener('click', () => runUpdateCheck(true));
  $btnUpdateClose.addEventListener('click', () => { $updateOverlay.hidden = true; });
  $updateOverlay.addEventListener('click', (e) => { if (e.target === $updateOverlay) $updateOverlay.hidden = true; });
  $btnUpdateOpen.addEventListener('click', () => {
    if (latestReleaseUrl) window.open(latestReleaseUrl, '_blank');
  });

  init();
})();
