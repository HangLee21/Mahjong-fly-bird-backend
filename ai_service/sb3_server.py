from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sb3_contrib import MaskablePPO
from stable_baselines3 import A2C, DQN, PPO
from stable_baselines3.common.base_class import BaseAlgorithm


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = ROOT / "model" / "v3-lite.zip"


class ActRequest(BaseModel):
    room_id: str
    game_id: str
    player_id: int
    model_version: str = "v3-lite"
    observation: list[float]
    legal_actions: list[int] = Field(default_factory=list)
    observation_version: str | None = None
    action_version: str | None = None
    rule_version: str | None = None


class ModelRegistry:
    def __init__(self) -> None:
        self._models: dict[str, BaseAlgorithm] = {}

    def path_for(self, model_version: str) -> Path:
        env_path = os.getenv("SB3_MODEL_PATH")
        if env_path:
            return Path(env_path)
        if model_version and model_version != "default":
            candidate = ROOT / "model" / f"{model_version}.zip"
            if candidate.exists():
                return candidate
        return DEFAULT_MODEL_PATH

    def get(self, model_version: str) -> BaseAlgorithm:
        path = self.path_for(model_version)
        key = str(path)
        if key not in self._models:
            install_numpy_pickle_aliases()
            algos = {"MASKABLEPPO": MaskablePPO, "PPO": PPO, "DQN": DQN, "A2C": A2C}
            preferred = os.getenv("SB3_ALGO", "MASKABLEPPO").upper()
            preferred_algo = algos.get(preferred, MaskablePPO)
            ordered = [preferred_algo, *[algo for name, algo in algos.items() if algo is not preferred_algo]]
            last_error: Exception | None = None
            for algo in ordered:
                try:
                    self._models[key] = algo.load(path)
                    break
                except Exception as error:
                    last_error = error
            if key not in self._models:
                raise RuntimeError(f"Unable to load SB3 model at {path}") from last_error
        return self._models[key]


registry = ModelRegistry()
app = FastAPI(title="Mahjong Fly Bird SB3 AI Service")


def install_numpy_pickle_aliases() -> None:
    """Allow NumPy 2 pickles to load under NumPy 1.x.

    SB3 2.4 requires NumPy < 2, but the bundled model was saved from an
    environment that referenced ``numpy._core`` in pickle metadata.
    """

    try:
        import numpy.core as numpy_core
        import numpy.core.numeric as numpy_numeric
    except Exception:
        return
    sys.modules.setdefault("numpy._core", numpy_core)
    sys.modules.setdefault("numpy._core.numeric", numpy_numeric)


def normalize_observation(model: BaseAlgorithm, observation: list[float]) -> np.ndarray:
    expected_shape = getattr(model.observation_space, "shape", None)
    if not expected_shape:
        return np.asarray(observation, dtype=np.float32)

    expected_size = int(np.prod(expected_shape))
    values = np.asarray(observation, dtype=np.float32).reshape(-1)
    if values.size < expected_size:
        values = np.pad(values, (0, expected_size - values.size))
    elif values.size > expected_size:
        values = values[:expected_size]
    return values.reshape(expected_shape)


def build_action_mask(model: BaseAlgorithm, legal_actions: list[int]) -> np.ndarray | None:
    action_count = getattr(model.action_space, "n", None)
    if action_count is None:
        return None

    mask = np.zeros(int(action_count), dtype=bool)
    for action in legal_actions:
        if 0 <= action < mask.size:
            mask[action] = True
    return mask


@app.get("/health")
def health() -> dict[str, Any]:
    path = registry.path_for("v3-lite")
    return {"ok": True, "modelPath": str(path), "modelExists": path.exists()}


@app.post("/ai/act")
def act(request: ActRequest) -> dict[str, Any]:
    legal = request.legal_actions
    if not legal:
        return {"action": 100, "model_version": request.model_version, "confidence": 0.0, "fallback": True}

    model = registry.get(request.model_version)
    observation = normalize_observation(model, request.observation)
    action_mask = build_action_mask(model, legal)
    try:
        action_raw, _state = model.predict(observation, deterministic=True, action_masks=action_mask)
    except TypeError:
        action_raw, _state = model.predict(observation, deterministic=True)
    action = int(np.asarray(action_raw).reshape(-1)[0])

    # The backend is authoritative and validates legality again. This local
    # guard keeps an unmasked SB3 policy from sending obviously illegal actions.
    if action not in legal:
        action = legal[0]
        fallback = True
    else:
        fallback = False

    return {
        "action": action,
        "model_version": request.model_version,
        "confidence": None,
        "fallback": fallback,
    }
