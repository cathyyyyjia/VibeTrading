from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_db
from app.db.models import Strategy
from app.services.spec_builder import nl_to_strategy_spec


class ParseRequest(BaseModel):
  nl: str = Field(min_length=1)
  mode: str = "BACKTEST_ONLY"


router = APIRouter()


@router.post("/parse")
async def parse_strategy(req: ParseRequest) -> dict:
  spec = await nl_to_strategy_spec(req.nl, req.mode)  # type: ignore[arg-type]
  return {"spec": spec}


class StrategyListItem(BaseModel):
  strategy_id: str
  name: str
  strategy_version: str
  prompt: str | None
  created_at: str


@router.get("", response_model=list[StrategyListItem])
async def list_strategies(db: AsyncSession = Depends(get_db)) -> list[StrategyListItem]:
  rows = (await db.execute(select(Strategy).order_by(Strategy.created_at.desc()).limit(200))).scalars().all()
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
async def get_strategy(strategy_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> StrategyDetail:
  s = (await db.execute(select(Strategy).where(Strategy.id == strategy_id))).scalar_one()
  return StrategyDetail(
    strategy_id=str(s.id),
    name=s.name,
    strategy_version=s.strategy_version,
    prompt=s.prompt,
    spec=s.spec,
    created_at=s.created_at.isoformat(),
  )
