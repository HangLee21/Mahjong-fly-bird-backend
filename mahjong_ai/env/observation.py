from __future__ import annotations

from typing import Any

import numpy as np

from mahjong_ai.env.actions import (
    ACTION_CHOW_LEFT,
    ACTION_CHOW_MIDDLE,
    ACTION_CHOW_RIGHT,
    ACTION_KONG_ADDED,
    ACTION_KONG_CONCEALED,
    ACTION_KONG_EXPOSED,
    ACTION_PASS,
    ACTION_PONG,
    ACTION_SPACE_SIZE,
    ACTION_WIN,
    N_TILE_TYPES,
    build_action_mask,
    is_discard,
)
from mahjong_ai.rules.adapter import RuleAdapter
from mahjong_ai.rules.flybird import HONORS, TERMINALS, WILDCARD
from mahjong_ai.rules.shanten import best_shanten, effective_tile_count, fast_hand_value

HISTORY_EVENT_TYPES = {
    "discard": 0,
    "chow": 1,
    "pong": 2,
    "kong_exposed": 3,
    "kong_concealed": 4,
    "kong_added": 5,
    "kong_draw": 6,
    "pass": 7,
    "win": 8,
}
HISTORY_EVENT_DIM = len(HISTORY_EVENT_TYPES) + 4 + 4 + (N_TILE_TYPES + 1) + 4
ACTION_FEATURE_DIM = 18
ACTION_FEATURE_FULL_DIM = 78


def _count_vec(tiles: list[int], denom: float = 4.0) -> np.ndarray:
    vec = np.zeros(N_TILE_TYPES, dtype=np.float32)
    for tile in tiles:
        vec[tile] += 1.0
    return vec / denom


def get_observation_dim(config: dict | None = None) -> int:
    cfg = config or {}
    include_mask = cfg.get("obs_include_action_mask", False)
    include_action_features = _include_action_features(cfg)
    base = (
        N_TILE_TYPES
        + N_TILE_TYPES
        + 4 * N_TILE_TYPES
        + 4 * N_TILE_TYPES
        + 4
        + 4
        + 4
        + 4
        + (N_TILE_TYPES + 1)
        + 3
    )
    dim = base + (ACTION_SPACE_SIZE if include_mask else 0)
    if include_action_features:
        dim += ACTION_SPACE_SIZE * get_action_feature_dim(cfg)
    return dim


def is_history_observation(config: dict | None = None) -> bool:
    cfg = config or {}
    obs_cfg = cfg.get("observation", {})
    version = str(obs_cfg.get("version", cfg.get("obs_version", "")))
    return version in {"obs_v3_history", "v3_history"} or bool(obs_cfg.get("include_history", False))


def build_observation(
    rule_adapter: RuleAdapter,
    state: Any,
    player_id: int,
    config: dict | None = None,
) -> np.ndarray | dict[str, np.ndarray]:
    if is_history_observation(config):
        return build_history_observation(rule_adapter, state, player_id, config)
    return build_static_observation(rule_adapter, state, player_id, config)


def build_static_observation(
    rule_adapter: RuleAdapter,
    state: Any,
    player_id: int,
    config: dict | None = None,
) -> np.ndarray:
    cfg = config or {}
    public = rule_adapter.get_public_info(state)
    private = rule_adapter.get_private_info(state, player_id)
    legal_actions = rule_adapter.get_legal_actions(state, player_id)

    hand_counts = _count_vec(private["hand"])
    self_meld_counts = _count_vec([t for m in public["melds"][player_id] for t in m.tiles])
    discard_counts = np.concatenate([_count_vec(d) for d in public["discards"]]).astype(np.float32)
    open_meld_counts = np.concatenate(
        [_count_vec([t for m in melds for t in m.tiles]) for melds in public["melds"]]
    ).astype(np.float32)
    scores = np.asarray(public["scores"], dtype=np.float32) / 100.0
    dealer = np.zeros(4, dtype=np.float32)
    dealer[public["dealer"]] = 1.0
    current = np.zeros(4, dtype=np.float32)
    current[public["current_player"]] = 1.0
    relative = np.zeros(4, dtype=np.float32)
    relative[(public["current_player"] - player_id) % 4] = 1.0
    last = np.zeros(N_TILE_TYPES + 1, dtype=np.float32)
    if public["last_discard"] is None:
        last[-1] = 1.0
    else:
        last[public["last_discard"]] = 1.0
    round_info = np.asarray(
        [
            public["remaining_wall"] / 136.0,
            len(public["kong_pool"]) / 2.0,
            1.0 if public["xiaoji_disabled"] else 0.0,
        ],
        dtype=np.float32,
    )

    parts = [
        hand_counts,
        self_meld_counts,
        discard_counts,
        open_meld_counts,
        scores,
        dealer,
        current,
        relative,
        last,
        round_info,
    ]
    if cfg.get("obs_include_action_mask", False):
        parts.append(build_action_mask(legal_actions).astype(np.float32))
    if _include_action_features(cfg):
        parts.append(build_action_features(rule_adapter, state, player_id, cfg).reshape(-1))
    obs = np.concatenate(parts).astype(np.float32)
    validate_observation(obs, get_observation_dim(cfg))
    return obs


