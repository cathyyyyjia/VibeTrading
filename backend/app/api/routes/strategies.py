from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_auth_claims
from app.core.errors import AppError
from app.db.engine import get_db
from app.db.models import Strategy
from app.services.llm_client import llm_client
from app.services.spec_builder import nl_to_strategy_spec
from app.services.user_service import ensure_user_from_claims


class ParseRequest(BaseModel):
  nl: str = Field(min_length=1)
  mode: str = "BACKTEST_ONLY"
  force_llm: bool = False


class ReviewRequest(BaseModel):
  dsl: dict
  strategy_text: str = Field(min_length=1)
  locale: str = "zh"


class ReviewResponse(BaseModel):
  structure: list[str]
  consistency: list[str]
  conclusion: str
  source: str = "llm"


router = APIRouter()


@router.post("/review", response_model=ReviewResponse)
async def review_strategy(req: ReviewRequest) -> ReviewResponse:
  if not llm_client.is_configured:
    raise AppError("CONFIG_ERROR", "LLM not configured", {"missing": ["LLM_API_KEY"]}, http_status=400)

  system_prompt = (
    "You are a strict DSL verifier for trading strategies. "
    "Compare the strategy text with the DSL and output structured findings. "
    "Be strict about timeframe, symbol, indicators, entry/exit conditions, and lookback windows. "
    "If any mismatch exists, mark it with [MISMATCH] and set conclusion to NOT consistent. "
    "The output language must match the requested locale exactly (zh for Chinese, en for English)."
  )

  user_prompt = (
    "Locale: " + req.locale + "\n"
    "Strategy text (original requirement):\n" + req.strategy_text + "\n\n"
    "DSL JSON:\n" + json.dumps(req.dsl, ensure_ascii=False)
  )

  schema = {
    "type": "object",
    "additionalProperties": False,
    "required": ["structure", "consistency", "conclusion"],
    "properties": {
      "structure": {"type": "array", "items": {"type": "string"}},
      "consistency": {"type": "array", "items": {"type": "string"}},
      "conclusion": {"type": "string"},
    },
  }

  data = await llm_client.chat_json(
    system_prompt,
    user_prompt,
    schema_name="dsl_review",
    json_schema=schema,
    strict_schema=True,
  )

  structure = data.get("structure") if isinstance(data, dict) else None
  consistency = data.get("consistency") if isinstance(data, dict) else None
  conclusion = data.get("conclusion") if isinstance(data, dict) else None

  structure = structure if isinstance(structure, list) else []
  consistency = consistency if isinstance(consistency, list) else []
  conclusion = str(conclusion or "").strip()

  has_mismatch = any(isinstance(x, str) and "[MISMATCH]" in x for x in consistency)
  if has_mismatch and ("不一致" not in conclusion and "NOT" not in conclusion.upper()):
    conclusion = "结论：当前 DSL 与策略文字不一致。"

  return ReviewResponse(
    structure=[str(x) for x in structure],
    consistency=[str(x) for x in consistency],
    conclusion=conclusion,
    source="llm",
  )


@router.post("/parse")
async def parse_strategy(req: ParseRequest) -> dict:
  spec = await nl_to_strategy_spec(req.nl, req.mode, strict_llm=req.force_llm)  # type: ignore[arg-type]
  return {"spec": spec}


class StrategyListItem(BaseModel):
  strategy_id: str
  name: str
  strategy_version: str
  prompt: str | None
  created_at: str


@router.get("", response_model=list[StrategyListItem])
async def list_strategies(db: AsyncSession = Depends(get_db), claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims)) -> list[StrategyListItem]:
  provider, payload = claims
  user = await ensure_user_from_claims(db, provider, payload)
  rows = (await db.execute(select(Strategy).where(Strategy.user_id == user.id).order_by(Strategy.created_at.desc()).limit(200))).scalars().all()
  return [
    StrategyListItem(
      strategy_id=str(s.id),
      name=s.name,
      strategy_version=s.strategy_version,
      prompt=s.prompt,
      created_at=s.created_at.isoformat(),
    )
    for s in rows
  ]


class StrategyDetail(BaseModel):
  strategy_id: str
  name: str
  strategy_version: str
  prompt: str | None
  spec: dict
  created_at: str


@router.get("/{strategy_id}", response_model=StrategyDetail)
async def get_strategy(strategy_id: uuid.UUID, db: AsyncSession = Depends(get_db), claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims)) -> StrategyDetail:
  provider, payload = claims
  user = await ensure_user_from_claims(db, provider, payload)
  s = (await db.execute(select(Strategy).where(Strategy.id == strategy_id, Strategy.user_id == user.id))).scalar_one()
  return StrategyDetail(
    strategy_id=str(s.id),
    name=s.name,
    strategy_version=s.strategy_version,
    prompt=s.prompt,
    spec=s.spec,
    created_at=s.created_at.isoformat(),
  )


@router.delete("/{strategy_id}", status_code=204, response_class=Response)
async def delete_strategy(
  strategy_id: uuid.UUID,
  db: AsyncSession = Depends(get_db),
  claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims),
) -> Response:
  provider, payload = claims
  user = await ensure_user_from_claims(db, provider, payload)
  strategy = (await db.execute(select(Strategy).where(Strategy.id == strategy_id, Strategy.user_id == user.id))).scalar_one_or_none()
  if strategy is None:
    raise AppError("DATA_UNAVAILABLE", "strategy not found", {"strategy_id": str(strategy_id)}, http_status=404)
  await db.delete(strategy)
  await db.commit()
  return Response(status_code=204)


