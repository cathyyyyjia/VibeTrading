from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core import auth
from app.core.config import settings


def _make_rsa_token(*, issuer: str, audience: str, subject: str, kid: str) -> tuple[str, dict[str, object]]:
  private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
  public_key = private_key.public_key()
  jwk = jwt.algorithms.RSAAlgorithm.to_jwk(public_key)
  payload = {
    "iss": issuer,
    "aud": audience,
    "sub": subject,
    "role": "authenticated",
    "email": "user@example.com",
    "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
    "iat": datetime.now(timezone.utc),
  }
  token = jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": kid})
  return token, jwk


@pytest.mark.asyncio
async def test_verify_access_token_local_jwt_rs256(monkeypatch: pytest.MonkeyPatch) -> None:
  issuer = "https://example.supabase.co/auth/v1"
  token, jwk = _make_rsa_token(issuer=issuer, audience="authenticated", subject="uid-123", kid="k1")

  monkeypatch.setattr(settings, "auth_mode", "local_jwt")
  monkeypatch.setattr(settings, "supabase_jwt_issuer", issuer)
  monkeypatch.setattr(settings, "supabase_jwt_audiences", "authenticated")
  monkeypatch.setattr(auth, "_jwks_cache", (0.0, {}))
  monkeypatch.setattr(auth, "_token_cache", OrderedDict())

  async def _fake_get_jwk_for_kid(kid: str) -> dict[str, object]:
    assert kid == "k1"
    return jwk

  monkeypatch.setattr(auth, "_get_jwk_for_kid", _fake_get_jwk_for_kid)

  claims = await auth.verify_access_token(token)
  assert claims["sub"] == "uid-123"
  assert claims["email"] == "user@example.com"
  assert claims["role"] == "authenticated"


@pytest.mark.asyncio
async def test_verify_access_token_remote_mode(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(settings, "auth_mode", "remote_userinfo")
  monkeypatch.setattr(auth, "_token_cache", OrderedDict())

  async def _fake_remote(token: str) -> dict[str, object]:
    assert token == "test-token"
    return {"sub": "uid-remote", "email": "remote@example.com", "role": "authenticated"}

  monkeypatch.setattr(auth, "verify_supabase_userinfo", _fake_remote)
  claims = await auth.verify_access_token("test-token")
  assert claims["sub"] == "uid-remote"


@pytest.mark.asyncio
async def test_verify_access_token_cache_is_bounded_lru(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(settings, "auth_mode", "remote_userinfo")
  monkeypatch.setattr(settings, "auth_token_cache_max_entries", 2)
  monkeypatch.setattr(auth, "_token_cache", OrderedDict())

  async def _fake_remote(token: str) -> dict[str, object]:
    return {"sub": f"uid-{token}", "email": "remote@example.com", "role": "authenticated"}

  monkeypatch.setattr(auth, "verify_supabase_userinfo", _fake_remote)

  await auth.verify_access_token("token-1")
  await auth.verify_access_token("token-2")
  await auth.verify_access_token("token-3")

  assert len(auth._token_cache) == 2
  assert "token-1" not in auth._token_cache
  assert "token-2" in auth._token_cache
  assert "token-3" in auth._token_cache
