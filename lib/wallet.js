const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER,
  SEASON_TOKEN_ADDRESS,
  VAULT_ADDRESS,
  VAULT_ABI,
  defaultProvider,
  getBalance,
  getSeasonBalance,
  sendSeasonTokens,
  createWallet
} = require('./robinhood.js');
const logger = require('./logger.js');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
const HISTORY_FILE = path.join(DATA_DIR, 'wallet_history.json');
const BALANCE_CACHE_TTL = 15000; // 15 seconds cache to avoid spamming Robinhood RPC
const balanceCache = new Map(); // address -> { eth, season, timestamp }

const TOWN_HALL_LIMITS_USD = {
  1: 1.88,
  2: 4.38,
  3: 10.0,
  4: 22.5,
  5: 50.0
};

// Ensure history file exists
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Gagal membaca wallet_history.json:', e.message);
  }
  return [];
}

function saveHistory(entry) {
  try {
    const list = loadHistory();
    const newEntry = {
      id: 'tx_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      timestamp: Date.now(),
      ...entry
    };
    list.unshift(newEntry);
    // Keep last 150 records
    if (list.length > 150) list.length = 150;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
    return newEntry;
  } catch (e) {
    console.error('Gagal menyimpan wallet_history.json:', e.message);
    return entry;
  }
}

function updateHistory(predicate, updates) {
  try {
    const list = loadHistory();
    const idx = list.findIndex(predicate);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...updates };
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
      return list[idx];
    }
  } catch (e) {
    console.error('Gagal update wallet_history.json:', e.message);
  }
  return null;
}

// Fetch cached or fresh on-chain balances for an address
async function fetchOnChainBalances(address, forceRefresh = false) {
  const cached = balanceCache.get(address.toLowerCase());
  const now = Date.now();
  if (!forceRefresh && cached && (now - cached.timestamp < BALANCE_CACHE_TTL)) {
    return cached;
  }

  try {
    const [ethRes, seasonRes] = await Promise.all([
      getBalance(address),
      getSeasonBalance(address)
    ]);

    const ethVal = parseFloat(ethRes.eth) || 0;
    const seasonVal = seasonRes.tokens || 0;

    const data = {
      address,
      ethBalance: ethVal,
      ethFormatted: ethVal < 0.0001 ? ethVal.toFixed(6) : ethVal.toFixed(4),
      ethWei: ethRes.wei,
      seasonBalance: seasonVal,
      seasonFormatted: seasonRes.formatted,
      seasonWei: seasonRes.wei,
      isGasSafe: ethVal >= 0.00005,
      timestamp: now
    };

    balanceCache.set(address.toLowerCase(), data);
    return data;
  } catch (e) {
    return {
      address,
      ethBalance: 0,
      ethFormatted: '0.0000',
      ethWei: 0n,
      seasonBalance: 0,
      seasonFormatted: '0',
      seasonWei: 0n,
      isGasSafe: false,
      error: e.message,
      timestamp: now
    };
  }
}