def _include_action_features(config: dict | None = None) -> bool:
    cfg = config or {}
    obs_cfg = cfg.get("observation", {})
    return bool(obs_cfg.get("include_action_features", cfg.get("obs_include_action_features", False)))


def get_action_feature_dim(config: dict | None = None) -> int:
    cfg = config or {}
    action_cfg = cfg.get("action_features", {})
    if "dim" in action_cfg:
        return int(action_cfg["dim"])
    if bool(action_cfg.get("identity_features", False)):
        return ACTION_FEATURE_FULL_DIM
    version = str(action_cfg.get("version", cfg.get("observation", {}).get("version", ""))).lower()
    if "full" in version or "action_scorer" in version:
        return ACTION_FEATURE_FULL_DIM
    return ACTION_FEATURE_DIM


def build_action_features(
    rule_adapter: RuleAdapter,
    state: Any,
    player_id: int,
    config: dict | None = None,
) -> np.ndarray:
    """Build per-action tile-efficiency features for every action id.

    Rows for illegal actions stay zero. Legal action rows contain action type
    flags plus simulated after-action hand quality. This gives the policy a
    direct comparison table instead of forcing it to infer action consequences
    from the raw hand alone.
    """

    cfg = config or {}
    action_cfg = cfg.get("action_features", {})
    use_effective_tiles = bool(action_cfg.get("effective_tiles", True))
    legal_actions = rule_adapter.get_legal_actions(state, player_id)
    feature_dim = get_action_feature_dim(cfg)
    features = np.zeros((ACTION_SPACE_SIZE, feature_dim), dtype=np.float32)
    if not legal_actions:
        return features

    hand = list(getattr(state, "hands", [[] for _ in range(4)])[player_id])
    open_melds = len(getattr(state, "melds", [[] for _ in range(4)])[player_id])
    wildcard_enabled = not bool(getattr(state, "xiaoji_disabled", False))
    pending = getattr(state, "pending", None)
    pending_tile = None if pending is None else int(getattr(pending, "tile", -1))
    before_tiles = hand + ([pending_tile] if pending_tile is not None and pending_tile >= 0 else [])
    before_open = open_melds
    before_shanten = best_shanten(before_tiles, open_melds=before_open, wildcard_enabled=wildcard_enabled)
    before_effective = (
        effective_tile_count(before_tiles, open_melds=before_open, wildcard_enabled=wildcard_enabled)
        if use_effective_tiles
        else 0
    )
    _, before_shape = fast_hand_value(before_tiles, open_melds=before_open, wildcard_enabled=wildcard_enabled)

    for action in legal_actions:
        action = int(action)
        row = features[action]
        row[0] = 1.0
        _encode_action_type(row, action)
        if feature_dim >= ACTION_FEATURE_FULL_DIM:
            _encode_action_identity(row, action, pending_tile, hand)
        row[14] = 1.0 if is_discard(action) and action == WILDCARD and wildcard_enabled else 0.0
        row[15] = 1.0 if is_discard(action) and action in HONORS else 0.0
        row[16] = 1.0 if is_discard(action) and action in TERMINALS else 0.0

        if action == ACTION_PASS:
            # Passing may advance to a hidden draw after all responders pass.
            # Do not simulate that draw here, or observation would leak wall order.
            after_hand = list(hand)
            after_open = open_melds
            after_wildcard_enabled = wildcard_enabled
            after_shanten = best_shanten(after_hand, open_melds=after_open, wildcard_enabled=after_wildcard_enabled)
            after_effective = before_effective
            after_shape = before_shape
            score_delta = 0.0
        else:
            try:
                next_state = rule_adapter.step(rule_adapter.clone_state(state), player_id, action)
            except Exception:
                continue
            after_hand = list(getattr(next_state, "hands", [[] for _ in range(4)])[player_id])
            after_open = len(getattr(next_state, "melds", [[] for _ in range(4)])[player_id])
            after_wildcard_enabled = not bool(getattr(next_state, "xiaoji_disabled", False))
            if getattr(next_state, "terminal", False):
                after_shanten = -1 if getattr(next_state, "winner", None) == player_id else before_shanten
                after_effective = before_effective
                after_shape = before_shape
                score_delta = float(
                    getattr(next_state, "scores", [0.0] * 4)[player_id]
                    - getattr(state, "scores", [0.0] * 4)[player_id]
                )
            else:
                after_shanten = best_shanten(after_hand, open_melds=after_open, wildcard_enabled=after_wildcard_enabled)
                after_effective = (
                    effective_tile_count(after_hand, open_melds=after_open, wildcard_enabled=after_wildcard_enabled)
                    if use_effective_tiles
                    else 0
                )
                _, after_shape = fast_hand_value(after_hand, open_melds=after_open, wildcard_enabled=after_wildcard_enabled)
                score_delta = float(
                    getattr(next_state, "scores", [0.0] * 4)[player_id]
                    - getattr(state, "scores", [0.0] * 4)[player_id]
                )

        row[7] = _norm_shanten(after_shanten)
        row[8] = float(before_shanten - after_shanten) / 8.0
        row[9] = min(1.0, float(after_effective) / 64.0)
        row[10] = float(after_effective - before_effective) / 64.0
        row[11] = min(1.0, float(after_shape) / 80.0)
        row[12] = float(after_shape - before_shape) / 80.0
        row[13] = max(-1.0, min(1.0, score_delta / 24.0))
        row[17] = 1.0 if after_shanten > before_shanten else 0.0
    return features


