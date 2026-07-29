from __future__ import annotations

from functools import partial
from typing import Any

import numpy as np
import torch as th
from gymnasium import spaces
from torch import nn

from sb3_contrib.common.maskable.distributions import MaskableDistribution
from sb3_contrib.common.maskable.policies import MaskableActorCriticPolicy
from stable_baselines3.common.type_aliases import PyTorchObs, Schedule

from mahjong_ai.env.actions import ACTION_SPACE_SIZE
from mahjong_ai.env.observation import ACTION_FEATURE_DIM


def _activation(name_or_cls: str | type[nn.Module]) -> type[nn.Module]:
    if isinstance(name_or_cls, type):
        return name_or_cls
    name = str(name_or_cls).lower()
    mapping = {
        "tanh": nn.Tanh,
        "relu": nn.ReLU,
        "gelu": nn.GELU,
        "elu": nn.ELU,
    }
    if name not in mapping:
        raise ValueError(f"unsupported activation: {name_or_cls}")
    return mapping[name]


def _mlp(
    input_dim: int,
    hidden_dims: list[int] | tuple[int, ...],
    output_dim: int,
    activation_fn: type[nn.Module],
    *,
    dropout: float = 0.0,
    final_activation: bool = True,
) -> nn.Sequential:
    layers: list[nn.Module] = []
    prev_dim = int(input_dim)
    for hidden_dim in hidden_dims:
        hidden = int(hidden_dim)
        layers.append(nn.Linear(prev_dim, hidden))
        layers.append(nn.LayerNorm(hidden))
        layers.append(activation_fn())
        if dropout > 0:
            layers.append(nn.Dropout(float(dropout)))
        prev_dim = hidden
    layers.append(nn.Linear(prev_dim, int(output_dim)))
    if final_activation:
        layers.append(nn.LayerNorm(int(output_dim)))
        layers.append(activation_fn())
        if dropout > 0:
            layers.append(nn.Dropout(float(dropout)))
    return nn.Sequential(*layers)


