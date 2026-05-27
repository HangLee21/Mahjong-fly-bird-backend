# Database Schema

Prisma models:

- `User`
- `Room`
- `RoomSeat`
- `Game`
- `GamePlayer`
- `GameStep`
- `ModelVersion`

`GameStep` is the replay and training-data source. Each step stores:

- submitted action
- legal action mask
- player view / observation
- state hash before and after
- AI model and action source
- optional reward
