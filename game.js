(() => {
  'use strict';

  // Supabase configuration
  const SUPABASE_URL = 'https://lxguvmvmitblitbjuxvq.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_NX-HtPFGl875xjUueJUU5w_B6KJX5sH';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Bad words list (curated for family-friendly gaming)
  const BAD_WORDS = new Set([
    'ass', 'bad', 'bum', 'crap', 'damn', 'dick', 'dumb', 'fag', 'fart', 'fatty',
    'gay', 'hell', 'suck', 'tit', 'wank', 'whore', 'boob', 'bust', 'cunt', 'damn',
    'fuck', 'gag', 'gay', 'ginger', 'slut', 'twat', 'wimp', 'cock', 'piss', 'shit'
  ]);

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = canvas.width;
  const H = canvas.height;

  // HUD
  const elScore = document.getElementById('scorePts'); // boxes smashed
  const elScoreTotal = document.getElementById('scoreTotal'); // total score
  const elDist = document.getElementById('score');   // meters
  const elCoins = document.getElementById('coins');
  const elMult  = document.getElementById('mult');

  // Overlay
  const overlay = document.getElementById('overlay');
  const btnStart = document.getElementById('btnStart');
  const btnNext = document.getElementById('btnNext');
  const btnResume = document.getElementById('btnResume');
  const btnMute = document.getElementById('btnMute');
  const elSub = document.getElementById('sub');

  // Leaderboard modal elements
  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardInput = document.getElementById('leaderboardInput');
  const leaderboardScore = document.getElementById('leaderboardScore');
  const leaderboardError = document.getElementById('leaderboardError');
  const btnSubmitScore = document.getElementById('btnSubmitScore');
  const btnSkipScore = document.getElementById('btnSkipScore');

  // Leaderboard display
  const leaderboardDisplay = document.getElementById('leaderboardDisplay');
  const leaderboardList = document.getElementById('leaderboardList');

  let highScore = 0;  // Highest score achieved so far (session)

  const hasMultEl = !!elMult;

  // Utils
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a,b) => a + Math.random()*(b-a);
  const irnd = (a,b) => (a + Math.floor(Math.random()*(b-a+1)));
  const hit = (a,b) =>
    a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y;

  const btnPause = document.getElementById('btnPause');

  // Sound
  let audioCtx = null;
  let muted = false;
  function beep(freq=440, dur=0.05, type='square', gain=0.06){
    if (muted) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + dur);
  }
  function clicky(){ beep(520, 0.03, 'square', 0.05); }

  // Constants
  const GROUND_Y = H - 170;
  const GRAV = 2050;
  const JUMP_V = -820;
  const HOLD_BOOST = -820;
  const HOLD_TIME_MAX = 0.12;

  const PLAYER_W = 34;
  const PLAYER_H = 40;

  const COYOTE_TIME = 0.10;
  const JUMP_BUFFER = 0.10;
  const STOMP_BOUNCE_V = -640;

  // Level design (clear endings)
  // Each level ends at a fixed distance and spawns a finish banner you must reach.
  const BASE_LEVEL_DIST_M = 180;     // Level 1 length
  const LEVEL_DIST_STEP_M = 60;      // Each next level longer
  const FINISH_BANNER_W = 44;
  const FINISH_BANNER_H = 140;

  // Difficulty per level (not infinite panic)
  const BASE_SPEED = 210;
  const BASE_SPEED_MAX = 420;
  const SPEED_MAX_STEP = 20;         // max speed rises per level
  const SPEED_RAMP_PER_SEC = 6.5;    // gentle within a level

  // State
  let paused = false;
  let pauseArmed = false; // prevents the same tap from pausing + jumping

  let running = false;
  let gameOver = false;     // "dead" state
  let betweenLevels = true; // overlay shown; waiting

  let last = 0;
  let t = 0;

  // Run stats
  let totalDist = 0;     // total meters across the run
  let coins = 0;
  let boxesSmashed = 0;  // boxes smashed
  let streak = 0;
  let mult = 1.0;
  let runTime = 0;       // total time elapsed in run

  // Calculate total score from all metrics
  function calculateScore(){
    const coinPoints = coins * 100;
    const boxPoints = boxesSmashed * 50;
    const distPoints = Math.floor(totalDist * 2);
    return coinPoints + boxPoints + distPoints;
  }

  // Per-run state
  let speed = BASE_SPEED;
  let speedMax = BASE_SPEED_MAX;  // will scale over time

  // input
  let isDown = false;
  let holdTimer = 0;
  let coyoteTimer = 0;
  let jumpBufferTimer = 0;

  // shield system (cumulative, max 4)
  let shieldCount = 0;
  let invulnTimer = 0;

  const player = {
    x: 86,
    y: GROUND_Y - PLAYER_H,
    w: PLAYER_W,
    h: PLAYER_H,
    vy: 0,
    jumpsLeft: 2,
    anim: 0
  };

  const obstacles = [];
  const pickups = [];
  const clouds = [];
  const particles = [];

  function pxRect(x,y,w,h,fill,stroke=null){
    ctx.fillStyle = fill;
    ctx.fillRect(x|0, y|0, w|0, h|0);
    if (stroke){
      ctx.strokeStyle = stroke;
      ctx.strokeRect((x|0)+0.5, (y|0)+0.5, (w|0)-1, (h|0)-1);
    }
  }

  function withAlpha(hex, a){
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function spawnObstacle(){
    const kind = Math.random() < 0.22 ? 'tall' : 'crate';
    const w = kind === 'tall' ? irnd(32,42) : irnd(34,46);
    const h = kind === 'tall' ? irnd(64,84) : irnd(34,48);
    obstacles.push({ x: W + 30, y: GROUND_Y - h, w, h, kind });
  }

  function spawnCoin(){
    const y = rnd(GROUND_Y - 170, GROUND_Y - 90);
    pickups.push({ x: W + 30, y, w: 18, h: 18, kind: 'star', bob: rnd(0, Math.PI*2) });
  }

  function spawnShield(){
    const y = rnd(GROUND_Y - 200, GROUND_Y - 120);
    pickups.push({ x: W + 30, y, w: 18, h: 18, kind: 'shield', bob: rnd(0, Math.PI*2) });
  }

  function spawnCloud(){
    clouds.push({ x: W + rnd(0,200), y: rnd(40,240), w: rnd(36,86), h: rnd(16,34), s: rnd(0.20,0.55) });
  }

  function burst(x,y, n=10, col='#7af0b7'){
    for(let i=0;i<n;i++){
      particles.push({ x, y, vx: rnd(-220,220), vy: rnd(-280,80), life: rnd(0.25,0.55), tt: 0, col });
    }
  }

  function setOverlay(mode){
    // mode: 'start' | 'dead' | 'level'
    overlay.classList.remove('hidden');
    btnStart.classList.toggle('hidden', mode !== 'start' && mode !== 'dead');
    btnNext.classList.toggle('hidden', true);  // always hidden in continuous mode
  }

  function resetAll(){
    // full reset (new game)
    totalDist = 0;
    coins = 0;
    boxesSmashed = 0;
    streak = 0;
    mult = 1.0;
    runTime = 0;
    shieldCount = 0;
    invulnTimer = 0;
    startRun();
  }

  function startRun(){
    // Start a new continuous run
    running = false;
    gameOver = false;
    betweenLevels = true;
    last = 0;
    t = 0;

    // Clear entities
    obstacles.length = 0;
    pickups.length = 0;
    clouds.length = 0;
    particles.length = 0;

    // Player reset
    player.y = GROUND_Y - PLAYER_H;
    player.vy = 0;
    player.jumpsLeft = 2;
    player.anim = 0;

    // Run state
    speed = BASE_SPEED;
    runTime = 0;

    // timers
    coyoteTimer = 0;
    jumpBufferTimer = 0;

    // HUD
    if (elScore) elScore.textContent = String(boxesSmashed);
    if (elDist) elDist.textContent = '0';
    if (elCoins) elCoins.textContent = String(coins);
    if (hasMultEl) elMult.textContent = '1.0';

    // clouds
    for(let i=0;i<6;i++) spawnCloud();

    // overlay
    setOverlay('start');
    elSub.textContent = 'Tap to jump. Double-jump. Stomp crates. How far can you go?';
  }

  function beginRun(){
    overlay.classList.add('hidden');
    betweenLevels = false;
    running = true;
    clicky();
    requestAnimationFrame(loop);
  }

  // Leaderboard functions
  function validateName(name){
    const trimmed = name.trim().toUpperCase();
    const errors = [];

    if (trimmed.length < 3) errors.push('Name must be at least 3 characters.');
    if (trimmed.length > 5) errors.push('Name must be 5 characters or less.');
    if (!/^[A-Z]+$/.test(trimmed)) errors.push('Name must contain only letters.');

    // Check for bad words
    const words = trimmed.split(/\s+/);
    for (const word of words){
      if (BAD_WORDS.has(word)){
        errors.push(`"${word}" is not allowed. Please choose a different name.`);
        break;
      }
    }

    return { valid: errors.length === 0, errors, name: trimmed };
  }

  function showLeaderboardModal(score){
    leaderboardInput.value = '';
    leaderboardError.classList.add('hidden');
    leaderboardScore.textContent = score;
    leaderboardModal.classList.remove('hidden');
    leaderboardInput.focus();
  }

  function hideLeaderboardModal(){
    leaderboardModal.classList.add('hidden');
  }

  async function submitScore(name, score){
    try {
      await supabase.from('leaderboard').insert({
        name: name,
        score: score,
        boxes_smashed: boxesSmashed,
        coins_collected: coins,
        distance_meters: Math.floor(totalDist)
      });
      return { success: true };
    } catch (err){
      return { success: false, error: err.message };
    }
  }

  async function fetchHighScore(){
    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('score')
        .order('score', { ascending: false })
        .limit(1);

      if (error) throw error;
      return data && data.length > 0 ? data[0].score : 0;
    } catch (err){
      console.error('Error fetching high score:', err);
      return 0;
    }
  }

  async function fetchLeaderboard(){
    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('name, score')
        .order('score', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data || [];
    } catch (err){
      console.error('Error fetching leaderboard:', err);
      return [];
    }
  }

  function renderLeaderboard(scores){
    leaderboardList.innerHTML = '';
    if (scores.length === 0){
      leaderboardList.innerHTML = '<div style="text-align:center;color:rgba(238,241,255,.5);">No scores yet. Be first!</div>';
      return;
    }

    scores.forEach((entry, index) => {
      const entryEl = document.createElement('div');
      entryEl.className = 'leaderboard-entry';
      entryEl.innerHTML = `
        <span class="leaderboard-rank">#${index + 1}</span>
        <span class="leaderboard-name">${entry.name}</span>
        <span class="leaderboard-score">${entry.score}</span>
      `;
      leaderboardList.appendChild(entryEl);
    });
  }

  async function updateLeaderboard(){
    const scores = await fetchLeaderboard();
    renderLeaderboard(scores);
  }

  function die(reason){
    running = false;
    gameOver = true;
    betweenLevels = true;

    const finalScore = calculateScore();

    // Check if this is a high score
    if (finalScore > highScore){
      highScore = finalScore;
      setOverlay('dead');
      elSub.textContent = `${reason} You made it ${Math.floor(totalDist)}m.`;
      setTimeout(() => {
        showLeaderboardModal(finalScore);
      }, 500);
    } else {
      setOverlay('dead');
      elSub.textContent = `${reason} You made it ${Math.floor(totalDist)}m. Tap Start to try again.`;
    }

    beep(160, 0.12, 'sawtooth', 0.09);
  }

  // Input
  function tryJump(){
    if (!running) return;
    jumpBufferTimer = JUMP_BUFFER;

    if (player.jumpsLeft > 0){
      player.vy = JUMP_V;
      player.jumpsLeft--;
      holdTimer = 0;
      jumpBufferTimer = 0;
      beep(player.jumpsLeft === 1 ? 520 : 640, 0.05, 'square', 0.06);
    }
  }

  function onDown(){
    isDown = true;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});

    if (paused && !betweenLevels){
      // Resume from pause screen
      setPaused(false);
      return;
    }

    if (betweenLevels){
      // Tap to start works too (mobile-friendly)
      if (gameOver){
        // retry
        startRun();
        beginRun();
      } else {
        // start new run
        beginRun();
      }
      return;
    }

    tryJump();
  }

  function onUp(){
    isDown = false;
    holdTimer = HOLD_TIME_MAX;
  }

  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); }, { passive:false });
  canvas.addEventListener('pointerup',   (e) => { e.preventDefault(); onUp(); },   { passive:false });
  canvas.addEventListener('pointercancel',(e)=> { e.preventDefault(); onUp(); },  { passive:false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp'){ e.preventDefault(); onDown(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight'){
      e.preventDefault();
      if (running) setPaused(true);
      else if (paused) setPaused(false);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp'){ e.preventDefault(); onUp(); }
  });

  btnStart.addEventListener('click', () => {
    // Start or retry
    startRun();
    beginRun();
  });

  btnMute.addEventListener('click', () => {
    muted = !muted;
    btnMute.textContent = `Sound: ${muted ? 'Off' : 'On'}`;
    if (!muted) clicky();
  });

  btnPause.addEventListener('click', () => {
    if (running) setPaused(true);
  });

  btnResume.addEventListener('click', () => {
    setPaused(false);
  });

  btnSubmitScore.addEventListener('click', async () => {
    const validation = validateName(leaderboardInput.value);

    if (!validation.valid){
      leaderboardError.textContent = validation.errors.join(' ');
      leaderboardError.classList.remove('hidden');
      return;
    }

    btnSubmitScore.disabled = true;
    btnSubmitScore.textContent = 'Submitting...';

    const result = await submitScore(validation.name, calculateScore());

    if (result.success){
      beep(980, 0.08, 'square', 0.07);
      beep(1240, 0.08, 'square', 0.06);
      hideLeaderboardModal();
      elSub.textContent = `Welcome to the leaderboard, ${validation.name}!`;
      await updateLeaderboard();  // Refresh leaderboard display
    } else {
      leaderboardError.textContent = 'Failed to save score. Please try again.';
      leaderboardError.classList.remove('hidden');
    }

    btnSubmitScore.disabled = false;
    btnSubmitScore.textContent = 'Submit';
  });

  btnSkipScore.addEventListener('click', () => {
    hideLeaderboardModal();
  });

  function loop(ts){
    if (!running || paused) return;
    if (!last) last = ts;
    const dt = clamp((ts - last) / 1000, 0, 0.033);
    last = ts;
    t += dt;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function maybeSpawnFinish(){
    if (finishSpawned) return;
    // Spawn finish banner once you're close to the level goal so it scrolls in
    // (so it looks like a real end-of-level object)
    if (levelDist >= levelGoalM - 35){
      finishSpawned = true;
      finish = {
        x: W + 60,
        y: GROUND_Y - FINISH_BANNER_H,
        w: FINISH_BANNER_W,
        h: FINISH_BANNER_H
      };
    }
  }

  function update(dt){
    // continuous speed scaling based on time
    runTime += dt;
    speedMax = BASE_SPEED_MAX + (runTime * 20);  // speed increases over time
    speed = clamp(speed + dt * SPEED_RAMP_PER_SEC, 0, speedMax);

    // meters
    const mThisFrame = (speed * dt) / 18;
    totalDist += mThisFrame;

    if (elScore) elScore.textContent = String(boxesSmashed);
    if (elScoreTotal) elScoreTotal.textContent = String(calculateScore());
    if (elDist) elDist.textContent = String(Math.floor(totalDist));
    mult = clamp(1 + (streak * 0.05), 1, 3.0);
    if (hasMultEl) elMult.textContent = mult.toFixed(1);

    // timers
    if (coyoteTimer > 0) coyoteTimer = Math.max(0, coyoteTimer - dt);
    if (jumpBufferTimer > 0) jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);
    if (invulnTimer > 0) invulnTimer = Math.max(0, invulnTimer - dt);

    // Spawn enemies/coins continuously
    const preFinish = true;

      if (preFinish){
        // obstacle spawn rate increases slightly with time
        if (Math.random() < 0.018 + (runTime * 0.0003)){
          spawnObstacle();
        }
        if (Math.random() < 0.035){
          spawnCoin();
        }
        if (shieldCount < 4 && Math.random() < 0.0035){
          spawnShield();
        }
      }

    // Clouds
    if (clouds.length < 10 && Math.random() < 0.02) spawnCloud();
    for (let i=clouds.length-1;i>=0;i--){
      const c = clouds[i];
      c.x -= speed * c.s * dt * 0.35;
      if (c.x + c.w < -40) clouds.splice(i,1);
    }

    // Player physics
    player.anim += dt;

    if (isDown && player.vy < 0 && holdTimer < HOLD_TIME_MAX){
      holdTimer += dt;
      player.vy += HOLD_BOOST * dt;
    }

    player.vy += GRAV * dt;
    player.y += player.vy * dt;

    const groundTop = GROUND_Y - player.h;
    if (player.y >= groundTop){
      player.y = groundTop;
      player.vy = 0;
      player.jumpsLeft = 2;
      coyoteTimer = COYOTE_TIME;
    }

    // buffered jump consumption
    if (jumpBufferTimer > 0){
      const onGroundish = (coyoteTimer > 0 && player.jumpsLeft === 2);
      if (player.jumpsLeft > 0 || onGroundish){
        player.vy = JUMP_V;
        player.jumpsLeft--;
        holdTimer = 0;
        jumpBufferTimer = 0;
        beep(player.jumpsLeft === 1 ? 520 : 640, 0.05, 'square', 0.06);
      }
    }

    // Continuous run - no finish banners, game continues until player dies\n\n    // Obstacles
    for (let i=obstacles.length-1;i>=0;i--){
      const o = obstacles[i];
      o.x -= speed * dt;

      if (o.x + o.w < -80){
        obstacles.splice(i,1);
        continue;
      }

      // Stomp detection (forgiving)
      const wasFalling = player.vy > 0;
      const playerBottom = player.y + player.h;
      const nearTop = playerBottom >= o.y - 6 && playerBottom <= o.y + 18;
      const stompZone = { x: o.x - 6, y: o.y - 4, w: o.w + 12, h: 22 };

      if (wasFalling && nearTop && hit(player, stompZone)){
        boxesSmashed++;
        if (elScore) elScore.textContent = String(boxesSmashed);
        if (elScoreTotal) elScoreTotal.textContent = String(calculateScore());
        obstacles.splice(i,1);
        player.vy = STOMP_BOUNCE_V;
        player.jumpsLeft = Math.max(player.jumpsLeft, 1);
        burst(o.x + o.w/2, o.y + 10, 16, '#7af0b7');
        beep(740, 0.05, 'square', 0.06);
        continue;
      }

      // Fair hitbox
      const oh = { x:o.x+6, y:o.y+6, w:o.w-12, h:o.h-8 };

      if (hit(player, oh)){
        if (invulnTimer > 0) continue;

        if (shieldCount > 0){
          shieldCount--;
          invulnTimer = 0.7;
          obstacles.splice(i,1); // remove the crate that triggered the shield
          burst(player.x + player.w/2, player.y + player.h/2, 18, '#7af0b7');
          beep(260, 0.08, 'sawtooth', 0.07);
          player.vy = -520;
          player.x = Math.min(player.x + 10, 120);
          continue;
        }

        die('Ouch. Crate wins this round.');
        return;
      }
    }

    // Pickups
    for (let i=pickups.length-1;i>=0;i--){
      const p = pickups[i];
      p.x -= speed * dt;
      p.bob += dt * 6;

      if (p.x + p.w < -80){
        pickups.splice(i,1);
        streak = Math.max(0, streak - 1);
        continue;
      }

      const ph = { x:p.x+3, y:p.y+3, w:p.w-6, h:p.h-6 };
      if (hit(player, ph)){
        pickups.splice(i,1);

        if (p.kind === 'shield'){
          if (shieldCount < 4) {
            shieldCount++;
            burst(p.x + p.w/2, p.y + p.h/2, 16, '#7af0b7');
            beep(980, 0.06, 'square', 0.05);
          }
        } else {
          const gained = Math.round(1 * mult);
          coins += gained;
          streak++;
          if (elCoins) elCoins.textContent = String(coins);
          if (elScoreTotal) elScoreTotal.textContent = String(calculateScore());
          burst(p.x + p.w/2, p.y + p.h/2, 10, '#7af0b7');
          beep(820, 0.04, 'square', 0.05);
        }
      }
    }

    // Particles
    for (let i=particles.length-1;i>=0;i--){
      const pa = particles[i];
      pa.tt += dt;
      pa.x += pa.vx * dt;
      pa.y += pa.vy * dt;
      pa.vy += 900 * dt;
      if (pa.tt >= pa.life) particles.splice(i,1);
    }
  }

  function drawStar(x,y,w,h){
    const cx = (x + w/2) | 0;
    const cy = (y + h/2) | 0;
    pxRect(cx-2, cy-7, 4, 14, '#7af0b7');
    pxRect(cx-7, cy-2, 14, 4, '#7af0b7');
    pxRect(cx-5, cy-5, 10, 10, 'rgba(122,240,183,.45)');
  }

  function drawShield(x,y,w,h){
    const cx = (x + w/2) | 0;
    const cy = (y + h/2) | 0;
    pxRect(cx-6, cy-6, 12, 12, 'rgba(122,240,183,.25)', 'rgba(122,240,183,.75)');
    pxRect(cx-2, cy-4, 4, 8, 'rgba(122,240,183,.65)');
    pxRect(cx-4, cy-2, 8, 4, 'rgba(122,240,183,.65)');
  }

  function drawFinishBanner(f){
    // Pole
    pxRect(f.x + 4, f.y, 6, f.h, '#2f355f', '#454da7');
    // Flag
    pxRect(f.x + 10, f.y + 12, f.w - 14, 46, '#7af0b7', '#0b0d18');
    // Check pattern (pixel)
    for (let yy=0; yy<6; yy++){
      for (let xx=0; xx<6; xx++){
        if ((xx+yy)%2===0){
          pxRect(f.x + 12 + xx*4, f.y + 16 + yy*4, 4, 4, 'rgba(11,13,24,.45)');
        }
      }
    }
    // Base marker on ground
    pxRect(f.x, GROUND_Y - 6, f.w, 6, 'rgba(122,240,183,.25)');
  }

  function drawPlayer(p){
    const bob = Math.sin(p.anim * 18) * 1.2;
    const x = p.x|0;
    const y = (p.y + bob)|0;

    const body = '#eef1ff';
    const suit = '#7b82ff';

    pxRect(x+10, y+2, 14, 14, body, 'rgba(0,0,0,.25)');
    pxRect(x+14, y+6, 2, 2, '#0b0d18');
    pxRect(x+18, y+6, 2, 2, '#0b0d18');

    pxRect(x+8, y+16, 18, 16, suit, 'rgba(0,0,0,.25)');

    const legPhase = Math.floor(p.anim*12) % 2;
    if (p.vy !== 0){
      pxRect(x+10, y+32, 6, 8, '#2a2f66');
      pxRect(x+18, y+32, 6, 8, '#2a2f66');
    } else if (legPhase === 0){
      pxRect(x+9,  y+32, 6, 8, '#2a2f66');
      pxRect(x+19, y+34, 6, 6, '#2a2f66');
    } else {
      pxRect(x+9,  y+34, 6, 6, '#2a2f66');
      pxRect(x+19, y+32, 6, 8, '#2a2f66');
    }

    pxRect(x+5, y+18, 3, 10, '#7af0b7');
  }

  function setPaused(v){
  paused = v;

  if (paused){
    overlay.classList.remove('hidden');
    // show resume button, hide start/next while paused
    btnStart.classList.add('hidden');
    btnNext.classList.add('hidden');
    btnResume.classList.remove('hidden');
    elSub.textContent = `Paused • Level ${level}`;
    btnPause.textContent = 'Pause';
    beep(420, 0.05, 'square', 0.04);
  } else {
    overlay.classList.add('hidden');
    btnResume.classList.add('hidden');
    btnPause.textContent = 'Pause';
    beep(520, 0.03, 'square', 0.04);
    // restart loop timing cleanly
    last = 0;
    requestAnimationFrame(loop);
  }
}

  function render(){
    ctx.imageSmoothingEnabled = false;

    // Background
    ctx.fillStyle = '#0b0d18';
    ctx.fillRect(0,0,W,H);

    // Stars
    ctx.fillStyle = 'rgba(238,241,255,.22)';
    for (let i=0;i<40;i++){
      const x = (i*97 + (t*50)) % W;
      const y = (i*173) % (GROUND_Y-40);
      ctx.fillRect(x|0, y|0, 2, 2);
    }

    // Clouds
    for (const c of clouds){
      pxRect(c.x, c.y, c.w, c.h, 'rgba(238,241,255,.10)');
      pxRect(c.x+6, c.y-6, c.w*0.6, c.h*0.8, 'rgba(238,241,255,.07)');
    }

    // Skyline stripe
    const skylineY = GROUND_Y - 60;
    ctx.fillStyle = 'rgba(122,240,183,.10)';
    for (let i=0;i<14;i++){
      const x = ((i*64) - (t*speed*0.12)) % (W+64) - 64;
      const hh = 20 + (i%5)*10;
      ctx.fillRect(x|0, (skylineY-hh)|0, 44, hh);
    }

    // Ground
    pxRect(0, GROUND_Y, W, H-GROUND_Y, '#15183a');
    pxRect(0, GROUND_Y, W, 4, '#23285c');

    for (let i=0;i<40;i++){
      const x = ((i*26) - (t*speed*0.9)) % (W+26) - 26;
      pxRect(x, GROUND_Y+14, 16, 6, 'rgba(238,241,255,.06)');
    }

    // Pickups
    for (const p of pickups){
      const bob = Math.sin(p.bob) * 3;
      if (p.kind === 'shield') drawShield(p.x, p.y + bob, p.w, p.h);
      else drawStar(p.x, p.y + bob, p.w, p.h);
    }

    // Obstacles
    for (const o of obstacles){
      if (o.kind === 'tall'){
        pxRect(o.x, o.y, o.w, o.h, '#2a2f66', '#3b41a3');
        pxRect(o.x+6, o.y+8, o.w-12, 10, 'rgba(238,241,255,.08)');
      } else {
        pxRect(o.x, o.y, o.w, o.h, '#2f355f', '#454da7');
        ctx.strokeStyle = 'rgba(238,241,255,.18)';
        ctx.beginPath();
        ctx.moveTo((o.x+4)|0, (o.y+4)|0);
        ctx.lineTo((o.x+o.w-4)|0, (o.y+o.h-4)|0);
        ctx.moveTo((o.x+o.w-4)|0, (o.y+4)|0);
        ctx.lineTo((o.x+4)|0, (o.y+o.h-4)|0);
        ctx.stroke();
      }
    }

    // Player
    drawPlayer(player);

    // Shield count indicators
    if (shieldCount > 0){
      const shieldRadius = 26 + (shieldCount - 1) * 8;
      ctx.strokeStyle = 'rgba(122,240,183,.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((player.x + player.w/2)|0, (player.y + player.h/2)|0, shieldRadius, 0, Math.PI*2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(122,240,183,.25)';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(shieldCount), (player.x + player.w/2)|0, (player.y + player.h/2 + 4)|0);
      ctx.lineWidth = 1;
      ctx.textAlign = 'start';
    }

    // Invuln wash
    if (invulnTimer > 0){
      ctx.fillStyle = 'rgba(122,240,183,.10)';
      ctx.fillRect(0,0,W,H);
    }

    // Particles
    for (const pa of particles){
      const a = 1 - (pa.tt/pa.life);
      ctx.fillStyle = withAlpha(pa.col, a);
      ctx.fillRect(pa.x|0, pa.y|0, 3, 3);
    }

    // Hint
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    ctx.fillStyle = 'rgba(238,241,255,.35)';
    ctx.fillText(`Endless run • Distance: ${Math.floor(totalDist)}m • Time: ${(runTime).toFixed(1)}s`, 12, H - 16);
  }

  // Boot
  (async () => {
    highScore = await fetchHighScore();
    await updateLeaderboard();
    overlay.classList.remove('hidden');
    setOverlay('start');
    startRun();
    // initial render for start screen
    render();
  })();
})();