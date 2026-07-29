from __future__ import annotations

from typing import Any

from mahjong_ai.env.actions import (
    ACTION_CHOW_LEFT,
    ACTION_CHOW_MIDDLE,
    ACTION_CHOW_RIGHT,
    ACTION_KONG_ADDED,
    ACTION_KONG_CONCEALED,
    ACTION_KONG_EXPOSED,
    ACTION_PASS,
    ACTION_PONG,
    is_discard,
)
from mahjong_ai.rules.adapter import RuleAdapter
from mahjong_ai.rules.flybird import HONORS, WILDCARD, counts, score_hand, tile_suit
from mahjong_ai.rules.shanten import best_shanten, fast_hand_value


def compute_reward(
    prev_state: Any,
    next_state: Any,
    player_id: int,
    rule_adapter: RuleAdapter,
    config: dict | None = None,
    action: int | None = None,
) -> float:
    cfg = config or {}
    scale = float(cfg.get("score_scale", 1.0))
    step_penalty = float(cfg.get("step_penalty", 0.0))
    prev = rule_adapter.get_scores(prev_state)[player_id]
    nxt = rule_adapter.get_scores(next_state)[player_id]
    reward = (nxt - prev) / scale
    reward += _action_shaping(prev_state, player_id, action, cfg, rule_adapter)
    reward += _shanten_shaping(prev_state, next_state, player_id, cfg)
    reward += _hand_goal_shaping(prev_state, next_state, player_id, cfg)
    reward += _terminal_win_shaping(next_state, player_id, cfg)
    if not rule_adapter.is_terminal(next_state):
        reward -= step_penalty
    return float(reward)


def _action_shaping(prev_state: Any, player_id: int, action: int | None, cfg: dict, rule_adapter: RuleAdapter) -> float:
    if action is None:
        return 0.0
    reward = 0.0
    if is_discard(action) and action == WILDCARD:
        if getattr(prev_state, "xiaoji_disabled", False):
            reward -= float(cfg.get("discard_dead_xiaoji_penalty", 0.0))
        else:
            reward -= float(cfg.get("discard_live_xiaoji_penalty", 0.0))
    reward += claim_decision_reward(prev_state, player_id, action, cfg)
    if is_discard(action):
        hand = list(getattr(prev_state, "hands", [[] for _ in range(4)])[player_id])
        wildcard_enabled = not bool(getattr(prev_state, "xiaoji_disabled", False))
        reward += discard_preference_reward(action, hand, wildcard_enabled, cfg)
        reward += discard_efficiency_reward(prev_state, player_id, action, cfg)
        reward += discard_value_order_reward(action, hand, wildcard_enabled, cfg)
        reward += kong_skip_reward(prev_state, player_id, action, cfg, rule_adapter)
    if action == ACTION_KONG_CONCEALED:
        reward += float(cfg.get("concealed_kong_bonus", 0.0))
    elif action == ACTION_KONG_EXPOSED:
        reward -= float(cfg.get("exposed_kong_penalty", 0.0))
    elif action == ACTION_KONG_ADDED:
        if bool(cfg.get("added_kong_as_concealed", False)):
            reward += float(cfg.get("added_kong_as_concealed_bonus", cfg.get("concealed_kong_bonus", 0.0)))
            hand = list(getattr(prev_state, "hands", [[] for _ in range(4)])[player_id])
            open_melds = len(getattr(prev_state, "melds", [[] for _ in range(4)])[player_id])
            wildcard_enabled = not bool(getattr(prev_state, "xiaoji_disabled", False))
            if best_shanten(hand, open_melds=open_melds, wildcard_enabled=wildcard_enabled) <= 1:
                reward += float(cfg.get("added_kong_ready_bonus", 0.0))
        else:
            reward -= float(cfg.get("added_kong_penalty", 0.0))
    return reward