def _encode_action_type(row: np.ndarray, action: int) -> None:
    if is_discard(action):
        row[1] = 1.0
    elif action == ACTION_PASS:
        row[2] = 1.0
    elif action == ACTION_WIN:
        row[3] = 1.0
    elif action == ACTION_PONG:
        row[4] = 1.0
    elif action in (ACTION_CHOW_LEFT, ACTION_CHOW_MIDDLE, ACTION_CHOW_RIGHT):
        row[5] = 1.0
    elif action in (ACTION_KONG_EXPOSED, ACTION_KONG_CONCEALED, ACTION_KONG_ADDED):
        row[6] = 1.0


def _encode_action_identity(row: np.ndarray, action: int, pending_tile: int | None, hand: list[int]) -> None:
    # 18-25: action subtype detail.
    if action == ACTION_CHOW_LEFT:
        row[18] = 1.0
    elif action == ACTION_CHOW_MIDDLE:
        row[19] = 1.0
    elif action == ACTION_CHOW_RIGHT:
        row[20] = 1.0
    elif action == ACTION_KONG_EXPOSED:
        row[21] = 1.0
    elif action == ACTION_KONG_CONCEALED:
        row[22] = 1.0
    elif action == ACTION_KONG_ADDED:
        row[23] = 1.0
    elif action == ACTION_PASS:
        row[24] = 1.0
    elif action == ACTION_WIN:
        row[25] = 1.0

    tile = _action_tile(action, pending_tile)
    if tile is None or not 0 <= tile < N_TILE_TYPES:
        return

    # 26-59: explicit tile identity. This is essential for a shared action scorer.
    row[26 + tile] = 1.0

    # 60-63: suit identity, 64-72: rank identity.
    if tile < 9:
        row[60] = 1.0
        row[64 + tile] = 1.0
    elif tile < 18:
        row[61] = 1.0
        row[64 + (tile - 9)] = 1.0
    elif tile < 27:
        row[62] = 1.0
        row[64 + (tile - 18)] = 1.0
    else:
        row[63] = 1.0

    hand_count = hand.count(tile)
    row[73] = min(1.0, hand_count / 4.0)
    row[74] = 1.0 if is_discard(action) and hand_count >= 2 else 0.0
    row[75] = 1.0 if is_discard(action) and _would_break_sequence(tile, hand) else 0.0
    row[76] = 1.0 if is_discard(action) and _would_break_taatsu(tile, hand) else 0.0
    row[77] = min(1.0, _neighbor_count(tile, hand) / 6.0)


