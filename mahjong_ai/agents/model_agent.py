from __future__ import annotations

from pathlib import Path

import numpy as np

from mahjong_ai.agents.base import BaseAgent
from mahjong_ai.agents.heuristic_agent import HeuristicAgent
from mahjong_ai.env.actions import build_action_mask


class ModelAgent(BaseAgent):
    """Lazy-loaded MaskablePPO opponent used by the self-play pool."""

    def __init__(
        self,
        model_path: str,
        *,
        device: str = "cpu",
        deterministic: bool = True,
        fallback: BaseAgent | None = None,
    ):
        self.model_path = str(_resolve_model_path(model_path))
        self.device = device
        self.deterministic = bool(deterministic)
        self.fallback = fallback or HeuristicAgent(seed=0)
        self._model = None

    def act(
        self,
        observation: np.ndarray,
        legal_actions: list[int],
        info: dict | None = None,
    ) -> int:
        if not legal_actions:
            raise ValueError("ModelAgent received empty legal_actions")
        try:
            model = self._load_model()
            mask = build_action_mask(legal_actions)
            model_observation = observation
            if isinstance(observation, dict) and not hasattr(getattr(model, "observation_space", None), "spaces"):
                model_observation = observation.get("static", observation)
            action, _ = model.predict(
                model_observation,
                action_masks=mask,
                deterministic=self.deterministic,
            )
            action_int = int(action)
            if action_int in legal_actions:
                return action_int
        except Exception as exc:
            if info is not None:
                info["model_agent_error"] = str(exc)
        return int(self.fallback.act(observation, legal_actions, info))

    def _load_model(self):
        if self._model is None:
            try:
                from sb3_contrib import MaskablePPO
            except Exception as exc:  # pragma: no cover
                raise RuntimeError("sb3-contrib is required for model opponents") from exc
            self._model = MaskablePPO.load(self.model_path, device=self.device)
        return self._model


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if path.exists():
        return path

    here = Path(__file__).resolve()
    training_root = here.parents[2]
    repo_root = here.parents[3]
    candidates = [
        Path.cwd() / path,
        training_root / path,
        repo_root / path,
        repo_root / "training" / path,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return path
