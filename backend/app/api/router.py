from __future__ import annotations

from fastapi import APIRouter

from app.api.routes.health import router as health_router
from app.api.routes.auth import router as auth_router
from app.api.routes.runs import router as runs_router
from app.api.routes.strategies import router as strategies_router
from app.api.routes.users import router as users_router


api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
api_router.include_router(strategies_router, prefix="/strategies", tags=["strategies"])
api_router.include_router(runs_router, prefix="/runs", tags=["runs"])
