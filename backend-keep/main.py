"""
Serveur FastAPI pour la PWA "Courses Keep Famille".
Expose l'API REST sécurisée par PIN familial et sert directement les fichiers de la PWA Android.
"""

from __future__ import annotations

import hmac
import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from keep_client import KeepStoreError, create_store_from_env

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("courses_keep.api")

FAMILY_PIN = os.getenv("FAMILY_PIN", "").strip()
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]

app = FastAPI(
    title="Courses Keep Famille API",
    version="1.0.0",
    description="API de synchronisation Google Keep pour la PWA familiale de courses.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = create_store_from_env()


class AddItemPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=200)
    added_by: Optional[str] = Field(default=None, max_length=60)


class UpdateItemPayload(BaseModel):
    checked: Optional[bool] = None
    text: Optional[str] = Field(default=None, min_length=1, max_length=200)
    quantity: Optional[int] = Field(default=None, ge=1, le=12)


class PinPayload(BaseModel):
    pin: str = ""


def verify_family_pin(
    x_family_pin: Optional[str] = Header(default=None, alias="X-Family-Pin"),
    pin: Optional[str] = Query(default=None),
) -> None:
    """Vérifie le code PIN familial si FAMILY_PIN est défini côté serveur."""
    if not FAMILY_PIN:
        return
    provided = (x_family_pin or pin or "").strip()
    if not provided or not hmac.compare_digest(provided, FAMILY_PIN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Code PIN familial invalide ou manquant.",
        )


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "mode": store.mode,
        "pin_required": bool(FAMILY_PIN),
        "list_id": store.list_id,
        "keep_url": (
            f"https://keep.google.com/u/0/share?pli=1#LIST/{store.list_id}"
            if store.list_id
            else "https://keep.google.com/"
        ),
    }


@app.post("/api/auth/verify")
def auth_verify(payload: PinPayload) -> dict:
    if not FAMILY_PIN:
        return {"ok": True, "pin_required": False}
    ok = hmac.compare_digest(payload.pin.strip(), FAMILY_PIN)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Code PIN incorrect.",
        )
    return {"ok": True, "pin_required": True}


@app.get("/api/list", dependencies=[Depends(verify_family_pin)])
def get_list(force: bool = Query(default=False)) -> dict:
    try:
        return store.get_list(force_sync=force)
    except KeepStoreError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erreur lors de la lecture de la liste")
        raise HTTPException(status_code=500, detail=f"Erreur serveur : {exc}") from exc


@app.post("/api/items", dependencies=[Depends(verify_family_pin)], status_code=201)
def add_item(payload: AddItemPayload) -> dict:
    try:
        return store.add_item(payload.text, added_by=payload.added_by)
    except KeepStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erreur lors de l'ajout de l'article")
        raise HTTPException(status_code=500, detail=f"Erreur serveur : {exc}") from exc


@app.patch("/api/items/{item_id}", dependencies=[Depends(verify_family_pin)])
def update_item(item_id: str, payload: UpdateItemPayload) -> dict:
    try:
        return store.update_item(
            item_id, checked=payload.checked, text=payload.text, quantity=payload.quantity
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KeepStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erreur lors de la modification de l'article")
        raise HTTPException(status_code=500, detail=f"Erreur serveur : {exc}") from exc


@app.delete("/api/items/{item_id}", dependencies=[Depends(verify_family_pin)])
def delete_item(item_id: str) -> dict:
    try:
        return store.delete_item(item_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erreur lors de la suppression de l'article")
        raise HTTPException(status_code=500, detail=f"Erreur serveur : {exc}") from exc


@app.post("/api/items/clear-checked", dependencies=[Depends(verify_family_pin)])
def clear_checked() -> dict:
    try:
        return store.clear_checked()
    except Exception as exc:
        logger.exception("Erreur lors du nettoyage des articles cochés")
        raise HTTPException(status_code=500, detail=f"Erreur serveur : {exc}") from exc


@app.post("/api/items/uncheck-all", dependencies=[Depends(verify_family_pin)])
def uncheck_all() -> dict:
    try:
        return store.uncheck_all()
    except Exception as exc:
        logger.exception("Erreur lors du décochage global")
        raise HTTPException(status_code=500, detail=f"Erreur serveur : {exc}") from exc


class ReorderItemsPayload(BaseModel):
    ids: list[str] = Field(..., min_length=1)


@app.post("/api/items/reorder", dependencies=[Depends(verify_family_pin)])
def reorder_items(payload: ReorderItemsPayload) -> dict:
    try:
        return store.reorder_items(payload.ids)
    except Exception as exc:
        logger.exception("Erreur lors du réordonnancement de la liste")
        raise HTTPException(status_code=500, detail=f"Erreur serveur : {exc}") from exc


# Servir la PWA directement depuis le même serveur (pratique pour HTTPS + Android)
PWA_DIR = Path(os.getenv("PWA_DIR", Path(__file__).resolve().parent.parent / "pwa"))

if PWA_DIR.exists():
    @app.get("/sw.js")
    def serve_sw() -> FileResponse:
        return FileResponse(
            PWA_DIR / "sw.js",
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache"},
        )

    @app.get("/manifest.json")
    def serve_manifest() -> FileResponse:
        return FileResponse(
            PWA_DIR / "manifest.json",
            media_type="application/manifest+json",
            headers={"Cache-Control": "no-cache"},
        )

    app.mount("/", StaticFiles(directory=str(PWA_DIR), html=True), name="pwa")
