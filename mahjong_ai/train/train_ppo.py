from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Callable

import yaml

from mahjong_ai.env.gym_env import MahjongSingleAgentEnv
from mahjong_ai.models.feature_extractor import (
    HybridHistoryTransformerExtractor,
    HybridHistoryTransformerV2Extractor,
    LayerNormMLPExtractor,
)
from mahjong_ai.models.action_value_policy import MaskableActionValuePolicy
from mahjong_ai.train.callbacks import EvalEarlyStopCallback
from mahjong_ai.utils.torch_runtime import configure_torch_runtime


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def build_policy_kwargs(model_cfg: dict) -> dict:
    policy_kwargs: dict = {}
    policy_name = str(model_cfg.get("policy", "MlpPolicy")).lower()
    if policy_name in {"action_value_policy", "maskable_action_value_policy"}:
        av_cfg = model_cfg.get("action_value", {})
        return {
            "action_feature_dim": int(av_cfg.get("action_feature_dim", 18)),
            "state_embedding_dim": int(av_cfg.get("state_embedding_dim", 512)),
            "action_embedding_dim": int(av_cfg.get("action_embedding_dim", 192)),
            "state_hidden_dims": list(av_cfg.get("state_hidden_dims", [1024, 768])),
            "action_hidden_dims": list(av_cfg.get("action_hidden_dims", [256, 256])),
            "scorer_hidden_dims": list(av_cfg.get("scorer_hidden_dims", [512, 256])),
            "value_hidden_dims": list(av_cfg.get("value_hidden_dims", [768, 384])),
            "action_chunk_size": int(av_cfg.get("action_chunk_size", 32)),
            "dropout": float(av_cfg.get("dropout", 0.02)),
            "activation_fn": model_cfg.get("activation_fn", "gelu"),
            "ortho_init": bool(model_cfg.get("ortho_init", False)),
        }
    net_arch = model_cfg.get("net_arch")
    if isinstance(net_arch, dict):
        policy_kwargs["net_arch"] = {
            "pi": list(net_arch.get("pi", [])),
            "vf": list(net_arch.get("vf", [])),
        }
    elif isinstance(net_arch, list):
        policy_kwargs["net_arch"] = list(net_arch)

    activation = str(model_cfg.get("activation_fn", "tanh")).lower()
    if activation:
        import torch.nn as nn

        activations = {
            "tanh": nn.Tanh,
            "relu": nn.ReLU,
            "gelu": nn.GELU,
            "elu": nn.ELU,
        }
        if activation not in activations:
            raise ValueError(f"unsupported activation_fn: {activation}")
        policy_kwargs["activation_fn"] = activations[activation]

    if "ortho_init" in model_cfg:
        policy_kwargs["ortho_init"] = bool(model_cfg["ortho_init"])

    extractor_cfg = model_cfg.get("feature_extractor", {})
    if extractor_cfg:
        name = extractor_cfg.get("name", "layer_norm_mlp")
        if name in {"hybrid_history_transformer", "hybrid_history_transformer_v2"}:
            extractor_class = (
                HybridHistoryTransformerV2Extractor
                if name == "hybrid_history_transformer_v2"
                else HybridHistoryTransformerExtractor
            )
            policy_kwargs["features_extractor_class"] = extractor_class
            policy_kwargs["features_extractor_kwargs"] = {
                "features_dim": int(extractor_cfg.get("features_dim", 768)),
                "static_hidden_dims": list(extractor_cfg.get("static_hidden_dims", [512, 512])),
                "d_model": int(extractor_cfg.get("d_model", 128)),
                "nhead": int(extractor_cfg.get("nhead", 4)),
                "num_layers": int(extractor_cfg.get("num_layers", 2)),
                "dropout": float(extractor_cfg.get("dropout", 0.05)),
                "max_history_len": int(extractor_cfg.get("max_history_len", 128)),
            }
            return policy_kwargs
        if name != "layer_norm_mlp":
            raise ValueError(f"unsupported feature extractor: {name}")
        policy_kwargs["features_extractor_class"] = LayerNormMLPExtractor
        policy_kwargs["features_extractor_kwargs"] = {
            "features_dim": int(extractor_cfg.get("features_dim", 512)),
            "hidden_dims": list(extractor_cfg.get("hidden_dims", [512, 512])),
            "dropout": float(extractor_cfg.get("dropout", 0.0)),
        }
    return policy_kwargs


