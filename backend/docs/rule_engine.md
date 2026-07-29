# Rule Engine

The backend now uses `QujingFeiXiaoJiRuleEngine` as the active rule engine.

The rule engine remains a pure TypeScript boundary:

- no database access
- no Redis access
- no WebSocket access
- no AI calls

Input is `GameState + GameAction`; output is `RuleResult`.

## Implemented Playable Rules

The current production engine supports a complete playable hand:

- four-player game
- 136-tile wall
- seeded shuffle
- initial deal
- two public kong tiles
- normal draw/discard loop
- discard response window
- response priority: `WIN` > `KONG_EXPOSED` > `PONG` > `CHOW_*`
- self draw win
- discard win
- multi-win on the same discard
- chow from next player only
- pong from any player
- exposed kong from discard
- concealed kong
- added kong from pong meld
- automatic public-kong replacement draw after kong
- xiaoji tile as wildcard for win and kong
- xiaoji cannot be used as wildcard for chow or pong
- xiaoji discard disables future wildcard status marker
- wall threshold draw
- basic score settlement
- player-private views that hide other players' hands

## Tile Mapping

The backend uses numeric tile ids:

```text
0-8    wan 1-9
9-17   tong 1-9
18-26  tiao 1-9
27-33  honors east, south, west, north, zhong, fa, bai
```

`18` is `1-tiao`, the xiaoji tile.

## Action Types

```text
DISCARD
PASS
WIN
PONG
CHOW_LEFT
CHOW_MIDDLE
CHOW_RIGHT
KONG_EXPOSED
KONG_CONCEALED
KONG_ADDED
SELECT_KONG_TILE
```

`SELECT_KONG_TILE` is reserved for a future manual public-kong-tile selection flow. The current engine automatically takes the first visible public kong tile to keep the hand playable without extra UI.

## Known Extension Points

The following PDF rules are not yet fully modeled as strict referee logic:

- dice-based physical wall start position
- manual public kong tile choice
- robbing an added kong
- strict same-round furiten
- xiaoji refusal furiten
- reject-pong restriction
- four winds abort settlement
- bao-pai liability for big three dragons / big four winds
- cheating / false win penalties
- incorrect hand count correction
- multi-round dealer rotation and continued total score tables

The state and action boundaries are designed so these can be added without changing HTTP or WebSocket contracts.
