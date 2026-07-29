from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

import yaml

from mahjong_ai.agents.heuristic_agent import HeuristicAgent, WinFirstAgent
from mahjong_ai.agents.random_agent import RandomAgent
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
from mahjong_ai.env.gym_env import MahjongSingleAgentEnv
from mahjong_ai.inference.predictor import MahjongPredictor
from mahjong_ai.rules.flybird import WILDCARD
from mahjong_ai.rules.shanten import best_shanten
from mahjong_ai.utils.replay import ReplayLogger


def _make_fallback_agent(kind: str):
    if kind == "random":
        return RandomAgent(seed=7)
    if kind == "win_first":
        return WinFirstAgent(seed=7)
    return HeuristicAgent(seed=7)


def evaluate(
    model_path: str | None,
    num_games: int = 100,
    *,
    opponent: str = "heuristic",
    opponent_pool: dict | None = None,
    train_config: dict | None = None,
    seed_offset: int = 0,
    replay_output: str | None = None,
    include_observation: bool = False,
) -> dict:
    train_config = train_config or {}
    env_config = {**train_config.get("env", {})}
    if "observation" in train_config:
        env_config["observation"] = train_config["observation"]
    if "action_features" in train_config:
        env_config["action_features"] = train_config["action_features"]
    env_config["opponent_agent"] = opponent
    if "reward" in train_config:
        env_config["reward"] = train_config["reward"]
    if opponent_pool is not None:
        env_config["opponent_pool"] = opponent_pool
    env = MahjongSingleAgentEnv(env_config)
    predictor = MahjongPredictor(model_path=model_path) if model_path else None
    fallback = _make_fallback_agent(opponent)
    counters: Counter[str] = Counter()
    total_score = 0.0
    score_by_seat = [0.0, 0.0, 0.0, 0.0]
    latency_ms: list[float] = []
    action_counts: Counter[str] = Counter()
    xiaoji_discards = 0
    discard_count = 0
    replay = (
        ReplayLogger(
            replay_output,
            include_observation=include_observation,
            model_version=Path(model_path).stem if model_path else "heuristic_eval",
        )
        if replay_output
        else None
    )
    try:
        for game_index in range(num_games):
            game_id = f"eval_{seed_offset + game_index:08d}"
            obs, info = env.reset(seed=seed_offset + game_index)
            terminated = truncated = False
            game_steps = 0
            while not (terminated or truncated):
                state_hash_before = info["state_hash"]
                legal_actions = list(info["legal_actions"])
                start = time.perf_counter()
                fallback_used = False
                if predictor:
                    result = predictor.predict(obs, legal_actions)
                    action = int(result["action"])
                    fallback_used = bool(result["fallback_used"])
                else:
                    action = fallback.act(obs, legal_actions, {"hand": env.state.hands[0]})
                latency_ms.append((time.perf_counter() - start) * 1000.0)
                counters["fallback_count"] += int(fallback_used)
                _count_decision_quality(env, legal_actions, action, counters)
                _count_action(action, action_counts)
                if is_discard(action):
                    discard_count += 1
                    xiaoji_discards += int(action == WILDCARD)
                next_obs, reward, terminated, truncated, next_info = env.step(action)
                counters["illegal_action_count"] += int("illegal_action" in next_info)
                game_steps += 1
                if replay:
                    replay.log_step(
                        game_id=game_id,
                        step=game_steps,
                        player_id=0,
                        state_hash_before=state_hash_before,
                        legal_actions=legal_actions,
                        action=action,
                        action_source="model" if predictor else "heuristic",
                        state_hash_after=next_info["state_hash"],
                        reward=reward,
                        observation=obs,
                        extra={"fallback_used": fallback_used},
                    )
                obs, info = next_obs, next_info

            final_scores = list(info["scores"])
            winner = info["winner"]
            draw = bool(info["draw"])
            total_score += final_scores[0]
            for seat, score in enumerate(final_scores):
                score_by_seat[seat] += score
            winners = list(info.get("winners", []))
            counters["wins"] += int(winner == 0 or 0 in winners)
            counters["draws"] += int(draw)
            counters["controlled_deal_in"] += int(winner is not None and info["payer"] == 0)
            counters["controlled_self_draw_win"] += int(winner == 0 and info["win_type"] == "self_draw")
            counters["controlled_ron_win"] += int(winner == 0 and info["win_type"] == "ron")
            counters["truncated_games"] += int(truncated)
            counters["total_steps"] += game_steps
            if 0 in winners:
                counters["controlled_win_score_sum"] += final_scores[0]
                counters["controlled_win_points_sum"] += float(info.get("win_points") or 0.0)
            elif not draw:
                counters["controlled_loss_score_sum"] += final_scores[0]
                counters["controlled_losses"] += 1
                if info["payer"] == 0:
                    counters["controlled_deal_in_score_sum"] += -final_scores[0]
            if replay:
                replay.log_final(
                    game_id=game_id,
                    final_scores=final_scores,
                    winner=winner,
                    draw=draw,
                    total_steps=game_steps,
                    model_versions={"0": Path(model_path).stem if model_path else "heuristic_eval"},
                    extra={
                        "win_type": info["win_type"],
                        "payer": info["payer"],
                        "win_points": info["win_points"],
                        "win_names": info["win_names"],
                    },
                )
    finally:
        if replay:
            replay.close()

    total_wins = max(1, counters["wins"])
    return {
        "model": model_path,
        "opponent": opponent,
        "opponent_pool": opponent_pool,
        "num_games": num_games,
        "avg_score": total_score / num_games,
        "win_rate": counters["wins"] / num_games,
        "deal_in_rate": counters["controlled_deal_in"] / num_games,
        "draw_rate": counters["draws"] / num_games,
        "ron_rate": counters["controlled_ron_win"] / total_wins,
        "self_draw_rate": counters["controlled_self_draw_win"] / total_wins,
        "illegal_action_count": counters["illegal_action_count"],
        "fallback_count": counters["fallback_count"],
        "truncated_games": counters["truncated_games"],
        "avg_steps": counters["total_steps"] / num_games,
        "seat_avg_score": [score / num_games for score in score_by_seat],
        "score_quality": {
            "avg_score": total_score / num_games,
            "avg_score_when_win": counters["controlled_win_score_sum"] / max(1, counters["wins"]),
            "avg_win_points_when_win": counters["controlled_win_points_sum"] / max(1, counters["wins"]),
            "avg_score_when_not_win": counters["controlled_loss_score_sum"] / max(1, counters["controlled_losses"]),
            "avg_points_lost_when_deal_in": counters["controlled_deal_in_score_sum"]
            / max(1, counters["controlled_deal_in"]),
        },
        "action_rates": {
            "discard": action_counts["discard"] / max(1, counters["total_steps"]),
            "pong": action_counts["pong"] / max(1, counters["total_steps"]),
            "chow": action_counts["chow"] / max(1, counters["total_steps"]),
            "kong": action_counts["kong"] / max(1, counters["total_steps"]),
            "win": action_counts["win"] / max(1, counters["total_steps"]),
            "pass": action_counts["pass"] / max(1, counters["total_steps"]),
        },
        "decision_quality": _decision_quality_report(counters),
        "xiaoji_discard_rate": xiaoji_discards / max(1, discard_count),
        "model_latency_ms": {
            "mean": sum(latency_ms) / max(1, len(latency_ms)),
            "p95": _percentile(latency_ms, 95),
        },
        "replay_output": replay_output,
    }


