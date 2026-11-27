/**
 * Backend Google Apps Script + Google Sheets pour la PWA "Courses Keep Famille"
 *
 * Avantage : 100 % gratuit, officiel Google, zéro serveur à héberger.
 * Multi-utilisateurs famille :
 *   - Déployer en tant qu'Application Web :
 *       * Exécuter en tant que : Moi (votre compte Google)
 *       * Qui a accès : Tout le monde
 *   - Sécurisé par un Code PIN familial vérifié côté script (Script Properties).
 *   - Aucun membre de la famille n'a besoin de se connecter à Google dans la PWA !
 *   - Utilise LockService pour éviter les conflits si 2 personnes ajoutent un article en même temps.
 */

const SHEET_NAME = 'Courses';
const DEFAULT_KEEP_URL = 'https://keep.google.com/';

// Optionnel : définissez votre code PIN ici ou via Paramètres du projet > Propriétés du script (clé FAMILY_PIN)
const FALLBACK_FAMILY_PIN = '1234';

/**
 * Récupère le code PIN familial configuré (priorité aux Script Properties).
 */
function getConfiguredPin_() {
  const props = PropertiesService.getScriptProperties();
  const propPin = props.getProperty('FAMILY_PIN');
  if (propPin !== null) {
    return String(propPin).trim();
  }
  return String(FALLBACK_FAMILY_PIN || '').trim();
}

/**
 * Vérifie le code PIN fourni par la PWA.
 */
function isPinValid_(providedPin) {
  const expected = getConfiguredPin_();
  if (!expected) return true;
  return String(providedPin || '').trim() === expected;
}

/**
 * Ouvre (ou crée automatiquement au 1er lancement) la feuille Google Sheets dédiée.
 */
function getOrCreateSheet_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;

  // 1. Si le script est lié à une Google Sheet existante
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    ss = null;
  }

  // 2. Sinon, on réutilise l'ID sauvegardé dans les Script Properties
  if (!ss) {
    const savedId = props.getProperty('SPREADSHEET_ID');
    if (savedId) {
      try {
        ss = SpreadsheetApp.openById(savedId);
      } catch (e) {
        ss = null;
      }
    }
  }

  // 3. Sinon, création automatique de la feuille dans Google Drive
  if (!ss) {
    ss = SpreadsheetApp.create('Courses Famille (PWA)');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(SHEET_NAME);
  }

  // Initialisation des en-têtes si feuille vide (ou migration automatique vers added_by & quantity)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id', 'text', 'checked', 'sort', 'updated_at', 'added_by', 'quantity']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#E8F3EE');
    sheet.setFrozenRows(1);
  } else {
    if (String(sheet.getRange(1, 6).getValue() || '').trim() !== 'added_by') {
      sheet.getRange(1, 6).setValue('added_by').setFontWeight('bold').setBackground('#E8F3EE');
    }
    if (String(sheet.getRange(1, 7).getValue() || '').trim() !== 'quantity') {
      sheet.getRange(1, 7).setValue('quantity').setFontWeight('bold').setBackground('#E8F3EE');
    }
  }

  return { ss: ss, sheet: sheet };
}

