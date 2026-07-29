from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import yaml

from mahjong_ai.train.train_ppo import build_env, build_policy_kwargs, resolve_policy
from mahjong_ai.utils.torch_runtime import configure_torch_runtime


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def train_behavior_clone(config: dict, *, dataset_path: str | None = None, init_model: str | None = None) -> dict:
    try:
        from sb3_contrib import MaskablePPO
    except Exception as exc:  # pragma: no cover
        raise SystemExit("Please install sb3-contrib to train behavior cloning.") from exc

    runtime = configure_torch_runtime(config.get("cuda", {}))
    bc_cfg = config.get("behavior_cloning", {})
    train_cfg = config.get("train", {})
    model_cfg = config.get("model", {})
    path = Path(dataset_path or bc_cfg.get("dataset_path", "artifacts/datasets/v25_heuristic_bc.npz"))
    data = np.load(path, allow_pickle=False)
    observations = data["observations"].astype(np.float32)
    actions = data["actions"].astype(np.int64)
    action_masks = data["action_masks"].astype(np.bool_)

    env = build_env({**config, "train": {**train_cfg, "num_envs": 1}})
    if init_model:
        model = MaskablePPO.load(init_model, env=env, device=model_cfg.get("device", "auto"))
    else:
        model = MaskablePPO(
            resolve_policy(model_cfg),
            env,
            device=model_cfg.get("device", "auto"),
            policy_kwargs=build_policy_kwargs(model_cfg),
            learning_rate=float(train_cfg.get("learning_rate", 1e-4)),
            n_steps=int(train_cfg.get("n_steps", 256)),
            batch_size=int(train_cfg.get("batch_size", 1024)),
            n_epochs=1,
            verbose=1,
        )

    device = model.device
    optimizer = torch.optim.AdamW(
        model.policy.parameters(),
        lr=float(bc_cfg.get("learning_rate", 1e-4)),
        weight_decay=float(bc_cfg.get("weight_decay", 1e-5)),
    )
    batch_size = int(bc_cfg.get("batch_size", 2048))
    epochs = int(bc_cfg.get("epochs", 5))
    entropy_coef = float(bc_cfg.get("entropy_coef", 0.0))
    max_grad_norm = float(bc_cfg.get("max_grad_norm", 1.0))
    rng = np.random.default_rng(int(config.get("seed", 2026)))

    model.policy.train()
    history: list[dict] = []
    n = len(actions)
    for epoch in range(1, epochs + 1):
        order = rng.permutation(n)
        total_loss = 0.0
        total_correct = 0
        total_seen = 0
        for start in range(0, n, batch_size):
            idx = order[start : start + batch_size]
            obs_tensor = torch.as_tensor(observations[idx], dtype=torch.float32, device=device)
            action_tensor = torch.as_tensor(actions[idx], dtype=torch.long, device=device)
            mask_tensor = torch.as_tensor(action_masks[idx], dtype=torch.bool, device=device)
            dist = model.policy.get_distribution(obs_tensor, action_masks=mask_tensor)
            log_prob = dist.log_prob(action_tensor)
            entropy = dist.entropy()
            loss = -log_prob.mean() - entropy_coef * entropy.mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.policy.parameters(), max_grad_norm)
            optimizer.step()

            with torch.no_grad():
                pred = dist.distribution.probs.argmax(dim=1)
                total_correct += int((pred == action_tensor).sum().item())
                total_seen += len(idx)
                total_loss += float(loss.item()) * len(idx)
        row = {
            "epoch": epoch,
            "loss": total_loss / max(1, total_seen),
            "accuracy": total_correct / max(1, total_seen),
        }
        history.append(row)
        print(json.dumps(row, ensure_ascii=False))

    out_dir = Path(config.get("logging", {}).get("checkpoint_dir", "artifacts/checkpoints/v25_bc_heuristic"))
    out_dir.mkdir(parents=True, exist_ok=True)
    model.save(out_dir / "bc_model")
    metadata = {
        "dataset": str(path),
        "num_samples": int(n),
        "history": history,
        "runtime": runtime,
        "config": config,
    }
    (out_dir / "bc_metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"model": str(out_dir / "bc_model.zip"), "history": history}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a V2.5 behavior-cloned policy from heuristic samples.")
    parser.add_argument("--config", default="configs/bc_v25_heuristic.yaml")
    parser.add_argument("--dataset", default=None)
    parser.add_argument("--init-model", default=None)
    args = parser.parse_args()
    result = train_behavior_clone(load_config(args.config), dataset_path=args.dataset, init_model=args.init_model)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
