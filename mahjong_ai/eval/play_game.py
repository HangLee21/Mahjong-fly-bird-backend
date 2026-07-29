from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
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
    ACTION_WIN,
    decode_action,
    is_discard,
)
from mahjong_ai.env.gym_env import MahjongSingleAgentEnv
from mahjong_ai.env.reward import hand_goal_scores_for_tiles
from mahjong_ai.inference.predictor import MahjongPredictor
from mahjong_ai.rules.shanten import best_shanten


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

GOAL_NAMES = ["平胡/顺子", "小七对", "清一色/混一色", "大对/刻子"]


def play_game(
    *,
    model_path: str,
    seed: int = 2026,
    opponent: str = "heuristic",
    deterministic: bool = True,
    max_steps: int = 300,
    opponent_pool: dict | None = None,
    train_config: dict | None = None,
) -> dict[str, Any]:
    train_config = train_config or {}
    env_config: dict[str, Any] = {**train_config.get("env", {})}
    env_config["reward"] = train_config.get("reward", {})
    if "observation" in train_config:
        env_config["observation"] = train_config["observation"]
    if "action_features" in train_config:
        env_config["action_features"] = train_config["action_features"]
    env_config["opponent_agent"] = opponent
    env_config["max_steps_per_game"] = max_steps
    if opponent_pool is not None:
        env_config["opponent_pool"] = opponent_pool
    env = MahjongSingleAgentEnv(env_config)
    predictor = MahjongPredictor(model_path=model_path)

    obs, info = env.reset(seed=seed)
    records: list[dict[str, Any]] = []
    terminated = truncated = False
    step = 0
    draw_into_decision = "起手/首个决策"
    while not (terminated or truncated):
        assert env.state is not None
        before = _snapshot(env, info)
        legal = list(info["legal_actions"])
        result = predictor.predict(obs, legal, deterministic=deterministic)
        action = int(result["action"])
        next_obs, reward, terminated, truncated, next_info = env.step(action)
        after = _snapshot(env, next_info)
        records.append(
            {
                "step": step + 1,
                "action": action,
                "action_text": action_text(action),
                "fallback_used": bool(result["fallback_used"]),
                "reward": float(reward),
                "draw_into_decision": draw_into_decision,
                "before": before,
                "after": after,
                "transition": _transition_summary(before, after, action),
            }
        )
        draw_into_decision = records[-1]["transition"]["added_text"]
        obs, info = next_obs, next_info
        step += 1
        if step >= max_steps:
            break

    assert env.state is not None
    final = {
        "model": model_path,
        "seed": seed,
        "opponent": opponent,
        "deterministic": deterministic,
        "reward_config_loaded": bool(env_config.get("reward")),
        "winner": info.get("winner"),
        "winners": info.get("winners", []),
        "draw": bool(info.get("draw", False)),
        "win_type": info.get("win_type"),
        "payer": info.get("payer"),
        "win_points": info.get("win_points"),
        "win_names": info.get("win_names", []),
        "scores": info.get("scores"),
        "steps": step,
        "records": records,
    }
    return final


def _snapshot(env: MahjongSingleAgentEnv, info: dict[str, Any]) -> dict[str, Any]:
    assert env.state is not None
    player = env.controlled_player
    hand = list(env.state.hands[player])
    open_tiles = [tile for meld in env.state.melds[player] for tile in meld.tiles]
    goal_scores = hand_goal_scores_for_tiles(
        hand,
        extra_tiles=open_tiles,
        open_melds=len(env.state.melds[player]),
        xiaoji_disabled=bool(env.state.xiaoji_disabled),
    )
    target_index = max(range(len(goal_scores)), key=lambda i: goal_scores[i])
    return {
        "hand": hand,
        "hand_text": tiles_text(hand),
        "melds": [meld_text(meld) for meld in env.state.melds[player]],
        "all_melds": [[meld_text(meld) for meld in melds] for melds in env.state.melds],
        "discards": [tiles_text(d) for d in env.state.discards],
        "discard_counts": [len(d) for d in env.state.discards],
        "kong_pool": tiles_text(env.state.kong_pool),
        "kong_pool_raw": list(env.state.kong_pool),
        "last_discard": tile_text(env.state.last_discard),
        "last_discard_player": env.state.last_discard_player,
        "wall_count": len(env.state.wall),
        "scores": list(env.state.scores),
        "dealer": int(env.state.dealer),
        "current_player": int(env.state.current_player),
        "phase": env.state.phase,
        "pending": None if env.state.pending is None else dict(env.state.pending.__dict__),
        "last_action": env.state.last_action,
        "last_draw_from_kong": bool(env.state.last_draw_from_kong),
        "last_kong_player": env.state.last_kong_player,
        "last_kong_tile": tile_text(env.state.last_kong_tile),
        "public_events_tail": [_event_text(event) for event in getattr(env.state, "public_events", [])[-8:]],
        "legal_actions": list(info["legal_actions"]),
        "legal_text": [action_text(a) for a in info["legal_actions"]],
        "shanten": best_shanten(
            hand,
            open_melds=len(env.state.melds[player]),
            wildcard_enabled=not bool(env.state.xiaoji_disabled),
        ),
        "goal": GOAL_NAMES[target_index],
        "goal_scores": {GOAL_NAMES[i]: round(float(score), 3) for i, score in enumerate(goal_scores)},
        "xiaoji_disabled": bool(env.state.xiaoji_disabled),
    }


