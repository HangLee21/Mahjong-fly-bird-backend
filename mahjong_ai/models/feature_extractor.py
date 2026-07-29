from __future__ import annotations

from typing import Any

import torch as th
from torch import nn

try:
    from stable_baselines3.common.torch_layers import BaseFeaturesExtractor
except Exception:  # pragma: no cover
    BaseFeaturesExtractor = object


class LayerNormMLPExtractor(BaseFeaturesExtractor):
    """A compact feature extractor for mixed Mahjong vector observations.

    The observation contains counts, one-hot fields and scalar round state. A
    few normalized dense layers usually train more smoothly than sending the raw
    vector directly into a policy/value MLP.
    """

    def __init__(
        self,
        observation_space: Any,
        features_dim: int = 512,
        hidden_dims: list[int] | tuple[int, ...] = (512, 512),
        dropout: float = 0.0,
    ):
        super().__init__(observation_space, features_dim)
        input_dim = int(observation_space.shape[0])
        layers: list[nn.Module] = []
        prev_dim = input_dim
        for hidden_dim in hidden_dims:
            layers.append(nn.Linear(prev_dim, int(hidden_dim)))
            layers.append(nn.LayerNorm(int(hidden_dim)))
            layers.append(nn.ReLU())
            if dropout > 0:
                layers.append(nn.Dropout(float(dropout)))
            prev_dim = int(hidden_dim)
        layers.append(nn.Linear(prev_dim, features_dim))
        layers.append(nn.LayerNorm(features_dim))
        layers.append(nn.ReLU())
        self.net = nn.Sequential(*layers)

    def forward(self, observations: th.Tensor) -> th.Tensor:
        return self.net(observations.float())


class HybridHistoryTransformerExtractor(BaseFeaturesExtractor):
    """Encode static Mahjong state plus ordered public action history."""

    def __init__(
        self,
        observation_space: Any,
        features_dim: int = 768,
        static_hidden_dims: list[int] | tuple[int, ...] = (512, 512),
        d_model: int = 128,
        nhead: int = 4,
        num_layers: int = 2,
        dropout: float = 0.05,
        max_history_len: int = 128,
    ):
        super().__init__(observation_space, features_dim)
        static_dim = int(observation_space.spaces["static"].shape[0])
        event_dim = int(observation_space.spaces["history"].shape[-1])
        history_len = int(observation_space.spaces["history"].shape[0])
        self.history_len = min(history_len, int(max_history_len))

        static_layers: list[nn.Module] = []
        prev_dim = static_dim
        for hidden_dim in static_hidden_dims:
            static_layers.append(nn.Linear(prev_dim, int(hidden_dim)))
            static_layers.append(nn.LayerNorm(int(hidden_dim)))
            static_layers.append(nn.GELU())
            if dropout > 0:
                static_layers.append(nn.Dropout(float(dropout)))
            prev_dim = int(hidden_dim)
        static_layers.append(nn.Linear(prev_dim, int(d_model)))
        static_layers.append(nn.LayerNorm(int(d_model)))
        static_layers.append(nn.GELU())
        self.static_net = nn.Sequential(*static_layers)

        self.event_proj = nn.Sequential(
            nn.Linear(event_dim, int(d_model)),
            nn.LayerNorm(int(d_model)),
            nn.GELU(),
        )
        self.pos_embedding = nn.Parameter(th.zeros(1, history_len, int(d_model)))
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=int(d_model),
            nhead=int(nhead),
            dim_feedforward=int(d_model) * 4,
            dropout=float(dropout),
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.history_encoder = nn.TransformerEncoder(encoder_layer, num_layers=int(num_layers))
        self.fusion = nn.Sequential(
            nn.Linear(int(d_model) * 2, features_dim),
            nn.LayerNorm(features_dim),
            nn.GELU(),
            nn.Dropout(float(dropout)) if dropout > 0 else nn.Identity(),
        )

    def forward(self, observations: dict[str, th.Tensor]) -> th.Tensor:
        static = self.static_net(observations["static"].float())
        history = observations["history"].float()
        mask = observations["history_mask"].float().unsqueeze(-1)
        encoded = self.event_proj(history) + self.pos_embedding[:, : history.shape[1], :]
        encoded = self.history_encoder(encoded)
        masked = encoded * mask
        denom = mask.sum(dim=1).clamp_min(1.0)
        history_features = masked.sum(dim=1) / denom
        return self.fusion(th.cat([static, history_features], dim=1))