def _shanten_shaping(prev_state: Any, next_state: Any, player_id: int, cfg: dict) -> float:
    improvement_bonus = float(cfg.get("shanten_improvement_bonus", 0.0))
    regression_penalty = float(cfg.get("shanten_regression_penalty", 0.0))
    ready_bonus = float(cfg.get("ready_bonus", 0.0))
    if improvement_bonus == 0.0 and regression_penalty == 0.0 and ready_bonus == 0.0:
        return 0.0
    prev_open = len(getattr(prev_state, "melds", [[] for _ in range(4)])[player_id])
    next_open = len(getattr(next_state, "melds", [[] for _ in range(4)])[player_id])
    prev_wild = not bool(getattr(prev_state, "xiaoji_disabled", False))
    next_wild = not bool(getattr(next_state, "xiaoji_disabled", False))
    prev_shanten = best_shanten(prev_state.hands[player_id], open_melds=prev_open, wildcard_enabled=prev_wild)
    next_shanten = best_shanten(next_state.hands[player_id], open_melds=next_open, wildcard_enabled=next_wild)
    delta = prev_shanten - next_shanten
    reward = 0.0
    if delta > 0:
        reward += improvement_bonus * delta
    elif delta < 0:
        reward -= regression_penalty * abs(delta)
    if prev_shanten > 0 and next_shanten == 0:
        reward += ready_bonus
    return reward


def _terminal_win_shaping(next_state: Any, player_id: int, cfg: dict) -> float:
    if not bool(getattr(next_state, "terminal", False)):
        return 0.0
    winners = list(getattr(next_state, "winners", []))
    if player_id not in winners:
        return 0.0

    reward = 0.0
    reward += float(cfg.get("terminal_win_bonus", 0.0))
    if getattr(next_state, "win_type", None) == "self_draw":
        reward += float(cfg.get("self_draw_bonus", 0.0))
    else:
        reward += float(cfg.get("ron_bonus", 0.0))

    fan_bonus = float(cfg.get("fan_bonus", 0.0))
    point_bonus = float(cfg.get("point_bonus", 0.0))
    if fan_bonus or point_bonus:
        score = score_hand(
            next_state,
            player_id,
            getattr(next_state, "last_discard", None),
            getattr(next_state, "win_type", None) == "self_draw",
        )
        reward += fan_bonus * float(score.get("fan", 0))
        reward += point_bonus * float(score.get("points", 0.0))
    return reward


def _hand_goal_shaping(prev_state: Any, next_state: Any, player_id: int, cfg: dict) -> float:
    improvement_bonus = float(cfg.get("hand_goal_improvement_bonus", 0.0))
    regression_penalty = float(cfg.get("hand_goal_regression_penalty", 0.0))
    if improvement_bonus == 0.0 and regression_penalty == 0.0:
        return 0.0

    prev_scores = _hand_goal_scores(prev_state, player_id)
    next_scores = _hand_goal_scores(next_state, player_id)
    mode = str(cfg.get("hand_goal_mode", "committed"))
    if mode == "best_delta":
        delta = max(next - prev for prev, next in zip(prev_scores, next_scores))
        target = max(range(len(prev_scores)), key=lambda i: prev_scores[i])
    else:
        target = max(range(len(prev_scores)), key=lambda i: prev_scores[i])
        delta = next_scores[target] - prev_scores[target]
    if delta > 0:
        reward = improvement_bonus * delta
    if delta < 0:
        reward = regression_penalty * delta
    if delta == 0:
        reward = 0.0
    switch_penalty = float(cfg.get("hand_goal_switch_penalty", 0.0))
    if switch_penalty > 0.0:
        next_target = max(range(len(next_scores)), key=lambda i: next_scores[i])
        if next_target != target:
            reward -= switch_penalty
    return reward


def _best_hand_goal_score(state: Any, player_id: int) -> float:
    return max(_hand_goal_scores(state, player_id))


def _hand_goal_scores(state: Any, player_id: int) -> list[float]:
    hand = list(getattr(state, "hands", [[] for _ in range(4)])[player_id])
    melds = list(getattr(state, "melds", [[] for _ in range(4)])[player_id])
    extra_tiles = [tile for meld in melds for tile in getattr(meld, "tiles", [])]
    return hand_goal_scores_for_tiles(
        hand,
        extra_tiles=extra_tiles,
        open_melds=len(melds),
        xiaoji_disabled=bool(getattr(state, "xiaoji_disabled", False)),
    )


def hand_goal_scores_for_tiles(
    hand: list[int],
    *,
    extra_tiles: list[int] | None = None,
    open_melds: int = 0,
    xiaoji_disabled: bool = False,
) -> list[float]:
    wildcard_enabled = not xiaoji_disabled
    all_tiles = list(hand) + list(extra_tiles or [])
    if not all_tiles:
        return [0.0]

    return [
        _standard_goal_score(hand, open_melds, wildcard_enabled),
        _seven_pairs_goal_score(hand, wildcard_enabled) if open_melds == 0 else -99.0,
        _flush_goal_score(all_tiles),
        _triplet_goal_score(all_tiles),
    ]


