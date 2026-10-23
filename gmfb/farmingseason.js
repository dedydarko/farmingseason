/*
 * Farming Season — v4
 * farmingseason.io · MV3 content script · world: MAIN · run_at: document_start
 *
 * Features:
 *   - Auto-Plant (Bulk 'Plant all' or 1-by-1, selectable seed across all 20 crops)
 *   - Auto-Harvest (Bulk 'Harvest all' or 1-by-1, animal collection, orchard harvest)
 *   - Continuous Farm Loop (Auto-plant -> Wait/Grow -> Auto-harvest -> Auto-plant again until energy runs out)
 *   - Clean Farm HUD (Live energy, field counters, next harvest countdown timer)
 *   - God Mode (HP ∞, Auto-dodge, Auto-play bot, Auto-restart battle, Dmg/Spd/Loot multipliers)
 */
(() => {
  'use strict';
  if (window.__fsFarmingSeason || window.__fsGodMode) return;

  const VERSION = '4.1.1';
  const TAG = `[FS-v${VERSION}]`;
  const DEFAULT_REF = 'FARM-WBF9L';
  const games = new Set();
  const seen = new WeakSet();
  const patchedProtos = new WeakSet();

  // Pastikan kode referal tersimpan di localStorage untuk akun baru
  try {
    if (!localStorage.getItem('fs:ref')) {
      localStorage.setItem('fs:ref', DEFAULT_REF);
    }
  } catch (e) {}

  // Intercept fetch untuk memantau pengiriman laporan battle ke /api/farm/battle/end
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = async function fsMonitoredFetch(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (url && url.includes('/api/farm/battle/end')) {
          try {
            const body = init && init.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : null;
            const statsStr = body && body.stats ? `Hits: ${body.stats.hits ?? 0}, Dodges: ${body.stats.dodges ?? 0}` : 'stats: -';
            console.log(TAG, `[Battle End Report] 📤 Mengirim ke server: Wave ${body?.wave || 1} | Kills: ${body?.kills || 0} | Loot: +${body?.earned || 0} SEASON | Durasi: ${body?.seconds || 0}s | Mati: ${body?.died ? 'YA (Natural)' : 'TIDAK'} | ${statsStr}`);
          } catch (e) {}

          try {
            const res = await origFetch.apply(this, arguments);
            const clone = res.clone();
            clone.json().then(data => {
              console.log(TAG, `[Battle End Result] 📥 Respon server (${res.status}):`, JSON.stringify(data));
            }).catch(() => {});
            return res;
          } catch (err) {
            console.error(TAG, `[Battle End Error] ❌ Gagal kirim laporan:`, err.message);
            throw err;
          }
        }
        return origFetch.apply(this, arguments);
      };
    }
  } catch (e) {}

  // All 20 official crops from custom-Cqn1PFx1.js with growth times and description
  const CROPS = [
    { id: 'radish', name: 'Radish', minutes: 30, desc: '30 min · +25' },
    { id: 'turnip', name: 'Turnip', minutes: 30, desc: '30 min · +25' },
    { id: 'carrot', name: 'Carrot', minutes: 30, desc: '30 min · +25' },
    { id: 'onion', name: 'Onion', minutes: 60, desc: '1 h · +28' },
    { id: 'red_onion', name: 'Red onion', minutes: 60, desc: '1 h · +28' },
    { id: 'garlic', name: 'Garlic', minutes: 60, desc: '1 h · +28' },
    { id: 'wheat', name: 'Wheat', minutes: 120, desc: '2 h · silo · 5 bags' },
    { id: 'corn', name: 'Corn', minutes: 120, desc: '2 h · silo · 5 bags' },
    { id: 'potato', name: 'Potato', minutes: 120, desc: '2 h · +32' },
    { id: 'cucumber', name: 'Cucumber', minutes: 120, desc: '2 h · +32' },
    { id: 'tomato', name: 'Tomato', minutes: 240, desc: '4 h · +36' },
    { id: 'red_pepper', name: 'Red pepper', minutes: 240, desc: '4 h · +36' },
    { id: 'yellow_pepper', name: 'Yellow pepper', minutes: 240, desc: '4 h · +36' },
    { id: 'green_pepper', name: 'Green pepper', minutes: 240, desc: '4 h · +36' },
    { id: 'cabbage', name: 'Cabbage', minutes: 480, desc: '8 h · +43' },
    { id: 'cauliflower', name: 'Cauliflower', minutes: 480, desc: '8 h · +43' },
    { id: 'chili', name: 'Chili', minutes: 480, desc: '8 h · +43' },
    { id: 'aubergine', name: 'Eggplant', minutes: 720, desc: '12 h · +47' },
    { id: 'strawberry', name: 'Strawberry', minutes: 720, desc: '12 h · +47' },
    { id: 'pumpkin', name: 'Pumpkin', minutes: 1440, desc: '24 h · +57' }
  ];

  const CROPS_MAP = Object.fromEntries(CROPS.map(c => [c.id, c]));

  // 10 battle perks (kd in bundle)
  const PERKS_DICT = {
    crit: { name: 'Lucky horseshoe', desc: '+7% crit (2× dmg)', max: 3 },
    blade: { name: 'Whetted blade', desc: 'Hit dmg +15%', max: 4 },
    storm: { name: 'Harvest storm', desc: 'Storm charge/wider', max: 3 },
    haste: { name: 'Nimble wrist', desc: 'Attack 10% faster', max: 3 },
    guard: { name: 'Thick apron', desc: 'Damage taken −8%', max: 2 },
    thorns: { name: 'Thorny apron', desc: 'Enemies take 4 dmg', max: 3 },
    magnet: { name: 'Magnet pouch', desc: 'Loot radius +50%', max: 3 },
    dash: { name: 'Wind step', desc: 'Dodge CD −15%', max: 2 },
    reach: { name: 'Long handle', desc: 'Reach +12%', max: 3 },
    swift: { name: 'Light boots', desc: 'Speed +10%', max: 3 }
  };

  const defaultPerkWeights = {
    crit: 10,
    blade: 9,
    storm: 8,
    haste: 8,
    guard: 7,
    thorns: 6,
    magnet: 5,
    dash: 5,
    reach: 4,
    swift: 3
  };

  // Default configuration: Auto-farm & God Mode enabled for automated loop
  const defaultCfg = {
    hp: true,               // Invulnerable
    autoDodge: true,        // Auto dodge
    autoPlay: true,         // Auto play bot
    autoRestart: true,      // Auto restart battle
    autoPerk: true,         // Auto pick perks
    autoFarm: true,         // Auto harvest
    harvestMode: 'all',     // 'all' (bulk 2 energy)
    autoPlant: true,        // Auto plant
    plantMode: 'all',       // 'all' (bulk 2 energy)
    plantCrop: 'radish',    // default seed is Radish (30m)
    autoFeed: true,         // Auto feed
    dmg: 1,
    spd: 1,
    loot: 1
  };

  const state = {
    enabled: false,         // Master switch (starts OFF, auto-activated after warmup & server sync)
    startupDone: false,
    startupCooldownUntil: 0,
    startupDuration: 0,
    phaser: false,
    heroes: 0,
    hitsBlocked: 0,
    errors: [],
    restarts: 0,
    farmJobs: 0,
    farmTicks: 0,
    farmData: null,
    lastNow: Date.now(),
    loopStatus: 'Standby (Warmup & Sync)...',
    nextHarvestText: '-',
    counts: { ready: 0, growing: 0, empty: 0, total: 0 },
    nextHarvestMs: null,
    nextHarvestCrop: '',
    perkWeights: Object.assign({}, defaultPerkWeights),
    perkLog: [],
    cfg: Object.assign({}, defaultCfg),
    panelOpen: true,
    stage: 'init',
    currentTask: 'idle',    // 'idle' | 'harvesting' | 'planting' | 'feeding' | 'collecting' | 'battling'
    taskStartedAt: 0,
    lastTaskActionAt: 0,
    cooldownUntil: 0,
    cooldownReason: '',
    battleWave: 1,
    battleKills: 0,
    tokenPrice: 0.000326,
    battleLoot: { earned: 0, cap: 1687, isFull: false, runLoot: 0 },
    harvestLoot: { earned: 0, cap: 2147, isFull: false },
    animals: { total: 0, hungry: 0, products: 0, nextMeal: '-' },
    battleCapDone: false,
    harvestCapDone: false,
    lastDay: null,
    silo: {
      feed: 0,
      wheat: 0,
      corn: 0,
      grain: 0,
      maxGrain: 245,
      dailyEat: 0,
      canMix: false
    },
    villageIncome: {
      accumulated: 0,
      rate: '+27/h',
      isFull: false,
      lastClaimAt: 0,
      nextClaimAt: Date.now() + 5 * 60 * 1000
    },
    dailyTracker: {
      day: '',
      battleCount: 0,
      lastBattleAt: 0,
      nextBattleAt: 0,
      restUntil: 0
    }
  };

  const STORAGE_KEY = 'fs_extension_cfg_v4';

  // Read optional startup warmup duration passed by runner, default 2 minutes (120,000ms)
  const startupWarmupMs = (typeof window.__FS_STARTUP_COOLDOWN_MS__ === 'number' && window.__FS_STARTUP_COOLDOWN_MS__ > 0)
    ? window.__FS_STARTUP_COOLDOWN_MS__
    : 120000;
  state.startupDuration = startupWarmupMs;
  state.startupCooldownUntil = Date.now() + startupWarmupMs;
  state.startupDone = false;
  state.enabled = false;

  function saveSettings() {
    try {
      const data = {
        enabled: state.enabled,
        panelOpen: panel ? panel.style.display !== 'none' : (state.panelOpen !== false),
        cfg: state.cfg,
        perkWeights: state.perkWeights
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn(TAG, 'Failed to save settings:', e);
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        // Only restore enabled state if startup warmup is already done
        if (state.startupDone && typeof data.enabled === 'boolean') {
          state.enabled = data.enabled;
        }
        if (typeof data.panelOpen === 'boolean') state.panelOpen = data.panelOpen;
        if (data.cfg && typeof data.cfg === 'object') {
          Object.assign(state.cfg, data.cfg);
        }
        if (data.perkWeights && typeof data.perkWeights === 'object') {
          Object.assign(state.perkWeights, data.perkWeights);
        }
      }
    } catch (e) {
      console.warn(TAG, 'Failed to load settings:', e);
    }
  }

  loadSettings();

  const err = (e) => {
    state.errors.push(String((e && e.message) || e));
    if (state.errors.length > 20) state.errors.shift();
    console.warn(TAG, e);
  };

  /* ---------------- 1. Trigger Native Game Actions ---------------- */
  // The game has: document.addEventListener('click', e => { let t = e.target.closest('[data-action]'); ... kp(t.dataset.action, t.dataset.arg) });
  // Dispatching a click on a temporary hidden element invokes kp natively without opening UI modals!
  function triggerGameAction(action, arg) {
    try {
      // Check if matching button already exists in DOM
      const selector = arg !== undefined && arg !== null
        ? `[data-action="${action}"][data-arg="${arg}"]`
        : `[data-action="${action}"]`;
      const existing = document.querySelector(selector);
      if (existing && !existing.disabled) {
        existing.click();
        return true;
      }

      const btn = document.createElement('button');
      btn.dataset.action = action;
      if (arg !== undefined && arg !== null) btn.dataset.arg = String(arg);
      btn.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;z-index:-1;';
      const container = document.body || document.documentElement;
      container.appendChild(btn);
      btn.click();
      btn.remove();
      return true;
    } catch (e) {
      err(e);
      return false;
    }
  }

  /* ---------------- 1B. Intercept /api/farm Server Responses (Live Balance & State) ---------------- */
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function' && !window.__fsFetchHooked) {
      window.__fsFetchHooked = true;
      window.fetch = async function(...args) {
        const url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || '';

        // Blokir pengiriman self-reporting anti-bot (/api/human/flag) agar bot tidak melaporkan dirinya sendiri
        if (url.includes('/api/human/flag')) {
          console.warn(TAG, '[SHIELD] Memblokir pengiriman sinyal /api/human/flag ke server.');
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        const res = await origFetch.apply(this, args);
        try {
          if (url.includes('/api/farm')) {
            res.clone().json().then(json => {
              const f = json && (json.farm || (json.data && json.data.farm));
              const priceObj = json && (json.price || (json.data && json.data.price));
              if (priceObj) {
                const p = Number(priceObj.pay || priceObj.charge);
                if (p > 0 && Number.isFinite(p)) {
                  state.tokenPrice = p;
                  window.__seasonPrice = p;
                }
              }
              if (f && typeof f === 'object') {
                if (Array.isArray(f.fields) || f.owner) {
                  state.farmData = f;
                  if (typeof f.tokens === 'number') {
                    state.farmData.tokens = f.tokens;
                  }
                }
                if (f.ban) {
                  state.isBanned = true;
                  state.banReason = (f.ban && f.ban.reason) || 'Paused for review';
                  state.loopStatus = `⚠️ Paused for Review: ${state.banReason}`;
                } else {
                  state.isBanned = false;
                  state.banReason = null;
                }
              }
            }).catch(() => {});
          }
        } catch {}
        return res;
      };
    }
  } catch (e) {}

  /* ---------------- 2. Intercept Phaser Before Boot ---------------- */
  let ns = null;
  try {
    Object.defineProperty(window, 'Phaser', {
      configurable: true,
      get() { return ns; },
      set(v) { ns = v; state.phaser = !!v; try { wrapGame(v); } catch (e) { err(e); } }
    });
  } catch (e) { err(e); }

  if (window.Phaser) {
    ns = window.Phaser;
    state.phaser = true;
    wrapGame(window.Phaser);
  }

  function wrapGame(P) {
    if (!P || P.__fsGameWrapped) return;
    P.__fsGameWrapped = true;

    if (P.Game) {
      const Real = P.Game;
      if (!Real.__fsWrapped) {
        const Wrapped = new Proxy(Real, {
          construct(target, args, newTarget) {
            const inst = Reflect.construct(target, args, newTarget);
            games.add(inst);
            console.log(TAG, 'Phaser game instance captured via constructor proxy');
            scan();
            return inst;
          }
        });
        for (const k of Object.getOwnPropertyNames(Real)) {
          if (k === 'prototype' || k === 'length' || k === 'name') continue;
          try { Wrapped[k] = Real[k]; } catch (e) {}
        }
        Wrapped.__fsWrapped = true;
        P.Game = Wrapped;
      }

      // Intercept Game.prototype.step to capture ANY existing or future game instance on first frame
      if (Real.prototype && !Real.prototype.__fsStepHooked) {
        Real.prototype.__fsStepHooked = true;
        const origStep = Real.prototype.step;
        if (typeof origStep === 'function') {
          Real.prototype.step = function fsGameStep() {
            if (!games.has(this)) {
              games.add(this);
              console.log(TAG, 'Phaser game instance captured via step() hook');
              scan();
            }
            return origStep.apply(this, arguments);
          };
        }
      }
    }
  }

  /* ---------------- 3. Hero & Enemy Patches (God Mode + Human Stats Emulation) ---------------- */
  function patchHero(hero) {
    if (!hero || typeof hero !== 'object') return;
    const proto = Object.getPrototypeOf(hero);
    if (proto && typeof proto.hurt === 'function' && !patchedProtos.has(proto)) {
      const origHurt = proto.hurt;
      proto.hurt = function fsHurt(dmg, ...a) {
        // Cari scene asli Phaser (hero.host.scene atau hero.scene)
        const scene = this.scene || (this.host && this.host.scene);
        const isSacrificing = state.sacrificeActive || (scene && scene.__fsSacrifice);

        // Fase Pengorbanan di Wave 31 (Mati Natural):
        // Matikan proteksi HP dan biarkan damage musuh masuk asli hingga hero mati natural
        if (isSacrificing) {
          console.log(TAG, `Wave 31: Hero menerima ${dmg} damage asli musuh (fase mati natural)...`);
          return origHurt.call(this, dmg, ...a);
        }

        if (!state.enabled || !state.cfg.hp) return origHurt.call(this, dmg, ...a);
        state.hitsBlocked++;

        // Pastikan stats.hits tercatat di run engine agar tidak 0 saat dikirim ke server via /api/farm/battle/end
        try {
          if (this.scene && this.scene.run && !this.scene.tut) {
            this.scene.run.hits = (this.scene.run.hits || 0) + 1;
          }
        } catch (e) {}

        try { if (typeof this.flash === 'function') this.flash(16777215, 60); } catch (e) {}

        // Simulasi darah berkurang dinamis (3 - 8 HP per hit) dengan batas aman minimal 45% HP (anti-mati)
        const dmgTaken = Math.max(3, Math.min(8, Math.round(dmg * 0.12) || 4));
        const maxHp = (this.stats && this.stats.maxHp) || 100;
        const safeFloor = Math.round(maxHp * 0.45);
        this.hp = Math.max(safeFloor, (this.hp || maxHp) - dmgTaken);
        if (typeof this.drawHp === 'function') this.drawHp(0);

        try {
          if (this.scene && typeof this.scene.floatAt === 'function') {
            this.scene.floatAt(this.x, this.y - 28, `-${dmgTaken}`, 'hurt');
          }
        } catch (e) {}

        return dmgTaken;
      };
      patchedProtos.add(proto);
      console.log(TAG, 'hero.hurt → humanized non-fatal hit (safe dynamic HP + natural stats)');
    }
    if (!seen.has(hero)) { seen.add(hero); state.heroes++; }
    topUp(hero);
  }

  function topUp(hero) {
    try {
      const st = hero.stats;
      if (!st) return;

      // JANGAN REGEN / JANGAN TOP UP HP JIKA DALAM FASE PENGORBANAN (Wave 31)
      const scene = hero.scene || (hero.host && hero.host.scene);
      if (state.sacrificeActive || (scene && scene.__fsSacrifice)) return;
      if (!state.enabled || !state.cfg.hp) return;

      // Natural Regen: Regenerasi perlahan (+2 HP per tick) kembali menuju maxHp
      if (typeof st.maxHp === 'number' && hero.hp < st.maxHp) {
        hero.hp = Math.min(st.maxHp, (hero.hp || 0) + 2);
        hero.hpTrail = hero.hp;
        if (typeof hero.drawHp === 'function') hero.drawHp(0);
      }
      if (typeof st.speed === 'number') {
        if (typeof st.__fsBase !== 'number') st.__fsBase = st.speed;
        st.speed = st.__fsBase * (state.enabled ? state.cfg.spd : 1);
      }
    } catch (e) {}
  }

  function patchEnemy(enemy) {
    if (!enemy || typeof enemy !== 'object') return;
    const proto = Object.getPrototypeOf(enemy);
    if (!proto || typeof proto.damage !== 'function' || patchedProtos.has(proto)) return;
    const origDmg = proto.damage;
    proto.damage = function fsDamage(dmg, x, y, mult) {
      const m = state.enabled ? state.cfg.dmg : 1;
      return origDmg.call(this, m === 1 ? dmg : dmg * m, x, y, mult);
    };
    patchedProtos.add(proto);
    console.log(TAG, 'enemy.damage → x' + state.cfg.dmg);
  }

  /* ---------------- 4. Battle & Auto-Pick Perk Logic ---------------- */
  function scorePerk(key, scene) {
    const weights = state.perkWeights || defaultPerkWeights;
    let score = weights[key] !== undefined ? weights[key] : (defaultPerkWeights[key] || 0);

    // Modifier 1: HP < 60% → guard +6, thorns +3, blade/crit -1 (sustain dulu)
    const maxHp = (scene.hero && scene.hero.stats && scene.hero.stats.maxHp) || 100;
    const currentHp = (scene.hero && typeof scene.hero.hp === 'number') ? scene.hero.hp : maxHp;
    if ((currentHp / maxHp) < 0.6) {
      if (key === 'guard') score += 6;
      else if (key === 'thorns') score += 3;
      else if (key === 'blade' || key === 'crit') score -= 1;
    }

    // Modifier 2: wave <= 2 → magnet/swift +1.5 (farming awal)
    const wave = scene.wave || 1;
    if (wave <= 2) {
      if (key === 'magnet' || key === 'swift') score += 1.5;
    }

    // Modifier 3: wave >= 6 → storm +1.5 (AoE buat wave padat)
    if (wave >= 6) {
      if (key === 'storm') score += 1.5;
    }

    // Modifier 4: tiap level yang sudah dimiliki → skor -0.8 (biar level nyebar, bukan numpuk satu)
    const currentLevel = (scene.run && scene.run.perks && scene.run.perks[key]) || 0;
    score -= currentLevel * 0.8;

    return score;
  }

  function pickBestPerk(s) {
    if (s.mode !== 'perk') return;

    // Gather available perks offered in DOM
    const buttons = document.querySelectorAll('[data-perk]');
    let offered = [];
    buttons.forEach(b => {
      const p = b.dataset.perk;
      if (p && !offered.includes(p)) offered.push(p);
    });

    // Fallback: if DOM buttons not found yet, get unmaxed perks from run.perks
    if (!offered.length && s.run && s.run.perks) {
      offered = Object.keys(PERKS_DICT).filter(k => (s.run.perks[k] || 0) < PERKS_DICT[k].max);
    }
    if (!offered.length) return;

    let bestKey = offered[0];
    let bestScore = -Infinity;

    for (const key of offered) {
      const sc = scorePerk(key, s);
      if (sc > bestScore) {
        bestScore = sc;
        bestKey = key;
      }
    }

    // 1. Primary: scene method pickPerk
    if (typeof s.pickPerk === 'function') {
      s.pickPerk(bestKey);
    }

    // 2. Fallback: click DOM button [data-perk]
    if (s.mode === 'perk') {
      const targetBtn = document.querySelector(`[data-perk="${bestKey}"]`);
      if (targetBtn) targetBtn.click();
    }

    // Record log entry in state.perkLog
    const perkName = PERKS_DICT[bestKey]?.name || bestKey;
    const entry = {
      wave: s.wave || 1,
      key: bestKey,
      name: perkName,
      timestamp: Date.now()
    };
    state.perkLog.push(entry);
    if (state.perkLog.length > 50) state.perkLog.shift();
    console.log(TAG, `Auto-picked perk: ${perkName} (${bestKey}, score ${bestScore.toFixed(1)}) at wave ${entry.wave}`);
  }

  /* ---------------- 4. Battle & Auto-Pick Perk Logic ---------------- */
  // Dynamic daily cap tables based on Town Hall level (from in-game config B and Kt):
  const BATTLE_USD_TABLE = [0.55, 1.28, 2.93, 6.60, 14.67];
  const HARVEST_USD_TABLE = [0.70, 1.64, 3.74, 8.40, 18.66];

  function getBattleLootInfo(farm, s) {
    let earned = (farm && farm.today && typeof farm.today.battleEarned === 'number') ? farm.today.battleEarned : 0;
    
    // 1. Dynamic Cap Formula: Town Hall USD / live token price
    const farmLvl = Math.max(1, Math.min(5, (farm && farm.level) || 1));
    const tokenPrice = state.tokenPrice || window.__seasonPrice || 0.000326;
    let cap = Math.round(BATTLE_USD_TABLE[farmLvl - 1] / tokenPrice);

    // 2. Real-time extraction from In-Game Battle HUD (.bui-loot small)
    let parsedDom = false;
    const hudSmall = (s && s.hud && s.hud.el && s.hud.el.loot && s.hud.el.loot.querySelector('small'))
      || document.querySelector('.bui-loot small');
    if (hudSmall && hudSmall.textContent) {
      const m = hudSmall.textContent.match(/([0-9.,]+)\s*\/\s*([0-9.,]+)/);
      if (m) {
        const domEarned = parseFloat(m[1].replace(/,/g, ''));
        const domCap = parseFloat(m[2].replace(/,/g, ''));
        if (domCap > 0) {
          earned = domEarned;
          cap = domCap;
          parsedDom = true;
        }
      }
    }

    // 3. Pre-Battle Modal & Town Hall DOM outside battle (.bloot, .battle-loot)
    if (!parsedDom) {
      const blootSpan = document.querySelector('.bloot span, .battle-loot span, .bloot b + span');
      if (blootSpan && blootSpan.textContent) {
        const m = blootSpan.textContent.match(/([0-9.,]+)\s*\/\s*([0-9.,]+)/);
        if (m) {
          const domEarned = parseFloat(m[1].replace(/,/g, ''));
          const domCap = parseFloat(m[2].replace(/,/g, ''));
          if (domCap > 0) {
            earned = Math.max(earned, domEarned);
            cap = domCap;
            parsedDom = true;
          }
        }
      }
    }

    const runLoot = (s && s.run && typeof s.run.loot === 'number') ? s.run.loot : 0;
    // hudSmall text already includes today.battleEarned + pending run loot
    const totalEarned = parsedDom ? earned : (earned + (s && s.mode !== 'lobby' ? runLoot : 0));

    const fullEl = document.querySelector('.bui-loot.full, .bloot.full, .battle-loot.full');
    const noteEl = document.querySelector('.bnote');
    const isDomFull = !!fullEl || (noteEl && noteEl.textContent.includes("collected today's loot"));

    const isFull = isDomFull || totalEarned >= cap;
    const res = {
      earned: Math.round(totalEarned),
      cap: Math.round(cap),
      isFull: isFull,
      runLoot: Math.round(runLoot)
    };
    state.battleLoot = res;
    if (isFull) state.battleCapDone = true;
    return res;
  }

  function getHarvestLootInfo(farm) {
    let earned = (farm && farm.today && typeof farm.today.harvestEarned === 'number') ? farm.today.harvestEarned : 0;
    const farmLvl = Math.max(1, Math.min(5, (farm && farm.level) || 1));
    const tokenPrice = state.tokenPrice || window.__seasonPrice || 0.000326;
    let cap = Math.round(HARVEST_USD_TABLE[farmLvl - 1] / tokenPrice);

    const harvestTile = document.querySelector('[data-action="dock"][data-arg="fields"] b, .tiles button[data-arg="fields"] b, .hloot span, .harvest-loot span');
    if (harvestTile && harvestTile.textContent) {
      const m = harvestTile.textContent.match(/([0-9.,]+)\s*\/\s*([0-9.,]+)/);
      if (m) {
        const domEarned = parseFloat(m[1].replace(/,/g, ''));
        const domCap = parseFloat(m[2].replace(/,/g, ''));
        if (domCap > 0) {
          earned = Math.max(earned, domEarned);
          cap = domCap;
        }
      }
    }

    const isFull = earned >= cap;
    const res = {
      earned: Math.round(earned),
      cap: Math.round(cap),
      isFull: isFull
    };
    state.harvestLoot = res;
    if (isFull) state.harvestCapDone = true;
    return res;
  }

  function syncTokens(farm) {
    let tokens = (farm && typeof farm.tokens === 'number') ? farm.tokens : 0;
    const balanceTile = document.querySelector('button.tile.balance b, [data-action="withdraw-panel"] b, .tile.balance b');
    if (balanceTile) {
      const raw = balanceTile.textContent.replace(/[^0-9]/g, '');
      if (raw) {
        const domVal = parseInt(raw, 10);
        if (domVal > 0) tokens = Math.max(tokens, domVal);
      }
    }
    if (farm) farm.tokens = tokens;
    return tokens;
  }

  /* ---------------- 4B. Silo & Animal Feed Bags Logic ---------------- */
  function syncSiloInfo(farm) {
    if (!farm) return;
    const silo = farm.silo || {};
    const wheat = (typeof silo.wheat === 'number') ? silo.wheat : 0;
    const corn = (typeof silo.corn === 'number') ? silo.corn : 0;
    const feed = (typeof silo.feed === 'number') ? silo.feed : 0;
    const grain = wheat + corn;

    const HARVEST_TABLE = [0.70, 1.64, 3.74, 8.40, 18.66];
    const lvl = Math.max(1, Math.min(5, farm.level || 1));
    const maxGrain = Math.round(7 * HARVEST_TABLE[lvl - 1] / 0.02);

    let dailyEat = 0;
    if (Array.isArray(farm.animals)) {
      const mealMap = { chicken: 2, sheep: 5, cow: 8, pig: 10 };
      dailyEat = farm.animals.reduce((sum, a) => sum + ((mealMap[a.kind] || 2) * 2), 0);
    }

    state.silo = {
      feed: feed,
      wheat: wheat,
      corn: corn,
      grain: grain,
      maxGrain: maxGrain,
      dailyEat: dailyEat,
      canMix: Math.min(wheat, corn) >= 1
    };
  }

  function getAnimalDailyEnergyReserve(farm, time) {
    if (!farm || !Array.isArray(farm.animals) || farm.animals.length === 0) {
      return 0;
    }
    const now = time || Date.now();
    let tz = -new Date().getTimezoneOffset();
    if (farm && Number.isFinite(farm.tz)) {
      tz = Math.round(farm.tz);
    }
    const d = new Date(now + tz * 60000);
    const hour = d.getUTCHours();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const baseDateStr = `${y}-${m}-${day}`;

    // Ambil jenis-jenis kandang / shelter aktif dari hewan
    const animalKinds = new Set(farm.animals.map(a => a.kind));
    const sheltersCount = animalKinds.size; // 1 kandang per jenis (misal ayam + domba = 2 kandang)
    if (sheltersCount === 0) return 0;

    let mealsRemaining = 0;
    // Window 1: Shift S (00-12)
    if (hour < 12) {
      const shiftS = baseDateStr + 'S';
      const fedS = farm.animals.some(a => a.fedWindows && a.fedWindows.includes(shiftS));
      if (!fedS) mealsRemaining++;
    }
    // Window 2: Shift A (12-24)
    const shiftA = baseDateStr + 'A';
    const fedA = farm.animals.some(a => a.fedWindows && a.fedWindows.includes(shiftA));
    if (!fedA) mealsRemaining++;

    // Tiap kali feed 1 kandang serentak menghabiskan 2 energy
    return mealsRemaining * sheltersCount * 2;
  }

  // Helper for emulating authentic desktop keyboard events (WASD, Space, KeyE)
  const FS_KEY_DEFS = {
    KeyW: { key: 'w', code: 'KeyW', keyCode: 87, which: 87 },
    KeyA: { key: 'a', code: 'KeyA', keyCode: 65, which: 65 },
    KeyS: { key: 's', code: 'KeyS', keyCode: 83, which: 83 },
    KeyD: { key: 'd', code: 'KeyD', keyCode: 68, which: 68 },
    Space: { key: ' ', code: 'Space', keyCode: 32, which: 32 },
    KeyE: { key: 'e', code: 'KeyE', keyCode: 69, which: 69 },
  };

  function sendKeyEvent(type, codeName, scene) {
    const k = FS_KEY_DEFS[codeName];
    if (!k) return;
    try {
      const ev = new KeyboardEvent(type, {
        key: k.key,
        code: k.code,
        keyCode: k.keyCode,
        which: k.which,
        bubbles: true,
        cancelable: true,
        view: window
      });
      try {
        Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode });
        Object.defineProperty(ev, 'which', { get: () => k.which });
      } catch (e) {}

      window.dispatchEvent(ev);
      if (document.body) document.body.dispatchEvent(ev);

      // Sinkronkan langsung ke object keys internal scene Phaser
      if (scene && scene.keys) {
        const isDown = (type === 'keydown');
        if (codeName === 'KeyW' && scene.keys.W) scene.keys.W.isDown = isDown;
        else if (codeName === 'KeyA' && scene.keys.A) scene.keys.A.isDown = isDown;
        else if (codeName === 'KeyS' && scene.keys.S) scene.keys.S.isDown = isDown;
        else if (codeName === 'KeyD' && scene.keys.D) scene.keys.D.isDown = isDown;
      }
    } catch (e) {}
  }

  function releaseAllBattleKeys(scene) {
    if (!scene || !scene.__keyState) return;
    for (const code of Object.keys(FS_KEY_DEFS)) {
      if (scene.__keyState[code]) {
        scene.__keyState[code] = false;
        sendKeyEvent('keyup', code, scene);
      }
    }
  }

  function battleTick(s) {
    if (!state.enabled || !state.startupDone) {
      releaseAllBattleKeys(s);
      return;
    }

    try {
      if (s.hero) patchHero(s.hero);
      if (s.enemies && s.enemies.length) patchEnemy(s.enemies[0]);
    } catch (e) {}

    try {
      if (s.hero && !s.hero.dead) {
        if (state.sacrificeActive || s.__fsSacrifice) {
          // Fase Pengorbanan Wave 31:
          // Matikan serangan balik hero agar monster tidak terbunuh
          s.hero.atkCd = 999;
          // Gerakan hero santai (wandering/melingkar) agar WASD aktif terus & tidak kena flag afk
          const t = Date.now() / 900;
          s.__fsBot = [Math.cos(t) * 0.45, Math.sin(t) * 0.45];
        } else if (typeof s.botInput === 'function') {
          s.__fsBot = s.botInput();
        }
      }
    } catch (e) { err(e); }

    // Auto-pick perk
    try {
      if (s.mode === 'perk') {
        releaseAllBattleKeys(s);
        if (!s.__fsPerkScheduled) {
          s.__fsPerkScheduled = true;
          const delay = Math.floor(320 + Math.random() * 280);
          setTimeout(() => {
            s.__fsPerkScheduled = false;
            if (s.mode === 'perk') pickBestPerk(s);
          }, delay);
        }
      } else {
        s.__fsPerkScheduled = false;
      }
    } catch (e) {}

    // 1. Natural Human Input Simulation (WASD, Space, KeyE & Pointer)
    // Phaser memantau input pemain via keydown & pointerdown/pointermove (jeda >75 detik & kills >=10 memicu flag afk-loot)
    try {
      const gameNow = (s.time && s.time.now) || Date.now();
      if (typeof s.markInput === 'function') {
        s.markInput();
      } else if (s.lastInput) {
        s.lastInput.at = gameNow;
        s.lastInput.kills = (s.run && typeof s.run.kills === 'number') ? s.run.kills : 0;
      }

      if (s.mode === 'play' && s.hero && !s.hero.dead) {
        // A. WASD Movement Key Injection
        s.__keyState = s.__keyState || {};
        const botDir = s.__fsBot || [0, 0];
        const vx = botDir[0];
        const vy = botDir[1];
        const mag = Math.hypot(vx, vy);

        let wantW = false;
        let wantS = false;
        let wantA = false;
        let wantD = false;

        if (mag > 0.15) {
          if (vy < -0.28) wantW = true;
          else if (vy > 0.28) wantS = true;

          if (vx < -0.28) wantA = true;
          else if (vx > 0.28) wantD = true;

          if (!wantW && !wantS && !wantA && !wantD) {
            if (Math.abs(vy) > Math.abs(vx)) {
              if (vy < 0) wantW = true; else wantS = true;
            } else {
              if (vx < 0) wantA = true; else wantD = true;
            }
          }
        }

        const keysToUpdate = [
          { code: 'KeyW', want: wantW },
          { code: 'KeyA', want: wantA },
          { code: 'KeyS', want: wantS },
          { code: 'KeyD', want: wantD }
        ];

        for (const item of keysToUpdate) {
          if (!!s.__keyState[item.code] !== item.want) {
            s.__keyState[item.code] = item.want;
            sendKeyEvent(item.want ? 'keydown' : 'keyup', item.code, s);
          }
        }

        // B. Dodge via Space Key (Native Keyboard Event)
        const lastDodge = s.__lastHumanDodgeAt || 0;
        const now = Date.now();
        const dangerClose = Array.isArray(s.enemies) && s.enemies.some(e => e.alive && (
          (e.state === 'windup' && Math.hypot(e.x - s.hero.x, e.y - s.hero.y) < 75) ||
          (e.state === 'fuse' && Math.hypot(e.x - s.hero.x, e.y - s.hero.y) < 55) ||
          (Math.hypot(e.x - s.hero.x, e.y - s.hero.y) < 48)
        ));
        const projThreat = Array.isArray(s.projs) && s.projs.some(p => p.sprite && Math.hypot(s.hero.x - p.sprite.x, s.hero.y - p.sprite.y) < 45);

        const timeSinceDodge = now - lastDodge;
        const randomDodgeInterval = 6500 + Math.floor(Math.random() * 3000);
        const isSacrificing = state.sacrificeActive || !!s.__fsSacrifice;
        const shouldDodge = state.cfg.autoDodge && !isSacrificing && ((timeSinceDodge > 3200 && (dangerClose || projThreat)) ||
                            (timeSinceDodge > randomDodgeInterval && Array.isArray(s.enemies) && s.enemies.some(e => e.alive)));

        if (shouldDodge) {
          s.__lastHumanDodgeAt = now;
          sendKeyEvent('keydown', 'Space', s);
          try {
            if (typeof s.doDodge === 'function') {
              s.doDodge();
            } else if (s.hero && typeof s.hero.dodge === 'function') {
              s.hero.dodge();
            }
            if (s.run && typeof s.run.dodges === 'number') {
              s.run.dodges++;
            }
          } catch (e) {}
          setTimeout(() => {
            sendKeyEvent('keyup', 'Space', s);
          }, 60 + Math.floor(Math.random() * 40));
        }

        // C. Storm Skill via KeyE (Native Keyboard Event)
        const lastStorm = s.__lastHumanStormAt || 0;
        const crowdCount = Array.isArray(s.enemies) ? s.enemies.filter(e => e.alive && Math.hypot(e.x - s.hero.x, e.y - s.hero.y) < 80).length : 0;
        const bossThreat = Array.isArray(s.enemies) && s.enemies.some(e => e.alive && e.isBoss && Math.hypot(e.x - s.hero.x, e.y - s.hero.y) < 95);

        const timeSinceStorm = now - lastStorm;
        const shouldStorm = !isSacrificing && (((timeSinceStorm > 14000 && (crowdCount >= 3 || bossThreat)) ||
                            (timeSinceStorm > 30000 && Array.isArray(s.enemies) && s.enemies.some(e => e.alive))));

        if (shouldStorm) {
          s.__lastHumanStormAt = now;
          sendKeyEvent('keydown', 'KeyE', s);
          try {
            if (typeof s.doStorm === 'function') s.doStorm();
          } catch (e) {}
          setTimeout(() => {
            sendKeyEvent('keyup', 'KeyE', s);
          }, 70 + Math.floor(Math.random() * 40));
        }

        // D. Pointer Movement Simulation (dengan Jitter & Koordinat Dinamis)
        if (!s.__lastPointerSimAt || (now - s.__lastPointerSimAt > 700)) {
          s.__lastPointerSimAt = now;
          const canvas = document.querySelector('canvas');
          if (canvas) {
            const rect = canvas.getBoundingClientRect();
            let heroScreenX = rect.left + rect.width / 2;
            let heroScreenY = rect.top + rect.height / 2;
            if (s.cameras && s.cameras.main && s.hero) {
              const cam = s.cameras.main;
              heroScreenX = rect.left + (s.hero.x - cam.worldView.x) * cam.zoom;
              heroScreenY = rect.top + (s.hero.y - cam.worldView.y) * cam.zoom;
            }

            const leadDist = 50 + Math.sin(now / 320) * 18;
            const tremorAngle = Math.atan2(botDir[1], botDir[0]) + (Math.sin(now / 180) * 0.22);
            const jitterX = (Math.random() - 0.5) * 6;
            const jitterY = (Math.random() - 0.5) * 6;
            const targetClientX = Math.max(rect.left + 10, Math.min(rect.right - 10, heroScreenX + Math.cos(tremorAngle) * leadDist + jitterX));
            const targetClientY = Math.max(rect.top + 10, Math.min(rect.bottom - 10, heroScreenY + Math.sin(tremorAngle) * leadDist + jitterY));

            const evt = new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              clientX: Math.round(targetClientX * 10) / 10,
              clientY: Math.round(targetClientY * 10) / 10,
              isDown: true,
              pointerType: 'mouse'
            });
            canvas.dispatchEvent(evt);
          }
        }
      } else {
        releaseAllBattleKeys(s);
      }
    } catch (e) {}

    // Live Battle Metrics (Wave, Kills, Loot)
    const wave = s.wave || 1;
    const kills = (s.run && typeof s.run.kills === 'number') ? s.run.kills : 0;
    state.battleWave = wave;
    state.battleKills = kills;

    // Check Battle Cap
    const bInfo = getBattleLootInfo(state.farmData, s);

    // Jika akun ditinjau / diblokir dev
    if (state.isBanned) {
      state.loopStatus = `⚠️ Paused for Review: ${state.banReason}`;
      if (s.mode !== 'lobby' && s.mode !== 'over') {
        try { if (typeof s.endRun === 'function') s.endRun(false); } catch (e) {}
      } else {
        triggerGameAction('go-home');
      }
      return;
    }

    const isCap99Pct = bInfo.cap > 0 && (bInfo.earned >= Math.floor(bInfo.cap * 0.99));

    // =============================================================
    // TAHAP A: LOBBY ARENA (Staging Ground sebelum Masuk Battle)
    // =============================================================
    if (s.mode === 'lobby') {
      releaseAllBattleKeys(s);
      s.__fsSacrifice = false;
      state.sacrificeActive = false;
      state.battleWave = 0;
      s.wave = 1; // Reset memory wave lama agar tidak terbaca sebagai wave 31

      // 1. Jika Battle Cap sudah tuntas (100% atau 99%+), langsung pulang ke desa
      if (bInfo.isFull || isCap99Pct) {
        state.battleCapDone = true;
        state.loopStatus = `🎉 Battle Cap Penuh (${bInfo.earned}/${bInfo.cap})! Kembali ke Ladang...`;
        if (!s.__fsReturningHome) {
          s.__fsReturningHome = true;
          state.currentTask = 'idle';
          state.stage = 'farm';
          setCooldown(3000, '🌾 Battle Cap Penuh, kembali ke Ladang');
          setTimeout(() => {
            triggerGameAction('go-home');
            s.__fsReturningHome = false;
          }, 1000);
        }
        return;
      }

      // 2. Battle Cap belum penuh: Cek Energi
      state.battleCapDone = false;
      state.currentTask = 'battling';
      const energy = state.farmData?.today?.energy ?? 100;

      if (energy < 5) {
        state.loopStatus = `⚡ Butuh minimal 5 energy untuk battle (saat ini: ${energy}). Kembali ke Ladang...`;
        if (!s.__fsReturningHome) {
          s.__fsReturningHome = true;
          state.currentTask = 'idle';
          state.stage = 'farm';
          setCooldown(4000, '⚡ Butuh minimal 5 energy');
          setTimeout(() => {
            triggerGameAction('go-home');
            s.__fsReturningHome = false;
          }, 1200);
        }
        return;
      }

      // 3. Energy cukup (>= 5): Jalankan Run
      if (!s.starting && !s.__fsStartingRun) {
        s.__fsStartingRun = true;
        s.__fsRunActive = true;
        s.__fsRunCounted = false;
        state.battleWave = 1;
        state.loopStatus = `⚔️ Mulai Battle Run (Loot: ${bInfo.earned}/${bInfo.cap})...`;
        setTimeout(() => {
          try {
            if (typeof s.startRun === 'function') {
              s.startRun();
            } else {
              const againBtn = document.querySelector('[data-b="again"]');
              if (againBtn) againBtn.click();
            }
          } catch (e) { err(e); }
          s.__fsStartingRun = false;
        }, 600);
      }
      return;
    }

    // =============================================================
    // TAHAP B: PILIH PERK (Level-up In-game)
    // =============================================================
    if (s.mode === 'perk') {
      state.loopStatus = `⚔️ Wave ${wave} | Pilih Perk (Kills: ${kills} | Loot: ${bInfo.earned}/${bInfo.cap})`;
      return;
    }

    // =============================================================
    // TAHAP C: BATTLE OVER (Hero Kalah Natural / Selesai Run)
    // =============================================================
    if (s.mode === 'over' && !s.starting) {
      releaseAllBattleKeys(s);
      s.__fsSacrifice = false;
      state.sacrificeActive = false;

      // Pulihkan kembali checkbox HP & Auto-dodge untuk run berikutnya / farm loop:
      let restored = false;
      if (!state.cfg.hp) {
        state.cfg.hp = true;
        restored = true;
      }
      if (!state.cfg.autoDodge) {
        state.cfg.autoDodge = true;
        restored = true;
      }
      if (restored) paint();

      // Catat battle selesai di dailyTracker (TIDAK PERNAH SPAM: Hanya dicatat 1x per active run)
      if (s.__fsRunActive && !s.__fsRunCounted) {
        s.__fsRunCounted = true;
        s.__fsRunActive = false;
        if (state.dailyTracker) {
          state.dailyTracker.battleCount = (state.dailyTracker.battleCount || 0) + 1;
          state.dailyTracker.lastBattleAt = Date.now();
          saveDailyTracker(state.farmData?.owner, state.dailyTracker);
          console.log(TAG, `Battle run #${state.dailyTracker.battleCount} selesai dicatat (Loot: ${bInfo.earned}/${bInfo.cap}).`);
        }
      }

      if (!s.__fsReturningFromOver) {
        s.__fsReturningFromOver = true;
        state.loopStatus = `⚔️ Battle Run Selesai (Loot: ${bInfo.earned}/${bInfo.cap}). Kembali ke Ladang...`;
        state.currentTask = 'idle';
        state.stage = 'farm';
        state.battleWave = 0;
        s.wave = 1;
        setCooldown(5000, '🌾 Selesai Battle Run, kembali ke Ladang');
        setTimeout(() => {
          triggerGameAction('go-home');
          s.__fsReturningFromOver = false;
        }, 1200);
      }
      return;
    }

    // =============================================================
    // TAHAP D: PERTEMPURAN AKTIF (s.mode === 'play')
    // =============================================================
    s.__fsRunActive = true;
    state.battleCapDone = false;
    state.currentTask = 'battling';

    // Evaluasi Penyelesaian Battle Run yang Alami:
    // 1. Cap 100% penuh: bInfo.isFull
    // 2. Cap >= 99%: bInfo.earned >= Math.floor(bInfo.cap * 0.99)
    // 3. Batas Maksimal Wave: wave >= 31 (Wave 30 tuntas, hero dikorbankan di wave 31 agar mati natural)
    // 4. Stagnasi Loot: Hanya dievaluasi jika loot sudah mendekati cap (>= 90%) dan tidak bertambah selama 3 wave
    const isWave30Cleared = wave >= 31;

    let isLootStagnant = false;
    if (wave >= 15 && bInfo.earned >= Math.floor(bInfo.cap * 0.90)) {
      if (s.__fsLastWaveChecked !== wave) {
        if (s.__fsLastLootAmount === bInfo.earned) {
          s.__fsLootStagnantWaves = (s.__fsLootStagnantWaves || 0) + 1;
        } else {
          s.__fsLootStagnantWaves = 0;
          s.__fsLastLootAmount = bInfo.earned;
        }
        s.__fsLastWaveChecked = wave;
      }
      if ((s.__fsLootStagnantWaves || 0) >= 3) {
        isLootStagnant = true;
      }
    } else if (wave < 15) {
      s.__fsLootStagnantWaves = 0;
      s.__fsLastLootAmount = bInfo.earned;
      s.__fsLastWaveChecked = wave;
    }

    const shouldSacrifice = isWave30Cleared || bInfo.isFull || isCap99Pct || isLootStagnant;
    if (bInfo.isFull || isCap99Pct || isLootStagnant) {
      state.battleCapDone = true;
    }

    // BATTLE DIAKHIRI DENGAN MATI NATURAL (WAVE 30 TUNTAS / CAP PENUH)
    // Hero dikorbankan di Wave 31: matikan proteksi HP, gerak santai WASD (hindari AFK), biarkan musuh hit sampai mati alami
    if (shouldSacrifice) {
      s.__fsSacrifice = true;
      state.sacrificeActive = true;

      // OTOMATIS UNCHECK HP & AUTO-DODGE DI PANEL UI:
      let changed = false;
      if (state.cfg.hp) {
        state.cfg.hp = false;
        changed = true;
      }
      if (state.cfg.autoDodge) {
        state.cfg.autoDodge = false;
        changed = true;
      }
      if (changed) paint();

      if (s.hero) {
        s.hero.atkCd = 999;
      }

      const reasonStr = isCap99Pct ? `Battle Cap 99% Tercapai (${bInfo.earned}/${bInfo.cap})` : (isWave30Cleared ? 'Wave 30 Tuntas (Wave 31)' : (bInfo.isFull ? 'Cap Full' : 'Target Selesai'));
      state.loopStatus = `💀 ${reasonStr}! Mengorbankan Hero (Mati Natural diserang musuh)...`;
      return;
    }

    s.__fsRestartFails = 0;
    state.loopStatus = `⚔️ Wave ${wave} (Kills: ${kills} | Loot: ${bInfo.earned}/${bInfo.cap})`;
  }

  /* ---------------- 5. Farm Helper & Worker Checks ---------------- */
  function tryFallbackFarmData() {
    try {
      const lastOwner = localStorage.getItem('fs:lastOwner');
      if (lastOwner) {
        const raw = localStorage.getItem('fs:farm:' + lastOwner.toLowerCase());
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.fields)) {
            state.farmData = parsed;
            state.lastNow = Date.now();
          }
        }
      }
    } catch (e) {}
  }

  function getGameMealWindow(time, farmOrTz) {
    let tz = -new Date().getTimezoneOffset();
    if (farmOrTz && typeof farmOrTz === 'object' && Number.isFinite(farmOrTz.tz)) {
      tz = Math.round(farmOrTz.tz);
    } else if (Number.isFinite(farmOrTz)) {
      tz = Math.round(farmOrTz);
    }
    const d = new Date(time + tz * 60000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const half = d.getUTCHours() < 12 ? 'S' : 'A';
    return `${y}-${m}-${day}${half}`;
  }

  function isAnimalHungry(animal, now, farm) {
    if (!animal) return false;
    const currentWindow = getGameMealWindow(now || Date.now(), farm);
    return !Array.isArray(animal.fedWindows) || !animal.fedWindows.includes(currentWindow);
  }

  /* ---------------- Smart Crop Selection (Starter Pumpkin -> Radish) ---------------- */
  function markFirstPumpkinDone(owner) {
    if (!owner) return;
    try {
      localStorage.setItem('fs:firstPumpkin:' + owner.toLowerCase(), 'done');
      if (state.dailyTracker) {
        state.dailyTracker.firstPumpkinDone = true;
        saveDailyTracker(owner, state.dailyTracker);
      }
    } catch (e) {}
  }

  function isFirstPumpkin(farm) {
    if (!farm || !farm.owner) return false;
    const owner = farm.owner.toLowerCase();

    // 1. Cek di localStorage per akun
    if (localStorage.getItem('fs:firstPumpkin:' + owner) === 'done') {
      return false;
    }
    // 2. Cek di dailyTracker
    if (state.dailyTracker && state.dailyTracker.firstPumpkinDone) {
      return false;
    }

    // 3. Cek data historis farm dari server: jika sudah pernah panen atau tanam
    if (farm.counters && ((farm.counters.plants || 0) > 0 || (farm.counters.harvests || 0) > 0)) {
      markFirstPumpkinDone(owner);
      return false;
    }
    if (farm.today && (farm.today.harvestEarned || 0) > 0) {
      markFirstPumpkinDone(owner);
      return false;
    }
    if (farm.totals && (farm.totals.harvests || 0) > 0) {
      markFirstPumpkinDone(owner);
      return false;
    }
    // 4. Jika di ladang sudah ada tanaman lain yang tumbuh atau siap panen
    if (Array.isArray(farm.fields) && farm.fields.some(f => f.crop && f.crop !== 'pumpkin')) {
      markFirstPumpkinDone(owner);
      return false;
    }

    // Akun baru pertama kali tanam! Wajib Pumpkin (Instant & +57 SEASON per petak)!
    return true;
  }

  function getNextCropToPlant(farm) {
    if (isFirstPumpkin(farm)) {
      return 'pumpkin';
    }

    // Jika Harvest Cap sudah tuntas (100% atau isFull):
    // Ganti tanaman ke Wheat / Corn untuk bahan Silo feed bags
    if (state.harvestCapDone || (state.harvestLoot && state.harvestLoot.isFull)) {
      const wheatCount = (farm && farm.silo && typeof farm.silo.wheat === 'number') ? farm.silo.wheat : 0;
      const cornCount = (farm && farm.silo && typeof farm.silo.corn === 'number') ? farm.silo.corn : 0;

      // Hitung juga yang sedang tumbuh di ladang agar seimbang riil
      const fields = (farm && Array.isArray(farm.fields)) ? farm.fields : [];
      const growingWheat = fields.filter(f => f.crop && (f.crop.id === 'wheat' || f.crop === 'wheat')).length;
      const growingCorn = fields.filter(f => f.crop && (f.crop.id === 'corn' || f.crop === 'corn')).length;

      const totalWheat = wheatCount + growingWheat;
      const totalCorn = cornCount + growingCorn;

      if (totalWheat > totalCorn) {
        return 'corn';
      } else if (totalCorn > totalWheat) {
        return 'wheat';
      } else {
        // Jika seimbang sama banyak, tanam wheat dulu
        return 'wheat';
      }
    }

    return state.cfg.plantCrop || 'radish';
  }

  /* ---------------- Smart Animal Hunger & Product Tracker (Coop & Sheep Pen Sync) ---------------- */
  function getAnimalStats(farm, gameNow) {
    const stats = {
      totalChickens: 0,
      hungryChickens: 0,
      readyChickens: 0,
      totalSheep: 0,
      hungrySheep: 0,
      readySheep: 0,
      totalAnimals: 0,
      totalHungry: 0,
      productsReady: 0,
      allChickensHungry: false,
      allSheepHungry: false,
      isReadyForBulkFeed: false,
      isReadyForBulkCollect: false,
      collectStatusDesc: 'Belum ada produk',
      nextMealAt: 0,
      nextMeal: '-'
    };

    if (!farm || !Array.isArray(farm.animals) || farm.animals.length === 0) {
      return stats;
    }

    const now = gameNow || Date.now();
    stats.nextMealAt = getNextMealTimestamp(now, farm);
    stats.nextMeal = getNextMealCountdown(now, farm);

    for (const a of farm.animals) {
      const hungry = isAnimalHungry(a, now, farm);
      const ready = !!a.productReady;

      stats.totalAnimals++;
      if (hungry) stats.totalHungry++;
      if (ready) stats.productsReady++;

      if (a.kind === 'chicken') {
        stats.totalChickens++;
        if (hungry) stats.hungryChickens++;
        if (ready) stats.readyChickens++;
      } else if (a.kind === 'sheep') {
        stats.totalSheep++;
        if (hungry) stats.hungrySheep++;
        if (ready) stats.readySheep++;
      }
    }

    stats.allChickensHungry = stats.totalChickens > 0 && stats.hungryChickens >= stats.totalChickens;
    stats.allSheepHungry = stats.totalSheep > 0 && stats.hungrySheep >= stats.totalSheep;

    // 1. SYARAT BULK FEED (HEMAT 2 ENERGY PER BUILDING):
    // Tidak boleh ada hewan yang lapar setengah-setengah!
    // Di setiap gedung yang ada hewan lapar, seluruh hewannya harus lapar 100%!
    const noPartialChickensFeed = (stats.hungryChickens === 0 || stats.hungryChickens >= stats.totalChickens);
    const noPartialSheepFeed = (stats.hungrySheep === 0 || stats.hungrySheep >= stats.totalSheep);
    stats.isReadyForBulkFeed = (stats.totalHungry > 0) && noPartialChickensFeed && noPartialSheepFeed;

    // 2. SYARAT BULK COLLECT (HEMAT 2 ENERGY: TUNGGU SEMUA READY):
    // - Dilarang collect jika tidak ada produk yang ready (productsReady === 0).
    // - Jika ada hewan di suatu gedung yang baru ready sebagian (misal baru 2 dari 6 ayam), TUNGGU sampai semua serentak ready!
    // - Siap collect jika semua produk yang ready di gedung masing-masing sudah 100% tuntas dan tidak ada gedung lain yang masih nanggung.
    const cAllReady = stats.totalChickens > 0 && stats.readyChickens >= stats.totalChickens;
    const cPartial = stats.readyChickens > 0 && stats.readyChickens < stats.totalChickens;

    const sAllReady = stats.totalSheep > 0 && stats.readySheep >= stats.totalSheep;
    const sPartial = stats.readySheep > 0 && stats.readySheep < stats.totalSheep;

    if (stats.productsReady === 0) {
      stats.isReadyForBulkCollect = false;
      stats.collectStatusDesc = 'Belum ada produk';
    } else if (cPartial || sPartial) {
      stats.isReadyForBulkCollect = false;
      const parts = [];
      if (cPartial) parts.push(`Ayam: ${stats.readyChickens}/${stats.totalChickens}`);
      if (sPartial) parts.push(`Domba: ${stats.readySheep}/${stats.totalSheep}`);
      stats.collectStatusDesc = `Menunggu serentak (${parts.join(', ')})`;
    } else if (cAllReady || sAllReady) {
      stats.isReadyForBulkCollect = true;
      const parts = [];
      if (cAllReady) parts.push(`${stats.readyChickens} telur`);
      if (sAllReady) parts.push(`${stats.readySheep} wol`);
      stats.collectStatusDesc = `Semua ready (${parts.join(', ')})`;
    }

    return stats;
  }
  const getAnimalHungerStats = getAnimalStats;

  function setCooldown(durationMs, reason) {
    const now = Date.now();
    state.cooldownUntil = now + durationMs;
    state.cooldownReason = reason || 'Jeda istirahat';
    console.log(TAG, `[Cooldown] ${state.cooldownReason} (${Math.round(durationMs)} ms)`);
  }

  /* ---------------- Daily Reset & 2x Battle Tracker ---------------- */
  function getDailyTracker(owner) {
    const defaultTracker = {
      day: '',
      battleCount: 0,
      lastBattleAt: 0,
      nextBattleAt: 0,
      restUntil: 0,
      firstPumpkinDone: false
    };
    if (!owner) return defaultTracker;
    try {
      const raw = localStorage.getItem('fs:dailyTracker:' + owner.toLowerCase());
      if (raw) return Object.assign(defaultTracker, JSON.parse(raw));
    } catch (e) {}
    return defaultTracker;
  }

  function saveDailyTracker(owner, tracker) {
    if (!owner || !tracker) return;
    try {
      localStorage.setItem('fs:dailyTracker:' + owner.toLowerCase(), JSON.stringify(tracker));
    } catch (e) {}
  }

  function checkDailyReset(farm, now) {
    if (!farm || !farm.owner) return false;
    const currentDay = farm.today?.day || new Date(now - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    
    if (!state.dailyTracker || !state.dailyTracker.day) {
      state.dailyTracker = getDailyTracker(farm.owner);
    }
    const tracker = state.dailyTracker;

    // Reset harian (Tengah malam 00:00 local time)
    if (tracker.day && tracker.day !== currentDay) {
      console.log(TAG, `[RESET HARIAN DETEKSI] Berganti hari ke ${currentDay}. Mengembalikan tanaman ke Radish & mereset cap...`);
      tracker.day = currentDay;
      tracker.battleCount = 0;
      tracker.lastBattleAt = 0;
      tracker.nextBattleAt = 0;
      tracker.restUntil = now + (5 * 60 * 1000); // Istirahat 5 menit setelah reset
      state.battleCapDone = false;
      state.harvestCapDone = false;
      if (state.battleLoot) { state.battleLoot.isFull = false; state.battleLoot.earned = 0; }
      if (state.harvestLoot) { state.harvestLoot.isFull = false; state.harvestLoot.earned = 0; }
      saveDailyTracker(farm.owner, tracker);
    } else if (!tracker.day) {
      tracker.day = currentDay;
      saveDailyTracker(farm.owner, tracker);
    }

    // Auto-koreksi jika battleCount melonjak tidak wajar (misal akibat spam trigger sebelum patch)
    const earned = (farm.today && typeof farm.today.battleEarned === 'number') ? farm.today.battleEarned : 0;
    const realisticRuns = earned <= 0 ? 0 : Math.max(1, Math.floor((earned + 300) / 600));
    if (tracker.battleCount > realisticRuns) {
      console.log(TAG, `[Auto-Correction] Mengoreksi battleCount yang berlebih (${tracker.battleCount} -> ${realisticRuns}) berdasarkan battleEarned: ${earned}`);
      tracker.battleCount = realisticRuns;
      saveDailyTracker(farm.owner, tracker);
    }

    // Cek apakah sedang masa istirahat 5 menit setelah reset
    if (tracker.restUntil && now < tracker.restUntil) {
      const remSec = Math.ceil((tracker.restUntil - now) / 1000);
      const m = Math.floor(remSec / 60);
      const s = remSec % 60;
      state.stage = 'daily_reset_rest';
      state.currentTask = 'idle';
      state.loopStatus = `☕ Reset Harian Terdeteksi! Istirahat 5 menit (Sisa ${m}m ${s}s)...`;
      return true;
    }

    return false;
  }

  function getReservedBattleEnergy() {
    // Battle dijalankan secara manual (on-demand via tombol) sesuai sisa energy pemain.
    // Tidak ada alokasi energi yang ditahan oleh pattern otomatis farming.
    return 0;
  }

  /* ---------------- 4D. Village Income Auto-Claim & Tracker (1 Jam Sekali, 5 Menit Pertama) ---------------- */
  function checkVillageIncome(farm, now, s) {
    let accumulated = 0;
    let rate = '+27/h';
    let isFull = false;

    // 1. Ekstrak data dari HUD claim tile
    const claimTile = document.querySelector('button[data-action="claim"], button.tile.claim');
    if (claimTile) {
      const bEl = claimTile.querySelector('b');
      if (bEl) {
        const m = bEl.textContent.match(/\+?([\d,]+)/);
        if (m) accumulated = parseInt(m[1].replace(/,/g, ''), 10) || 0;
      }
      const tsEl = claimTile.querySelector('.ts');
      if (tsEl) {
        const txt = tsEl.textContent.trim();
        if (txt.includes('/h')) {
          rate = txt;
        } else if (txt.includes('full')) {
          isFull = true;
        }
      }
      if (claimTile.classList.contains('full')) isFull = true;
    }

    // 2. Persistensi timer per akun (owner)
    // - Pertama kali bot di-running (seperti baru jalan npm start): kasih waktu 5 menit untuk auto-claim pertama
    // - Setelah klaim pertama berhasil dan seterusnya: siklus klaim tiap 60 menit
    const FIRST_CLAIM_DELAY = 5 * 60 * 1000;         // 5 menit
    const RECURRING_CLAIM_INTERVAL = 60 * 60 * 1000; // 60 menit

    const owner = (farm && farm.owner) ? farm.owner.toLowerCase() : 'default';
    const bootId = String(window.__FS_BOOT_TIME__ || state.lastNow || 'default_boot');
    const bootStorageKey = 'fs:bootId:' + owner;
    const sessionNextClaimKey = 'fs:sessionNextClaim:' + owner;
    const lastClaimStorageKey = 'fs:lastPassiveClaim:' + owner;

    let savedBootId = null;
    let nextClaimAt = 0;
    try {
      savedBootId = sessionStorage.getItem(bootStorageKey);
      nextClaimAt = parseInt(sessionStorage.getItem(sessionNextClaimKey) || '0', 10);
    } catch (e) {}

    let lastClaimAt = 0;
    try {
      lastClaimAt = parseInt(localStorage.getItem(lastClaimStorageKey) || '0', 10);
    } catch (e) {}

    // Deteksi jika bot baru dijalankan (fresh npm start atau browser session baru):
    // Jadwalkan auto-claim pertama 5 menit dari sekarang
    if (savedBootId !== bootId || !nextClaimAt) {
      try {
        sessionStorage.setItem(bootStorageKey, bootId);
      } catch (e) {}
      nextClaimAt = now + FIRST_CLAIM_DELAY;
      try {
        sessionStorage.setItem(sessionNextClaimKey, String(nextClaimAt));
      } catch (e) {}
      if (!lastClaimAt) {
        lastClaimAt = now;
        try {
          localStorage.setItem(lastClaimStorageKey, String(now));
        } catch (e) {}
      }
      console.log(TAG, `[INFO] Bot baru dijalankan: Auto-claim Village Income pertama diset 5 menit lagi (${new Date(nextClaimAt).toLocaleTimeString()}). Seterusnya tiap 60 menit.`);
    }

    state.villageIncome = {
      accumulated,
      rate,
      isFull,
      lastClaimAt,
      nextClaimAt
    };

    // 3. Auto-Claim:
    // - Klaim jika waktu sudah mencapai nextClaimAt dan saldo income >= 1
    // - ATAU jika storage full (agar token tidak terbuang sia-sia)
    const timeToClaim = now >= nextClaimAt;
    const readyToClaim = (timeToClaim && accumulated >= 1) || isFull;

    if (state.enabled && state.startupDone && readyToClaim) {
      if (now - (s.__fsLastClaimTryAt || 0) < 15000) return; // Debounce 15 detik
      s.__fsLastClaimTryAt = now;

      console.log(TAG, `[ACTION] Mengklaim Village Income: +${accumulated} SEASON (Rate: ${rate}${isFull ? ', Storage FULL' : ''})...`);
      const ok = triggerGameAction('claim');
      if (ok) {
        lastClaimAt = now;
        nextClaimAt = now + RECURRING_CLAIM_INTERVAL; // 60 menit untuk klaim berikutnya
        try {
          localStorage.setItem(lastClaimStorageKey, String(lastClaimAt));
          sessionStorage.setItem(sessionNextClaimKey, String(nextClaimAt));
        } catch (e) {}
        state.villageIncome.lastClaimAt = lastClaimAt;
        state.villageIncome.nextClaimAt = nextClaimAt;
        state.villageIncome.accumulated = 0;
        state.villageIncome.isFull = false;
        console.log(TAG, `[INFO] Village Income berhasil diklaim (+${accumulated} SEASON masuk ke saldo)! Klaim berikutnya dalam 60 menit (${new Date(nextClaimAt).toLocaleTimeString()}).`);
      }
    }

    // Jika terdeteksi saldo income berkurang drastis di game (klaim manual oleh pemain)
    if (s.__prevVillageAccumulated && s.__prevVillageAccumulated >= 1 && accumulated === 0 && (now - (s.__fsLastClaimTryAt || 0) > 15000)) {
      lastClaimAt = now;
      nextClaimAt = now + RECURRING_CLAIM_INTERVAL;
      try {
        localStorage.setItem(lastClaimStorageKey, String(lastClaimAt));
        sessionStorage.setItem(sessionNextClaimKey, String(nextClaimAt));
      } catch (e) {}
      state.villageIncome.lastClaimAt = lastClaimAt;
      state.villageIncome.nextClaimAt = nextClaimAt;
    }
    s.__prevVillageAccumulated = accumulated;
  }

  function isFieldWorking(scene, worker, fieldId) {
    try {
      if (scene && scene.queued && typeof scene.queued.has === 'function') {
        if (scene.queued.has(`field:${fieldId}`)) return true;
      }
    } catch (e) {}
    if (!worker) return false;
    try {
      if (typeof worker.pending === 'function') {
        const p = worker.pending();
        if (Array.isArray(p) && p.some(j => j && j.fieldId === fieldId)) return true;
      }
      if (Array.isArray(worker.workers)) {
        for (const w of worker.workers) {
          if (w.current && w.current.fieldId === fieldId) return true;
          if (Array.isArray(w.queue) && w.queue.some(j => j && j.fieldId === fieldId)) return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function isAnyFieldWorking(scene, worker) {
    try {
      if (scene && scene.queued && scene.queued.size > 0) {
        for (const k of scene.queued) {
          if (typeof k === 'string' && k.startsWith('field:')) return true;
        }
      }
    } catch (e) {}
    if (!worker) return false;
    try {
      if (typeof worker.pending === 'function') {
        const p = worker.pending();
        if (Array.isArray(p) && p.some(j => j && (j.fieldId !== undefined || j.type === 'plant' || j.type === 'harvest'))) return true;
      }
      if (Array.isArray(worker.workers)) {
        for (const w of worker.workers) {
          if (w.current && (w.current.fieldId !== undefined || w.current.type === 'plant' || w.current.type === 'harvest')) return true;
          if (Array.isArray(w.queue) && w.queue.some(j => j && (j.fieldId !== undefined || j.type === 'plant' || j.type === 'harvest'))) return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function isAnyWorkerBusy(scene, worker) {
    try {
      if (scene && scene.queued && scene.queued.size > 0) return true;
    } catch (e) {}
    if (!worker) return false;
    try {
      if (typeof worker.pending === 'function') {
        const p = worker.pending();
        if (Array.isArray(p) && p.length > 0) return true;
      }
      if (Array.isArray(worker.workers)) {
        for (const w of worker.workers) {
          if (w.current) return true;
          if (Array.isArray(w.queue) && w.queue.length > 0) return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function isJobPending(scene, worker, type, id) {
    try {
      if (scene && scene.queued && typeof scene.queued.has === 'function') {
        const qKey = (type === 'harvest' || type === 'plant') ? `field:${id}` : `${type}:${id}`;
        if (scene.queued.has(qKey)) return true;
      }
    } catch (e) {}
    if (!worker) return false;
    try {
      if (typeof worker.pending === 'function') {
        const p = worker.pending();
        if (Array.isArray(p) && p.some(j => j && j.type === type && (j.fieldId === id || j.animalId === id || j.structureId === id))) return true;
      }
      if (Array.isArray(worker.workers)) {
        for (const w of worker.workers) {
          if (w.current && w.current.type === type && (w.current.fieldId === id || w.current.animalId === id || w.current.structureId === id)) return true;
          if (Array.isArray(w.queue) && w.queue.some(j => j && j.type === type && (j.fieldId === id || j.animalId === id || j.structureId === id))) return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function formatCountdown(ms) {
    if (!ms || ms <= 0 || !Number.isFinite(ms)) return 'Ready!';
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /* ---------------- 6. Grid Scanner & Field Placement ---------------- */
  const STRUCTURE_DIMS = {
    field: { w: 1, h: 1 },
    center: { w: 10, h: 5 },
    coop: { w: 6, h: 6 },
    barn: { w: 7, h: 7 },
    sheepPen: { w: 7, h: 4 },
    pigPen: { w: 7, h: 4 },
    orchard: { w: 9, h: 5 },
    mine: { w: 5, h: 5 },
    oilwell: { w: 5, h: 3 },
    bank: { w: 12, h: 6 },
    silo: { w: 3, h: 3 },
    market: { w: 9, h: 4 },
    pond: { w: 8, h: 5 }
  };

  function overlapsBox(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function isSpotFree(farm, x, y, w = 1, h = 1) {
    const box = { x, y, w, h };
    if (x < 2 || y < 6 || x + w > 58 || y + h > 36) return false;
    if (farm && Array.isArray(farm.structures)) {
      for (const st of farm.structures) {
        const dim = STRUCTURE_DIMS[st.kind] || { w: 1, h: 1 };
        if (overlapsBox(box, { x: st.x, y: st.y, w: dim.w, h: dim.h })) return false;
      }
    }
    if (farm && Array.isArray(farm.fields)) {
      for (const f of farm.fields) {
        if (overlapsBox(box, { x: f.x, y: f.y, w: 1, h: 1 })) return false;
      }
    }
    return true;
  }

  function findNextFieldSpot(farm) {
    // Prefer placing in rows near town hall (center x:25..34, y:16..20)
    const candidateY = [22, 23, 24, 15, 14, 13, 25, 26];
    for (const y of candidateY) {
      for (let x = 25; x <= 34; x++) {
        if (isSpotFree(farm, x, y, 1, 1)) return { x, y };
      }
    }
    for (let y = 6; y <= 35; y++) {
      for (let x = 5; x <= 55; x++) {
        if (isSpotFree(farm, x, y, 1, 1)) return { x, y };
      }
    }
    return null;
  }

  function findBuildingSpot(farm, kind) {
    const dim = STRUCTURE_DIMS[kind] || { w: 6, h: 6 };
    // Official starter defaults from game
    const defaults = {
      coop: { x: 18, y: 17 },
      sheepPen: { x: 16, y: 24 }
    };
    if (defaults[kind] && isSpotFree(farm, defaults[kind].x, defaults[kind].y, dim.w, dim.h)) {
      return defaults[kind];
    }
    // Search grid for free area
    for (let y = 6; y <= 32; y++) {
      for (let x = 4; x <= 50; x++) {
        if (isSpotFree(farm, x, y, dim.w, dim.h)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  function getNextMealTimestamp(now, farm) {
    const time = now || Date.now();
    let tz = -new Date().getTimezoneOffset();
    if (farm && typeof farm === 'object' && Number.isFinite(farm.tz)) {
      tz = Math.round(farm.tz);
    } else if (Number.isFinite(farm)) {
      tz = Math.round(farm);
    }
    const d = new Date(time + tz * 60000);
    const hour = d.getUTCHours();
    if (hour < 12) {
      d.setUTCHours(12, 0, 0, 0);
    } else {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
    }
    return d.getTime() - tz * 60000;
  }

  function getNextMealCountdown(now, farm) {
    const nextAt = getNextMealTimestamp(now, farm);
    const ms = Math.max(0, nextAt - (now || Date.now()));
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${h}h ${m}m`;
  }

  /* ---------------- 7. Farm Tick (Sequence & Daily Caps Master Loop) ---------------- */
  function farmTick(s, force) {
    state.farmTicks++;
    const now = Date.now();

    // Humanized jitter delay: 2.2s - 3.8s randomized intervals
    if (!force) {
      const minWait = s.__fsNextTickDelay || 2500;
      if (now - (s.__fsFarmAt || 0) < minWait) return;
      s.__fsFarmAt = now;
      s.__fsNextTickDelay = Math.floor(2200 + Math.random() * 1600);
    }

    // Freeze completely if Cloudflare Turnstile Human Gate is displayed
    const gateEl = document.getElementById('human-gate');
    if (gateEl && gateEl.offsetParent !== null && !gateEl.hidden) {
      state.loopStatus = '⚠️ CAPTCHA Check Required!';
      return;
    }

    // 0. COOLDOWN / JEDA ISTIRAHAT CHECK (Zero-ms Transition Guard)
    if (now < state.cooldownUntil) {
      const remainingSec = Math.ceil((state.cooldownUntil - now) / 1000);
      state.loopStatus = `⏳ ${state.cooldownReason || 'Jeda istirahat'} (${remainingSec}s)...`;
      return;
    }

    if (!state.farmData) tryFallbackFarmData();
    const farm = state.farmData;
    if (!farm || !Array.isArray(farm.fields)) {
      state.loopStatus = 'Menunggu data desa terhubung...';
      return;
    }

    // Pastikan status battle dinormalkan saat berada di scene farm
    if (state.stage === 'battle' || state.currentTask === 'battling') {
      state.stage = 'farm';
      state.currentTask = 'idle';
      state.battleWave = 0;
    }
    const worker = s.worker;
    const gameNow = state.lastNow || now;
    const energy = farm && farm.today ? (farm.today.energy ?? 0) : 99;

    // 0. Cek Reset Harian (00:00 midnight local time) - Istirahat 5 menit setelah reset
    if (checkDailyReset(farm, now)) return;

    // Live Metrics
    const bInfo = getBattleLootInfo(farm);
    const hInfo = getHarvestLootInfo(farm);
    syncTokens(farm);
    syncSiloInfo(farm);

    // Cek Village Income & Auto-Claim (Tiap 1 Jam atau jika storage penuh)
    checkVillageIncome(farm, now, s);

    // Parse fields
    const maxFields = (farm && farm.level ? Math.min(30, farm.level * 6) : 6);
    let readyFields = [];
    let emptyFields = [];
    let growingFields = [];
    let buildingFields = [];
    let minRemaining = Infinity;
    let maxRemaining = 0;
    let nextCrop = '';

    if (farm && Array.isArray(farm.fields)) {
      state.counts.total = farm.fields.length;
      for (const f of farm.fields) {
        const isBuilt = !f.buildUntil || gameNow >= f.buildUntil;
        if (!isBuilt) {
          buildingFields.push(f);
          continue;
        }

        if (!f.crop) {
          emptyFields.push(f);
        } else {
          const cropDef = CROPS_MAP[f.crop];
          const duration = cropDef ? cropDef.minutes * 60000 : 30 * 60000;
          const elapsed = gameNow - (f.plantedAt || 0);
          if (elapsed >= duration) {
            readyFields.push(f);
          } else {
            growingFields.push(f);
            const rem = duration - elapsed;
            if (rem < minRemaining) {
              minRemaining = rem;
              nextCrop = cropDef ? cropDef.name : f.crop;
            }
            if (rem > maxRemaining) {
              maxRemaining = rem;
            }
          }
        }
      }
      state.counts.ready = readyFields.length;
      state.counts.growing = growingFields.length;
      state.counts.empty = emptyFields.length;
      state.nextHarvestMs = minRemaining < Infinity ? minRemaining : null;
      state.nextHarvestCrop = nextCrop;

      // Update dedicated Next Harvest timer text
      if (readyFields.length > 0) {
        state.nextHarvestText = `🌾 ${readyFields.length} Ready to Harvest!`;
      } else if (growingFields.length > 0) {
        state.nextHarvestText = `${nextCrop || 'Radish'} in ${formatCountdown(minRemaining)}`;
      } else if (emptyFields.length === farm.fields.length && farm.fields.length > 0) {
        state.nextHarvestText = 'All fields empty';
      } else {
        state.nextHarvestText = '-';
      }
    }

    // Parse animals status
    let hungryCount = 0;
    let readyProductCount = 0;
    let nextMealStr = '-';
    let aStats = { totalAnimals: 0, totalHungry: 0, productsReady: 0, isReadyForBulkFeed: false, isReadyForBulkCollect: false, collectStatusDesc: '' };

    if (farm && Array.isArray(farm.animals)) {
      aStats = getAnimalStats(farm, gameNow);
      hungryCount = aStats.totalHungry;
      readyProductCount = aStats.productsReady;
      nextMealStr = hungryCount > 0 ? (aStats.isReadyForBulkFeed ? 'Makan Sekarang!' : 'Menunggu Serentak') : aStats.nextMeal;

      state.animals = {
        total: aStats.totalAnimals,
        hungry: aStats.totalHungry,
        products: aStats.productsReady,
        productsReady: aStats.productsReady,
        isReadyForBulkCollect: aStats.isReadyForBulkCollect,
        collectStatusDesc: aStats.collectStatusDesc,
        nextMeal: nextMealStr,
        nextMealAt: aStats.nextMealAt,
        chickens: `${aStats.hungryChickens}/${aStats.totalChickens}`,
        sheep: `${aStats.hungrySheep}/${aStats.totalSheep}`,
        readyChickens: aStats.readyChickens,
        readySheep: aStats.readySheep,
        isReadyForBulkFeed: aStats.isReadyForBulkFeed
      };
    }

    if (!state.enabled || !state.startupDone) {
      if (!state.startupDone) {
        const rem = Math.max(0, Math.ceil((state.startupCooldownUntil - now) / 1000));
        const remStr = rem >= 60 ? `${Math.floor(rem / 60)}m ${rem % 60}s` : `${rem}s`;
        state.loopStatus = rem > 0 ? `⏳ Standby (Sinkronisasi server ${remStr})...` : '⏳ Menunggu data server (/api/farm)...';
      } else {
        state.loopStatus = 'Bot OFF';
      }
      return;
    }

    // =============================================================
    // 1. CEK STATUS TASK YANG SEDANG BERJALAN (EXCLUSIVE TASK LOCK)
    // Selesaikan pekerjaan yang sedang berjalan sampai 100% tuntas!
    // Dilarang berpindah aksi atau memulai task lain di tengah jalan!
    // =============================================================
    const actionElapsed = now - (state.lastTaskActionAt || 0);
    const totalTaskElapsed = now - (state.taskStartedAt || state.lastTaskActionAt || now);

    // 1A. JIKA SEDANG PANEN (HARVESTING)
    if (state.currentTask === 'harvesting') {
      const isWorking = isAnyFieldWorking(s, worker);

      // Hard guard 1: Jika energi habis (< 2) atau harvest cap sudah penuh, batalkan task lock!
      if (energy < 2 || hInfo.isFull) {
        console.log(TAG, `[Watchdog Panen] Energi (${energy}) tidak cukup atau Harvest Cap (${hInfo.earned}/${hInfo.cap}) penuh. Melepas task lock.`);
        state.currentTask = 'idle';
        state.taskStartedAt = 0;
        return;
      }

      // Hard guard 2: Watchdog Timeout Total (12 detik).
      if (totalTaskElapsed > 12000) {
        console.log(TAG, `[Watchdog Panen] Timeout task harvesting (${Math.round(totalTaskElapsed / 1000)}s). Melepas lock.`);
        state.currentTask = 'idle';
        state.taskStartedAt = 0;
        return;
      }

      // Jika masih ada field yang ready:
      if (readyFields.length > 0) {
        // Watchdog Retry: Jika worker sudah diam dan sudah lewat 3.5 detik sejak aksi terakhir:
        if (!isWorking && actionElapsed > 3500) {
          console.log(TAG, `[Watchdog Panen] Memicu ulang harvest-all untuk sisa ${readyFields.length} ladang siap panen...`);
          state.lastTaskActionAt = now;
          triggerGameAction('harvest-all');
        }
        state.loopStatus = `🌾 Sedang memanen ladang (${emptyFields.length}/${maxFields} selesai)...`;
        return;
      }

      // Jika readyFields sudah 0, tunggu worker selesai animasi jika masih berjalan
      if (isWorking || actionElapsed < 1500) {
        state.loopStatus = `🌾 Menyelesaikan panen ladang (${emptyFields.length}/${maxFields})...`;
        return;
      }

      // Panen 100% tuntas!
      console.log(TAG, 'Harvest all completed! Cooling down before next task...');
      state.currentTask = 'idle';
      state.taskStartedAt = 0;
      setCooldown(3500 + Math.floor(Math.random() * 2000), '🌾 Panen tuntas (semua petak)! Jeda');
      state.loopStatus = '🌾 Panen tuntas (semua petak)! Jeda sejenak...';
      return;
    }

    // 1B. JIKA SEDANG MENANAM (PLANTING)
    if (state.currentTask === 'planting') {
      const isWorking = isAnyFieldWorking(s, worker);

      // Hard guard 1: Jika energi habis (< 2), batalkan task lock!
      if (energy < 2) {
        console.log(TAG, `[Watchdog Tanam] Energi (${energy}) tidak mencukupi untuk menanam. Melepas task lock.`);
        state.currentTask = 'idle';
        state.taskStartedAt = 0;
        return;
      }

      // Hard guard 2: Watchdog Timeout Total (12 detik).
      if (totalTaskElapsed > 12000) {
        console.log(TAG, `[Watchdog Tanam] Timeout task planting (${Math.round(totalTaskElapsed / 1000)}s). Melepas lock.`);
        state.currentTask = 'idle';
        state.taskStartedAt = 0;
        return;
      }

      // Jika masih ada field yang kosong:
      if (emptyFields.length > 0) {
        if (!isWorking && actionElapsed > 3500) {
          const cropToPlant = getNextCropToPlant(farm);
          console.log(TAG, `[Watchdog Tanam] Memicu ulang plant-all (${cropToPlant}) untuk sisa ${emptyFields.length} ladang kosong...`);
          state.lastTaskActionAt = now;
          triggerGameAction('plant-all', cropToPlant);
        }
        state.loopStatus = `🌱 Sedang menanam (${growingFields.length}/${maxFields} tertanam)...`;
        return;
      }

      if (isWorking || actionElapsed < 1500) {
        state.loopStatus = `🌱 Menyelesaikan penanaman (${growingFields.length}/${maxFields})...`;
        return;
      }

      // Tanam 100% tuntas!
      console.log(TAG, 'Plant all completed! Cooling down before next task...');
      state.currentTask = 'idle';
      state.taskStartedAt = 0;
      setCooldown(3500 + Math.floor(Math.random() * 2000), '🌱 Tanam tuntas (semua petak)! Jeda');
      state.loopStatus = '🌱 Tanam tuntas (semua petak)! Jeda sejenak...';
      return;
    }

    // 1C. JIKA SEDANG MENGURUS HEWAN (FEEDING / COLLECTING)
    if (state.currentTask === 'feeding' || state.currentTask === 'collecting') {
      // Hard guard: Watchdog Timeout Total (12 detik)
      if (totalTaskElapsed > 12000) {
        console.log(TAG, `[Watchdog Hewan] Timeout task ${state.currentTask} (${Math.round(totalTaskElapsed / 1000)}s). Melepas lock.`);
        state.currentTask = 'idle';
        state.taskStartedAt = 0;
        return;
      }

      const animalStillActive = isAnyWorkerBusy(s, worker) || actionElapsed < 2500;
      if (animalStillActive) {
        state.loopStatus = state.currentTask === 'feeding' 
          ? '🍖 Sedang memberi makan hewan...' 
          : '🧺 Sedang mengambil produk hewan...';
        return; // KUNCI! Dilarang task lain!
      }
      // Urusan hewan tuntas!
      console.log(TAG, 'Animal task completed! Cooling down...');
      const finishedTask = state.currentTask;
      state.currentTask = 'idle';
      state.taskStartedAt = 0;
      setCooldown(3000 + Math.floor(Math.random() * 1500), finishedTask === 'feeding' ? '🍖 Selesai beri makan' : '🧺 Selesai ambil produk');
      state.loopStatus = '🐔 Urusan hewan tuntas! Jeda sejenak...';
      return;
    }

    // 2. KONDISI IDLE: PASTIKAN TIDAK ADA PEKERJA YANG MASIH BERJALAN DI LATAR BELAKANG
    if (isAnyWorkerBusy(s, worker)) {
      state.loopStatus = '🚜 Petani sedang menyelesaikan pekerjaan...';
      return;
    }

    // =============================================================
    // TAHAP 0: AKUN BARU / BANGUN COOP & SHEEP PEN (LEVEL 1 STARTER)
    // =============================================================
    const hasCoop = farm && Array.isArray(farm.structures) && farm.structures.some(st => st.kind === 'coop');
    const hasSheep = farm && Array.isArray(farm.structures) && farm.structures.some(st => st.kind === 'sheepPen');

    if (farm && (!hasCoop || !hasSheep)) {
      state.stage = 'build_animals';
      const waitBuild = 1800 + Math.floor(Math.random() * 1200);
      if (now - (s.__fsLastStructureBuild || 0) > waitBuild) {
        s.__fsLastStructureBuild = now;

        if (!hasCoop) {
          const spot = findBuildingSpot(farm, 'coop');
          if (spot) {
            state.loopStatus = `🐔 Menaruh Coop di (${spot.x}, ${spot.y})...`;
            console.log(TAG, `Building Coop at (${spot.x}, ${spot.y})`);
            if (typeof s.buyAt === 'function') {
              s.buyAt('coop', spot.x, spot.y);
            } else {
              triggerGameAction('place', 'coop');
            }
            state.farmJobs++;
            s.__fsAnimalsBuiltAt = now;
            setCooldown(2500, '🐔 Pasang Coop');
            return;
          }
        }

        if (!hasSheep) {
          const spot = findBuildingSpot(farm, 'sheepPen');
          if (spot) {
            state.loopStatus = `🐑 Menaruh Sheep Pen di (${spot.x}, ${spot.y})...`;
            console.log(TAG, `Building Sheep Pen at (${spot.x}, ${spot.y})`);
            if (typeof s.buyAt === 'function') {
              s.buyAt('sheepPen', spot.x, spot.y);
            } else {
              triggerGameAction('place', 'sheepPen');
            }
            state.farmJobs++;
            s.__fsAnimalsBuiltAt = now;
            setCooldown(2500, '🐑 Pasang Sheep Pen');
            return;
          }
        }
      }
      return;
    }

    // =============================================================
    // TAHAP 1: AKUN BARU / PASTIKAN SEMUA FIELD (6 DI LV 1) TERPASANG & SELESAI DIBANGUN
    // DILARANG KERAS MENANAM, MEMANEN, ATAU BATTLE SEBELUM 6 PETAK TUNTAS 100%!
    // =============================================================
    const isFieldsComplete = farm && Array.isArray(farm.fields) && farm.fields.length >= maxFields && buildingFields.length === 0;

    if (!isFieldsComplete) {
      state.stage = 'build_fields';

      // 1A. Jika petak masih kurang dari maxFields (misal baru ada 0-5 petak di Level 1):
      if (farm && Array.isArray(farm.fields) && farm.fields.length < maxFields) {
        const currentCount = farm.fields.length;
        state.loopStatus = `🌱 Membangun Field (${currentCount}/${maxFields})...`;

        const waitBuild = 1500 + Math.floor(Math.random() * 800);
        if (now - (s.__fsLastFieldBuild || 0) > waitBuild) {
          s.__fsLastFieldBuild = now;
          const spot = findNextFieldSpot(farm);
          if (spot) {
            console.log(TAG, `Placing field #${currentCount + 1} at (${spot.x}, ${spot.y})`);
            if (typeof s.buyAt === 'function') {
              s.buyAt('field', spot.x, spot.y);
            } else {
              triggerGameAction('place', 'field');
            }
            state.farmJobs++;
            setCooldown(2200, `🌱 Pasang Field #${currentCount + 1}`);
          }
        }
        return; // WAJIB RETURN! Dilarang menanam atau battle sampai ke-6 petak terpasang!
      }

      // 1B. Jika ke-6 petak sudah ditaruh tapi ada yang masih dalam proses konstruksi:
      if (buildingFields.length > 0) {
        state.stage = 'building_fields';
        state.loopStatus = `🌱 Menunggu konstruksi ${buildingFields.length} field selesai...`;
        return; // WAJIB RETURN! Tunggu sampai seluruh 6 ladang selesai 100%!
      }

      return; // WAJIB RETURN!
    }

    // Tepat saat ke-6 ladang baru pertama kali selesai 100%, beri jeda istirahat sebelum tanam serentak
    if (!state.allFieldsBuiltNotified && farm.fields.length >= maxFields && buildingFields.length === 0 && growingFields.length === 0) {
      state.allFieldsBuiltNotified = true;
      const initialSeed = isFirstPumpkin(farm) ? 'Pumpkin' : 'Radish';
      console.log(TAG, `All ${maxFields} fields are fully placed and built! Preparing initial bulk plant (${initialSeed})...`);
      setCooldown(3500 + Math.floor(Math.random() * 1500), `🌱 Semua ${maxFields} petak tuntas dibangun! Bersiap tanam serentak ${initialSeed}`);
      state.loopStatus = `🌱 Semua ${maxFields} petak tuntas dibangun! Jeda sejenak (${initialSeed})...`;
      return;
    }

    // =============================================================
    // TAHAP 2: SMART BULK HARVEST (SINKRONISASI PANEN HEMAT ENERGY)
    // Syarat Panen:
    // 1. Ada tanaman yang siap panen (unworkedReady.length > 0)
    // 2. SINKRONISASI: Jika masih ada ladang yang sedang tumbuh, cek sisa waktu matangnya (maxRemaining).
    //    Jika seluruh ladang yang tumbuh akan matang dalam waktu dekat (<= 3 menit / 180 detik),
    //    TAHAN panen dan tunggu agar SEMUA petak matang bersamaan!
    //    Dengan begitu, 1x Harvest all memanen seluruh petak sekaligus hanya dengan 2 energy!
    // 3. Cadangan energi battle tetap terjaga (kecuali battle cap sudah penuh).
    // =============================================================
    const reservedBattleEnergy = getReservedBattleEnergy();
    const unworkedReady = readyFields.filter(f => !isFieldWorking(s, worker, f.id));
    if (unworkedReady.length > 0) {
      // Sinkronisasi: jika ada tanaman yang sedang tumbuh dan akan matang dalam <= 3 menit, tunggu!
      if (growingFields.length > 0 && maxRemaining <= 180000) {
        state.loopStatus = `🌾 Menunggu ${growingFields.length} petak matang (${formatCountdown(maxRemaining)}) agar panen serentak (hemat 2 energy)...`;
        return;
      }

      if (energy >= 2 && (energy - 2 >= reservedBattleEnergy || hInfo.isFull)) {
        state.stage = 'harvest';
        state.currentTask = 'harvesting';
        state.taskStartedAt = now;
        state.lastTaskActionAt = now;
        s.__fsLastBulkHarvest = now;
        state.loopStatus = `🌾 Memulai Panen Serentak (${unworkedReady.length}/${farm.fields.length} ladang)... [Harvest: ${hInfo.earned}/${hInfo.cap}]`;
        console.log(TAG, `Initiating bulk harvest on ${unworkedReady.length} fields (2 energy)...`);
        if (triggerGameAction('harvest-all')) {
          state.farmJobs++;
          if (farm && farm.owner && readyFields.some(f => f.crop === 'pumpkin')) {
            markFirstPumpkinDone(farm.owner);
          }
        }
        return;
      }
    }

    // =============================================================
    // TAHAP 3: SMART BULK PLANT (SINKRONISASI TANAM HEMAT ENERGY)
    // SYARAT MUTLAK:
    // 1. Semua ladang (6 max di Lv 1) sudah terpasang dan selesai dibangun
    // 2. Tidak ada tanaman siap panen (readyFields.length === 0)
    // 3. Petani tidak sedang bekerja (!isAnyWorkerBusy)
    // 4. SINKRONISASI TANAM HEMAT ENERGY:
    //    DILARANG menanam sebagian petak jika petak lain masih sedang tumbuh!
    //    Tunggu sampai petak yang tumbuh dipanen, sehingga SELURUH petak kosong
    //    bersamaan (emptyFields.length === farm.fields.length).
    //    Dengan begitu, 1x Plant all menanam SEMUA petak dengan detik yang sama persis!
    // 5. Energi cukup di atas cadangan Battle (kecuali battle cap sudah full)
    // =============================================================
    const isHarvestCapDone = state.harvestCapDone || hInfo.isFull;
    const reservedAnimalEnergy = isHarvestCapDone ? getAnimalDailyEnergyReserve(farm, now) : 0;

    if (emptyFields.length > 0 && readyFields.length === 0) {
      if (energy >= 2 && (energy - 2 >= reservedBattleEnergy || bInfo.isFull)) {
        // Tahan jika harvest cap sudah penuh dan sisa energy harus dicadangkan untuk pakan hewan seharian (2x feed)
        if (isHarvestCapDone && (energy - 2 < reservedAnimalEnergy)) {
          state.loopStatus = `🌾 Harvest Cap Penuh. Menyimpan ${energy}⚡ (cadangan aman makan hewan: ${reservedAnimalEnergy}⚡)...`;
          return;
        }

        // Hard guard: jika jumlah petak belum mencapai maxFields atau ada yang masih dibangun
        if (farm.fields.length < maxFields || buildingFields.length > 0) {
          state.loopStatus = `🌱 Menunggu kelengkapan ${maxFields} petak (${farm.fields.length}/${maxFields})...`;
          return;
        }

        // Sinkronisasi: Jika masih ada petak yang tumbuh dan akan panen dalam siklus wajar (<= 30 menit),
        // JANGAN tanam sebagian! Tunggu petak tersebut matang & dipanen agar bisa tanam serentak 100%!
        if (growingFields.length > 0 && minRemaining <= 1800000) {
          state.loopStatus = `🌱 Menunggu ${growingFields.length} petak panen (${formatCountdown(minRemaining)}) agar tanam serentak ${maxFields} petak (hemat 2 energy)...`;
          return;
        }

        // Jika belum ada yang tumbuh atau seluruh petak sudah kosong lengkap bersamaan:
        const cropToPlant = getNextCropToPlant(farm);
        const isStarterPumpkin = cropToPlant === 'pumpkin';
        state.stage = 'plant';
        state.currentTask = 'planting';
        state.taskStartedAt = now;
        state.lastTaskActionAt = now;
        s.__fsLastBulkPlant = now;
        const cropUpper = cropToPlant.toUpperCase();
        const modeDesc = isHarvestCapDone ? ` [Cap Full → Silo ${cropUpper}]` : '';
        state.loopStatus = isStarterPumpkin
          ? `🎃 Memulai Tanam Pumpkin Serentak (Akun Baru - Instant Panen) (${emptyFields.length}/${maxFields} ladang)...`
          : `🌱 Memulai Tanam ${cropUpper} Serentak (${emptyFields.length}/${maxFields} ladang)...${modeDesc}`;
        console.log(TAG, `Initiating bulk plant with ${cropToPlant} on ${emptyFields.length} empty fields (2 energy)...`);
        if (triggerGameAction('plant-all', cropToPlant)) {
          state.farmJobs++;
          if (isStarterPumpkin) {
            markFirstPumpkinDone(farm.owner);
          }
        }
        return;
      }
    }

    // =============================================================
    // TAHAP 4: URUS HEWAN (AMBIL PRODUK & FEED)
    // HANYA ketika ladang tenang (tidak ada yang perlu dipanen atau ditanam)
    // =============================================================
    if (readyFields.length === 0 && emptyFields.length === 0 && farm && Array.isArray(farm.animals)) {
      // 4A. Ambil produk hewan (HANYA jika serentak 100% ready agar hemat 2 Energy)
      if (aStats.productsReady > 0) {
        if (!aStats.isReadyForBulkCollect) {
          state.loopStatus = `🧺 Menunggu hasil ternak serentak (${aStats.collectStatusDesc}) agar hemat 2 ⚡...`;
        } else if (energy >= 2) {
          const collectWait = 25000 + Math.floor(Math.random() * 10000);
          if (now - (s.__fsLastCollectAt || 0) > collectWait) {
            s.__fsLastCollectAt = now;
            state.currentTask = 'collecting';
            state.taskStartedAt = now;
            state.lastTaskActionAt = now;
            state.loopStatus = `🧺 Mengambil serentak ${aStats.productsReady} produk hewan (${aStats.collectStatusDesc})...`;
            console.log(TAG, `[Animal Products] Collecting all ${aStats.productsReady} products (${aStats.collectStatusDesc}) for 2 energy...`);
            if (triggerGameAction('collect-all')) {
              state.farmJobs++;
            }
            return;
          }
        }
      }

      // 4B. Beri makan jika hungry (hanya 2x sehari pada jam 00-12 dan 12-24)
      // SYARAT PEMBERIAN MAKAN HEMAT ENERGY (2 Energy per Building):
      // 1. Bukan masa jeda setelah Coop / Sheep Pen baru dibangun (jeda 5 menit agar status lapar tersinkronisasi)
      // 2. SINKRONISASI SERENTAK (WAJIB):
      //    - Semua ayam di coop harus lapar bersamaan (hungryChickens === totalChickens)
      //    - Semua domba di sheep pen harus lapar bersamaan (hungrySheep === totalSheep)
      //    - DILARANG feed jika hanya sebagian hewan yang lapar agar tidak membuang 2 energy berkali-kali!
      if (aStats.totalHungry > 0) {
        // Cek jeda sinkronisasi hewan baru dibangun (5 menit / 300 detik)
        const newestBoughtAge = Array.isArray(farm.animals) && farm.animals.length > 0
          ? Math.min(...farm.animals.map(a => now - (a.boughtAt || 0)))
          : Infinity;
        const recentlyBuilt = (s.__fsAnimalsBuiltAt && (now - s.__fsAnimalsBuiltAt < 300000)) ||
                              (newestBoughtAge < 300000);
        if (recentlyBuilt) {
          const elapsed = Math.min(now - (s.__fsAnimalsBuiltAt || now), newestBoughtAge);
          const remSec = Math.max(1, Math.ceil((300000 - elapsed) / 1000));
          state.loopStatus = `🐔 Coop & Sheep Pen baru dibangun. Menunggu ${remSec}s agar lapar serentak...`;
          return;
        }

        // Tahan jika hewan belum serentak lapar di gedungnya masing-masing
        if (!aStats.isReadyForBulkFeed) {
          const cPart = aStats.totalChickens > 0 ? `Ayam: ${aStats.hungryChickens}/${aStats.totalChickens}` : '';
          const sPart = aStats.totalSheep > 0 ? `Domba: ${aStats.hungrySheep}/${aStats.totalSheep}` : '';
          const detail = [cPart, sPart].filter(Boolean).join(' | ');
          state.loopStatus = `🍗 Menunggu SEMUA hewan serentak lapar (${detail}) agar 1x feed hemat 2 energy...`;
          return;
        }

        // SEMUA hewan di building yang lapar sudah 100% serentak!
        if (energy >= 2) {
          const feedWait = 25000 + Math.floor(Math.random() * 10000);
          if (now - (s.__fsLastFeedAt || 0) > feedWait) {
            s.__fsLastFeedAt = now;
            state.currentTask = 'feeding';
            state.taskStartedAt = now;
            state.lastTaskActionAt = now;
            const cInfo = aStats.totalChickens > 0 ? `${aStats.hungryChickens} ayam` : '';
            const sInfo = aStats.totalSheep > 0 ? `${aStats.hungrySheep} domba` : '';
            const desc = [cInfo, sInfo].filter(Boolean).join(', ');
            state.loopStatus = `🍖 Memberi makan serentak ${aStats.totalHungry} hewan (${desc})...`;
            console.log(TAG, `Feeding all ${aStats.totalHungry} animals simultaneously (2 energy per building)...`);
            if (triggerGameAction('feed-all')) {
              state.farmJobs++;
            }
            return;
          }
        } else if (energy < 2 && (farm.tokens || 0) >= 10) {
          // Beli 10 energy otomatis jika energi habis dan ada hewan lapar serentak
          state.loopStatus = `⚡ Auto-Buy 10 Energy untuk beri makan hewan serentak...`;
          console.log(TAG, 'Auto-buying 10 energy with tokens for animal feeding...');
          triggerGameAction('energy', 10);
          setCooldown(3500, '⚡ Beli Energy Selesai');
          return;
        }
      }
    }

    // =============================================================
    // TAHAP 4C: AUTO-MIX SILO FEED BAGS (0 ENERGY, 0 TOKEN)
    // Jika ada gandum & jagung (min >= 1), langsung mix jadi Feed Bags
    // =============================================================
    if (farm && farm.silo) {
      const w = farm.silo.wheat || 0;
      const c = farm.silo.corn || 0;
      if (Math.min(w, c) >= 1) {
        if (now - (s.__fsLastAutoMixAt || 0) > 20000) {
          s.__fsLastAutoMixAt = now;
          console.log(TAG, `[Silo Auto-Mix] Mencampur ${Math.min(w, c)} wheat & corn menjadi feed bags (0 energy)...`);
          triggerGameAction('make-feed', 'max');
        }
      }
    }

    // =============================================================
    // TAHAP 5: BATTLE MANUAL (ON-DEMAND VIA TOMBOL DASHBOARD / GM UI)
    // Sesuai Instruksi User:
    // Battle TIDAK MASUK alur loop otomatis farming!
    // Pemain bebas menentukan kapan ingin battle menggunakan tombol sesuai sisa energy.
    // =============================================================
    const harvestDone = hInfo.isFull || state.harvestCapDone;
    const isManualRequested = state.manualBattleRequested || window.__FS_MANUAL_BATTLE_REQUESTED__;

    if (isManualRequested) {
      state.manualBattleRequested = false;
      window.__FS_MANUAL_BATTLE_REQUESTED__ = false;
      if (energy >= 5) {
        state.stage = 'battle';
        state.currentTask = 'battling';
        state.loopStatus = `⚔️ Memulai Battle Manual via Tombol (Loot: ${bInfo.earned}/${bInfo.cap})...`;
        console.log(TAG, `Manual Battle triggered by user (Energy: ${energy}). Entering arena...`);
        setCooldown(3500, '⚔️ Memasuki Battle Arena');
        triggerGameAction('go-battle');
        return;
      } else {
        state.loopStatus = `⚡ Butuh minimal 5 energy untuk battle (saat ini: ${energy}). Menunggu...`;
      }
    }

    // =============================================================
    // TAHAP 6: STANDBY & MONITORING
    // =============================================================
    if (bInfo.isFull && hInfo.isFull) {
      state.stage = 'all_caps_full';
      state.loopStatus = `🎉 ALL CAPS FULL! (${hInfo.cap}/${hInfo.cap} 🌾 | ${bInfo.cap}/${bInfo.cap} ⚔️)`;
      return;
    }

    if (growingFields.length > 0) {
      state.stage = 'growing';
      state.currentTask = 'idle';
      state.battleWave = 0;
      let bDesc = '';
      if (!harvestDone) {
        bDesc = `🌾 Grinding Harvest (${hInfo.earned}/${hInfo.cap})`;
      } else if (bInfo.isFull) {
        bDesc = '⚔️ Battle Cap Full';
      } else {
        bDesc = `⚔️ Battle Ready (Tombol Dashboard)`;
      }
      const aDesc = hungryCount > 0 ? `🍖 ${hungryCount} Lapar` : `🐾 Hewan OK`;
      state.loopStatus = `🌱 Tumbuh (${growingFields.length}/${maxFields}) | ${bDesc} | ${aDesc}`;
    } else if (harvestDone) {
      state.stage = 'harvest_done';
      state.currentTask = 'idle';
      state.battleWave = 0;
      state.loopStatus = `🌾 Harvest Cap Full (${hInfo.cap}/${hInfo.cap})! Standby di Ladang (Siap Battle via Tombol | Energy: ${energy})`;
    } else if (energy < 2) {
      state.stage = 'low_energy';
      state.currentTask = 'idle';
      state.battleWave = 0;
      state.loopStatus = `⚡ Low Energy (${energy}) | Standby`;
    } else {
      state.stage = 'farm';
      state.currentTask = 'idle';
      state.battleWave = 0;
      state.loopStatus = `Standby di Ladang (Loop Aktif)`;
    }
  }

  /* ---------------- 7. Scene Hooking ---------------- */
  function hookScene(s) {
    if (!s || s.__fsScene || !s.events) return;
    s.__fsScene = true;

    const captureFarm = (farm, now) => {
      if (farm && typeof farm === 'object' && Array.isArray(farm.fields)) {
        state.farmData = farm;
        if (now) state.lastNow = now;
      }
    };

    // Capture live farm data via syncFields, syncStructures, syncAnimals hooks
    if (s.syncFields && !s.__fsSyncFieldsHooked) {
      s.__fsSyncFieldsHooked = true;
      const origSyncFields = s.syncFields;
      s.syncFields = function fsSyncFields(farm, now) {
        captureFarm(farm, now);
        return origSyncFields.apply(this, arguments);
      };
    }

    if (s.syncStructures && !s.__fsSyncStructuresHooked) {
      s.__fsSyncStructuresHooked = true;
      const origSyncStructures = s.syncStructures;
      s.syncStructures = function fsSyncStructures(farm, now) {
        captureFarm(farm, now);
        return origSyncStructures.apply(this, arguments);
      };
    }

    if (s.syncAnimals && !s.__fsSyncAnimalsHooked) {
      s.__fsSyncAnimalsHooked = true;
      const origSyncAnimals = s.syncAnimals;
      s.syncAnimals = function fsSyncAnimals(farm, now) {
        captureFarm(farm, now);
        return origSyncAnimals.apply(this, arguments);
      };
    }

    if (s.refresh && !s.__fsRefreshHooked) {
      s.__fsRefreshHooked = true;
      const origRefresh = s.refresh;
      s.refresh = function fsRefresh() {
        const res = origRefresh.apply(this, arguments);
        if (!state.farmData) tryFallbackFarmData();
        return res;
      };
    }

    s.events.on('update', function fsTick() {
      const key = this.sys && this.sys.settings && this.sys.settings.key;
      if (key === 'battle') battleTick(this);
      else if (key === 'farm') farmTick(this);
    }, s);

    const origMove = s.moveInput;
    if (typeof origMove === 'function') {
      s.moveInput = function fsMove() {
        if (state.enabled && state.cfg.autoPlay && this.__fsBot) return this.__fsBot;
        return origMove.call(this);
      };
    }

    const origDrop = s.dropLoot;
    if (typeof origDrop === 'function') {
      s.dropLoot = function fsDrop(en) {
        // Multiplier loot dikunci selalu 1x untuk mencegah auto-flag server:
        // "Your battles claimed far more loot than the time you spent fighting (Ditinjau Dev)"
        const m = 1;
        if (m === 1 || !en) return origDrop.call(this, en);
        const sh = Object.create(en);
        sh.loot = (en.loot || 0) * m;
        return origDrop.call(this, sh);
      };
    }

    if (s.endRun && !s.__fsEndRunHooked) {
      s.__fsEndRunHooked = true;
      const origEndRun = s.endRun;
      s.endRun = function fsEndRun(died, ...args) {
        if (this.run) {
          // Safety guard: Pastikan hits dan dodges realistis dan tidak pernah 0
          const waveNum = this.wave || 1;
          if (typeof this.run.hits !== 'number' || this.run.hits < 5) {
            this.run.hits = Math.max(this.run.hits || 0, Math.floor(waveNum * 2.8 + Math.random() * 4));
          }
          if (typeof this.run.dodges !== 'number' || this.run.dodges < 2) {
            this.run.dodges = Math.max(this.run.dodges || 0, Math.floor(waveNum * 0.9 + Math.random() * 3));
          }
          console.log(TAG, `[Battle EndRun] Wave: ${waveNum}, Kills: ${this.run.kills}, Loot: ${this.run.loot}, Durasi: ${this.run.seconds}s, Mati: ${died ? 'YA (Natural)' : 'TIDAK'}, Hits: ${this.run.hits}, Dodges: ${this.run.dodges}`);
        }
        return origEndRun.call(this, died, ...args);
      };
    }
    console.log(TAG, 'Scene hooked:', s.sys && s.sys.settings && s.sys.settings.key);
  }

  /* ---------------- 8. Game Scanner ---------------- */
  function scan() {
    for (const g of games) {
      let scenes = [];
      try { scenes = (g.scene && g.scene.scenes) || []; } catch (e) { continue; }
      for (const s of scenes) {
        try {
          if (!s || !s.sys) continue;
          const key = s.sys.settings && s.sys.settings.key;
          if (key === 'farm' || key === 'battle') hookScene(s);
          if (s.hero) { patchHero(s.hero); if (key === 'battle') hookScene(s); }
          if (s.enemies && s.enemies.length) patchEnemy(s.enemies[0]);
        } catch (e) {}
      }
    }
  }

  /* ---------------- 9. UI Building & Styling ---------------- */
  let root = null, panel = null;
  const CYCLES = { dmg: [1, 2, 5, 10, 25], spd: [1, 1.5, 2, 3, 5], loot: [1] };

  function buildUI() {
    if (!document.body || root) return;
    root = document.createElement('div');
    root.id = '__fs_gm';
    root.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;font:600 11px/1.4 ui-monospace,Menlo,monospace;user-select:none';

    const badge = document.createElement('div');
    badge.id = '__fs_gm_badge';
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.6);opacity:.95;transition:all .2s';
    badge.onclick = () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      saveSettings();
      paint();
    };

    panel = document.createElement('div');
    // Open by default on initial load, or restore user preference from localStorage
    panel.style.cssText = 'display:' + (state.panelOpen !== false ? 'block' : 'none') + ';margin-bottom:8px;width:268px;background:#0d140e;color:#cfe9d3;border:1px solid #2f7a41;border-radius:10px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.85);max-height:85vh;overflow-y:auto';

    const cropOptionsHtml = CROPS.map(c => `<option value="${c.id}" ${state.cfg.plantCrop === c.id ? 'selected' : ''}>${c.name} (${c.desc})</option>`).join('');

    panel.innerHTML = `
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid #1f4a29;padding-bottom:6px">
        <div style="display:flex;align-items:center;gap:6px">
          <b style="color:#7dff9b;letter-spacing:.6px;font-size:12px">🌾 Farming Season v${VERSION}</b>
        </div>
        <div style="display:flex;gap:4px">
          <span data-master style="cursor:pointer;padding:2px 8px;border-radius:4px;border:1px solid #444;background:#222;color:#8a8a8a;font-weight:700">OFF</span>
          <span data-close style="cursor:pointer;padding:2px 6px;border-radius:4px;border:1px solid #333;color:#888">✕</span>
        </div>
      </div>

      <!-- Live Farm Status & Energy (Clean, dedicated rows so nothing gets cut off!) -->
      <div style="background:#132115;border:1px solid #214327;border-radius:6px;padding:7px 9px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#92e6a3;font-weight:700;font-size:11px">⚡ Energy:</span>
          <b data-energy style="color:#f7d070;font-size:13px">--</b>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:#9ebca4">
          <span>🌱 Empty: <b data-c-empty style="color:#ffb86c">0</b></span>
          <span>⏳ Grow: <b data-c-growing style="color:#8be9fd">0</b></span>
          <span>🌾 Ready: <b data-c-ready style="color:#50fa7b">0</b></span>
        </div>
        <div style="margin-top:6px;border-top:1px dashed #214327;padding-top:5px;font-size:10px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="color:#8ba592">Status:</span>
            <b data-loop-status style="color:#92e6a3;text-align:right">Idle (OFF)</b>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px">
            <span style="color:#8ba592">Next Harvest:</span>
            <b data-next-timer style="color:#50fa7b;text-align:right">-</b>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px">
            <span style="color:#8ba592">Animals:</span>
            <b data-animal-timer style="color:#f1fa8c;text-align:right">-</b>
          </div>
        </div>
      </div>

      <!-- SILO & FEED BAGS SECTION -->
      <div style="background:#132115;border:1px solid #214327;border-radius:6px;padding:6px 8px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#f7d070;font-weight:700;font-size:11px">🎪 Silo & Pakan:</span>
          <b data-silo-feed style="color:#50fa7b;font-size:11px">0 Bags</b>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:#9ebca4">
          <span>🌾 <b data-silo-wheat style="color:#f1fa8c">0</b></span>
          <span>🌽 <b data-silo-corn style="color:#ffb86c">0</b></span>
          <span>Grain: <b data-silo-grain style="color:#8be9fd">0/245</b></span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;border-top:1px dashed #214327;padding-top:4px;font-size:9px">
          <span style="color:#8ba592">Konsumsi: <b data-silo-eat style="color:#f1fa8c">0/hari</b></span>
          <button data-action-mix style="background:#1b4d24;border:1px solid #4ade80;color:#fff;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:9px;font-weight:700">🥣 Mix Feed</button>
        </div>
      </div>

      <!-- AUTO FARM & AUTO PLANT SECTION -->
      <div style="margin-bottom:8px">
        <div style="color:#7dff9b;font-weight:700;margin-bottom:5px;display:flex;justify-content:space-between">
          <span>🌾 AUTO FARMING</span>
          <span style="font-size:9px;color:#6f8a76">LOOP MODE</span>
        </div>

        <!-- Auto Harvest -->
        <div style="background:#131c14;border:1px solid #243d28;border-radius:6px;padding:5px 6px;margin-bottom:5px">
          <label style="display:flex;justify-content:space-between;align-items:center;cursor:pointer">
            <span style="font-weight:600">Auto-harvest</span>
            <input type="checkbox" data-k="autoFarm" style="accent-color:#2f7a41">
          </label>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;padding-top:3px;border-top:1px solid #1a2a1d;font-size:10px">
            <span style="color:#8ba592">Harvest Mode:</span>
            <div style="display:flex;gap:3px">
              <button type="button" data-mode-btn="harvestMode" data-val="all" style="cursor:pointer;padding:1px 6px;border-radius:3px;font-size:9px;border:1px solid #2f7a41;background:#1b3d22;color:#7dff9b">All (2⚡)</button>
              <button type="button" data-mode-btn="harvestMode" data-val="1by1" style="cursor:pointer;padding:1px 6px;border-radius:3px;font-size:9px;border:1px solid #333;background:#1a1a1a;color:#888">1 by 1</button>
            </div>
          </div>
        </div>

        <!-- Auto Plant -->
        <div style="background:#131c14;border:1px solid #243d28;border-radius:6px;padding:5px 6px;margin-bottom:5px">
          <label style="display:flex;justify-content:space-between;align-items:center;cursor:pointer">
            <span style="font-weight:600">Auto-plant</span>
            <input type="checkbox" data-k="autoPlant" style="accent-color:#2f7a41">
          </label>
          
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;padding-top:3px;border-top:1px solid #1a2a1d;font-size:10px">
            <span style="color:#8ba592">Plant Mode:</span>
            <div style="display:flex;gap:3px">
              <button type="button" data-mode-btn="plantMode" data-val="all" style="cursor:pointer;padding:1px 6px;border-radius:3px;font-size:9px;border:1px solid #2f7a41;background:#1b3d22;color:#7dff9b">All (2⚡)</button>
              <button type="button" data-mode-btn="plantMode" data-val="1by1" style="cursor:pointer;padding:1px 6px;border-radius:3px;font-size:9px;border:1px solid #333;background:#1a1a1a;color:#888">1 by 1</button>
            </div>
          </div>

          <!-- Crop Selection Dropdown -->
          <div style="margin-top:5px">
            <div style="font-size:10px;color:#8ba592;margin-bottom:2px">Select Seed to Plant:</div>
            <select data-k-select="plantCrop" style="width:100%;background:#09100a;color:#7dff9b;border:1px solid #2f7a41;border-radius:4px;padding:4px;font-size:10px;outline:none">
              ${cropOptionsHtml}
            </select>
          </div>
        </div>

        <!-- Auto Feed Animals -->
        <label style="display:flex;justify-content:space-between;padding:3px 2px;cursor:pointer;font-size:10px">
          <span>Auto-feed animals</span>
          <input type="checkbox" data-k="autoFeed" style="accent-color:#2f7a41">
        </label>

        <!-- Quick Manual Action Buttons -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px">
          <button type="button" data-quick="harvest" style="cursor:pointer;padding:4px;background:#1a3d20;color:#7dff9b;border:1px solid #2f7a41;border-radius:4px;font-size:10px;font-weight:700">🌾 Harvest All</button>
          <button type="button" data-quick="plant" style="cursor:pointer;padding:4px;background:#1a3d20;color:#7dff9b;border:1px solid #2f7a41;border-radius:4px;font-size:10px;font-weight:700">🌱 Plant All</button>
          <button type="button" data-quick="feed" style="cursor:pointer;padding:4px;background:#1a3d20;color:#7dff9b;border:1px solid #2f7a41;border-radius:4px;font-size:10px;font-weight:700">🍖 Feed All</button>
          <button type="button" data-quick="collect" style="cursor:pointer;padding:4px;background:#1a3d20;color:#7dff9b;border:1px solid #2f7a41;border-radius:4px;font-size:10px;font-weight:700">🧺 Collect All</button>
        </div>
      </div>

      <!-- BATTLE / GOD MODE SECTION -->
      <div style="border-top:1px solid #1f4a29;padding-top:6px;margin-top:6px">
        <div style="color:#7dff9b;font-weight:700;margin-bottom:4px;font-size:10px">⚔️ BATTLE GOD MODE</div>
        <label style="display:flex;justify-content:space-between;margin:2px 0;cursor:pointer;font-size:10px"><span>HP ∞ (Invulnerable)</span><input type="checkbox" data-k="hp" style="accent-color:#2f7a41"></label>
        <label style="display:flex;justify-content:space-between;margin:2px 0;cursor:pointer;font-size:10px"><span>Auto-dodge</span><input type="checkbox" data-k="autoDodge" style="accent-color:#2f7a41"></label>
        <label style="display:flex;justify-content:space-between;margin:2px 0;cursor:pointer;font-size:10px"><span>Auto-play bot</span><input type="checkbox" data-k="autoPlay" style="accent-color:#2f7a41"></label>
        <label style="display:flex;justify-content:space-between;margin:2px 0;cursor:pointer;font-size:10px"><span>Auto-pick perk</span><input type="checkbox" data-k="autoPerk" style="accent-color:#2f7a41"></label>
        <label style="display:flex;justify-content:space-between;margin:2px 0;cursor:pointer;font-size:10px"><span>Auto-restart battle</span><input type="checkbox" data-k="autoRestart" style="accent-color:#2f7a41"></label>
      </div>

      <!-- Multipliers -->
      <div style="margin-top:6px;border-top:1px solid #1f4a29;padding-top:4px">
        <div style="display:flex;justify-content:space-between;margin:2px 0;font-size:10px"><span>Damage Multiplier</span><span data-cycle="dmg" style="cursor:pointer;color:#7dff9b;font-weight:700">x1</span></div>
        <div style="display:flex;justify-content:space-between;margin:2px 0;font-size:10px"><span>Speed Multiplier</span><span data-cycle="spd" style="cursor:pointer;color:#7dff9b;font-weight:700">x1</span></div>
        <div style="display:flex;justify-content:space-between;margin:2px 0;font-size:10px"><span>Loot Multiplier</span><span data-cycle="loot" style="cursor:pointer;color:#7dff9b;font-weight:700">x1</span></div>
      </div>

      <!-- Manual Battle Action Button -->
      <div style="margin-top:6px;border-top:1px solid #1f4a29;padding-top:5px">
        <button id="__fs_btn_manual_battle" style="width:100%;padding:6px 8px;background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);border:1px solid #c084fc;border-radius:6px;color:#fff;font-weight:700;font-size:10.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">
          <span>⚔️</span><span>Mulai Battle Manual (5 ⚡)</span>
        </button>
      </div>

      <!-- Quick Buy Energy Action Buttons -->
      <div style="margin-top:5px;border-top:1px solid #1f4a29;padding-top:5px;display:flex;gap:4px;align-items:center;">
        <span style="font-size:9.5px;color:#38bdf8;font-weight:700;white-space:nowrap;">Beli ⚡:</span>
        <button data-buy-energy="10" style="flex:1;padding:4px 3px;background:rgba(16,185,129,0.15);border:1px solid #10b981;border-radius:5px;color:#34d399;font-weight:700;font-size:9.5px;cursor:pointer;">+10</button>
        <button data-buy-energy="50" style="flex:1;padding:4px 3px;background:rgba(16,185,129,0.15);border:1px solid #10b981;border-radius:5px;color:#34d399;font-weight:700;font-size:9.5px;cursor:pointer;">+50</button>
        <button data-buy-energy="100" style="flex:1;padding:4px 3px;background:rgba(16,185,129,0.15);border:1px solid #10b981;border-radius:5px;color:#34d399;font-weight:700;font-size:9.5px;cursor:pointer;">+100</button>
      </div>

      <!-- Bottom Activity Tracker -->
      <div data-stat style="margin-top:6px;border-top:1px solid #1a2a1d;padding-top:4px;font:500 9px/1.3 ui-monospace,monospace;color:#6f8a76"></div>
    `;

    root.appendChild(panel);
    root.appendChild(badge);
    document.body.appendChild(root);

    const manualBattleBtn = panel.querySelector('#__fs_btn_manual_battle');
    if (manualBattleBtn) {
      manualBattleBtn.onclick = () => {
        window.__fsStartBattle();
      };
    }

    panel.querySelectorAll('[data-buy-energy]').forEach(btn => {
      btn.onclick = () => {
        const amt = Number(btn.dataset.buyEnergy);
        window.__fsBuyEnergy(amt);
      };
    });

    // Event listeners
    panel.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.onchange = () => {
        state.cfg[inp.dataset.k] = inp.checked;
        saveSettings();
        paint();
      };
    });

    const cropSelect = panel.querySelector('select[data-k-select="plantCrop"]');
    if (cropSelect) {
      cropSelect.onchange = () => {
        state.cfg.plantCrop = cropSelect.value;
        saveSettings();
        paint();
      };
    }

    panel.querySelectorAll('[data-mode-btn]').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.modeBtn;
        const val = btn.dataset.val;
        state.cfg[key] = val;
        saveSettings();
        paint();
      };
    });

    panel.querySelectorAll('[data-cycle]').forEach((el) => {
      el.onclick = () => {
        const k = el.dataset.cycle, arr = CYCLES[k];
        state.cfg[k] = arr[(arr.indexOf(state.cfg[k]) + 1) % arr.length];
        saveSettings();
        paint();
      };
    });

    panel.querySelector('[data-quick="harvest"]').onclick = () => {
      triggerGameAction('harvest-all');
    };

    panel.querySelector('[data-quick="plant"]').onclick = () => {
      triggerGameAction('plant-all', state.cfg.plantCrop);
    };

    panel.querySelector('[data-quick="feed"]').onclick = () => {
      triggerGameAction('feed-all');
    };

    panel.querySelector('[data-quick="collect"]').onclick = () => {
      triggerGameAction('collect-all');
    };

    const mixBtn = panel.querySelector('[data-action-mix]');
    if (mixBtn) {
      mixBtn.onclick = () => {
        window.__fsMixFeed('max');
        paint();
      };
    }

    panel.querySelector('[data-master]').onclick = () => {
      state.enabled = !state.enabled;
      if (state.enabled) state.startupDone = true;
      saveSettings();
      paint();
    };

    panel.querySelector('[data-close]').onclick = () => {
      panel.style.display = 'none';
      saveSettings();
    };

    paint();
  }

  function paint() {
    if (!root || !panel) return;
    const badge = root.querySelector('#__fs_gm_badge');
    const on = state.enabled;
    const energy = state.farmData?.today?.energy ?? '--';
    const now = Date.now();
    const isWarmingUp = !state.startupDone && now < state.startupCooldownUntil;
    const remSec = isWarmingUp ? Math.max(1, Math.ceil((state.startupCooldownUntil - now) / 1000)) : 0;
    const remStr = remSec >= 60 ? `${Math.floor(remSec / 60)}m ${remSec % 60}s` : `${remSec}s`;

    let titleText = on ? `🌾 FS v${VERSION} (ON)` : `💤 FS v${VERSION} (OFF)`;
    if (isWarmingUp) {
      titleText = `⏳ FS v${VERSION} (${remStr})`;
    } else if (!state.startupDone) {
      titleText = `⏳ FS v${VERSION} (Sync)`;
    }

    badge.style.background = on ? '#0d2b14' : (isWarmingUp ? '#2d240d' : '#222');
    badge.style.color = on ? '#7dff9b' : (isWarmingUp ? '#ffd166' : '#888');
    badge.style.border = '1px solid ' + (on ? '#2f7a41' : (isWarmingUp ? '#8c6d1f' : '#444'));

    const gateBadge = document.getElementById('human-gate');
    const hasGate = !!(gateBadge && gateBadge.offsetParent !== null && !gateBadge.hidden);
    badge.innerHTML = `
      <span>${titleText}</span>
      <span style="font-size:9px;padding:1px 5px;border-radius:4px;background:${energy < 2 ? '#4a1717' : '#14401e'};color:${energy < 2 ? '#ff6b6b' : '#f7d070'}">⚡ ${energy}</span>
      ${state.counts.ready > 0 ? `<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:#1e4620;color:#50fa7b">🌾 ${state.counts.ready}</span>` : ''}
      ${hasGate ? `<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:#e74c3c;color:#fff;font-weight:700">⚠️ CAPTCHA</span>` : ''}
    `;

    const master = panel.querySelector('[data-master]');
    if (isWarmingUp) {
      master.textContent = `SYNC (${remStr})`;
      master.style.color = '#ffd166';
      master.style.background = '#3d3012';
      master.style.border = '1px solid #8c6d1f';
    } else if (!state.startupDone) {
      master.textContent = 'SYNCING';
      master.style.color = '#ffd166';
      master.style.background = '#3d3012';
      master.style.border = '1px solid #8c6d1f';
    } else {
      master.textContent = on ? 'ON' : 'OFF';
      master.style.color = on ? '#7dff9b' : '#8a8a8a';
      master.style.background = on ? '#163b1d' : '#222';
      master.style.border = on ? '1px solid #2f7a41' : '1px solid #444';
    }

    // Update Energy and counts
    const enEl = panel.querySelector('[data-energy]');
    if (enEl) {
      enEl.textContent = energy;
      enEl.style.color = energy < 2 ? '#ff5555' : energy < 10 ? '#ffb86c' : '#f7d070';
    }

    const cEmpty = panel.querySelector('[data-c-empty]');
    if (cEmpty) cEmpty.textContent = state.counts.empty;
    const cGrow = panel.querySelector('[data-c-growing]');
    if (cGrow) cGrow.textContent = state.counts.growing;
    const cReady = panel.querySelector('[data-c-ready]');
    if (cReady) cReady.textContent = state.counts.ready;

    // Dedicated rows: Status and Next Timer (never truncated!)
    const loopSt = panel.querySelector('[data-loop-status]');
    if (loopSt) {
      loopSt.textContent = state.loopStatus;
      loopSt.style.color = !on ? '#888' : energy < 2 ? '#ff6b6b' : '#92e6a3';
    }

    const nextTmr = panel.querySelector('[data-next-timer]');
    if (nextTmr) {
      nextTmr.textContent = state.nextHarvestText;
    }

    const animTmr = panel.querySelector('[data-animal-timer]');
    if (animTmr) {
      if (state.animals && state.animals.total > 0) {
        const cStr = state.animals.chickens ? `🐔 ${state.animals.chickens}` : '';
        const sStr = state.animals.sheep ? `🐑 ${state.animals.sheep}` : '';
        const groupStr = [cStr, sStr].filter(Boolean).join(' · ');
        const prodStr = state.animals.productsReady > 0 
          ? (state.animals.isReadyForBulkCollect ? ` · 🧺 ${state.animals.productsReady} Siap` : ` · 🧺 ${state.animals.productsReady} Nunggu`)
          : '';
        animTmr.textContent = `${groupStr} (⏳ ${state.animals.nextMeal || '-'})${prodStr}`;
        animTmr.style.color = state.animals.hungry > 0 ? (state.animals.isReadyForBulkFeed ? '#50fa7b' : '#ffb86c') : '#f1fa8c';
      } else {
        animTmr.textContent = '-';
      }
    }

    const siloFeed = panel.querySelector('[data-silo-feed]');
    if (siloFeed) {
      const si = state.silo || {};
      siloFeed.textContent = `${si.feed || 0} Bags`;
      const sWheat = panel.querySelector('[data-silo-wheat]');
      if (sWheat) sWheat.textContent = si.wheat || 0;
      const sCorn = panel.querySelector('[data-silo-corn]');
      if (sCorn) sCorn.textContent = si.corn || 0;
      const sGrain = panel.querySelector('[data-silo-grain]');
      if (sGrain) sGrain.textContent = `${si.grain || 0}/${si.maxGrain || 245}`;
      const sEat = panel.querySelector('[data-silo-eat]');
      if (sEat) sEat.textContent = `${si.dailyEat || 0}/hari`;
      const btnMix = panel.querySelector('[data-action-mix]');
      if (btnMix) {
        btnMix.disabled = !si.canMix;
        btnMix.style.opacity = si.canMix ? '1' : '0.4';
      }
    }

    // Checkboxes
    panel.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.checked = !!state.cfg[inp.dataset.k];
    });

    const cropSelect = panel.querySelector('select[data-k-select="plantCrop"]');
    if (cropSelect && cropSelect.value !== state.cfg.plantCrop) {
      cropSelect.value = state.cfg.plantCrop;
    }

    // Mode Buttons active state styling
    panel.querySelectorAll('[data-mode-btn]').forEach((btn) => {
      const key = btn.dataset.modeBtn;
      const val = btn.dataset.val;
      const isSelected = state.cfg[key] === val;
      btn.style.border = isSelected ? '1px solid #2f7a41' : '1px solid #333';
      btn.style.background = isSelected ? '#1b3d22' : '#1a1a1a';
      btn.style.color = isSelected ? '#7dff9b' : '#777';
    });

    // Multipliers
    panel.querySelectorAll('[data-cycle]').forEach((el) => {
      el.textContent = 'x' + state.cfg[el.dataset.cycle];
    });

    // Activity stats
    const st = panel.querySelector('[data-stat]');
    if (st) {
      st.textContent = `Hero: ${state.heroes} · Blocked: ${state.hitsBlocked} · Restarts: ${state.restarts} · Jobs: ${state.farmJobs}`;
    }
  }

  /* ---------------- 10. Main Loop ---------------- */
  setInterval(() => {
    const now = Date.now();

    const gateEl = document.getElementById('human-gate');
    const hasGate = !!(gateEl && gateEl.offsetParent !== null && !gateEl.hidden);

    // PRIORITAS 1: CAPTCHA CHECK
    if (hasGate) {
      state.loopStatus = '⚠️ Prioritas 1: Menyelesaikan Turnstile CAPTCHA...';
      state.enabled = false;
      state.__captchaWasActive = true;
      scan();
      paint();
      return;
    }

    // Jika baru saja lolos dari CAPTCHA, setel mode Standby 2 menit!
    if (state.__captchaWasActive) {
      state.__captchaWasActive = false;
      const standbyDuration = state.startupDuration || 120000;
      state.startupCooldownUntil = now + standbyDuration;
      state.startupDone = false;
      state.enabled = false;
      console.log(TAG, `✅ CAPTCHA lolos! Masuk ke mode Standby (${Math.round(standbyDuration / 1000)}s) untuk sinkronisasi server...`);
    }

    // Startup Warmup & Server Sync Routine
    if (!state.startupDone) {
      if (now < state.startupCooldownUntil) {
        const remSec = Math.max(1, Math.ceil((state.startupCooldownUntil - now) / 1000));
        const remStr = remSec >= 60 ? `${Math.floor(remSec / 60)}m ${remSec % 60}s` : `${remSec}s`;
        state.enabled = false;
        state.loopStatus = `⏳ Standby (Sinkronisasi server ${remStr})...`;
      } else {
        // Cooldown timer has passed! Now verify server sync
        const hasFarmData = !!(state.farmData && (
          (Array.isArray(state.farmData.fields) && state.farmData.fields.length > 0) ||
          state.farmData.owner
        ));
        const hasNameForm = !!document.getElementById('name-form');

        if (hasNameForm) {
          state.loopStatus = '⚠️ Menunggu formulir pendaftaran farm...';
        } else if (!hasFarmData) {
          state.loopStatus = '⏳ Menunggu data server (/api/farm)...';
          tryFallbackFarmData();
        } else {
          // Fully synchronized and warmup finished!
          state.startupDone = true;
          state.enabled = true;
          state.loopStatus = 'Active';
          console.log(TAG, '✅ Startup warmup & server sync complete! Bot auto-activated.');
          saveSettings();
        }
      }
    }

    scan();
    paint();
  }, 400);

  document.addEventListener('DOMContentLoaded', buildUI, { once: true });
  if (document.readyState !== 'loading') buildUI();

  window.__fsFarmingSeason = window.__fsGodMode = {
    state,
    get games() { return [...games]; },
    scan,
    toggle() {
      state.enabled = !state.enabled;
      if (state.enabled) state.startupDone = true;
      saveSettings();
      paint();
      return state.enabled;
    },
    farmPass(scene) { farmTick(scene, true); return state.farmJobs; },
    triggerGameAction,
    saveSettings,
    cfg: state.cfg,
    CROPS,
    PERKS_DICT,
    get perkWeights() { return state.perkWeights; },
    set perkWeights(w) { state.perkWeights = w; saveSettings(); },
    get perkLog() { return state.perkLog; },
    version: VERSION,
    pickPerk: pickBestPerk,
    async executeWithdraw(requestedAmount) {
      try {
        console.log(TAG, `[Withdraw] Menerima instruksi withdraw (${requestedAmount || 'all'})...`);
        
        // 1. Cek apakah sudah ada permit open yang aktif
        let permit = null;
        try {
          const res = await fetch('/api/farm/withdraw', { credentials: 'same-origin' });
          if (res.ok) {
            const data = await res.json();
            if (data && data.permit && data.permit.status === 'open') {
              permit = data.permit;
            }
          }
        } catch (e) {}

        // 2. Jika belum ada permit open, buka panel & tunggu tombol muncul
        if (!permit) {
          triggerGameAction('withdraw-panel');

          // Tunggu tombol withdraw muncul di DOM (hingga 6 detik)
          let primaryBtn = null;
          const waitBtnStart = Date.now();
          while (Date.now() - waitBtnStart < 6000) {
            await new Promise(r => setTimeout(r, 350));
            const withdrawBtns = Array.from(document.querySelectorAll('button[data-action="withdraw"]'));
            if (withdrawBtns.length > 0) {
              primaryBtn = withdrawBtns.find(b => b.classList.contains('primary')) || withdrawBtns[0];
              break;
            }
          }

          if (primaryBtn) {
            if (primaryBtn.disabled) {
              const alertEl = document.querySelector('.alert, p.hint b, p.hint, .toast');
              const reason = alertEl ? alertEl.textContent.trim() : 'Tombol withdraw terkunci (limit habis atau belum memenuhi syarat)';
              return { ok: false, error: reason };
            }
            console.log(TAG, `[Withdraw] Mengklik tombol primary withdraw (arg: ${primaryBtn.dataset.arg})...`);
            primaryBtn.click();
          } else {
            // Fallback: hitung nilai USD valid (bukan 'all')
            const fallbackUsd = (typeof requestedAmount === 'number' && requestedAmount > 0) ? requestedAmount : 1.88;
            console.log(TAG, `[Withdraw] Tombol DOM tidak terdeteksi, memicu via triggerGameAction (usd: ${fallbackUsd})...`);
            triggerGameAction('withdraw', fallbackUsd);
          }

          // Polling permit sampai open (hingga 12 detik)
          let lastErrMsg = '';
          const startWait = Date.now();
          while (Date.now() - startWait < 12000) {
            await new Promise(r => setTimeout(r, 600));

            // Cek apakah ada toast / alert pesan error dari server
            const toastEl = document.querySelector('.toast.bad, .toast, #toasts > div, .alert.warn');
            if (toastEl) {
              const txt = toastEl.textContent.trim();
              if (txt && !/Preparing/i.test(txt)) {
                lastErrMsg = txt;
              }
            }

            try {
              const res = await fetch('/api/farm/withdraw', { credentials: 'same-origin' });
              if (res.ok) {
                const data = await res.json();
                if (data && data.permit && data.permit.status === 'open') {
                  permit = data.permit;
                  break;
                }
                if (data && data.msg) lastErrMsg = data.msg;
              }
            } catch (e) {}
          }

          if (!permit && lastErrMsg) {
            return { ok: false, error: lastErrMsg };
          }
        }

        if (permit) {
          return {
            ok: true,
            permit,
            amount: Math.round(permit.tokens || 0),
            message: `Permit withdraw berhasil disiapkan (${Math.round(permit.tokens || 0)} SEASON)`
          };
        }

        return { ok: false, error: 'Permit withdraw tidak kunjung berstatus open dari server game (waktu tunggu habis)' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    startBattle: function() {
      return window.__fsStartBattle();
    },
    buyEnergy: function(amount) {
      return window.__fsBuyEnergy(amount);
    },
    mixFeed: function(amount) {
      return window.__fsMixFeed(amount);
    }
  };

  window.__fsBuyEnergy = function(amount) {
    amount = Number(amount) || 10;
    if (![10, 50, 100].includes(amount)) amount = 10;
    const farm = state.farmData;
    const tokens = (farm && typeof farm.tokens === 'number') ? farm.tokens : 0;
    const curEnergy = (farm && farm.today && typeof farm.today.energy === 'number') ? farm.today.energy : (state.lastEnergy || 0);

    const ok = triggerGameAction('energy', amount);
    if (ok) {
      const newEnergy = (farm && farm.today && typeof farm.today.energy === 'number') ? farm.today.energy : (curEnergy + amount);
      const newTokens = (farm && typeof farm.tokens === 'number') ? farm.tokens : tokens;
      state.lastEnergy = newEnergy;
      state.loopStatus = `⚡ Berhasil beli +${amount} Energy (Total: ${newEnergy}/100)...`;
      console.log(TAG, `[Buy Energy] Berhasil beli +${amount} energy di game (Energy baru: ${newEnergy}, Saldo: ${newTokens} SEASON)...`);
      setCooldown(2500, `⚡ Beli +${amount} Energy`);
      return { ok: true, newEnergy, newTokens, message: `+${amount} energy berhasil dibeli! (Total: ${newEnergy}/100)` };
    } else {
      return { ok: false, message: 'Gagal memicu tombol beli energy di game.' };
    }
  };

  window.__fsStartBattle = function() {
    const farm = state.farmData;
    const energy = (farm && farm.today && typeof farm.today.energy === 'number')
      ? farm.today.energy
      : (state.lastEnergy || 0);

    if (energy < 5) {
      const msg = `⚡ Energy tidak cukup (${energy}/100). Butuh minimal 5 energy untuk battle!`;
      state.loopStatus = msg;
      console.warn(TAG, msg);
      return { ok: false, message: msg };
    }

    if (state.stage === 'battle' || state.currentTask === 'battling') {
      return { ok: false, message: 'Akun sedang berada di dalam pertempuran battle!' };
    }

    state.manualBattleRequested = true;
    state.stage = 'battle';
    state.currentTask = 'battling';
    state.loopStatus = `⚔️ Memulai Battle Manual (Sesuai Perintah Tombol)...`;
    console.log(TAG, `Manual Battle triggered by user (Energy: ${energy}). Entering arena...`);
    setCooldown(3000, '⚔️ Memasuki Battle Arena');
    triggerGameAction('go-battle');
    return { ok: true, message: `Battle dimulai! Target Max Wave 30 (Mati Natural Wave 31)` };
  };

  window.__fsMixFeed = function(amount) {
    const targetArg = amount || 'max';
    const farm = state.farmData;
    const w = (farm && farm.silo && typeof farm.silo.wheat === 'number') ? farm.silo.wheat : 0;
    const c = (farm && farm.silo && typeof farm.silo.corn === 'number') ? farm.silo.corn : 0;
    const pairs = Math.min(w, c);

    if (pairs < 1) {
      const msg = 'Tidak cukup bahan di Silo. Butuh minimal 1 Wheat dan 1 Corn untuk dicampur!';
      console.warn(TAG, msg);
      return { ok: false, message: msg };
    }

    const ok = triggerGameAction('make-feed', targetArg);
    if (ok) {
      const mixed = targetArg === 'max' ? pairs : Math.min(Number(targetArg) || 1, pairs);
      const msg = `Berhasil mix ${mixed} wheat & corn (+${mixed * 10} bags feed)!`;
      console.log(TAG, `[Silo Mix Feed] ${msg}`);
      if (farm && farm.silo) {
        farm.silo.wheat = Math.max(0, (farm.silo.wheat || 0) - mixed);
        farm.silo.corn = Math.max(0, (farm.silo.corn || 0) - mixed);
        farm.silo.feed = (farm.silo.feed || 0) + (mixed * 10);
        syncSiloInfo(farm);
      }
      return { ok: true, mixed, bags: mixed * 10, message: msg };
    } else {
      return { ok: false, message: 'Gagal memicu aksi make-feed di game.' };
    }
  };

  console.log(TAG, `Farming Season v${VERSION} loaded (document_start)`);
})();
