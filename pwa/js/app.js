/**
 * Contrôleur principal de la PWA Android "Courses Famille — Google Keep".
 */

(function () {
  'use strict';

  const {
    ShoppingStorage,
    AuthRequiredError,
    DEFAULT_KEEP_URL,
    saveConfig,
    loadCachedList,
    buildInviteUrl,
    consumeInviteFromHash,
    formatFirstName,
    clampQuantity,
  } = window.CoursesStorage;

  const { VoiceDictation, vibrate } = window.CoursesSpeech;

  const storage = new ShoppingStorage();

  // État applicatif
  const state = {
    list: {
      mode: 'demo',
      title: 'Liste de courses',
      keep_url: DEFAULT_KEEP_URL,
      updated_at: null,
      items: [],
    },
    checkedExpanded: true,
    syncing: false,
    editingItemId: null,
    recentlyAddedId: null,
    deferredInstallPrompt: null,
    toastTimer: null,
    pollTimer: null,
    pendingDelete: null,
    pendingQtyUpdates: {},
    nameBannerDismissed: false,
    gsiScriptLoaded: false,
  };

  // Références DOM
  const els = {
    listTitle: document.getElementById('list-title'),
    modeBadge: document.getElementById('mode-badge'),
    syncStatus: document.getElementById('sync-status'),
    keepExternalLink: document.getElementById('keep-external-link'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnShare: document.getElementById('btn-share'),
    btnSettings: document.getElementById('btn-settings'),

    installBanner: document.getElementById('install-banner'),
    btnInstallPwa: document.getElementById('btn-install-pwa'),
    btnDismissInstall: document.getElementById('btn-dismiss-install'),

    nameBanner: document.getElementById('name-banner'),
    nameBannerInput: document.getElementById('name-banner-input'),
    btnDismissName: document.getElementById('btn-dismiss-name'),

    uncheckedCount: document.getElementById('unchecked-count'),
    uncheckedList: document.getElementById('unchecked-list'),
    emptyState: document.getElementById('empty-state'),
    checkedSection: document.getElementById('checked-section'),
    checkedCountLabel: document.getElementById('checked-count-label'),
    checkedList: document.getElementById('checked-list'),
    btnToggleChecked: document.getElementById('btn-toggle-checked'),
    btnUncheckAll: document.getElementById('btn-uncheck-all'),
    btnClearChecked: document.getElementById('btn-clear-checked'),

    voiceLiveBar: document.getElementById('voice-live-bar'),
    voiceStatusLabel: document.getElementById('voice-status-label'),
    voiceInterimText: document.getElementById('voice-interim-text'),
    btnCancelVoice: document.getElementById('btn-cancel-voice'),

    bottomDock: document.getElementById('bottom-dock'),
    quickAddForm: document.getElementById('quick-add-form'),
    quickAddInput: document.getElementById('quick-add-input'),
    btnFlipMic: document.getElementById('btn-flip-mic'),
    btnMic: document.getElementById('btn-mic'),

    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message'),
    toastAction: document.getElementById('toast-action'),

    // Modale Réglages
    modalSettings: document.getElementById('modal-settings'),
    settingsForm: document.getElementById('settings-form'),
    prefUserName: document.getElementById('pref-user-name'),
    googleSigninWrap: document.getElementById('google-signin-wrap'),
    googleSigninBtn: document.getElementById('google-signin-btn'),
    prefSpeechLang: document.getElementById('pref-speech-lang'),
    prefFeedback: document.getElementById('pref-feedback'),
    cfgMode: document.getElementById('cfg-mode'),
    cfgUrlGroup: document.getElementById('cfg-url-group'),
    cfgUrl: document.getElementById('cfg-url'),
    cfgUrlHelp: document.getElementById('cfg-url-help'),
    cfgPinGroup: document.getElementById('cfg-pin-group'),
    cfgPin: document.getElementById('cfg-pin'),
    cfgGoogleClientId: document.getElementById('cfg-google-client-id'),
    btnTestConnection: document.getElementById('btn-test-connection'),

    // Modale Partage
    modalShare: document.getElementById('modal-share'),
    shareIncludePin: document.getElementById('share-include-pin'),
    shareLinkInput: document.getElementById('share-link-input'),
    btnNativeShare: document.getElementById('btn-native-share'),
    btnCopyShare: document.getElementById('btn-copy-share'),

    // Modale PIN
    modalPin: document.getElementById('modal-pin'),
    pinForm: document.getElementById('pin-form'),
    pinUnlockInput: document.getElementById('pin-unlock-input'),
    pinError: document.getElementById('pin-error'),
    btnPinSettings: document.getElementById('btn-pin-settings'),
  };

  /* ==========================================================================
     Utilitaires UI : Thème, Position du micro, Toasts, Modales, Prénom Google
     ========================================================================== */
  function applyTheme(themePref) {
    let resolved = themePref;
    if (themePref === 'auto') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', resolved === 'dark' ? '#141715' : '#2D6A4F');
    }
  }

  function applyMicSide(side) {
    const validSide = side === 'left' ? 'left' : 'right';
    els.bottomDock.setAttribute('data-mic-side', validSide);
    document.querySelectorAll('[data-mic-choice]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.micChoice === validSide);
    });
  }

  function updateNameBanner() {
    const hasName = Boolean(formatFirstName(storage.config.userName));
    els.nameBanner.classList.toggle('hidden', hasName || state.nameBannerDismissed);
  }

  function decodeGoogleJwtFirstName(credential) {
    try {
      const parts = String(credential || '').split('.');
      if (parts.length < 2) return '';
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      return formatFirstName(payload.given_name || payload.name || '');
    } catch (_) {
      return '';
    }
  }

  function renderGoogleSignInButton() {
    const clientId = (storage.config.googleClientId || '').trim();
    if (!clientId) {
      els.googleSigninWrap.classList.add('hidden');
      return;
    }
    els.googleSigninWrap.classList.remove('hidden');

    const mount = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) return;
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => {
            const firstName = decodeGoogleJwtFirstName(resp && resp.credential);
            if (firstName) {
              storage.config = saveConfig({ userName: firstName });
              els.prefUserName.value = firstName;
              updateNameBanner();
              showToast(`Prénom Google récupéré : ${firstName}`);
            }
          },
        });
        els.googleSigninBtn.innerHTML = '';
        window.google.accounts.id.renderButton(els.googleSigninBtn, {
          theme: 'outline',
          size: 'medium',
          text: 'continue_with',
          locale: 'fr',
        });
      } catch (_) {}
    };

    if (window.google && window.google.accounts && window.google.accounts.id) {
      mount();
      return;
    }

    if (!state.gsiScriptLoaded) {
      state.gsiScriptLoaded = true;
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = mount;
      document.head.appendChild(script);
    }
  }

  function showToast(message, options) {
    const opts = options || {};
    clearTimeout(state.toastTimer);
    els.toastMessage.textContent = message;

    if (opts.actionLabel && typeof opts.onAction === 'function') {
      els.toastAction.textContent = opts.actionLabel;
      els.toastAction.classList.remove('hidden');
      els.toastAction.classList.toggle('toast-cross', Boolean(opts.isCross));
      els.toastAction.setAttribute('aria-label', opts.actionAriaLabel || opts.actionLabel);
      els.toastAction.title = opts.actionAriaLabel || opts.actionLabel;
      els.toastAction.onclick = () => {
        hideToast();
        opts.onAction();
      };
    } else {
      els.toastAction.classList.add('hidden');
      els.toastAction.classList.remove('toast-cross');
      els.toastAction.onclick = null;
    }

    els.toast.classList.remove('hidden');
    state.toastTimer = setTimeout(hideToast, opts.duration || 3600);
  }

  function hideToast() {
    clearTimeout(state.toastTimer);
    els.toast.classList.add('hidden');
  }

  function openModal(modalEl) {
    modalEl.classList.remove('hidden');
  }

  function closeModal(modalEl) {
    modalEl.classList.add('hidden');
  }

  function formatSyncTime(isoString) {
    if (!isoString) return 'Synchronisé';
    try {
      const d = new Date(isoString);
      return (
        'Synchro à ' +
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      );
    } catch (_) {
      return 'Synchronisé';
    }
  }

  function updateModeBadge(mode) {
    const labels = {
      keep: 'Google Keep',
      'apps-script': 'Google Sheets',
      demo: 'Démo local',
    };
    els.modeBadge.dataset.mode = mode;
    els.modeBadge.textContent = labels[mode] || mode;
  }

  /* ==========================================================================
     Rendu de la liste de courses
     ========================================================================== */
  function createItemElement(item) {
    const li = document.createElement('li');
    li.className = 'item-card' + (item.checked ? ' checked' : '');
    if (state.recentlyAddedId === item.id) {
      li.classList.add('entering');
    }
    li.dataset.id = item.id;

    // Bouton case à cocher
    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'check-btn';
    checkBtn.setAttribute(
      'aria-label',
      item.checked ? `Remettre ${item.text} à acheter` : `Cocher ${item.text}`
    );
    checkBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    checkBtn.addEventListener('click', () => handleToggleItem(item));

    // Zone texte (ou édition inline)
    const textWrap = document.createElement('div');
    textWrap.className = 'item-text-wrap';

    if (state.editingItemId === item.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'item-edit-input';
      input.value = item.text;
      input.maxLength = 140;

      const commitEdit = async () => {
        const nextText = input.value.trim();
        state.editingItemId = null;
        if (nextText && nextText !== item.text) {
          await handleRenameItem(item, nextText);
        } else {
          renderList();
        }
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit();
        } else if (e.key === 'Escape') {
          state.editingItemId = null;
          renderList();
        }
      });
      input.addEventListener('blur', commitEdit);
      textWrap.appendChild(input);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    } else {
      const span = document.createElement('span');
      span.className = 'item-text';
      span.textContent = item.text;
      span.title = 'Toucher pour modifier';
      span.addEventListener('click', () => {
        state.editingItemId = item.id;
        renderList();
      });
      textWrap.appendChild(span);
    }

    // Prénom discret de la personne ayant ajouté l'article
    const authorName = formatFirstName(item.added_by || '');
    const authorEl = authorName ? document.createElement('span') : null;
    if (authorEl) {
      authorEl.className = 'item-author';
      authorEl.textContent = authorName;
      authorEl.title = `Ajouté par ${authorName}`;
    }

    // Bouton compteur de quantité : tap -> 1x..12x, appui maintenu 1,5s -> 1x
    const qty = clampQuantity(item.quantity);
    const qtyBtn = document.createElement('button');
    qtyBtn.type = 'button';
    qtyBtn.className = 'qty-btn' + (qty > 1 ? ' multi' : '');
    qtyBtn.setAttribute('aria-label', `Quantité : ${qty}x. Appuyer pour augmenter, maintenir 1,5 seconde pour revenir à 1x`);
    qtyBtn.title = 'Appuyer : +1 (jusqu’à 12x) · Maintenir 1,5 s : 1x';
    const qtyLabel = document.createElement('span');
    qtyLabel.textContent = `${qty}x`;
    qtyBtn.appendChild(qtyLabel);

    let holdTimer = null;
    let holdTriggered = false;
    let pointerActive = false;

    const clearHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      qtyBtn.classList.remove('holding');
    };

    qtyBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    qtyBtn.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      pointerActive = true;
      holdTriggered = false;
      try {
        qtyBtn.setPointerCapture(e.pointerId);
      } catch (_) {}

      const currentQty = clampQuantity(item.quantity);
      if (currentQty > 1) {
        // Force reflow pour redémarrer proprement la barre de maintien 1,5s
        qtyBtn.classList.remove('holding');
        void qtyBtn.offsetWidth;
        qtyBtn.classList.add('holding');
      }

      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!pointerActive) return;
        holdTriggered = true;
        qtyBtn.classList.remove('holding');
        handleSetQuantity(item, 1, true, qtyBtn, qtyLabel);
      }, 1500);
    });

    qtyBtn.addEventListener('pointerup', (e) => {
      if (!pointerActive) return;
      pointerActive = false;
      clearHold();
      try {
        qtyBtn.releasePointerCapture(e.pointerId);
      } catch (_) {}

      if (holdTriggered) {
        holdTriggered = false;
        return;
      }
      const currentQty = clampQuantity(item.quantity);
      if (currentQty < 12) {
        handleSetQuantity(item, currentQty + 1, false, qtyBtn, qtyLabel);
      } else {
        vibrate(10, storage.config.feedback);
      }
    });

    qtyBtn.addEventListener('pointercancel', () => {
      pointerActive = false;
      holdTriggered = false;
      clearHold();
    });

    // Support clavier (accessibilité : Entrée / Espace incrémente)
    qtyBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const currentQty = clampQuantity(item.quantity);
        if (currentQty < 12) handleSetQuantity(item, currentQty + 1, false, qtyBtn, qtyLabel);
      }
    });

    // Bouton supprimer
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'item-delete-btn';
    delBtn.setAttribute('aria-label', `Supprimer ${item.text}`);
    delBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    delBtn.addEventListener('click', () => handleDeleteItem(item));

    if (authorEl) {
      li.append(checkBtn, textWrap, authorEl, qtyBtn, delBtn);
    } else {
      li.append(checkBtn, textWrap, qtyBtn, delBtn);
    }
    return li;
  }

  function renderList() {
    const items = Array.isArray(state.list.items) ? state.list.items : [];
    const unchecked = items.filter((it) => !it.checked);
    const checked = items.filter((it) => it.checked);

    els.listTitle.textContent = state.list.title || 'Liste de courses';
    updateModeBadge(state.list.mode || storage.config.mode);

    if (state.list.keep_url) {
      els.keepExternalLink.href = state.list.keep_url;
    }

    const n = unchecked.length;
    els.uncheckedCount.textContent =
      n === 0
        ? 'Aucun article à acheter'
        : n === 1
        ? '1 article à acheter'
        : `${n} articles à acheter`;

    els.uncheckedList.innerHTML = '';
    unchecked.forEach((item) => els.uncheckedList.appendChild(createItemElement(item)));
    els.emptyState.classList.toggle('hidden', unchecked.length > 0);

    if (checked.length > 0) {
      els.checkedSection.classList.remove('hidden');
      els.checkedCountLabel.textContent = `Dans le panier (${checked.length})`;
      els.btnToggleChecked.setAttribute('aria-expanded', String(state.checkedExpanded));
      els.checkedList.classList.toggle('hidden', !state.checkedExpanded);
      els.checkedList.innerHTML = '';
      checked.forEach((item) => els.checkedList.appendChild(createItemElement(item)));
    } else {
      els.checkedSection.classList.add('hidden');
    }

    state.recentlyAddedId = null;
  }

  /* ==========================================================================
     Synchronisation & Actions CRUD
     ========================================================================== */
  async function syncList(options) {
    const opts = options || {};
    if (state.syncing) return;
    state.syncing = true;
    els.btnRefresh.classList.add('spinning');
    if (!opts.silent) {
      els.syncStatus.textContent = 'Synchronisation…';
    }

    try {
      const data = await storage.getList(Boolean(opts.force));
      state.list = data;
      renderList();
      els.syncStatus.textContent = formatSyncTime(data.updated_at);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        els.syncStatus.textContent = 'Verrouillé par Code PIN';
        openPinModal();
      } else if (!opts.silent) {
        els.syncStatus.textContent = 'Hors ligne (cache affiché)';
        showToast(err.message || 'Impossible de joindre le serveur.');
      }
    } finally {
      state.syncing = false;
      els.btnRefresh.classList.remove('spinning');
    }
  }

  async function handleAddItem(rawText, source) {
    const text = rawText.trim();
    if (!text) return;

    try {
      els.syncStatus.textContent = 'Ajout en cours…';
      const result = await storage.addItem(text);
      if (result.list) state.list = result.list;
      if (result.item) state.recentlyAddedId = result.item.id;
      renderList();
      els.syncStatus.textContent = formatSyncTime(state.list.updated_at);

      if (result.action === 'unchecked_existing') {
        showToast(`« ${result.item.text} » remis dans la liste !`);
      } else if (result.action === 'already_exists') {
        showToast(`« ${result.item.text} » est déjà dans la liste.`);
      } else if (result.item) {
        const addedItem = result.item;
        const prefix = source === 'voice' ? 'Dicté : ' : 'Ajouté : ';
        showToast(`${prefix}« ${addedItem.text} »`, {
          actionLabel: 'Annuler',
          duration: 4500,
          onAction: () => handleDeleteItem(addedItem, true),
        });
      }
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        openPinModal();
      } else {
        showToast(err.message || "Erreur lors de l'ajout.");
      }
    }
  }

  async function handleToggleItem(item) {
    const nextChecked = !item.checked;
    vibrate(15, storage.config.feedback);

    // Mise à jour optimiste pour une réactivité instantanée sur mobile
    item.checked = nextChecked;
    renderList();

    try {
      const res = await storage.updateItem(item.id, { checked: nextChecked });
      if (res.list) {
        state.list = res.list;
        renderList();
      }
      els.syncStatus.textContent = formatSyncTime(state.list.updated_at);
    } catch (err) {
      item.checked = !nextChecked;
      renderList();
      if (err instanceof AuthRequiredError) openPinModal();
      else showToast(err.message || 'Impossible de mettre à jour.');
    }
  }

  async function handleRenameItem(item, nextText) {
    const prev = item.text;
    item.text = nextText;
    renderList();

    try {
      const res = await storage.updateItem(item.id, { text: nextText });
      if (res.list) {
        state.list = res.list;
        renderList();
      }
      els.syncStatus.textContent = formatSyncTime(state.list.updated_at);
    } catch (err) {
      item.text = prev;
      renderList();
      showToast(err.message || 'Erreur lors de la modification.');
    }
  }

  async function commitQuantityUpdate(itemId) {
    const entry = state.pendingQtyUpdates[itemId];
    if (!entry) return;
    clearTimeout(entry.timer);
    delete state.pendingQtyUpdates[itemId];

    try {
      const res = await storage.updateItem(itemId, { quantity: entry.nextQty });
      // Ne ré-écrase pas la liste si un autre tap rapide est déjà en attente
      if (res.list && Object.keys(state.pendingQtyUpdates).length === 0 && !state.pendingDelete) {
        state.list = res.list;
        renderList();
      }
      els.syncStatus.textContent = formatSyncTime(state.list.updated_at);
    } catch (err) {
      entry.item.quantity = entry.prevQty;
      renderList();
      if (err instanceof AuthRequiredError) openPinModal();
      else showToast(err.message || 'Impossible de mettre à jour la quantité.');
    }
  }

  function flushPendingQuantities() {
    Object.keys(state.pendingQtyUpdates).forEach((itemId) => {
      commitQuantityUpdate(itemId);
    });
  }

  function handleSetQuantity(item, targetQty, isReset, btnEl, labelEl) {
    const prevQty = clampQuantity(item.quantity);
    const nextQty = clampQuantity(targetQty);
    if (nextQty === prevQty) {
      if (isReset) vibrate(15, storage.config.feedback);
      return;
    }

    if (isReset) {
      vibrate([30, 40, 20], storage.config.feedback);
    } else {
      vibrate(12, storage.config.feedback);
    }

    item.quantity = nextQty;
    if (btnEl && labelEl) {
      labelEl.textContent = `${nextQty}x`;
      btnEl.classList.toggle('multi', nextQty > 1);
      btnEl.setAttribute(
        'aria-label',
        `Quantité : ${nextQty}x. Appuyer pour augmenter, maintenir 1,5 seconde pour revenir à 1x`
      );
    } else {
      renderList();
    }

    const existing = state.pendingQtyUpdates[item.id];
    const originalPrev = existing ? existing.prevQty : prevQty;
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      commitQuantityUpdate(item.id);
    }, 450);

    state.pendingQtyUpdates[item.id] = {
      item,
      prevQty: originalPrev,
      nextQty,
      timer,
    };
  }

  async function flushPendingDelete() {
    const pending = state.pendingDelete;
    if (!pending) return;
    clearTimeout(pending.timer);
    state.pendingDelete = null;

    try {
      const res = await storage.deleteItem(pending.item.id);
      if (res.list && !state.pendingDelete) {
        state.list = res.list;
        renderList();
      }
      els.syncStatus.textContent = formatSyncTime(state.list.updated_at);
    } catch (err) {
      state.list.items = pending.backup;
      renderList();
      showToast(err.message || 'Impossible de supprimer.');
    }
  }

  async function handleDeleteItem(item, silentToast) {
    // Valide une éventuelle suppression précédente en attente avant d'en lancer une nouvelle
    if (state.pendingDelete) {
      await flushPendingDelete();
    }

    const backup = [...state.list.items];
    state.list.items = state.list.items.filter((it) => it.id !== item.id);
    renderList();

    if (silentToast) {
      try {
        const res = await storage.deleteItem(item.id);
        if (res.list) {
          state.list = res.list;
          renderList();
        }
        els.syncStatus.textContent = formatSyncTime(state.list.updated_at);
      } catch (err) {
        state.list.items = backup;
        renderList();
        showToast(err.message || 'Impossible de supprimer.');
      }
      return;
    }

    const timer = setTimeout(() => {
      flushPendingDelete();
    }, 1050);

    state.pendingDelete = { item, backup, timer };

    showToast(`« ${item.text} » annulé`, {
      actionLabel: '✕',
      isCross: true,
      actionAriaLabel: "Rétablir l'élément",
      duration: 1000,
      onAction: () => {
        if (!state.pendingDelete || state.pendingDelete.item.id !== item.id) return;
        clearTimeout(state.pendingDelete.timer);
        const restored = state.pendingDelete.backup;
        state.pendingDelete = null;
        state.list.items = restored;
        renderList();
        vibrate(15, storage.config.feedback);
      },
    });
  }

  /* ==========================================================================
     Dictée vocale (1 appui = 1 élément) + geste de déplacement gauche/droite
     ========================================================================== */
  const dictation = new VoiceDictation({
    onStart: () => {
      hideToast();
      els.btnMic.classList.add('listening');
      els.btnMic.setAttribute('aria-pressed', 'true');
      const langTag = (storage.config.speechLang || 'fr-BE').toUpperCase();
      els.voiceStatusLabel.textContent = `J'écoute (${langTag})… dites un article`;
      els.voiceInterimText.textContent = 'Parlez maintenant';
      els.voiceLiveBar.classList.remove('hidden');
    },
    onInterim: (text) => {
      els.voiceInterimText.textContent = `« ${text} »`;
    },
    onFinal: (text) => {
      handleAddItem(text, 'voice');
    },
    onError: (message) => {
      showToast(message, { duration: 4500 });
    },
    onEnd: () => {
      els.btnMic.classList.remove('listening');
      els.btnMic.setAttribute('aria-pressed', 'false');
      els.voiceLiveBar.classList.add('hidden');
    },
  });

  function toggleMicSide(explicitSide) {
    const nextSide =
      explicitSide || (storage.config.micSide === 'right' ? 'left' : 'right');
    storage.config = saveConfig({ micSide: nextSide });
    applyMicSide(nextSide);
    vibrate(18, storage.config.feedback);
    showToast(
      nextSide === 'left'
        ? 'Micro déplacé à gauche (mémorisé)'
        : 'Micro déplacé à droite (mémorisé)',
      { duration: 2200 }
    );
  }

  // Permet aussi de glisser le bouton micro horizontalement pour changer de côté !
  let touchStartX = null;
  let swipedMic = false;

  els.btnMic.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        swipedMic = false;
      }
    },
    { passive: true }
  );

  els.btnMic.addEventListener(
    'touchend',
    (e) => {
      if (touchStartX === null || !e.changedTouches || !e.changedTouches[0]) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      touchStartX = null;
      if (Math.abs(dx) > 55) {
        swipedMic = true;
        toggleMicSide(dx < 0 ? 'left' : 'right');
      }
    },
    { passive: true }
  );

  els.btnMic.addEventListener('click', () => {
    if (swipedMic) {
      swipedMic = false;
      return;
    }
    if (!VoiceDictation.isSupported()) {
      showToast(
        'Dictée vocale indisponible sur ce navigateur. Utilisez Chrome Android (HTTPS) ou le champ clavier.',
        { duration: 4800 }
      );
      els.quickAddInput.focus();
      return;
    }
    dictation.start(storage.config.feedback, storage.config.speechLang);
  });

  els.btnCancelVoice.addEventListener('click', () => {
    dictation.cancel(storage.config.feedback);
  });

  els.btnFlipMic.addEventListener('click', () => toggleMicSide());

  /* ==========================================================================
     Réglages, Partage familial & PIN
     ========================================================================== */
  function syncSettingsFormFields() {
    const cfg = storage.refreshConfig();
    els.cfgMode.value = cfg.mode;
    els.cfgUrl.value = cfg.apiUrl || '';
    els.cfgPin.value = cfg.pin || '';
    els.prefUserName.value = cfg.userName || '';
    els.cfgGoogleClientId.value = cfg.googleClientId || '';
    els.prefSpeechLang.value = cfg.speechLang || 'fr-BE';
    els.prefFeedback.checked = Boolean(cfg.feedback);

    document.querySelectorAll('[data-mic-choice]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.micChoice === cfg.micSide);
    });
    document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.themeChoice === cfg.theme);
    });

    updateBackendFieldVisibility(cfg.mode);
    renderGoogleSignInButton();
  }

  function updateBackendFieldVisibility(mode) {
    const isDemo = mode === 'demo';
    els.cfgUrlGroup.classList.toggle('hidden', isDemo);
    els.cfgPinGroup.classList.toggle('hidden', isDemo);

    if (mode === 'apps-script') {
      els.cfgUrl.placeholder = 'https://script.google.com/macros/s/.../exec';
      els.cfgUrlHelp.textContent =
        "Collez l'URL d'application Web obtenue après déploiement de Code.gs.";
    } else {
      els.cfgUrl.placeholder = 'Laisser vide si hébergé sur le même serveur';
      els.cfgUrlHelp.textContent =
        'Ex. https://courses-keep.onrender.com (ou vide si même serveur FastAPI).';
    }
  }

  function updateShareModalLink() {
    const cfg = storage.refreshConfig();
    const includePin = els.shareIncludePin.checked;
    els.shareLinkInput.value = buildInviteUrl(cfg, includePin);
    els.btnNativeShare.classList.toggle('hidden', typeof navigator.share !== 'function');
  }

  function openPinModal() {
    els.pinUnlockInput.value = '';
    els.pinError.classList.add('hidden');
    openModal(els.modalPin);
    requestAnimationFrame(() => els.pinUnlockInput.focus());
  }

  /* ==========================================================================
     Écouteurs d'événements
     ========================================================================== */
  els.quickAddForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = els.quickAddInput.value.trim();
    if (!val) return;
    els.quickAddInput.value = '';
    handleAddItem(val, 'keyboard');
  });

  els.btnRefresh.addEventListener('click', () => syncList({ force: true }));

  els.btnToggleChecked.addEventListener('click', () => {
    state.checkedExpanded = !state.checkedExpanded;
    renderList();
  });

  els.btnUncheckAll.addEventListener('click', async () => {
    try {
      const res = await storage.uncheckAll();
      if (res.list) state.list = res.list;
      renderList();
      showToast('Tous les articles ont été remis dans la liste.');
    } catch (err) {
      showToast(err.message || 'Erreur lors du décochage.');
    }
  });

  els.btnClearChecked.addEventListener('click', async () => {
    if (!window.confirm('Supprimer définitivement tous les articles cochés ?')) return;
    try {
      const res = await storage.clearChecked();
      if (res.list) state.list = res.list;
      renderList();
      showToast('Panier vidé.');
    } catch (err) {
      showToast(err.message || 'Erreur lors de la suppression.');
    }
  });

  // Ouverture / fermeture des modales
  els.btnSettings.addEventListener('click', () => {
    syncSettingsFormFields();
    openModal(els.modalSettings);
  });

  els.btnShare.addEventListener('click', () => {
    updateShareModalLink();
    openModal(els.modalShare);
  });

  els.shareIncludePin.addEventListener('change', updateShareModalLink);

  els.btnCopyShare.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.shareLinkInput.value);
      showToast('Lien familial copié !');
    } catch (_) {
      els.shareLinkInput.select();
      document.execCommand('copy');
      showToast('Lien familial copié !');
    }
  });

  els.btnNativeShare.addEventListener('click', async () => {
    if (typeof navigator.share !== 'function') return;
    try {
      await navigator.share({
        title: 'Liste de courses familiale',
        text: 'Ouvre ce lien dans Chrome sur Android pour accéder à notre liste de courses partagée :',
        url: els.shareLinkInput.value,
      });
    } catch (_) {}
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.closeModal);
      if (target) closeModal(target);
    });
  });

  [els.modalSettings, els.modalShare].forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop);
    });
  });

  // Boutons segmentés dans Réglages
  document.querySelectorAll('[data-mic-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.micChoice;
      storage.config = saveConfig({ micSide: side });
      applyMicSide(side);
    });
  });

  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.themeChoice;
      storage.config = saveConfig({ theme: theme });
      applyTheme(theme);
      document.querySelectorAll('[data-theme-choice]').forEach((b) => {
        b.classList.toggle('active', b.dataset.themeChoice === theme);
      });
    });
  });

  els.cfgMode.addEventListener('change', () => {
    updateBackendFieldVisibility(els.cfgMode.value);
  });

  els.btnTestConnection.addEventListener('click', async () => {
    const prev = { ...storage.config };
    storage.config = {
      ...prev,
      mode: els.cfgMode.value,
      apiUrl: els.cfgUrl.value.trim(),
      pin: els.cfgPin.value.trim(),
    };
    try {
      const info = await storage.checkHealth();
      if (info.pin_required && storage.config.mode !== 'demo') {
        const pinOk = await storage.verifyPin(storage.config.pin);
        if (!pinOk) {
          showToast('Serveur OK, mais le Code PIN ne correspond pas à celui configuré côté serveur.', {
            duration: 5000,
          });
          return;
        }
      }
      const scriptVer = info.script_version
        ? ` · Script ${info.script_version}`
        : storage.config.mode === 'apps-script'
        ? ' · ⚠️ Ancien Code.gs (à redéployer en Nouvelle version)'
        : '';
      showToast(
        `Connexion et PIN OK (${info.mode || storage.config.mode}${scriptVer}) !`,
        { duration: 5500 }
      );
    } catch (err) {
      showToast('Échec du test : ' + (err.message || 'serveur injoignable'), { duration: 4500 });
    } finally {
      storage.config = prev;
    }
  });

  els.prefSpeechLang.addEventListener('change', () => {
    storage.config = saveConfig({ speechLang: els.prefSpeechLang.value });
  });

  els.nameBanner.addEventListener('submit', (e) => {
    e.preventDefault();
    const firstName = formatFirstName(els.nameBannerInput.value);
    if (!firstName) return;
    storage.config = saveConfig({ userName: firstName });
    els.nameBannerInput.value = '';
    updateNameBanner();
    showToast(`Prénom enregistré : ${firstName}`);
  });

  els.btnDismissName.addEventListener('click', () => {
    state.nameBannerDismissed = true;
    updateNameBanner();
  });

  els.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    storage.config = saveConfig({
      mode: els.cfgMode.value,
      apiUrl: els.cfgUrl.value.trim(),
      pin: els.cfgPin.value.trim(),
      userName: formatFirstName(els.prefUserName.value),
      googleClientId: els.cfgGoogleClientId.value.trim(),
      speechLang: els.prefSpeechLang.value,
      feedback: els.prefFeedback.checked,
    });
    updateNameBanner();
    closeModal(els.modalSettings);
    showToast('Réglages enregistrés.');
    await syncList({ force: true });
  });

  // Déverrouillage PIN
  els.pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entered = els.pinUnlockInput.value.trim();
    if (!entered) return;
    try {
      const ok = await storage.verifyPin(entered);
      if (ok) {
        storage.config = saveConfig({ pin: entered });
        closeModal(els.modalPin);
        showToast('Accès familial déverrouillé !');
        await syncList({ force: true });
      } else {
        els.pinError.classList.remove('hidden');
      }
    } catch (_) {
      els.pinError.classList.remove('hidden');
    }
  });

  els.btnPinSettings.addEventListener('click', () => {
    closeModal(els.modalPin);
    syncSettingsFormFields();
    openModal(els.modalSettings);
  });

  /* ==========================================================================
     Installation PWA Android & Service Worker
     ========================================================================== */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    els.installBanner.classList.remove('hidden');
  });

  els.btnInstallPwa.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    els.installBanner.classList.add('hidden');
  });

  els.btnDismissInstall.addEventListener('click', () => {
    els.installBanner.classList.add('hidden');
  });

  if ('serviceWorker' in navigator) {
    let swReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swReloading) return;
      swReloading = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  /* ==========================================================================
     Démarrage de l'application
     ========================================================================== */
  async function bootstrap() {
    // 1. Lien d'invitation magique (#invite=...) partagé par un membre de la famille
    const invitedConfig = consumeInviteFromHash();
    if (invitedConfig) {
      storage.config = invitedConfig;
      showToast('Configuration familiale appliquée automatiquement !', { duration: 4000 });
    }

    // 2. Préférences locales (thème, position gauche/droite du micro, prénom)
    applyTheme(storage.config.theme);
    applyMicSide(storage.config.micSide);
    updateNameBanner();

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (storage.config.theme === 'auto') applyTheme('auto');
    });

    // 3. Affichage instantané depuis le cache local pendant la synchronisation
    const cached = loadCachedList();
    if (cached && Array.isArray(cached.items)) {
      state.list = cached;
      renderList();
    }

    // 4. Auto-détection douce au 1er lancement si aucun serveur Python n'est présent sur cette origine
    if (storage.config.mode === 'keep' && !storage.config.apiUrl) {
      try {
        await storage.checkHealth();
      } catch (_) {
        // Hébergement statique sans backend Python configuré : bascule automatique en Démo local
        storage.config = saveConfig({ mode: 'demo' });
      }
    }

    // 5. Chargement de la liste
    await syncList({ force: false });

    // 6. Raccourci Android "Dicter un article" (?dictate=1)
    const params = new URLSearchParams(window.location.search);
    if (params.get('dictate') === '1' && VoiceDictation.isSupported()) {
      setTimeout(() => dictation.start(storage.config.feedback, storage.config.speechLang), 400);
    }

    // 7. Rafraîchissement discret toutes les 15s lorsque l'app est visible
    state.pollTimer = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        !dictation.isListening &&
        !state.editingItemId &&
        !state.pendingDelete &&
        Object.keys(state.pendingQtyUpdates).length === 0 &&
        storage.config.mode !== 'demo'
      ) {
        syncList({ silent: true, force: false });
      }
    }, 15000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushPendingQuantities();
        flushPendingDelete();
      } else if (
        document.visibilityState === 'visible' &&
        !state.pendingDelete &&
        Object.keys(state.pendingQtyUpdates).length === 0 &&
        storage.config.mode !== 'demo'
      ) {
        syncList({ silent: true, force: false });
      }
    });

    window.addEventListener('pagehide', () => {
      flushPendingQuantities();
      flushPendingDelete();
    });
  }

  bootstrap();
})();
