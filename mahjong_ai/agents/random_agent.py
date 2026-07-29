from __future__ import annotations

import random

import numpy as np

from mahjong_ai.agents.base import BaseAgent


class RandomAgent(BaseAgent):
    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)

    def act(
        self,
        observation: np.ndarray,
        legal_actions: list[int],
        info: dict | None = None,
    ) -> int:
        if not legal_actions:
            raise ValueError("RandomAgent received empty legal_actions")
        return int(self.rng.choice(legal_actions))