def discard_preference_reward(tile: int, hand: list[int], wildcard_enabled: bool, cfg: dict) -> float:
    if wildcard_enabled and tile == WILDCARD:
        return 0.0
    score = discard_preference_score(tile, hand, wildcard_enabled)
    return score * float(cfg.get("human_discard_preference_bonus", 0.0))


def discard_value_order_reward(tile: int, hand: list[int], wildcard_enabled: bool, cfg: dict) -> float:
    honor_bonus = float(cfg.get("isolated_honor_discard_bonus", 0.0))
    connected_over_honor_penalty = float(cfg.get("discard_connected_suit_over_honor_penalty", 0.0))
    pair_over_honor_penalty = float(cfg.get("discard_pair_over_honor_penalty", 0.0))
    pair_penalty = float(cfg.get("discard_pair_penalty", 0.0))
    only_pair_penalty = float(cfg.get("discard_only_pair_penalty", 0.0))
    if (
        honor_bonus == 0.0
        and connected_over_honor_penalty == 0.0
        and pair_over_honor_penalty == 0.0
        and pair_penalty == 0.0
        and only_pair_penalty == 0.0
    ):
        return 0.0
    if wildcard_enabled and tile == WILDCARD:
        return 0.0

    c = counts(hand)
    isolated_honors = [h for h in HONORS if h != WILDCARD and c[h] == 1]
    reward = 0.0
    if tile in isolated_honors:
        reward += honor_bonus
    elif isolated_honors:
        if c[tile] >= 2:
            reward -= pair_over_honor_penalty
        elif tile not in HONORS and _near_neighbor_count(tile, hand) > 0:
            reward -= connected_over_honor_penalty

    if c[tile] >= 2:
        other_pairs = sum(1 for i, n in enumerate(c) if i != tile and n >= 2)
        reward -= only_pair_penalty if other_pairs == 0 else pair_penalty
    return reward


def discard_efficiency_reward(state: Any, player_id: int, tile: int, cfg: dict) -> float:
    best_bonus = float(cfg.get("discard_best_shanten_bonus", 0.0))
    miss_penalty = float(cfg.get("discard_miss_best_shanten_penalty", 0.0))
    shape_bonus = float(cfg.get("discard_shape_score_bonus", 0.0))
    break_penalty = float(cfg.get("discard_break_meld_penalty", 0.0))
    taatsu_penalty = float(cfg.get("discard_break_taatsu_penalty", 0.0))
    good_taatsu_penalty = float(cfg.get("discard_break_good_taatsu_penalty", 0.0))
    near_ready_good_taatsu_penalty = float(cfg.get("discard_near_ready_good_taatsu_penalty", 0.0))
    weak_taatsu_bonus = float(cfg.get("discard_weak_taatsu_bonus", 0.0))
    ready_regression_penalty = float(cfg.get("discard_ready_regression_penalty", 0.0))
    one_shanten_regression_penalty = float(cfg.get("discard_one_shanten_regression_penalty", 0.0))
    if (
        best_bonus == 0.0
        and miss_penalty == 0.0
        and shape_bonus == 0.0
        and break_penalty == 0.0
        and taatsu_penalty == 0.0
        and good_taatsu_penalty == 0.0
        and near_ready_good_taatsu_penalty == 0.0
        and weak_taatsu_bonus == 0.0
        and ready_regression_penalty == 0.0
        and one_shanten_regression_penalty == 0.0
    ):
        return 0.0

    hand = list(getattr(state, "hands", [[] for _ in range(4)])[player_id])
    if tile not in hand:
        return 0.0
    open_melds = len(getattr(state, "melds", [[] for _ in range(4)])[player_id])
    wildcard_enabled = not bool(getattr(state, "xiaoji_disabled", False))
    candidates = sorted(set(hand))
    if len(candidates) <= 1:
        return 0.0

    evaluated = [_discard_candidate_value(hand, candidate, open_melds, wildcard_enabled) for candidate in candidates]
    selected = _discard_candidate_value(hand, tile, open_melds, wildcard_enabled)
    current_shanten = best_shanten(hand, open_melds=open_melds, wildcard_enabled=wildcard_enabled)
    best_shanten_value = min(item[0] for item in evaluated)
    best_shape_value = max(item[1] for item in evaluated if item[0] == best_shanten_value)

    reward = 0.0
    if selected[0] == best_shanten_value:
        reward += best_bonus
        if shape_bonus:
            reward += shape_bonus * max(-1.0, min(1.0, selected[1] - best_shape_value))
    else:
        reward -= miss_penalty * float(selected[0] - best_shanten_value)
    if selected[0] > current_shanten:
        if current_shanten <= 0:
            reward -= ready_regression_penalty * float(selected[0] - current_shanten)
        elif current_shanten == 1:
            reward -= one_shanten_regression_penalty * float(selected[0] - current_shanten)

    if break_penalty and _discard_breaks_complete_meld(hand, tile):
        non_break_best = any(
            candidate != tile
            and not _discard_breaks_complete_meld(hand, candidate)
            and value[0] <= selected[0]
            for candidate, value in zip(candidates, evaluated)
        )
        if non_break_best:
            reward -= break_penalty
    if taatsu_penalty or good_taatsu_penalty or near_ready_good_taatsu_penalty or weak_taatsu_bonus:
        selected_taatsu = _discard_taatsu_strength(hand, tile)
        candidate_taatsu = [_discard_taatsu_strength(hand, candidate) for candidate in candidates]
        max_non_worse_taatsu = max(
            (
                strength
                for strength, value in zip(candidate_taatsu, evaluated)
                if value[0] <= selected[0]
            ),
            default=selected_taatsu,
        )
        if weak_taatsu_bonus and selected[0] == best_shanten_value and selected_taatsu < max_non_worse_taatsu:
            reward += weak_taatsu_bonus * float(max_non_worse_taatsu - selected_taatsu)
        if selected_taatsu > 0:
            has_weaker_candidate = any(
                candidate != tile
                and value[0] <= selected[0]
                and strength < selected_taatsu
                for candidate, value, strength in zip(candidates, evaluated, candidate_taatsu)
            )
            if has_weaker_candidate:
                reward -= good_taatsu_penalty if selected_taatsu >= 2 else taatsu_penalty
                if selected[0] <= 2 and selected_taatsu >= 2:
                    reward -= near_ready_good_taatsu_penalty
    return reward


