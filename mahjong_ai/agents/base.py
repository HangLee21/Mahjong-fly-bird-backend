from __future__ import annotations

import numpy as np


class BaseAgent:
    def act(
        self,
        observation: np.ndarray,
        legal_actions: list[int],
        info: dict | None = None,
    ) -> int:
        raise NotImplementedError

