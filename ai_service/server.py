from __future__ import annotations

import argparse
import io
import json
import os
import sys
import threading
import time
import zipfile
from dataclasses import fields
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import yaml

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel, Field
except ImportError:  # pragma: no cover
    FastAPI = None
    HTTPException = None
    BaseModel = object

    def Field(default: Any, **_: Any) -> Any:
        return default

from mahjong_ai.env.actions import (
    ACTION_CHOW_LEFT,
    ACTION_CHOW_MIDDLE,
    ACTION_CHOW_RIGHT,
    ACTION_KONG_ADDED,
    ACTION_KONG_CONCEALED,
    ACTION_KONG_EXPOSED,
    ACTION_PASS,
    ACTION_PONG,
    ACTION_WIN,
    build_action_mask,
    decode_action,
    fallback_action,
    is_discard,
)
from mahjong_ai.env.observation import build_observation, get_observation_dim
from mahjong_ai.rules.flybird import FlybirdRuleEngine, GameState, Meld, PendingClaim

# Import custom policy modules so SB3 can deserialize V3 full/lite checkpoints
# whose zip metadata points at these classes.
import mahjong_ai.models.action_value_policy  # noqa: F401
import mahjong_ai.models.feature_extractor  # noqa: F401


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = ROOT / "model" / "v3-lite.zip"
DEFAULT_CONFIG_PATH = ROOT / "model" / "config" / "ppo_v3_lite_action_value_bc_finetune.yaml"

TILE_NAMES = [
    *(f"{i}万" for i in range(1, 10)),
    *(f"{i}筒" for i in range(1, 10)),
    *(f"{i}条" for i in range(1, 10)),
    "东",
    "南",
    "西",
    "北",
    "中",
    "发",
    "白",
]


if FastAPI is not None:

    class PredictRequest(BaseModel):
        state: dict[str, Any] = Field(..., description="Flybird GameState compatible JSON.")
        player_id: int | None = Field(None, description="Defaults to rule engine current player.")
        deterministic: bool = True
        legal_actions: list[int] | None = Field(None, description="Optional override from the game server.")

    class LegalActionsRequest(BaseModel):
        state: dict[str, Any]
        player_id: int | None = None


class AIRuntime:
    def __init__(self, model_path: Path, config_path: Path, device: str = "auto"):
        self.model_path = model_path
        self.config_path = config_path
        self.device = device
        self.config = _load_config(config_path)
        self.env_config = _build_env_config(self.config)
        self.rule_engine = FlybirdRuleEngine(
            allow_chow=bool(self.env_config.get("allow_chow", True)),
            draw_wall_tiles=int(self.env_config.get("draw_wall_tiles", 20)),
        )
        self.model = self._load_model(model_path, device)
        self.lock = threading.Lock()

    @staticmethod
    def _load_model(model_path: Path, device: str):
        if not model_path.exists():
            raise FileNotFoundError(
                f"model not found: {model_path}. Copy your trained model to this path or set MAHJONG_AI_MODEL."
            )
        install_numpy_pickle_aliases()
        import torch
        from sb3_contrib import MaskablePPO

        original_torch_load = torch.load

        def load_zip_entry(file: Any, *args: Any, **kwargs: Any):
            if isinstance(file, zipfile.ZipExtFile):
                file = io.BytesIO(file.read())
            return original_torch_load(file, *args, **kwargs)

        torch.load = load_zip_entry
        try:
            return MaskablePPO.load(str(model_path), device=device)
        finally:
            torch.load = original_torch_load

    def predict(
        self,
        state: GameState,
        player_id: int | None = None,
        deterministic: bool = True,
        legal_actions: list[int] | None = None,
    ) -> dict[str, Any]:
        acting_player = self.rule_engine.get_current_player(state) if player_id is None else int(player_id)
        legal = list(legal_actions) if legal_actions is not None else self.rule_engine.get_legal_actions(state, acting_player)
        if not legal:
            raise ValueError(f"no legal actions for player {acting_player}")

        observation = build_observation(self.rule_engine, state, acting_player, self.env_config)
        if isinstance(observation, dict):
            raise ValueError("history/dict observations are not supported by this HTTP server yet")
        observation = np.asarray(observation, dtype=np.float32)
        action_mask = build_action_mask(legal)

        started = time.perf_counter()
        with self.lock:
            predicted, _ = self.model.predict(
                observation,
                deterministic=deterministic,
                action_masks=action_mask,
            )
        latency_ms = (time.perf_counter() - started) * 1000.0

        action = int(predicted)
        fallback_used = False
        if action not in legal:
            action = fallback_action(legal)
            fallback_used = True

        decoded = decode_action(action)
        return {
            "action": action,
            "action_type": decoded.type,
            "tile": decoded.tile,
            "tile_text": tile_text(decoded.tile),
            "action_text": action_text(action),
            "legal_actions": legal,
            "legal_action_text": [action_text(a) for a in legal],
            "player_id": acting_player,
            "fallback_used": fallback_used,
            "latency_ms": latency_ms,
            "state_hash": self.rule_engine.get_state_hash(state),
            "observation_shape": list(observation.shape),
        }