class HybridHistoryTransformerV2Extractor(BaseFeaturesExtractor):
    """Encode static state and ordered public history with masked CLS attention.

    This variant is intended for longer overnight V3 runs. Compared with the
    first history extractor it gives the Transformer an explicit sequence
    summary token and prevents padded history rows from participating in
    attention.
    """

    def __init__(
        self,
        observation_space: Any,
        features_dim: int = 896,
        static_hidden_dims: list[int] | tuple[int, ...] = (768, 512),
        d_model: int = 192,
        nhead: int = 6,
        num_layers: int = 3,
        dropout: float = 0.04,
        max_history_len: int = 128,
    ):
        super().__init__(observation_space, features_dim)
        static_dim = int(observation_space.spaces["static"].shape[0])
        event_dim = int(observation_space.spaces["history"].shape[-1])
        history_len = int(observation_space.spaces["history"].shape[0])
        self.history_len = min(history_len, int(max_history_len))
        self.d_model = int(d_model)

        static_layers: list[nn.Module] = []
        prev_dim = static_dim
        for hidden_dim in static_hidden_dims:
            static_layers.append(nn.Linear(prev_dim, int(hidden_dim)))
            static_layers.append(nn.LayerNorm(int(hidden_dim)))
            static_layers.append(nn.GELU())
            if dropout > 0:
                static_layers.append(nn.Dropout(float(dropout)))
            prev_dim = int(hidden_dim)
        static_layers.append(nn.Linear(prev_dim, self.d_model))
        static_layers.append(nn.LayerNorm(self.d_model))
        static_layers.append(nn.GELU())
        self.static_net = nn.Sequential(*static_layers)

        self.event_proj = nn.Sequential(
            nn.Linear(event_dim, self.d_model),
            nn.LayerNorm(self.d_model),
            nn.GELU(),
        )
        self.cls_token = nn.Parameter(th.zeros(1, 1, self.d_model))
        self.pos_embedding = nn.Parameter(th.zeros(1, history_len + 1, self.d_model))
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=self.d_model,
            nhead=int(nhead),
            dim_feedforward=self.d_model * 4,
            dropout=float(dropout),
            activation="gelu",
            batch_first=True,
            norm_first=False,
        )
        self.history_encoder = nn.TransformerEncoder(encoder_layer, num_layers=int(num_layers))
        self.fusion = nn.Sequential(
            nn.Linear(self.d_model * 2, features_dim),
            nn.LayerNorm(features_dim),
            nn.GELU(),
            nn.Dropout(float(dropout)) if dropout > 0 else nn.Identity(),
        )

    def forward(self, observations: dict[str, th.Tensor]) -> th.Tensor:
        static = self.static_net(observations["static"].float())
        history = observations["history"].float()
        mask = observations["history_mask"].float()
        batch_size = history.shape[0]

        event_features = self.event_proj(history)
        cls = self.cls_token.expand(batch_size, -1, -1)
        tokens = th.cat([cls, event_features], dim=1)
        tokens = tokens + self.pos_embedding[:, : tokens.shape[1], :]

        cls_padding = th.zeros((batch_size, 1), dtype=th.bool, device=history.device)
        history_padding = mask <= 0.0
        padding_mask = th.cat([cls_padding, history_padding], dim=1)
        encoded = self.history_encoder(tokens, src_key_padding_mask=padding_mask)
        history_features = encoded[:, 0, :]
        return self.fusion(th.cat([static, history_features], dim=1))
