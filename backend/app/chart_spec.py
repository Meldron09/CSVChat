"""Chart Spec (ADR-0001): the declarative, validated description of one chart that the frontend draws with Recharts.

JSON shape (`ChartSpec.model_dump()`):
    {"type": "line"|"bar"|"pie"|"scatter", "title": str, "x_key": str, "x_label": str, "y_label": str,
     "series": [{"key": str, "label": str}],      # one or more value columns (exactly one for pie and scatter)
     "data": [{x_key: str|number, <series key>: number, ...}]}   # inline rows
Pie: `x_key` names the slice, the one series is its size. Scatter: `x_key` and the series key are both numeric.
"""

import math
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

MAX_CHARTS = 3  # per Answer
MAX_ROWS = 200

ChartSpecData = dict[str, Any]  # a validated spec as stored in the state and sent to the client: `ChartSpec.model_dump()`


class Series(BaseModel):
    key: str = Field(min_length=1, description="Key of the value in each data row")
    label: str = Field(min_length=1, description="Legend label")


class ChartSpec(BaseModel):
    type: Literal["line", "bar", "pie", "scatter"]
    title: str = Field(min_length=1)
    x_key: str = Field(min_length=1, description="Key of the x value (pie: the slice name) in each data row")
    x_label: str = Field(min_length=1)
    y_label: str = Field(min_length=1)
    series: list[Series] = Field(min_length=1, max_length=5)
    data: list[dict[str, str | float | None]] = Field(min_length=1, max_length=MAX_ROWS)

    @model_validator(mode="after")
    def _consistent(self):
        if self.type in ("pie", "scatter") and len(self.series) != 1:
            raise ValueError(f"a {self.type} chart needs exactly one series")
        for row in self.data:
            x = row.get(self.x_key)
            if x is None or (self.type == "scatter" and isinstance(x, str)):
                raise ValueError(f"every row needs {'a numeric' if self.type == 'scatter' else 'a'} value for x_key {self.x_key!r}")
            for s in self.series:  # values are finite numbers, or null for a gap
                v = row.get(s.key)
                if v is not None and (isinstance(v, str) or not math.isfinite(v)):
                    raise ValueError(f"series {s.key!r} must be numeric in every row, got {v!r}")
                if self.type == "pie" and v is not None and v < 0:
                    raise ValueError("pie values must not be negative")
        return self
