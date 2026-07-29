from __future__ import annotations

import copy
import hashlib
import json
import random
from dataclasses import dataclass, field
from typing import Literal

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
    N_TILE_TYPES,
    discard_action,
    is_discard,
)

Suit = Literal["m", "p", "s", "z"]

WAN = range(0, 9)
PIN = range(9, 18)
SOU = range(18, 27)
HONORS = range(27, 34)
WILDCARD = 18  # 1 bamboo / xiaoji
FIVE_PIN = 13
DRAGONS = {31, 32, 33}
WINDS = {27, 28, 29, 30}
TERMINALS = {0, 8, 9, 17, 18, 26}


@dataclass
class Meld:
    type: str
    tiles: list[int]
    from_player: int | None = None
    concealed: bool = False
    wildcard_as: int | None = None
    added_from_pong: bool = False


@dataclass
class PendingClaim:
    discarder: int
    tile: int
    responders: list[int]
    index: int = 0
    kind: str = "discard"
    kong_meld_index: int | None = None
    kong_use_wildcard: bool = False


@dataclass
class GameState:
    hands: list[list[int]]
    wall: list[int]
    kong_pool: list[int]
    discards: list[list[int]]
    melds: list[list[Meld]]
    scores: list[float]
    dealer: int = 0
    current_player: int = 0
    phase: str = "draw"
    last_discard: int | None = None
    last_discard_player: int | None = None
    pending: PendingClaim | None = None
    winner: int | None = None
    terminal: bool = False
    draw: bool = False
    step_count: int = 0
    kong_count: int = 0
    last_action: str | None = None
    last_draw_from_kong: bool = False
    last_kong_player: int | None = None
    last_kong_tile: int | None = None
    xiaoji_disabled: bool = False
    win_type: str | None = None
    payer: int | None = None
    win_points: float = 0.0
    win_names: list[str] = field(default_factory=list)
    winners: list[int] = field(default_factory=list)
    same_round_furiten: list[set[int]] = field(default_factory=lambda: [set() for _ in range(4)])
    reject_win_furiten: list[bool] = field(default_factory=lambda: [False for _ in range(4)])
    reject_pong_tiles: list[set[int]] = field(default_factory=lambda: [set() for _ in range(4)])
    wind_discards_first_round: list[int | None] = field(default_factory=lambda: [None for _ in range(4)])
    first_round_active: bool = True
    special_discards: list[list[int]] = field(default_factory=lambda: [[] for _ in range(4)])
    discarded_non_special: list[bool] = field(default_factory=lambda: [False for _ in range(4)])
    kong_after_discard_player: int | None = None
    public_events: list[dict] = field(default_factory=list)


def tile_suit(tile: int) -> Suit:
    if 0 <= tile <= 8:
        return "m"
    if 9 <= tile <= 17:
        return "p"
    if 18 <= tile <= 26:
        return "s"
    if 27 <= tile <= 33:
        return "z"
    raise ValueError(f"invalid tile: {tile}")


def tile_rank(tile: int) -> int | None:
    if tile in HONORS:
        return None
    return tile % 9 + 1


def make_wall(rng: random.Random) -> list[int]:
    wall = [tile for tile in range(N_TILE_TYPES) for _ in range(4)]
    rng.shuffle(wall)
    return wall


def counts(tiles: list[int]) -> list[int]:
    result = [0] * N_TILE_TYPES
    for tile in tiles:
        result[tile] += 1
    return result


def _can_form_melds_without_wildcards(c: list[int]) -> bool:
    try:
        first = next(i for i, v in enumerate(c) if v)
    except StopIteration:
        return True
    if c[first] >= 3:
        c[first] -= 3
        if _can_form_melds_without_wildcards(c):
            c[first] += 3
            return True
        c[first] += 3
    suit = tile_suit(first)
    rank = tile_rank(first)
    if suit != "z" and rank is not None and rank <= 7:
        a, b = first + 1, first + 2
        if tile_suit(a) == suit and tile_suit(b) == suit and c[a] and c[b]:
            c[first] -= 1
            c[a] -= 1
            c[b] -= 1
            if _can_form_melds_without_wildcards(c):
                c[first] += 1
                c[a] += 1
                c[b] += 1
                return True
            c[first] += 1
            c[a] += 1
            c[b] += 1
    return False