function normalizeText_(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatText_(str) {
  const cleaned = String(str || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatFirstName_(str) {
  const cleaned = String(str || '').trim().split(/\s+/)[0] || '';
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function clampQuantity_(val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1) return 1;
  if (n > 12) return 12;
  return n;
}

function readAllItems_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    const text = String(rows[i][1] || '').trim();
    if (!id || !text) continue;
    items.push({
      rowIndex: i + 2,
      id: id,
      text: text,
      checked: rows[i][2] === true || String(rows[i][2]).toUpperCase() === 'TRUE',
      sort: Number(rows[i][3]) || (rows.length - i) * 100,
      added_by: formatFirstName_(rows[i][5] || ''),
      quantity: clampQuantity_(rows[i][6]),
    });
  }
  items.sort(function (a, b) {
    return b.sort - a.sort;
  });
  return items;
}

function buildListResponse_(ss, sheet) {
  const items = readAllItems_(sheet).map(function (it) {
    return {
      id: it.id,
      text: it.text,
      checked: it.checked,
      sort: it.sort,
      added_by: it.added_by || '',
      quantity: clampQuantity_(it.quantity),
    };
  });
  return {
    mode: 'apps-script',
    list_id: ss.getId(),
    title: ss.getName(),
    sheet_url: ss.getUrl(),
    keep_url: DEFAULT_KEEP_URL,
    updated_at: new Date().toISOString(),
    items: items,
  };
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Endpoint GET : ?action=health | ?action=list&pin=...
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'list';

    if (action === 'health' || action === 'status') {
      return jsonResponse_({
        status: 'ok',
        mode: 'apps-script',
        pin_required: Boolean(getConfiguredPin_()),
        keep_url: DEFAULT_KEEP_URL,
      });
    }

    if (!isPinValid_(params.pin)) {
      return jsonResponse_({ error: 'Code PIN familial invalide ou manquant.', code: 401 });
    }

    if (action === 'list') {
      const ctx = getOrCreateSheet_();
      return jsonResponse_(buildListResponse_(ctx.ss, ctx.sheet));
    }

    return jsonResponse_({ error: 'Action GET inconnue : ' + action, code: 400 });
  } catch (err) {
    return jsonResponse_({ error: String(err), code: 500 });
  }
}