def _action_tile(action: int, pending_tile: int | None) -> int | None:
    if is_discard(action):
        return action
    if action in {
        ACTION_PONG,
        ACTION_CHOW_LEFT,
        ACTION_CHOW_MIDDLE,
        ACTION_CHOW_RIGHT,
        ACTION_KONG_EXPOSED,
    }:
        return pending_tile
    return None


def _would_break_sequence(tile: int, hand: list[int]) -> bool:
    if tile in HONORS:
        return False
    for a, b in ((tile - 2, tile - 1), (tile - 1, tile + 1), (tile + 1, tile + 2)):
        if _same_suit_number(tile, a) and _same_suit_number(tile, b) and a in hand and b in hand:
            return True
    return False


def _would_break_taatsu(tile: int, hand: list[int]) -> bool:
    if tile in HONORS:
        return hand.count(tile) >= 2
    others = hand[:]
    if tile in others:
        others.remove(tile)
    return any(_same_suit_number(tile, other) and abs(tile - other) in (1, 2) for other in others)


def _neighbor_count(tile: int, hand: list[int]) -> int:
    if tile in HONORS:
        return hand.count(tile)
    return sum(
        hand.count(other)
        for other in (tile - 2, tile - 1, tile + 1, tile + 2)
        if _same_suit_number(tile, other)
    )


def _same_suit_number(a: int, b: int) -> bool:
    return 0 <= a < 27 and 0 <= b < 27 and a // 9 == b // 9


def _norm_shanten(value: int) -> float:
    return max(0.0, min(1.0, float(value + 1) / 9.0))


def build_history_observation(
    rule_adapter: RuleAdapter,
    state: Any,
    player_id: int,
    config: dict | None = None,
) -> dict[str, np.ndarray]:
    cfg = config or {}
    obs_cfg = cfg.get("observation", {})
    history_len = int(obs_cfg.get("history_len", cfg.get("history_len", 128)))
    static = build_static_observation(rule_adapter, state, player_id, config)
    history, mask = encode_public_history(getattr(state, "public_events", []), player_id, history_len)
    return {
        "static": static.astype(np.float32),
        "history": history.astype(np.float32),
        "history_mask": mask.astype(np.float32),
    }


def encode_public_history(
    events: list[dict],
    player_id: int,
    history_len: int,
) -> tuple[np.ndarray, np.ndarray]:
    history = np.zeros((history_len, HISTORY_EVENT_DIM), dtype=np.float32)
    mask = np.zeros((history_len,), dtype=np.float32)
    selected = list(events[-history_len:])
    offset = history_len - len(selected)
    for i, event in enumerate(selected):
        row = history[offset + i]
        event_type = str(event.get("type", ""))
        if event_type in HISTORY_EVENT_TYPES:
            row[HISTORY_EVENT_TYPES[event_type]] = 1.0
        cursor = len(HISTORY_EVENT_TYPES)
        actor = int(event.get("player", 0))
        if 0 <= actor < 4:
            row[cursor + actor] = 1.0
        cursor += 4
        row[cursor + ((actor - player_id) % 4)] = 1.0
        cursor += 4
        tile = event.get("tile")
        if tile is None:
            row[cursor + N_TILE_TYPES] = 1.0
        else:
            tile_int = int(tile)
            if 0 <= tile_int < N_TILE_TYPES:
                row[cursor + tile_int] = 1.0
        cursor += N_TILE_TYPES + 1
        row[cursor] = min(1.0, float(event.get("step", 0)) / 300.0)
        row[cursor + 1] = min(1.0, float(event.get("wall", 0)) / 136.0)
        target = event.get("target")
        row[cursor + 2] = 0.0 if target is None else ((int(target) - player_id) % 4) / 3.0
        row[cursor + 3] = 1.0 if bool(event.get("xiaoji_disabled", False)) else 0.0
        mask[offset + i] = 1.0
    return history, mask


def validate_observation(obs: np.ndarray, expected_dim: int) -> None:
    if obs.shape != (expected_dim,):
        raise ValueError(f"observation shape {obs.shape} != ({expected_dim},)")
    if not np.isfinite(obs).all():
        raise ValueError("observation contains NaN or inf")
