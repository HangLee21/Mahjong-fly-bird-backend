from __future__ import annotations

from typing import Any

import numpy as np

from mahjong_ai.env.actions import build_action_mask, fallback_action


class MahjongPredictor:
    def __init__(self, model_path: str | None = None, config: dict | None = None, model: Any | None = None):
        self.model_path = model_path
        self.config = config or {}
        self.model = model
        if self.model is None and model_path:
            try:
                from sb3_contrib import MaskablePPO

                self.model = MaskablePPO.load(model_path)
            except Exception as exc:  # pragma: no cover
                raise RuntimeError(f"failed to load model from {model_path}") from exc

    def predict(
        self,
        observation: np.ndarray,
        legal_actions: list[int],
        deterministic: bool = True,
    ) -> dict:
        if not legal_actions:
            raise ValueError("legal_actions must be non-empty")
        mask = build_action_mask(legal_actions)
        fallback_used = False
        action: int
        if self.model is None:
            action = fallback_action(legal_actions)
            fallback_used = True
        else:
            predicted, _ = self.model.predict(
                observation,
                deterministic=deterministic,
                action_masks=mask,
            )
            action = int(predicted)
            if action not in legal_actions:
                action = fallback_action(legal_actions)
                fallback_used = True
        return {"action": action, "confidence": None, "fallback_used": fallback_used}