def claim_decision_reward(state: Any, player_id: int, action: int | None, cfg: dict) -> float:
    if action is None or getattr(state, "pending", None) is None:
        return 0.0
    claim_improvement_bonus = float(cfg.get("claim_improvement_bonus", 0.0))
    claim_same_penalty = float(cfg.get("claim_same_penalty", 0.0))
    claim_regression_penalty = float(cfg.get("claim_regression_penalty", 0.0))
    pass_non_improving_claim_bonus = float(cfg.get("pass_non_improving_claim_bonus", 0.0))
    pass_same_claim_bonus = float(cfg.get("pass_same_claim_bonus", 0.0))
    pass_improving_claim_penalty = float(cfg.get("pass_improving_claim_penalty", 0.0))
    if (
        claim_improvement_bonus == 0.0
        and claim_same_penalty == 0.0
        and claim_regression_penalty == 0.0
        and pass_non_improving_claim_bonus == 0.0
        and pass_same_claim_bonus == 0.0
        and pass_improving_claim_penalty == 0.0
    ):
        return 0.0

    hand = list(getattr(state, "hands", [[] for _ in range(4)])[player_id])
    open_melds = len(getattr(state, "melds", [[] for _ in range(4)])[player_id])
    wildcard_enabled = not bool(getattr(state, "xiaoji_disabled", False))
    current = best_shanten(hand, open_melds=open_melds, wildcard_enabled=wildcard_enabled)
    claim_actions = [ACTION_PONG, ACTION_KONG_EXPOSED, ACTION_CHOW_LEFT, ACTION_CHOW_MIDDLE, ACTION_CHOW_RIGHT]
    claim_values = [
        _claim_after_shanten(state, player_id, claim_action, current)
        for claim_action in claim_actions
    ]
    valid_claim_values = [value for value in claim_values if value is not None]
    if not valid_claim_values:
        return 0.0
    best_claim = min(valid_claim_values)

    if action == ACTION_PASS:
        if best_claim < current:
            return -pass_improving_claim_penalty * float(current - best_claim)
        if best_claim == current:
            return pass_same_claim_bonus
        return pass_non_improving_claim_bonus
    if action not in claim_actions:
        return 0.0

    selected = _claim_after_shanten(state, player_id, action, current)
    if selected is None:
        return 0.0
    if selected < current:
        return claim_improvement_bonus * float(current - selected)
    if selected == current:
        return -claim_same_penalty
    return -claim_regression_penalty * float(selected - current)


