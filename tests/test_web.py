"""Tests for the FastAPI web app."""

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rembg")

from bgremove.web.app import app

client = TestClient(app)


def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_index_served():
    resp = client.get("/")
    assert resp.status_code == 200
    assert "bgremove" in resp.text


def test_remove_returns_png(sample_image_bytes):
    resp = client.post(
        "/api/remove",
        files={"file": ("sample.png", sample_image_bytes, "image/png")},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic number


def test_rejects_unknown_model(sample_image_bytes):
    resp = client.post(
        "/api/remove",
        files={"file": ("sample.png", sample_image_bytes, "image/png")},
        data={"model": "does-not-exist"},
    )
    assert resp.status_code == 400


def test_rejects_non_image():
    resp = client.post(
        "/api/remove",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 415
