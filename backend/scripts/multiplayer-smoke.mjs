import assert from 'node:assert/strict';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const roomCode = String(Date.now()).slice(-6);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(method, path, token, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const error = new Error(`${method} ${path} -> ${response.status}: ${text}`);
    error.status = response.status;
    error.body = payload;
    throw error;
  }
  return payload;
}

function unwrapRoom(payload) {
  return payload && typeof payload === 'object' && 'room' in payload ? payload.room : payload;
}

async function expectStatus(promise, status) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.status, status, `expected status ${status}, got ${error.status}: ${error.message}`);
    return;
  }
  throw new Error(`expected request to fail with status ${status}, but it succeeded`);
}

function pickAction(legalActions) {
  if (legalActions.length === 0) return null;
  const hasNonPass = legalActions.some((action) => action.type !== 'PASS');
  const pass = legalActions.find((action) => action.type === 'PASS');
  if (hasNonPass && pass) return pass;
  const discard = legalActions.find((action) => action.type === 'DISCARD' && action.tile !== undefined);
  return discard || legalActions[0];
}

function humanSeat(room, userId) {
  return room.seats.find((seat) => seat.user?.id === userId && !seat.isAI);
}

function emptySeats(room) {
  return room.seats.filter((seat) => seat.status === 'EMPTY' || !seat.occupied).map((seat) => seat.seatIndex);
}

async function main() {
  console.log(`[multiplayer-smoke] base=${BASE_URL} room=${roomCode}`);

  const playerA = await api('POST', '/api/auth/wechat-login', null, {
    code: `smoke-a-${roomCode}`,
    nickname: 'SmokeA',
    avatarUrl: ''
  });
  const playerB = await api('POST', '/api/auth/wechat-login', null, {
    code: `smoke-b-${roomCode}`,
    nickname: 'SmokeB',
    avatarUrl: ''
  });
  assert.ok(playerA.token, 'player A token missing');
  assert.ok(playerB.token, 'player B token missing');

  const created = await api('POST', '/api/rooms', playerA.token, { roomId: roomCode, rules: {} });
  let room = unwrapRoom(created);
  assert.equal(room.roomId, roomCode);
  assert.equal(room.ownerId, playerA.user.id);

  room = unwrapRoom(await api('POST', `/api/rooms/${roomCode}/join`, playerB.token, {}));
  const bSeat = humanSeat(room, playerB.user.id);
  assert.ok(bSeat, 'player B should occupy a human seat');
  assert.equal(room.seats.filter((seat) => seat.status !== 'EMPTY' && !seat.isAI).length, 2);

  // Permission checks before the game starts.
  await expectStatus(
    api('POST', `/api/rooms/${roomCode}/add-ai`, playerB.token, {}),
    403
  );
  await expectStatus(
    api('POST', `/api/rooms/${roomCode}/start`, playerB.token, {}),
    403
  );

  // Transfer ownership from A to B, then back to A.
  room = unwrapRoom(
    await api('POST', `/api/rooms/${roomCode}/transfer-owner`, playerA.token, { seatIndex: bSeat.seatIndex })
  );
  assert.equal(room.ownerId, playerB.user.id);
  const aSeat = humanSeat(room, playerA.user.id);
  assert.ok(aSeat, 'player A should still be seated');
  room = unwrapRoom(
    await api('POST', `/api/rooms/${roomCode}/transfer-owner`, playerB.token, { seatIndex: aSeat.seatIndex })
  );
  assert.equal(room.ownerId, playerA.user.id);

  // Owner cannot kick themselves, but can kick player B.
  await expectStatus(
    api('POST', `/api/rooms/${roomCode}/kick`, playerA.token, { seatIndex: aSeat.seatIndex }),
    400
  );
  room = unwrapRoom(
    await api('POST', `/api/rooms/${roomCode}/kick`, playerA.token, { seatIndex: bSeat.seatIndex })
  );
  assert.equal(humanSeat(room, playerB.user.id), undefined);

  // Re-join and fill the remaining two seats with AI.
  room = unwrapRoom(await api('POST', `/api/rooms/${roomCode}/join`, playerB.token, {}));
  const newBSeat = humanSeat(room, playerB.user.id);
  assert.ok(newBSeat, 'player B should re-join successfully');
  const empties = emptySeats(room);
  assert.equal(empties.length, 2);
  for (const seatIndex of empties) {
    room = unwrapRoom(
      await api('POST', `/api/rooms/${roomCode}/add-ai`, playerA.token, { seatIndex })
    );
  }
  assert.equal(room.seats.filter((seat) => seat.status !== 'EMPTY').length, 4);

  // Not-ready state must block the start.
  await api('POST', `/api/rooms/${roomCode}/ready`, playerB.token, { ready: false });
  await expectStatus(api('POST', `/api/rooms/${roomCode}/start`, playerA.token, {}), 400);
  await api('POST', `/api/rooms/${roomCode}/ready`, playerB.token, { ready: true });

  const startView = await api('POST', `/api/rooms/${roomCode}/start`, playerA.token, {});
  const gameId = startView.gameId;
  assert.ok(gameId, 'start should return a game id');

  const viewB = await api('GET', `/api/games/${gameId}/view`, playerB.token);
  assert.equal(viewB.gameId, gameId);
  assert.equal(viewB.stepIndex, startView.stepIndex);
  assert.equal(viewB.currentPlayer, startView.currentPlayer);
  assert.equal(viewB.players.length, 4);
  assert.ok(Array.isArray(viewB.self.hand));
  for (const opponent of viewB.opponents) {
    assert.equal(opponent.hand, undefined, 'opponent hands must not be exposed');
    assert.equal(typeof opponent.handCount, 'number');
  }

  const tokenByUserId = new Map([
    [playerA.user.id, playerA.token],
    [playerB.user.id, playerB.token]
  ]);
  let lastStep = startView.stepIndex;
  let finished = false;

  for (let index = 0; index < 80; index += 1) {
    const viewA = await api('GET', `/api/games/${gameId}/view`, playerA.token);
    if (viewA.status === 'FINISHED' || viewA.status === 'DRAW') {
      finished = true;
      break;
    }

    const currentUserId = viewA.players.find((player) => player.seatIndex === viewA.currentPlayer)?.userId;
    if (!currentUserId || !tokenByUserId.has(currentUserId)) {
      await sleep(350);
      continue;
    }

    const view = currentUserId === playerA.user.id
      ? viewA
      : await api('GET', `/api/games/${gameId}/view`, playerB.token);
    const legalActions = view.legalActions || view.self.legalActions || [];
    const action = pickAction(legalActions);
    if (!action) {
      await sleep(250);
      continue;
    }

    const result = await api(
      'POST',
      `/api/games/${gameId}/actions`,
      tokenByUserId.get(currentUserId),
      { type: action.type, ...(action.tile === undefined ? {} : { tile: action.tile }) }
    );
    const nextView = result.view || view;
    lastStep = Math.max(lastStep, nextView.stepIndex || 0);
    await sleep(250);
  }

  assert.ok(finished || lastStep > startView.stepIndex, 'game should advance at least one step');
  console.log('[multiplayer-smoke] PASS');
  console.log(`  room=${roomCode}`);
  console.log(`  game=${gameId}`);
  console.log(`  finalStatus=${finished ? 'FINISHED_OR_DRAW' : 'IN_PROGRESS'}`);
  console.log(`  finalStep=${lastStep}`);
}

main().catch((error) => {
  console.error('[multiplayer-smoke] FAIL');
  console.error(error);
  process.exit(1);
});