def _can_form_melds(c: list[int], wildcards: int) -> bool:
    try:
        first = next(i for i, v in enumerate(c) if v)
    except StopIteration:
        return wildcards % 3 == 0

    need = max(0, 3 - c[first])
    if need <= wildcards:
        used = min(3, c[first])
        c[first] -= used
        if _can_form_melds(c, wildcards - need):
            c[first] += used
            return True
        c[first] += used

    suit = tile_suit(first)
    rank = tile_rank(first)
    if suit != "z" and rank is not None and rank <= 7:
        seq = [first, first + 1, first + 2]
        branch = c[:]
        missing = 0
        for t in seq:
            if branch[t] > 0:
                branch[t] -= 1
            else:
                missing += 1
        possible = missing <= wildcards and all(tile_suit(t) == suit for t in seq)
        if possible and _can_form_melds(branch, wildcards - missing):
            return True
    return False


def is_standard_win(tiles: list[int], wildcard_enabled: bool = True) -> bool:
    c = counts(tiles)
    wildcards = c[WILDCARD] if wildcard_enabled else 0
    if wildcard_enabled:
        c[WILDCARD] = 0
    for pair_tile in range(N_TILE_TYPES):
        natural = c[pair_tile]
        for use_wild in range(0, min(2, wildcards) + 1):
            if natural + use_wild >= 2:
                branch = c[:]
                branch[pair_tile] = max(0, branch[pair_tile] - (2 - use_wild))
                if _can_form_melds(branch, wildcards - use_wild):
                    return True
    return wildcards >= 2 and _can_form_melds(c[:], wildcards - 2)


def is_seven_pairs(tiles: list[int], wildcard_enabled: bool = True) -> bool:
    if len(tiles) != 14:
        return False
    c = counts(tiles)
    wildcards = c[WILDCARD] if wildcard_enabled else 0
    if wildcard_enabled:
        c[WILDCARD] = 0
    pairs = 0
    singles = 0
    for n in c:
        pairs += n // 2
        singles += n % 2
    if singles > wildcards:
        return False
    pairs += singles
    wildcards -= singles
    pairs += wildcards // 2
    return pairs >= 7


def is_lanpai(tiles: list[int], wildcard_enabled: bool = True) -> bool:
    natural = [t for t in tiles if not (wildcard_enabled and t == WILDCARD)]
    c = counts(natural)
    for tile in range(N_TILE_TYPES):
        if c[tile] > 1:
            return False
    honors = {t for t in natural if t in HONORS}
    if len(honors) < 5:
        return False
    for suit_start in (0, 9, 18):
        ranks = sorted((t - suit_start + 1) for t in natural if suit_start <= t < suit_start + 9)
        for i, a in enumerate(ranks):
            for b in ranks[i + 1 :]:
                if abs(a - b) not in (3, 6):
                    return False
    return True


def is_special_terminal_or_honor(tile: int) -> bool:
    return tile in HONORS or tile in TERMINALS


def is_win_shape(tiles: list[int], wildcard_enabled: bool = True) -> bool:
    return (
        is_standard_win(tiles, wildcard_enabled)
        or is_seven_pairs(tiles, wildcard_enabled)
        or is_lanpai(tiles, wildcard_enabled)
    )


def _has_wildcard_as_wild(tiles: list[int], wildcard_enabled: bool) -> bool:
    if not wildcard_enabled or WILDCARD not in tiles:
        return False
    return is_win_shape(tiles, True) and not is_win_shape(tiles, False)


def is_four_xiaoji(tiles: list[int], melds: list[Meld] | None = None) -> bool:
    return tiles.count(WILDCARD) == 4 and not (melds or [])