def _claim_after_shanten(state: Any, player_id: int, action: int, fallback: int) -> int | None:
    pending = getattr(state, "pending", None)
    if pending is None:
        return None
    tile = pending.tile
    hand = list(getattr(state, "hands", [[] for _ in range(4)])[player_id])
    open_melds = len(getattr(state, "melds", [[] for _ in range(4)])[player_id])
    wildcard_enabled = not bool(getattr(state, "xiaoji_disabled", False))
    try:
        if action == ACTION_PONG:
            trial = hand[:]
            trial.remove(tile)
            trial.remove(tile)
            return best_shanten(trial, open_melds=open_melds + 1, wildcard_enabled=wildcard_enabled)
        if action == ACTION_KONG_EXPOSED:
            trial = hand[:]
            if trial.count(tile) >= 3:
                for _ in range(3):
                    trial.remove(tile)
            elif not getattr(state, "xiaoji_disabled", False) and tile != WILDCARD:
                trial.remove(tile)
                trial.remove(tile)
                trial.remove(WILDCARD)
            else:
                return None
            return best_shanten(trial, open_melds=open_melds + 1, wildcard_enabled=wildcard_enabled)
        if action in (ACTION_CHOW_LEFT, ACTION_CHOW_MIDDLE, ACTION_CHOW_RIGHT):
            if action == ACTION_CHOW_LEFT:
                used = [tile + 1, tile + 2]
            elif action == ACTION_CHOW_MIDDLE:
                used = [tile - 1, tile + 1]
            else:
                used = [tile - 2, tile - 1]
            trial = hand[:]
            for used_tile in used:
                trial.remove(used_tile)
            return best_shanten(trial, open_melds=open_melds + 1, wildcard_enabled=wildcard_enabled)
    except ValueError:
        return None
    return fallback


def kong_skip_reward(state: Any, player_id: int, action: int, cfg: dict, rule_adapter: RuleAdapter) -> float:
    penalty = float(cfg.get("discard_over_kong_penalty", 0.0))
    ready_penalty = float(cfg.get("discard_over_kong_ready_penalty", 0.0))
    if penalty == 0.0 and ready_penalty == 0.0:
        return 0.0
    if not is_discard(action):
        return 0.0
    legal_actions = rule_adapter.get_legal_actions(state, player_id)
    if ACTION_KONG_CONCEALED not in legal_actions and ACTION_KONG_ADDED not in legal_actions:
        return 0.0
    hand = list(getattr(state, "hands", [[] for _ in range(4)])[player_id])
    open_melds = len(getattr(state, "melds", [[] for _ in range(4)])[player_id])
    wildcard_enabled = not bool(getattr(state, "xiaoji_disabled", False))
    shanten = best_shanten(hand, open_melds=open_melds, wildcard_enabled=wildcard_enabled)
    return -(ready_penalty if shanten <= 1 else penalty)


def discard_preference_score(tile: int, hand: list[int], wildcard_enabled: bool = True) -> float:
    """Human-style discard priority for isolated low-value tiles.

    Higher means the tile is more reasonable to discard. This is intentionally
    lightweight and only rewards obvious basics: isolated honors, isolated
    terminals, and weak edge tiles. It avoids telling the model to discard
    valuable pairs, connected shapes, or live xiaoji.
    """

    if wildcard_enabled and tile == WILDCARD:
        return -4.0
    c = counts(hand)
    if c[tile] >= 2:
        return -0.8
    if tile in HONORS:
        return 1.4
    rank = tile % 9 + 1
    neighbor_count = _near_neighbor_count(tile, hand)
    if rank in {1, 9}:
        if neighbor_count == 0:
            return 1.2
        if neighbor_count == 1:
            return 0.45
        return -0.15
    if rank in {2, 8}:
        if neighbor_count == 0:
            return 0.75
        if neighbor_count == 1:
            return 0.2
        return -0.25
    if neighbor_count == 0:
        return 0.25
    return -0.35


def _standard_goal_score(hand: list[int], open_melds: int, wildcard_enabled: bool) -> float:
    shanten, shape_score = fast_hand_value(hand, open_melds=open_melds, wildcard_enabled=wildcard_enabled)
    edge_penalty = _edge_isolation_penalty(hand)
    # Standard hands are the default, easiest-to-complete direction. Keep this
    # score positive even when the hand is far away, otherwise rare high-fan
    # shapes get selected too aggressively in early turns.
    distance_score = max(0.0, 8.0 - float(shanten)) * 1.15
    return distance_score + shape_score * 0.04 + open_melds * 0.35 - edge_penalty


