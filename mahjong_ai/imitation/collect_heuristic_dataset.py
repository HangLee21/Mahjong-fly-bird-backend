from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from mahjong_ai.agents.heuristic_agent import HeuristicAgent
from mahjong_ai.env.gym_env import MahjongSingleAgentEnv


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def build_env_config(cfg: dict) -> dict:
    env_cfg = {**cfg.get("env", {})}
    env_cfg["reward"] = cfg.get("reward", {})
    if "observation" in cfg:
        env_cfg["observation"] = cfg["observation"]
    if "action_features" in cfg:
        env_cfg["action_features"] = cfg["action_features"]
    if "opponent_pool" in cfg:
        env_cfg["opponent_pool"] = cfg["opponent_pool"]
    return env_cfg


def collect_dataset(
    config: dict,
    *,
    output: str | None = None,
    progress_interval: int | None = None,
) -> dict[str, Any]:
    bc_cfg = config.get("behavior_cloning", {})
    num_samples = int(bc_cfg.get("num_samples", 10000))
    max_games = int(bc_cfg.get("max_games", max(100, num_samples)))
    report_every = int(progress_interval or bc_cfg.get("progress_interval", 10000))
    seed = int(config.get("seed", 2026))
    deterministic_expert = bool(bc_cfg.get("deterministic_expert", True))
    expert = HeuristicAgent(seed=seed)
    env = MahjongSingleAgentEnv(build_env_config(config))

    observations: list[np.ndarray] = []
    actions: list[int] = []
    masks: list[np.ndarray] = []
    rewards: list[float] = []
    game_count = 0
    start_time = time.perf_counter()
    last_report_count = 0
    print(
        json.dumps(
            {
                "event": "collect_start",
                "target_samples": num_samples,
                "max_games": max_games,
                "progress_interval": report_every,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    while len(actions) < num_samples and game_count < max_games:
        obs, info = env.reset(seed=seed + game_count)
        terminated = truncated = False
        while not (terminated or truncated) and len(actions) < num_samples:
            legal_actions = list(info["legal_actions"])
            expert_info = {**info}
            if env.state is not None:
                expert_info["hand"] = list(env.state.hands[env.controlled_player])
            action = int(expert.act(obs, legal_actions, expert_info))
            if action not in legal_actions:
                action = int(legal_actions[0])
            observations.append(_static_obs(obs))
            masks.append(np.asarray(info["action_mask"], dtype=np.bool_))
            actions.append(action)
            obs, reward, terminated, truncated, info = env.step(action)
            rewards.append(float(reward))
            if report_every > 0 and len(actions) - last_report_count >= report_every:
                _print_progress(
                    sample_count=len(actions),
                    target=num_samples,
                    games=game_count + 1,
                    rewards=rewards,
                    start_time=start_time,
                )
                last_report_count = len(actions)
        game_count += 1
    _print_progress(
        sample_count=len(actions),
        target=num_samples,
        games=game_count,
        rewards=rewards,
        start_time=start_time,
        final=True,
    )

    data = {
        "observations": np.asarray(observations, dtype=np.float32),
        "actions": np.asarray(actions, dtype=np.int64),
        "action_masks": np.asarray(masks, dtype=np.bool_),
        "rewards": np.asarray(rewards, dtype=np.float32),
        "metadata": {
            "num_samples": len(actions),
            "games": game_count,
            "seed": seed,
            "deterministic_expert": deterministic_expert,
            "obs_kind": "static",
        },
    }
    output_path = output or str(bc_cfg.get("dataset_path", "artifacts/datasets/v25_heuristic_bc.npz"))
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        output_path,
        observations=data["observations"],
        actions=data["actions"],
        action_masks=data["action_masks"],
        rewards=data["rewards"],
        metadata=json.dumps(data["metadata"], ensure_ascii=False),
    )
    data["output"] = output_path
    return data


def _static_obs(obs: Any) -> np.ndarray:
    if isinstance(obs, dict):
        return np.asarray(obs["static"], dtype=np.float32)
    return np.asarray(obs, dtype=np.float32)


def _print_progress(
    *,
    sample_count: int,
    target: int,
    games: int,
    rewards: list[float],
    start_time: float,
    final: bool = False,
) -> None:
    elapsed = max(1e-6, time.perf_counter() - start_time)
    samples_per_sec = sample_count / elapsed
    remaining = max(0, target - sample_count)
    eta_sec = remaining / samples_per_sec if samples_per_sec > 0 else 0.0
    recent = rewards[-1000:]
    payload = {
        "event": "collect_done" if final else "collect_progress",
        "samples": sample_count,
        "target": target,
        "progress_pct": round(sample_count / max(1, target) * 100.0, 2),
        "games": games,
        "samples_per_sec": round(samples_per_sec, 2),
        "elapsed_min": round(elapsed / 60.0, 2),
        "eta_min": round(eta_sec / 60.0, 2),
        "recent_reward_mean": round(float(np.mean(recent)), 5) if recent else 0.0,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect heuristic expert state-action pairs for V2.5 BC.")
    parser.add_argument("--config", default="configs/bc_v25_heuristic.yaml")
    parser.add_argument("--output", default=None)
    parser.add_argument("--progress-interval", type=int, default=None)
    args = parser.parse_args()
    data = collect_dataset(load_config(args.config), output=args.output, progress_interval=args.progress_interval)
    print(
        json.dumps(
            {
                "output": data["output"],
                "num_samples": int(data["metadata"]["num_samples"]),
                "games": int(data["metadata"]["games"]),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
