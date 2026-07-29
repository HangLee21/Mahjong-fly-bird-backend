from __future__ import annotations

from typing import Any

import numpy as np

try:
    import gymnasium as gym
    from gymnasium import spaces
except Exception:  # pragma: no cover
    gym = None
    spaces = None

from mahjong_ai.agents.heuristic_agent import HeuristicAgent, WinFirstAgent
from mahjong_ai.agents.opponent_pool import OpponentPool
from mahjong_ai.agents.random_agent import RandomAgent
from mahjong_ai.env.actions import ACTION_PASS, ACTION_SPACE_SIZE, build_action_mask
from mahjong_ai.env.observation import HISTORY_EVENT_DIM, build_observation, get_observation_dim, is_history_observation
from mahjong_ai.env.reward import compute_reward
from mahjong_ai.rules.flybird import FlybirdRuleEngine


class MahjongSingleAgentEnv(gym.Env if gym else object):
    metadata = {"render_modes": ["ansi"]}

    def __init__(self, config: dict | None = None):
        if gym is None:
            raise ImportError("gymnasium is required for MahjongSingleAgentEnv")
        self.config = config or {}
        self.controlled_player = int(self.config.get("controlled_player", 0))
        self.max_steps = int(self.config.get("max_steps_per_game", 300))
        self.rule_adapter = self.config.get("rule_adapter") or FlybirdRuleEngine(
            allow_chow=bool(self.config.get("allow_chow", True))
        )
        self.opponent_kind = str(self.config.get("opponent_agent", "heuristic"))
        self.opponent_pool = self._make_opponent_pool()
        self.opponents = self._make_opponents(self.opponent_kind)
        self.state: Any | None = None
        self._last_obs: Any | None = None
        if is_history_observation(self.config):
            history_len = int(self.config.get("observation", {}).get("history_len", self.config.get("history_len", 128)))
            self.observation_space = spaces.Dict(
                {
                    "static": spaces.Box(
                        low=-np.inf,
                        high=np.inf,
                        shape=(get_observation_dim(self.config),),
                        dtype=np.float32,
                    ),
                    "history": spaces.Box(
                        low=0.0,
                        high=1.0,
                        shape=(history_len, HISTORY_EVENT_DIM),
                        dtype=np.float32,
                    ),
                    "history_mask": spaces.Box(low=0.0, high=1.0, shape=(history_len,), dtype=np.float32),
                }
            )
        else:
            self.observation_space = spaces.Box(
                low=-np.inf,
                high=np.inf,
                shape=(get_observation_dim(self.config),),
                dtype=np.float32,
            )
        self.action_space = spaces.Discrete(ACTION_SPACE_SIZE)

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        if self.opponent_kind == "pool":
            self.opponents = self._make_opponents(self.opponent_kind)
        self.state = self.rule_adapter.reset(seed)
        self._auto_play_until_controlled()
        self._auto_pass_controlled_forced()
        obs = self._obs()
        return obs, self._info()

    def step(self, action: int):
        assert self.state is not None
        legal = self.rule_adapter.get_legal_actions(self.state, self.controlled_player)
        prev_state = self.rule_adapter.clone_state(self.state)
        if int(action) not in legal:
            obs = self._obs()
            return obs, -10.0, True, False, {**self._info(), "illegal_action": int(action)}
        self.state = self.rule_adapter.step(self.state, self.controlled_player, int(action))
        self._auto_play_until_controlled()
        self._auto_pass_controlled_forced()
        reward = compute_reward(
            prev_state,
            self.state,
            self.controlled_player,
            self.rule_adapter,
            self.config.get("reward", {}),
            action=int(action),
        )
        terminated = self.rule_adapter.is_terminal(self.state)
        truncated = bool(not terminated and self.state.step_count >= self.max_steps)
        if truncated:
            self.state.terminal = True
            self.state.draw = True
        obs = self._obs()
        return obs, reward, terminated, truncated, self._info()

    def action_masks(self) -> np.ndarray:
        assert self.state is not None
        return build_action_mask(self.rule_adapter.get_legal_actions(self.state, self.controlled_player))

    def render(self):
        assert self.state is not None
        return (
            f"player={self.rule_adapter.get_current_player(self.state)} "
            f"wall={len(self.state.wall)} scores={self.state.scores}"
        )

    def _make_opponents(self, kind: str):
        if kind == "pool":
            assert self.opponent_pool is not None
            return self.opponent_pool.sample_table(self.controlled_player)
        agents = []
        for seat in range(4):
            if seat == self.controlled_player:
                agents.append(None)
            elif kind == "random":
                agents.append(RandomAgent(seed=seat))
            elif kind == "win_first":
                agents.append(WinFirstAgent(seed=seat))
            else:
                agents.append(HeuristicAgent(seed=seat))
        return agents

    def _make_opponent_pool(self) -> OpponentPool | None:
        if self.opponent_kind != "pool":
            return None
        pool_cfg = self.config.get("opponent_pool", {})
        seed = self.config.get("seed_offset", self.config.get("seed"))
        return OpponentPool(pool_cfg, seed=int(seed) if seed is not None else None)

    def _auto_play_until_controlled(self) -> None:
        assert self.state is not None
        guard = 0
        while (
            not self.rule_adapter.is_terminal(self.state)
            and self.rule_adapter.get_current_player(self.state) != self.controlled_player
            and self.state.step_count < self.max_steps
        ):
            player = self.rule_adapter.get_current_player(self.state)
            legal = self.rule_adapter.get_legal_actions(self.state, player)
            obs = build_observation(self.rule_adapter, self.state, player, self.config)
            info = {**self._info_for(player), "hand": self.state.hands[player]}
            action = self.opponents[player].act(obs, legal, info)
            self.state = self.rule_adapter.step(self.state, player, action)
            guard += 1
            if guard > self.max_steps * 4:
                self.state.terminal = True
                self.state.draw = True
                break

    def _auto_pass_controlled_forced(self) -> None:
        assert self.state is not None
        guard = 0
        while (
            not self.rule_adapter.is_terminal(self.state)
            and self.rule_adapter.get_current_player(self.state) == self.controlled_player
            and self.rule_adapter.get_legal_actions(self.state, self.controlled_player) == [ACTION_PASS]
            and self.state.step_count < self.max_steps
        ):
            self.state = self.rule_adapter.step(self.state, self.controlled_player, ACTION_PASS)
            self._auto_play_until_controlled()
            guard += 1
            if guard > self.max_steps:
                self.state.terminal = True
                self.state.draw = True
                break

    def _obs(self) -> Any:
        assert self.state is not None
        self._last_obs = build_observation(self.rule_adapter, self.state, self.controlled_player, self.config)
        return self._last_obs

    def _info(self) -> dict:
        return self._info_for(self.controlled_player)

    def _info_for(self, player_id: int) -> dict:
        assert self.state is not None
        legal = self.rule_adapter.get_legal_actions(self.state, player_id)
        return {
            "legal_actions": legal,
            "action_mask": build_action_mask(legal),
            "state_hash": self.rule_adapter.get_state_hash(self.state),
            "scores": self.rule_adapter.get_scores(self.state),
            "winner": self.rule_adapter.get_winner(self.state),
            "winners": list(getattr(self.state, "winners", [])),
            "draw": bool(getattr(self.state, "draw", False)),
            "step_count": int(getattr(self.state, "step_count", 0)),
            "win_type": getattr(self.state, "win_type", None),
            "payer": getattr(self.state, "payer", None),
            "win_points": getattr(self.state, "win_points", 0.0),
            "win_names": getattr(self.state, "win_names", []),
            "hand": list(getattr(self.state, "hands", [[] for _ in range(4)])[player_id]),
            "open_melds": len(getattr(self.state, "melds", [[] for _ in range(4)])[player_id]),
            "xiaoji_disabled": bool(getattr(self.state, "xiaoji_disabled", False)),
            "last_discard": getattr(self.state, "last_discard", None),
        }
