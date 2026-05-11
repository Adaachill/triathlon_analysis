from datetime import date as date_
from sqlmodel import SQLModel, Field

class Race(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    event_id: str = Field(index=True, unique=True)
    name: str | None = Field(default=None)
    date: date_ | None = Field(default=None, index=True)
    location: str | None = Field(default=None)
    is_reference: bool = Field(default=False, index=True)
    points: int | None = Field(default=None)
    note: str | None = Field(default=None)

class Result(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)

    race_id: int = Field(foreign_key="race.id", index=True)
    event_id: str = Field(index=True)

    athlete_id: str = Field(index=True)
    first_name: str
    last_name: str
    country: str

    program_id: str = Field(index=True)
    program_name: str = Field(index=True)

    start_number: int | None = Field(default=None)

    swim_sec: int | None = Field(default=None)
    t1_sec: int | None = Field(default=None)
    bike_sec: int | None = Field(default=None)
    t2_sec: int | None = Field(default=None)
    run_sec: int | None = Field(default=None)
    total_sec: int | None = Field(default=None, index=True)

    position: int | None = Field(default=None, index=True)
    status: str = Field(index=True)
