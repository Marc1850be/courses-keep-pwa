# Déploiement du backend Google Apps Script + Google Sheets (Zéro serveur)

Ce mode permet d'héberger gratuitement les données de votre liste familiale dans **Google Drive / Google Sheets**, sans serveur Python à maintenir.

## Étapes (5 minutes)

1. Ouvrez [script.google.com](https://script.google.com) avec votre compte Google.
2. Cliquez sur **Nouveau projet** et nommez-le `Courses Famille API`.
3. Remplacez tout le contenu de `Code.gs` par le fichier [`Code.gs`](./Code.gs) de ce dossier.
4. *(Optionnel recommandé)* Définissez votre Code PIN familial :
   - Cliquez sur l'icône **Paramètres du projet** (engrenage à gauche)
   - Descendez jusqu'à **Propriétés du script** → **Ajouter une propriété**
   - Propriété : `FAMILY_PIN` | Valeur : votre code (ex. `2468`)
5. Dans l'éditeur, sélectionnez la fonction `setup` dans la barre supérieure et cliquez sur **Exécuter** :
   - Acceptez les autorisations Google (une seule fois, uniquement sur **votre** compte).
   - Le script crée automatiquement une feuille Google Sheets nommée **`Courses Famille (PWA)`** dans votre Drive.
6. Cliquez en haut à droite sur **Déployer** → **Nouveau déploiement** :
   - Type : **Application Web**
   - Exécuter en tant que : **Moi** *(votre adresse Gmail)*
   - Qui a accès : **Tout le monde** *(obligatoire pour que les membres de la famille utilisent la PWA sans erreur CORS ni reconnexion Google ; l'accès reste protégé par votre `FAMILY_PIN` !)*
7. Copiez l'**URL de l'application Web** (`https://script.google.com/macros/s/.../exec`).
8. Dans la PWA, ouvrez **Réglages (⚙️)** → Mode **Google Apps Script** → collez l'URL + votre PIN familial → **Enregistrer**.
9. Cliquez sur **Partager avec la famille** dans la PWA : cela crée un lien magique pré-configuré à envoyer sur WhatsApp/SMS à vos proches !

## Autorisations Google pour les membres de la famille

- **Dans la PWA** : **aucune autorisation Google requise** pour vos proches ! Comme le script s'exécute « en tant que Moi », tous les téléphones passent par votre script avec le Code PIN familial.
- **Dans Google Sheets** *(facultatif)* : si vous voulez que la famille puisse aussi ouvrir le tableau directement dans Google Drive, partagez simplement la feuille `Courses Famille (PWA)` avec leurs adresses Gmail en mode **Éditeur**.
