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
  task_queue_enabled: bool = False
  task_queue_name: str = "vibe-runs"
  task_queue_job_timeout_seconds: int = 7200
  task_queue_recovery_lookback_hours: int = 24

  supabase_secret_key: str | None = Field(default=None, validation_alias=AliasChoices("SUPABASE_SECRET_KEY"))
  supabase_project_url: str | None = None
  auth_mode: str = "local_jwt"
  supabase_jwt_issuer: str | None = None
  supabase_jwt_audiences: str = "authenticated"
  supabase_jwks_cache_ttl_seconds: int = 600
  supabase_storage_enabled: bool = False
  supabase_storage_bucket: str = "run-artifacts"
  supabase_storage_signed_url_ttl_seconds: int = 3600

  llm_base_url: AnyHttpUrl = "https://api.openai.com/v1"
  llm_api_key: str | None = None
  llm_model: str = "gpt-5-mini"
  llm_request_timeout_seconds: int = 120
  llm_max_retries: int = 2
  llm_retry_backoff_seconds: float = 1.0
  llm_semantic_repair_attempts: int = 1

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

  @property
  def supabase_jwt_audiences_list(self) -> list[str]:
    return [a.strip() for a in self.supabase_jwt_audiences.split(",") if a.strip()]


settings = Settings()
