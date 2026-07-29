from __future__ import annotations

from dataclasses import dataclass

import numpy as np

N_TILE_TYPES = 34

DISCARD_OFFSET = 0
ACTION_PASS = 100
ACTION_WIN = 101
ACTION_PONG = 102
ACTION_CHOW_LEFT = 103
ACTION_CHOW_MIDDLE = 104
ACTION_CHOW_RIGHT = 105
ACTION_KONG_EXPOSED = 106
ACTION_KONG_CONCEALED = 107
ACTION_KONG_ADDED = 108
ACTION_SPACE_SIZE = 128


@dataclass(frozen=True)
class MahjongAction:
    type: str
    tile: int | None = None
    extra: dict | None = None


def discard_action(tile: int) -> int:
    if not 0 <= tile < N_TILE_TYPES:
        raise ValueError(f"invalid tile id: {tile}")
    return DISCARD_OFFSET + tile


def is_discard(action_id: int) -> bool:
    return DISCARD_OFFSET <= action_id < DISCARD_OFFSET + N_TILE_TYPES


def encode_action(action: MahjongAction) -> int:
    if action.type == "discard":
        if action.tile is None:
            raise ValueError("discard action needs tile")
        return discard_action(action.tile)
    mapping = {
        "pass": ACTION_PASS,
        "win": ACTION_WIN,
        "pong": ACTION_PONG,
        "chow_left": ACTION_CHOW_LEFT,
        "chow_middle": ACTION_CHOW_MIDDLE,
        "chow_right": ACTION_CHOW_RIGHT,
        "kong_exposed": ACTION_KONG_EXPOSED,
        "kong_concealed": ACTION_KONG_CONCEALED,
        "kong_added": ACTION_KONG_ADDED,
    }
    try:
        return mapping[action.type]
    except KeyError as exc:
        raise ValueError(f"unknown action type: {action.type}") from exc


def decode_action(action_id: int) -> MahjongAction:
    if is_discard(action_id):
        return MahjongAction("discard", tile=action_id - DISCARD_OFFSET)
    mapping = {
        ACTION_PASS: "pass",
        ACTION_WIN: "win",
        ACTION_PONG: "pong",
        ACTION_CHOW_LEFT: "chow_left",
        ACTION_CHOW_MIDDLE: "chow_middle",
        ACTION_CHOW_RIGHT: "chow_right",
        ACTION_KONG_EXPOSED: "kong_exposed",
        ACTION_KONG_CONCEALED: "kong_concealed",
        ACTION_KONG_ADDED: "kong_added",
    }
    if action_id not in mapping:
        raise ValueError(f"invalid action id: {action_id}")
    return MahjongAction(mapping[action_id])


def build_action_mask(legal_actions: list[int]) -> np.ndarray:
    mask = np.zeros(ACTION_SPACE_SIZE, dtype=np.bool_)
    for action in legal_actions:
        if not 0 <= int(action) < ACTION_SPACE_SIZE:
            raise ValueError(f"legal action outside action space: {action}")
        mask[int(action)] = True
    return mask


def fallback_action(legal_actions: list[int]) -> int:
    if not legal_actions:
        raise ValueError("fallback_action requires non-empty legal_actions")
    if ACTION_WIN in legal_actions:
        return ACTION_WIN
    if ACTION_PASS in legal_actions:
        return ACTION_PASS
    return int(legal_actions[0])