def _count_action(action: int, counts: Counter[str]) -> None:
    if is_discard(action):
        counts["discard"] += 1
    elif action == ACTION_PONG:
        counts["pong"] += 1
    elif action in (ACTION_CHOW_LEFT, ACTION_CHOW_MIDDLE, ACTION_CHOW_RIGHT):
        counts["chow"] += 1
    elif action in (ACTION_KONG_CONCEALED, ACTION_KONG_EXPOSED, ACTION_KONG_ADDED):
        counts["kong"] += 1
    elif action == ACTION_WIN:
        counts["win"] += 1
    elif action == ACTION_PASS:
        counts["pass"] += 1


def _count_decision_quality(env: MahjongSingleAgentEnv, legal_actions: list[int], action: int, counters: Counter[str]) -> None:
    state = env.state
    if state is None:
        return
    hand = list(state.hands[0])
    open_melds = len(state.melds[0])
    wildcard_enabled = not bool(state.xiaoji_disabled)
    current_shanten = best_shanten(hand, open_melds=open_melds, wildcard_enabled=wildcard_enabled)

    if ACTION_WIN in legal_actions:
        counters["win_opportunities"] += 1
        counters["missed_win"] += int(action != ACTION_WIN)

    claim_actions = [a for a in legal_actions if a in {ACTION_PONG, ACTION_KONG_EXPOSED, ACTION_CHOW_LEFT, ACTION_CHOW_MIDDLE, ACTION_CHOW_RIGHT}]
    if claim_actions:
        counters["claim_opportunities"] += 1
        if action == ACTION_PASS:
            counters["claim_passes"] += 1
        else:
            counters["claim_accepts"] += int(action in claim_actions)
        best_claim_shanten = min(
            _estimate_claim_shanten(state, claim_action, current_shanten) for claim_action in claim_actions
        )
        if best_claim_shanten < current_shanten:
            counters["claim_improve_opportunities"] += 1
            counters["missed_improving_claim"] += int(action == ACTION_PASS)
        if action in claim_actions:
            selected_claim_shanten = _estimate_claim_shanten(state, action, current_shanten)
            counters["accepted_claim_improves"] += int(selected_claim_shanten < current_shanten)
            counters["accepted_claim_same"] += int(selected_claim_shanten == current_shanten)
            counters["accepted_claim_regresses"] += int(selected_claim_shanten > current_shanten)

    if is_discard(action):
        candidates = [candidate for candidate in legal_actions if is_discard(candidate)]
        if candidates:
            after_values = [
                _discard_after_shanten(hand, candidate, open_melds, wildcard_enabled) for candidate in candidates
            ]
            selected_after = _discard_after_shanten(hand, action, open_melds, wildcard_enabled)
            best_after = min(after_values)
            counters["discard_decisions"] += 1
            counters["discard_best_shanten"] += int(selected_after == best_after)
            counters["discard_miss_best_shanten"] += int(selected_after > best_after)
            counters["discard_regressions"] += int(selected_after > current_shanten)
            counters["ready_discard_regressions"] += int(current_shanten <= 0 and selected_after > current_shanten)
            counters["one_shanten_discard_regressions"] += int(current_shanten == 1 and selected_after > current_shanten)