def _transition_summary(before: dict[str, Any], after: dict[str, Any], action: int) -> dict[str, Any]:
    before_counter = Counter(before.get("hand", []))
    after_counter = Counter(after.get("hand", []))
    removed = sorted((before_counter - after_counter).elements())
    added = sorted((after_counter - before_counter).elements())
    discarded = [action] if is_discard(action) else []
    return {
        "added": added,
        "removed": removed,
        "discarded": discarded,
        "added_text": tiles_text(added),
        "removed_text": tiles_text(removed),
        "discarded_text": tiles_text(discarded),
    }


def render_text(game: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"模型: {game['model']}")
    lines.append(f"seed: {game['seed']}  opponent: {game['opponent']}  deterministic: {game['deterministic']}")
    lines.append(f"reward_config_loaded: {game.get('reward_config_loaded', False)}")
    lines.append("")
    for rec in game["records"]:
        before = rec["before"]
        after = rec["after"]
        lines.append(f"Step {rec['step']:02d}")
        lines.append(f"  手牌: {before['hand_text']}")
        if before["melds"]:
            lines.append(f"  副露: {' | '.join(before['melds'])}")
        lines.append(
            f"  目标: {before['goal']}  向听: {before['shanten']}  "
            f"杠牌: {before['kong_pool']}  余牌: {before['wall_count']}"
        )
        lines.append(f"  目标分: {_goal_scores_text(before['goal_scores'])}")
        lines.append(f"  上张: P{before['last_discard_player']} {before['last_discard']}")
        lines.append(f"  合法: {', '.join(before['legal_text'])}")
        lines.append(
            f"  选择: {rec['action_text']}  reward={rec['reward']:.4f}"
            + ("  fallback" if rec["fallback_used"] else "")
        )
        lines.append(f"  后手: {after['hand_text']}")
        lines.append("")
    lines.append("Final")
    lines.append(
        f"  winner={game['winner']} winners={game['winners']} draw={game['draw']} "
        f"win_type={game['win_type']} payer={game['payer']}"
    )
    lines.append(f"  win_points={game['win_points']} win_names={game['win_names']}")
    lines.append(f"  scores={game['scores']}")
    return "\n".join(lines)


