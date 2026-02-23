from __future__ import annotations
from typing import Optional
from datetime import date
from sqlmodel import SQLModel, Field

class Race(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: str = Field(index=True)
    name: Optional[str] = Field(default=None)
    date: Optional[date] = Field(default=None, index=True)
    location: Optional[str] = Field(default=None)
    is_reference: bool = Field(default=False, index=True)
    note: Optional[str] = Field(default=None)

class Result(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    race_id: int = Field(foreign_key="race.id", index=True)
    event_id: str = Field(index=True)

    athlete_id: str = Field(index=True)
    first_name: str
    last_name: str
    country: str

    program_id: str = Field(index=True)
    program_name: str = Field(index=True)

    start_number: Optional[int] = Field(default=None)

    swim_sec: Optional[int] = Field(default=None)
    t1_sec: Optional[int] = Field(default=None)
    bike_sec: Optional[int] = Field(default=None)
    t2_sec: Optional[int] = Field(default=None)
    run_sec: Optional[int] = Field(default=None)
    total_sec: Optional[int] = Field(default=None, index=True)

    position: Optional[int] = Field(default=None, index=True)
    status: str = Field(index=True)
