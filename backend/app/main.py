from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.errors import AppError, app_error_handler, unhandled_error_handler
from app.core.logging import configure_logging

def create_app() -> FastAPI:
  configure_logging(settings.log_level)

  app = FastAPI(title=settings.app_name)
  app.add_exception_handler(AppError, app_error_handler)
  app.add_exception_handler(Exception, unhandled_error_handler)

  app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
  )

  app.include_router(api_router, prefix="/api")

  return app


app = create_app()
