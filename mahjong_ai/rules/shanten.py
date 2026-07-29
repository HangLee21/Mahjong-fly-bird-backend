from __future__ import annotations

from functools import lru_cache

from mahjong_ai.env.actions import N_TILE_TYPES
from mahjong_ai.rules.flybird import HONORS, WILDCARD, counts, tile_suit


def best_shanten(tiles: list[int], open_melds: int = 0, wildcard_enabled: bool = True) -> int:
    """Return an approximate shanten for Flybird hands.

    Lower is better. `-1` means already complete. This intentionally stays
    lightweight because it is called many times by heuristic bots and reward
    shaping during training.
    """

    if not tiles:
        return 8
    standard = standard_shanten(tiles, open_melds=open_melds, wildcard_enabled=wildcard_enabled)
    seven = seven_pairs_shanten(tiles, wildcard_enabled=wildcard_enabled) if open_melds == 0 else 8
    return min(standard, seven)


def effective_tile_count(
    tiles: list[int],
    open_melds: int = 0,
    wildcard_enabled: bool = True,
    max_copies: int = 4,
) -> int:
    """Count tile types that improve the current best shanten."""

    base = best_shanten(tiles, open_melds=open_melds, wildcard_enabled=wildcard_enabled)
    c = counts(tiles)
    effective = 0
    for tile in range(N_TILE_TYPES):
        if c[tile] >= max_copies:
            continue
        trial = tiles + [tile]
        if best_shanten(trial, open_melds=open_melds, wildcard_enabled=wildcard_enabled) < base:
            effective += max(0, max_copies - c[tile])
    return effective


def fast_hand_value(tiles: list[int], open_melds: int = 0, wildcard_enabled: bool = True) -> tuple[int, int]:
    """Fast approximate (shanten, useful-shape score) for hot heuristic paths."""

    c = counts(tiles)
    wildcards = c[WILDCARD] if wildcard_enabled else 0
    if wildcard_enabled:
        c[WILDCARD] = 0
    melds = open_melds
    pairs = 0
    taatsu = 0

    # Greedily count natural triplets.
    for tile in range(N_TILE_TYPES):
        while c[tile] >= 3 and melds < 4:
            c[tile] -= 3
            melds += 1

    # Greedily count sequences.
    for start in (0, 9, 18):
        for offset in range(7):
            tile = start + offset
            while c[tile] and c[tile + 1] and c[tile + 2] and melds < 4:
                c[tile] -= 1
                c[tile + 1] -= 1
                c[tile + 2] -= 1
                melds += 1

    for tile in range(N_TILE_TYPES):
        if c[tile] >= 2:
            pairs += 1
            c[tile] -= 2

    for start in (0, 9, 18):
        for offset in range(8):
            tile = start + offset
            if c[tile] and c[tile + 1]:
                c[tile] -= 1
                c[tile + 1] -= 1
                taatsu += 1
        for offset in range(7):
            tile = start + offset
            if c[tile] and c[tile + 2]:
                c[tile] -= 1
                c[tile + 2] -= 1
                taatsu += 1

    pair_flag = 1 if pairs or wildcards >= 2 else 0
    total_melds = min(4, melds + wildcards)
    useful_taatsu = min(taatsu + max(0, wildcards - max(0, 4 - melds)), max(0, 4 - total_melds))
    shanten = 8 - 2 * total_melds - useful_taatsu - pair_flag
    shape_score = melds * 12 + pairs * 4 + taatsu * 3 + wildcards * 5
    return max(-1, shanten), shape_score


def standard_shanten(tiles: list[int], open_melds: int = 0, wildcard_enabled: bool = True) -> int:
    c = counts(tiles)
    wildcards = c[WILDCARD] if wildcard_enabled else 0
    if wildcard_enabled:
        c[WILDCARD] = 0
    natural = _standard_shanten_no_wild(tuple(c), open_melds)
    return max(-1, natural - wildcards)


def seven_pairs_shanten(tiles: list[int], wildcard_enabled: bool = True) -> int:
    c = counts(tiles)
    wildcards = c[WILDCARD] if wildcard_enabled else 0
    if wildcard_enabled:
        c[WILDCARD] = 0
    pairs = sum(1 for n in c if n >= 2)
    singles = sum(1 for n in c if n == 1)
    use_for_singles = min(wildcards, singles)
    pairs += use_for_singles
    wildcards -= use_for_singles
    pairs += wildcards // 2
    return max(-1, 6 - min(7, pairs))


@lru_cache(maxsize=200000)
def _standard_shanten_no_wild(cached_counts: tuple[int, ...], open_melds: int) -> int:
    best = 8
    c = list(cached_counts)

    def dfs(index: int, melds: int, taatsu: int, pair: int) -> None:
        nonlocal best
        while index < N_TILE_TYPES and c[index] == 0:
            index += 1
        if index >= N_TILE_TYPES:
            total_melds = min(4, melds + open_melds)
            max_taatsu = max(0, 4 - total_melds)
            useful_taatsu = min(taatsu, max_taatsu)
            shanten = 8 - 2 * total_melds - useful_taatsu - pair
            best = min(best, shanten)
            return

        # Skip this tile as isolated.
        c[index] -= 1
        dfs(index, melds, taatsu, pair)
        c[index] += 1

        # Triplet.
        if c[index] >= 3:
            c[index] -= 3
            dfs(index, melds + 1, taatsu, pair)
            c[index] += 3

        # Pair as head or taatsu.
        if c[index] >= 2:
            c[index] -= 2
            if pair == 0:
                dfs(index, melds, taatsu, 1)
            dfs(index, melds, taatsu + 1, pair)
            c[index] += 2

        # Sequence and incomplete sequences.
        if index not in HONORS:
            suit = tile_suit(index)
            if index + 2 < N_TILE_TYPES and tile_suit(index + 1) == suit and tile_suit(index + 2) == suit:
                if c[index + 1] > 0 and c[index + 2] > 0:
                    c[index] -= 1
                    c[index + 1] -= 1
                    c[index + 2] -= 1
                    dfs(index, melds + 1, taatsu, pair)
                    c[index] += 1
                    c[index + 1] += 1
                    c[index + 2] += 1
                if c[index + 1] > 0:
                    c[index] -= 1
                    c[index + 1] -= 1
                    dfs(index, melds, taatsu + 1, pair)
                    c[index] += 1
                    c[index + 1] += 1
                if c[index + 2] > 0:
                    c[index] -= 1
                    c[index + 2] -= 1
                    dfs(index, melds, taatsu + 1, pair)
                    c[index] += 1
                    c[index + 2] += 1

    dfs(0, 0, 0, 0)
    return max(-1, best)
