import { ReplayRepository } from './replay.repository.js';

export class ReplayService {
  constructor(private readonly replay = new ReplayRepository()) {}

  getReplay(gameId: string) {
    return this.replay.listGameSteps(gameId);
  }

  async exportJsonl(from: Date, to: Date) {
    const steps = await this.replay.exportSteps(from, to);
    return steps
      .map((step) =>
        JSON.stringify({
          game_id: step.gameId,
          step: step.stepIndex,
          observation: (step.privateViewJson as { observation?: unknown } | null)?.observation ?? null,
          legal_actions: step.legalActionsJson,
          action: step.actionJson,
          reward: step.rewardJson
        })
      )
      .join('\n');
  }
}