def _seven_pairs_goal_score(hand: list[int], wildcard_enabled: bool) -> float:
    c = counts(hand)
    wildcards = c[WILDCARD] if wildcard_enabled else 0
    if wildcard_enabled:
        c[WILDCARD] = 0
    pairs = sum(1 for n in c if n >= 2)
    near_pairs = sum(1 for n in c if n == 1)
    pair_waits = sum(max(0, 4 - n) for n in c if n == 1)
    missing_anchor = max(0, 4 - pairs - min(wildcards, near_pairs))
    score = pairs * 1.25 + min(wildcards, near_pairs) * 1.1 + pair_waits * 0.02
    score -= missing_anchor * 1.6
    if pairs + min(wildcards, near_pairs) < 4:
        score -= 2.0
    return score


def _flush_goal_score(all_tiles: list[int]) -> float:
    suit_counts = [0, 0, 0]
    honor_count = 0
    off_suit_count = 0
    for tile in all_tiles:
        if tile in HONORS:
            honor_count += 1
        else:
            suit = tile_suit(tile)
            if suit in {"m", "p", "s"}:
                suit_counts[{"m": 0, "p": 1, "s": 2}[suit]] += 1
    main = max(suit_counts)
    off_suit_count = sum(suit_counts) - main
    score = main * 0.9 + honor_count * 0.1 - off_suit_count * 1.55
    if main < 7:
        score -= 1.5
    return score


def _triplet_goal_score(all_tiles: list[int]) -> float:
    c = counts(all_tiles)
    pairs = sum(1 for n in c if n == 2)
    triplets = sum(1 for n in c if n >= 3)
    quads = sum(1 for n in c if n >= 4)
    return triplets * 1.8 + quads * 0.5 + pairs * 0.72


def _edge_isolation_penalty(hand: list[int]) -> float:
    c = counts(hand)
    penalty = 0.0
    for tile in hand:
        if tile in HONORS:
            continue
        rank = tile % 9
        if rank in {0, 8}:
            neighbors = 0
            for delta in (-2, -1, 1, 2):
                other = tile + delta
                if 0 <= other < 27 and tile_suit(other) == tile_suit(tile):
                    neighbors += c[other]
            if neighbors == 0:
                penalty += 0.2
            elif neighbors == 1:
                penalty += 0.08
    return penalty


def _near_neighbor_count(tile: int, hand: list[int]) -> int:
    if tile in HONORS:
        return 0
    return sum(
        hand.count(other)
        for other in (tile - 2, tile - 1, tile + 1, tile + 2)
        if 0 <= other < 27 and tile_suit(other) == tile_suit(tile)
    )


def _discard_candidate_value(
    hand: list[int],
    tile: int,
    open_melds: int,
    wildcard_enabled: bool,
) -> tuple[int, float]:
    after = list(hand)
    after.remove(tile)
    shanten, shape_score = fast_hand_value(after, open_melds=open_melds, wildcard_enabled=wildcard_enabled)
    return int(shanten), float(shape_score)


def _discard_breaks_complete_meld(hand: list[int], tile: int) -> bool:
    c = counts(hand)
    if c[tile] >= 3:
        return True
    if tile in HONORS:
        return False
    suit = tile_suit(tile)
    for start in (tile - 2, tile - 1, tile):
        if start < 0 or start + 2 >= 27:
            continue
        if tile_suit(start) != suit or tile_suit(start + 1) != suit or tile_suit(start + 2) != suit:
            continue
        if c[start] > 0 and c[start + 1] > 0 and c[start + 2] > 0:
            return True
    return False


def _discard_taatsu_strength(hand: list[int], tile: int) -> int:
    if tile in HONORS:
        return 0
    c = counts(hand)
    suit = tile_suit(tile)
    strength = 0
    for other in (tile - 2, tile - 1, tile + 1, tile + 2):
        if 0 <= other < 27 and tile_suit(other) == suit and c[other] > 0:
            strength = max(strength, _taatsu_wait_type_count(tile, other))
    return strength


def _taatsu_wait_type_count(tile_a: int, tile_b: int) -> int:
    if tile_a in HONORS or tile_b in HONORS or tile_suit(tile_a) != tile_suit(tile_b):
        return 0
    gap = abs(tile_a - tile_b)
    rank_low = min(tile_a % 9 + 1, tile_b % 9 + 1)
    rank_high = max(tile_a % 9 + 1, tile_b % 9 + 1)
    if gap == 1:
        waits = 0
        if rank_low > 1:
            waits += 1
        if rank_high < 9:
            waits += 1
        return waits
    if gap == 2:
        return 1
    return 0
