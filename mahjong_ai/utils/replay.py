from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np


def _jsonable(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


class ReplayLogger:
    def __init__(
        self,
        path: str | Path,
        *,
        include_observation: bool = True,
        model_version: str | None = None,
    ):
        self.path = Path(path)
        self.include_observation = include_observation
        self.model_version = model_version
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fp = self.path.open("w", encoding="utf-8")

    def log_step(
        self,
        *,
        game_id: str,
        step: int,
        player_id: int,
        state_hash_before: str,
        legal_actions: list[int],
        action: int,
        action_source: str,
        state_hash_after: str,
        reward: float,
        observation: np.ndarray | None = None,
        extra: dict | None = None,
    ) -> None:
        row: dict[str, Any] = {
            "type": "step",
            "game_id": game_id,
            "step": step,
            "player_id": player_id,
            "state_hash_before": state_hash_before,
            "legal_actions": legal_actions,
            "action": int(action),
            "action_source": action_source,
            "model_version": self.model_version,
            "state_hash_after": state_hash_after,
            "reward": float(reward),
        }
        if self.include_observation and observation is not None:
            row["observation"] = observation
        if extra:
            row.update(extra)
        self._write(row)

    def log_final(
        self,
        *,
        game_id: str,
        final_scores: list[float],
        winner: int | None,
        draw: bool,
        total_steps: int,
        model_versions: dict[str, str],
        extra: dict | None = None,
    ) -> None:
        row: dict[str, Any] = {
            "type": "final",
            "game_id": game_id,
            "final_scores": final_scores,
            "winner": winner,
            "draw": draw,
            "total_steps": total_steps,
            "model_versions": model_versions,
        }
        if extra:
            row.update(extra)
        self._write(row)

    def close(self) -> None:
        self._fp.close()

    def __enter__(self) -> "ReplayLogger":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def _write(self, row: dict[str, Any]) -> None:
        self._fp.write(json.dumps(_jsonable(row), ensure_ascii=False, separators=(",", ":")) + "\n")