def score_hand(state: GameState, player_id: int, win_tile: int | None, self_draw: bool) -> dict:
    hand = sorted(state.hands[player_id])
    wildcard_enabled = not state.xiaoji_disabled
    fans: list[tuple[str, int]] = []
    fixed_points: list[tuple[str, int]] = []

    if is_four_xiaoji(hand, state.melds[player_id]):
        return {"points": 8, "fan": 3, "names": ["四小鸡"], "can_ron": True}

    wildcard_as_wild = _has_wildcard_as_wild(hand, wildcard_enabled)
    if not wildcard_as_wild:
        fans.append(("无鸡", 1))
    if self_draw and not any(m.type in {"chow", "pong", "kong"} and not m.concealed for m in state.melds[player_id]):
        if not is_seven_pairs(hand, wildcard_enabled) and not is_lanpai(hand, wildcard_enabled):
            fans.append(("门清自摸", 1))
    if state.last_draw_from_kong and state.last_kong_player == player_id:
        fans.append(("杠上开花", 1))
        if win_tile == FIVE_PIN:
            fans.append(("五梅花", 2))

    kong_total = sum(1 for m in state.melds[player_id] if m.type == "kong")
    if kong_total >= 4:
        fans.append(("四杠", 3))
    elif kong_total >= 2:
        fans.append(("双杠", 1))

    all_tiles = hand + [t for m in state.melds[player_id] for t in m.tiles]
    suits = {tile_suit(t) for t in all_tiles if t not in HONORS}
    has_honor = any(t in HONORS for t in all_tiles)
    if len(suits) == 1 and has_honor:
        fans.append(("混一色", 1))
    elif len(suits) <= 1:
        fans.append(("清一色", 2))

    if is_seven_pairs(hand, wildcard_enabled):
        c = counts([t for t in hand if t != WILDCARD])
        if any(n >= 4 for n in c) and win_tile is not None and c[win_tile] >= 4:
            fans.append(("小七对龙背", 3))
        else:
            fans.append(("小七对", 2))
    elif is_lanpai(hand, wildcard_enabled):
        if len({t for t in hand if t in HONORS}) == 7:
            fixed_points.append(("七星烂牌", 4))
        else:
            fixed_points.append(("烂牌", 2))
    else:
        c = counts(all_tiles)
        triplets = {i for i, n in enumerate(c) if n >= 3}
        if len(triplets) + kong_total >= 4:
            fans.append(("大对", 1))
        dragon_triplets = len(DRAGONS & triplets)
        wind_triplets = len(WINDS & triplets)
        if dragon_triplets == 3:
            fans.append(("大三元", 2))
        elif dragon_triplets == 2 and any(c[d] >= 2 for d in DRAGONS - triplets):
            fans.append(("小三元", 1))
        if wind_triplets == 4:
            fans.append(("大四喜", 3))
        elif wind_triplets == 3 and any(c[w] >= 2 for w in WINDS - triplets):
            fans.append(("小四喜", 2))

    if len(state.melds[player_id]) == 4 and not self_draw:
        fans.append(("全求人", 1))

    if fixed_points:
        points = max(point for _, point in fixed_points)
        names = [n for n, _ in fixed_points]
        fan = 1 if points <= 2 else 2
        if any(n == "无鸡" for n, _ in fans):
            points = min(8, points * 2)
            fan = min(3, fan + 1)
            names.append("无鸡")
        return {"points": points, "fan": fan, "names": names, "can_ron": True}

    fan = min(3, sum(v for _, v in fans))
    points = 2**fan
    names = [n for n, _ in fans] or ["底和"]
    can_ron = fan > 0 and not (wildcard_as_wild and fan == 0)
    return {"points": points, "fan": fan, "names": names, "can_ron": can_ron}


