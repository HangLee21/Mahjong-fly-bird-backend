import { mkdir, writeFile } from 'node:fs/promises';
import { MockRuleEngine } from '../src/rules/rule-engine.js';

const engine = new MockRuleEngine();
const state = engine.createInitialState({
  roomId: 'fixture_room',
  gameId: 'fixture_game',
  ruleVersion: 'rule_v1',
  seed: 'fixture_seed',
  players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: seatIndex !== 0 }))
});
const legalActions = engine.getLegalActions(state, 0);
const action = legalActions[0];
const result = engine.applyAction(state, 0, action);

await mkdir('fixtures/rule_cases', { recursive: true });
await writeFile(
  'fixtures/rule_cases/case_001.json',
  JSON.stringify(
    {
      state,
      playerIndex: 0,
      legalActions: legalActions.map((item) => item.actionId),
      action: action.actionId,
      nextStateHash: engine.hashState(result.nextState),
      score: result.scoreResult ?? null
    },
    null,
    2
  )
);
