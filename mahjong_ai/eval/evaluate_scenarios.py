from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

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
from mahjong_ai.rules.flybird import Meld, PendingClaim
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

ACTION_NAMES = {
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


@dataclass(frozen=True)
class Scenario:
    name: str
    description: str
    hand: list[int]
    acceptable: list[int]
    bad: list[int] = field(default_factory=list)
    melds: list[Meld] = field(default_factory=list)
    pending: PendingClaim | None = None
    discards: list[list[int]] = field(default_factory=lambda: [[], [], [], []])
    xiaoji_disabled: bool = False
    note: str = ""


def scenarios() -> list[Scenario]:
    return [
        Scenario(
            name="discard_overcomplete_low_ukeire",
            description="多搭子时保留两面，优先拆孤张/低进张搭子",
            hand=[1, 1, 2, 4, 5, 12, 13, 13, 16, 18, 21, 22, 23, 25],
            acceptable=[18, 16, 25],
            bad=[1, 2, 4, 5, 12, 13, 21, 22, 23],
            note="对应 2万2万3万5万6万 / 4筒5筒5筒8筒 / 1条4条5条6条8条",
        ),
        Scenario(
            name="discard_isolated_honor_first",
            description="有孤字牌时，不应先拆中张连接牌",
            hand=[1, 2, 4, 12, 13, 13, 16, 17, 21, 23, 25, 26, 28, 30],
            acceptable=[28, 30],
            bad=[1, 2, 12, 13, 21, 23],
        ),
        Scenario(
            name="discard_live_xiaoji_is_bad",
            description="小鸡未失效时，不应随手打出小鸡",
            hand=[18, 1, 2, 4, 12, 13, 13, 16, 21, 22, 23, 28, 30, 33],
            acceptable=[28, 30, 33],
            bad=[18],
            note="1条是小鸡，未失效时应尽量保留",
        ),
        Scenario(
            name="discard_terminal_before_middle_connection",
            description="孤张/低价值幺九应优先于中张连接牌被处理",
            hand=[0, 1, 4, 5, 12, 13, 14, 16, 21, 22, 23, 24, 27, 33],
            acceptable=[27, 33, 0, 16],
            bad=[1, 4, 5, 12, 13, 14, 21, 22, 23],
        ),
        Scenario(
            name="keep_pair_eye_when_only_pair",
            description="只有一组对子时，不应轻易拆将",
            hand=[1, 2, 4, 5, 12, 13, 13, 16, 21, 22, 23, 25, 27, 30],
            acceptable=[27, 30, 16, 25],
            bad=[13],
        ),
        Scenario(
            name="ready_do_not_break_wait",
            description="听牌附近优先保持听牌，不要退向听",
            hand=[2, 12, 13, 13, 18, 21, 22, 23],
            melds=[Meld("chow", [3, 4, 5]), Meld("pong", [1, 1, 1])],
            acceptable=[2, 18],
            bad=[12, 13, 21, 22, 23],
            note="副露两组后，闭手处于 0 向听，测试是否乱拆面子/对子",
        ),
        Scenario(
            name="ready_with_junk_draw_cut_junk",
            description="听牌后摸入孤字牌，应切孤字而不是退听",
            hand=[2, 12, 13, 13, 18, 21, 22, 23, 28],
            melds=[Meld("chow", [3, 4, 5]), Meld("pong", [1, 1, 1])],
            acceptable=[28],
            bad=[12, 13, 21, 22, 23],
        ),
        Scenario(
            name="concealed_kong_available",
            description="暗杠机会出现时，应倾向于暗杠而不是直接打牌",
            hand=[4, 4, 4, 4, 1, 2, 3, 12, 13, 14, 21, 22, 23, 28],
            acceptable=[ACTION_KONG_CONCEALED],
            bad=[4],
        ),
        Scenario(
            name="added_kong_from_pong",
            description="已碰后摸到第4张，符合规则时应考虑加杠",
            hand=[4, 12, 13, 13, 18, 21, 22, 23],
            melds=[Meld("pong", [4, 4, 4])],
            acceptable=[ACTION_KONG_ADDED, 18, 4],
            bad=[12, 13, 21, 22, 23],
            note="加杠存在抢杠风险，所以允许加杠或保小鸡/补牌方向，但不应拆主要形",
        ),
        Scenario(
            name="claim_take_improving_chow",
            description="吃牌能降低向听时应该接受",
            hand=[1, 2, 4, 5, 12, 13, 13, 18, 21, 23, 25, 26, 28],
            pending=PendingClaim(discarder=3, tile=3, responders=[0]),
            discards=[[], [], [], [3]],
            acceptable=[ACTION_CHOW_RIGHT],
            bad=[ACTION_PASS],
        ),
        Scenario(
            name="claim_pass_non_improving_chow",
            description="吃牌不降向听且破坏灵活性时应该过",
            hand=[1, 2, 4, 5, 12, 13, 13, 18, 21, 22, 23, 25, 26],
            pending=PendingClaim(discarder=3, tile=3, responders=[0]),
            discards=[[], [], [], [3]],
            acceptable=[ACTION_PASS],
            bad=[ACTION_CHOW_RIGHT],
        ),
        Scenario(
            name="claim_take_improving_pong",
            description="碰牌能明显推进手牌时应该碰",
            hand=[1, 1, 2, 3, 4, 12, 13, 14, 18, 21, 22, 23, 28],
            pending=PendingClaim(discarder=3, tile=1, responders=[0]),
            discards=[[], [], [], [1]],
            acceptable=[ACTION_PONG],
            bad=[ACTION_PASS],
        ),
        Scenario(
            name="claim_pass_bad_pong",
            description="碰牌不能改善且会锁死手牌时应该过",
            hand=[1, 1, 2, 4, 5, 12, 13, 14, 18, 21, 22, 23, 28],
            pending=PendingClaim(discarder=3, tile=1, responders=[0]),
            discards=[[], [], [], [1]],
            acceptable=[ACTION_PASS],
            bad=[ACTION_PONG],
        ),
        Scenario(
            name="claim_exposed_kong_when_strong",
            description="明杠能形成强副露收益时可以明杠",
            hand=[5, 5, 5, 1, 2, 3, 12, 13, 14, 21, 22, 23, 28],
            pending=PendingClaim(discarder=3, tile=5, responders=[0]),
            discards=[[], [], [], [5]],
            acceptable=[ACTION_KONG_EXPOSED],
            bad=[ACTION_PASS],
        ),
        Scenario(
            name="win_when_legal",
            description="已经成胡型时必须胡",
            hand=[0, 1, 2, 3, 4, 5, 9, 10, 11, 18, 19, 20, 27, 27],
            acceptable=[ACTION_WIN],
            bad=[],
        ),
        Scenario(
            name="four_xiaoji_win",
            description="四小鸡应直接胡",
            hand=[18, 18, 18, 18, 1, 2, 3, 12, 13, 14, 21, 22, 23, 28],
            acceptable=[ACTION_WIN],
            bad=[],
        ),
        Scenario(
            name="lanpai_win",
            description="烂牌/七星烂牌类成型时应胡",
            hand=[0, 3, 6, 9, 12, 15, 19, 22, 25, 27, 28, 29, 30, 31],
            acceptable=[ACTION_WIN],
            bad=[],
            note="数牌间隔满足 1/4/7、2/5/8 等烂牌距离约束，且有足够字牌",
        ),
        Scenario(
            name="seven_pairs_win",
            description="小七对成型时应胡",
            hand=[0, 0, 1, 1, 9, 9, 10, 10, 19, 19, 27, 27, 31, 31],
            acceptable=[ACTION_WIN],
            bad=[],
        ),
    ]


def evaluate_scenarios(
    *,
    model_path: str,
    train_config: dict[str, Any] | None = None,
    deterministic: bool = True,
) -> dict[str, Any]:
    train_config = train_config or {}
    env_config: dict[str, Any] = {**train_config.get("env", {})}
    env_config["reward"] = train_config.get("reward", {})
    if "observation" in train_config:
        env_config["observation"] = train_config["observation"]
    if "action_features" in train_config:
        env_config["action_features"] = train_config["action_features"]
    env_config["opponent_agent"] = "heuristic"

    env = MahjongSingleAgentEnv(env_config)
    predictor = MahjongPredictor(model_path=model_path)
    records = []
    hits = 0
    total = 0

    for index, scenario in enumerate(scenarios()):
        obs, info = _load_scenario(env, scenario, seed=20260525 + index)
        legal = list(info["legal_actions"])
        result = predictor.predict(obs, legal, deterministic=deterministic)
        action = int(result["action"])
        acceptable = [a for a in scenario.acceptable if a in legal]
        bad = [a for a in scenario.bad if a in legal]
        hit = bool(acceptable and action in acceptable)
        bad_hit = bool(action in bad)
        hits += int(hit)
        total += 1
        records.append(
            {
                "name": scenario.name,
                "description": scenario.description,
                "note": scenario.note,
                "hand": scenario.hand,
                "hand_text": tiles_text(scenario.hand),
                "melds": [meld_text(meld) for meld in scenario.melds],
                "pending": None if scenario.pending is None else dict(scenario.pending.__dict__),
                "shanten": best_shanten(
                    scenario.hand,
                    open_melds=len(scenario.melds),
                    wildcard_enabled=not scenario.xiaoji_disabled,
                ),
                "legal_actions": legal,
                "legal_text": [action_text(a) for a in legal],
                "acceptable_actions": acceptable,
                "acceptable_text": [action_text(a) for a in acceptable],
                "bad_actions": bad,
                "bad_text": [action_text(a) for a in bad],
                "model_action": action,
                "model_action_text": action_text(action),
                "hit": hit,
                "bad_hit": bad_hit,
                "fallback_used": bool(result["fallback_used"]),
            }
        )

    return {
        "model": model_path,
        "deterministic": deterministic,
        "scenario_count": total,
        "hit_count": hits,
        "hit_rate": hits / max(1, total),
        "records": records,
    }


def _load_scenario(env: MahjongSingleAgentEnv, scenario: Scenario, seed: int):
    obs, _ = env.reset(seed=seed)
    assert env.state is not None
    state = env.state
    state.hands[0] = sorted(scenario.hand)
    state.melds[0] = list(scenario.melds)
    state.discards = [list(d) for d in scenario.discards]
    state.xiaoji_disabled = bool(scenario.xiaoji_disabled)
    state.terminal = False
    state.draw = False
    state.winner = None
    state.winners = []
    state.scores = [0.0, 0.0, 0.0, 0.0]
    state.pending = scenario.pending
    if scenario.pending is None:
        state.current_player = 0
        state.phase = "discard"
        state.last_discard = None
        state.last_discard_player = None
    else:
        state.current_player = scenario.pending.discarder
        state.phase = "claim"
        state.last_discard = scenario.pending.tile
        state.last_discard_player = scenario.pending.discarder
    obs = env._obs()
    info = env._info()
    return obs, info


def action_text(action: int) -> str:
    if is_discard(action):
        return f"打{tile_text(action)}"
    return ACTION_NAMES.get(action, str(action))


def tile_text(tile: int | None) -> str:
    if tile is None:
        return "-"
    return TILE_NAMES[int(tile)]


def tiles_text(tiles: list[int]) -> str:
    return " ".join(tile_text(tile) for tile in sorted(tiles)) if tiles else "-"


def meld_text(meld: Meld) -> str:
    flag = "暗" if meld.concealed else "明"
    return f"{flag}{meld.type}[{tiles_text(meld.tiles)}]"


def render_text(result: dict[str, Any]) -> str:
    lines = [
        f"模型: {result['model']}",
        f"命中: {result['hit_count']}/{result['scenario_count']} ({result['hit_rate']:.1%})",
        "",
    ]
    for rec in result["records"]:
        status = "OK" if rec["hit"] else "BAD" if rec["bad_hit"] else "MISS"
        lines.append(f"[{status}] {rec['name']}")
        lines.append(f"  {rec['description']}")
        if rec["note"]:
            lines.append(f"  note: {rec['note']}")
        lines.append(f"  手牌: {rec['hand_text']}")
        if rec["melds"]:
            lines.append(f"  副露: {' | '.join(rec['melds'])}")
        if rec["pending"]:
            lines.append(f"  待响应: {rec['pending']}")
        lines.append(f"  向听: {rec['shanten']}")
        lines.append(f"  合法: {', '.join(rec['legal_text'])}")
        lines.append(f"  合理候选: {', '.join(rec['acceptable_text']) or '-'}")
        lines.append(f"  不推荐: {', '.join(rec['bad_text']) or '-'}")
        lines.append(f"  模型选择: {rec['model_action_text']}")
        lines.append("")
    return "\n".join(lines)


def _load_train_config(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a model on fixed Mahjong decision scenarios.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--config", default=None)
    parser.add_argument("--stochastic", action="store_true")
    parser.add_argument("--output", default=None)
    parser.add_argument("--json-output", default=None)
    args = parser.parse_args()

    result = evaluate_scenarios(
        model_path=args.model,
        train_config=_load_train_config(args.config),
        deterministic=not args.stochastic,
    )
    text = render_text(result)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(text, encoding="utf-8")
    if args.json_output:
        Path(args.json_output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