// Get comprehensive status of all accounts
async function getWalletOverview(accounts, marketData = {}, runner = null, forceRefresh = false) {
  const seasonPriceUsd = marketData.priceUsd ? parseFloat(marketData.priceUsd) : 0;
  const ethPriceUsd = marketData.ethPriceUsd ? parseFloat(marketData.ethPriceUsd) : 2500;

  let totalInGameSeason = 0;
  let totalOnChainSeason = 0;
  let totalOnChainEth = 0;

  const accountList = await Promise.all(accounts.map(async (acc) => {
    let address = '0x0000000000000000000000000000000000000000';
    try {
      if (acc.privateKey) {
        const w = createWallet(acc.privateKey);
        address = w.address;
      }
    } catch (e) {}

    const onChain = await fetchOnChainBalances(address, forceRefresh);

    // Get running bot status
    let inGameSeason = 0;
    let isRunning = false;
    let farmLevel = 1;
    let withdrawnUsd = 0;
    let withdrawCapUsd = null;

    if (runner && runner.instances) {
      const inst = runner.instances.get(acc.id);
      if (inst) {
        isRunning = true;
        inGameSeason = inst.status?.seasonTokens || 0;
        farmLevel = inst.status?.farmLevel || 1;
        withdrawnUsd = inst.status?.withdrawnUsd || 0;
        withdrawCapUsd = inst.status?.withdrawCapUsd || null;
      }
    }

    // Dynamic withdraw limits calculation (Exact in-game formulas)
    let limitUsd = TOWN_HALL_LIMITS_USD[farmLevel] || 1.88;
    if (withdrawCapUsd) limitUsd = Math.min(limitUsd, withdrawCapUsd);
    const leftUsd = Math.max(0, limitUsd - withdrawnUsd);

    // Token conversion using live price (fallback to typical ratio if price is 0)
    let dailyLimit = 5353;
    let withdrawnToday = 0;
    let leftToday = 5353;

    if (seasonPriceUsd > 0) {
      dailyLimit = Math.round(limitUsd / seasonPriceUsd);
      withdrawnToday = Math.round(withdrawnUsd / seasonPriceUsd);
      leftToday = Math.max(0, dailyLimit - withdrawnToday);
    }

    // Percentage of daily limit used
    const limitUsedPercent = limitUsd > 0 ? Math.min(100, Math.round((withdrawnUsd / limitUsd) * 100)) : 0;

    // Countdown until 00:00 UTC limit reset
    const nowMs = Date.now();
    const msUntilUtc = 86400000 - (nowMs % 86400000);
    const utcHours = Math.floor(msUntilUtc / 3600000);
    const utcMins = Math.floor((msUntilUtc % 3600000) / 60000);
    const limitResetText = `${utcHours}h ${utcMins}m (00:00 UTC)`;

    const withdrawAmount = Math.min(leftToday, inGameSeason);

    const seasonOnChainUsd = onChain.seasonBalance * seasonPriceUsd;
    const inGameSeasonUsd = inGameSeason * seasonPriceUsd;
    const ethUsd = onChain.ethBalance * ethPriceUsd;

    totalInGameSeason += inGameSeason;
    totalOnChainSeason += onChain.seasonBalance;
    totalOnChainEth += onChain.ethBalance;

    // Syarat hold 5,000 SEASON baru aktif mulai 24 Okt 01:00 WIB (23 Okt 18:00 UTC)
    const HOLD_RULE_STARTS_AT = new Date('2026-10-23T18:00:00Z').getTime();
    const meetsHoldRequirement = Date.now() < HOLD_RULE_STARTS_AT || onChain.seasonBalance >= 5000;

    // Status Live untuk Card Akun Dompet
    let walletStatus = 'Ready';
    let walletStatusColor = '#34d399';
    let walletStatusIcon = '🟢';
    let walletStatusDesc = 'Siap Withdraw ke on-chain';

    if (!onChain.isGasSafe) {
      walletStatus = 'Needs Gas';
      walletStatusColor = '#f43f5e';
      walletStatusIcon = '⚠️';
      walletStatusDesc = `Saldo ETH (${onChain.ethFormatted} ETH) kurang untuk gas fee`;
    } else if (!meetsHoldRequirement) {
      walletStatus = 'Needs Hold';
      walletStatusColor = '#fbbf24';
      walletStatusIcon = '⚠️';
      walletStatusDesc = 'Wajib hold min 5,000 SEASON (aktif 24 Okt 01:00 WIB)';
    } else if (leftToday <= 0) {
      walletStatus = 'Limit Reached';
      walletStatusColor = '#94a3b8';
      walletStatusIcon = '✅';
      walletStatusDesc = `Daily limit hari ini tercapai (${dailyLimit.toLocaleString()} SEASON). Reset 00:00 UTC`;
    } else if (inGameSeason < 1) {
      walletStatus = 'Empty';
      walletStatusColor = '#94a3b8';
      walletStatusIcon = '⏳';
      walletStatusDesc = 'Saldo in-game 0 SEASON (belum ada yang bisa ditarik)';
    } else {
      walletStatus = 'Ready';
      walletStatusColor = '#34d399';
      walletStatusIcon = '🟢';
      walletStatusDesc = `Siap Withdraw ~${withdrawAmount.toLocaleString()} $SEASON (${(withdrawAmount * seasonPriceUsd).toFixed(2)} USD)`;
    }

    return {
      id: acc.id,
      name: acc.name,
      farmName: acc.farmName || acc.name,
      address,
      explorerUrl: `${ROBINHOOD_EXPLORER}/address/${address}`,
      isRunning,
      farmLevel,
      inGameSeason,
      inGameSeasonUsd,
      dailyLimit,
      limitUsd,
      withdrawnToday,
      withdrawnUsd,
      leftToday,
      leftUsd,
      limitResetText,
      limitUsedPercent,
      withdrawAmount,
      withdrawAmountUsd: withdrawAmount * seasonPriceUsd,
      canWithdraw: isRunning && inGameSeason >= 1 && onChain.isGasSafe && leftToday > 0 && meetsHoldRequirement,
      meetsHoldRequirement,
      holdMinSeason: 5000,
      walletStatus,
      walletStatusColor,
      walletStatusIcon,
      walletStatusDesc,
      onChainEth: onChain.ethBalance,
      onChainEthFormatted: onChain.ethFormatted,
      onChainEthUsd: ethUsd,
      isGasSafe: onChain.isGasSafe,
      onChainSeason: onChain.seasonBalance,
      onChainSeasonFormatted: onChain.seasonFormatted,
      onChainSeasonUsd: seasonOnChainUsd
    };
  }));

  const totalInGameUsd = totalInGameSeason * seasonPriceUsd;
  const totalOnChainSeasonUsd = totalOnChainSeason * seasonPriceUsd;
  const totalOnChainEthUsd = totalOnChainEth * ethPriceUsd;
  const totalPortfolioUsd = totalInGameUsd + totalOnChainSeasonUsd + totalOnChainEthUsd;

  return {
    accounts: accountList,
    summary: {
      totalInGameSeason,
      totalInGameUsd,
      totalOnChainSeason,
      totalOnChainSeasonUsd,
      totalOnChainEth,
      totalOnChainEthUsd,
      totalPortfolioUsd,
      seasonPriceUsd,
      ethPriceUsd
    },
    history: loadHistory().slice(0, 30)
  };
}

