#!/usr/bin/env python3
"""
Assistant interactif pour obtenir le GOOGLE_MASTER_TOKEN nécessaire à gkeepapi
et vérifier immédiatement l'accès à votre liste de courses Google Keep.

Conseil sécurité :
  Créez idéalement un compte Google dédié (ex: courses.famille@gmail.com)
  et ajoutez-le comme collaborateur sur votre liste Google Keep. Ainsi, votre
  compte personnel principal n'a pas besoin de générer de Master Token.
"""

from __future__ import annotations

import secrets
import sys

import gkeepapi
import gpsoauth

DEFAULT_LIST_ID = ""


def main() -> None:
    print("=" * 68)
    print("  Assistant Master Token Google Keep (gkeepapi)")
    print("=" * 68)
    print(
        "\nÉtapes pour récupérer le cookie 'oauth_token' :\n"
        "  1. Ouvrez dans un navigateur : https://accounts.google.com/EmbeddedSetup\n"
        "  2. Connectez-vous avec le compte Google qui a accès à la liste Keep.\n"
        "  3. Cliquez sur « J'accepte » (la page peut mouliner ensuite, c'est normal).\n"
        "  4. Ouvrez les outils développeur (F12) → Application (ou Stockage)\n"
        "     → Cookies → https://accounts.google.com\n"
        "  5. Copiez la valeur du cookie nommé : oauth_token (commence par oauth2_4/...)\n"
    )

    email = input("Adresse Gmail du compte connecté : ").strip()
    oauth_token = input("Valeur du cookie oauth_token : ").strip()

    if not email or not oauth_token:
        print("Erreur : l'adresse Gmail et le cookie oauth_token sont obligatoires.")
        sys.exit(1)

    android_id = secrets.token_hex(8)
    print("\nÉchange du cookie contre un Master Token...")
    res = gpsoauth.exchange_token(email, oauth_token, android_id)

    if "Token" not in res:
        print("Échec de l'échange :", res)
        sys.exit(1)

    master_token = res["Token"]
    print("\n" + "=" * 68)
    print("SUCCÈS ! Voici vos variables d'environnement (.env / Render) :")
    print("=" * 68)
    print(f"GOOGLE_EMAIL={email}")
    print(f"GOOGLE_MASTER_TOKEN={master_token}")
    print(f"KEEP_LIST_ID={DEFAULT_LIST_ID}")
    print("=" * 68)
    print("ATTENTION : Ne partagez jamais ce token et ne le commitez pas sur GitHub !\n")

    test = input("Voulez-vous tester l'accès à votre liste Keep maintenant ? [O/n] ").strip().lower()
    if test in {"", "o", "oui", "y", "yes"}:
        list_id = input(f"ID de la liste Keep [{DEFAULT_LIST_ID}] : ").strip() or DEFAULT_LIST_ID
        print("Connexion à Google Keep en cours...")
        keep = gkeepapi.Keep()
        keep.authenticate(email, master_token)
        note = keep.get(list_id)
        if note is None:
            for candidate in keep.all():
                if candidate.id == list_id or getattr(candidate, "server_id", None) == list_id:
                    note = candidate
                    break

        if note is not None:
            print(f"\nListe trouvée : « {note.title} » ({len(note.items)} articles)")
            for item in note.unchecked[:10]:
                print(f"  [ ] {item.text}")
        else:
            print(
                "\nConnexion réussie, mais l'ID exact n'a pas été trouvé.\n"
                "Voici vos listes disponibles dans Google Keep :"
            )
            for candidate in keep.all():
                if isinstance(candidate, gkeepapi.node.List) and not candidate.trashed:
                    print(f"  - Titre: {candidate.title!r} | ID: {candidate.id}")


if __name__ == "__main__":
    main()