/**
 * Endpoint POST : accepte du JSON envoyé en Content-Type: text/plain (évite le preflight CORS).
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const payload = JSON.parse(raw);
    const action = payload.action || '';

    if (action === 'verify_pin') {
      const valid = isPinValid_(payload.pin);
      return jsonResponse_({
        ok: valid,
        pin_required: Boolean(getConfiguredPin_()),
        code: valid ? 200 : 401,
      });
    }

    if (!isPinValid_(payload.pin)) {
      return jsonResponse_({ error: 'Code PIN familial invalide ou manquant.', code: 401 });
    }

    lock.waitLock(10000);
    const ctx = getOrCreateSheet_();
    const sheet = ctx.sheet;
    const items = readAllItems_(sheet);
    const nowIso = new Date().toISOString();

    if (action === 'add') {
      const text = formatText_(payload.text);
      if (!text) return jsonResponse_({ error: "Le texte de l'article est vide.", code: 400 });
      const addedBy = formatFirstName_(payload.added_by || '');
      const norm = normalizeText_(text);

      for (let i = 0; i < items.length; i++) {
        if (normalizeText_(items[i].text) === norm) {
          if (items[i].checked) {
            sheet.getRange(items[i].rowIndex, 3).setValue(false);
            sheet.getRange(items[i].rowIndex, 5).setValue(nowIso);
            sheet.getRange(items[i].rowIndex, 7).setValue(1);
            items[i].quantity = 1;
            if (addedBy) {
              sheet.getRange(items[i].rowIndex, 6).setValue(addedBy);
              items[i].added_by = addedBy;
            }
            SpreadsheetApp.flush();
            return jsonResponse_({
              action: 'unchecked_existing',
              item: {
                id: items[i].id,
                text: items[i].text,
                checked: false,
                sort: items[i].sort,
                added_by: items[i].added_by || '',
                quantity: 1,
              },
              list: buildListResponse_(ctx.ss, sheet),
            });
          }
          return jsonResponse_({
            action: 'already_exists',
            item: {
              id: items[i].id,
              text: items[i].text,
              checked: false,
              sort: items[i].sort,
              added_by: items[i].added_by || '',
              quantity: clampQuantity_(items[i].quantity),
            },
            list: buildListResponse_(ctx.ss, sheet),
          });
        }
      }

      const maxSort = items.reduce(function (m, it) {
        return Math.max(m, it.sort || 0);
      }, 0);
      const newItem = {
        id: Utilities.getUuid(),
        text: text,
        checked: Boolean(payload.checked),
        sort: maxSort + 100,
        added_by: addedBy,
        quantity: clampQuantity_(payload.quantity),
      };
      sheet.appendRow([
        newItem.id,
        newItem.text,
        newItem.checked,
        newItem.sort,
        nowIso,
        newItem.added_by,
        newItem.quantity,
      ]);
      SpreadsheetApp.flush();
      return jsonResponse_({
        action: 'added',
        item: newItem,
        list: buildListResponse_(ctx.ss, sheet),
      });
    }

    if (action === 'update') {
      const target = items.find(function (it) {
        return it.id === payload.id;
      });
      if (!target) return jsonResponse_({ error: 'Article introuvable.', code: 404 });

      if (typeof payload.checked === 'boolean') {
        sheet.getRange(target.rowIndex, 3).setValue(payload.checked);
        target.checked = payload.checked;
      }
      if (typeof payload.text === 'string') {
        const formatted = formatText_(payload.text);
        if (!formatted) return jsonResponse_({ error: 'Le texte ne peut pas être vide.', code: 400 });
        sheet.getRange(target.rowIndex, 2).setValue(formatted);
        target.text = formatted;
      }
      if (payload.quantity !== undefined && payload.quantity !== null) {
        const qty = clampQuantity_(payload.quantity);
        sheet.getRange(target.rowIndex, 7).setValue(qty);
        target.quantity = qty;
      }
      sheet.getRange(target.rowIndex, 5).setValue(nowIso);
      SpreadsheetApp.flush();
      return jsonResponse_({
        item: {
          id: target.id,
          text: target.text,
          checked: target.checked,
          sort: target.sort,
          added_by: target.added_by || '',
          quantity: clampQuantity_(target.quantity),
        },
        list: buildListResponse_(ctx.ss, sheet),
      });
    }

    if (action === 'delete') {
      const target = items.find(function (it) {
        return it.id === payload.id;
      });
      if (!target) return jsonResponse_({ error: 'Article introuvable.', code: 404 });
      sheet.deleteRow(target.rowIndex);
      SpreadsheetApp.flush();
      return jsonResponse_({
        deleted_id: payload.id,
        list: buildListResponse_(ctx.ss, sheet),
      });
    }

    if (action === 'clear_checked') {
      const checkedRows = items
        .filter(function (it) {
          return it.checked;
        })
        .map(function (it) {
          return it.rowIndex;
        })
        .sort(function (a, b) {
          return b - a;
        }); // Suppression du bas vers le haut

      for (let i = 0; i < checkedRows.length; i++) {
        sheet.deleteRow(checkedRows[i]);
      }
      SpreadsheetApp.flush();
      return jsonResponse_({
        removed_count: checkedRows.length,
        list: buildListResponse_(ctx.ss, sheet),
      });
    }

    if (action === 'uncheck_all') {
      let count = 0;
      for (let i = 0; i < items.length; i++) {
        if (items[i].checked) {
          sheet.getRange(items[i].rowIndex, 3).setValue(false);
          sheet.getRange(items[i].rowIndex, 5).setValue(nowIso);
          count++;
        }
      }
      SpreadsheetApp.flush();
      return jsonResponse_({
        unchecked_count: count,
        list: buildListResponse_(ctx.ss, sheet),
      });
    }

    return jsonResponse_({ error: 'Action POST inconnue : ' + action, code: 400 });
  } catch (err) {
    return jsonResponse_({ error: String(err), code: 500 });
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

/**
 * Fonction utilitaire à exécuter UNE FOIS depuis l'éditeur Apps Script
 * pour initialiser la feuille et afficher son lien dans les journaux.
 */
function setup() {
  const ctx = getOrCreateSheet_();
  Logger.log('Feuille Google Sheets prête : ' + ctx.ss.getUrl());
}