// Ensure human verification (Cloudflare Turnstile) is active on game server
async function ensureHumanVerified(inst, runner, address) {
  if (!inst || !inst.page) return { ok: false, error: 'Browser instance tidak aktif' };

  try {
    // 1. Cek status verifikasi akun saat ini
    const status = await inst.page.evaluate(async (owner) => {
      try {
        const res = await fetch(`/api/human/status?owner=${owner}`, { cache: 'no-store' });
        return await res.json();
      } catch (e) {
        return null;
      }
    }, address);

    const now = Date.now();
    const isGateOpen = await inst.page.evaluate(() => !!document.getElementById('human-gate'));

    if (status && status.verified && (status.until || 0) > now && !isGateOpen) {
      return { ok: true, verified: true };
    }

    const apiKey = runner?.config?.solvegateApiKey;
    if (!apiKey) {
      logger.warn(inst.account?.id || 1, inst.account?.name || 'Account', 'Verifikasi Turnstile dibutuhkan tapi solvegateApiKey tidak ada di config.json');
      return { ok: false, error: 'Verifikasi Turnstile (quick check) dibutuhkan oleh game server' };
    }

    const siteKey = status?.siteKey || '0x4AAAAAAFX7cYbY970oYHna';
    logger.info(inst.account?.id || 1, inst.account?.name || 'Account', '[WITHDRAW] Menyelesaikan verifikasi Turnstile otomatis via SolveGate API...');

    if (inst.status) {
      inst.status.walletStatus = 'Turnstile';
      inst.status.walletStatusColor = '#38bdf8';
      inst.status.walletStatusIcon = '🛡️';
      inst.status.walletStatusDesc = 'Menyelesaikan Quick Check (Turnstile)...';
    }

    const sgRes = await fetch('https://api.solvegate.io/v1/solve', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        gate: 'turnstile',
        sitekey: siteKey,
        url: 'https://farmingseason.io'
      })
    });

    const sgData = await sgRes.json();
    if (!sgData || !sgData.token) {
      return { ok: false, error: `Gagal mendapatkan token Turnstile: ${sgData?.error_message || 'SolveGate timeout'}` };
    }

    logger.action(inst.account?.id || 1, inst.account?.name || 'Account', `[WITHDRAW] Token Turnstile didapatkan (${sgData.solve_ms} ms)! Mengirim verifikasi ke server...`);

    const solveResult = await inst.page.evaluate(async (token, owner) => {
      try {
        const res = await fetch('/api/human/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ owner, token })
        });
        const j = await res.json();
        if (j && j.ok) {
          const gateEl = document.getElementById('human-gate');
          if (gateEl) gateEl.remove();
          return { success: true, until: j.until };
        }
        return { success: false, error: j?.error || j?.msg };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }, sgData.token, address);

    if (solveResult && solveResult.success) {
      logger.action(inst.account?.id || 1, inst.account?.name || 'Account', '✅ Turnstile berhasil diverifikasi di server game!');
      return { ok: true, verified: true, until: solveResult.until };
    } else {
      return { ok: false, error: `Verifikasi Turnstile ditolak: ${solveResult?.error || 'Unknown'}` };
    }
  } catch (e) {
    logger.warn(inst.account?.id || 1, inst.account?.name || 'Account', `Error Turnstile verify: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Request withdraw permit from in-game browser session
async function requestWithdrawPermit(inst, targetUsd) {
  return await inst.page.evaluate(async (reqUsd) => {
    const fs = window.__fsFarmingSeason;

    // 1. Cek apakah sudah ada permit open yang aktif di server
    try {
      const res = await fetch('/api/farm/withdraw', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.permit && data.permit.status === 'open') {
          return { ok: true, permit: data.permit, amount: Math.round(data.permit.tokens || 0) };
        }
      }
    } catch (e) {}

    // 2. Buka panel withdraw di game jika belum terbuka
    if (fs && typeof fs.triggerGameAction === 'function') {
      fs.triggerGameAction('withdraw-panel');
    }

    // Tunggu tombol (vault-finish atau withdraw) muncul di DOM (hingga 5 detik)
    let pBtn = null;
    let finishBtn = null;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 5000) {
      await new Promise(r => setTimeout(r, 300));

      finishBtn = document.querySelector('button[data-action="vault-finish"]');
      if (finishBtn) break;

      const wBtns = Array.from(document.querySelectorAll('button[data-action="withdraw"]'));
      if (wBtns.length > 0) {
        pBtn = wBtns.find(b => b.classList.contains('primary')) || wBtns[0];
        break;
      }
    }

    // Jika ada tombol finish withdrawal (permit open sudah ada di game vault)
    if (finishBtn) {
      try {
        const res = await fetch('/api/farm/withdraw', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.permit && data.permit.status === 'open') {
            return { ok: true, permit: data.permit, amount: Math.round(data.permit.tokens || 0) };
          }
        }
      } catch (e) {}
    }

    if (pBtn && !pBtn.disabled) {
      pBtn.click();
    } else if (pBtn && pBtn.disabled) {
      // Periksa apakah tombol disabled karena permit sudah open
      try {
        const res = await fetch('/api/farm/withdraw', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.permit && data.permit.status === 'open') {
            return { ok: true, permit: data.permit, amount: Math.round(data.permit.tokens || 0) };
          }
        }
      } catch (e) {}

      // Jika benar-benar terkunci karena limit habis
      const alertEl = document.querySelector('.alert.warn, .alert.bad, #toasts > div.bad');
      if (alertEl) {
        return { ok: false, error: alertEl.textContent.trim() };
      }
      // Coba klik tombol alternatif atau pemicu
      const fallbackUsd = (typeof reqUsd === 'number' && reqUsd > 0) ? reqUsd : 1.88;
      if (fs && typeof fs.triggerGameAction === 'function') {
        fs.triggerGameAction('withdraw', fallbackUsd);
      }
    } else {
      const fallbackUsd = (typeof reqUsd === 'number' && reqUsd > 0) ? reqUsd : 1.88;
      if (fs && typeof fs.triggerGameAction === 'function') {
        fs.triggerGameAction('withdraw', fallbackUsd);
      }
    }

    // Poll permit sampai open (hingga 15 detik)
    let lastErrMsg = '';
    const pollStart = Date.now();
    while (Date.now() - pollStart < 15000) {
      await new Promise(r => setTimeout(r, 600));

      const toastEl = document.querySelector('.toast.bad, .toast, #toasts > div, .alert.warn');
      if (toastEl) {
        const txt = toastEl.textContent.trim();
        if (txt && !/Preparing/i.test(txt)) lastErrMsg = txt;
      }

      const isGate = !!document.getElementById('human-gate');
      if (isGate) {
        return { ok: false, needsHumanCheck: true, error: 'Please complete the quick check (are you a real farmer?) to keep playing.' };
      }

      try {
        const res = await fetch('/api/farm/withdraw', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.permit && data.permit.status === 'open') {
            return { ok: true, permit: data.permit, amount: Math.round(data.permit.tokens || 0) };
          }
          if (data && data.msg) {
            lastErrMsg = data.msg;
            if (/quick check|real farmer/i.test(data.msg)) {
              return { ok: false, needsHumanCheck: true, error: data.msg };
            }
          }
        }
      } catch (e) {}
    }

    if (lastErrMsg) {
      const needsHuman = /quick check|real farmer/i.test(lastErrMsg);
      return { ok: false, needsHumanCheck: needsHuman, error: lastErrMsg };
    }
    return { ok: false, error: 'Permit withdraw tidak kunjung berstatus open dari server game (waktu tunggu habis)' };
  }, targetUsd);
}

// Execute In-Game Withdraw for one account
async function executeWithdraw(accountId, amount = 'all', runner, accounts) {
  const acc = accounts.find(a => a.id === Number(accountId));
  if (!acc) throw new Error(`Akun ID ${accountId} tidak ditemukan`);

  const inst = runner.instances ? runner.instances.get(Number(accountId)) : null;
  if (!inst || !inst.page) {
    throw new Error(`Bot untuk akun ${acc.name} sedang tidak aktif (jalankan bot terlebih dahulu)`);
  }

  // 1. Gas check
  let address = '0x';
  let wallet = null;
  try {
    wallet = createWallet(acc.privateKey);
    address = wallet.address;
  } catch (e) {
    throw new Error(`Private key akun ${acc.name} tidak valid`);
  }

  const { ethBalance, isGasSafe, seasonBalance } = await fetchOnChainBalances(address, true);
  if (!isGasSafe) {
    const err = `Saldo ETH akun ${acc.name} (${ethBalance.toFixed(6)} ETH) tidak mencukupi untuk gas fee Robinhood Chain (minimal 0.00005 ETH)`;
    saveHistory({
      type: 'withdraw',
      accountId: acc.id,
      accountName: acc.name,
      from: 'In-Game',
      to: address,
      amount: inst.status?.seasonTokens || 0,
      status: 'Failed',
      detail: err,
      error: err
    });
    throw new Error(err);
  }

  // 1B. Syarat Anti-Bot Game Terbaru: Dompet wajib hold minimal 5,000 SEASON di Robinhood Chain saat withdraw
  // CATATAN: Aturan ini dijadwalkan oleh game developer mulai 23 Oktober 2026 pukul 18:00 UTC (24 Okt 01:00 WIB).
  // Sebelum waktu tersebut, aturan hold BELUM AKTIF sehingga withdraw bebas tanpa syarat hold!
  const HOLD_RULE_STARTS_AT = new Date('2026-10-23T18:00:00Z').getTime();
  const HOLD_MIN_SEASON = 5000;
  if (Date.now() >= HOLD_RULE_STARTS_AT && seasonBalance < HOLD_MIN_SEASON) {
    const err = `Syarat Baru Game (Berlaku mulai 23 Okt 18:00 UTC): Dompet harus hold minimal ${HOLD_MIN_SEASON.toLocaleString()} SEASON di wallet on-chain untuk withdraw. (Saldo on-chain akun ${acc.name} saat ini: ${Math.floor(seasonBalance).toLocaleString()} SEASON)`;
    saveHistory({
      type: 'withdraw',
      accountId: acc.id,
      accountName: acc.name,
      from: 'In-Game',
      to: address,
      amount: inst.status?.seasonTokens || 0,
      status: 'Failed',
      detail: err,
      error: err
    });
    throw new Error(err);
  }

  // 2. Balance & Daily Limit check
  const inGameTokens = inst.status?.seasonTokens || 0;
  if (inGameTokens < 1) {
    const err = `Saldo in-game akun ${acc.name} adalah 0 SEASON (belum ada yang bisa ditarik)`;
    saveHistory({
      type: 'withdraw',
      accountId: acc.id,
      accountName: acc.name,
      from: 'In-Game',
      to: address,
      amount: 0,
      status: 'Failed',
      detail: err,
      error: err
    });
    throw new Error(err);
  }

  // Estimasi batas daily limit yang bisa ditarik hari ini (Left today)
  const tokenPrice = 0.000318;
  const capUsd = inst.status?.withdrawCapUsd || 1.88;
  const withdrawnUsd = inst.status?.withdrawnUsd || 0;
  const leftUsd = Math.max(0, capUsd - withdrawnUsd);
  const leftLimitTokens = Math.floor(leftUsd / tokenPrice);
  const estWithdrawable = Math.max(1, Math.min(inGameTokens, leftLimitTokens > 0 ? leftLimitTokens : inGameTokens));

  const targetUsd = (typeof amount === 'number' && amount > 0) ? amount : (leftUsd > 0 ? leftUsd : 1.88);

  logger.action(acc.id, acc.name, `[WITHDRAW] Memulai withdraw (~${estWithdrawable.toLocaleString()} SEASON, $${targetUsd} USD) ke wallet ${address}...`);

  if (inst.status) {
    inst.status.walletStatus = 'Memproses';
    inst.status.walletStatusColor = '#fbbf24';
    inst.status.walletStatusIcon = '⏳';
    inst.status.walletStatusDesc = `Memproses withdraw ~${estWithdrawable.toLocaleString()} SEASON...`;
  }

  const initialTxHash = inst.lastTxHash || null;

  try {
    // 3A. Pastikan Turnstile terverifikasi sebelum withdraw
    await ensureHumanVerified(inst, runner, address);

    // 3B. Dapatkan permit withdraw dari browser / game
    let pageResult = await requestWithdrawPermit(inst, targetUsd);

    // 3C. Jika server tetap minta quick check / Turnstile, selesaikan dan coba lagi 1x
    if (pageResult && pageResult.needsHumanCheck) {
      logger.info(acc.id, acc.name, '[WITHDRAW] Server game meminta verifikasi quick check. Menyelesaikan Turnstile & mengulang permit...');
      await ensureHumanVerified(inst, runner, address);
      await new Promise(r => setTimeout(r, 1000));
      pageResult = await requestWithdrawPermit(inst, targetUsd);
    }

    if (!pageResult || !pageResult.ok || !pageResult.permit) {
      const err = pageResult?.error || 'Gagal menyiapkan permit withdraw di browser';
      const updated = updateHistory(
        entry => entry.accountId === acc.id && entry.status === 'Pending',
        {
          status: 'Failed',
          amount: estWithdrawable,
          detail: err,
          error: err,
          timestamp: Date.now()
        }
      );
      if (!updated) {
        saveHistory({
          type: 'withdraw',
          accountId: acc.id,
          accountName: acc.name,
          from: 'In-Game',
          to: address,
          amount: estWithdrawable,
          status: 'Failed',
          detail: err,
          error: err
        });
      }
      if (inst.status) {
        inst.status.walletStatus = 'Gagal';
        inst.status.walletStatusColor = '#f43f5e';
        inst.status.walletStatusIcon = '❌';
        inst.status.walletStatusDesc = `Gagal: ${err}`;
      }
      throw new Error(err);
    }

    const permit = pageResult.permit;
    const actualWdAmount = Math.round(permit.tokens || pageResult.amount || estWithdrawable);

    logger.action(acc.id, acc.name, `[WITHDRAW] Permit open terverifikasi (${actualWdAmount.toLocaleString()} SEASON). Memproses klaim on-chain ke smart contract vault...`);

    if (inst.status) {
      inst.status.walletStatus = 'Klaim On-Chain';
      inst.status.walletStatusColor = '#38bdf8';
      inst.status.walletStatusIcon = '⛓️';
      inst.status.walletStatusDesc = `Klaim ${actualWdAmount.toLocaleString()} SEASON ke blockchain...`;
    }

    // 4. Eksekusi klaim on-chain via smart contract vault
    let finalTxHash = null;

    // Cek apakah browser engine / __fs_wallet_rpc sudah mengirim transaksi on-chain
    if (inst.lastTxHash && inst.lastTxHash !== initialTxHash) {
      finalTxHash = inst.lastTxHash;
      logger.action(acc.id, acc.name, `Transaksi klaim telah dikirim oleh game engine. Hash: ${finalTxHash}`);
    } else {
      const vaultContract = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

      let gasLimit = 350000n;
      try {
        const est = await vaultContract.withdraw.estimateGas(BigInt(permit.amount), BigInt(permit.deadline), permit.signature);
        gasLimit = (est * 135n) / 100n;
      } catch (e) {
        gasLimit = 350000n;
      }

      const feeData = await defaultProvider.getFeeData();
      const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 135n) / 100n : ethers.parseUnits('28', 'gwei');

      logger.info(acc.id, acc.name, `Mengirim transaksi withdraw ke smart contract ${VAULT_ADDRESS} (GasLimit: ${gasLimit}, GasPrice: ${ethers.formatUnits(gasPrice, 'gwei')} gwei)...`);

      try {
        const tx = await vaultContract.withdraw(BigInt(permit.amount), BigInt(permit.deadline), permit.signature, {
          gasLimit,
          gasPrice
        });
        finalTxHash = tx.hash;
        inst.lastTxHash = tx.hash;
        inst.lastTxAt = Date.now();
        inst.lastTxDesc = 'klaim withdraw token (vault)';
        logger.action(acc.id, acc.name, `Transaksi withdraw terkirim ke blockchain! Hash: ${finalTxHash}`);
      } catch (sendErr) {
        if (inst.lastTxHash && inst.lastTxHash !== initialTxHash) {
          finalTxHash = inst.lastTxHash;
        } else {
          throw sendErr;
        }
      }
    }

    // Update status history menjadi Pending dengan txHash
    updateHistory(
      entry => entry.accountId === acc.id && entry.status === 'Pending',
      { txHash: finalTxHash, detail: 'Menunggu konfirmasi blockchain...', timestamp: Date.now() }
    );

    // Tunggu konfirmasi 1 blok
    const receipt = await defaultProvider.waitForTransaction(finalTxHash, 1);
    if (receipt && receipt.status !== 1) {
      throw new Error(`Transaksi withdraw gagal (reverted) di explorer. Hash: ${finalTxHash}`);
    }

    logger.action(acc.id, acc.name, `✅ Withdraw On-Chain SUKSES! +${actualWdAmount.toLocaleString()} SEASON telah masuk ke wallet! Hash: ${finalTxHash}`);

    // Invalidate cache saldo on-chain dan fetch segera
    balanceCache.delete(address.toLowerCase());
    await fetchOnChainBalances(address, true);

    // Refresh UI in-game
    try {
      await inst.page.evaluate(() => {
        try {
          const fs = window.__fsFarmingSeason;
          if (fs && typeof fs.triggerGameAction === 'function') {
            fs.triggerGameAction('close-panel');
          }
        } catch (e) {}
      });
    } catch (e) {}

    const explorerUrl = `${ROBINHOOD_EXPLORER}/tx/${finalTxHash}`;
    const detailMsg = `Withdraw ${actualWdAmount.toLocaleString()} SEASON (Klaim on-chain sukses)`;

    // Update pending record jika ada, atau buat baru
    let saved = updateHistory(
      entry => entry.accountId === acc.id && (entry.status === 'Pending' || entry.txHash === finalTxHash),
      {
        status: 'Success',
        txHash: finalTxHash,
        amount: actualWdAmount,
        detail: detailMsg,
        timestamp: Date.now(),
        explorerUrl
      }
    );

    if (!saved) {
      saved = saveHistory({
        type: 'withdraw',
        accountId: acc.id,
        accountName: acc.name,
        from: 'In-Game',
        to: address,
        amount: actualWdAmount,
        status: 'Success',
        txHash: finalTxHash,
        detail: detailMsg,
        explorerUrl
      });
    }

    if (inst.status) {
      inst.status.walletStatus = 'Sukses';
      inst.status.walletStatusColor = '#34d399';
      inst.status.walletStatusIcon = '✅';
      inst.status.walletStatusDesc = `Berhasil ditarik +${actualWdAmount.toLocaleString()} SEASON (On-chain)`;
    }

    return {
      ok: true,
      message: `Berhasil menarik ${actualWdAmount.toLocaleString()} SEASON ke dompet on-chain!`,
      historyId: saved.id,
      txHash: finalTxHash,
      explorerUrl
    };
  } catch (err) {
    if (inst.status) {
      inst.status.walletStatus = 'Gagal';
      inst.status.walletStatusColor = '#f43f5e';
      inst.status.walletStatusIcon = '❌';
      inst.status.walletStatusDesc = `Gagal: ${err.message}`;
    }
    logger.error(acc.id, acc.name, `[WITHDRAW] Gagal: ${err.message}`);
    throw err;
  }
}

// Execute On-Chain Transfer of SEASON tokens to another wallet
async function executeTransfer(accountId, toAddress, amount, accounts) {
  const acc = accounts.find(a => a.id === Number(accountId));
  if (!acc) throw new Error(`Akun ID ${accountId} tidak ditemukan`);
  if (!acc.privateKey) throw new Error(`Akun ${acc.name} tidak memiliki privateKey`);

  logger.action(acc.id, acc.name, `[TRANSFER] Memproses pengiriman ${amount} SEASON ke ${toAddress}...`);

  try {
    const res = await sendSeasonTokens(acc.privateKey, toAddress, amount);
    
    // Invalidate cache for source
    balanceCache.delete(res.from.toLowerCase());

    const saved = saveHistory({
      type: 'transfer',
      accountId: acc.id,
      accountName: acc.name,
      from: res.from,
      to: res.to,
      amount: res.amount,
      status: 'Success',
      txHash: res.hash,
      detail: `Transfer ke ${res.to.slice(0, 6)}...${res.to.slice(-4)}`,
      explorerUrl: `${ROBINHOOD_EXPLORER}/tx/${res.hash}`
    });

    logger.action(acc.id, acc.name, `[TRANSFER] Berhasil! Hash: ${res.hash}`);
    return { ok: true, txHash: res.hash, message: `Berhasil mengirim ${amount} SEASON ke ${toAddress}!`, historyId: saved.id };
  } catch (err) {
    saveHistory({
      type: 'transfer',
      accountId: acc.id,
      accountName: acc.name,
      from: 'Wallet #' + acc.id,
      to: toAddress,
      amount: parseFloat(amount) || 0,
      status: 'Failed',
      error: err.message
    });
    logger.error(acc.id, acc.name, `[TRANSFER] Gagal: ${err.message}`);
    throw err;
  }
}

module.exports = {
  loadHistory,
  saveHistory,
  fetchOnChainBalances,
  getWalletOverview,
  executeWithdraw,
  executeTransfer
};
