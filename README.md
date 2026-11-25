# Courses Famille — PWA Android + Google Keep & Google Apps Script

Application web progressive (**PWA Android installable**) pensée pour faire les courses à une main, lire/modifier votre liste partagée et dicter de nouveaux articles à la voix (**1 appui micro = 1 article**).

---

## Fonctionnalités

- **Affichage en temps réel** de la liste (`À acheter` / `Dans le panier`), cochage en un tap, édition inline, suppression, et rafraîchissement automatique toutes les 15 secondes.
- **Ajout vocal ergonomique (1 appui = 1 élément)** : grand bouton micro en bas de l'écran, reconnaissance vocale française (`fr-FR`), affichage en direct de ce qui est compris, bouton **Annuler** pendant 4,5 secondes et anti-doublon intelligent (dicter un article déjà coché le remet simplement dans la liste !).
- **Bouton micro déplaçable à gauche ou à droite** :
  - Depuis le bouton `⇄` en bas de l'écran,
  - En **glissant horizontalement** sur le bouton micro,
  - Ou dans **Réglages (⚙️)**.
  - La position est **sauvegardée par téléphone** (chaque membre gaucher/droitier garde sa préférence).
- **Partage familial en 1 lien** : bouton **Partager** dans l'en-tête → génère un lien d'invitation pré-configuré (WhatsApp, SMS, etc.).
- **Double backend prêt à l'emploi** :
  1. `backend-keep/` — **Synchronisation directe avec Google Keep** (`FastAPI` + `gkeepapi`, sert aussi la PWA sur le même serveur HTTPS).
  2. `backend-apps-script/` — **100 % Google Apps Script + Google Sheets** (zéro serveur à héberger, gratuit et officiel Google).
  3. **Mode Démo local** — Fonctionne immédiatement hors ligne dans le navigateur pour tester l'interface.

---

## Partage familial & autorisations Google (Comment ça marche ?)

**Oui, toute votre famille peut utiliser l'application simultanément, et aucun membre de votre famille n'a besoin de configurer d'autorisation Google !**

### Cas 1 : Avec le backend Python `gkeepapi` (Synchronisation directe Google Keep)

1. **Un seul compte Google** est connecté sur votre serveur via `GOOGLE_MASTER_TOKEN` :
   - **Astuce sécurité fortement recommandée** : créez un compte Gmail dédié à la maison (ex. `courses.famille.xyz@gmail.com`) et ajoutez-le comme **collaborateur** sur votre liste Google Keep (comme les autres membres de votre famille). Ainsi, votre compte Google personnel principal n'a jamais besoin de Master Token !
2. Comme la liste Google Keep est partagée avec toute la famille, chaque ajout dicté dans la PWA apparaît **en direct dans Google Keep chez tout le monde** (et chaque modification dans Google Keep apparaît dans la PWA).
3. **Pour les membres de la famille** :
   - Ils ouvrent simplement le lien de partage dans **Chrome sur Android**.
   - L'accès est protégé par votre **Code PIN familial** (`FAMILY_PIN`), inclus ou non dans le lien d'invitation.
   - Ils touchent **« Installer »** (ou menu `⋮ → Ajouter à l'écran d'accueil`). Aucune connexion Google requise !

### Cas 2 : Avec le backend Google Apps Script + Google Sheets

1. Vous déployez `backend-apps-script/Code.gs` depuis **votre** compte Google avec :
   - **Exécuter en tant que** : `Moi`
   - **Qui a accès** : `Tout le monde`
2. Vous protégez le script avec `FAMILY_PIN` dans les *Propriétés du script*.
3. **Pour les membres de la famille** : aucune autorisation Google requise dans la PWA ! Si vous souhaitez aussi qu'ils consultent la feuille dans Google Drive, partagez simplement la Google Sheet `Courses Famille (PWA)` avec leurs adresses Gmail.

---

## Démarrage rapide — Option A : Synchronisation Google Keep (Python + PWA)

### 1. Générer votre Master Token Google Keep (une seule fois)

```bash
cd backend-keep
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python3 get_master_token.py
```

Le script vous guide pas à pas (via `https://accounts.google.com/EmbeddedSetup`) et vérifie immédiatement qu'il retrouve votre liste Google Keep (ID visible après `#LIST/` dans l'URL Keep).

### 2. Lancer en local ou avec Docker

```bash
cp .env.example .env
# Renseignez GOOGLE_EMAIL, GOOGLE_MASTER_TOKEN et FAMILY_PIN dans .env

cd backend-keep
uvicorn main:app --host 0.0.0.0 --port 8000
```

Ouvrez `http://localhost:8000` (sur Android, déployez en **HTTPS** pour activer le microphone et l'installation PWA).

### 3. Déployer gratuitement en HTTPS sur Render (recommandé pour Android)

1. Poussez ce dossier sur un dépôt GitHub **privé**.
2. Sur [render.com](https://render.com) → **New +** → **Blueprint** → sélectionnez votre dépôt (`render.yaml` est déjà prêt !).
3. Renseignez les 3 variables secrètes dans Render :
   - `GOOGLE_EMAIL`
   - `GOOGLE_MASTER_TOKEN`
   - `FAMILY_PIN` (ex. `2468`)
4. Render vous donne une URL **HTTPS** (`https://courses-keep-famille.onrender.com`) qui sert à la fois la **PWA Android** et l'**API Google Keep** !

---

## Démarrage rapide — Option B : Google Apps Script + Google Sheets

Suivez le guide détaillé dans [`backend-apps-script/DEPLOIEMENT_APPS_SCRIPT.md`](./backend-apps-script/DEPLOIEMENT_APPS_SCRIPT.md), puis hébergez simplement le dossier `pwa/` sur **GitHub Pages**, **Netlify** ou **Cloudflare Pages** (gratuit et HTTPS).

---

## Structure du projet

```text
courses-keep-pwa/
├── pwa/                               # Application PWA Android (HTML/CSS/JS)
│   ├── index.html
│   ├── manifest.json                  # Manifeste Android + raccourci vocal
│   ├── sw.js                          # Service Worker hors ligne
│   ├── css/styles.css                 # Interface tactile clair/sombre + micro gauche/droite
│   ├── js/
│   │   ├── app.js                     # Contrôleur principal & partage familial
│   │   ├── storage.js                 # Adaptateur Keep / Apps Script / Démo
│   │   └── speech.js                  # Dictée vocale fr-FR (1 appui = 1 élément)
│   └── icons/                         # Icônes PNG + maskable Android
├── backend-keep/                      # Backend Python FastAPI + gkeepapi
│   ├── main.py                        # API REST + PIN familial + service PWA
│   ├── keep_client.py                 # Wrapper thread-safe gkeepapi + cache + anti-doublon
│   ├── get_master_token.py            # Assistant interactif Master Token
│   └── requirements.txt
├── backend-apps-script/               # Backend 100 % Google Apps Script + Sheets
│   ├── Code.gs
│   └── DEPLOIEMENT_APPS_SCRIPT.md
├── Dockerfile
├── render.yaml
└── .env.example
```
