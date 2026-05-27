# Rule Engine

The rule engine is a pure TypeScript boundary:

- no database access
- no Redis access
- no WebSocket access
- no AI calls

Input is `GameState + GameAction`; output is `RuleResult`.

The current `MockRuleEngine` supports:

- fixed four-player games
- seeded wall shuffle
- initial deal
- legal discard generation for the current player
- `DISCARD` and `PASS`
- wall exhaustion terminal state
- deterministic state hash

Replace `MockRuleEngine` with a production custom Mahjong implementation by preserving the `RuleEngine` interface.
