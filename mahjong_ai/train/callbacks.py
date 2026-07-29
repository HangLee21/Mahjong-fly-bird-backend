from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from stable_baselines3.common.callbacks import BaseCallback
except Exception:  # pragma: no cover
    BaseCallback = object

from mahjong_ai.eval.evaluate import evaluate


class EvalEarlyStopCallback(BaseCallback):
    """Evaluate periodic checkpoints and stop when a metric plateaus."""

    def __init__(
        self,
        *,
        checkpoint_dir: str | Path,
        eval_freq: int,
        num_games: int,
        metric: str = "avg_score",
        mode: str = "max",
        min_delta: float = 0.0,
        patience: int = 5,
        min_timesteps: int = 0,
        opponent: str = "heuristic",
        opponent_pool: dict | None = None,
        train_config: dict | None = None,
        seed_offset: int = 100000,
        verbose: int = 1,
    ):
        super().__init__(verbose=verbose)
        if mode not in {"max", "min"}:
            raise ValueError("mode must be 'max' or 'min'")
        self.checkpoint_dir = Path(checkpoint_dir)
        self.eval_freq = int(eval_freq)
        self.num_games = int(num_games)
        self.metric = metric
        self.mode = mode
        self.min_delta = float(min_delta)
        self.patience = int(patience)
        self.min_timesteps = int(min_timesteps)
        self.opponent = opponent
        self.opponent_pool = opponent_pool
        self.train_config = train_config or {}
        self.seed_offset = int(seed_offset)
        self.best_value: float | None = None
        self.bad_evals = 0
        self.history: list[dict[str, Any]] = []
        self.last_eval_step = 0

    def _on_training_start(self) -> None:
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        (self.checkpoint_dir / "evals").mkdir(parents=True, exist_ok=True)
        self.last_eval_step = int(self.num_timesteps)

    def _on_step(self) -> bool:
        if self.num_timesteps < self.min_timesteps:
            return True
        if self.eval_freq <= 0 or self.num_timesteps - self.last_eval_step < self.eval_freq:
            return True

        step = int(self.num_timesteps)
        self.last_eval_step = step
        model_path = self.checkpoint_dir / "evals" / f"eval_model_{step}_steps.zip"
        report_path = self.checkpoint_dir / "evals" / f"eval_{step}_steps.json"
        self.model.save(model_path)
        if self.verbose:
            print(
                "[early_stop] "
                f"evaluating step={step} games={self.num_games} "
                f"opponent={self.opponent} metric={self.metric}"
            )
        report = evaluate(
            str(model_path),
            self.num_games,
            opponent=self.opponent,
            opponent_pool=self.opponent_pool,
            train_config=self.train_config,
            seed_offset=self.seed_offset,
        )
        report["timesteps"] = step
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        value = float(report[self.metric])
        improved = self._is_improved(value)
        if improved:
            self.best_value = value
            self.bad_evals = 0
            self.model.save(self.checkpoint_dir / "best_model.zip")
            (self.checkpoint_dir / "best_report.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        else:
            self.bad_evals += 1

        row = {
            "timesteps": step,
            "metric": self.metric,
            "value": value,
            "best_value": self.best_value,
            "improved": improved,
            "bad_evals": self.bad_evals,
            "report": str(report_path),
        }
        self.history.append(row)
        (self.checkpoint_dir / "early_stop_history.json").write_text(
            json.dumps(self.history, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if self.verbose:
            print(
                "[early_stop] "
                f"step={step} {self.metric}={value:.6f} "
                f"best={self.best_value:.6f} bad_evals={self.bad_evals}/{self.patience}"
            )
        return self.bad_evals < self.patience

    def _is_improved(self, value: float) -> bool:
        if self.best_value is None:
            return True
        if self.mode == "max":
            return value > self.best_value + self.min_delta
        return value < self.best_value - self.min_delta
