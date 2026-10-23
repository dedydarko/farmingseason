const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class WebDashboardServer {
  constructor(runner, preferredPort = 3000) {
    this.runner = runner;
    this.preferredPort = preferredPort;
    this.server = null;
    this.port = null;
    this.startTime = Date.now();
    this.tokenMarket = {
      priceUsd: null,
      ethPriceUsd: 2500,
      marketCap: null,
      fdv: null,
      priceChange24h: null,
      pairUrl: 'https://dexscreener.com/robinhood/0x2474146acce0e699ce4f3b6b751356bc97798ddf089ca1d67f571427ad6aa335',
      lastUpdated: 0,
      fetching: false
    };
  }

  getAccounts() {
    if (this.runner && this.runner.accounts && this.runner.accounts.length) {
      return this.runner.accounts;
    }
    if (this.runner && this.runner.config && this.runner.config.accounts && this.runner.config.accounts.length) {
      return this.runner.config.accounts;
    }
    try {
      const cfgPath = path.resolve(__dirname, '..', 'config.json');
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (parsed.accounts && parsed.accounts.length) return parsed.accounts;
      }
    } catch (e) {}
    return [];
  }

  async parseJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Format request JSON tidak valid'));
        }
      });
      req.on('error', reject);
    });
  }

  updateTokenMarket() {
    const now = Date.now();
    // Cache 15 detik agar tidak spamming/rate limit ke DexScreener
    if (now - this.tokenMarket.lastUpdated < 15000 || this.tokenMarket.fetching) {
      return;
    }
    this.tokenMarket.fetching = true;

    try {
      const req = https.get('https://api.dexscreener.com/latest/dex/pairs/robinhood/0x2474146acce0e699ce4f3b6b751356bc97798ddf089ca1d67f571427ad6aa335', {
        timeout: 6000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          this.tokenMarket.fetching = false;
          try {
            if (res.statusCode === 200) {
              const parsed = JSON.parse(raw);
              if (parsed.pairs && parsed.pairs[0]) {
                const pair = parsed.pairs[0];
                this.tokenMarket.priceUsd = parseFloat(pair.priceUsd) || 0;
                this.tokenMarket.marketCap = pair.marketCap || pair.fdv || 0;
                this.tokenMarket.fdv = pair.fdv || 0;
                this.tokenMarket.priceChange24h = pair.priceChange ? (pair.priceChange.h24 || 0) : 0;
                if (pair.url) this.tokenMarket.pairUrl = pair.url;
                if (pair.priceUsd && pair.priceNative && Number(pair.priceNative) > 0) {
                  this.tokenMarket.ethPriceUsd = parseFloat((Number(pair.priceUsd) / Number(pair.priceNative)).toFixed(2));
                }
                this.tokenMarket.lastUpdated = Date.now();
              }
            }
          } catch (e) {}
        });
      });

      req.on('error', () => {
        this.tokenMarket.fetching = false;
      });
      req.on('timeout', () => {
        req.destroy();
        this.tokenMarket.fetching = false;
      });
    } catch (e) {
      this.tokenMarket.fetching = false;
    }
  }

  async start() {
    this.updateTokenMarket();
    return new Promise((resolve) => {
      let currentPort = this.preferredPort;

      const tryListen = (portToTry) => {
        const srv = http.createServer((req, res) => this.handleRequest(req, res));
        
        srv.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`[Web Dashboard] Port ${portToTry} sedang digunakan, mencoba port ${portToTry + 1}...`);
            tryListen(portToTry + 1);
          } else {
            console.error('[Web Dashboard] Server error:', err.message);
          }
        });

        srv.listen(portToTry, '0.0.0.0', () => {
          this.server = srv;
          this.port = portToTry;
          const url = `http://localhost:${this.port}`;
          resolve(url);
        });
      };

      tryListen(currentPort);
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
  }

  handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/api/status') {
      this.handleApiStatus(req, res);
    } else if (pathname === '/api/logs') {
      this.handleApiLogs(req, res, parsedUrl);
    } else if (pathname === '/api/wallet/status') {
      this.handleApiWalletStatus(req, res, parsedUrl);
    } else if (pathname === '/api/wallet/withdraw' && req.method === 'POST') {
      this.handleApiWalletWithdraw(req, res);
    } else if (pathname === '/api/wallet/withdraw-all' && req.method === 'POST') {
      this.handleApiWalletWithdrawAll(req, res);
    } else if (pathname === '/api/wallet/send' && req.method === 'POST') {
      this.handleApiWalletSend(req, res);
    } else if (pathname === '/api/wallet/history') {
      this.handleApiWalletHistory(req, res);
    } else if (pathname === '/api/income/claim' && req.method === 'POST') {
      this.handleApiIncomeClaim(req, res);
    } else if (pathname === '/api/battle/start' && req.method === 'POST') {
      this.handleApiBattleStart(req, res);
    } else if (pathname === '/api/battle/start-all' && req.method === 'POST') {
      this.handleApiBattleStartAll(req, res);
    } else if (pathname === '/api/energy/buy' && req.method === 'POST') {
      this.handleApiEnergyBuy(req, res);
    } else if (pathname === '/api/silo/mix' && req.method === 'POST') {
      this.handleApiSiloMix(req, res);
    } else if (pathname === '/api/silo/mix-all' && req.method === 'POST') {
      this.handleApiSiloMixAll(req, res);
    } else {
      this.handleIndex(req, res);
    }
  }

  async handleApiWalletStatus(req, res, parsedUrl) {
    try {
      this.updateTokenMarket();
      const force = parsedUrl.searchParams.get('refresh') === '1';
      const accounts = this.getAccounts();
      try { delete require.cache[require.resolve('./wallet.js')]; } catch (e) {}
      const { getWalletOverview } = require('./wallet.js');
      const overview = await getWalletOverview(accounts, this.tokenMarket, this.runner, force);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: overview }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async handleApiWalletWithdraw(req, res) {
    try {
      const body = await this.parseJsonBody(req);
      const accountId = Number(body.accountId);
      const amount = body.amount || 'all';
      if (!accountId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Parameter accountId wajib diisi' }));
        return;
      }
      const accounts = this.getAccounts();
      try { delete require.cache[require.resolve('./wallet.js')]; } catch (e) {}
      const { executeWithdraw } = require('./wallet.js');
      const result = await executeWithdraw(accountId, amount, this.runner, accounts);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async handleApiWalletWithdrawAll(req, res) {
    try {
      const accounts = this.getAccounts();
      try { delete require.cache[require.resolve('./wallet.js')]; } catch (e) {}
      const { executeWithdraw } = require('./wallet.js');
      const results = [];
      for (const acc of accounts) {
        const inst = this.runner && this.runner.instances ? this.runner.instances.get(acc.id) : null;
        const tokens = inst?.status?.seasonTokens || 0;
        if (tokens >= 1) {
          try {
            const res = await executeWithdraw(acc.id, 'all', this.runner, accounts);
            results.push({ accountId: acc.id, name: acc.name, ok: true, message: res.message });
          } catch (err) {
            results.push({ accountId: acc.id, name: acc.name, ok: false, error: err.message });
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async handleApiWalletSend(req, res) {
    try {
      const body = await this.parseJsonBody(req);
      const accountId = Number(body.accountId);
      const toAddress = (body.toAddress || '').trim();
      const amount = parseFloat(body.amount);
      if (!accountId || !toAddress || isNaN(amount) || amount <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Data transfer tidak valid (accountId, toAddress, amount harus valid)' }));
        return;
      }
      const accounts = this.getAccounts();
      const { executeTransfer } = require('./wallet.js');
      const result = await executeTransfer(accountId, toAddress, amount, accounts);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  handleApiWalletHistory(req, res) {
    try {
      const { loadHistory } = require('./wallet.js');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, history: loadHistory() }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  async handleApiIncomeClaim(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const accountId = payload.accountId;
        const inst = this.runner.instances.get(accountId);
        if (!inst || !inst.page) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Instance akun #' + accountId + ' tidak aktif' }));
          return;
        }

        const claimed = await inst.page.evaluate(() => {
          const claimTile = document.querySelector('button[data-action="claim"], button.tile.claim');
          if (claimTile) {
            claimTile.click();
            return true;
          }
          const fs = window.__fsFarmingSeason;
          if (fs && typeof fs.triggerGameAction === 'function') {
            return fs.triggerGameAction('claim');
          }
          return false;
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, claimed }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  }

  async handleApiBattleStart(req, res) {
    try {
      const body = await this.parseJsonBody(req);
      const accountId = Number(body.accountId);
      if (!accountId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'accountId harus valid' }));
        return;
      }
      const result = await this.runner.startBattle(accountId);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: e.message }));
    }
  }

  async handleApiBattleStartAll(req, res) {
    try {
      const results = await this.runner.startBattleAll();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: e.message }));
    }
  }

  async handleApiEnergyBuy(req, res) {
    try {
      const body = await this.parseJsonBody(req);
      const accountId = Number(body.accountId);
      const amount = Number(body.amount) || 10;
      if (!accountId || ![10, 50, 100].includes(amount)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'accountId dan amount (10, 50, 100) harus valid' }));
        return;
      }
      const result = await this.runner.buyEnergy(accountId, amount);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: e.message }));
    }
  }

  async handleApiSiloMix(req, res) {
    try {
      const body = await this.parseJsonBody(req);
      const accountId = Number(body.accountId || body.id);
      const amount = body.amount || 'max';
      if (!accountId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'accountId harus valid' }));
        return;
      }
      const result = await this.runner.mixFeed(accountId, amount);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: e.message }));
    }
  }

  async handleApiSiloMixAll(req, res) {
    try {
      const results = await this.runner.mixFeedAll('max');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: e.message }));
    }
  }

  handleApiStatus(req, res) {
    const instancesData = [];
    let totalSeason = 0;
    let totalSeasonToday = 0;
    let totalEnergy = 0;
    let totalBattleEarned = 0;
    let totalBattleCap = 0;
    let totalHarvestEarned = 0;
    let totalHarvestCap = 0;
    let totalVillageIncomePending = 0;

    for (const [id, inst] of this.runner.instances) {
      const st = inst.status;
      const counts = st.counts || { ready: 0, growing: 0, empty: 0 };
      const tokens = st.seasonTokens || 0;
      const earnedToday = st.totalEarnedToday || 0;
      const fallbackBattleCap = (this.tokenMarket && this.tokenMarket.priceUsd > 0) ? Math.round(0.55 / this.tokenMarket.priceUsd) : 1687;
      const fallbackHarvestCap = (this.tokenMarket && this.tokenMarket.priceUsd > 0) ? Math.round(0.70 / this.tokenMarket.priceUsd) : 2147;
      const bLoot = st.battleLoot || { earned: 0, cap: fallbackBattleCap };
      const hLoot = st.harvestLoot || { earned: 0, cap: fallbackHarvestCap };
      const vIncome = st.villageIncome || { accumulated: 0, rate: '+27/h', isFull: false };

      totalVillageIncomePending += (vIncome.accumulated || 0);
      totalSeason += tokens;
      totalSeasonToday += earnedToday;
      totalEnergy += (typeof st.energy === 'number' ? st.energy : 0);
      totalBattleEarned += (bLoot.earned || 0);
      totalBattleCap += (bLoot.cap || fallbackBattleCap);
      totalHarvestEarned += (hLoot.earned || 0);
      totalHarvestCap += (hLoot.cap || fallbackHarvestCap);

      instancesData.push({
        id,
        name: inst.account.name,
        farmName: inst.account.farmName,
        crop: inst.account.crop || st.cropPlanted || 'Radish',
        enabled: (st.enabled !== undefined) ? st.enabled : (inst.account.enabled !== false),
        startupDone: !!st.startupDone,
        state: st.state,
        energy: st.energy,
        seasonTokens: tokens,
        totalEarnedToday: earnedToday,
        villageIncome: vIncome,
        withdrawnToday: st.withdrawnToday || 0,
        dailyWithdrawLimit: st.dailyWithdrawLimit || 4929,
        currentTask: st.currentTask || 'idle',
        counts: counts,
        loopStatus: st.loopStatus || 'Active',
        nextHarvest: st.nextHarvest || '-',
        nextHarvestMs: st.nextHarvestMs || null,
        stage: st.stage || 'init',
        battleWave: st.battleWave || 1,
        battleKills: st.battleKills || 0,
        battleLoot: st.battleLoot || { earned: 0, cap: fallbackBattleCap, isFull: false },
        harvestLoot: st.harvestLoot || { earned: 0, cap: fallbackHarvestCap, isFull: false },
        silo: st.silo || { feed: 0, wheat: 0, corn: 0, grain: 0, maxGrain: 245, dailyEat: 0, canMix: false },
        animals: st.animals || { total: 0, hungry: 0, products: 0, nextMeal: '-' },
        battleCapDone: !!st.battleCapDone,
        harvestCapDone: !!st.harvestCapDone,
        dailyTracker: st.dailyTracker || null,
        needsCaptcha: !!st.needsCaptcha,
        needsLogin: !!st.needsLogin,
        isBanned: !!st.isBanned,
        banReason: st.banReason || null,
        regBalanceAlert: st.regBalanceAlert || null
      });
    }

    // Hitung sisa detik menuju reset harian (00:00 midnight waktu lokal)
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const dailyResetSeconds = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000));

    this.updateTokenMarket();

    const payload = {
      timestamp: Date.now(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      dailyResetSeconds,
      tokenMarket: this.tokenMarket,
      summary: {
        totalAccounts: instancesData.length,
        totalSeason,
        totalSeasonToday,
        totalEnergy,
        totalBattleEarned,
        totalBattleCap,
        totalHarvestEarned,
        totalHarvestCap,
        totalVillageIncomePending
      },
      accounts: instancesData
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  handleApiLogs(req, res, parsedUrl) {
    const type = parsedUrl.searchParams.get('type') || 'all';
    const lines = parseInt(parsedUrl.searchParams.get('lines'), 10) || 50;
    const raw = logger.getRecentLogs(type, lines);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: raw }));
  }

  handleIndex(req, res) {
    const html = getDashboardHtml();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}

