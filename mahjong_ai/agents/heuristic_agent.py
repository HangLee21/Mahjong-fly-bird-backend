from __future__ import annotations

import random

import numpy as np

from mahjong_ai.agents.base import BaseAgent
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
    is_discard,
)
from mahjong_ai.env.reward import discard_preference_score, hand_goal_scores_for_tiles
from mahjong_ai.rules.flybird import WILDCARD
from mahjong_ai.rules.shanten import best_shanten, fast_hand_value


class WinFirstAgent(BaseAgent):
    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)

    def act(
        self,
        observation: np.ndarray,
        legal_actions: list[int],
        info: dict | None = None,
    ) -> int:
        if ACTION_WIN in legal_actions:
            return ACTION_WIN
        discards = [a for a in legal_actions if is_discard(a)]
        if discards:
            return int(self.rng.choice(discards))
        if ACTION_PASS in legal_actions:
            return ACTION_PASS
        return int(legal_actions[0])


class HeuristicAgent(BaseAgent):
    def __init__(self, seed: int | None = None, pong_rate: float = 0.25, kong_rate: float = 0.6):
        self.rng = random.Random(seed)
        self.pong_rate = pong_rate
        self.kong_rate = kong_rate

    def act(
        self,
        observation: np.ndarray,
        legal_actions: list[int],
        info: dict | None = None,
    ) -> int:
        if ACTION_WIN in legal_actions:
            return ACTION_WIN
        hand = list((info or {}).get("hand", []))
        open_melds = int((info or {}).get("open_melds", 0))
        wildcard_enabled = not bool((info or {}).get("xiaoji_disabled", False))
        kong_actions = [a for a in (ACTION_KONG_CONCEALED, ACTION_KONG_ADDED, ACTION_KONG_EXPOSED) if a in legal_actions]
        if kong_actions and self.rng.random() < self.kong_rate:
            return kong_actions[0]
        if ACTION_PONG in legal_actions and self._should_pong(hand, open_melds, wildcard_enabled, info):
            return ACTION_PONG
        chow_action = self._choose_chow(legal_actions, hand, open_melds, wildcard_enabled, info)
        if chow_action is not None:
            return chow_action
        discards = [a for a in legal_actions if is_discard(a)]
        if discards:
            return self._choose_discard(discards, info)
        if ACTION_PASS in legal_actions:
            return ACTION_PASS
        return int(legal_actions[0])

    def _choose_discard(self, discards: list[int], info: dict | None) -> int:
        hand = list((info or {}).get("hand", []))
        if not hand:
            return int(self.rng.choice(discards))
        open_melds = int((info or {}).get("open_melds", 0))
        wildcard_enabled = not bool((info or {}).get("xiaoji_disabled", False))
        best_action = discards[0]
        best_key: tuple[int, float, int, float] | None = None
        for action in discards:
            tile = action
            trial = hand[:]
            if tile in trial:
                trial.remove(tile)
            shanten, shape_score = fast_hand_value(trial, open_melds=open_melds, wildcard_enabled=wildcard_enabled)
            goal_score = max(
                hand_goal_scores_for_tiles(
                    trial,
                    open_melds=open_melds,
                    xiaoji_disabled=not wildcard_enabled,
                )
            )
            xiaoji_penalty = 4.0 if wildcard_enabled and tile == WILDCARD else 0.0
            isolation = self._isolation_score(tile, trial)
            human_discard = discard_preference_score(tile, hand, wildcard_enabled)
            key = (-shanten, goal_score, shape_score, isolation + human_discard - xiaoji_penalty)
            if best_key is None or key > best_key:
                best_key = key
                best_action = action
        return int(best_action)

    def _should_pong(
        self,
        hand: list[int],
        open_melds: int,
        wildcard_enabled: bool,
        info: dict | None,
    ) -> bool:
        if self.rng.random() > self.pong_rate:
            return False
        tile = (info or {}).get("last_discard")
        if tile is None or hand.count(tile) < 2:
            return True
        before = best_shanten(hand + [tile], open_melds=open_melds, wildcard_enabled=wildcard_enabled)
        after_hand = hand[:]
        after_hand.remove(tile)
        after_hand.remove(tile)
        after = best_shanten(after_hand, open_melds=open_melds + 1, wildcard_enabled=wildcard_enabled)
        if after > before:
            return False
        before_scores = hand_goal_scores_for_tiles(
            hand + [tile],
            open_melds=open_melds,
            xiaoji_disabled=not wildcard_enabled,
        )
        after_scores = hand_goal_scores_for_tiles(
            after_hand,
            extra_tiles=[tile, tile, tile],
            open_melds=open_melds + 1,
            xiaoji_disabled=not wildcard_enabled,
        )
        target = max(range(len(before_scores)), key=lambda i: before_scores[i])
        return after_scores[target] >= before_scores[target] - 0.5

    def _choose_chow(
        self,
        legal_actions: list[int],
        hand: list[int],
        open_melds: int,
        wildcard_enabled: bool,
        info: dict | None,
    ) -> int | None:
        chow_actions = [a for a in (ACTION_CHOW_LEFT, ACTION_CHOW_MIDDLE, ACTION_CHOW_RIGHT) if a in legal_actions]
        tile = (info or {}).get("last_discard")
        if not chow_actions or tile is None:
            return None
        before_scores = hand_goal_scores_for_tiles(
            hand + [tile],
            open_melds=open_melds,
            xiaoji_disabled=not wildcard_enabled,
        )
        target = max(range(len(before_scores)), key=lambda i: before_scores[i])
        before_shanten = best_shanten(hand + [tile], open_melds=open_melds, wildcard_enabled=wildcard_enabled)
        best_action: int | None = None
        best_key: tuple[int, float] | None = None
        for action in chow_actions:
            used = self._chow_used_tiles(action, tile)
            if any(hand.count(t) < used.count(t) for t in set(used)):
                continue
            after_hand = hand[:]
            for used_tile in used:
                after_hand.remove(used_tile)
            after_shanten = best_shanten(after_hand, open_melds=open_melds + 1, wildcard_enabled=wildcard_enabled)
            after_scores = hand_goal_scores_for_tiles(
                after_hand,
                extra_tiles=sorted(used + [tile]),
                open_melds=open_melds + 1,
                xiaoji_disabled=not wildcard_enabled,
            )
            goal_delta = after_scores[target] - before_scores[target]
            key = (-after_shanten, goal_delta)
            if after_shanten <= before_shanten and goal_delta >= -0.5 and (best_key is None or key > best_key):
                best_key = key
                best_action = action
        return best_action

    @staticmethod
    def _chow_used_tiles(action: int, tile: int) -> list[int]:
        if action == ACTION_CHOW_LEFT:
            return [tile + 1, tile + 2]
        if action == ACTION_CHOW_MIDDLE:
            return [tile - 1, tile + 1]
        return [tile - 2, tile - 1]

    @staticmethod
    def _isolation_score(tile: int, hand: list[int]) -> float:
        if tile >= 27:
            return 1.5 - hand.count(tile)
        neighbors = sum(hand.count(t) for t in (tile - 2, tile - 1, tile + 1, tile + 2) if 0 <= t < 27)
        same = hand.count(tile)
        return 2.0 - neighbors - same * 1.5
