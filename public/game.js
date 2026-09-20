// Client-side Game Engine & Multiplayer Controller
(function () {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // DOM Elements
  const hud = document.getElementById('hud');
  const hudRoomCode = document.getElementById('hudRoomCode');
  const liveScore = document.getElementById('liveScore');
  const copyRoomBtn = document.getElementById('copyRoomBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const leaderboardOverlay = document.getElementById('leaderboardOverlay');
  const leaderboardList = document.getElementById('leaderboardList');

  const lobbyScreen = document.getElementById('lobbyScreen');
  const playerNameInput = document.getElementById('playerName');
  const skinPicker = document.getElementById('skinPicker');
  const quickPlayBtn = document.getElementById('quickPlayBtn');
  const customRoomInput = document.getElementById('customRoomInput');
  const joinCustomBtn = document.getElementById('joinCustomBtn');

  const readyScreen = document.getElementById('readyScreen');
  const readyRoomCode = document.getElementById('readyRoomCode');
  const lobbyPlayersList = document.getElementById('lobbyPlayersList');
  const readyToggleBtn = document.getElementById('readyToggleBtn');
  const shareUrlInput = document.getElementById('shareUrlInput');
  const shareCopyBtn = document.getElementById('shareCopyBtn');

  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownText = document.getElementById('countdownText');

  const gameOverScreen = document.getElementById('gameOverScreen');
  const winnerAnnouncement = document.getElementById('winnerAnnouncement');
  const winnerText = document.getElementById('winnerText');
  const finalScoreVal = document.getElementById('finalScoreVal');
  const highScoreVal = document.getElementById('highScoreVal');
  const finalRanksList = document.getElementById('finalRanksList');
  const rematchBtn = document.getElementById('rematchBtn');
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');

  // Web Audio Synthesizer (Zero external assets needed)
  class SoundFX {
    constructor() {
      this.enabled = true;
      this.ctx = null;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playFlap() {
      if (!this.enabled) return;
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(540, this.ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.12);
    }

    playScore() {
      if (!this.enabled) return;
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(580, this.ctx.currentTime);
      osc.frequency.setValueAtTime(880, this.ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.25);
    }

    playHit() {
      if (!this.enabled) return;
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);
    }

    playCountdownTick(isGo = false) {
      if (!this.enabled) return;
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = isGo ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(isGo ? 880 : 440, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + (isGo ? 0.35 : 0.15));
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + (isGo ? 0.35 : 0.15));
    }
  }

  const sfx = new SoundFX();

  // Socket Connection
  const socket = io({
    transports: ['websocket', 'polling'],
    upgrade: true
  });

  // Game Constants & Variables
  const GRAVITY = 0.14;
  const FLAP_FORCE = -3.8;
  const MAX_FALL_SPEED = 5.2;
  const PIPE_WIDTH = 64;
  const BIRD_RADIUS = 16;
  const GROUND_HEIGHT = 80;

  let myId = null;
  let currentRoom = null;
  let selectedColor = '#f9ca24';
  let myBird = {
    x: 100,
    y: canvas.height / 2,
    velocity: 0,
    angle: 0,
    score: 0,
    alive: true,
    color: selectedColor
  };

  let opponents = {}; // { [id]: { id, name, skinColor, y, velocity, angle, score, alive, targetY } }
  let pipes = [];
  let particles = [];
  let isReady = false;
  let gameRunning = false;
  let backgroundScroll = 0;
  let groundScroll = 0;
  let highScore = parseInt(localStorage.getItem('flappy_highscore') || '0', 10);

  // Initialize skins
  skinPicker.querySelectorAll('.color-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      skinPicker.querySelectorAll('.color-dot').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedColor = btn.dataset.color;
      myBird.color = selectedColor;
    });
  });

  // Sound toggle
  soundToggleBtn.addEventListener('click', () => {
    sfx.enabled = !sfx.enabled;
    soundToggleBtn.textContent = sfx.enabled ? '🔊' : '🔇';
  });

  // Check URL params for room code invite link
  const urlParams = new URLSearchParams(window.location.search);
  const inviteRoom = urlParams.get('room');
  if (inviteRoom) {
    customRoomInput.value = inviteRoom.toUpperCase();
  }

  // Join Room
  function joinGame(targetRoomId) {
    sfx.init();
    const name = playerNameInput.value.trim() || 'Pilot';
    socket.emit('join_game', {
      roomId: targetRoomId,
      playerName: name,
      skinColor: selectedColor
    });
  }

  quickPlayBtn.addEventListener('click', () => joinGame(null));
  joinCustomBtn.addEventListener('click', () => {
    const code = customRoomInput.value.trim();
    joinGame(code || null);
  });

  // Ready Button
  readyToggleBtn.addEventListener('click', () => {
    sfx.init();
    isReady = true;
    readyToggleBtn.textContent = 'READY! (WAITING...)';
    readyToggleBtn.classList.remove('btn-primary');
    readyToggleBtn.classList.add('btn-secondary');
    readyToggleBtn.disabled = true;
    socket.emit('player_ready');
  });

  // Share Copy
  function copyShareLink() {
    if (!currentRoom) return;
    const shareUrl = `${window.location.origin}?room=${currentRoom}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      shareCopyBtn.textContent = 'COPIED!';
      setTimeout(() => shareCopyBtn.textContent = 'COPY', 2000);
    });
  }
  shareCopyBtn.addEventListener('click', copyShareLink);
  copyRoomBtn.addEventListener('click', () => {
    if (!currentRoom) return;
    const shareUrl = `${window.location.origin}?room=${currentRoom}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      copyRoomBtn.textContent = '✓';
      setTimeout(() => copyRoomBtn.textContent = '📋', 1500);
    });
  });

  // Rematch / Leave
  rematchBtn.addEventListener('click', () => {
    socket.emit('restart_request');
  });

  leaveRoomBtn.addEventListener('click', () => {
    window.location.reload();
  });

  // Network Handlers
  socket.on('joined_room', (data) => {
    myId = data.playerId;
    currentRoom = data.roomId;
    hudRoomCode.textContent = currentRoom;
    readyRoomCode.textContent = currentRoom;
    shareUrlInput.value = `${window.location.origin}?room=${currentRoom}`;

    lobbyScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');

    if (data.state === 'playing') {
      // Spectate or jump in
      readyScreen.classList.add('hidden');
      hud.classList.remove('hidden');
      leaderboardOverlay.classList.remove('hidden');
      gameRunning = true;
    } else {
      readyScreen.classList.remove('hidden');
      updateLobbyPlayerList(data.players);
    }
  });

  socket.on('room_state', (data) => {
    if (data.state === 'waiting') {
      updateLobbyPlayerList(data.players);
    }
    updateOpponentsList(data.players);
    updateLiveLeaderboard();
  });

  let countdownInterval = null;

  socket.on('start_countdown', (data) => {
    readyScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    leaderboardOverlay.classList.remove('hidden');

    // Position local player ready
    myBird.y = canvas.height / 2;
    myBird.velocity = 0;
    myBird.angle = 0;
    myBird.score = 0;
    myBird.alive = true;
    liveScore.textContent = '0';
    pipes = [];
    particles = [];
    gameRunning = false; // pause flaps until countdown finishes

    updateOpponentsList(data.players);
    updateLiveLeaderboard();

    // Show 3-second countdown
    countdownOverlay.classList.remove('hidden');
    let count = data.seconds || 3;
    countdownText.textContent = count;
    countdownText.style.color = '#f9ca24';
    sfx.playCountdownTick(false);

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      count--;
      if (count > 0) {
        countdownText.textContent = count;
        countdownText.style.color = count === 1 ? '#ff4757' : '#f9ca24';
        sfx.playCountdownTick(false);
      } else if (count === 0) {
        countdownText.textContent = 'GO!';
        countdownText.style.color = '#2ed573';
        sfx.playCountdownTick(true);
      } else {
        clearInterval(countdownInterval);
        countdownInterval = null;
        countdownOverlay.classList.add('hidden');
      }
    }, 1000);
  });

  socket.on('game_started', (data) => {
    readyScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    leaderboardOverlay.classList.remove('hidden');

    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    countdownOverlay.classList.add('hidden');

    // Reset local player
    myBird.y = canvas.height / 2;
    myBird.velocity = 0;
    myBird.angle = 0;
    myBird.score = 0;
    myBird.alive = true;
    liveScore.textContent = '0';
    pipes = [];
    particles = [];
    gameRunning = true;

    updateOpponentsList(data.players);
    updateLiveLeaderboard();
  });

  socket.on('pipe_spawn', (pipe) => {
    pipes.push(pipe);
  });

  socket.on('opponent_update', (data) => {
    if (opponents[data.id]) {
      opponents[data.id].targetY = data.y;
      opponents[data.id].velocity = data.velocity;
      opponents[data.id].angle = data.angle;
      opponents[data.id].score = data.score;
    }
    updateLiveLeaderboard();
  });

  socket.on('opponent_flap', (data) => {
    if (opponents[data.id]) {
      spawnFeathers(opponents[data.id].x || 100, opponents[data.id].y, opponents[data.id].skinColor);
    }
  });

  socket.on('player_eliminated', (data) => {
    if (opponents[data.id]) {
      opponents[data.id].alive = false;
      opponents[data.id].score = data.score;
      spawnExplosion(opponents[data.id].x || 100, opponents[data.id].y, opponents[data.id].skinColor);
    }
    updateLiveLeaderboard();
  });

  socket.on('game_over', (data) => {
    gameRunning = false;
    setTimeout(() => {
      showGameOver(data);
    }, 600);
  });

  socket.on('room_reset', (data) => {
    gameOverScreen.classList.add('hidden');
    readyScreen.classList.remove('hidden');
    hud.classList.add('hidden');
    leaderboardOverlay.classList.add('hidden');
    isReady = false;
    readyToggleBtn.textContent = 'READY UP! 🚀';
    readyToggleBtn.classList.add('btn-primary');
    readyToggleBtn.classList.remove('btn-secondary');
    readyToggleBtn.disabled = false;
    updateLobbyPlayerList(data.players);
  });

  function updateLobbyPlayerList(players) {
    lobbyPlayersList.innerHTML = '';
    const pids = Object.keys(players || {});
    const countBadge = document.getElementById('playerCountBadge');
    if (countBadge) {
      countBadge.textContent = pids.length;
    }

    for (const pid of pids) {
      const p = players[pid];
      const li = document.createElement('li');
      const isMe = pid === myId;
      if (isMe) li.classList.add('is-you');

      li.innerHTML = `
        <div class="pilot-info">
          <div class="pilot-avatar" style="--bird-color: ${p.skinColor || '#f9ca24'};">
            <span class="avatar-wing"></span>
          </div>
          <div class="pilot-meta">
            <span class="pilot-name">${p.name || 'Pilot'}</span>
            ${isMe ? '<span class="you-pill">YOU</span>' : ''}
          </div>
        </div>
        <span class="tag-status ${p.ready ? 'tag-ready' : 'tag-waiting'}">
          ${p.ready ? '✓ READY' : '⏳ WAITING'}
        </span>
      `;
      lobbyPlayersList.appendChild(li);
    }
  }

  function updateOpponentsList(players) {
    for (const pid in players) {
      if (pid === myId) continue;
      const p = players[pid];
      if (!opponents[pid]) {
        opponents[pid] = {
          id: pid,
          name: p.name,
          skinColor: p.skinColor,
          x: 100,
          y: p.y || canvas.height / 2,
          targetY: p.y || canvas.height / 2,
          velocity: 0,
          angle: 0,
          score: p.score || 0,
          alive: p.alive
        };
      } else {
        opponents[pid].alive = p.alive;
        opponents[pid].score = p.score;
      }
    }
  }

  function updateLiveLeaderboard() {
    const list = [{
      name: playerNameInput.value.trim() || 'You',
      score: myBird.score,
      alive: myBird.alive,
      isMe: true
    }];

    for (const pid in opponents) {
      list.push({
        name: opponents[pid].name,
        score: opponents[pid].score,
        alive: opponents[pid].alive,
        isMe: false
      });
    }

    list.sort((a, b) => b.score - a.score);

    leaderboardList.innerHTML = '';
    list.forEach(p => {
      const li = document.createElement('li');
      if (p.isMe) li.classList.add('you');
      if (!p.alive) li.classList.add('eliminated');
      li.innerHTML = `
        <span>${p.name}</span>
        <strong>${p.score}</strong>
      `;
      leaderboardList.appendChild(li);
    });
  }

  function showGameOver(data) {
    gameOverScreen.classList.remove('hidden');
    winnerText.textContent = data.winner ? data.winner : 'NO WINNER';
    finalScoreVal.textContent = myBird.score;

    if (myBird.score > highScore) {
      highScore = myBird.score;
      localStorage.setItem('flappy_highscore', highScore);
    }
    highScoreVal.textContent = highScore;

    const rankList = Object.values(data.players || {}).sort((a, b) => b.score - a.score);
    finalRanksList.innerHTML = '';
    rankList.forEach((p, index) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>#${index + 1} ${p.name}</span>
        <span>${p.score} pts</span>
      `;
      finalRanksList.appendChild(li);
    });
  }

  // Input Handling: Jump / Flap
  function doFlap() {
    if (!gameRunning || !myBird.alive) return;
    myBird.velocity = FLAP_FORCE;
    sfx.playFlap();
    spawnFeathers(myBird.x, myBird.y, myBird.color);
    socket.emit('player_flap');
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      doFlap();
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    doFlap();
  });

  // Particles
  function spawnFeathers(x, y, color) {
    for (let i = 0; i < 6; i++) {
      particles.push({
        x: x - 10,
        y: y,
        vx: (Math.random() - 0.7) * 2.5,
        vy: (Math.random() - 0.5) * 2,
        size: Math.random() * 4 + 2,
        color: color,
        life: 1.0
      });
    }
  }

  function spawnExplosion(x, y, color) {
    for (let i = 0; i < 20; i++) {
      particles.push({
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        size: Math.random() * 5 + 2,
        color: color,
        life: 1.0
      });
    }
  }

  // Main Game Loop
  let lastTime = performance.now();

  function render(time) {
    requestAnimationFrame(render);
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    update(dt);
    draw();
  }
  requestAnimationFrame(render);

  function update(dt) {
    // Parallax background scroll
    backgroundScroll = (backgroundScroll + 0.5) % canvas.width;
    groundScroll = (groundScroll + 2.4) % 24;

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.035;
      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }

    if (!gameRunning) return;

    // Local Bird Physics
    if (myBird.alive) {
      myBird.velocity = Math.min(MAX_FALL_SPEED, myBird.velocity + GRAVITY);
      myBird.y += myBird.velocity;

      // Angle calculation
      myBird.angle = Math.min(Math.PI / 2.5, Math.max(-Math.PI / 6, (myBird.velocity / 8) * 0.85));

      // Ground Collision
      if (myBird.y + BIRD_RADIUS >= canvas.height - GROUND_HEIGHT) {
        myBird.y = canvas.height - GROUND_HEIGHT - BIRD_RADIUS;
        eliminatePlayer();
      }

      // Ceiling Collision
      if (myBird.y - BIRD_RADIUS <= 0) {
        myBird.y = BIRD_RADIUS;
        myBird.velocity = 0;
      }

      // Move pipes and check collisions
      for (const pipe of pipes) {
        const speed = pipe.speed || 2.0;
        pipe.x -= speed;

        // Scoring check
        if (!pipe.passed && pipe.x + PIPE_WIDTH < myBird.x) {
          pipe.passed = true;
          myBird.score++;
          liveScore.textContent = myBird.score;
          sfx.playScore();
          updateLiveLeaderboard();
        }

        // Pipe collision check
        if (
          myBird.x + BIRD_RADIUS > pipe.x &&
          myBird.x - BIRD_RADIUS < pipe.x + PIPE_WIDTH
        ) {
          if (
            myBird.y - BIRD_RADIUS < pipe.topHeight ||
            myBird.y + BIRD_RADIUS > pipe.bottomY
          ) {
            eliminatePlayer();
          }
        }
      }

      // Relay position to server with smart throttling (30Hz for snappy zero-delay sync)
      const nowTime = performance.now();
      if (!myBird.lastEmit || nowTime - myBird.lastEmit >= 33) {
        myBird.lastEmit = nowTime;
        socket.emit('player_update', {
          y: Math.round(myBird.y * 10) / 10,
          velocity: Math.round(myBird.velocity * 10) / 10,
          angle: Math.round(myBird.angle * 100) / 100,
          score: myBird.score
        });
      }
    }

    // Clean offscreen pipes
    pipes = pipes.filter(p => p.x > -PIPE_WIDTH - 20);

    // Opponent smooth, low-latency interpolation
    for (const pid in opponents) {
      const opp = opponents[pid];
      if (opp.targetY !== undefined) {
        opp.y += (opp.targetY - opp.y) * 0.45;
        opp.angle = Math.min(Math.PI / 2.5, Math.max(-Math.PI / 6, (opp.velocity / 10) * 0.9));
      }
    }
  }

  function eliminatePlayer() {
    if (!myBird.alive) return;
    myBird.alive = false;
    sfx.playHit();
    spawnExplosion(myBird.x, myBird.y, myBird.color);
    socket.emit('player_died', { score: myBird.score });
    updateLiveLeaderboard();
  }

  // Drawing
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawSky();
    drawClouds();
    drawCitySkyline();
    drawPipes();
    drawOpponents();
    if (myBird.alive || gameRunning) {
      drawBird(myBird.x, myBird.y, myBird.angle, myBird.color, true, playerNameInput.value.trim() || 'You');
    }
    drawGround();
    drawParticles();
  }

  function drawSky() {
    const skyGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGradient.addColorStop(0, '#3ba3d0');
    skyGradient.addColorStop(0.6, '#72c8d8');
    skyGradient.addColorStop(1, '#c5e8ef');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawClouds() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    const offset = backgroundScroll * 0.4;
    for (let i = 0; i < 3; i++) {
      const x = ((i * 200 - offset) % (canvas.width + 100)) - 50;
      ctx.beginPath();
      ctx.arc(x, 100, 30, 0, Math.PI * 2);
      ctx.arc(x + 35, 90, 40, 0, Math.PI * 2);
      ctx.arc(x + 70, 100, 30, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCitySkyline() {
    ctx.fillStyle = 'rgba(120, 185, 195, 0.4)';
    const offset = (backgroundScroll * 0.8) % 120;
    for (let x = -offset; x < canvas.width + 100; x += 60) {
      const h = 80 + ((x * 17) % 50);
      ctx.fillRect(x, canvas.height - GROUND_HEIGHT - h, 50, h);
    }
  }

  function drawPipes() {
    for (const pipe of pipes) {
      // Top Pipe
      const topGrad = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0);
      topGrad.addColorStop(0, '#53a027');
      topGrad.addColorStop(0.3, '#75c837');
      topGrad.addColorStop(0.8, '#53a027');
      topGrad.addColorStop(1, '#2f6711');

      ctx.fillStyle = topGrad;
      ctx.strokeStyle = '#1d4808';
      ctx.lineWidth = 2.5;

      // Upper pipe shaft
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);
      ctx.strokeRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);

      // Upper pipe lip
      ctx.fillRect(pipe.x - 4, pipe.topHeight - 22, PIPE_WIDTH + 8, 22);
      ctx.strokeRect(pipe.x - 4, pipe.topHeight - 22, PIPE_WIDTH + 8, 22);

      // Bottom Pipe shaft
      const bottomHeight = canvas.height - GROUND_HEIGHT - pipe.bottomY;
      ctx.fillRect(pipe.x, pipe.bottomY, PIPE_WIDTH, bottomHeight);
      ctx.strokeRect(pipe.x, pipe.bottomY, PIPE_WIDTH, bottomHeight);

      // Bottom pipe lip
      ctx.fillRect(pipe.x - 4, pipe.bottomY, PIPE_WIDTH + 8, 22);
      ctx.strokeRect(pipe.x - 4, pipe.bottomY, PIPE_WIDTH + 8, 22);
    }
  }

  function drawGround() {
    const groundY = canvas.height - GROUND_HEIGHT;

    // Grass Top Strip
    ctx.fillStyle = '#73bf2e';
    ctx.fillRect(0, groundY, canvas.width, 16);
    ctx.fillStyle = '#9ce659';
    ctx.fillRect(0, groundY, canvas.width, 4);

    // Dirt Base
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, groundY + 16, canvas.width, GROUND_HEIGHT - 16);

    // Diagonal grass teeth
    ctx.fillStyle = '#558022';
    for (let x = -groundScroll; x < canvas.width + 24; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 16);
      ctx.lineTo(x + 10, groundY + 16);
      ctx.lineTo(x + 5, groundY + 22);
      ctx.fill();
    }
  }

  function drawOpponents() {
    for (const pid in opponents) {
      const opp = opponents[pid];
      if (!opp.alive) continue;
      drawBird(opp.x || 100, opp.y, opp.angle || 0, opp.skinColor, false, opp.name);
    }
  }

  function drawBird(x, y, angle, color, isSelf, name) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Ghost transparency for other players so user has unobstructed vision
    if (!isSelf) {
      ctx.globalAlpha = 0.65;
    }

    // Bird Body
    ctx.fillStyle = color;
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Wing
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-5, 2, 8, 5, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Big Eye
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(7, -5, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Pupil
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(9, -5, 2, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = '#f39c12';
    ctx.beginPath();
    ctx.moveTo(11, -1);
    ctx.lineTo(21, 3);
    ctx.lineTo(11, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Name Tag Above Bird
    ctx.save();
    ctx.fillStyle = isSelf ? '#f9ca24' : 'rgba(255, 255, 255, 0.85)';
    ctx.font = 'bold 10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(name, x, y - 22);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
})();
