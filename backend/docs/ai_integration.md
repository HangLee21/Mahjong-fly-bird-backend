# AI Integration

The backend calls:

```http
POST {AI_SERVICE_URL}/ai/act
```

Request fields include:

- `room_id`
- `game_id`
- `player_id`
- `model_version`
- `observation`
- `legal_actions`
- `observation_version`
- `action_version`
- `rule_version`

The backend always validates the returned `action` against `RuleEngine.getLegalActions`. If the model times out, errors, or returns an illegal action, the fallback policy is used:

1. prefer `WIN`
2. otherwise `PASS`
3. otherwise first legal action

The default timeout is controlled by `AI_REQUEST_TIMEOUT_MS`.
