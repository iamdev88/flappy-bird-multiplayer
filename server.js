const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Room management
// rooms: { [roomId]: { id, seed, pipes: [], players: {}, state: 'waiting' | 'playing' | 'ended', startTime } }
const rooms = {};

const PIPE_SPAWN_INTERVAL = 1400; // ms
const PIPE_SPEED = 2.4; // px per tick (at 60hz)
const PIPE_GAP = 130;
const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 640;

function generateSeed() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      seed: Math.floor(Math.random() * 1000000),
      players: {},
      pipes: [],
      pipeTimer: 0,
      pipeIndex: 0,
      state: 'waiting',
      winner: null
    };
  }
  return rooms[roomId];
}

function broadcastRoomUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('room_state', {
    roomId: room.id,
    players: room.players,
    state: room.state,
    winner: room.winner
  });
}

function spawnPipe(room) {
  const minHeight = 60;
  const maxHeight = CANVAS_HEIGHT - 120 - PIPE_GAP - minHeight;
  const topHeight = Math.floor(minHeight + Math.random() * (maxHeight - minHeight));
  
  const pipe = {
    id: room.pipeIndex++,
    x: CANVAS_WIDTH + 40,
    topHeight: topHeight,
    bottomY: topHeight + PIPE_GAP,
    passedBy: {}
  };
  room.pipes.push(pipe);
  io.to(room.id).emit('pipe_spawn', pipe);
}

// Server game tick for active rooms
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.state !== 'playing') continue;

    const now = Date.now();
    if (!room.lastPipeTime || now - room.lastPipeTime > PIPE_SPAWN_INTERVAL) {
      spawnPipe(room);
      room.lastPipeTime = now;
    }

    // Clean up old pipes
    room.pipes = room.pipes.filter(p => p.x > -100);
    for (const p of room.pipes) {
      p.x -= PIPE_SPEED;
    }
  }
}, 1000 / 60);

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join_game', ({ roomId, playerName, skinColor }) => {
    // If no room ID provided, assign quick match or generate new
    let targetRoomId = (roomId && roomId.trim().toUpperCase()) || null;
    
    if (!targetRoomId) {
      // Find a public room with < 8 players or create one
      const existing = Object.values(rooms).find(r => Object.keys(r.players).length < 8 && r.state !== 'ended');
      targetRoomId = existing ? existing.id : generateSeed();
    }

    // Leave previous room if any
    if (currentRoomId && rooms[currentRoomId]) {
      delete rooms[currentRoomId].players[socket.id];
      socket.leave(currentRoomId);
      broadcastRoomUpdate(currentRoomId);
    }

    currentRoomId = targetRoomId;
    socket.join(targetRoomId);

    const room = getOrCreateRoom(targetRoomId);

    room.players[socket.id] = {
      id: socket.id,
      name: playerName || `Bird#${socket.id.substring(0, 4)}`,
      skinColor: skinColor || '#f9ca24',
      y: CANVAS_HEIGHT / 2,
      velocity: 0,
      angle: 0,
      score: 0,
      alive: true,
      ready: false
    };

    socket.emit('joined_room', {
      roomId: room.id,
      playerId: socket.id,
      players: room.players,
      state: room.state,
      pipes: room.pipes
    });

    broadcastRoomUpdate(targetRoomId);
  });

  socket.on('player_ready', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (room.players[socket.id]) {
      room.players[socket.id].ready = true;
    }

    const playerList = Object.values(room.players);
    // Start if all players are ready, or start immediately if single player
    const allReady = playerList.length > 0 && playerList.every(p => p.ready);
    if (allReady) {
      room.state = 'playing';
      room.pipes = [];
      room.pipeIndex = 0;
      room.lastPipeTime = Date.now();
      room.winner = null;

      // Reset all players
      for (const pid in room.players) {
        room.players[pid].y = CANVAS_HEIGHT / 2;
        room.players[pid].velocity = 0;
        room.players[pid].angle = 0;
        room.players[pid].score = 0;
        room.players[pid].alive = true;
      }

      io.to(currentRoomId).emit('game_started', {
        state: room.state,
        players: room.players
      });
    } else {
      broadcastRoomUpdate(currentRoomId);
    }
  });

  socket.on('player_update', (data) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    const player = room.players[socket.id];
    if (!player) return;

    player.y = data.y;
    player.velocity = data.velocity;
    player.angle = data.angle;
    player.score = data.score;

    // Relay position to others in room
    socket.to(currentRoomId).emit('opponent_update', {
      id: socket.id,
      y: data.y,
      velocity: data.velocity,
      angle: data.angle,
      score: data.score
    });
  });

  socket.on('player_flap', () => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('opponent_flap', { id: socket.id });
  });

  socket.on('player_died', ({ score }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    const player = room.players[socket.id];
    if (!player) return;

    player.alive = false;
    player.score = score;

    io.to(currentRoomId).emit('player_eliminated', {
      id: socket.id,
      name: player.name,
      score: score
    });

    // Check if game over (all players dead)
    const alivePlayers = Object.values(room.players).filter(p => p.alive);
    if (alivePlayers.length === 0) {
      room.state = 'ended';
      // Find top scorer
      const topPlayer = Object.values(room.players).sort((a, b) => b.score - a.score)[0];
      room.winner = topPlayer ? topPlayer.name : null;

      io.to(currentRoomId).emit('game_over', {
        winner: room.winner,
        players: room.players
      });
    }
  });

  socket.on('restart_request', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    
    // Reset player ready states
    for (const pid in room.players) {
      room.players[pid].ready = false;
      room.players[pid].alive = true;
      room.players[pid].score = 0;
      room.players[pid].y = CANVAS_HEIGHT / 2;
    }
    room.state = 'waiting';
    room.pipes = [];
    room.winner = null;

    io.to(currentRoomId).emit('room_reset', {
      players: room.players
    });
  });

  socket.on('disconnect', () => {
    if (currentRoomId && rooms[currentRoomId]) {
      const room = rooms[currentRoomId];
      const name = room.players[socket.id]?.name;
      delete room.players[socket.id];

      io.to(currentRoomId).emit('player_left', { id: socket.id, name });

      if (Object.keys(room.players).length === 0) {
        delete rooms[currentRoomId];
      } else {
        broadcastRoomUpdate(currentRoomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Flappy Bird Multiplayer server running at http://localhost:${PORT}`);
});
