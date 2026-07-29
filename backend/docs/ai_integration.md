# AI Integration

The Node backend calls an external AI service:

```http
POST {AI_SERVICE_URL}/ai/act
```

Default local URL:

```env
AI_SERVICE_URL=http://localhost:8001
```

## Stable-Baselines3 Local Service

The repository includes a minimal SB3 inference service:

```text
ai_service/sb3_server.py
ai_service/requirements.txt
model/v3-lite.zip
```

Start it from the repository root:

```powershell
cd E:\Mahjong-fly-bird-backend
py -m venv .venv-ai
.\.venv-ai\Scripts\Activate.ps1
pip install -r ai_service\requirements.txt
$env:SB3_MODEL_PATH = "E:\Mahjong-fly-bird-backend\model\v3-lite.zip"
$env:SB3_ALGO = "PPO"
uvicorn ai_service.sb3_server:app --host 0.0.0.0 --port 8001
```

Health check:

```powershell
curl.exe http://localhost:8001/health
```

If your model was trained with another SB3 algorithm, set:

```powershell
$env:SB3_ALGO = "DQN"
```

Supported defaults in the helper script are `PPO`, `DQN`, and `A2C`.

## Backend Request

The backend sends:

```json
{
  "room_id": "room_id",
  "game_id": "game_id",
  "player_id": 1,
  "model_version": "v3-lite",
  "observation": [],
  "legal_actions": [0, 1, 2],
  "observation_version": "obs_v1",
  "action_version": "action_v1",
  "rule_version": "qujing-fei-xiaoji-v1.5"
}
```

## AI Response

The AI service returns:

```json
{
  "action": 0,
  "model_version": "v3-lite",
  "confidence": null
}
```

The backend validates the returned action against `RuleEngine.getLegalActions`. If the model times out, errors, or returns an illegal action, the fallback policy is used:

1. prefer `WIN`
2. otherwise `PASS`
3. otherwise first legal action

## add-ai Usage

To use the SB3 model for an AI seat:

```http
POST /api/rooms/{roomId}/add-ai
Authorization: Bearer <owner_token>
Content-Type: application/json
```

```json
{
  "seatIndex": 1,
  "model": "v3-lite"
}
```

The room seat stores `aiModel=v3-lite`; during AI turns the backend sends `model_version=v3-lite` to the AI service.

## Important Compatibility Note

`legal_actions` are integer action ids. The current backend mapping is:

```text
0-33  DISCARD tile id
100   PASS
101   WIN
102   PONG
103   CHOW_LEFT
104   CHOW_MIDDLE
105   CHOW_RIGHT
106   KONG_EXPOSED
107   KONG_CONCEALED
108   KONG_ADDED
109   SELECT_KONG_TILE
```

If the trained model uses a different action encoding, adapt `ai_service/sb3_server.py` to translate the model output into this backend action id space.