def render_text(game: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"模型: {game['model']}")
    lines.append(f"seed: {game['seed']}  opponent: {game['opponent']}  deterministic: {game['deterministic']}")
    lines.append(f"reward_config_loaded: {game.get('reward_config_loaded', False)}")
    lines.append("")
    for rec in game["records"]:
        before = rec["before"]
        after = rec["after"]
        transition = rec.get("transition", {})
        lines.append(f"Step {rec['step']:02d}")
        lines.append(f"  手牌: {before['hand_text']}")
        lines.append(f"  本次摸入/进入决策新增: {rec.get('draw_into_decision', '-')}")
        if before["melds"]:
            lines.append(f"  副露: {' | '.join(before['melds'])}")
        lines.append(
            f"  分数: {before.get('scores', '-')}  庄家: P{before.get('dealer')}  "
            f"当前: P{before.get('current_player')}  阶段: {before.get('phase', '-')}"
        )
        lines.append(
            f"  目标: {before['goal']}  向听: {before['shanten']}  "
            f"杠牌: {before['kong_pool']}  余牌: {before['wall_count']}"
        )
        lines.append(
            f"  小鸡失效: {before.get('xiaoji_disabled', False)}  "
            f"上次杠: P{before.get('last_kong_player')} {before.get('last_kong_tile', '-')}  "
            f"杠后摸: {before.get('last_draw_from_kong', False)}"
        )
        lines.append(f"  目标分: {_goal_scores_text(before['goal_scores'])}")
        lines.append(f"  上张: P{before['last_discard_player']} {before['last_discard']}")
        if before.get("pending"):
            lines.append(f"  待响应: {before['pending']}")
        lines.append(f"  公开弃牌: {_seat_lines(before.get('discards', []))}")
        lines.append(f"  全员副露: {_seat_lines([' | '.join(melds) if melds else '-' for melds in before.get('all_melds', [])])}")
        if before.get("public_events_tail"):
            lines.append(f"  最近公开事件: {'; '.join(before['public_events_tail'])}")
        lines.append(f"  合法: {', '.join(before['legal_text'])}")
        lines.append(
            f"  选择: {rec['action_text']}  reward={rec['reward']:.4f}"
            + ("  fallback" if rec["fallback_used"] else "")
        )
        lines.append(
            f"  本步手牌变化: 减少 {transition.get('removed_text', '-')}  "
            f"新增 {transition.get('added_text', '-')}"
        )
        lines.append(f"  后手: {after['hand_text']}")
        lines.append("")
    lines.append("Final")
    lines.append(
        f"  winner={game['winner']} winners={game['winners']} draw={game['draw']} "
        f"win_type={game['win_type']} payer={game['payer']}"
    )
    lines.append(f"  win_points={game['win_points']} win_names={game['win_names']}")
    lines.append(f"  scores={game['scores']}")
    return "\n".join(lines)


def _goal_scores_text(scores: dict[str, float]) -> str:
    return ", ".join(f"{name}:{value:.2f}" for name, value in scores.items())


def _seat_lines(items: list[Any]) -> str:
    return " | ".join(f"P{i}:{item}" for i, item in enumerate(items))


def _event_text(event: dict[str, Any]) -> str:
    tile = tile_text(event.get("tile"))
    target = event.get("target")
    target_text = "-" if target is None else f"P{target}"
    return f"{event.get('step')}:{event.get('type')} P{event.get('player')}->{target_text} {tile}"


def tile_text(tile: int | None) -> str:
    if tile is None:
        return "-"
    return TILE_NAMES[int(tile)]


def tiles_text(tiles: list[int]) -> str:
    if not tiles:
        return "-"
    return " ".join(tile_text(tile) for tile in sorted(tiles))


def meld_text(meld: Any) -> str:
    flag = "暗" if getattr(meld, "concealed", False) else "明"
    return f"{flag}{getattr(meld, 'type', '?')}[{tiles_text(list(getattr(meld, 'tiles', [])))}]"


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
    return mapping.get(action_id, decode_action(action_id).type)


def _load_opponent_pool(path: str | None) -> dict | None:
    if not path:
        return None
    import yaml

    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return raw.get("opponent_pool", raw)


def _load_train_config(path: str | None) -> dict:
    if not path:
        return {}
    import yaml

    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Play one readable Mahjong game with a trained model.")
    parser.add_argument("--model", required=True, help="Path to a MaskablePPO model zip.")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--opponent", choices=["heuristic", "random", "win_first", "pool"], default="heuristic")
    parser.add_argument("--opponent-pool-config", default=None)
    parser.add_argument("--config", default=None, help="Training config whose env/reward settings should be used.")
    parser.add_argument("--max-steps", type=int, default=300)
    parser.add_argument("--stochastic", action="store_true", help="Use stochastic model actions.")
    parser.add_argument("--output", default=None, help="Write readable text to this path.")
    parser.add_argument("--json-output", default=None, help="Write structured JSON to this path.")
    args = parser.parse_args()

    game = play_game(
        model_path=args.model,
        seed=args.seed,
        opponent=args.opponent,
        deterministic=not args.stochastic,
        max_steps=args.max_steps,
        opponent_pool=_load_opponent_pool(args.opponent_pool_config),
        train_config=_load_train_config(args.config),
    )
    text = render_text(game)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(text, encoding="utf-8")
    if args.json_output:
        Path(args.json_output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_output).write_text(json.dumps(game, ensure_ascii=False, indent=2), encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
