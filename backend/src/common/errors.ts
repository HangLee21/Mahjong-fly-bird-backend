export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_NOT_JOINED'
  | 'GAME_NOT_FOUND'
  | 'GAME_ALREADY_STARTED'
  | 'GAME_NOT_STARTED'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_ACTION'
  | 'STATE_VERSION_CONFLICT'
  | 'AI_SERVICE_TIMEOUT'
  | 'AI_SERVICE_ERROR'
  | 'RULE_ENGINE_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: { code: error.code, message: error.message, details: error.details }
    };
  }

  return {
    statusCode: 500,
    body: { code: 'INTERNAL_ERROR', message: 'Internal server error.', details: {} }
  };
}