class MaskableActionValuePolicy(MaskableActorCriticPolicy):
    """Maskable PPO policy that scores every legal Mahjong action explicitly.

    V3-lite flattened all action feature rows into the observation and let a
    regular MLP infer how to compare them. This policy keeps the same
    observation format but uses a state encoder, a shared action encoder and a
    scorer applied to each action row. The output logits are therefore true
    state-action scores, while the value function uses the state embedding plus
    a pooled legal-action context.
    """

    def __init__(
        self,
        observation_space: spaces.Space,
        action_space: spaces.Space,
        lr_schedule: Schedule,
        *args: Any,
        action_feature_dim: int = ACTION_FEATURE_DIM,
        state_embedding_dim: int = 512,
        action_embedding_dim: int = 192,
        state_hidden_dims: list[int] | tuple[int, ...] = (1024, 768),
        action_hidden_dims: list[int] | tuple[int, ...] = (256, 256),
        scorer_hidden_dims: list[int] | tuple[int, ...] = (512, 256),
        value_hidden_dims: list[int] | tuple[int, ...] = (768, 384),
        action_chunk_size: int = 32,
        dropout: float = 0.02,
        activation_fn: type[nn.Module] | str = nn.GELU,
        **kwargs: Any,
    ):
        self.action_feature_dim = int(action_feature_dim)
        self.state_embedding_dim = int(state_embedding_dim)
        self.action_embedding_dim = int(action_embedding_dim)
        self.state_hidden_dims = tuple(int(v) for v in state_hidden_dims)
        self.action_hidden_dims = tuple(int(v) for v in action_hidden_dims)
        self.scorer_hidden_dims = tuple(int(v) for v in scorer_hidden_dims)
        self.value_hidden_dims = tuple(int(v) for v in value_hidden_dims)
        self.action_chunk_size = max(1, int(action_chunk_size))
        self.dropout = float(dropout)
        self.full_activation_fn = _activation(activation_fn)
        super().__init__(
            observation_space,
            action_space,
            lr_schedule,
            *args,
            activation_fn=self.full_activation_fn,
            **kwargs,
        )

    def _build(self, lr_schedule: Schedule) -> None:
        obs_dim = int(self.observation_space.shape[0])  # type: ignore[index]
        action_block_dim = ACTION_SPACE_SIZE * self.action_feature_dim
        if obs_dim <= action_block_dim:
            raise ValueError(
                f"V3-full policy expects flat state+action features, got obs_dim={obs_dim}, "
                f"action_block_dim={action_block_dim}"
            )
        self.state_dim = obs_dim - action_block_dim

        self.state_encoder = _mlp(
            self.state_dim,
            self.state_hidden_dims,
            self.state_embedding_dim,
            self.full_activation_fn,
            dropout=self.dropout,
        )
        self.action_encoder = _mlp(
            self.action_feature_dim,
            self.action_hidden_dims,
            self.action_embedding_dim,
            self.full_activation_fn,
            dropout=self.dropout,
        )
        self.action_scorer = _mlp(
            self.state_embedding_dim + self.action_embedding_dim,
            self.scorer_hidden_dims,
            1,
            self.full_activation_fn,
            dropout=self.dropout,
            final_activation=False,
        )
        self.value_net = _mlp(
            self.state_embedding_dim + self.action_embedding_dim,
            self.value_hidden_dims,
            1,
            self.full_activation_fn,
            dropout=self.dropout,
            final_activation=False,
        )

        if self.ortho_init:
            module_gains = {
                self.features_extractor: np.sqrt(2),
                self.state_encoder: np.sqrt(2),
                self.action_encoder: np.sqrt(2),
                self.action_scorer: 0.01,
                self.value_net: 1.0,
            }
            for module, gain in module_gains.items():
                module.apply(partial(self.init_weights, gain=gain))

        self.optimizer = self.optimizer_class(
            self.parameters(),
            lr=lr_schedule(1),
            **self.optimizer_kwargs,
        )

    def _split_flat_obs(self, obs: th.Tensor) -> tuple[th.Tensor, th.Tensor]:
        obs = obs.float()
        state = obs[:, : self.state_dim]
        action_features = obs[:, self.state_dim :].reshape(
            obs.shape[0],
            ACTION_SPACE_SIZE,
            self.action_feature_dim,
        )
        return state, action_features

    def _encode(self, obs: PyTorchObs) -> tuple[th.Tensor, th.Tensor, th.Tensor]:
        features = super().extract_features(obs, self.features_extractor)
        state, action_features = self._split_flat_obs(features)
        state_embedding = self.state_encoder(state)
        action_embedding = self.action_encoder(action_features)
        legal = action_features[..., :1].clamp(0.0, 1.0)
        action_context = (action_embedding * legal).sum(dim=1) / legal.sum(dim=1).clamp_min(1.0)
        return state_embedding, action_embedding, action_context

    def _action_logits(self, state_embedding: th.Tensor, action_embedding: th.Tensor) -> th.Tensor:
        logits: list[th.Tensor] = []
        for start in range(0, ACTION_SPACE_SIZE, self.action_chunk_size):
            end = min(ACTION_SPACE_SIZE, start + self.action_chunk_size)
            repeated_state = state_embedding.unsqueeze(1).expand(-1, end - start, -1)
            scorer_input = th.cat([repeated_state, action_embedding[:, start:end, :]], dim=-1)
            logits.append(self.action_scorer(scorer_input).squeeze(-1))
        return th.cat(logits, dim=1)

    def _values(self, state_embedding: th.Tensor, action_context: th.Tensor) -> th.Tensor:
        return self.value_net(th.cat([state_embedding, action_context], dim=-1))

    def _get_dist_and_value(self, obs: PyTorchObs) -> tuple[MaskableDistribution, th.Tensor]:
        state_embedding, action_embedding, action_context = self._encode(obs)
        logits = self._action_logits(state_embedding, action_embedding)
        distribution = self.action_dist.proba_distribution(action_logits=logits)
        values = self._values(state_embedding, action_context)
        return distribution, values

    def forward(
        self,
        obs: th.Tensor,
        deterministic: bool = False,
        action_masks: np.ndarray | None = None,
    ) -> tuple[th.Tensor, th.Tensor, th.Tensor]:
        distribution, values = self._get_dist_and_value(obs)
        if action_masks is not None:
            distribution.apply_masking(action_masks)
        actions = distribution.get_actions(deterministic=deterministic)
        log_prob = distribution.log_prob(actions)
        actions = actions.reshape((-1, *self.action_space.shape))  # type: ignore[misc]
        return actions, values, log_prob

    def get_distribution(self, obs: PyTorchObs, action_masks: np.ndarray | None = None) -> MaskableDistribution:
        distribution, _ = self._get_dist_and_value(obs)
        if action_masks is not None:
            distribution.apply_masking(action_masks)
        return distribution

    def evaluate_actions(
        self,
        obs: th.Tensor,
        actions: th.Tensor,
        action_masks: th.Tensor | None = None,
    ) -> tuple[th.Tensor, th.Tensor, th.Tensor | None]:
        distribution, values = self._get_dist_and_value(obs)
        if action_masks is not None:
            distribution.apply_masking(action_masks)
        log_prob = distribution.log_prob(actions)
        return values, log_prob, distribution.entropy()

    def predict_values(self, obs: PyTorchObs) -> th.Tensor:
        _, values = self._get_dist_and_value(obs)
        return values

    def _predict(
        self,
        observation: PyTorchObs,
        deterministic: bool = False,
        action_masks: np.ndarray | None = None,
    ) -> th.Tensor:
        return self.get_distribution(observation, action_masks=action_masks).get_actions(deterministic=deterministic)
