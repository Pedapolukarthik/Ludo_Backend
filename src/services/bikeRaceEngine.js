/**
 * Engine for Endless Runner Multiplayer Bike Racing
 */

function generateObstacles(trackLength) {
  const obstacles = [];
  let id = 1;
  // Place obstacles every 60 to 100 meters starting at 150m
  for (let distance = 150; distance < trackLength - 100; distance += Math.floor(Math.random() * 40) + 60) {
    // Pick 1 or 2 lanes to block, never block all 3!
    const numBlocked = Math.random() > 0.7 ? 2 : 1;
    const lanes = [0, 1, 2];
    // Shuffle lanes
    lanes.sort(() => Math.random() - 0.5);
    const blockedLanes = lanes.slice(0, numBlocked);

    blockedLanes.forEach(lane => {
      obstacles.push({
        id: `obs_${id++}`,
        distance,
        lane,
        type: Math.random() > 0.5 ? 'barricade' : 'rock' // barricades can be jumped over, rocks cannot (need lane change)
      });
    });
  }
  return obstacles;
}

function generateCoins(trackLength) {
  const coins = [];
  let id = 1;
  // Place coins in segments between obstacles
  for (let distance = 80; distance < trackLength - 50; distance += Math.floor(Math.random() * 20) + 20) {
    const lane = Math.floor(Math.random() * 3);
    coins.push({
      id: `coin_${id++}`,
      distance,
      lane,
      collected: false
    });
  }
  return coins;
}

function generateBoostPads(trackLength) {
  const pads = [];
  let id = 1;
  // Place speed boost pads every 200-300 meters
  for (let distance = 250; distance < trackLength - 200; distance += Math.floor(Math.random() * 100) + 200) {
    const lane = Math.floor(Math.random() * 3);
    pads.push({
      id: `pad_${id++}`,
      distance,
      lane
    });
  }
  return pads;
}

function initializeGame(room) {
  const trackLength = 5000; // 5 kilometers track
  const players = room.players.map(p => ({
    id: (p.user || p.id || '').toString(),
    name: p.name || 'Guest',
    avatar: p.avatar || '',
    color: p.color || 'Red',
    isBot: p.isBot || false,
    distance: 0.0,
    lane: 1, // Center lane
    speed: 15.0, // Base speed in m/s
    jumpProgress: 0.0, // 0.0 means on ground, > 0.0 is airtime
    boostDuration: 0.0, // active boost timer in seconds
    crashed: false,
    crashTimer: 0.0, // Stun duration when crashed
    coinsCollected: 0,
    finished: false,
    finishTime: null
  }));

  return {
    roomCode: room.code,
    status: 'playing',
    players,
    obstacles: generateObstacles(trackLength),
    coins: generateCoins(trackLength),
    boostPads: generateBoostPads(trackLength),
    trackLength,
    winner: null,
    history: [],
    startTime: Date.now()
  };
}

function updateGameState(gameState, deltaTime) {
  if (gameState.status !== 'playing') return gameState;

  let allPlayersFinished = true;

  gameState.players.forEach(p => {
    if (p.finished) return;

    allPlayersFinished = false;

    // Handle Crash Recovery Stun
    if (p.crashed) {
      p.crashTimer -= deltaTime;
      p.speed = 0;
      if (p.crashTimer <= 0) {
        p.crashed = false;
        p.speed = 15.0; // recover speed
      }
      return;
    }

    // Handle Speed Boost
    let currentMaxSpeed = 15.0;
    if (p.boostDuration > 0) {
      p.boostDuration -= deltaTime;
      currentMaxSpeed = 25.0; // Boost speed
    }

    // Handle Jump Progress
    if (p.jumpProgress > 0) {
      p.jumpProgress -= deltaTime * 1.5; // Jump lasts around 0.66 seconds
      if (p.jumpProgress < 0) p.jumpProgress = 0.0;
    }

    // Gradually accelerate to max speed
    if (p.speed < currentMaxSpeed) {
      p.speed += deltaTime * 5.0;
      if (p.speed > currentMaxSpeed) p.speed = currentMaxSpeed;
    } else if (p.speed > currentMaxSpeed) {
      p.speed -= deltaTime * 8.0;
      if (p.speed < currentMaxSpeed) p.speed = currentMaxSpeed;
    }

    // Move forward
    p.distance += p.speed * deltaTime;

    // Check Finish Line
    if (p.distance >= gameState.trackLength) {
      p.distance = gameState.trackLength;
      p.finished = true;
      p.speed = 0;
      p.finishTime = Date.now() - gameState.startTime;
      gameState.history.push(`${p.name} crossed the finish line!`);
    }

    // Bot AI Logic
    if (p.isBot && !p.crashed) {
      // Find upcoming obstacle in the same lane within 30 meters
      const upcomingObstacle = gameState.obstacles.find(obs => 
        obs.lane === p.lane && 
        obs.distance > p.distance && 
        obs.distance - p.distance < 30
      );

      if (upcomingObstacle) {
        if (upcomingObstacle.type === 'barricade' && p.jumpProgress === 0.0) {
          // AI Jumps over barricades
          p.jumpProgress = 1.0;
        } else {
          // AI changes lane for rocks or random choice
          const availableLanes = [0, 1, 2].filter(l => l !== p.lane);
          // Pick a lane that doesn't have an obstacle at the same distance
          const safeLane = availableLanes.find(l => 
            !gameState.obstacles.some(o => o.lane === l && Math.abs(o.distance - upcomingObstacle.distance) < 10)
          );
          if (safeLane !== undefined) {
            p.lane = safeLane;
          } else {
            p.lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
          }
        }
      }
    }

    // Collision Check (Obstacles)
    const hitObstacle = gameState.obstacles.find(obs => 
      obs.lane === p.lane && 
      Math.abs(obs.distance - p.distance) < 4.0
    );

    if (hitObstacle) {
      // Barricades can be jumped over, rocks cannot
      const canPass = (hitObstacle.type === 'barricade' && p.jumpProgress > 0.2);
      if (!canPass) {
        p.crashed = true;
        p.crashTimer = 2.0; // Stunned for 2 seconds
        p.speed = 0;
        p.boostDuration = 0.0;
        gameState.history.push(`${p.name} crashed into an obstacle!`);
      }
    }

    // Coin Collection Check
    gameState.coins.forEach(coin => {
      if (!coin.collected && coin.lane === p.lane && Math.abs(coin.distance - p.distance) < 5.0) {
        coin.collected = true;
        p.coinsCollected += 1;
      }
    });

    // Speed Boost Pad Check
    const hitPad = gameState.boostPads.find(pad => 
      pad.lane === p.lane && 
      Math.abs(pad.distance - p.distance) < 5.0
    );

    if (hitPad && p.jumpProgress === 0.0) {
      p.boostDuration = 3.0; // 3 seconds boost
    }
  });

  if (allPlayersFinished) {
    gameState.status = 'completed';
    // Rank players by finishTime or distance
    const sorted = [...gameState.players].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.distance - a.distance;
    });
    gameState.winner = sorted[0];
  }

  return gameState;
}

module.exports = {
  initializeGame,
  updateGameState
};
