from __future__ import annotations

from pydantic import AliasChoices, AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

  app_env: str = "local"
  app_name: str = "vibe-trading-api"
  log_level: str = "INFO"

  database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/vibetrading"
  redis_url: str = "redis://localhost:6379/0"

  supabase_jwt_secret: str | None = Field(default=None, validation_alias=AliasChoices("SUPABASE_JWT_SECRET", "SUPABASE_SECRET_KEY"))
  oauth_jwt_secret: str | None = None
  oauth_ingest_secret: str | None = None
  supabase_project_url: str | None = None

  llm_base_url: AnyHttpUrl = "https://api.openai.com/v1"
  llm_api_key: str | None = None
  llm_model: str = "gpt-4.1-mini"

  market_data_provider: str = "alpaca"
  polygon_api_key: str | None = None
  alpaca_data_base_url: AnyHttpUrl = "https://data.alpaca.markets"
  alpaca_data_feed: str = "iex"
  alpaca_paper_api_endpoint: AnyHttpUrl = "https://paper-api.alpaca.markets"
  alpaca_paper_api_key: str | None = None
  alpaca_paper_api_secret: str | None = None

  allowed_origins: str = "http://localhost:5173"
  allowed_origin_regex: str | None = None

  @property
  def allowed_origins_list(self) -> list[str]:
    return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