class FlybirdRuleEngine:
    """Deterministic first-pass Qujing Flybird Mahjong engine.

    It implements the core training semantics: xiaoji wildcard win/kong rules,
    public kong tiles, legal action masks, terminal scoring, draw thresholds,
    and the main fan table. Some table-management variants are exposed as
    config flags and default to the PDF's common rules.
    """

    def __init__(self, allow_chow: bool = True, draw_wall_tiles: int = 20):
        self.allow_chow = allow_chow
        self.draw_wall_tiles = draw_wall_tiles

    def reset(self, seed: int | None = None) -> GameState:
        rng = random.Random(seed)
        wall = make_wall(rng)
        hands = [sorted([wall.pop() for _ in range(13)]) for _ in range(4)]
        hands[0].append(wall.pop())
        hands[0].sort()
        kong_pool = [wall.pop(), wall.pop()]
        return GameState(
            hands=hands,
            wall=wall,
            kong_pool=kong_pool,
            discards=[[] for _ in range(4)],
            melds=[[] for _ in range(4)],
            scores=[0.0, 0.0, 0.0, 0.0],
            dealer=0,
            current_player=0,
            phase="discard",
        )

    def clone_state(self, state: GameState) -> GameState:
        return copy.deepcopy(state)

    def get_current_player(self, state: GameState) -> int:
        if state.pending:
            return state.pending.responders[state.pending.index]
        return state.current_player

    def get_legal_actions(self, state: GameState, player_id: int) -> list[int]:
        if state.terminal or player_id != self.get_current_player(state):
            return []
        if state.pending:
            return self._claim_actions(state, player_id)
        legal = [discard_action(tile) for tile in sorted(set(state.hands[player_id]))]
        if (
            is_win_shape(state.hands[player_id], not state.xiaoji_disabled)
            or is_four_xiaoji(state.hands[player_id], state.melds[player_id])
            or self._can_special_self_win(state, player_id)
        ):
            legal.append(ACTION_WIN)
        legal.extend(self._concealed_kong_actions(state, player_id))
        legal.extend(self._added_kong_actions(state, player_id))
        return sorted(set(legal))

    def step(self, state: GameState, player_id: int, action: int) -> GameState:
        next_state = self.clone_state(state)
        legal = self.get_legal_actions(next_state, player_id)
        if action not in legal:
            raise ValueError(f"illegal action {action} for player {player_id}; legal={legal}")
        next_state.step_count += 1
        next_state.last_action = str(action)
        if next_state.pending:
            self._apply_claim_action(next_state, player_id, action)
        elif action == ACTION_WIN:
            self._record_event(next_state, "win", player_id)
            self._finish_win(next_state, player_id, self_draw=True, special_name=self._special_win_name(next_state, player_id))
        elif action in (ACTION_KONG_CONCEALED, ACTION_KONG_ADDED):
            self._apply_kong(next_state, player_id, action)
        elif is_discard(action):
            self._apply_discard(next_state, player_id, action)
        else:
            raise ValueError(f"unsupported action: {action}")
        self._maybe_draw(next_state)
        return next_state

    def is_terminal(self, state: GameState) -> bool:
        return state.terminal

    def get_scores(self, state: GameState) -> list[float]:
        return list(state.scores)

    def get_winner(self, state: GameState) -> int | None:
        return state.winner

    def get_public_info(self, state: GameState) -> dict:
        return {
            "discards": copy.deepcopy(state.discards),
            "melds": copy.deepcopy(state.melds),
            "scores": list(state.scores),
            "dealer": state.dealer,
            "current_player": self.get_current_player(state),
            "remaining_wall": len(state.wall),
            "kong_pool": list(state.kong_pool),
            "last_discard": state.last_discard,
            "last_discard_player": state.last_discard_player,
            "xiaoji_disabled": state.xiaoji_disabled,
            "phase": state.phase,
            "public_events": copy.deepcopy(state.public_events),
        }

    def get_private_info(self, state: GameState, player_id: int) -> dict:
        return {"hand": list(state.hands[player_id])}

    def get_state_hash(self, state: GameState) -> str:
        payload = {
            "hands": state.hands,
            "wall_len": len(state.wall),
            "kong_pool": state.kong_pool,
            "discards": state.discards,
            "scores": state.scores,
            "current": self.get_current_player(state) if not state.terminal else None,
            "pending": None if not state.pending else state.pending.__dict__,
            "terminal": state.terminal,
            "furiten": [sorted(s) for s in state.same_round_furiten],
        }
        raw = json.dumps(payload, sort_keys=True, ensure_ascii=True)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def _claim_actions(self, state: GameState, player_id: int) -> list[int]:
        assert state.pending is not None
        tile = state.pending.tile
        hand = state.hands[player_id]
        legal = [ACTION_PASS]
        trial = sorted(hand + [tile])
        score = None
        if is_win_shape(trial, not state.xiaoji_disabled):
            state.hands[player_id].append(tile)
            state.hands[player_id].sort()
            score = score_hand(state, player_id, tile, self_draw=False)
            state.hands[player_id].remove(tile)
        if (
            score is not None
            and score["can_ron"]
            and tile not in state.same_round_furiten[player_id]
            and not state.reject_win_furiten[player_id]
        ):
            legal.append(ACTION_WIN)
        if state.pending.kind != "rob_kong" and hand.count(tile) >= 2 and tile not in state.reject_pong_tiles[player_id]:
            legal.append(ACTION_PONG)
        if state.pending.kind != "rob_kong" and self._can_exposed_kong(hand, tile):
            legal.append(ACTION_KONG_EXPOSED)
        if (
            state.pending.kind != "rob_kong"
            and self.allow_chow
            and player_id == (state.pending.discarder + 1) % 4
            and tile not in HONORS
        ):
            rank = tile_rank(tile)
            assert rank is not None
            if rank >= 3 and hand.count(tile - 2) and hand.count(tile - 1):
                legal.append(ACTION_CHOW_RIGHT)
            if 2 <= rank <= 8 and hand.count(tile - 1) and hand.count(tile + 1):
                legal.append(ACTION_CHOW_MIDDLE)
            if rank <= 7 and hand.count(tile + 1) and hand.count(tile + 2):
                legal.append(ACTION_CHOW_LEFT)
        has_win = ACTION_WIN in legal
        if not has_win and self._any_other_claim_win(state, player_id):
            return [ACTION_PASS]
        chow_actions = {ACTION_CHOW_LEFT, ACTION_CHOW_MIDDLE, ACTION_CHOW_RIGHT}
        if chow_actions.intersection(legal) and self._any_other_pong_or_kong(state, player_id):
            legal = [a for a in legal if a not in chow_actions]
        return legal

    def _any_other_claim_win(self, state: GameState, player_id: int) -> bool:
        assert state.pending is not None
        tile = state.pending.tile
        for other in state.pending.responders:
            if other == player_id:
                continue
            trial = sorted(state.hands[other] + [tile])
            if not is_win_shape(trial, not state.xiaoji_disabled):
                continue
            state.hands[other].append(tile)
            state.hands[other].sort()
            can_ron = score_hand(state, other, tile, self_draw=False)["can_ron"]
            state.hands[other].remove(tile)
            if can_ron and tile not in state.same_round_furiten[other] and not state.reject_win_furiten[other]:
                return True
        return False

    def _any_other_pong_or_kong(self, state: GameState, player_id: int) -> bool:
        assert state.pending is not None
        tile = state.pending.tile
        for other in state.pending.responders:
            if other == player_id:
                continue
            hand = state.hands[other]
            if hand.count(tile) >= 2 or self._can_exposed_kong(hand, tile):
                return True
        return False

    def _concealed_kong_actions(self, state: GameState, player_id: int) -> list[int]:
        hand = state.hands[player_id]
        c = counts(hand)
        actions: list[int] = []
        if any(v >= 4 for v in c):
            actions.append(ACTION_KONG_CONCEALED)
        if not state.xiaoji_disabled and c[WILDCARD]:
            wild = c[WILDCARD]
            for tile, n in enumerate(c):
                if tile != WILDCARD and n + wild >= 4 and n > 0:
                    actions.append(ACTION_KONG_CONCEALED)
                    break
        return actions

    def _added_kong_actions(self, state: GameState, player_id: int) -> list[int]:
        hand = state.hands[player_id]
        for meld in state.melds[player_id]:
            if meld.type == "pong":
                base = meld.tiles[0]
                if hand.count(base) or (not state.xiaoji_disabled and hand.count(WILDCARD)):
                    return [ACTION_KONG_ADDED]
        return []

    def _can_exposed_kong(self, hand: list[int], tile: int) -> bool:
        if hand.count(tile) >= 3:
            return True
        return not (tile == WILDCARD) and hand.count(tile) >= 2 and hand.count(WILDCARD) >= 1

    def _apply_discard(self, state: GameState, player_id: int, action: int) -> None:
        tile = action
        could_self_win_before_discard = is_win_shape(state.hands[player_id], not state.xiaoji_disabled)
        state.hands[player_id].remove(tile)
        state.discards[player_id].append(tile)
        self._record_event(state, "discard", player_id, tile=tile)
        self._track_special_discard(state, player_id, tile)
        special_name = self._special_win_name(state, player_id)
        if special_name:
            self._finish_win(state, player_id, self_draw=True, win_tile=tile, special_name=special_name)
            return
        state.last_discard = tile
        state.last_discard_player = player_id
        state.last_draw_from_kong = False
        if state.last_kong_player is not None:
            state.kong_after_discard_player = player_id
        if tile == WILDCARD:
            state.xiaoji_disabled = True
            if could_self_win_before_discard:
                state.reject_win_furiten[player_id] = True
        responders = [p for p in ((player_id + i) % 4 for i in range(1, 4))]
        state.pending = PendingClaim(discarder=player_id, tile=tile, responders=responders)
        state.phase = "claim"

    def _apply_claim_action(self, state: GameState, player_id: int, action: int) -> None:
        assert state.pending is not None
        if action == ACTION_PASS:
            self._record_event(state, "pass", player_id, tile=state.pending.tile, target_player=state.pending.discarder)
            legal_before_pass = self._claim_actions(state, player_id)
            if ACTION_WIN in legal_before_pass:
                state.same_round_furiten[player_id].add(state.pending.tile)
            if ACTION_PONG in legal_before_pass:
                state.reject_pong_tiles[player_id].add(state.pending.tile)
            state.pending.index += 1
            if state.pending.index >= len(state.pending.responders):
                if state.pending.kind == "rob_kong":
                    self._complete_added_kong_after_passes(state)
                else:
                    next_player = (state.pending.discarder + 1) % 4
                    self._draw_tile(state, next_player)
                    state.pending = None
            return
        tile = state.pending.tile
        discarder = state.pending.discarder
        if action == ACTION_WIN:
            self._record_event(state, "win", player_id, tile=tile, target_player=discarder)
            if state.pending.kind == "rob_kong":
                self._finish_multi_ron(state, discarder, tile, win_type="rob_kong", base_points=3.0, extra_name="抢杠")
            else:
                self._finish_multi_ron(state, discarder, tile)
            return
        if tile in state.discards[discarder]:
            state.discards[discarder].remove(tile)
        if action == ACTION_PONG:
            self._remove_tiles(state.hands[player_id], [tile, tile])
            state.melds[player_id].append(Meld("pong", [tile, tile, tile], from_player=discarder))
            self._record_event(state, "pong", player_id, tile=tile, target_player=discarder)
            state.current_player = player_id
            state.phase = "discard"
            state.pending = None
            self._clear_turn_restrictions(state, player_id)
            state.first_round_active = False
        elif action == ACTION_KONG_EXPOSED:
            needed = [tile, tile, tile]
            if state.hands[player_id].count(tile) >= 3:
                self._remove_tiles(state.hands[player_id], needed)
            else:
                self._remove_tiles(state.hands[player_id], [tile, tile, WILDCARD])
            state.melds[player_id].append(Meld("kong", [tile] * 4, from_player=discarder))
            self._record_event(state, "kong_exposed", player_id, tile=tile, target_player=discarder)
            state.pending = None
            state.first_round_active = False
            self._take_kong_tile(state, player_id, tile)
        elif action in (ACTION_CHOW_LEFT, ACTION_CHOW_MIDDLE, ACTION_CHOW_RIGHT):
            if action == ACTION_CHOW_LEFT:
                used = [tile + 1, tile + 2]
            elif action == ACTION_CHOW_MIDDLE:
                used = [tile - 1, tile + 1]
            else:
                used = [tile - 2, tile - 1]
            self._remove_tiles(state.hands[player_id], used)
            state.melds[player_id].append(Meld("chow", sorted(used + [tile]), from_player=discarder))
            self._record_event(state, "chow", player_id, tile=tile, target_player=discarder)
            if WILDCARD in used + [tile]:
                state.xiaoji_disabled = True
            state.current_player = player_id
            state.phase = "discard"
            state.pending = None
            self._clear_turn_restrictions(state, player_id)
            state.first_round_active = False

    def _apply_kong(self, state: GameState, player_id: int, action: int) -> None:
        hand = state.hands[player_id]
        if action == ACTION_KONG_CONCEALED:
            c = counts(hand)
            tile = next((i for i, n in enumerate(c) if n >= 4), None)
            if tile is None:
                wild = c[WILDCARD]
                tile = next(i for i, n in enumerate(c) if i != WILDCARD and n + wild >= 4 and n > 0)
                remove = [tile] * min(c[tile], 4) + [WILDCARD] * (4 - min(c[tile], 4))
            else:
                remove = [tile] * 4
            self._remove_tiles(hand, remove)
            state.melds[player_id].append(Meld("kong", [tile] * 4, concealed=True, wildcard_as=tile))
            self._record_event(state, "kong_concealed", player_id, tile=tile)
            self._take_kong_tile(state, player_id, tile)
        elif action == ACTION_KONG_ADDED:
            for meld_index, meld in enumerate(state.melds[player_id]):
                if meld.type == "pong":
                    base = meld.tiles[0]
                    if base in hand:
                        use_wildcard = False
                    elif not state.xiaoji_disabled and WILDCARD in hand:
                        use_wildcard = True
                    else:
                        continue
                    robbers = self._rob_kong_responders(state, player_id, base)
                    if robbers:
                        state.pending = PendingClaim(
                            discarder=player_id,
                            tile=base,
                            responders=robbers,
                            kind="rob_kong",
                            kong_meld_index=meld_index,
                            kong_use_wildcard=use_wildcard,
                        )
                        state.phase = "claim"
                        return
                    if use_wildcard:
                        hand.remove(WILDCARD)
                        meld.wildcard_as = base
                    else:
                        hand.remove(base)
                    meld.type = "kong"
                    meld.tiles = [base] * 4
                    meld.added_from_pong = True
                    self._record_event(state, "kong_added", player_id, tile=base)
                    self._take_kong_tile(state, player_id, base)
                    return
            raise ValueError("ACTION_KONG_ADDED has no eligible pong meld")
        else:
            raise ValueError(f"not a kong action: {action}")

    def _take_kong_tile(self, state: GameState, player_id: int, kong_tile: int) -> None:
        if not state.kong_pool:
            self._maybe_draw(state)
            return
        gained = state.kong_pool.pop(0)
        state.hands[player_id].append(gained)
        state.hands[player_id].sort()
        self._record_event(state, "kong_draw", player_id, tile=gained)
        if state.wall:
            state.kong_pool.append(state.wall.pop())
        state.kong_count += 1
        state.current_player = player_id
        state.phase = "discard"
        state.last_draw_from_kong = True
        state.last_kong_player = player_id
        state.kong_after_discard_player = None
        state.last_kong_tile = kong_tile

    def _draw_tile(self, state: GameState, player_id: int) -> None:
        if not state.wall:
            state.terminal = True
            state.draw = True
            return
        state.hands[player_id].append(state.wall.pop())
        state.hands[player_id].sort()
        state.current_player = player_id
        state.phase = "discard"
        state.last_draw_from_kong = False
        self._clear_turn_restrictions(state, player_id)

    def _maybe_draw(self, state: GameState) -> None:
        if not state.terminal and len(state.wall) <= self.draw_wall_tiles:
            state.terminal = True
            state.draw = True

    def _clear_turn_restrictions(self, state: GameState, player_id: int) -> None:
        state.same_round_furiten[player_id].clear()
        state.reject_win_furiten[player_id] = False
        state.reject_pong_tiles[player_id].clear()

    def _track_special_discard(self, state: GameState, player_id: int, tile: int) -> None:
        if state.first_round_active and tile in WINDS and state.wind_discards_first_round[player_id] is None:
            state.wind_discards_first_round[player_id] = tile
        if state.first_round_active and (tile not in WINDS or state.wind_discards_first_round[player_id] is not None):
            # Keep first-round wind tracking permissive; exposing a meld cancels it elsewhere.
            pass
        if is_special_terminal_or_honor(tile):
            state.special_discards[player_id].append(tile)
        else:
            state.discarded_non_special[player_id] = True

    def _special_win_name(self, state: GameState, player_id: int) -> str | None:
        if (
            len(state.special_discards[player_id]) >= 10
            and not state.discarded_non_special[player_id]
            and all(t in HONORS for t in state.special_discards[player_id][:10])
        ):
            return "十风"
        if len(state.special_discards[player_id]) >= 13 and not state.discarded_non_special[player_id]:
            if WILDCARD in state.special_discards[player_id]:
                return "十三幺有鸡"
            return "十三幺无鸡"
        return None

    def _can_special_self_win(self, state: GameState, player_id: int) -> bool:
        return self._special_win_name(state, player_id) is not None

    def _rob_kong_responders(self, state: GameState, kong_player: int, tile: int) -> list[int]:
        responders: list[int] = []
        for other in ((kong_player + i) % 4 for i in range(1, 4)):
            if tile in state.same_round_furiten[other] or state.reject_win_furiten[other]:
                continue
            trial = state.hands[other] + [tile]
            if is_win_shape(trial, not state.xiaoji_disabled):
                state.hands[other].append(tile)
                state.hands[other].sort()
                can_ron = score_hand(state, other, tile, self_draw=False)["can_ron"]
                state.hands[other].remove(tile)
                if can_ron:
                    responders.append(other)
        return responders

    def _complete_added_kong_after_passes(self, state: GameState) -> None:
        assert state.pending is not None and state.pending.kind == "rob_kong"
        player_id = state.pending.discarder
        meld_index = state.pending.kong_meld_index
        assert meld_index is not None
        meld = state.melds[player_id][meld_index]
        base = meld.tiles[0]
        if state.pending.kong_use_wildcard:
            state.hands[player_id].remove(WILDCARD)
            meld.wildcard_as = base
        else:
            state.hands[player_id].remove(base)
        meld.type = "kong"
        meld.tiles = [base] * 4
        meld.added_from_pong = True
        state.pending = None
        self._record_event(state, "kong_added", player_id, tile=base)
        self._take_kong_tile(state, player_id, base)

    def _claim_winners(self, state: GameState, payer: int, tile: int) -> list[int]:
        assert state.pending is not None
        winners: list[int] = []
        for player_id in state.pending.responders:
            if tile in state.same_round_furiten[player_id] or state.reject_win_furiten[player_id]:
                continue
            trial = state.hands[player_id] + [tile]
            if not is_win_shape(trial, not state.xiaoji_disabled):
                continue
            state.hands[player_id].append(tile)
            state.hands[player_id].sort()
            can_ron = score_hand(state, player_id, tile, self_draw=False)["can_ron"]
            state.hands[player_id].remove(tile)
            if can_ron:
                winners.append(player_id)
        return winners

    def _finish_multi_ron(
        self,
        state: GameState,
        payer: int,
        win_tile: int,
        win_type: str = "ron",
        base_points: float | None = None,
        extra_name: str | None = None,
    ) -> None:
        winners = self._claim_winners(state, payer, win_tile)
        if not winners:
            state.pending = None
            return
        total_paid = 0.0
        names: list[str] = []
        for winner in winners:
            state.hands[winner].append(win_tile)
            state.hands[winner].sort()
            score = score_hand(state, winner, win_tile, self_draw=False)
            state.hands[winner].remove(win_tile)
            points = float(base_points if base_points is not None else score["points"])
            if extra_name:
                score_names = [extra_name] + list(score["names"])
            elif state.kong_after_discard_player == payer:
                score_names = ["杠上炮"] + list(score["names"])
                points *= 2.0
            else:
                score_names = list(score["names"])
            state.scores[winner] += points
            total_paid += points
            names.extend(score_names)
        state.scores[payer] -= total_paid
        state.winner = winners[0]
        state.winners = winners
        state.win_type = win_type
        state.payer = payer
        state.win_points = total_paid
        state.win_names = sorted(set(names))
        state.terminal = True
        state.draw = False
        state.pending = None
        state.phase = "terminal"

    def _finish_win(
        self,
        state: GameState,
        player_id: int,
        self_draw: bool,
        payer: int | None = None,
        win_tile: int | None = None,
        special_name: str | None = None,
    ) -> None:
        win_tile = win_tile if win_tile is not None else (state.hands[player_id][-1] if state.hands[player_id] else None)
        if special_name:
            points = 8.0 if special_name in {"十风", "十三幺无鸡"} else 4.0
            score = {"points": points, "names": [special_name]}
        else:
            score = score_hand(state, player_id, win_tile, self_draw)
        points = float(score["points"])
        if self_draw:
            total_points = 0.0
            for p in range(4):
                if p != player_id:
                    state.scores[p] -= points
                    state.scores[player_id] += points
                    total_points += points
        else:
            assert payer is not None
            state.scores[payer] -= points
            state.scores[player_id] += points
            total_points = points
        state.winner = player_id
        state.winners = [player_id]
        state.win_type = "self_draw" if self_draw else "ron"
        state.payer = None if self_draw else payer
        state.win_points = total_points
        state.win_names = list(score["names"])
        state.terminal = True
        state.draw = False
        state.phase = "terminal"

    def _record_event(
        self,
        state: GameState,
        event_type: str,
        player_id: int,
        *,
        tile: int | None = None,
        target_player: int | None = None,
    ) -> None:
        state.public_events.append(
            {
                "type": event_type,
                "player": int(player_id),
                "target": None if target_player is None else int(target_player),
                "tile": None if tile is None else int(tile),
                "step": int(state.step_count),
                "wall": len(state.wall),
                "xiaoji_disabled": bool(state.xiaoji_disabled),
            }
        )

    @staticmethod
    def _remove_tiles(hand: list[int], tiles: list[int]) -> None:
        for tile in tiles:
            hand.remove(tile)


MockRuleEngine = FlybirdRuleEngine