def resolve_policy(model_cfg: dict):
    policy = model_cfg.get("policy", "MlpPolicy")
    policy_name = str(policy).lower()
    if policy_name in {"action_value_policy", "maskable_action_value_policy"}:
        return MaskableActionValuePolicy
    return policy


def make_env_factory(env_cfg: dict, rank: int, base_seed: int) -> Callable[[], MahjongSingleAgentEnv]:
    def _init() -> MahjongSingleAgentEnv:
        try:
            from stable_baselines3.common.monitor import Monitor
        except Exception:
            Monitor = None

        env = MahjongSingleAgentEnv({**env_cfg, "seed_offset": base_seed + rank})
        if Monitor is not None:
            return Monitor(env)
        return env

    return _init


def build_env(cfg: dict):
    try:
        from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv
    except Exception as exc:
        raise SystemExit("stable-baselines3 is required for vectorized training") from exc

    env_cfg = {**cfg.get("env", {}), "reward": cfg.get("reward", {})}
    if "observation" in cfg:
        env_cfg["observation"] = cfg["observation"]
    if "action_features" in cfg:
        env_cfg["action_features"] = cfg["action_features"]
    if "opponent_pool" in cfg:
        env_cfg["opponent_pool"] = cfg["opponent_pool"]
    train_cfg = cfg.get("train", {})
    num_envs = int(train_cfg.get("num_envs", 1))
    vec_env_type = str(train_cfg.get("vec_env_type", "dummy")).lower()
    seed = int(cfg.get("seed", 2026))
    if num_envs <= 1:
        return MahjongSingleAgentEnv(env_cfg)
    factories = [make_env_factory(env_cfg, rank, seed * 1000) for rank in range(num_envs)]
    if vec_env_type == "subproc":
        return SubprocVecEnv(factories)
    if vec_env_type == "dummy":
        return DummyVecEnv(factories)
    raise ValueError(f"unsupported vec_env_type: {vec_env_type}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="configs/ppo_debug.yaml")
    parser.add_argument("--resume", default=None, help="Path to a MaskablePPO checkpoint to continue training from.")
    parser.add_argument(
        "--reset-timesteps",
        action="store_true",
        help="Reset SB3 timestep counter when resuming. By default resume keeps checkpoint timesteps.",
    )
    args = parser.parse_args()
    cfg = load_config(args.config)
    runtime_info = configure_torch_runtime(cfg.get("cuda", {}))
    try:
        from sb3_contrib import MaskablePPO
        from sb3_contrib.common.maskable.utils import get_action_masks
        from stable_baselines3.common.callbacks import CallbackList
        from stable_baselines3.common.callbacks import CheckpointCallback
    except Exception as exc:
        raise SystemExit("Please install sb3-contrib to train: pip install -r requirements.txt") from exc

    env = build_env(cfg)
    train_cfg = cfg.get("train", {})
    model_cfg = cfg.get("model", {})
    num_envs = int(train_cfg.get("num_envs", 1))
    out = Path(cfg.get("logging", {}).get("checkpoint_dir", "artifacts/checkpoints/debug"))
    out.mkdir(parents=True, exist_ok=True)
    callbacks = []
    checkpoint_freq = int(cfg.get("logging", {}).get("checkpoint_freq", 0))
    if checkpoint_freq > 0:
        callback_save_freq = max(1, checkpoint_freq // max(1, num_envs))
        callbacks.append(
            CheckpointCallback(
                save_freq=callback_save_freq,
                save_path=str(out / "periodic"),
                name_prefix="model",
                save_replay_buffer=False,
                save_vecnormalize=False,
            )
        )
    early_cfg = cfg.get("early_stop", {})
    if early_cfg.get("enabled", False):
        eval_opponent = str(early_cfg.get("opponent", cfg.get("env", {}).get("opponent_agent", "heuristic")))
        callbacks.append(
            EvalEarlyStopCallback(
                checkpoint_dir=out,
                eval_freq=int(early_cfg.get("eval_freq", checkpoint_freq or 100000)),
                num_games=int(early_cfg.get("num_games", 3000)),
                metric=str(early_cfg.get("metric", "avg_score")),
                mode=str(early_cfg.get("mode", "max")),
                min_delta=float(early_cfg.get("min_delta", 0.0)),
                patience=int(early_cfg.get("patience", 5)),
                min_timesteps=int(early_cfg.get("min_timesteps", 1000000)),
                opponent=eval_opponent,
                opponent_pool=cfg.get("opponent_pool") if eval_opponent == "pool" else None,
                train_config=cfg,
                seed_offset=int(early_cfg.get("seed_offset", 100000)),
                verbose=1,
            )
        )
    if args.resume:
        print(f"Resuming MaskablePPO from {args.resume}")
        model = MaskablePPO.load(
            args.resume,
            env=env,
            device=model_cfg.get("device", "auto"),
            custom_objects={
                "learning_rate": float(train_cfg.get("learning_rate", 3e-4)),
                "clip_range": float(train_cfg.get("clip_range", 0.2)),
                "n_steps": int(train_cfg.get("n_steps", 256)),
                "batch_size": int(train_cfg.get("batch_size", 64)),
                "n_epochs": int(train_cfg.get("n_epochs", 4)),
                "gamma": float(train_cfg.get("gamma", 0.99)),
                "gae_lambda": float(train_cfg.get("gae_lambda", 0.95)),
                "ent_coef": float(train_cfg.get("ent_coef", 0.0)),
                "vf_coef": float(train_cfg.get("vf_coef", 0.5)),
                "max_grad_norm": float(train_cfg.get("max_grad_norm", 0.5)),
                "target_kl": None
                if train_cfg.get("target_kl") in (None, "null")
                else float(train_cfg.get("target_kl")),
            },
        )
        model.verbose = 1
    else:
        model = MaskablePPO(
            resolve_policy(model_cfg),
            env,
            device=model_cfg.get("device", "auto"),
            policy_kwargs=build_policy_kwargs(model_cfg),
            learning_rate=float(train_cfg.get("learning_rate", 3e-4)),
            n_steps=int(train_cfg.get("n_steps", 256)),
            batch_size=int(train_cfg.get("batch_size", 64)),
            n_epochs=int(train_cfg.get("n_epochs", 4)),
            gamma=float(train_cfg.get("gamma", 0.99)),
            gae_lambda=float(train_cfg.get("gae_lambda", 0.95)),
            clip_range=float(train_cfg.get("clip_range", 0.2)),
            ent_coef=float(train_cfg.get("ent_coef", 0.0)),
            vf_coef=float(train_cfg.get("vf_coef", 0.5)),
            max_grad_norm=float(train_cfg.get("max_grad_norm", 0.5)),
            target_kl=None if train_cfg.get("target_kl") in (None, "null") else float(train_cfg.get("target_kl")),
            verbose=1,
        )
    callback = callbacks[0] if len(callbacks) == 1 else CallbackList(callbacks) if callbacks else None
    model.learn(
        total_timesteps=int(train_cfg.get("total_timesteps", 1000)),
        use_masking=True,
        callback=callback,
        reset_num_timesteps=not args.resume or args.reset_timesteps,
    )
    model.save(out / "final_model")
    metadata = {
        "model_name": out.name,
        "obs_version": cfg.get("observation", {}).get("version", "obs_v1"),
        "rule_version": cfg.get("rule", {}).get("version", "flybird_rule_v1"),
        "action_version": cfg.get("action", {}).get("version", "action_v1"),
        "train_steps": int(train_cfg.get("total_timesteps", 1000)),
        "device": cfg.get("model", {}).get("device", "auto"),
        "resume_from": args.resume,
        "reset_timesteps": bool(args.reset_timesteps),
        "runtime": runtime_info,
        "config": cfg,
    }
    (out / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    if hasattr(env, "num_envs"):
        obs = env.reset()
        model.predict(obs, action_masks=get_action_masks(env))
    else:
        obs, _ = env.reset(seed=cfg.get("seed", 2026))
        model.predict(obs, action_masks=get_action_masks(env))


if __name__ == "__main__":
    main()