app = FastAPI(title="Mahjong Flybird AI Server", version="1.0.0") if FastAPI is not None else None
_runtime: AIRuntime | None = None


def health_payload() -> dict[str, Any]:
    runtime = get_runtime()
    obs_dim = get_observation_dim(runtime.env_config)
    model_space = getattr(runtime.model, "observation_space", None)
    return {
        "ok": True,
        "model_path": str(runtime.model_path),
        "config_path": str(runtime.config_path),
        "device": str(runtime.model.device),
        "observation_dim_from_config": obs_dim,
        "observation_space": None if model_space is None else str(model_space),
    }


def legal_actions_payload(payload: dict[str, Any]) -> dict[str, Any]:
    runtime = get_runtime()
    state = game_state_from_payload(payload["state"])
    request_player = payload.get("player_id")
    player_id = runtime.rule_engine.get_current_player(state) if request_player is None else int(request_player)
    legal = runtime.rule_engine.get_legal_actions(state, player_id)
    return {
        "player_id": player_id,
        "legal_actions": legal,
        "legal_action_text": [action_text(a) for a in legal],
        "state_hash": runtime.rule_engine.get_state_hash(state),
    }


def predict_payload(payload: dict[str, Any]) -> dict[str, Any]:
    runtime = get_runtime()
    state = game_state_from_payload(payload["state"])
    return runtime.predict(
        state,
        player_id=payload.get("player_id"),
        deterministic=bool(payload.get("deterministic", True)),
        legal_actions=payload.get("legal_actions"),
    )


if app is not None:

    @app.get("/health")
    def health() -> dict[str, Any]:
        return health_payload()

    @app.post("/legal-actions")
    def legal_actions(req: LegalActionsRequest) -> dict[str, Any]:  # type: ignore[name-defined]
        try:
            return legal_actions_payload(req.dict())
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/predict")
    def predict(req: PredictRequest) -> dict[str, Any]:  # type: ignore[name-defined]
        try:
            return predict_payload(req.dict())
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


def get_runtime() -> AIRuntime:
    global _runtime
    if _runtime is not None:
        return _runtime

    model_path = Path(os.environ.get("MAHJONG_AI_MODEL", str(DEFAULT_MODEL_PATH))).resolve()
    config_path = Path(os.environ.get("MAHJONG_AI_CONFIG", str(DEFAULT_CONFIG_PATH))).resolve()
    device = os.environ.get("MAHJONG_AI_DEVICE", "auto")
    try:
        _runtime = AIRuntime(model_path=model_path, config_path=config_path, device=device)
    except Exception as exc:
        if HTTPException is not None:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        raise RuntimeError(str(exc)) from exc
    return _runtime


def _load_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        raise FileNotFoundError(f"config not found: {config_path}")
    with config_path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _build_env_config(train_config: dict[str, Any]) -> dict[str, Any]:
    env_config: dict[str, Any] = {**train_config.get("env", {})}
    env_config["reward"] = train_config.get("reward", {})
    for key in ("observation", "action_features", "opponent_pool"):
        if key in train_config:
            env_config[key] = train_config[key]
    return env_config


def install_numpy_pickle_aliases() -> None:
    try:
        import numpy.core as numpy_core
        import numpy.core.numeric as numpy_numeric
    except Exception:
        return
    sys.modules.setdefault("numpy._core", numpy_core)
    sys.modules.setdefault("numpy._core.numeric", numpy_numeric)


def game_state_from_payload(payload: dict[str, Any]) -> GameState:
    data = dict(payload)
    data["hands"] = _list_of_int_lists(data.get("hands", [[] for _ in range(4)]), 4)
    data["discards"] = _list_of_int_lists(data.get("discards", [[] for _ in range(4)]), 4)
    data["melds"] = _parse_meld_groups(data.get("melds", [[] for _ in range(4)]))
    data["scores"] = [float(v) for v in data.get("scores", [0.0, 0.0, 0.0, 0.0])]
    data["wall"] = _parse_wall(data)
    data["kong_pool"] = [int(v) for v in data.get("kong_pool", [])]
    data["pending"] = _parse_pending(data.get("pending"))

    for key in ("same_round_furiten", "reject_pong_tiles"):
        if key in data:
            data[key] = [set(int(v) for v in group) for group in _ensure_len(data[key], 4, [])]
    if "reject_win_furiten" in data:
        data["reject_win_furiten"] = [bool(v) for v in _ensure_len(data["reject_win_furiten"], 4, False)]
    if "wind_discards_first_round" in data:
        data["wind_discards_first_round"] = [
            None if v is None else int(v) for v in _ensure_len(data["wind_discards_first_round"], 4, None)
        ]
    if "special_discards" in data:
        data["special_discards"] = _list_of_int_lists(data["special_discards"], 4)
    if "discarded_non_special" in data:
        data["discarded_non_special"] = [bool(v) for v in _ensure_len(data["discarded_non_special"], 4, False)]

    allowed = {field.name for field in fields(GameState)}
    cleaned = {key: value for key, value in data.items() if key in allowed}
    return GameState(**cleaned)


