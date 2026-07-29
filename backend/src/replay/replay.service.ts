import { ReplayRepository } from './replay.repository.js';

export class ReplayService {
  constructor(private readonly replay = new ReplayRepository()) {}

  async listReplays(userId: string) {
    const games = await this.replay.listGames(userId);
    return games.map((game) => ({
      gameId: game.id,
      roomId: game.room.roomCode,
      title: `曲靖飞小鸡 ${game.room.roomCode}`
    }));
  }

  getReplay(gameId: string) {
    return this.replay.listGameSteps(gameId);
  }

  async getReplayRecord(gameId: string) {
    const game = await this.replay.findGame(gameId);
    const steps = await this.replay.listGameSteps(gameId);
    return {
      roomId: game?.room.roomCode ?? '',
      gameId,
      title: game ? `曲靖飞小鸡 ${game.room.roomCode}` : gameId,
      steps: steps.map((step) => ({
        stepIndex: step.stepIndex,
        view: step.publicViewJson,
        events: []
      }))
    };
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
          action_source: step.actionSource,
          ai_model: step.aiModel,
          reward: step.rewardJson
        })
      )
      .join('\n');
  }
}