function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🌾 Farming Season — Live Web Dashboard & Wallet</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220%22><text y=%2226%22 font-size=%2226%22>🌾</text></svg>">
  <style>
    :root {
      --bg: #070b12;
      --sidebar-bg: #0a0f1b;
      --card-bg: linear-gradient(180deg, #101726 0%, #0a0f1a 100%);
      --card-border: rgba(255, 255, 255, 0.08);
      --card-hover-border: rgba(56, 189, 248, 0.35);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --accent-green: #10b981;
      --accent-amber: #f59e0b;
      --accent-purple: #a855f7;
      --accent-blue: #38bdf8;
      --accent-red: #f43f5e;
      --bar-bg: #141d2f;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(circle at 15% 10%, rgba(56, 189, 248, 0.05) 0%, transparent 40%),
        radial-gradient(circle at 85% 5%, rgba(168, 85, 247, 0.05) 0%, transparent 40%);
      background-attachment: fixed;
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    /* APP LAYOUT WITH FIXED SIDEBAR */
    .app-layout {
      display: flex;
      min-height: 100vh;
      width: 100%;
    }

    /* SIDEBAR */
    .sidebar {
      width: 250px;
      min-width: 250px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--card-border);
      position: sticky;
      top: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      z-index: 200;
      box-shadow: 4px 0 24px rgba(0,0,0,0.4);
    }

    .sidebar-brand {
      padding: 20px 18px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon-box {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(56, 189, 248, 0.2));
      border: 1px solid rgba(16, 185, 129, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 16px rgba(16, 185, 129, 0.2);
    }
    .brand-title-wrap {
      display: flex;
      flex-direction: column;
    }
    .brand-title {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: -0.2px;
      background: linear-gradient(90deg, #34d399, #38bdf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-tag {
      font-size: 10px;
      font-weight: 700;
      color: var(--text-dim);
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .sidebar-nav {
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
    }
    .nav-header {
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-dim);
      padding: 8px 10px 4px 10px;
    }
    .nav-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      transition: all 0.2s ease;
      width: 100%;
    }
    .nav-btn:hover {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
    }
    .nav-btn.active {
      background: linear-gradient(90deg, rgba(16, 185, 129, 0.15) 0%, rgba(56, 189, 248, 0.08) 100%);
      border-color: rgba(16, 185, 129, 0.4);
      color: #fff;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.12);
    }
    .nav-btn[data-view="withdraw"].active {
      background: linear-gradient(90deg, rgba(245, 158, 11, 0.16) 0%, rgba(234, 88, 12, 0.08) 100%);
      border-color: rgba(245, 158, 11, 0.45);
      color: #fff;
      box-shadow: 0 4px 16px rgba(245, 158, 11, 0.15);
    }
    .nav-icon {
      font-size: 18px;
    }
    .nav-text {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .nav-title {
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.2;
    }
    .nav-sub {
      font-size: 10px;
      color: var(--text-dim);
    }
    .nav-badge-onchain {
      font-size: 9.5px;
      font-weight: 800;
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.35);
      padding: 2px 6px;
      border-radius: 9999px;
      text-transform: uppercase;
    }

    .sidebar-footer {
      padding: 16px 14px;
      border-top: 1px solid var(--card-border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .network-badge-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .network-row-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      color: #38bdf8;
    }
    .network-row-sub {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: var(--text-dim);
    }
    .network-row-sub a {
      color: #34d399;
      text-decoration: none;
      font-weight: 600;
    }
    .network-row-sub a:hover {
      text-decoration: underline;
    }

    /* MAIN CONTENT */
    .main-wrapper {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      padding-bottom: 60px;
    }

    /* TOP HEADER */
    header {
      background: rgba(13, 19, 33, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--card-border);
      padding: 12px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .header-inner {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
    }
    .header-breadcrumb {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .crumb-view-title {
      font-size: 17px;
      font-weight: 800;
      letter-spacing: -0.2px;
      color: var(--text);
    }
    .live-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      color: var(--accent-green);
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 3px 9px;
      border-radius: 9999px;
    }
    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background-color: var(--accent-green);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    /* TOKEN MARKET PILL */
    .token-pill {
      background: rgba(16, 24, 39, 0.85);
      border: 1px solid rgba(251, 191, 36, 0.35);
      padding: 5px 12px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: var(--text);
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .token-pill:hover {
      border-color: rgba(251, 191, 36, 0.7);
      background: rgba(251, 191, 36, 0.08);
      transform: translateY(-1px);
    }
    .token-badge-icon {
      font-size: 16px;
    }
    .token-col {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .token-header-line {
      display: flex;
      align-items: center;
      gap: 6px;
      line-height: 1.2;
    }
    .token-symbol {
      font-weight: 800;
      color: #fbbf24;
      font-size: 12px;
      letter-spacing: -0.2px;
    }
    .token-price {
      font-weight: 700;
      color: #fff;
      font-size: 12px;
      font-family: monospace;
    }
    .token-change {
      font-size: 10.5px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 4px;
    }
    .change-up { color: #34d399; background: rgba(16, 185, 129, 0.15); }
    .change-down { color: #f43f5e; background: rgba(244, 63, 94, 0.15); }
    .token-sub-line {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 10px;
      color: var(--text-dim);
    }
    .dex-tag {
      color: #38bdf8;
      font-weight: 600;
    }

    .timer-pill {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      padding: 6px 12px;
      border-radius: 10px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
    }
    .timer-pill b {
      color: #f8fafc;
      font-family: monospace;
      font-size: 13px;
    }

    .btn-privacy-all {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--text);
      padding: 7px 12px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .btn-privacy-all:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.25);
    }
    .btn-privacy-all.active {
      background: rgba(245, 158, 11, 0.15);
      border-color: rgba(245, 158, 11, 0.4);
      color: #fbbf24;
    }

    /* CONTAINER */
    .container {
      width: 96%;
      max-width: 1720px;
      margin: 0 auto;
      padding: 20px 0;
    }

    /* VIEW SWITCHING */
    .view-panel {
      display: none;
    }
    .view-panel.active {
      display: block;
      animation: fadeIn 0.2s ease-in-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* SUMMARY GRIDS */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 1200px) {
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 640px) {
      .summary-grid { grid-template-columns: 1fr; }
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
      transition: border-color 0.2s;
    }
    .stat-card:hover {
      border-color: var(--card-hover-border);
    }
    .stat-icon {
      font-size: 26px;
      width: 46px;
      height: 46px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--card-border);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .stat-data {
      flex: 1;
      min-width: 0;
    }
    .stat-label {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .stat-val {
      font-size: 19px;
      font-weight: 800;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .stat-badge-delta {
      font-size: 11px;
      font-weight: 600;
      color: #34d399;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.25);
      padding: 2px 7px;
      border-radius: 6px;
      font-family: sans-serif;
    }

    /* ACTION BUTTONS IN WITHDRAW SUMMARY */
    .quick-actions-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      justify-content: center;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 12px 16px;
    }
    .btn-action-primary {
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      color: #fff;
      border: 1px solid rgba(52, 211, 153, 0.4);
      font-weight: 700;
      font-size: 12.5px;
      padding: 8px 12px;
      border-radius: 9px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .btn-action-primary:hover {
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
      transform: translateY(-1px);
    }
    .btn-action-purple {
      background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
      color: #fff;
      border: 1px solid rgba(192, 132, 252, 0.4);
      font-weight: 700;
      font-size: 11.5px;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .btn-action-purple:hover {
      box-shadow: 0 4px 14px rgba(168, 85, 247, 0.35);
      transform: translateY(-1px);
    }
    .btn-card-battle {
      width: 100%;
      padding: 7px 10px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 11px;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.2s ease;
    }
    .energy-buy-strip {
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(255, 255, 255, 0.025);
      padding: 4px 6px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.07);
    }
    .energy-buy-title {
      font-size: 10px;
      font-weight: 800;
      color: #38bdf8;
      white-space: nowrap;
    }
    .btn-buy-energy {
      flex: 1;
      padding: 5px 3px;
      border-radius: 6px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(52, 211, 153, 0.3);
      color: #34d399;
      font-weight: 700;
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .btn-buy-energy:hover {
      background: rgba(16, 185, 129, 0.25);
      border-color: #34d399;
      transform: translateY(-1px);
    }
    .btn-buy-energy small {
      font-size: 8.5px;
      opacity: 0.85;
      font-weight: normal;
    }
    .btn-row-dual {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .btn-action-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text);
      border: 1px solid var(--card-border);
      font-weight: 700;
      font-size: 11.5px;
      padding: 7px 10px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .btn-action-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.25);
    }

    /* SECTION TITLE */
    .section-title {
      font-size: 17px;
      font-weight: 800;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      letter-spacing: -0.2px;
    }
    .section-left-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* ACCOUNTS GRID */
    .accounts-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 30px;
    }
    @media (max-width: 1750px) {
      .accounts-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 1250px) {
      .accounts-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 800px) {
      .accounts-grid { grid-template-columns: minmax(0, 1fr); }
    }

    /* ACC CARD SLEEK STYLING */
    .acc-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 13px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      min-width: 0;
      overflow: hidden;
    }
    .acc-card:hover {
      border-color: var(--card-hover-border);
      transform: translateY(-2px);
    }

    /* ACC CARD HEADER */
    .acc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 8px;
    }
    .acc-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .acc-id-pill {
      font-size: 10.5px;
      font-weight: 800;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--text-muted);
      padding: 2px 6px;
      border-radius: 6px;
      font-family: monospace;
    }
    .acc-names {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .acc-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .acc-name {
      font-size: 14px;
      font-weight: 800;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .btn-card-privacy {
      background: none;
      border: none;
      color: var(--text-dim);
      cursor: pointer;
      font-size: 11px;
      padding: 2px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      transition: color 0.15s;
    }
    .btn-card-privacy:hover { color: #fff; }
    .btn-card-privacy.masked { color: #fbbf24; }
    .acc-farm-sub {
      font-size: 10.5px;
      color: var(--text-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* STATUS BADGE */
    .status-badge {
      font-size: 10.5px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .badge-active { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-battle { background: rgba(168, 85, 247, 0.18); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); }
    .badge-cooldown { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-warn { background: rgba(244, 63, 94, 0.18); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.35); }
    .badge-rest { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.25); }

    /* CROP STRIP */
    .crop-strip {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
    }
    .crop-strip-left {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      color: #38bdf8;
    }
    .crop-strip-right {
      font-family: monospace;
      font-weight: 700;
      color: #34d399;
    }

    /* VILLAGE INCOME STRIP (NEW) */
    .income-strip {
      background: linear-gradient(90deg, rgba(245, 158, 11, 0.08) 0%, rgba(217, 119, 6, 0.14) 100%);
      border: 1px solid rgba(245, 158, 11, 0.32);
      border-radius: 8px;
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      position: relative;
      overflow: hidden;
    }
    .income-strip.has-income {
      border-color: rgba(245, 158, 11, 0.55);
      background: linear-gradient(90deg, rgba(245, 158, 11, 0.14) 0%, rgba(217, 119, 6, 0.22) 100%);
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.12);
    }
    .income-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .income-star {
      font-size: 14px;
      color: #fbbf24;
      line-height: 1;
    }
    .income-meta {
      display: flex;
      flex-direction: column;
    }
    .income-label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      color: #fbbf24;
    }
    .income-rate {
      font-size: 9.5px;
      color: #fde68a;
      font-family: monospace;
    }
    .income-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .income-val {
      font-size: 12px;
      font-weight: 800;
      color: #fef08a;
      font-family: monospace;
    }
    .income-timer {
      font-size: 9.5px;
      color: var(--text-dim);
    }
    .income-ready-badge {
      color: #34d399;
      font-weight: 700;
    }

    /* 2X2 METRICS GRID */
    .metrics-grid-2x2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 8px;
    }
    .metric-cell {
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      padding: 7px 9px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      overflow: hidden;
    }
    .m-label {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-dim);
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .m-val {
      font-size: 13.5px;
      font-weight: 800;
      color: var(--text);
      font-family: monospace;
    }
    .m-sub {
      font-size: 9.5px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* PROGRESS GAUGES */
    .gauges-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .gauge-row {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .gauge-top {
      display: flex;
      justify-content: space-between;
      font-size: 10.5px;
    }
    .gauge-title {
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .gauge-val {
      font-family: monospace;
      font-weight: 700;
    }
    .gauge-track {
      height: 5px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 9999px;
      overflow: hidden;
    }
    .gauge-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.4s ease;
    }
    .fill-battle { background: linear-gradient(90deg, #a855f7, #c084fc); }
    .fill-harvest { background: linear-gradient(90deg, #10b981, #34d399); }
    .gauge-info {
      font-size: 9.5px;
      color: var(--text-dim);
      display: flex;
      justify-content: space-between;
    }

    /* WORKFLOW FOOTER */
    .workflow-bar {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      padding: 6px 9px;
      font-size: 10.5px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      overflow: hidden;
    }
    .workflow-bar span:first-child {
      flex-shrink: 0;
    }
    .workflow-bar span:last-child {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* WITHDRAW ACCOUNT CARDS (VIEW WITHDRAW) */
    .wallet-accounts-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 30px;
    }
    @media (max-width: 1400px) {
      .wallet-accounts-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 850px) {
      .wallet-accounts-grid { grid-template-columns: minmax(0, 1fr); }
    }

    .w-acc-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      transition: all 0.2s ease;
      min-width: 0;
      overflow: hidden;
    }
    .w-acc-card:hover {
      border-color: var(--card-hover-border);
      transform: translateY(-2px);
    }
    .w-addr-box {
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 6px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
    }
    .w-addr-text {
      font-family: monospace;
      color: #94a3b8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .w-addr-links {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-copy-addr {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: #fff;
      border-radius: 5px;
      padding: 2px 6px;
      font-size: 10px;
      cursor: pointer;
    }
    .btn-copy-addr:hover { background: rgba(255,255,255,0.15); }

    /* IN-GAME WITHDRAW BOX (PARCHMENT / GOLD THEME LIKE GAME) */
    .in-game-withdraw-card {
      background: linear-gradient(180deg, rgba(251, 191, 36, 0.08) 0%, rgba(180, 83, 9, 0.06) 100%);
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 7px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }
    .w-kv-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .w-kv-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
    }
    .w-kv-label {
      color: #cbd5e1;
    }
    .w-kv-val {
      font-family: monospace;
      font-weight: 700;
      color: #f8fafc;
    }
    .w-kv-highlight {
      padding: 3px 0;
      border-top: 1px dashed rgba(251, 191, 36, 0.25);
      border-bottom: 1px dashed rgba(251, 191, 36, 0.25);
      margin: 2px 0;
    }
    .w-kv-bold {
      font-size: 13.5px;
      font-weight: 900;
      color: #fbbf24;
      font-family: monospace;
    }
    .w-progress-track {
      height: 6px;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(251, 191, 36, 0.25);
      border-radius: 9999px;
      overflow: hidden;
      margin-top: 2px;
    }
    .w-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #f59e0b, #fbbf24);
      border-radius: 9999px;
      transition: width 0.3s ease;
    }

    .w-chain-mini-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .w-chain-pill {
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .w-chain-ico { font-size: 14px; }
    .w-chain-meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .w-chain-lbl {
      font-size: 9px;
      font-weight: 700;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .w-chain-val {
      font-size: 11.5px;
      font-weight: 800;
      font-family: monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .w-balances-stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .w-bal-row {
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 9px;
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .w-bal-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .w-bal-icon { font-size: 18px; }
    .w-bal-meta {
      display: flex;
      flex-direction: column;
    }
    .w-bal-title {
      font-size: 10.5px;
      font-weight: 700;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .w-bal-sub {
      font-size: 10px;
      color: var(--text-dim);
    }
    .w-bal-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .w-bal-amount {
      font-size: 13.5px;
      font-weight: 800;
      font-family: monospace;
    }
    .w-bal-usd {
      font-size: 10.5px;
      color: var(--text-dim);
    }

    .w-actions-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 4px;
    }
    .btn-w-withdraw {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.3) 100%);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399;
      font-weight: 700;
      font-size: 12px;
      padding: 9px 8px;
      border-radius: 9px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .btn-w-withdraw:hover:not(:disabled) {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.35) 0%, rgba(5, 150, 105, 0.5) 100%);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
    }
    .btn-w-withdraw:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      border-color: rgba(255,255,255,0.08);
      color: #64748b;
    }
    .btn-w-send {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(37, 99, 235, 0.25) 100%);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #38bdf8;
      font-weight: 700;
      font-size: 12px;
      padding: 9px 8px;
      border-radius: 9px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .btn-w-send:hover:not(:disabled) {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.3) 0%, rgba(37, 99, 235, 0.4) 100%);
      box-shadow: 0 4px 12px rgba(56, 189, 248, 0.2);
    }
    .btn-w-send:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      border-color: rgba(255,255,255,0.08);
      color: #64748b;
    }

    /* HISTORY TABLE */
    .history-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 30px;
    }
    .history-table-wrap {
      overflow-x: auto;
    }
    .history-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }
    .history-table th {
      padding: 10px 12px;
      font-weight: 700;
      color: var(--text-dim);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      text-transform: uppercase;
      font-size: 10.5px;
      letter-spacing: 0.4px;
    }
    .history-table td {
      padding: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      color: var(--text);
    }
    .history-table tr:hover td {
      background: rgba(255,255,255,0.02);
    }
    .tx-badge {
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 10.5px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .tx-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .tx-failed { background: rgba(244, 63, 94, 0.15); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.3); }
    .tx-pending { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }

    /* LOG SECTION (DASHBOARD) */
    .log-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px;
    }
    .log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .log-tabs {
      display: flex;
      gap: 8px;
    }
    .btn-tab {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-tab.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.4);
      color: #38bdf8;
    }
    .log-console {
      background: #05080f;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 14px;
      font-family: "Cascadia Code", "Fira Code", monospace;
      font-size: 11.5px;
      height: 260px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
      color: #cbd5e1;
    }

    /* TOAST NOTIFICATIONS */
    .toast-container {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }
    .toast-msg {
      pointer-events: auto;
      min-width: 320px;
      max-width: 440px;
      background: rgba(13, 19, 33, 0.95);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 14px 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      display: flex;
      align-items: flex-start;
      gap: 12px;
      animation: slideIn 0.25s ease-out;
      transition: all 0.2s ease;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .toast-icon { font-size: 20px; flex-shrink: 0; }
    .toast-body { flex: 1; min-width: 0; }
    .toast-title { font-size: 13px; font-weight: 800; color: #fff; margin-bottom: 2px; }
    .toast-text { font-size: 11.5px; color: var(--text-muted); line-height: 1.35; }
    .toast-close {
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 16px;
      cursor: pointer;
      padding: 0 2px;
    }
    .toast-close:hover { color: #fff; }
    .toast-success { border-left: 4px solid #10b981; }
    .toast-error { border-left: 4px solid #f43f5e; }
    .toast-warn { border-left: 4px solid #f59e0b; }
    .toast-info { border-left: 4px solid #38bdf8; }

    /* MODALS */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(6px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-overlay.open {
      display: flex;
      animation: fadeIn 0.15s ease-out;
    }
    .modal-card {
      background: #0d1321;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.8);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-title { font-size: 16px; font-weight: 800; color: #fff; }
    .modal-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-label {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .form-input, .form-select {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 10px 12px;
      color: #fff;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }
    .form-input:focus, .form-select:focus {
      border-color: #38bdf8;
    }
    .input-with-action {
      position: relative;
      display: flex;
      align-items: center;
    }
    .input-with-action input {
      width: 100%;
      padding-right: 60px;
    }
    .btn-max {
      position: absolute;
      right: 8px;
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #38bdf8;
      border-radius: 5px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }
    .modal-footer {
      padding: 14px 20px;
      background: rgba(0, 0, 0, 0.2);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
  </style>
</head>
<body>

  <div class="app-layout">
    <!-- LEFT SIDEBAR -->
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon-box">🌾</div>
        <div class="brand-title-wrap">
          <span class="brand-title">Farming Season</span>
          <span class="brand-tag">AUTOMATION SUITE</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <div class="nav-header">NAVIGASI UTAMA</div>
        <button class="nav-btn active" data-view="dashboard" onclick="switchView('dashboard')">
          <span class="nav-icon">📊</span>
          <div class="nav-text">
            <span class="nav-title">Dashboard</span>
            <span class="nav-sub">Monitoring & Multi-Bot</span>
          </div>
        </button>

        <button class="nav-btn" data-view="withdraw" onclick="switchView('withdraw')">
          <span class="nav-icon">💳</span>
          <div class="nav-text">
            <span class="nav-title">Withdraw & Wallet</span>
            <span class="nav-sub">On-Chain Robinhood</span>
          </div>
          <span class="nav-badge-onchain">On-Chain</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="network-badge-box">
          <div class="network-row-title">
            <span class="pulse-dot"></span>
            <span>Robinhood Chain</span>
          </div>
          <div class="network-row-sub">
            <span>Chain ID: <b>4663</b></span>
            <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noopener noreferrer">Explorer ↗</a>
          </div>
        </div>
      </div>
    </aside>

    <!-- MAIN CONTENT AREA -->
    <div class="main-wrapper">
      <!-- STICKY TOP HEADER -->
      <header>
        <div class="header-inner">
          <div class="header-breadcrumb">
            <h1 class="crumb-view-title" id="crumbViewTitle">📊 Dashboard</h1>
            <span class="live-badge"><span class="pulse-dot"></span> LIVE CONNECTED</span>
          </div>

          <div class="header-actions">
            <!-- TOKEN MARKET PILL -->
            <a id="dexscreenerLink" href="https://dexscreener.com/robinhood/0x2474146acce0e699ce4f3b6b751356bc97798ddf089ca1d67f571427ad6aa335" target="_blank" rel="noopener noreferrer" class="token-pill" title="Klik untuk membuka grafik harga real-time di DexScreener">
              <div class="token-badge-icon">🪙</div>
              <div class="token-col">
                <div class="token-header-line">
                  <span class="token-symbol">$SEASON</span>
                  <span class="token-price" id="tokenPrice">Memuat...</span>
                  <span class="token-change change-up" id="tokenChange">--%</span>
                </div>
                <div class="token-sub-line">
                  <span>MCap: <b id="tokenMcap" style="color:#f8fafc;">$--</b></span>
                  <span class="dex-tag">DexScreener ↗</span>
                </div>
              </div>
            </a>

            <!-- TIMERS -->
            <div class="timer-pill">
              <span>⏳ Reset:</span>
              <b id="dailyResetTimer">--:--:--</b>
            </div>
            <div class="timer-pill">
              <span>🕒 Waktu:</span>
              <b id="serverTime">--:--:--</b>
            </div>

            <!-- GLOBAL PRIVACY TOGGLE -->
            <button id="btnPrivacyAll" class="btn-privacy-all" onclick="toggleAllPrivacy()" title="Sembunyikan/Tampilkan nama akun & username di seluruh dashboard">
              <span id="privacyIcon">👁️</span> <span id="privacyLabel">Sensor Semua Nama</span>
            </button>
          </div>
        </div>
      </header>

      <!-- VIEW 1: DASHBOARD (MULTI-ACCOUNT MONITOR) -->
      <main id="view-dashboard" class="view-panel active">
        <div class="container">
          <!-- SUMMARY SECTION -->
          <div class="summary-grid">
            <div class="stat-card">
              <div class="stat-icon" style="color: #38bdf8;">👥</div>
              <div class="stat-data">
                <div class="stat-label">Total Akun Aktif</div>
                <div class="stat-val" id="sumAccounts">0</div>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon" style="color: #fbbf24;">🪙</div>
              <div class="stat-data">
                <div class="stat-label">Total Saldo In-Game</div>
                <div class="stat-val" id="sumSeason" style="color: #fbbf24;">0 🪙</div>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon" style="color: #34d399;">🌾</div>
              <div class="stat-data">
                <div class="stat-label">Total Harvest Loot</div>
                <div class="stat-val" id="sumHarvest" style="color: #34d399;">0 / 0</div>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon" style="color: #c084fc;">⚔️</div>
              <div class="stat-data">
                <div class="stat-label">Total Battle Loot</div>
                <div class="stat-val" id="sumBattle" style="color: #c084fc;">0 / 0</div>
              </div>
            </div>
          </div>

          <!-- ACCOUNTS SECTION -->
          <div class="section-title">
            <div class="section-left-title">
              <span>🚜 Status Akun & Alur Kerja</span>
            </div>
            <div>
              <button class="btn-action-purple" onclick="triggerBattleAll()" title="Mulai battle otomatis untuk semua akun dengan energi >= 5 (Target Max Wave 30)">
                <span>⚔️</span><span>Mulai Battle Semua Akun (⚡ ≥ 5)</span>
              </button>
            </div>
          </div>

          <div class="accounts-grid" id="accountsGrid">
            <!-- Rendered by JS -->
          </div>

          <!-- LOGS SECTION -->
          <div class="log-section">
            <div class="log-header">
              <div class="section-left-title" style="font-size: 15px; font-weight: 800;">
                <span>📜 Log Aktivitas Bot</span>
              </div>
              <div class="log-tabs">
                <button class="btn-tab active" id="btnLogAll" onclick="setLogType('all')">Semua Log</button>
                <button class="btn-tab" id="btnLogError" onclick="setLogType('error')">Hanya Error</button>
              </div>
            </div>
            <div class="log-console" id="logConsole">Memuat log...</div>
          </div>
        </div>
      </main>

      <!-- VIEW 2: WITHDRAW & WALLET (ON-CHAIN MANAGEMENT) -->
      <main id="view-withdraw" class="view-panel">
        <div class="container">
          <!-- WITHDRAW SUMMARY SECTION -->
          <div class="summary-grid">
            <div class="stat-card">
              <div class="stat-icon" style="color: #fbbf24;">🪙</div>
              <div class="stat-data">
                <div class="stat-label">Total Saldo In-Game</div>
                <div class="stat-val" id="wSumInGame" style="color: #fbbf24;">0 🪙</div>
                <div class="stat-label" id="wSumInGameUsd" style="font-size: 10px; margin-top: 3px;">~$0.00 USD • Siap Ditarik</div>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon" style="color: #38bdf8;">💎</div>
              <div class="stat-data">
                <div class="stat-label">Total On-Chain SEASON</div>
                <div class="stat-val" id="wSumOnChainSeason" style="color: #38bdf8;">0 🪙</div>
                <div class="stat-label" id="wSumOnChainSeasonUsd" style="font-size: 10px; margin-top: 3px;">~$0.00 USD • Di Wallet</div>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon" style="color: #c084fc;">⛽</div>
              <div class="stat-data">
                <div class="stat-label">Total Fee ETH (Gas)</div>
                <div class="stat-val" id="wSumOnChainEth" style="color: #c084fc;">0.0000 ETH</div>
                <div class="stat-label" id="wSumOnChainEthUsd" style="font-size: 10px; margin-top: 3px;">~$0.00 USD (ETH)</div>
              </div>
            </div>

            <!-- QUICK ACTIONS CARD -->
            <div class="quick-actions-card">
              <button class="btn-action-primary" onclick="triggerWithdrawAll()">
                <span>⚡ Tarik Semua Saldo In-Game</span>
              </button>
              <div class="btn-row-dual">
                <button class="btn-action-secondary" onclick="openSendModal()">
                  <span>📤 Kirim Token</span>
                </button>
                <button class="btn-action-secondary" onclick="refreshWalletStatus(true)">
                  <span>🔄 Refresh</span>
                </button>
              </div>
            </div>
          </div>

          <!-- WALLET ACCOUNTS GRID -->
          <div class="section-title">
            <div class="section-left-title">
              <span>💳 Status Akun & Dompet On-Chain</span>
            </div>
          </div>

          <div class="wallet-accounts-grid" id="walletAccountsGrid">
            <!-- Rendered by JS -->
          </div>

          <!-- TRANSACTION HISTORY -->
          <div class="section-title">
            <div class="section-left-title">
              <span>📜 Riwayat Transaksi (Withdraw & Transfer)</span>
            </div>
          </div>

          <div class="history-card">
            <div class="history-table-wrap">
              <table class="history-table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Akun</th>
                    <th>Tipe Transaksi</th>
                    <th>Jumlah</th>
                    <th>Status</th>
                    <th>Hash Transaksi</th>
                    <th>Detail / Keterangan</th>
                  </tr>
                </thead>
                <tbody id="walletHistoryBody">
                  <tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">Belum ada riwayat transaksi.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>

  <!-- TOAST NOTIFICATION CONTAINER -->
  <div class="toast-container" id="toastContainer"></div>

  <!-- MODAL: SEND SEASON TOKEN -->
  <div class="modal-overlay" id="modalSendToken">
    <div class="modal-card">
      <div class="modal-header">
        <span class="modal-title">📤 Kirim Token SEASON On-Chain</span>
        <button class="toast-close" onclick="closeSendModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Akun Pengirim</label>
          <select id="sendFromAccount" class="form-select" onchange="updateSendModalAvailable()">
            <!-- Options populated by JS -->
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Alamat Wallet Tujuan (Robinhood Chain)</label>
          <input type="text" id="sendToAddress" class="form-input" placeholder="0x... (Alamat EVM 42 karakter)">
        </div>
        <div class="form-group">
          <label class="form-label">Jumlah SEASON Yang Dikirim</label>
          <div class="input-with-action">
            <input type="number" id="sendAmount" class="form-input" placeholder="0.0" step="any">
            <button type="button" class="btn-max" onclick="setSendMax()">MAX</button>
          </div>
          <span id="sendBalanceHint" style="font-size: 11px; color: var(--text-dim); margin-top: 3px;">Tersedia: 0 SEASON</span>
        </div>
        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 10px; font-size: 11.5px; color: #fde68a;">
          ℹ️ Gas fee dipotong dari saldo ETH akun pengirim di Robinhood Chain (~0.00001 ETH).
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-action-secondary" onclick="closeSendModal()">Batal</button>
        <button class="btn-action-primary" id="btnConfirmSend" onclick="submitSendToken()">Kirim Sekarang 🚀</button>
      </div>
    </div>
  </div>

  <script>
    let latestStatusData = null;
    let latestWalletData = null;
    let activeLogType = 'all';
    let lastLogContent = '';
    let currentView = 'dashboard';

    // Privacy Masking state
    let isAllMasked = localStorage.getItem('fs_privacy_all') === 'true';
    let maskedAccounts = new Set(JSON.parse(localStorage.getItem('fs_masked_accounts') || '[]'));

    function savePrivacyState() {
      localStorage.setItem('fs_privacy_all', isAllMasked);
      localStorage.setItem('fs_masked_accounts', JSON.stringify([...maskedAccounts]));
      updatePrivacyButtonUi();
      if (latestStatusData) renderDashboard(latestStatusData);
      if (latestWalletData) renderWalletView(latestWalletData);
    }

    function toggleAllPrivacy() {
      isAllMasked = !isAllMasked;
      savePrivacyState();
    }

    function toggleCardPrivacy(accId) {
      if (isAllMasked) {
        isAllMasked = false;
        maskedAccounts.clear();
      }
      if (maskedAccounts.has(accId)) {
        maskedAccounts.delete(accId);
      } else {
        maskedAccounts.add(accId);
      }
      savePrivacyState();
    }

    function isAccountMasked(accId) {
      return isAllMasked || maskedAccounts.has(accId);
    }

    function updatePrivacyButtonUi() {
      const btn = document.getElementById('btnPrivacyAll');
      const icon = document.getElementById('privacyIcon');
      const label = document.getElementById('privacyLabel');
      if (isAllMasked) {
        btn.classList.add('active');
        icon.textContent = '🕶️';
        label.textContent = 'Sensor Aktif (Semua)';
      } else {
        btn.classList.remove('active');
        icon.textContent = '👁️';
        label.textContent = 'Sensor Semua Nama';
      }
    }

    // View Switching
    function switchView(viewName) {
      currentView = viewName;
      document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === viewName);
      });
      document.querySelectorAll('.view-panel').forEach(p => {
        p.classList.toggle('active', p.id === 'view-' + viewName);
      });

      const titleEl = document.getElementById('crumbViewTitle');
      if (viewName === 'dashboard') {
        titleEl.textContent = '📊 Dashboard';
      } else if (viewName === 'withdraw') {
        titleEl.textContent = '💳 Withdraw & On-Chain Wallet';
        refreshWalletStatus();
      }
    }

    // Toast Notifications
    function showToast(type, title, text, duration = 4000) {
      const container = document.getElementById('toastContainer');
      const icons = {
        success: '✅',
        error: '❌',
        warn: '⚠️',
        info: 'ℹ️'
      };
      const toast = document.createElement('div');
      toast.className = 'toast-msg toast-' + type;
      toast.innerHTML = \`
        <div class="toast-icon">\${icons[type] || '🔔'}</div>
        <div class="toast-body">
          <div class="toast-title">\${title}</div>
          <div class="toast-text">\${text}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
      \`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 250);
      }, duration);
    }

    function formatNumber(n) {
      if (n === null || n === undefined || isNaN(n)) return '0';
      return Number(n).toLocaleString('en-US');
    }

    function formatUsd(n) {
      if (!n || isNaN(n)) return '$0.00';
      return '$' + Number(n).toFixed(2);
    }

    function copyToClipboard(text, msg = 'Alamat disalin!') {
      navigator.clipboard.writeText(text).then(() => {
        showToast('info', 'Tersalin', msg, 2000);
      });
    }

    // Token Market Pill Update
    function updateTokenPill(tm) {
      if (!tm) return;
      const priceEl = document.getElementById('tokenPrice');
      const changeEl = document.getElementById('tokenChange');
      const mcapEl = document.getElementById('tokenMcap');

      if (priceEl && tm.priceUsd !== null && tm.priceUsd !== undefined) {
        const p = Number(tm.priceUsd);
        if (p > 0) {
          priceEl.textContent = p < 0.001 ? '$' + p.toFixed(6) : (p < 1 ? '$' + p.toFixed(4) : '$' + p.toFixed(2));
        } else {
          priceEl.textContent = '$0.000000';
        }
      }

      if (changeEl && tm.priceChange24h !== null && tm.priceChange24h !== undefined) {
        const chg = Number(tm.priceChange24h);
        const sign = chg >= 0 ? '+' : '';
        changeEl.textContent = sign + chg.toFixed(2) + '%';
        changeEl.className = 'token-change ' + (chg >= 0 ? 'change-up' : 'change-down');
      }

      if (mcapEl && tm.marketCap !== null && tm.marketCap !== undefined) {
        const mc = Number(tm.marketCap);
        if (mc >= 1e6) {
          mcapEl.textContent = '$' + (mc / 1e6).toFixed(2) + 'M';
        } else if (mc >= 1e3) {
          mcapEl.textContent = '$' + (mc / 1e3).toFixed(1) + 'K';
        } else if (mc > 0) {
          mcapEl.textContent = '$' + Math.round(mc).toLocaleString();
        } else {
          mcapEl.textContent = '$--';
        }
      }
    }

    // Polling API Status
    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const data = await res.json();
        latestStatusData = data;
        renderDashboard(data);
      } catch (e) {
        console.error('Gagal mengambil data status:', e);
      }
    }

    async function updateDashboard() {
      return await fetchStatus();
    }

    async function fetchLogs() {
      try {
        const res = await fetch('/api/logs?type=' + activeLogType + '&lines=40');
        if (!res.ok) return;
        const data = await res.json();
        if (data.logs && data.logs !== lastLogContent) {
          lastLogContent = data.logs;
          renderLogs(data.logs);
        }
      } catch (e) {}
    }

    function setLogType(type) {
      activeLogType = type;
      document.getElementById('btnLogAll').classList.toggle('active', type === 'all');
      document.getElementById('btnLogError').classList.toggle('active', type === 'error');
      fetchLogs();
    }

    function renderLogs(logsText) {
      const el = document.getElementById('logConsole');
      if (!logsText || logsText.trim() === '') {
        el.textContent = 'Belum ada log aktivitas...';
        return;
      }
      el.textContent = logsText;
      el.scrollTop = el.scrollHeight;
    }

    // Render Dashboard View (4 Cards Per Row)
    function renderDashboard(data) {
      const s = data.summary;
      const seasonPrice = (data.tokenMarket && data.tokenMarket.priceUsd) || (window.__seasonPrice || 0.00035);
      const totalSeasonUsd = (s.totalSeason || 0) * seasonPrice;

      document.getElementById('sumAccounts').textContent = s.totalAccounts;
      document.getElementById('sumSeason').innerHTML = formatNumber(s.totalSeason) + ' <span style="font-size:12px;font-weight:700;">$SEASON</span> <span style="font-size:11px;color:var(--text-dim);font-weight:normal;">(' + formatUsd(totalSeasonUsd) + ' USD)</span> <span class="stat-badge-delta">+' + formatNumber(s.totalSeasonToday) + ' hr ini</span>' + (s.totalVillageIncomePending > 0 ? ' <span style="font-size:11px;color:#fbbf24;font-family:sans-serif;font-weight:700;margin-left:6px;" title="Total Village Income siap klaim">⭐ +' + formatNumber(s.totalVillageIncomePending) + '</span>' : '');
      document.getElementById('sumBattle').textContent = formatNumber(s.totalBattleEarned) + ' / ' + formatNumber(s.totalBattleCap);
      document.getElementById('sumHarvest').textContent = formatNumber(s.totalHarvestEarned) + ' / ' + formatNumber(s.totalHarvestCap);

      if (data.tokenMarket) updateTokenPill(data.tokenMarket);

      const grid = document.getElementById('accountsGrid');
      grid.innerHTML = data.accounts.map(acc => {
        const c = acc.counts || { ready: 0, growing: 0, empty: 0 };
        const fallbackB = (seasonPrice > 0) ? Math.round(0.55 / seasonPrice) : 1687;
        const fallbackH = (seasonPrice > 0) ? Math.round(0.70 / seasonPrice) : 2147;
        const b = acc.battleLoot || { earned: 0, cap: fallbackB };
        const h = acc.harvestLoot || { earned: 0, cap: fallbackH };
        const tracker = acc.dailyTracker || {};
        const vInc = acc.villageIncome || { accumulated: 0, rate: '+27/h', isFull: false };
        const accSeasonUsd = (acc.seasonTokens || 0) * seasonPrice;

        const bPct = b.cap > 0 ? Math.min(100, Math.round((b.earned / b.cap) * 100)) : 0;
        const hPct = h.cap > 0 ? Math.min(100, Math.round((h.earned / h.cap) * 100)) : 0;
        const energyVal = typeof acc.energy === 'number' ? acc.energy : 0;

        // Village Income claim countdown
        const nowMs = data.timestamp || Date.now();
        let claimCountdownText = '';
        if (vInc.isFull) {
          claimCountdownText = '<span style="color:#f43f5e;font-weight:700;">⚠️ Full · Auto-claim!</span>';
        } else if (vInc.accumulated >= 1 && vInc.nextClaimAt && nowMs >= vInc.nextClaimAt) {
          claimCountdownText = '<span class="income-ready-badge">🟢 Siap Claim!</span>';
        } else if (vInc.nextClaimAt && vInc.nextClaimAt > nowMs) {
          const remSec = Math.ceil((vInc.nextClaimAt - nowMs) / 1000);
          let timeStr = '';
          if (remSec >= 3600) {
            const h = Math.floor(remSec / 3600);
            const m = Math.floor((remSec % 3600) / 60);
            const s = remSec % 60;
            timeStr = h + 'j ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
          } else {
            const m = Math.floor(remSec / 60);
            const s = remSec % 60;
            timeStr = m + 'm ' + String(s).padStart(2, '0') + 's';
          }
          claimCountdownText = '⏳ Claim: ' + timeStr;
        } else {
          claimCountdownText = '⏳ Cooldown 60m';
        }

        // Privacy masking logic
        const isMasked = isAccountMasked(acc.id);
        const displayName = isMasked ? 'Akun #' + acc.id : acc.name;
        const displayFarm = isMasked ? '••••••••••••' : (acc.farmName || 'Ladang #' + acc.id);
        const cardPrivIcon = isMasked ? '🕶️' : '👁️';
        const cardPrivTitle = isMasked ? 'Buka sensor nama akun ini' : 'Sensor nama akun ini';
        const cardPrivClass = isMasked ? 'masked' : '';

        const isBattling = (acc.stage === 'battle' || acc.currentTask === 'battling') &&
          !/tumbuh|grinding harvest|hewan ok|standby|istirahat|selesai battle|radish in/i.test(acc.loopStatus || '') &&
          /wave|lobby|pertempuran|mulai battle/i.test(acc.loopStatus || '');

        // Data Ternak, Cooldown Makan & Status Produk
        const anim = acc.animals || {};
        const animTotal = anim.total || 10;
        const animHungry = anim.hungry || 0;
        const animProd = anim.productsReady ?? anim.products ?? 0;

        let mealCountdownText = '';
        if (anim.nextMealAt && anim.nextMealAt > nowMs) {
          const remSec = Math.ceil((anim.nextMealAt - nowMs) / 1000);
          const h = Math.floor(remSec / 3600);
          const m = Math.floor((remSec % 3600) / 60);
          mealCountdownText = h > 0 ? (h + 'j ' + m + 'm') : (m + 'm');
        } else if (anim.nextMeal && anim.nextMeal !== '-') {
          mealCountdownText = anim.nextMeal.replace(/h/g, 'j');
        } else {
          const d = new Date(nowMs);
          const hour = d.getHours();
          const nextD = new Date(nowMs);
          if (hour < 12) {
            nextD.setHours(12, 0, 0, 0);
          } else {
            nextD.setDate(nextD.getDate() + 1);
            nextD.setHours(0, 0, 0, 0);
          }
          const remSec = Math.ceil((nextD.getTime() - nowMs) / 1000);
          const h = Math.floor(remSec / 3600);
          const m = Math.floor((remSec % 3600) / 60);
          mealCountdownText = h > 0 ? (h + 'j ' + m + 'm') : (m + 'm');
        }

        let animProdBadge = '';
        if (animProd > 0) {
          if (anim.isReadyForBulkCollect) {
            animProdBadge = '<span style="font-size: 9px; padding: 1px 5px; border-radius: 4px; background: rgba(52, 211, 153, 0.18); border: 1px solid #34d399; color: #34d399; font-weight: 700;">🧺 ' + animProd + ' Siap</span>';
          } else {
            animProdBadge = '<span style="font-size: 9px; padding: 1px 5px; border-radius: 4px; background: rgba(251, 191, 36, 0.15); border: 1px solid rgba(251, 191, 36, 0.4); color: #fbbf24; font-weight: 600;" title="' + (anim.collectStatusDesc || 'Menunggu serentak') + '">🧺 ' + animProd + ' Nunggu</span>';
          }
        }

        let animSubColor = '#34d399';
        let animSubText = 'Kenyang (⏳ ' + mealCountdownText + ')';
        let animTitle = 'Semua hewan kenyang. Jadwal makan berikutnya: ' + mealCountdownText + ' lagi';

        if (animHungry > 0) {
          animSubColor = '#f43f5e';
          animSubText = '🔴 ' + animHungry + ' Lapar';
          animTitle = animHungry + ' ekor hewan sedang lapar dan butuh makan!';
        } else if (animProd > 0 && anim.isReadyForBulkCollect) {
          animSubText = 'Kenyang · 🧺 ' + animProd + ' Siap Panen!';
          animTitle = 'Hewan kenyang (Jadwal: ' + mealCountdownText + ') & ' + animProd + ' produk siap dipanen serentak!';
        }

        // Status Badge logic
        let badgeClass = 'badge-active';
        let badgeText = '🟢 Aktif';
        const isCaptchaActive = !!acc.needsCaptcha && !/lolos|selesai|berhasil/i.test(acc.loopStatus || '');
        if (acc.regBalanceAlert || /kurang saldo/i.test(acc.state || '') || /kurang saldo/i.test(acc.loopStatus || '')) {
          badgeClass = 'badge-warn';
          badgeText = '⚠️ Kurang ETH';
        } else if (acc.isBanned || /paused for review|ditinjau dev/i.test(acc.loopStatus)) {
          badgeClass = 'badge-warn';
          badgeText = '⚠️ Ditinjau Dev';
        } else if (isCaptchaActive) {
          badgeClass = 'badge-warn';
          badgeText = '⚡ PRIORITAS 1: CAPTCHA';
        } else if (/syncing|standby|sinkronisasi/i.test(acc.state || '') || /standby|sinkronisasi/i.test(acc.loopStatus || '') || acc.enabled === false) {
          badgeClass = 'badge-cooldown';
          const m = (acc.state || '').match(/\(([^)]+)\)/);
          badgeText = m ? ('⏳ Sync (' + m[1] + ')') : '⏳ Syncing';
        } else if (acc.loopStatus.includes('Reset Harian')) {
          badgeClass = 'badge-rest';
          badgeText = '☕ Istirahat Reset';
        } else if (isBattling) {
          badgeClass = 'badge-battle';
          badgeText = '⚔️ Battle ' + (acc.battleWave ? 'W' + acc.battleWave : '');
        } else if (c.ready > 0) {
          badgeClass = 'badge-active';
          badgeText = '🌾 Siap Panen (' + c.ready + ')';
        } else if (animProd > 0 && anim.isReadyForBulkCollect) {
          badgeClass = 'badge-active';
          badgeText = '🧺 Produk Siap (' + animProd + ')';
        } else if (c.growing > 0) {
          badgeClass = 'badge-cooldown';
          badgeText = '🌱 Tumbuh (' + c.growing + ')';
        } else if (typeof acc.energy === 'number' && acc.energy < 5) {
          badgeClass = 'badge-warn';
          badgeText = '⚡ Low Energy';
        }

        let battleRuns = tracker.battleCount || 0;
        const realisticRuns = b.earned <= 0 ? 0 : Math.max(1, Math.floor((b.earned + 300) / 600));
        if (battleRuns > realisticRuns) {
          battleRuns = realisticRuns;
        }
        let battleSub = 'Battle Hari Ini: ' + battleRuns + 'x';
        if (b.earned >= b.cap && b.cap > 0) battleSub = '🎉 Battle Cap Full!';

        let harvestSub = 'Sisa: ' + formatNumber(Math.max(0, h.cap - h.earned)) + ' SEASON';
        if (h.earned >= h.cap && h.cap > 0) harvestSub = '🎉 Harvest Cap Full!';

        let cropStatusText = acc.nextHarvest && acc.nextHarvest !== '-' ? acc.nextHarvest : (c.ready > 0 ? c.ready + ' Siap Panen!' : (c.growing > 0 ? c.growing + ' Sedang Tumbuh' : 'Petak Kosong'));

        // Hitung estimasi harga token SEASON live untuk paket energy (Base $0.0045 USD / energy)
        const p10Usd = 0.045;
        const p50Usd = 0.225;
        const p100Usd = 0.450;
        const cost10 = seasonPrice > 0 ? Math.ceil(p10Usd / seasonPrice) : 118;
        const cost50 = seasonPrice > 0 ? Math.ceil(p50Usd / seasonPrice) : 590;
        const cost100 = seasonPrice > 0 ? Math.ceil(p100Usd / seasonPrice) : 1180;

        // Tombol Battle Manual on-demand
        let canBattle = false;
        let battleBtnContent = '<span>⚔️</span><span>Mulai Battle (5 ⚡)</span>';
        let battleBtnTitle = 'Mulai battle manual untuk akun ini (Target Max Wave 30)';
        let battleBtnStyle = 'background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: #fff; border: 1px solid rgba(192, 132, 252, 0.4); cursor: pointer;';

        if (isBattling) {
          canBattle = false;
          const wNum = acc.battleWave || 1;
          battleBtnContent = '<span>⚔️</span><span>Sedang Battle (Wave ' + wNum + ')</span>';
          battleBtnTitle = 'Akun sedang bertarung di Wave ' + wNum;
          battleBtnStyle = 'background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); cursor: default;';
        } else if (energyVal >= 5) {
          canBattle = true;
          battleBtnContent = '<span>⚔️</span><span>Mulai Battle (5 ⚡)</span>';
        } else {
          canBattle = false;
          battleBtnContent = '<span>⚡</span><span>Butuh Min 5 Energy</span>';
          battleBtnTitle = 'Energy saat ini ' + energyVal + '/100, butuh minimal 5 energy';
          battleBtnStyle = 'background: rgba(255, 255, 255, 0.04); color: var(--text-dim); border: 1px solid var(--card-border); cursor: not-allowed;';
        }

        let regAlertHtml = '';
        if (acc.regBalanceAlert) {
          regAlertHtml = '<div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:8px;padding:7px 10px;margin-bottom:8px;font-size:11px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
              '<span style="font-weight:700;color:#f87171;">⚠️ Perlu Top Up ETH</span>' +
              '<span style="background:rgba(239,68,68,0.25);color:#fca5a5;padding:1px 6px;border-radius:4px;font-weight:700;">Butuh ~' + acc.regBalanceAlert.needed + ' ETH</span>' +
            '</div>' +
            '<div style="color:#cbd5e1;font-size:10.5px;margin-bottom:5px;">' +
              'Saldo: <b style="color:#f87171;">' + acc.regBalanceAlert.balance + ' ETH</b> (Biaya farm $1 on-chain)' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;background:rgba(0,0,0,0.3);padding:3px 6px;border-radius:4px;font-family:monospace;font-size:10px;">' +
              '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#93c5fd;">' + acc.regBalanceAlert.address + '</span>' +
              '<button data-addr="' + acc.regBalanceAlert.address + '" onclick="copyToClipboard(this.dataset.addr)" style="background:#374151;border:none;color:#fff;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:9.5px;font-weight:600;">Copy</button>' +
            '</div>' +
          '</div>';
        }

        return \`
          <div class="acc-card">
            <!-- HEADER -->
            <div class="acc-header">
              <div class="acc-title-group">
                <span class="acc-id-pill">#\${acc.id}</span>
                <div class="acc-names">
                  <div class="acc-name-row">
                    <span class="acc-name" title="\${displayName}">\${displayName}</span>
                    <button class="btn-card-privacy \${cardPrivClass}" onclick="toggleCardPrivacy(\${acc.id})" title="\${cardPrivTitle}">\${cardPrivIcon}</button>
                  </div>
                  <span class="acc-farm-sub" title="\${displayFarm}">\${displayFarm}</span>
                </div>
              </div>
              <span class="status-badge \${badgeClass}">\${badgeText}</span>
            </div>

            <!-- CROP STRIP -->
            <div class="crop-strip">
              <div class="crop-strip-left">
                <span>🌱</span>
                <span>\${acc.crop || 'Radish'}</span>
              </div>
              <div class="crop-strip-right" style="color: \${c.ready > 0 ? '#34d399' : '#fbbf24'};">
                \${cropStatusText}
              </div>
            </div>

            <!-- VILLAGE INCOME STRIP -->
            <div class="income-strip \${vInc.accumulated > 0 ? 'has-income' : ''}" onclick="manualClaimIncome(\${acc.id})" title="Klik untuk klaim Village Income sekarang (Auto-claim: 5m saat start / 60m siklus)" style="cursor:pointer;">
              <div class="income-left">
                <span class="income-star">⭐</span>
                <div class="income-meta">
                  <span class="income-label">VILLAGE INCOME</span>
                  <span class="income-rate">\${vInc.rate || '+27/h'}</span>
                </div>
              </div>
              <div class="income-right">
                <span class="income-val">+\${formatNumber(vInc.accumulated)} 🪙</span>
                <span class="income-timer">\${claimCountdownText}</span>
              </div>
            </div>

            <!-- 2X2 METRICS GRID -->
            <div class="metrics-grid-2x2">
              <div class="metric-cell">
                <div class="m-label">⚡ ENERGY</div>
                <div class="m-val" style="color: \${energyVal < 10 ? '#f43f5e' : '#38bdf8'};">\${acc.energy} <span style="font-size: 10px; font-weight: normal; color: var(--text-dim);">/ 100</span></div>
                <div class="m-sub">\${energyVal < 5 ? '⚡ Energy Rendah' : 'Tersedia'}</div>
              </div>

              <div class="metric-cell">
                <div class="m-label">🪙 SALDO GAME</div>
                <div class="m-val" style="color: #fbbf24; font-size: 12.5px;">
                  \${formatNumber(acc.seasonTokens)} <span style="font-size: 9.5px; font-weight: normal; color: #a7f3d0;">$SEASON</span>
                </div>
                <div class="m-sub" style="color: #34d399;">(\${formatUsd(accSeasonUsd)} USD) · +\${formatNumber(acc.totalEarnedToday)} hr ini</div>
              </div>

              <div class="metric-cell">
                <div class="m-label">🌾 PETAK LADANG</div>
                <div class="m-val" style="color: #e2e8f0; font-size: 11px;">
                  <span style="color:#34d399;">\${c.ready}M</span> / <span style="color:#fbbf24;">\${c.growing}T</span> / <span style="color:#94a3b8;">\${c.empty}K</span>
                </div>
                <div class="m-sub">\${c.ready > 0 ? c.ready + ' Siap Panen!' : (c.growing > 0 ? c.growing + ' Tumbuh' : 'Kosong')}</div>
              </div>

              <div class="metric-cell">
                <div class="m-label">🐄 TERNAK</div>
                <div class="m-val" style="color: #e2e8f0; font-size: 12px; display: flex; align-items: center; justify-content: space-between;">
                  <span>\${animTotal} <span style="font-size: 9.5px; font-weight: normal; color: var(--text-dim);">ekor</span></span>
                  \${animProdBadge}
                </div>
                <div class="m-sub" style="color: \${animSubColor};" title="\${animTitle}">\${animSubText}</div>
              </div>
            </div>

            <!-- GAUGES -->
            <div class="gauges-section">
              <div class="gauge-row">
                <div class="gauge-top">
                  <span class="gauge-title" style="color: #34d399;">🌾 Harvest Cap</span>
                  <span class="gauge-val" style="color: #34d399;">\${formatNumber(h.earned)} / \${formatNumber(h.cap)} (\${hPct}%)</span>
                </div>
                <div class="gauge-track">
                  <div class="gauge-fill fill-harvest" style="width: \${hPct}%;"></div>
                </div>
                <div class="gauge-info"><span>\${harvestSub}</span></div>
              </div>

              <div class="gauge-row">
                <div class="gauge-top">
                  <span class="gauge-title" style="color: #c084fc;">⚔️ Battle Cap</span>
                  <span class="gauge-val" style="color: #c084fc;">\${formatNumber(b.earned)} / \${formatNumber(b.cap)} (\${bPct}%)</span>
                </div>
                <div class="gauge-track">
                  <div class="gauge-fill fill-battle" style="width: \${bPct}%;"></div>
                </div>
                <div class="gauge-info"><span>\${battleSub}</span></div>
              </div>
            </div>

            \${regAlertHtml}

            <!-- WORKFLOW BAR -->
            <div class="workflow-bar" title="\${acc.loopStatus}">
              <span>⚡</span>
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${acc.loopStatus}</span>
            </div>

            <!-- SILO & FEED BAGS STRIP -->
            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--card-border);border-radius:8px;padding:7px 9px;margin-top:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:5px;">
                  <span style="font-size:13px;">🎪</span>
                  <span style="font-weight:700;font-size:11px;color:var(--text-main);">Silo & Pakan</span>
                </div>
                <span style="font-size:11px;font-weight:700;color:#10b981;">🎒 \${acc.silo?.feed || 0} Bags</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--text-dim);">
                <span>🌾 Wheat: <b style="color:#fbbf24;">\${acc.silo?.wheat || 0}</b></span>
                <span>🌽 Corn: <b style="color:#f59e0b;">\${acc.silo?.corn || 0}</b></span>
                <span>Grain: <b style="color:#38bdf8;">\${acc.silo?.grain || 0}/\${acc.silo?.maxGrain || 245}</b></span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;border-top:1px dashed rgba(255,255,255,0.06);padding-top:5px;font-size:10px;">
                <span style="color:var(--text-dim);">Makan: <b style="color:#fcd34d;">\${acc.silo?.dailyEat || 0} bags/hr</b></span>
                <button onclick="triggerAccountMixFeed(\${acc.id})" \${acc.silo?.canMix ? '' : 'disabled'}
                  style="background:\${acc.silo?.canMix ? 'linear-gradient(135deg,#059669,#10b981)' : 'rgba(255,255,255,0.05)'};color:\${acc.silo?.canMix ? '#fff' : 'var(--text-dim)'};border:none;border-radius:4px;padding:2px 8px;font-size:10px;cursor:\${acc.silo?.canMix ? 'pointer' : 'not-allowed'};font-weight:600;" title="\${acc.silo?.canMix ? 'Campur 1 Wheat + 1 Corn = 10 Bags' : 'Butuh minimal 1 Wheat dan 1 Corn'}">
                  🥣 Mix Feed (Max)
                </button>
              </div>
            </div>

            <!-- ACTION BUTTONS -->
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
              <button class="btn-card-battle" onclick="triggerAccountBattle(\${acc.id})" \${canBattle ? '' : 'disabled'}
                style="\${battleBtnStyle}" title="\${battleBtnTitle}">
                \${battleBtnContent}
              </button>

              <!-- QUICK BUY ENERGY STRIP (+10, +50, +100) -->
              <div class="energy-buy-strip">
                <span class="energy-buy-title">⚡ Beli:</span>
                <button class="btn-buy-energy" onclick="triggerAccountBuyEnergy(\${acc.id}, 10, \${cost10})" title="Beli +10 Energy seharga ~\${formatNumber(cost10)} $SEASON ($0.045 USD)">
                  +10 <small>(\${formatNumber(cost10)})</small>
                </button>
                <button class="btn-buy-energy" onclick="triggerAccountBuyEnergy(\${acc.id}, 50, \${cost50})" title="Beli +50 Energy seharga ~\${formatNumber(cost50)} $SEASON ($0.225 USD)">
                  +50 <small>(\${formatNumber(cost50)})</small>
                </button>
                <button class="btn-buy-energy" onclick="triggerAccountBuyEnergy(\${acc.id}, 100, \${cost100})" title="Beli +100 Energy seharga ~\${formatNumber(cost100)} $SEASON ($0.450 USD)">
                  +100 <small>(\${formatNumber(cost100)})</small>
                </button>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    // Polling & Render Wallet View
    async function refreshWalletStatus(force = false) {
      try {
        const url = '/api/wallet/status' + (force ? '?refresh=1' : '');
        const res = await fetch(url);
        if (!res.ok) return;
        const j = await res.json();
        if (j.ok && j.data) {
          latestWalletData = j.data;
          renderWalletView(j.data);
        }
      } catch (e) {
        console.error('Gagal mengambil status wallet:', e);
      }
    }

    function renderWalletView(data) {
      const s = data.summary;
      document.getElementById('wSumInGame').innerHTML = formatNumber(s.totalInGameSeason) + ' <span style="font-size:13px;color:#fde68a;">$SEASON</span>';
      document.getElementById('wSumInGameUsd').textContent = '(' + formatUsd(s.totalInGameUsd) + ' USD) • Siap Ditarik';

      document.getElementById('wSumOnChainSeason').innerHTML = formatNumber(s.totalOnChainSeason) + ' <span style="font-size:13px;color:#7dd3fc;">$SEASON</span>';
      document.getElementById('wSumOnChainSeasonUsd').textContent = '(' + formatUsd(s.totalOnChainSeasonUsd) + ' USD) • Di Wallet';

      document.getElementById('wSumOnChainEth').innerHTML = (s.totalOnChainEth || 0).toFixed(4) + ' ETH';
      document.getElementById('wSumOnChainEthUsd').textContent = '(' + formatUsd(s.totalOnChainEthUsd) + ' USD) • Gas Fee';

      // Render wallet account cards
      const grid = document.getElementById('walletAccountsGrid');
      grid.innerHTML = data.accounts.map(acc => {
        const isMasked = isAccountMasked(acc.id);
        const displayName = isMasked ? 'Akun #' + acc.id : acc.name;
        const displayFarm = isMasked ? '••••••••••••' : acc.farmName;
        const cardPrivIcon = isMasked ? '🕶️' : '👁️';
        const cardPrivTitle = isMasked ? 'Buka sensor nama akun ini' : 'Sensor nama akun ini';

        const addrShort = acc.address.slice(0, 8) + '...' + acc.address.slice(-6);

        // Status pill
        let statusTag = '';
        if (!acc.isGasSafe) {
          statusTag = '<span class="status-badge badge-warn">⚠️ Butuh ETH</span>';
        } else if (acc.inGameSeason >= 1 && !acc.meetsHoldRequirement) {
          statusTag = '<span class="status-badge badge-warn">⚠️ Butuh Hold 5k</span>';
        } else if (acc.inGameSeason >= 1 && acc.leftToday > 0) {
          statusTag = '<span class="status-badge badge-active">🟢 Siap Withdraw</span>';
        } else if (acc.leftToday <= 0) {
          statusTag = '<span class="status-badge badge-cooldown">✅ Limit Penuh</span>';
        } else {
          statusTag = '<span class="status-badge badge-cooldown">⏳ In-Game 0</span>';
        }

        const canWithdraw = acc.inGameSeason >= 1 && acc.isGasSafe && acc.meetsHoldRequirement && acc.leftToday > 0;
        const canSend = acc.onChainSeason > 0 && acc.isGasSafe;

        return \`
          <div class="w-acc-card">
            <!-- HEADER -->
            <div class="acc-header">
              <div class="acc-title-group">
                <span class="acc-id-pill">#\${acc.id}</span>
                <div class="acc-names">
                  <div class="acc-name-row">
                    <span class="acc-name">\${displayName}</span>
                    <button class="btn-card-privacy \${isMasked ? 'masked' : ''}" onclick="toggleCardPrivacy(\${acc.id})" title="\${cardPrivTitle}">\${cardPrivIcon}</button>
                  </div>
                  <span class="acc-farm-sub">\${displayFarm}</span>
                </div>
              </div>
              \${statusTag}
            </div>

            <!-- WALLET ADDRESS -->
            <div class="w-addr-box">
              <span class="w-addr-text" title="\${acc.address}">\${addrShort}</span>
              <div class="w-addr-links">
                <button class="btn-copy-addr" onclick="copyToClipboard('\${acc.address}')" title="Salin Alamat">📋 Salin</button>
                <a href="\${acc.explorerUrl}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:none;font-size:11px;" title="Buka di Blockscout">↗</a>
              </div>
            </div>

            <!-- IN-GAME WITHDRAW BOX (EXACT TO GAME PANEL) -->
            <div class="in-game-withdraw-card">
              <div class="w-kv-list">
                <div class="w-kv-row">
                  <span class="w-kv-label">Balance</span>
                  <span class="w-kv-val">\${formatNumber(acc.inGameSeason)} $SEASON <small style="color:var(--text-dim);font-size:10px;">(\${formatUsd(acc.inGameSeasonUsd)} USD)</small></span>
                </div>
                <div class="w-kv-row">
                  <span class="w-kv-label">Daily limit (Lv \${acc.farmLevel || 1})</span>
                  <span class="w-kv-val">\${formatNumber(acc.dailyLimit)} $SEASON <small style="color:var(--text-dim);font-size:10px;">(\${formatUsd(acc.limitUsd || 1.88)} USD)</small></span>
                </div>
                <div class="w-kv-row">
                  <span class="w-kv-label">Withdrawn today</span>
                  <span class="w-kv-val">\${formatNumber(acc.withdrawnToday)} $SEASON <small style="color:var(--text-dim);font-size:10px;">(\${formatUsd(acc.withdrawnUsd || 0)} USD)</small></span>
                </div>
                <div class="w-kv-row w-kv-highlight">
                  <span class="w-kv-label" style="font-weight: 800; color: #fbbf24;">Left today</span>
                  <span class="w-kv-val w-kv-bold" style="color:#fbbf24;">\${formatNumber(acc.leftToday)} $SEASON <small style="font-size:10px; color: #fde68a;">(\${formatUsd(acc.leftUsd || 0)} USD)</small></span>
                </div>
                <div class="w-kv-row">
                  <span class="w-kv-label" style="font-size: 10px; color: var(--text-dim);">Limit resets in</span>
                  <span class="w-kv-val" style="font-size: 10px; color: var(--text-dim);">\${acc.limitResetText || '13h 8m (00:00 UTC)'}</span>
                </div>
              </div>
              <div class="w-progress-track">
                <div class="w-progress-fill" style="width: \${acc.limitUsedPercent || 0}%;"></div>
              </div>
            </div>

            <!-- ON-CHAIN WALLET & GAS BALANCES -->
            <div class="w-chain-mini-row">
              <div class="w-chain-pill">
                <span class="w-chain-ico">💎</span>
                <div class="w-chain-meta">
                  <span class="w-chain-lbl">On-Chain SEASON</span>
                  <span class="w-chain-val" style="color:#38bdf8;font-size:11px;">\${formatNumber(acc.onChainSeason)} $SEASON <span style="font-size:9.5px;color:var(--text-dim);">(\${formatUsd(acc.onChainSeasonUsd)} USD)</span></span>
                </div>
              </div>

              <div class="w-chain-pill">
                <span class="w-chain-ico">⛽</span>
                <div class="w-chain-meta">
                  <span class="w-chain-lbl">Fee ETH (\${acc.isGasSafe ? '🟢 Aman' : '⚠️ Kurang'})</span>
                  <span class="w-chain-val" style="color:#c084fc;font-size:11px;">\${acc.onChainEthFormatted} ETH</span>
                </div>
              </div>
            </div>

            <!-- LIVE STATUS BAR -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;margin:10px 0;display:flex;align-items:center;gap:8px;font-size:11px;">
              <span style="font-size:13px;">\${acc.walletStatusIcon || '💡'}</span>
              <span style="color:\${acc.walletStatusColor || 'var(--text)'};font-weight:600;flex:1;">\${acc.walletStatusDesc || 'Standby'}</span>
            </div>

            <!-- ACTION BUTTONS -->
            <div class="w-actions-row">
              <button class="btn-w-withdraw" \${canWithdraw ? '' : 'disabled'} onclick="triggerAccountWithdraw(\${acc.id}, '\${displayName}', \${acc.withdrawAmount || acc.leftToday || acc.inGameSeason})">
                <span>\${!acc.meetsHoldRequirement && acc.inGameSeason >= 1 ? '⚠️ Hold 5,000 $SEASON Diperlukan' : (acc.leftToday <= 0 ? '✅ Limit Harian Penuh' : ('🟢 Withdraw ' + formatNumber(acc.withdrawAmount || acc.leftToday || acc.inGameSeason) + ' $SEASON (' + formatUsd(acc.withdrawAmountUsd || acc.leftUsd || 1.88) + ' USD)'))}</span>
              </button>
              <button class="btn-w-send" \${canSend ? '' : 'disabled'} onclick="openSendModal(\${acc.id})">
                <span>📤 Send Token</span>
              </button>
            </div>
          </div>
        \`;
      }).join('');

      // Render history table
      const histBody = document.getElementById('walletHistoryBody');
      if (data.history && data.history.length > 0) {
        histBody.innerHTML = data.history.map(tx => {
          const dt = new Date(tx.timestamp);
          const timeStr = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });

          const isWithdraw = tx.type === 'withdraw';
          const typeBadge = isWithdraw
            ? '<span class="tx-badge" style="background:rgba(16, 185, 129, 0.15);color:#34d399;border:1px solid rgba(16, 185, 129, 0.3);">📥 Withdraw Game</span>'
            : '<span class="tx-badge" style="background:rgba(56, 189, 248, 0.15);color:#38bdf8;border:1px solid rgba(56, 189, 248, 0.3);">📤 Kirim On-Chain</span>';

          let statusBadge = '';
          if (tx.status === 'Success') {
            statusBadge = '<span class="tx-badge tx-success">✅ Berhasil</span>';
          } else if (tx.status === 'Failed') {
            statusBadge = '<span class="tx-badge tx-failed">❌ Gagal</span>';
          } else {
            statusBadge = '<span class="tx-badge tx-pending">⏳ Memproses</span>';
          }

          let hashCol = '<span style="color:var(--text-dim);">-</span>';
          if (tx.txHash && tx.txHash.startsWith('0x')) {
            const hashShort = tx.txHash.slice(0, 10) + '...' + tx.txHash.slice(-8);
            hashCol = \`<a href="https://robinhoodchain.blockscout.com/tx/\${tx.txHash}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:underline;font-family:monospace;font-weight:600;">\${hashShort} ↗</a>\`;
          }

          let detailCol = '<span style="color:var(--text-dim);">-</span>';
          if (tx.detail) {
            detailCol = \`<span>\${tx.detail}</span>\`;
          } else if (tx.error) {
            detailCol = \`<span style="color:#f43f5e;word-break:break-word;" title="\${tx.error}">\${tx.error}</span>\`;
          } else if (tx.txHash && !tx.txHash.startsWith('0x')) {
            detailCol = \`<span>\${tx.txHash}</span>\`;
          } else if (tx.status === 'Success') {
            detailCol = \`<span style="color:#34d399;">Transaksi berhasil</span>\`;
          }

          const txUsd = tx.amount && s.seasonPriceUsd ? tx.amount * s.seasonPriceUsd : null;
          const txUsdStr = txUsd !== null ? \` (\${formatUsd(txUsd)} USD)\` : '';

          return \`
            <tr>
              <td style="font-family:monospace;color:var(--text-dim);white-space:nowrap;">\${timeStr}</td>
              <td><b>\${tx.accountName || 'Akun #' + tx.accountId}</b>\</td>
              <td>\${typeBadge}</td>
              <td style="font-family:monospace;font-weight:700;\${isWithdraw ? 'color:#34d399;' : 'color:#fbbf24;'}">\${isWithdraw ? '+' : '-'}\${formatNumber(tx.amount)} $SEASON <small style="font-weight:normal;color:var(--text-dim);font-size:10px;">\${txUsdStr}</small></td>
              <td>\${statusBadge}</td>
              <td>\${hashCol}</td>
              <td style="color:var(--text-dim);font-size:11px;max-width:450px;word-break:break-word;white-space:normal;line-height:1.4;">\${detailCol}</td>
            </tr>
          \`;
        }).join('');
      } else {
        histBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">Belum ada riwayat transaksi penarikan atau pengiriman.</td></tr>';
      }
    }

    // Action: Withdraw One Account
    async function triggerAccountWithdraw(accId, accName, amount) {
      if (!confirm(\`Konfirmasi Penarikan Saldo:\\nTarik \${formatNumber(amount)} $SEASON dari akun "\${accName}" ke wallet on-chain?\\n\\nCatatan: Potongan 5% fee in-game berlaku otomatis.\`)) {
        return;
      }

      showToast('info', 'Memproses Withdraw', \`Mengirim instruksi penarikan \${formatNumber(amount)} $SEASON untuk \${accName}...\`);

      try {
        const res = await fetch('/api/wallet/withdraw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accId, amount: 'all' })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('success', 'Withdraw Sukses!', data.message || 'Permit withdraw berhasil ditandatangani dan terkirim.');
          refreshWalletStatus(true);
        } else {
          showToast('error', 'Withdraw Gagal', data.error || 'Terjadi kesalahan saat memproses withdraw.');
        }
      } catch (err) {
        showToast('error', 'Gagal', err.message);
      }
    }

    // Action: Withdraw All Accounts
    async function triggerWithdrawAll() {
      if (!confirm('Tarik saldo game dari SEMUA akun yang memiliki saldo >= 1 $SEASON sekaligus?')) {
        return;
      }

      showToast('info', 'Memproses Withdraw All', 'Memulai penarikan otomatis berurutan ke semua wallet...');

      try {
        const res = await fetch('/api/wallet/withdraw-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.ok) {
          const successCount = data.results.filter(r => r.ok).length;
          showToast('success', 'Withdraw All Selesai', \`\${successCount} dari \${data.results.length} akun berhasil memproses withdraw.\`);
          refreshWalletStatus(true);
        } else {
          showToast('error', 'Gagal', data.error || 'Terjadi kesalahan.');
        }
      } catch (err) {
        showToast('error', 'Gagal', err.message);
      }
    }

    async function manualClaimIncome(accId) {
      try {
        showToast('info', 'Village Income', 'Mengirim instruksi klaim untuk Akun #' + accId + '...');
        const res = await fetch('/api/income/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accId })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('success', 'Village Income', 'Klaim Village Income Akun #' + accId + ' berhasil dipicu!');
          updateDashboard();
        } else {
          showToast('error', 'Gagal Klaim', data.message || 'Tidak dapat mengklaim income.');
        }
      } catch (err) {
        showToast('error', 'Gagal', err.message);
      }
    }

    // Action: Start Battle on Single Account
    async function triggerAccountBattle(accId) {
      showToast('info', 'Memulai Battle', 'Mengirim instruksi masuk battle ke Akun #' + accId + '...');
      try {
        const res = await fetch('/api/battle/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accId })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('success', 'Battle Dimulai', data.message || ('Akun #' + accId + ' berhasil masuk battle!'));
          updateDashboard();
        } else {
          showToast('warn', 'Gagal Battle', data.message || 'Tidak dapat memulai battle');
        }
      } catch (err) {
        showToast('error', 'Gagal', err.message);
      }
    }

    // Action: Start Battle on All Ready Accounts
    async function triggerBattleAll() {
      showToast('info', 'Battle Semua Akun', 'Mengirim perintah battle ke semua akun dengan energy >= 5...');
      try {
        const res = await fetch('/api/battle/start-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.ok) {
          showToast('success', 'Perintah Dikirim', 'Perintah battle terkirim ke semua akun ready!');
          updateDashboard();
        } else {
          showToast('error', 'Gagal', data.message || 'Terjadi kesalahan saat memproses battle all');
        }
      } catch (err) {
        showToast('error', 'Gagal', err.message);
      }
    }

    // Action: Buy Energy on Single Account (+10, +50, +100)
    async function triggerAccountBuyEnergy(accId, amount, estimatedCost) {
      const formattedCost = typeof formatNumber === 'function' ? formatNumber(estimatedCost) : estimatedCost;
      const confirmMsg = \`Konfirmasi Pembelian Energy:

• Akun: #\${accId}
• Paket: +\${amount} ⚡ Energy
• Estimasi Biaya: ~\${formattedCost} $SEASON

(Rate token otomatis mengikuti harga pasar $SEASON live saat ini)

Lanjutkan transaksi ini di dalam game?\`;

      if (!confirm(confirmMsg)) {
        return;
      }

      showToast('info', 'Membeli Energy', 'Mengirim perintah beli +' + amount + ' energy untuk Akun #' + accId + '...');
      try {
        const res = await fetch('/api/energy/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accId, amount: amount })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('success', 'Beli Energy Sukses', data.message || ('+' + amount + ' energy berhasil diproses!'));
          await updateDashboard();
          setTimeout(updateDashboard, 1500);
        } else {
          showToast('warn', 'Gagal Beli Energy', data.message || 'Saldo tidak cukup atau transaksi gagal');
        }
      } catch (err) {
        showToast('error', 'Gagal', err.message);
      }
    }

    // Action: Mix Feed in Silo (1 Wheat + 1 Corn = 10 Bags, 0 Energy)
    async function triggerAccountMixFeed(accId, amount = 'max') {
      showToast('info', 'Mix Feed Silo', 'Mencampur gandum & jagung menjadi feed bags untuk Akun #' + accId + '...');
      try {
        const res = await fetch('/api/silo/mix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accId, amount: amount })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('success', 'Mix Feed Sukses', data.message || 'Feed bags berhasil dibuat!');
          await updateDashboard();
          setTimeout(updateDashboard, 1500);
        } else {
          showToast('warn', 'Gagal Mix Feed', data.message || 'Bahan gandum dan jagung tidak cukup di Silo');
        }
      } catch (err) {
        showToast('error', 'Gagal', err.message);
      }
    }

    // Modal Send Token Logic
    function openSendModal(preselectAccId = null) {
      const modal = document.getElementById('modalSendToken');
      const sel = document.getElementById('sendFromAccount');
      sel.innerHTML = '';

      if (latestWalletData && latestWalletData.accounts) {
        latestWalletData.accounts.forEach(acc => {
          const opt = document.createElement('option');
          opt.value = acc.id;
          opt.textContent = \`#\${acc.id} \${acc.name} (Tersedia: \${formatNumber(acc.onChainSeason)} $SEASON (\${formatUsd(acc.onChainSeasonUsd)} USD) | Gas: \${acc.onChainEthFormatted} ETH)\`;
          if (preselectAccId && acc.id === Number(preselectAccId)) opt.selected = true;
          sel.appendChild(opt);
        });
      }

      document.getElementById('sendToAddress').value = '';
      document.getElementById('sendAmount').value = '';
      updateSendModalAvailable();
      modal.classList.add('open');
    }

    function closeSendModal() {
      document.getElementById('modalSendToken').classList.remove('open');
    }

    function updateSendModalAvailable() {
      const sel = document.getElementById('sendFromAccount');
      const accId = Number(sel.value);
      if (latestWalletData && latestWalletData.accounts) {
        const acc = latestWalletData.accounts.find(a => a.id === accId);
        if (acc) {
          document.getElementById('sendBalanceHint').textContent = \`Tersedia di wallet: \${formatNumber(acc.onChainSeason)} $SEASON (\${formatUsd(acc.onChainSeasonUsd)} USD)\`;
        }
      }
    }

    function setSendMax() {
      const sel = document.getElementById('sendFromAccount');
      const accId = Number(sel.value);
      if (latestWalletData && latestWalletData.accounts) {
        const acc = latestWalletData.accounts.find(a => a.id === accId);
        if (acc) {
          document.getElementById('sendAmount').value = acc.onChainSeason;
        }
      }
    }

    async function submitSendToken() {
      const sel = document.getElementById('sendFromAccount');
      const accId = Number(sel.value);
      const toAddr = document.getElementById('sendToAddress').value.trim();
      const amount = parseFloat(document.getElementById('sendAmount').value);

      if (!toAddr || !toAddr.startsWith('0x') || toAddr.length !== 42) {
        showToast('warn', 'Alamat Salah', 'Masukkan alamat EVM Robinhood Chain yang valid (42 karakter diawali 0x).');
        return;
      }

      if (isNaN(amount) || amount <= 0) {
        showToast('warn', 'Jumlah Salah', 'Masukkan jumlah token SEASON yang lebih dari 0.');
        return;
      }

      const btn = document.getElementById('btnConfirmSend');
      btn.disabled = true;
      btn.textContent = 'Mengirim... ⏳';

      showToast('info', 'Mengirim Transaksi', \`Menandatangani & menyiarkan transfer \${amount} SEASON ke Robinhood Chain...\`);

      try {
        const res = await fetch('/api/wallet/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: accId,
            toAddress: toAddr,
            amount: amount
          })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('success', 'Transfer Berhasil!', data.message || 'Token SEASON berhasil dikirim ke tujuan on-chain.');
          closeSendModal();
          refreshWalletStatus(true);
        } else {
          showToast('error', 'Transfer Gagal', data.error || 'Terjadi kesalahan saat transfer on-chain.');
        }
      } catch (err) {
        showToast('error', 'Gagal', err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Kirim Sekarang 🚀';
      }
    }

    // Timers
    function updateServerTime() {
      const now = new Date();
      document.getElementById('serverTime').textContent = now.toLocaleTimeString('id-ID');

      if (latestStatusData && typeof latestStatusData.dailyResetSeconds === 'number') {
        const resetSec = Math.max(0, latestStatusData.dailyResetSeconds - Math.floor((Date.now() - latestStatusData.timestamp) / 1000));
        const h = Math.floor(resetSec / 3600);
        const m = Math.floor((resetSec % 3600) / 60);
        const s = resetSec % 60;
        document.getElementById('dailyResetTimer').textContent =
          String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      }
    }

    // Init
    updatePrivacyButtonUi();
    fetchStatus();
    fetchLogs();
    refreshWalletStatus();

    setInterval(updateServerTime, 1000);
    setInterval(fetchStatus, 3000);
    setInterval(fetchLogs, 3000);
    setInterval(() => {
      if (currentView === 'withdraw') refreshWalletStatus();
    }, 15000);
  </script>
</body>
</html>`;
}

module.exports = WebDashboardServer;
