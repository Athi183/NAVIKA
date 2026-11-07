"""Configurable abstract edge costs for campus navigation."""

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class NavigationCosts:
    """Non-negative abstract costs; values are not metres or travel times."""

    walking: float = 1
    stairs: float = 2
    lift_journey: float = 1

    def __post_init__(self):
        for name, value in (
            ("walking", self.walking),
            ("stairs", self.stairs),
            ("lift_journey", self.lift_journey),
        ):
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} cost must be a finite non-negative number")

    def for_edge(self, edge_type: str) -> float:
        normalized = edge_type.lower().replace("-", "_")
        if normalized in {"walk", "walking", "ordinary_walking"}:
            return self.walking
        if normalized in {"stair", "stairs", "staircase", "stair_transition", "stair_floor_transition"}:
            return self.stairs
        if normalized in {"lift", "elevator", "lift_journey", "lift_ride"}:
            return self.lift_journey
        raise ValueError(f"Unsupported navigation edge type: {edge_type!r}")


DEFAULT_NAVIGATION_COSTS = NavigationCosts()