def _parse_wall(data: dict[str, Any]) -> list[int]:
    if "wall" in data and data["wall"] is not None:
        return [int(v) for v in data["wall"]]
    wall_count = data.get("wall_count", data.get("remaining_wall", 0))
    return [0] * int(wall_count)


def _parse_pending(value: Any) -> PendingClaim | None:
    if value is None:
        return None
    if isinstance(value, PendingClaim):
        return value
    if not isinstance(value, dict):
        raise ValueError("pending must be null or an object")
    allowed = {field.name for field in fields(PendingClaim)}
    return PendingClaim(**{key: val for key, val in value.items() if key in allowed})


def _parse_meld_groups(value: Any) -> list[list[Meld]]:
    groups = _ensure_len(value or [], 4, [])
    parsed: list[list[Meld]] = []
    for group in groups:
        player_melds: list[Meld] = []
        for item in group or []:
            if isinstance(item, Meld):
                player_melds.append(item)
            elif isinstance(item, dict):
                allowed = {field.name for field in fields(Meld)}
                payload = {key: val for key, val in item.items() if key in allowed}
                payload["tiles"] = [int(v) for v in payload.get("tiles", [])]
                player_melds.append(Meld(**payload))
            elif isinstance(item, list):
                player_melds.append(Meld(type="meld", tiles=[int(v) for v in item]))
            else:
                raise ValueError(f"invalid meld item: {item!r}")
        parsed.append(player_melds)
    return parsed


def _list_of_int_lists(value: Any, length: int) -> list[list[int]]:
    return [[int(tile) for tile in group] for group in _ensure_len(value or [], length, [])]


def _ensure_len(value: Any, length: int, fill: Any) -> list[Any]:
    result = list(value or [])
    while len(result) < length:
        result.append([] if fill == [] else fill)
    return result[:length]


def tile_text(tile: int | None) -> str | None:
    if tile is None:
        return None
    if 0 <= int(tile) < len(TILE_NAMES):
        return TILE_NAMES[int(tile)]
    return str(tile)


def action_text(action_id: int) -> str:
    if is_discard(action_id):
        return f"打{tile_text(action_id)}"
    mapping = {
        ACTION_PASS: "过",
        ACTION_WIN: "胡",
        ACTION_PONG: "碰",
        ACTION_CHOW_LEFT: "吃左",
        ACTION_CHOW_MIDDLE: "吃中",
        ACTION_CHOW_RIGHT: "吃右",
        ACTION_KONG_EXPOSED: "明杠",
        ACTION_KONG_CONCEALED: "暗杠",
        ACTION_KONG_ADDED: "加杠",
    }
    return mapping.get(int(action_id), str(action_id))


class JsonHandler(BaseHTTPRequestHandler):
    server_version = "MahjongFlybirdAIServer/1.0"

    def do_GET(self) -> None:
        if self.path == "/health":
            self._write_json(200, health_payload())
            return
        self._write_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        try:
            payload = self._read_json()
            if self.path == "/predict":
                self._write_json(200, predict_payload(payload))
                return
            if self.path == "/legal-actions":
                self._write_json(200, legal_actions_payload(payload))
                return
            self._write_json(404, {"error": "not found"})
        except Exception as exc:
            self._write_json(400, {"error": str(exc)})

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main() -> None:
    parser = argparse.ArgumentParser(description="Start Mahjong Flybird AI HTTP server.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--model", default=str(DEFAULT_MODEL_PATH))
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH))
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    os.environ["MAHJONG_AI_MODEL"] = args.model
    os.environ["MAHJONG_AI_CONFIG"] = args.config
    os.environ["MAHJONG_AI_DEVICE"] = args.device

    if app is not None:
        try:
            import uvicorn

            uvicorn.run(app, host=args.host, port=args.port)
            return
        except ImportError:
            pass

    server = ThreadingHTTPServer((args.host, args.port), JsonHandler)
    print(f"Mahjong AI server listening on http://{args.host}:{args.port}")
    print("FastAPI/uvicorn not found; using the built-in HTTP server.")
    server.serve_forever()


if __name__ == "__main__":
    main()
