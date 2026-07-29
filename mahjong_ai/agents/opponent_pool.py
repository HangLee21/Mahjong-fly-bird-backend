from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

from mahjong_ai.agents.base import BaseAgent
from mahjong_ai.agents.heuristic_agent import HeuristicAgent, WinFirstAgent
from mahjong_ai.agents.model_agent import ModelAgent
from mahjong_ai.agents.random_agent import RandomAgent


@dataclass(frozen=True)
class AgentSpec:
    kind: str
    weight: float = 1.0
    model_path: str | None = None
    device: str = "cpu"
    deterministic: bool = True
    name: str | None = None


class OpponentPool:
    """Weighted opponent sampler for V2 self-play training."""

    def __init__(self, config: dict[str, Any] | None = None, *, seed: int | None = None):
        self.config = config or {}
        self.rng = random.Random(seed)
        self.members = self._parse_members(self.config.get("members"))
        self.per_seat_sample = bool(self.config.get("per_seat_sample", True))
        self.cache_model_agents = bool(self.config.get("cache_model_agents", True))
        self._model_agent_cache: dict[tuple[str, str, bool], ModelAgent] = {}

    def sample_table(self, controlled_player: int = 0) -> list[BaseAgent | None]:
        if self.per_seat_sample:
            return [
                None if seat == controlled_player else self.sample_agent(seed_hint=seat)
                for seat in range(4)
            ]
        shared = self.sample_agent(seed_hint=controlled_player)
        return [None if seat == controlled_player else shared for seat in range(4)]

    def sample_agent(self, *, seed_hint: int = 0) -> BaseAgent:
        spec = self._sample_spec()
        seed = self.rng.randrange(1_000_000_000) + seed_hint
        return self._build_agent(spec, seed=seed)

    def _sample_spec(self) -> AgentSpec:
        total = sum(max(0.0, spec.weight) for spec in self.members)
        if total <= 0:
            raise ValueError("opponent_pool members must have positive total weight")
        pick = self.rng.random() * total
        running = 0.0
        for spec in self.members:
            running += max(0.0, spec.weight)
            if pick <= running:
                return spec
        return self.members[-1]

    def _build_agent(self, spec: AgentSpec, *, seed: int) -> BaseAgent:
        kind = spec.kind.lower()
        if kind == "random":
            return RandomAgent(seed=seed)
        if kind == "win_first":
            return WinFirstAgent(seed=seed)
        if kind == "heuristic":
            return HeuristicAgent(seed=seed)
        if kind == "model":
            if not spec.model_path:
                raise ValueError("model opponent requires model_path")
            if self.cache_model_agents:
                cache_key = (spec.model_path, spec.device, spec.deterministic)
                if cache_key not in self._model_agent_cache:
                    self._model_agent_cache[cache_key] = ModelAgent(
                        spec.model_path,
                        device=spec.device,
                        deterministic=spec.deterministic,
                        fallback=HeuristicAgent(seed=seed),
                    )
                return self._model_agent_cache[cache_key]
            return ModelAgent(
                spec.model_path,
                device=spec.device,
                deterministic=spec.deterministic,
                fallback=HeuristicAgent(seed=seed),
            )
        raise ValueError(f"unsupported opponent kind in pool: {spec.kind}")

    @staticmethod
    def _parse_members(raw_members: Any) -> list[AgentSpec]:
        if not raw_members:
            raw_members = [{"kind": "heuristic", "weight": 1.0}]
        members: list[AgentSpec] = []
        for raw in raw_members:
            if isinstance(raw, str):
                members.append(AgentSpec(kind=raw))
                continue
            if not isinstance(raw, dict):
                raise ValueError(f"invalid opponent pool member: {raw!r}")
            members.append(
                AgentSpec(
                    kind=str(raw.get("kind", "heuristic")),
                    weight=float(raw.get("weight", 1.0)),
                    model_path=raw.get("model_path"),
                    device=str(raw.get("device", "cpu")),
                    deterministic=bool(raw.get("deterministic", True)),
                    name=raw.get("name"),
                )
            )
        return members
