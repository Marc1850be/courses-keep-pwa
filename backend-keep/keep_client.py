"""
Client Google Keep thread-safe basé sur gkeepapi, avec repli automatique
sur un fichier JSON local si les identifiants Google Keep ne sont pas encore configurés.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("courses_keep.client")

DEFAULT_KEEP_LIST_ID = ""
DEFAULT_KEEP_URL = "https://keep.google.com/"


def _normalize_text(value: str) -> str:
    """Normalise une chaîne (minuscules, sans accents, espaces réduits) pour détecter les doublons."""
    cleaned = " ".join(value.strip().lower().split())
    nfkd = unicodedata.normalize("NFKD", cleaned)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def _format_item_text(value: str) -> str:
    """Met en forme proprement un article dicté ou saisi (majuscule initiale)."""
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return ""
    return cleaned[0].upper() + cleaned[1:]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class KeepStoreError(RuntimeError):
    """Erreur métier lors de la communication avec Google Keep."""


class LocalJsonShoppingStore:
    """
    Stockage local JSON utilisé par défaut tant que GOOGLE_EMAIL et
    GOOGLE_MASTER_TOKEN ne sont pas configurés (permet de tester la PWA immédiatement).
    """

    mode = "demo"

    def __init__(self, data_file: Path, list_id: str, list_title: str = "Liste de courses") -> None:
        self._lock = threading.RLock()
        self._data_file = data_file
        self.list_id = list_id
        self.list_title = list_title
        self._ensure_file()

    def _ensure_file(self) -> None:
        if not self._data_file.exists():
            self._data_file.parent.mkdir(parents=True, exist_ok=True)
            initial = {
                "title": self.list_title,
                "updated_at": _utc_now_iso(),
                "items": [
                    {"id": str(uuid.uuid4()), "text": "Lait demi-écrémé", "checked": False, "sort": 500},
                    {"id": str(uuid.uuid4()), "text": "Pain complet", "checked": False, "sort": 400},
                    {"id": str(uuid.uuid4()), "text": "Tomates cerises", "checked": False, "sort": 300},
                    {"id": str(uuid.uuid4()), "text": "Œufs bio (x12)", "checked": False, "sort": 200},
                    {"id": str(uuid.uuid4()), "text": "Beurre doux", "checked": True, "sort": 100},
                ],
            }
            self._save(initial)

    def _load(self) -> Dict[str, Any]:
        with self._data_file.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def _save(self, data: Dict[str, Any]) -> None:
        data["updated_at"] = _utc_now_iso()
        tmp = self._data_file.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        tmp.replace(self._data_file)

    def get_list(self, force_sync: bool = False) -> Dict[str, Any]:
        with self._lock:
            data = self._load()
            return {
                "mode": self.mode,
                "list_id": self.list_id,
                "title": data.get("title", self.list_title),
                "keep_url": (
                    f"https://keep.google.com/u/0/share?pli=1#LIST/{self.list_id}"
                    if self.list_id
                    else DEFAULT_KEEP_URL
                ),
                "updated_at": data.get("updated_at", _utc_now_iso()),
                "items": data.get("items", []),
            }

    def add_item(self, raw_text: str, added_by: Optional[str] = None) -> Dict[str, Any]:
        text = _format_item_text(raw_text)
        if not text:
            raise KeepStoreError("Le texte de l'article est vide.")

        author = (added_by or "").strip().split()[0] if (added_by or "").strip() else ""
        if author:
            author = author[0].upper() + author[1:]

        norm = _normalize_text(text)
        with self._lock:
            data = self._load()
            items: List[Dict[str, Any]] = data.get("items", [])

            for item in items:
                if _normalize_text(item["text"]) == norm:
                    if item["checked"]:
                        item["checked"] = False
                        if author:
                            item["added_by"] = author
                        self._save(data)
                        return {"action": "unchecked_existing", "item": item, "list": self.get_list()}
                    return {"action": "already_exists", "item": item, "list": self.get_list()}

            max_sort = max((int(i.get("sort", 0)) for i in items), default=0)
            new_item = {
                "id": str(uuid.uuid4()),
                "text": text,
                "checked": False,
                "sort": max_sort + 100,
                "added_by": author,
            }
            items.insert(0, new_item)
            data["items"] = items
            self._save(data)
            return {"action": "added", "item": new_item, "list": self.get_list()}

    def update_item(
        self, item_id: str, checked: Optional[bool] = None, text: Optional[str] = None
    ) -> Dict[str, Any]:
        with self._lock:
            data = self._load()
            items: List[Dict[str, Any]] = data.get("items", [])
            for item in items:
                if item["id"] == item_id:
                    if checked is not None:
                        item["checked"] = bool(checked)
                    if text is not None:
                        formatted = _format_item_text(text)
                        if not formatted:
                            raise KeepStoreError("Le texte ne peut pas être vide.")
                        item["text"] = formatted
                    self._save(data)
                    return {"item": item, "list": self.get_list()}
            raise KeyError(f"Article introuvable : {item_id}")

    def delete_item(self, item_id: str) -> Dict[str, Any]:
        with self._lock:
            data = self._load()
            items: List[Dict[str, Any]] = data.get("items", [])
            new_items = [i for i in items if i["id"] != item_id]
            if len(new_items) == len(items):
                raise KeyError(f"Article introuvable : {item_id}")
            data["items"] = new_items
            self._save(data)
            return {"deleted_id": item_id, "list": self.get_list()}

    def clear_checked(self) -> Dict[str, Any]:
        with self._lock:
            data = self._load()
            before = len(data.get("items", []))
            data["items"] = [i for i in data.get("items", []) if not i.get("checked")]
            removed = before - len(data["items"])
            self._save(data)
            return {"removed_count": removed, "list": self.get_list()}

    def uncheck_all(self) -> Dict[str, Any]:
        with self._lock:
            data = self._load()
            count = 0
            for item in data.get("items", []):
                if item.get("checked"):
                    item["checked"] = False
                    count += 1
            self._save(data)
            return {"unchecked_count": count, "list": self.get_list()}


class GoogleKeepShoppingStore:
    """
    Client Google Keep réel utilisant gkeepapi.
    Connecté avec un seul compte (personnel ou compte famille collaborateur) ;
    les modifications sont synchronisées en direct sur la liste partagée.
    """

    mode = "keep"

    def __init__(
        self,
        email: str,
        master_token: str,
        list_id: str,
        list_title_fallback: Optional[str] = None,
        state_file: Optional[Path] = None,
        min_sync_interval_s: float = 3.0,
    ) -> None:
        import gkeepapi  # Import paresseux pour permettre le mode démo sans gkeepapi

        self._gkeepapi = gkeepapi
        self._lock = threading.RLock()
        self._email = email
        self._master_token = master_token
        self.list_id = list_id
        self.list_title_fallback = list_title_fallback
        self._state_file = state_file
        self._min_sync_interval_s = min_sync_interval_s
        self._last_sync_ts = 0.0
        self._keep = gkeepapi.Keep()
        self._authenticated = False

    def _authenticate(self) -> None:
        state = None
        if self._state_file and self._state_file.exists():
            try:
                state = json.loads(self._state_file.read_text(encoding="utf-8"))
                logger.info("Chargement du cache d'état Google Keep depuis %s", self._state_file)
            except Exception as exc:
                logger.warning("Impossible de lire le cache Keep (%s), resynchronisation complète.", exc)
                state = None

        self._keep.authenticate(self._email, self._master_token, state=state, sync=True)
        self._authenticated = True
        self._last_sync_ts = time.monotonic()
        self._persist_state()

    def _persist_state(self) -> None:
        if not self._state_file:
            return
        try:
            self._state_file.parent.mkdir(parents=True, exist_ok=True)
            serialized = self._keep.dump()
            tmp = self._state_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(serialized), encoding="utf-8")
            tmp.replace(self._state_file)
        except Exception as exc:
            logger.warning("Impossible d'enregistrer le cache Keep : %s", exc)

    def _ensure_synced(self, force: bool = False) -> None:
        if not self._authenticated:
            self._authenticate()
            return

        now = time.monotonic()
        if force or (now - self._last_sync_ts) >= self._min_sync_interval_s:
            try:
                self._keep.sync()
                self._last_sync_ts = time.monotonic()
                self._persist_state()
            except Exception as exc:
                logger.warning("Erreur de synchro Keep (%s), tentative de ré-authentification...", exc)
                self._authenticated = False
                self._authenticate()

    def _get_target_list(self):
        # 1. Recherche directe par ID (l'ID présent dans l'URL Keep)
        note = self._keep.get(self.list_id)
        if note is not None:
            return note

        # 2. Recherche étendue sur id et server_id parmi toutes les notes actives
        for candidate in self._keep.all():
            if candidate.trashed:
                continue
            if candidate.id == self.list_id or getattr(candidate, "server_id", None) == self.list_id:
                return candidate

        # 3. Repli optionnel par titre exact (insensible à la casse)
        if self.list_title_fallback:
            target_norm = _normalize_text(self.list_title_fallback)
            for candidate in self._keep.all():
                if candidate.trashed:
                    continue
                if isinstance(candidate, self._gkeepapi.node.List):
                    if _normalize_text(candidate.title or "") == target_norm:
                        return candidate

        raise KeepStoreError(
            f"Liste Google Keep introuvable (ID={self.list_id}). "
            "Vérifiez que la liste est bien partagée avec le compte configuré dans GOOGLE_EMAIL."
        )

    def _serialize_list(self, glist) -> Dict[str, Any]:
        if not isinstance(glist, self._gkeepapi.node.List):
            raise KeepStoreError(
                "La note trouvée dans Google Keep n'est pas une liste à cases à cocher."
            )

        items = []
        # Tri cohérent avec Google Keep : sort décroissant (valeur la plus grande en haut)
        for item in sorted(glist.items, key=lambda x: getattr(x, "sort", 0), reverse=True):
            if getattr(item, "deleted", False):
                continue
            items.append(
                {
                    "id": item.id,
                    "text": item.text or "",
                    "checked": bool(item.checked),
                    "sort": int(getattr(item, "sort", 0)),
                }
            )

        return {
            "mode": self.mode,
            "list_id": self.list_id,
            "title": glist.title or "Liste de courses",
            "keep_url": (
                f"https://keep.google.com/u/0/share?pli=1#LIST/{self.list_id}"
                if self.list_id
                else DEFAULT_KEEP_URL
            ),
            "updated_at": _utc_now_iso(),
            "items": items,
        }

    def get_list(self, force_sync: bool = False) -> Dict[str, Any]:
        with self._lock:
            self._ensure_synced(force=force_sync)
            glist = self._get_target_list()
            return self._serialize_list(glist)

    def add_item(self, raw_text: str, added_by: Optional[str] = None) -> Dict[str, Any]:
        text = _format_item_text(raw_text)
        if not text:
            raise KeepStoreError("Le texte de l'article est vide.")

        norm = _normalize_text(text)
        with self._lock:
            self._ensure_synced(force=True)
            glist = self._get_target_list()

            # Anti-doublon intelligent : si déjà coché, on le décoche simplement !
            for existing in glist.items:
                if getattr(existing, "deleted", False):
                    continue
                if _normalize_text(existing.text or "") == norm:
                    if existing.checked:
                        existing.checked = False
                        self._keep.sync()
                        self._last_sync_ts = time.monotonic()
                        self._persist_state()
                        return {
                            "action": "unchecked_existing",
                            "item": {
                                "id": existing.id,
                                "text": existing.text,
                                "checked": False,
                                "sort": int(getattr(existing, "sort", 0)),
                            },
                            "list": self._serialize_list(glist),
                        }
                    return {
                        "action": "already_exists",
                        "item": {
                            "id": existing.id,
                            "text": existing.text,
                            "checked": False,
                            "sort": int(getattr(existing, "sort", 0)),
                        },
                        "list": self._serialize_list(glist),
                    }

            placement = self._gkeepapi.node.NewListItemPlacementValue.Top
            new_item = glist.add(text, False, placement)
            self._keep.sync()
            self._last_sync_ts = time.monotonic()
            self._persist_state()
            return {
                "action": "added",
                "item": {
                    "id": new_item.id,
                    "text": new_item.text,
                    "checked": bool(new_item.checked),
                    "sort": int(getattr(new_item, "sort", 0)),
                },
                "list": self._serialize_list(glist),
            }

    def update_item(
        self, item_id: str, checked: Optional[bool] = None, text: Optional[str] = None
    ) -> Dict[str, Any]:
        with self._lock:
            self._ensure_synced(force=True)
            glist = self._get_target_list()
            target = next((i for i in glist.items if i.id == item_id), None)
            if target is None:
                raise KeyError(f"Article introuvable : {item_id}")

            if checked is not None:
                target.checked = bool(checked)
            if text is not None:
                formatted = _format_item_text(text)
                if not formatted:
                    raise KeepStoreError("Le texte ne peut pas être vide.")
                target.text = formatted

            self._keep.sync()
            self._last_sync_ts = time.monotonic()
            self._persist_state()
            return {
                "item": {
                    "id": target.id,
                    "text": target.text,
                    "checked": bool(target.checked),
                    "sort": int(getattr(target, "sort", 0)),
                },
                "list": self._serialize_list(glist),
            }

    def delete_item(self, item_id: str) -> Dict[str, Any]:
        with self._lock:
            self._ensure_synced(force=True)
            glist = self._get_target_list()
            target = next((i for i in glist.items if i.id == item_id), None)
            if target is None:
                raise KeyError(f"Article introuvable : {item_id}")

            target.delete()
            self._keep.sync()
            self._last_sync_ts = time.monotonic()
            self._persist_state()
            return {"deleted_id": item_id, "list": self._serialize_list(glist)}

    def clear_checked(self) -> Dict[str, Any]:
        with self._lock:
            self._ensure_synced(force=True)
            glist = self._get_target_list()
            checked_items = list(glist.checked)
            for item in checked_items:
                item.delete()
            if checked_items:
                self._keep.sync()
                self._last_sync_ts = time.monotonic()
                self._persist_state()
            return {"removed_count": len(checked_items), "list": self._serialize_list(glist)}

    def uncheck_all(self) -> Dict[str, Any]:
        with self._lock:
            self._ensure_synced(force=True)
            glist = self._get_target_list()
            checked_items = list(glist.checked)
            for item in checked_items:
                item.checked = False
            if checked_items:
                self._keep.sync()
                self._last_sync_ts = time.monotonic()
                self._persist_state()
            return {"unchecked_count": len(checked_items), "list": self._serialize_list(glist)}


def create_store_from_env() -> GoogleKeepShoppingStore | LocalJsonShoppingStore:
    """Instancie le client Keep réel ou le stockage démo selon les variables d'environnement."""
    email = os.getenv("GOOGLE_EMAIL", "").strip()
    master_token = os.getenv("GOOGLE_MASTER_TOKEN", "").strip()
    list_id = os.getenv("KEEP_LIST_ID", DEFAULT_KEEP_LIST_ID).strip() or DEFAULT_KEEP_LIST_ID
    list_title_fallback = os.getenv("KEEP_LIST_TITLE", "").strip() or None
    force_demo = os.getenv("KEEP_DEMO_MODE", "").strip().lower() in {"1", "true", "yes"}

    data_dir = Path(os.getenv("DATA_DIR", Path(__file__).parent / "data"))

    if not force_demo and email and master_token:
        logger.info("Démarrage en mode Google Keep réel (%s, liste %s)", email, list_id)
        return GoogleKeepShoppingStore(
            email=email,
            master_token=master_token,
            list_id=list_id,
            list_title_fallback=list_title_fallback,
            state_file=data_dir / "keep_state.json",
        )

    logger.warning(
        "GOOGLE_EMAIL ou GOOGLE_MASTER_TOKEN absent : démarrage en mode Démo local (%s).",
        data_dir / "demo_list.json",
    )
    return LocalJsonShoppingStore(
        data_file=data_dir / "demo_list.json",
        list_id=list_id,
        list_title=list_title_fallback or "Liste de courses",
    )