def _discard_after_shanten(hand: list[int], tile: int, open_melds: int, wildcard_enabled: bool) -> int:
    if tile not in hand:
        return 8
    trial = list(hand)
    trial.remove(tile)
    return best_shanten(trial, open_melds=open_melds, wildcard_enabled=wildcard_enabled)


def _estimate_claim_shanten(state, action: int, fallback: int) -> int:
    pending = getattr(state, "pending", None)
    if pending is None:
        return fallback
    tile = pending.tile
    hand = list(state.hands[0])
    open_melds = len(state.melds[0])
    wildcard_enabled = not bool(state.xiaoji_disabled)
    try:
        if action == ACTION_PONG:
            trial = hand[:]
            trial.remove(tile)
            trial.remove(tile)
            return best_shanten(trial, open_melds=open_melds + 1, wildcard_enabled=wildcard_enabled)
        if action == ACTION_KONG_EXPOSED:
            trial = hand[:]
            for _ in range(3):
                trial.remove(tile)
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
        return fallback
    return fallback


def _rate(numerator: int, denominator: int) -> float:
    return float(numerator) / max(1, int(denominator))


def _decision_quality_report(counters: Counter[str]) -> dict:
    return {
        "win_opportunities": counters["win_opportunities"],
        "missed_win": counters["missed_win"],
        "missed_win_rate": _rate(counters["missed_win"], counters["win_opportunities"]),
        "claim_opportunities": counters["claim_opportunities"],
        "claim_accept_rate": _rate(counters["claim_accepts"], counters["claim_opportunities"]),
        "claim_pass_rate": _rate(counters["claim_passes"], counters["claim_opportunities"]),
        "claim_improve_opportunities": counters["claim_improve_opportunities"],
        "missed_improving_claim_rate": _rate(
            counters["missed_improving_claim"], counters["claim_improve_opportunities"]
        ),
        "accepted_claim_improves": counters["accepted_claim_improves"],
        "accepted_claim_same": counters["accepted_claim_same"],
        "accepted_claim_regresses": counters["accepted_claim_regresses"],
        "accepted_claim_regress_rate": _rate(counters["accepted_claim_regresses"], counters["claim_accepts"]),
        "discard_decisions": counters["discard_decisions"],
        "discard_best_shanten_rate": _rate(counters["discard_best_shanten"], counters["discard_decisions"]),
        "discard_miss_best_shanten_rate": _rate(counters["discard_miss_best_shanten"], counters["discard_decisions"]),
        "discard_regressions": counters["discard_regressions"],
        "discard_regression_rate": _rate(counters["discard_regressions"], counters["discard_decisions"]),
        "ready_discard_regressions": counters["ready_discard_regressions"],
        "one_shanten_discard_regressions": counters["one_shanten_discard_regressions"],
    }


def _percentile(values: list[float], p: int) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round((p / 100.0) * (len(ordered) - 1))))
    return ordered[index]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=None)
    parser.add_argument("--num-games", type=int, default=100)
    parser.add_argument("--opponent", choices=["heuristic", "random", "win_first", "pool"], default="heuristic")
    parser.add_argument("--opponent-pool-config", default=None)
    parser.add_argument("--config", default=None, help="Training config whose env/observation settings should be used.")
    parser.add_argument("--seed-offset", type=int, default=0)
    parser.add_argument("--output", default=None)
    parser.add_argument("--replay-output", default=None)
    parser.add_argument("--include-observation", action="store_true")
    args = parser.parse_args()
    opponent_pool = None
    if args.opponent_pool_config:
        with open(args.opponent_pool_config, "r", encoding="utf-8") as f:
            raw_pool_cfg = yaml.safe_load(f) or {}
        opponent_pool = raw_pool_cfg.get("opponent_pool", raw_pool_cfg)
    train_config = None
    if args.config:
        with open(args.config, "r", encoding="utf-8") as f:
            train_config = yaml.safe_load(f) or {}
    result = evaluate(
        args.model,
        args.num_games,
        opponent=args.opponent,
        opponent_pool=opponent_pool,
        train_config=train_config,
        seed_offset=args.seed_offset,
        replay_output=args.replay_output,
        include_observation=args.include_observation,
    )
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
