/**
 * Adaptateur unifié de stockage pour la PWA Courses Famille.
 * Gère de façon transparente 3 modes :
 *   1. 'keep'        : Backend Python FastAPI + gkeepapi (vraie synchro Google Keep)
 *   2. 'apps-script' : Backend Google Apps Script + Google Sheets (zéro serveur)
 *   3. 'demo'        : Stockage local localStorage (fonctionne immédiatement hors ligne)
 */

(function (global) {
  'use strict';

  const CONFIG_KEY = 'courses_keep_config_v1';
  const CACHE_KEY = 'courses_keep_list_cache_v1';
  const DEMO_KEY = 'courses_keep_demo_items_v1';

  const DEFAULT_KEEP_LIST_ID = '';
  const DEFAULT_KEEP_URL = 'https://keep.google.com/';

  const DEFAULT_CONFIG = {
    mode: 'keep', // Détectera automatiquement si /api/health répond, sinon repli propre sur démo
    apiUrl: '',   // Vide = même origine que la PWA (pratique quand FastAPI sert la PWA)
    pin: '',
    micSide: 'right',
    speechLang: 'fr-BE',
    userName: '',
    googleClientId: '',
    theme: 'auto',
    feedback: true,
    keepUrl: DEFAULT_KEEP_URL,
  };

  function normalizeText(str) {
    return String(str || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function formatItemText(str) {
    const cleaned = String(str || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return '';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function formatFirstName(str) {
    const first = String(str || '').trim().split(/\s+/)[0] || '';
    if (!first) return '';
    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  function clampQuantity(val) {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 1) return 1;
    if (n > 12) return 12;
    return n;
  }

  function generateId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  class AuthRequiredError extends Error {
    constructor(message) {
      super(message || 'Code PIN familial requis.');
      this.name = 'AuthRequiredError';
      this.status = 401;
    }
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return { ...DEFAULT_CONFIG };
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch (_) {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(partial) {
    const next = { ...loadConfig(), ...partial };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    return next;
  }

  function saveCachedList(listData) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(listData));
    } catch (_) {}
  }

  function loadCachedList() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Encode les paramètres de connexion dans le hash d'un lien d'invitation familial (#invite=...)
   * Le fragment (#) n'est jamais envoyé dans les logs HTTP du serveur.
   */
  function buildInviteUrl(config, includePin) {
    const payload = {
      m: config.mode,
      u: config.apiUrl || '',
    };
    if (includePin && config.pin) {
      payload.p = config.pin;
    }
    if (config.googleClientId) {
      payload.g = config.googleClientId;
    }
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const base = global.location.origin + global.location.pathname;
    return base + '#invite=' + encoded;
  }

  /**
   * Lit et applique un éventuel lien d'invitation familial (#invite=...) au démarrage.
   */
  function consumeInviteFromHash() {
    const hash = global.location.hash || '';
    if (!hash.startsWith('#invite=')) return null;
    try {
      let b64 = hash.slice('#invite='.length).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const data = JSON.parse(new TextDecoder().decode(bytes));
      const updates = {};
      if (data.m === 'keep' || data.m === 'apps-script' || data.m === 'demo') {
        updates.mode = data.m;
      }
      if (typeof data.u === 'string') {
        updates.apiUrl = data.u.trim();
      }
      if (typeof data.p === 'string' && data.p.trim()) {
        updates.pin = data.p.trim();
      }
      if (typeof data.g === 'string' && data.g.trim()) {
        updates.googleClientId = data.g.trim();
      }
      const next = saveConfig(updates);
      // Nettoie l'URL pour ne pas laisser le jeton visible dans la barre d'adresse
      if (global.history && global.history.replaceState) {
        global.history.replaceState(null, '', global.location.pathname + global.location.search);
      }
      return next;
    } catch (_) {
      return null;
    }
  }

  /* -------------------- Mode Démo local -------------------- */
  function loadDemoData() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    const initial = {
      mode: 'demo',
      list_id: DEFAULT_KEEP_LIST_ID,
      title: 'Liste de courses',
      keep_url: DEFAULT_KEEP_URL,
      updated_at: new Date().toISOString(),
      items: [
        { id: generateId(), text: 'Lait demi-écrémé', checked: false, sort: 600 },
        { id: generateId(), text: 'Pain complet', checked: false, sort: 500 },
        { id: generateId(), text: 'Tomates cerises', checked: false, sort: 400 },
        { id: generateId(), text: 'Œufs bio (x12)', checked: false, sort: 300 },
        { id: generateId(), text: 'Yaourts nature', checked: false, sort: 200 },
        { id: generateId(), text: 'Beurre doux', checked: true, sort: 100 },
      ],
    };
    localStorage.setItem(DEMO_KEY, JSON.stringify(initial));
    return initial;
  }

  function saveDemoData(data) {
    data.updated_at = new Date().toISOString();
    localStorage.setItem(DEMO_KEY, JSON.stringify(data));
    return data;
  }

  /* -------------------- Client unifié -------------------- */
  class ShoppingStorage {
    constructor() {
      this.config = loadConfig();
    }

    refreshConfig() {
      this.config = loadConfig();
      return this.config;
    }

    _keepBaseUrl() {
      return (this.config.apiUrl || '').trim().replace(/\/+$/, '');
    }

    _keepHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      if (this.config.pin) {
        headers['X-Family-Pin'] = this.config.pin;
      }
      return headers;
    }

    async _keepFetch(path, options) {
      const url = this._keepBaseUrl() + path;
      const res = await fetch(url, {
        ...(options || {}),
        headers: { ...this._keepHeaders(), ...((options && options.headers) || {}) },
      });
      if (res.status === 401) {
        throw new AuthRequiredError('Code PIN familial requis ou incorrect.');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.error || 'Erreur serveur (' + res.status + ')');
      }
      return data;
    }

    async _gasGet(action) {
      const base = (this.config.apiUrl || '').trim();
      if (!base) {
        throw new Error("Veuillez renseigner l'URL de votre Web App Google Apps Script dans les Réglages.");
      }
      const sep = base.includes('?') ? '&' : '?';
      const params = new URLSearchParams({ action: action });
      if (this.config.pin) params.set('pin', this.config.pin);
      const res = await fetch(base + sep + params.toString(), { method: 'GET', redirect: 'follow' });
      const data = await res.json().catch(() => ({}));
      if (data.code === 401) throw new AuthRequiredError(data.error);
      if (data.error) throw new Error(data.error);
      return data;
    }

    async _gasPost(payload) {
      const base = (this.config.apiUrl || '').trim();
      if (!base) {
        throw new Error("Veuillez renseigner l'URL de votre Web App Google Apps Script dans les Réglages.");
      }
      // Content-Type: text/plain évite le preflight CORS OPTIONS non géré par Apps Script
      const body = JSON.stringify({ pin: this.config.pin || '', ...payload });
      const res = await fetch(base, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body,
      });
      const data = await res.json().catch(() => ({}));
      if (data.code === 401) throw new AuthRequiredError(data.error);
      if (data.error) throw new Error(data.error);
      return data;
    }

    async checkHealth() {
      if (this.config.mode === 'demo') {
        return { status: 'ok', mode: 'demo', pin_required: false, keep_url: DEFAULT_KEEP_URL };
      }
      if (this.config.mode === 'apps-script') {
        return this._gasGet('health');
      }
      const url = this._keepBaseUrl() + '/api/health';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Serveur injoignable (' + res.status + ')');
      return res.json();
    }

    async verifyPin(pin) {
      if (this.config.mode === 'demo') return true;
      if (this.config.mode === 'apps-script') {
        try {
          const res = await this._gasPost({ action: 'verify_pin', pin: String(pin || '').trim() });
          return Boolean(res.ok);
        } catch (err) {
          if (err instanceof AuthRequiredError) return false;
          throw err;
        }
      }
      const url = this._keepBaseUrl() + '/api/auth/verify';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin }),
      });
      return res.ok;
    }

    async getList(forceSync) {
      if (this.config.mode === 'demo') {
        const data = loadDemoData();
        saveCachedList(data);
        return data;
      }
      if (this.config.mode === 'apps-script') {
        const data = await this._gasGet('list');
        saveCachedList(data);
        return data;
      }
      const query = forceSync ? '?force=true' : '';
      const data = await this._keepFetch('/api/list' + query, { method: 'GET' });
      saveCachedList(data);
      return data;
    }

    async addItem(rawText, options) {
      const opts = options || {};
      const text = formatItemText(rawText);
      if (!text) throw new Error("L'article est vide.");

      const addedBy = formatFirstName(
        opts.addedBy !== undefined ? opts.addedBy : this.config.userName
      );

      if (this.config.mode === 'demo') {
        const data = loadDemoData();
        const norm = normalizeText(text);
        const existing = data.items.find((it) => normalizeText(it.text) === norm);
        if (existing) {
          if (existing.checked) {
            existing.checked = false;
            if (addedBy) existing.added_by = addedBy;
            saveDemoData(data);
            return { action: 'unchecked_existing', item: existing, list: data };
          }
          return { action: 'already_exists', item: existing, list: data };
        }
        const maxSort = data.items.reduce((m, it) => Math.max(m, it.sort || 0), 0);
        const item = {
          id: generateId(),
          text: text,
          checked: Boolean(opts.checked),
          sort: maxSort + 100,
          added_by: addedBy,
          quantity: clampQuantity(opts.quantity),
        };
        data.items.unshift(item);
        saveDemoData(data);
        return { action: 'added', item: item, list: data };
      }

      if (this.config.mode === 'apps-script') {
        const res = await this._gasPost({
          action: 'add',
          text: text,
          added_by: addedBy,
          checked: Boolean(opts.checked),
          quantity: clampQuantity(opts.quantity),
        });
        if (res.list) saveCachedList(res.list);
        return res;
      }

      const res = await this._keepFetch('/api/items', {
        method: 'POST',
        body: JSON.stringify({ text: text, added_by: addedBy }),
      });
      if (res.list) saveCachedList(res.list);
      return res;
    }

    async updateItem(itemId, changes) {
      if (this.config.mode === 'demo') {
        const data = loadDemoData();
        const item = data.items.find((it) => it.id === itemId);
        if (!item) throw new Error('Article introuvable.');
        if (typeof changes.checked === 'boolean') item.checked = changes.checked;
        if (typeof changes.text === 'string') {
          const formatted = formatItemText(changes.text);
          if (!formatted) throw new Error('Texte vide.');
          item.text = formatted;
        }
        if (changes.quantity !== undefined) {
          item.quantity = clampQuantity(changes.quantity);
        }
        saveDemoData(data);
        return { item: item, list: data };
      }

      if (this.config.mode === 'apps-script') {
        const res = await this._gasPost({ action: 'update', id: itemId, ...changes });
        if (res.list) saveCachedList(res.list);
        return res;
      }

      const res = await this._keepFetch('/api/items/' + encodeURIComponent(itemId), {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
      if (res.list) saveCachedList(res.list);
      return res;
    }

    async deleteItem(itemId) {
      if (this.config.mode === 'demo') {
        const data = loadDemoData();
        data.items = data.items.filter((it) => it.id !== itemId);
        saveDemoData(data);
        return { deleted_id: itemId, list: data };
      }

      if (this.config.mode === 'apps-script') {
        const res = await this._gasPost({ action: 'delete', id: itemId });
        if (res.list) saveCachedList(res.list);
        return res;
      }

      const res = await this._keepFetch('/api/items/' + encodeURIComponent(itemId), {
        method: 'DELETE',
      });
      if (res.list) saveCachedList(res.list);
      return res;
    }

    async clearChecked() {
      if (this.config.mode === 'demo') {
        const data = loadDemoData();
        const before = data.items.length;
        data.items = data.items.filter((it) => !it.checked);
        saveDemoData(data);
        return { removed_count: before - data.items.length, list: data };
      }

      if (this.config.mode === 'apps-script') {
        const res = await this._gasPost({ action: 'clear_checked' });
        if (res.list) saveCachedList(res.list);
        return res;
      }

      const res = await this._keepFetch('/api/items/clear-checked', { method: 'POST' });
      if (res.list) saveCachedList(res.list);
      return res;
    }

    async uncheckAll() {
      if (this.config.mode === 'demo') {
        const data = loadDemoData();
        let count = 0;
        data.items.forEach((it) => {
          if (it.checked) {
            it.checked = false;
            count++;
          }
        });
        saveDemoData(data);
        return { unchecked_count: count, list: data };
      }

      if (this.config.mode === 'apps-script') {
        const res = await this._gasPost({ action: 'uncheck_all' });
        if (res.list) saveCachedList(res.list);
        return res;
      }

      const res = await this._keepFetch('/api/items/uncheck-all', { method: 'POST' });
      if (res.list) saveCachedList(res.list);
      return res;
    }
  }

  global.CoursesStorage = {
    ShoppingStorage,
    AuthRequiredError,
    DEFAULT_KEEP_URL,
    loadConfig,
    saveConfig,
    loadCachedList,
    buildInviteUrl,
    consumeInviteFromHash,
    formatItemText,
    formatFirstName,
    clampQuantity,
  };
})(window);
