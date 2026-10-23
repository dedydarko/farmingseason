const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { ethers } = require('ethers');
const logger = require('./logger');
const WebDashboardServer = require('./server');
const {
  ROBINHOOD_RPC,
  ROBINHOOD_IP,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_ID_HEX,
  SAFE_REG_ETH,
  defaultProvider,
  getBalance,
  createWallet
} = require('./robinhood');

const DEFAULT_REFERRAL_CODE = 'FARM-WBF9L';

class BotRunner {
  constructor(config = {}) {
    this.config = config;
    this.referralCode = config.referralCode !== undefined ? config.referralCode : DEFAULT_REFERRAL_CODE;
    this.gameUrl = this.referralCode ? `https://farmingseason.io/?ref=${this.referralCode}` : 'https://farmingseason.io';
    this.chromePath = config.chromePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    this.instances = new Map(); // id -> { account, browser, page, wallet, status, lastUpdate }
    this.isRunning = false;
    this.dashboardInterval = null;
    this.webServer = new WebDashboardServer(this, config.webPort || 3000);
    this.webServerUrl = null;
    this.extensionScript = '';

    const scriptPath = path.resolve(__dirname, '..', 'gmfb', 'farmingseason.js');
    if (fs.existsSync(scriptPath)) {
      this.extensionScript = fs.readFileSync(scriptPath, 'utf8');
    } else {
      console.error('Error: File gmfb/farmingseason.js tidak ditemukan!');
    }
  }

  getProfileDir(id) {
    const dir = path.resolve(__dirname, '..', 'profiles', `acc_${id}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Auto-fix crash state agar tidak muncul popup "Restore pages? Chrome didn't shut down correctly"
    const prefPath = path.join(dir, 'Default', 'Preferences');
    if (fs.existsSync(prefPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
        if (data.profile) {
          data.profile.exit_type = 'Normal';
          data.profile.exited_cleanly = true;
        }
        fs.writeFileSync(prefPath, JSON.stringify(data));
      } catch (e) {}
    }
    return dir;
  }

  async launchAccount(account, options = {}) {
    const id = account.id;
    const isVisible = options.visible || false;
    const profileDir = this.getProfileDir(id);

    let wallet = null;
    let walletAddr = null;
    let authCookie = null;
    if (account.privateKey) {
      try {
        wallet = createWallet(account.privateKey);
        walletAddr = wallet.address.toLowerCase();

        // 0A. Deteksi jika privateKey/wallet berganti pada ID ini: Bersihkan cache browser jika address berganti
        const walletMetaFile = path.join(profileDir, 'wallet_address.txt');
        if (fs.existsSync(walletMetaFile)) {
          const savedAddr = fs.readFileSync(walletMetaFile, 'utf8').trim().toLowerCase();
          if (savedAddr && savedAddr !== walletAddr) {
            logger.warn(id, account.name, `Terdeteksi pergantian wallet (${savedAddr.slice(0, 8)}... -> ${walletAddr.slice(0, 8)}...). Membersihkan sesi profil browser lama...`);
            try {
              const defaultDir = path.join(profileDir, 'Default');
              if (fs.existsSync(defaultDir)) {
                fs.rmSync(defaultDir, { recursive: true, force: true });
              }
            } catch (rmErr) {
              console.warn(`[Acc ${id}] Gagal membersihkan folder Default profil:`, rmErr.message);
            }
          }
        }
        try {
          fs.writeFileSync(walletMetaFile, walletAddr, 'utf8');
        } catch (e) {}

        // Otomatis buat farm di server jika akun sudah bayar registrasi tapi farm belum terdaftar
        try {
          const regRes = await fetch(`https://farmingseason.io/api/register/status?owner=${walletAddr}`);
          const reg = await regRes.json();
          if (reg && reg.registered) {
            const chalRes = await fetch(`https://farmingseason.io/api/farm/challenge?address=${walletAddr}`);
            const chal = await chalRes.json();
            if (chal && chal.nonce && chal.message) {
              const sig = await wallet.signMessage(chal.message);
              const loginRes = await fetch('https://farmingseason.io/api/farm/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: walletAddr, nonce: chal.nonce, signature: sig })
              });
              const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
              if (cookie) {
                authCookie = cookie;
                const farmRes = await fetch('https://farmingseason.io/api/farm', { headers: { 'Cookie': cookie } });
                const farmData = await farmRes.json();
                if (farmData && !farmData.farm) {
                  const targetName = (account.farmName || account.name || `Farm ${id}`).trim().slice(0, 24);
                  logger.info(id, account.name, `Farm belum dibuat di server. Mempersiapkan pembuatan farm "${targetName}"...`);

                  // Periksa verifikasi human (Turnstile) sebelum buat farm
                  try {
                    const hRes = await fetch(`https://farmingseason.io/api/human/status?owner=${walletAddr}`);
                    const hData = await hRes.json();
                    if (hData && !hData.verified && this.config.solvegateApiKey) {
                      logger.info(id, account.name, 'Meminta token Turnstile via SolveGate untuk registrasi...');
                      const sgRes = await fetch('https://api.solvegate.io/v1/solve', {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${this.config.solvegateApiKey}`,
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                          gate: 'turnstile',
                          sitekey: hData.siteKey || '0x4AAAAAAFX7cYbY970oYHna',
                          url: 'https://farmingseason.io'
                        })
                      });
                      const sgData = await sgRes.json();
                      if (sgData && sgData.token) {
                        await fetch('https://farmingseason.io/api/human/verify', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
                          body: JSON.stringify({ owner: walletAddr, token: sgData.token })
                        });
                      }
                    }
                  } catch (hErr) {}

                  const cRes = await fetch('https://farmingseason.io/api/farm/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
                    body: JSON.stringify({ name: targetName, tz: -new Date().getTimezoneOffset() })
                  });
                  const cData = await cRes.json();
                  if (cData && cData.farm) {
                    logger.action(id, account.name, `✅ Farm "${targetName}" berhasil dibuat di server!`);
                  }
                }
              }
            }
          }
        } catch (apiErr) {
          // Abaikan error jaringan awal, tetap lanjutkan inisialisasi browser
        }
      } catch (err) {
        console.warn(`[Acc ${id}] Format Private Key tidak valid:`, err.message);
      }
    }

    const instanceInfo = {
      account,
      browser: null,
      page: null,
      wallet,
      walletAddr,
      balanceEth: '0.0',
      status: {
        state: 'Starting...',
        energy: '--',
        owner: null,
        counts: { ready: 0, growing: 0, empty: 0, total: 0 },
        nextHarvest: '-',
        loopStatus: 'Initializing...',
        villageIncome: {
          accumulated: 0,
          rate: '+27/h',
          isFull: false,
          lastClaimAt: 0,
          nextClaimAt: Date.now() + 5 * 60 * 1000
        },
        needsLogin: false,
        needsCaptcha: false,
        regNeeded: false,
        regBalanceAlert: null,
        lastError: null
      },
      lastUpdate: Date.now()
    };
    this.instances.set(id, instanceInfo);

    try {
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        '--window-size=1280,850',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-blink-features=AutomationControlled',
        '--mute-audio',                           // Matikan audio pipeline (menghemat CPU & RAM)
        '--disable-extensions',                   // Matikan ekstensi bloatware bawaan
        '--disable-background-networking',        // Matikan update otomatis, telemetry, sync
        '--disable-sync',
        '--disable-translate',
        '--disable-default-apps',
        '--disable-component-update',
        '--disable-domain-reliability',
        '--no-pings',
        '--js-flags=--max-old-space-size=256',    // Batasi RAM V8 heap per tab agar tidak bengkak
        `--host-resolver-rules=MAP rpc.mainnet.chain.robinhood.com ${ROBINHOOD_IP}`
      ];

      const browser = await puppeteer.launch({
        executablePath: this.chromePath,
        headless: isVisible ? false : 'new',
        userDataDir: profileDir,
        args: launchArgs,
        defaultViewport: isVisible ? null : { width: 1280, height: 800 }
      });

      instanceInfo.browser = browser;
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();
      instanceInfo.page = page;

      logger.info(id, account.name, `Browser aktif (Mode: ${isVisible ? 'VISIBLE' : 'HEADLESS'}).`);

      // Tangkap log console dari dalam game & extension script
      page.on('console', msg => {
        const text = msg.text();
        if (text.startsWith('[FS') || text.includes('[FS') || text.includes('FarmingSeason') || /Placing|Building|Planting|Harvesting|Feeding|Collecting|Battle|Retreat|Loot|\bcap\b|Radish|Coop|Sheep|Initiating|Watchdog|Menunggu|Panen|Tanam/i.test(text)) {
          const cleaned = text.replace(/^\[FS-v[^\]]+\]\s*/, '').replace(/^\[FS\]\s*/, '').trim();
          if (/error|fail|reject|denied/i.test(cleaned)) {
            logger.error(id, account.name, cleaned);
          } else if (/warn|caution|waiting|saldo|cap full|watchdog/i.test(cleaned)) {
            logger.warn(id, account.name, cleaned);
          } else if (/placing|building|planting|harvesting|feeding|collecting|retreat|battle|perk|kills|initiating|panen|tanam|claim|klaim|village|income/i.test(cleaned)) {
            logger.action(id, account.name, cleaned);
          } else {
            logger.info(id, account.name, cleaned);
          }
        }
      });

      page.on('pageerror', err => {
        logger.error(id, account.name, `Page Runtime Error: ${err.message}`);
      });

      // Monitor laporan battle /api/farm/battle/end dan responnya dari server
      page.on('request', req => {
        try {
          const url = req.url();
          if (url.includes('/api/farm/battle/end')) {
            const postData = req.postData();
            if (postData) {
              const body = JSON.parse(postData);
              const statsStr = body.stats ? `Hits: ${body.stats.hits ?? 0}, Dodges: ${body.stats.dodges ?? 0}` : 'stats: -';
              logger.action(id, account.name, `⚔️ [BATTLE END REPORT] Mengirim ke Server: Wave ${body.wave || 1} | Kills: ${body.kills || 0} | Loot: +${body.earned || 0} SEASON | Durasi: ${body.seconds || 0}s | Mati: ${body.died ? 'YA (Natural)' : 'TIDAK'} | ${statsStr}`);
            }
          }
        } catch (e) {}
      });

      page.on('response', async res => {
        try {
          const url = res.url();
          if (url.includes('/api/farm/battle/end')) {
            const status = res.status();
            const text = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch(e) {}
            if (status === 200 && parsed && parsed.ok !== false) {
              logger.action(id, account.name, `🎉 [BATTLE END SUCCESS] Server Menerima Battle! Respon: ${JSON.stringify(parsed)}`);
            } else {
              logger.warn(id, account.name, `⚠️ [BATTLE END RESPONSE] HTTP ${status}: ${text}`);
            }
          }
        } catch (e) {}
      });

      // Handle disconnect
      browser.on('disconnected', () => {
        logger.warn(id, account.name, 'Browser disconnected.');
        if (this.isRunning && !options.singleSession) {
          instanceInfo.status.state = 'Disconnected. Restarting...';
          setTimeout(() => {
            if (this.isRunning) this.launchAccount(account, options);
          }, 5000);
        }
      });

      // Prepare bot settings
      const accountCfg = Object.assign({}, this.config.defaultSettings || {}, {
        plantCrop: account.crop || (this.config.defaultSettings && this.config.defaultSettings.plantCrop) || 'radish',
        autoFarm: true,
        autoPlant: true
      });

      // 0. If account has privateKey, inject Virtual Web3 Provider (Auto Sign & Connect)
      if (wallet && walletAddr) {
        try {
          // Expose RPC bridge to browser
          await page.exposeFunction('__fs_wallet_rpc', async (method, params) => {
            params = params || [];
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
              return [walletAddr];
            }
            if (method === 'eth_chainId') {
              return ROBINHOOD_CHAIN_ID_HEX;
            }
            if (method === 'net_version') {
              return String(ROBINHOOD_CHAIN_ID);
            }
            if (method === 'personal_sign') {
              const [msgData, addr] = params;
              let msg = msgData;
              try {
                if (typeof msgData === 'string' && msgData.startsWith('0x')) {
                  msg = ethers.toUtf8String(msgData);
                }
              } catch (e) {}
              const sig = await wallet.signMessage(msg);
              logger.action(id, account.name, 'Berhasil menandatangani autentikasi login (personal_sign)');
              return sig;
            }
            if (method === 'eth_sendTransaction') {
              const tx = params[0];
              const txValue = tx.value ? BigInt(tx.value) : 0n;

              // Check balance before sending transaction
              const currBal = await defaultProvider.getBalance(wallet.address);
              if (currBal < txValue) {
                const errMsg = `Saldo ETH tidak cukup: Punya ${ethers.formatEther(currBal)} ETH, Butuh ${ethers.formatEther(txValue)} ETH`;
                instanceInfo.status.state = '⚠️ Kurang Saldo ETH';
                instanceInfo.status.loopStatus = errMsg;
                logger.warn(id, account.name, errMsg);
                throw new Error(errMsg);
              }

              const isWithdrawTx = !!(tx.data && tx.data.startsWith('0x744fb6ca'));
              const txDesc = isWithdrawTx ? 'klaim withdraw token (vault-finish)' : 'pembayaran registrasi';

              // Hitung gas limit & fee dengan buffer aman agar tidak kena out-of-gas atau baseFee rejection
              let gasLimit = 350000n;
              try {
                const est = await defaultProvider.estimateGas({
                  from: wallet.address,
                  to: tx.to,
                  value: txValue || undefined,
                  data: tx.data || undefined
                });
                gasLimit = (est * 135n) / 100n;
              } catch (e) {
                gasLimit = isWithdrawTx ? 350000n : 150000n;
              }

              const feeData = await defaultProvider.getFeeData();
              const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 135n) / 100n : ethers.parseUnits('28', 'gwei');

              logger.info(id, account.name, `Mengirim transaksi ${txDesc} (GasLimit: ${gasLimit}, GasPrice: ${ethers.formatUnits(gasPrice, 'gwei')} gwei) ke ${tx.to}...`);
              const sentTx = await wallet.sendTransaction({
                to: tx.to,
                value: txValue || undefined,
                data: tx.data || undefined,
                gasLimit: gasLimit,
                gasPrice: gasPrice
              });

              instanceInfo.lastTxHash = sentTx.hash;
              instanceInfo.lastTxAt = Date.now();
              instanceInfo.lastTxDesc = txDesc;

              logger.action(id, account.name, `Transaksi ${txDesc} terkirim! Hash: ${sentTx.hash}`);
              return sentTx.hash;
            }
            if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
              return null;
            }
            try {
              return await defaultProvider.rpc(method, params);
            } catch (rpcErr) {
              return null;
            }
          });

          // Inject standard EIP-1193 window.ethereum
          await page.evaluateOnNewDocument((addr) => {
            const listeners = {};
            const provider = {
              isMetaMask: true,
              isVirtualWallet: true,
              chainId: '0x1237',
              networkVersion: '4663',
              selectedAddress: addr,
              request: async ({ method, params }) => {
                return await window.__fs_wallet_rpc(method, params || []);
              },
              send: (method, params) => provider.request({ method, params }),
              sendAsync: (payload, cb) => {
                provider.request({ method: payload.method, params: payload.params })
                  .then(result => cb(null, { id: payload.id, jsonrpc: '2.0', result }))
                  .catch(error => cb(error));
              },
              on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
              removeListener: (evt, fn) => {
                if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn);
              },
              emit: (evt, ...args) => {
                if (listeners[evt]) listeners[evt].forEach(fn => fn(...args));
              }
            };
            window.ethereum = provider;
          }, walletAddr);

          console.log(`[Acc ${id}] Virtual Wallet aktif untuk ${walletAddr.slice(0, 10)}...`);
        } catch (e) {
          console.warn(`[Acc ${id}] Gagal inisialisasi virtual wallet:`, e.message);
        }
      }

      // 1. Stealth patch to bypass Cloudflare Turnstile bot detection and hook callback
      await page.evaluateOnNewDocument(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        } catch (e) {}

        try {
          let _turnstile = window.turnstile;
          function hookTurnstile(ts) {
            if (!ts || typeof ts.render !== 'function' || ts.__fs_hooked) return ts;
            const origRender = ts.render;
            ts.render = function(container, opt) {
              if (opt && typeof opt.callback === 'function') {
                window.__fs_turnstile_callback = opt.callback;
              }
              return origRender.apply(this, arguments);
            };
            ts.__fs_hooked = true;
            return ts;
          }
          if (_turnstile) hookTurnstile(_turnstile);
          Object.defineProperty(window, 'turnstile', {
            get() { return _turnstile; },
            set(val) {
              _turnstile = hookTurnstile(val);
            },
            configurable: true
          });
        } catch (e) {}
      });

      const bootTime = Date.now();
      // Calculate staggered startup cooldown per account (default 2 minutes base + 4s stagger per account)
      const baseCooldownMin = typeof this.config.startupCooldownMinutes === 'number' ? this.config.startupCooldownMinutes : 2;
      const startupCooldownMs = (baseCooldownMin * 60 * 1000) + (id % 20) * 4000 + Math.floor(Math.random() * 2000);

      // 2. Preload settings and auto-login identity to localStorage before page loads
      await page.evaluateOnNewDocument((cfg, addr, bTime, sCoolMs) => {
        try {
          window.__FS_BOOT_TIME__ = bTime;
          window.__FS_STARTUP_COOLDOWN_MS__ = sCoolMs;
          const key = 'fs_extension_cfg_v4';
          const saved = localStorage.getItem(key);
          let current = saved ? JSON.parse(saved) : {};
          current.enabled = false; // Start in OFF state!
          current.panelOpen = false;
          current.cfg = Object.assign({}, current.cfg || {}, cfg);
          localStorage.setItem(key, JSON.stringify(current));

          if (addr) {
            localStorage.setItem('fs:lastOwner', addr.toLowerCase());
          }
          if (!localStorage.getItem('fs:ref')) {
            localStorage.setItem('fs:ref', 'FARM-WBF9L');
          }
        } catch (e) {}
      }, accountCfg, walletAddr, bootTime, startupCooldownMs);

      // 2. Inject extension script (reload latest from disk)
      try {
        const scriptPath = path.resolve(__dirname, '..', 'gmfb', 'farmingseason.js');
        if (fs.existsSync(scriptPath)) {
          this.extensionScript = fs.readFileSync(scriptPath, 'utf8');
        }
      } catch (e) {}
      if (this.extensionScript) {
        await page.evaluateOnNewDocument(this.extensionScript);
      }

      // 2B. Inject authenticated session cookie directly into page if available
      if (authCookie) {
        try {
          const cookieVal = authCookie.split('=')[1];
          if (cookieVal) {
            await page.setCookie({
              name: 'fs_session',
              value: cookieVal,
              domain: 'farmingseason.io',
              path: '/',
              httpOnly: true,
              secure: true
            });
          }
        } catch (e) {}
      }

      instanceInfo.status.state = 'Connecting...';

      // Navigate to game with referral code
      await page.goto(this.gameUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      const initRemSec = Math.ceil(startupCooldownMs / 1000);
      const initTimeStr = initRemSec >= 60 ? `${Math.floor(initRemSec / 60)}m ${initRemSec % 60}s` : `${initRemSec}s`;
      instanceInfo.status.state = `Syncing (${initTimeStr})`;
      instanceInfo.status.loopStatus = 'Warmup & sinkronisasi server...';

      // Setup state poller for this account
      this.pollAccountStatus(id);

    } catch (err) {
      instanceInfo.status.state = 'Error';
      instanceInfo.status.lastError = err.message;
    }
  }

  async pollAccountStatus(id) {
    const inst = this.instances.get(id);
    if (!inst || !inst.page) return;

    const check = async () => {
      if (!this.isRunning && !inst.isPolling) return;
      try {
        if (inst.page.isClosed()) return;

        const data = await inst.page.evaluate(() => {
          const fs = window.__fsFarmingSeason;
          const gate = document.getElementById('human-gate');
          const isGateVisible = !!(gate && gate.offsetParent !== null && !gate.hidden);

          // Auto-accept cookie banner if present
          const cookieBtn = [...document.querySelectorAll('button')].find(b => /accept all/i.test(b.textContent));
          if (cookieBtn && cookieBtn.offsetParent !== null) {
            cookieBtn.click();
          }

          // Registration modal check
          const nameForm = document.getElementById('name-form');
          const farmNameInput = document.getElementById('farm-name');
          const regFeeEl = document.getElementById('reg-fee');
          const regSubmit = document.getElementById('reg-submit');

          // Connect / Login button
          const loginBtn = document.querySelector('[data-action="login"]') || 
                           document.querySelector('.login-btn') || 
                           document.querySelector('button.login') ||
                           [...document.querySelectorAll('button')].find(b => /connect\s*wallet|sign in|connect|login/i.test(b.textContent));

          // Check if farm data is ACTUALLY loaded
          const hasFarmData = !!(fs && fs.state && fs.state.farmData && (Array.isArray(fs.state.farmData.fields) || fs.state.farmData.owner));

          // Only treat as fully running if farmData exists AND registration form is NOT open
          if (hasFarmData && !nameForm) {
            const s = fs.state;
            const farm = s.farmData;

            // DOM balance check (Membaca saldo riil dari tile Balance atau modal Withdraw)
            let domTokens = 0;
            const balanceEl = document.querySelector('button.tile.balance b, [data-action="withdraw-panel"] b, .tile.balance b');
            if (balanceEl) {
              const raw = balanceEl.textContent.replace(/[^0-9]/g, '');
              if (raw) domTokens = parseInt(raw, 10);
            }
            if (!domTokens) {
              const allTiles = document.querySelectorAll('.tile.balance, [data-action="withdraw-panel"], .tiles button');
              for (const t of allTiles) {
                if (t.textContent.includes('Balance') || t.textContent.includes('withdraw')) {
                  const m = t.textContent.match(/([0-9,]+)/);
                  if (m) {
                    const val = parseInt(m[1].replace(/,/g, ''), 10);
                    if (!isNaN(val) && val > 0) { domTokens = val; break; }
                  }
                }
              }
            }
            const rawFarmTokens = farm?.tokens ? Math.floor(farm.tokens) : 0;
            const seasonTokens = Math.max(rawFarmTokens, domTokens);
            if (farm && domTokens > 0) farm.tokens = domTokens;

            // Perolehan token hari ini (Battle Loot + Harvest Loot)
            const bEarned = s.battleLoot ? (s.battleLoot.earned || 0) : 0;
            const hEarned = s.harvestLoot ? (s.harvestLoot.earned || 0) : 0;
            const totalEarnedToday = bEarned + hEarned;

            // Crop yang sedang ditanam
            const cropPlanted = s.nextHarvestCrop || (Array.isArray(farm?.fields) && farm.fields.find(f => f.crop)?.crop) || 'Radish';

            // Village Income extraction
            let vIncome = s.villageIncome || { accumulated: 0, rate: '+27/h', isFull: false, lastClaimAt: 0, nextClaimAt: Date.now() + 5 * 60 * 1000 };
            const claimTile = document.querySelector('button[data-action="claim"], button.tile.claim');
            if (claimTile) {
              const bEl = claimTile.querySelector('b');
              if (bEl) {
                const m = bEl.textContent.match(/\+?([\d,]+)/);
                if (m) vIncome.accumulated = parseInt(m[1].replace(/,/g, ''), 10) || 0;
              }
              const tsEl = claimTile.querySelector('.ts');
              if (tsEl) {
                const txt = tsEl.textContent.trim();
                if (txt.includes('/h')) vIncome.rate = txt;
                else if (txt.includes('full')) vIncome.isFull = true;
              }
              if (claimTile.classList.contains('full')) vIncome.isFull = true;
            }

            // Withdraw stats
            const farmLevel = farm?.level || 1;
            const todayUtc = new Date().toISOString().slice(0, 10);
            const withdrawnUsd = (farm?.withdrawals?.day === todayUtc) ? (farm.withdrawals.usd || 0) : 0;
            const withdrawCapUsd = farm?.withdrawCapUsd ?? null;

            return {
              ok: true,
              enabled: !!s.enabled,
              startupDone: !!s.startupDone,
              startupCooldownRemaining: s.startupCooldownUntil ? Math.max(0, s.startupCooldownUntil - Date.now()) : 0,
              owner: farm?.owner || null,
              energy: farm?.today?.energy ?? '--',
              seasonTokens,
              totalEarnedToday,
              farmLevel,
              withdrawnUsd,
              withdrawCapUsd,
              cropPlanted,
              villageIncome: vIncome,
              currentTask: s.currentTask || 'idle',
              counts: s.counts || { ready: 0, growing: 0, empty: 0, total: 0 },
              loopStatus: s.loopStatus || 'Active',
              nextHarvest: s.nextHarvestText || '-',
              nextHarvestMs: s.nextHarvestMs || null,
              farmJobs: s.farmJobs || 0,
              stage: ((s.stage === 'battle' || s.currentTask === 'battling') && !/tumbuh|grinding harvest|hewan ok|standby|istirahat|selesai/i.test(s.loopStatus || '') && /wave|lobby|pertempuran|mulai battle/i.test(s.loopStatus || '')) ? 'battle' : (s.stage === 'battle' ? 'farm' : (s.stage || 'init')),
              battleWave: ((s.stage === 'battle' || s.currentTask === 'battling') && !/tumbuh|grinding harvest|hewan ok|standby|istirahat|selesai/i.test(s.loopStatus || '') && /wave|lobby|pertempuran|mulai battle/i.test(s.loopStatus || '')) ? (s.battleWave || 1) : 0,
              battleKills: s.battleKills || 0,
              battleLoot: s.battleLoot || { earned: 0, cap: 1687, isFull: false },
              harvestLoot: s.harvestLoot || { earned: 0, cap: 2147, isFull: false },
              silo: s.silo || { feed: 0, wheat: 0, corn: 0, grain: 0, maxGrain: 245, dailyEat: 0, canMix: false },
              animals: s.animals || { total: 0, hungry: 0, products: 0, productsReady: 0, nextMeal: '-', nextMealAt: 0, isReadyForBulkCollect: false, collectStatusDesc: '' },
              battleCapDone: !!s.battleCapDone,
              harvestCapDone: !!s.harvestCapDone,
              dailyTracker: s.dailyTracker || null,
              isBanned: !!(farm?.ban),
              banReason: (farm?.ban?.reason) || null,
              needsCaptcha: isGateVisible,
              needsLogin: false,
              hasNameForm: false
            };
          }

          return {
            ok: false,
            enabled: !!(fs && fs.state && fs.state.enabled),
            startupDone: !!(fs && fs.state && fs.state.startupDone),
            startupCooldownRemaining: (fs && fs.state && fs.state.startupCooldownUntil) ? Math.max(0, fs.state.startupCooldownUntil - Date.now()) : 0,
            hasNameForm: !!nameForm,
            farmNameInputVal: farmNameInput ? farmNameInput.value : '',
            regFeeText: regFeeEl ? regFeeEl.innerText : '',
            submitBtnDisabled: regSubmit ? regSubmit.disabled : false,
            alreadyPaid: !!(
              (regFeeEl && /fee paid/i.test(regFeeEl.innerText)) ||
              (regSubmit && /^create farm$/i.test(regSubmit.innerText.trim())) ||
              (regSubmit && /create farm/i.test(regSubmit.innerText) && !/pay/i.test(regSubmit.innerText)) ||
              (document.querySelector('.hint') && /nothing more to pay/i.test(document.querySelector('.hint').innerText))
            ),
            needsLogin: !nameForm && !!loginBtn,
            needsCaptcha: isGateVisible,
            title: document.title
          };
        });

        inst.status.needsCaptcha = !!data.needsCaptcha;

        // ==========================================================
        // PRIORITAS 1: PENYELESAIAN TURNSTILE CAPTCHA
        // Jika muncul CAPTCHA, prioritaskan selesai dulu sebelum aksi lainnya!
        // Setelah lolos CAPTCHA, bot masuk ke mode Standby 2 menit.
        // ==========================================================
        if (data.needsCaptcha) {
          inst.status.state = '⚠️ Auto-Solving Turnstile...';
          inst.status.loopStatus = '⚠️ Prioritas 1: Menyelesaikan CAPTCHA Turnstile...';

          const nowTime = Date.now();
          if (nowTime - (inst.lastTurnstileAttempt || 0) > 3500) {
            inst.lastTurnstileAttempt = nowTime;

            // Langkah 1: Cek apakah akun sebenarnya SUDAH terverifikasi di server
            if (inst.walletAddr) {
              try {
                const alreadyVerified = await inst.page.evaluate(async (owner) => {
                  try {
                    const res = await fetch(`/api/human/status?owner=${owner}`, { cache: 'no-store' });
                    const st = await res.json();
                    return !!(st && st.verified);
                  } catch (e) { return false; }
                }, inst.walletAddr);

                if (alreadyVerified) {
                  logger.action(id, inst.account.name, '✅ Akun sudah terverifikasi di server! Menghilangkan gate & reload...');
                  inst.status.needsCaptcha = false;
                  const standbyMs = (typeof this.config.startupCooldownMinutes === 'number' ? this.config.startupCooldownMinutes : 2) * 60 * 1000;
                  const remSec = Math.ceil(standbyMs / 1000);
                  const timeStr = remSec >= 60 ? `${Math.floor(remSec / 60)}m ${remSec % 60}s` : `${remSec}s`;
                  inst.status.state = `Syncing (${timeStr})`;
                  inst.status.loopStatus = `✅ Verifikasi aktif! Masuk mode Standby (${timeStr})...`;
                  await inst.page.evaluate((sMs) => {
                    try {
                      const g = document.getElementById('human-gate');
                      if (g) g.remove();
                      if (window.__fsFarmingSeason && window.__fsFarmingSeason.state) {
                        window.__fsFarmingSeason.state.startupCooldownUntil = Date.now() + sMs;
                        window.__fsFarmingSeason.state.startupDone = false;
                        window.__fsFarmingSeason.state.enabled = false;
                      }
                    } catch (e) {}
                  }, standbyMs);
                  await new Promise(r => setTimeout(r, 800));
                  await inst.page.reload({ waitUntil: 'domcontentloaded' });
                  return;
                }
              } catch (e) {}
            }

            // Langkah 2: Prioritas Utama Solve otomatis via SolveGate API
            const apiKey = this.config.solvegateApiKey;
            if (apiKey && inst.walletAddr) {
              try {
                logger.info(id, inst.account.name, 'Prioritas 1: Meminta token Turnstile ke SolveGate API...');
                const sgRes = await fetch('https://api.solvegate.io/v1/solve', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    gate: 'turnstile',
                    sitekey: '0x4AAAAAAFX7cYbY970oYHna',
                    url: 'https://farmingseason.io'
                  })
                });
                const sgData = await sgRes.json();
                if (sgData && sgData.token) {
                  logger.action(id, inst.account.name, `Token Turnstile didapatkan via SolveGate (${sgData.solve_ms} ms)! Mengirim verifikasi ke server...`);
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
                        return { success: true };
                      }
                      return { success: false, error: j?.error || j?.msg };
                    } catch (e) {
                      return { success: false, error: e.message };
                    }
                  }, sgData.token, inst.walletAddr);

                  if (solveResult && solveResult.success) {
                    logger.action(id, inst.account.name, '✅ Turnstile berhasil diverifikasi di server! Masuk mode Standby 2 menit...');
                    inst.status.needsCaptcha = false;
                    const standbyMs = (typeof this.config.startupCooldownMinutes === 'number' ? this.config.startupCooldownMinutes : 2) * 60 * 1000;
                    const remSec = Math.ceil(standbyMs / 1000);
                    const timeStr = remSec >= 60 ? `${Math.floor(remSec / 60)}m ${remSec % 60}s` : `${remSec}s`;
                    inst.status.state = `Syncing (${timeStr})`;
                    inst.status.loopStatus = `✅ Verifikasi selesai! Masuk mode Standby (${timeStr})...`;

                    await inst.page.evaluate((sMs) => {
                      try {
                        const g = document.getElementById('human-gate');
                        if (g) g.remove();
                        if (window.__fsFarmingSeason && window.__fsFarmingSeason.state) {
                          window.__fsFarmingSeason.state.startupCooldownUntil = Date.now() + sMs;
                          window.__fsFarmingSeason.state.startupDone = false;
                          window.__fsFarmingSeason.state.enabled = false;
                        }
                      } catch (e) {}
                    }, standbyMs);

                    await new Promise(r => setTimeout(r, 1200));
                    await inst.page.reload({ waitUntil: 'domcontentloaded' });
                    return;
                  } else {
                    logger.warn(id, inst.account.name, `Verifikasi token Turnstile ditolak server: ${solveResult?.error || 'Unknown'}`);
                  }
                }
              } catch (e) {
                logger.warn(id, inst.account.name, `SolveGate API gagal: ${e.message}`);
              }
            }

            // Langkah 3: Fallback Simulasi klik mouse Turnstile
            try {
              const box = await inst.page.evaluate(() => {
                const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
                if (iframe && iframe.offsetParent !== null) {
                  const r = iframe.getBoundingClientRect();
                  return { x: r.x, y: r.y, w: r.width, h: r.height };
                }
                const hgBox = document.getElementById('hg-box');
                if (hgBox && hgBox.offsetParent !== null) {
                  const r = hgBox.getBoundingClientRect();
                  return { x: r.x, y: r.y, w: r.width, h: r.height };
                }
                return null;
              });

              if (box && box.w > 20) {
                const cx = Math.round(box.x + Math.min(28, box.w * 0.12));
                const cy = Math.round(box.y + box.h / 2);
                logger.info(id, inst.account.name, `Auto-clicking Turnstile checkbox di (${cx}, ${cy})...`);

                await inst.page.mouse.move(Math.max(0, cx - 60), Math.max(0, cy - 40));
                await new Promise(r => setTimeout(r, 120));
                await inst.page.mouse.move(cx - 20, cy + 5, { steps: 5 });
                await new Promise(r => setTimeout(r, 90));
                await inst.page.mouse.move(cx, cy, { steps: 4 });
                await new Promise(r => setTimeout(r, 110));
                await inst.page.mouse.click(cx, cy);
              }
            } catch (e) {
              logger.warn(id, inst.account.name, `Gagal auto-click Turnstile: ${e.message}`);
            }
          }
          return; // Selama ada CAPTCHA, fokus selesaikan ini dulu, jangan cek task lain!
        }

        if (data.ok) {
          const isSyncing = !data.startupDone && (data.startupCooldownRemaining > 0 || !data.enabled);
          if (isSyncing) {
            const remSec = Math.ceil((data.startupCooldownRemaining || 0) / 1000);
            const timeStr = remSec >= 60 ? `${Math.floor(remSec / 60)}m ${remSec % 60}s` : `${remSec}s`;
            inst.status.state = remSec > 0 ? `Syncing (${timeStr})` : 'Syncing...';
          } else if (!data.enabled) {
            inst.status.state = 'Standby (OFF)';
          } else {
            inst.status.state = 'Running';
          }

          inst.status.enabled = !!data.enabled;
          inst.status.startupDone = !!data.startupDone;
          inst.status.energy = data.energy;
          inst.status.seasonTokens = data.seasonTokens || 0;
          inst.status.totalEarnedToday = data.totalEarnedToday || 0;
          inst.status.farmLevel = data.farmLevel || 1;
          inst.status.withdrawnUsd = data.withdrawnUsd || 0;
          inst.status.withdrawCapUsd = data.withdrawCapUsd || null;
          inst.status.cropPlanted = data.cropPlanted || 'Radish';
          inst.status.currentTask = data.currentTask || 'idle';
          inst.status.nextHarvestMs = data.nextHarvestMs || null;
          inst.status.dailyTracker = data.dailyTracker || null;
          inst.status.owner = data.owner;
          inst.status.counts = data.counts;
          inst.status.loopStatus = data.loopStatus;
          inst.status.battleWave = data.battleWave;
          inst.status.battleKills = data.battleKills;
          inst.status.nextHarvest = data.nextHarvest;
          inst.status.battleLoot = data.battleLoot;
          inst.status.harvestLoot = data.harvestLoot;
          inst.status.animals = data.animals;
          inst.status.silo = data.silo || { feed: 0, wheat: 0, corn: 0, grain: 0, maxGrain: 245, dailyEat: 0, canMix: false };
          inst.status.villageIncome = data.villageIncome || { accumulated: 0, rate: '+27/h', isFull: false, lastClaimAt: 0, nextClaimAt: Date.now() + 5 * 60 * 1000 };
          inst.status.stage = data.stage;
          inst.status.needsLogin = false;
          inst.status.regNeeded = false;
          inst.status.regBalanceAlert = null;
          inst.status.isBanned = !!data.isBanned;
          inst.status.banReason = data.banReason || null;
          if (data.isBanned) {
            const shortReason = (data.banReason && data.banReason.includes('automated'))
              ? 'Terdeteksi Bot Multi-Akun'
              : (data.banReason || 'Bot Review');
            inst.status.loopStatus = `⚠️ Ditinjau Dev (${shortReason})`;
          }

          if (data.battleCapDone && !inst.loggedBattleCap) {
            const capVal = data.battleLoot?.cap || 'Cap';
            logger.action(id, inst.account.name, `⚔️ Daily Battle Cap tercapai (${data.battleLoot?.earned || 0}/${capVal} SEASON). Berhenti battle hari ini.`);
            inst.loggedBattleCap = true;
          }
          if (data.harvestCapDone && !inst.loggedHarvestCap) {
            const capVal = data.harvestLoot?.cap || 'Cap';
            logger.action(id, inst.account.name, `🌾 Daily Harvest Cap tercapai (${data.harvestLoot?.earned || 0}/${capVal} SEASON). Selesai panen hari ini.`);
            inst.loggedHarvestCap = true;
          }

          const curProd = data.animals?.productsReady || 0;
          if (inst.prevProductCount > 0 && curProd === 0) {
            logger.action(id, inst.account.name, `🧺 Panen serentak ${inst.prevProductCount} produk hasil ternak selesai!`);
          }
          inst.prevProductCount = curProd;
        } else {
          inst.status.needsLogin = data.needsLogin;

          if (data.hasNameForm) {
            // === REGISTRATION FLOW (Name your farm + $1 ETH payment) ===
            const targetFarmName = (inst.account.farmName || inst.account.name || `Farm ${inst.account.id}`).trim().slice(0, 24);

            if (inst.wallet) {
              // 1. Cek apakah farm sudah terdaftar & dibuat di server (mencegah nyangkut di form)
              const nowCheck = Date.now();
              if (nowCheck - (inst.lastFarmServerCheck || 0) > 8000) {
                inst.lastFarmServerCheck = nowCheck;
                try {
                  const checkRemote = await fetch(`https://farmingseason.io/api/register/status?owner=${inst.walletAddr}`);
                  const crData = await checkRemote.json();
                  if (crData && crData.registered) {
                    const chalRes = await fetch(`https://farmingseason.io/api/farm/challenge?address=${inst.walletAddr}`);
                    const chal = await chalRes.json();
                    if (chal && chal.nonce && chal.message) {
                      const sig = await inst.wallet.signMessage(chal.message);
                      const lRes = await fetch('https://farmingseason.io/api/farm/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ address: inst.walletAddr, nonce: chal.nonce, signature: sig })
                      });
                      const ckHeader = lRes.headers.get('set-cookie');
                      const ckMatch = ckHeader ? ckHeader.match(/fs_session=([^;]+)/) : null;
                      const ckVal = ckMatch ? ckMatch[1] : (ckHeader ? ckHeader.split(';')[0].split('=')[1] : null);
                      if (ckVal) {
                        await inst.page.setCookie({
                          name: 'fs_session',
                          value: ckVal,
                          domain: 'farmingseason.io',
                          path: '/',
                          httpOnly: true,
                          secure: true
                        });
                        const fRes = await fetch('https://farmingseason.io/api/farm', { headers: { 'Cookie': `fs_session=${ckVal}` } });
                        const fData = await fRes.json();
                        if (fData && fData.farm) {
                          logger.action(id, inst.account.name, `🎉 Farm "${fData.farm.name}" sudah aktif di server! Membuka ladang ke game...`);
                          inst.status.state = 'Memuat Ladang...';
                          inst.status.loopStatus = `Farm "${fData.farm.name}" aktif di server. Membuka ladang...`;
                          await inst.page.reload({ waitUntil: 'domcontentloaded' });
                          return;
                        } else {
                          // Akun sudah bayar registrasi on-chain, tetapi farm belum terbuat di server!
                          // Selesaikan Turnstile via SolveGate lalu panggil create farm secara otomatis
                          logger.info(id, inst.account.name, `Registrasi on-chain lunas ($1). Memproses pembuatan desa farm "${targetFarmName}" secara otomatis...`);

                          try {
                            const hRes = await fetch(`https://farmingseason.io/api/human/status?owner=${inst.walletAddr}`);
                            const hData = await hRes.json();
                            if (hData && !hData.verified && this.config.solvegateApiKey) {
                              logger.info(id, inst.account.name, 'Menyelesaikan Turnstile CAPTCHA via SolveGate API...');
                              const sgRes = await fetch('https://api.solvegate.io/v1/solve', {
                                method: 'POST',
                                headers: {
                                  'Authorization': `Bearer ${this.config.solvegateApiKey}`,
                                  'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                  gate: 'turnstile',
                                  sitekey: hData.siteKey || '0x4AAAAAAFX7cYbY970oYHna',
                                  url: 'https://farmingseason.io'
                                })
                              });
                              const sgData = await sgRes.json();
                              if (sgData && sgData.token) {
                                await fetch('https://farmingseason.io/api/human/verify', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', 'Cookie': `fs_session=${ckVal}` },
                                  body: JSON.stringify({ owner: inst.walletAddr, token: sgData.token })
                                });
                                logger.action(id, inst.account.name, '✅ Verifikasi human Turnstile berhasil diselesaikan via SolveGate.');
                              }
                            }
                          } catch (sgErr) {
                            logger.warn(id, inst.account.name, `Gagal verifikasi SolveGate: ${sgErr.message}`);
                          }

                          const cRes = await fetch('https://farmingseason.io/api/farm/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Cookie': `fs_session=${ckVal}` },
                            body: JSON.stringify({ name: targetFarmName, tz: -new Date().getTimezoneOffset() })
                          });
                          const cData = await cRes.json();
                          if (cData && cData.farm) {
                            logger.action(id, inst.account.name, `🎉 Farm "${cData.farm.name}" berhasil dibuat secara otomatis di server! Masuk ke ladang...`);
                            inst.status.state = 'Memuat Ladang...';
                            inst.status.loopStatus = `Farm "${cData.farm.name}" aktif di server. Membuka ladang...`;
                            await inst.page.reload({ waitUntil: 'domcontentloaded' });
                            return;
                          }
                        }
                      }
                    }
                  }
                } catch (e) {}
              }

              const balInfo = await getBalance(inst.wallet.address);
              inst.balanceEth = balInfo.eth;

              // Parse exact ETH fee from UI text (e.g. "$1 ≈ 0.000408 ETH") or default to 0.0005 ETH
              let requiredWei = ethers.parseEther(SAFE_REG_ETH);
              const match = data.regFeeText.match(/([0-9.]+)\s*ETH/i);
              if (match && match[1]) {
                try {
                  const feeNum = parseFloat(match[1]);
                  // Biaya aktual + buffer gas fee L2 (0.00003 ETH)
                  requiredWei = ethers.parseEther((feeNum + 0.00003).toFixed(6));
                } catch (e) {}
              }

              const reqEthStr = ethers.formatEther(requiredWei).slice(0, 7);
              const curEthStr = balInfo.eth.slice(0, 7);

              if (balInfo.wei < requiredWei && !data.alreadyPaid) {
                // SALDO KURANG: Jangan klik submit! Tampilkan peringatan dan tunggu top-up
                inst.status.state = '⚠️ Kurang Saldo ETH';
                inst.status.regNeeded = true;
                inst.status.loopStatus = `⚠️ Butuh ~${reqEthStr} ETH (Punya: ${curEthStr} ETH). Menunggu topup...`;
                inst.status.regBalanceAlert = {
                  address: inst.wallet.address,
                  balance: curEthStr,
                  needed: reqEthStr
                };

                const nowTime = Date.now();
                if (nowTime - (inst.lastLoggedLowBalance || 0) > 30000) {
                  logger.warn(id, inst.account.name, `Saldo ETH kurang (${curEthStr} ETH < ${reqEthStr} ETH). Menunggu top-up ke ${inst.wallet.address}...`);
                  inst.lastLoggedLowBalance = nowTime;
                }

                // Isi nama farm di input agar siap ketika saldo cukup
                if (data.farmNameInputVal !== targetFarmName) {
                  await inst.page.evaluate((val) => {
                    const input = document.getElementById('farm-name');
                    if (input && input.value !== val) {
                      input.value = val;
                      input.dispatchEvent(new Event('input', { bubbles: true }));
                      input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  }, targetFarmName);
                }
              } else {
                // SALDO CUKUP: Otomatis submit registrasi & sign payment!
                const now = Date.now();
                const lastSubmit = inst.lastRegSubmitAt || 0;

                // Debounce submit agar tidak spam klik setiap 2 detik saat transaksi sedang diproses/pending
                if (now - lastSubmit > 20000) {
                  inst.status.state = 'Mendaftar Farm...';
                  inst.status.regNeeded = false;
                  inst.status.regBalanceAlert = null;
                  inst.status.loopStatus = `Saldo cukup (${curEthStr} ETH). Mendaftarkan farm "${targetFarmName}"...`;
                  inst.lastRegSubmitAt = now;

                  if (!inst.loggedSubmittingReg) {
                    logger.action(id, inst.account.name, `Saldo cukup (${curEthStr} ETH). Mendaftarkan farm "${targetFarmName}"...`);
                    inst.loggedSubmittingReg = true;
                  }

                  await inst.page.evaluate((val) => {
                    const input = document.getElementById('farm-name');
                    if (input) {
                      input.value = val;
                      input.dispatchEvent(new Event('input', { bubbles: true }));
                      input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    const btn = document.getElementById('reg-submit');
                    if (btn && !btn.disabled) {
                      btn.click();
                    }
                  }, targetFarmName);
                } else {
                  inst.status.state = 'Memproses Transaksi...';
                  inst.status.loopStatus = `Menunggu konfirmasi registrasi on-chain (${Math.ceil((20000 - (now - lastSubmit)) / 1000)}s)...`;
                }
              }
            } else {
              inst.status.state = '⚠️ Perlu Registrasi Manual';
              inst.status.loopStatus = 'Form "Name your farm" muncul tapi Private Key belum diset.';
              if (!inst.loggedManualRegPrompt) {
                logger.warn(id, inst.account.name, 'Form "Name your farm" muncul tapi Private Key belum diatur. Perlu login manual.');
                inst.loggedManualRegPrompt = true;
              }
            }

          } else if (data.needsLogin) {
            inst.status.state = '⚠️ Connecting Wallet...';
            inst.status.loopStatus = 'Mengklik Connect wallet...';
            if (inst.account.privateKey) {
              try {
                await inst.page.evaluate((addr) => {
                  if (addr) {
                    try { localStorage.setItem('fs:lastOwner', addr.toLowerCase()); } catch (e) {}
                  }
                  const btn = document.querySelector('[data-action="login"]') || 
                              document.querySelector('.login-btn') || 
                              document.querySelector('button.login') ||
                              [...document.querySelectorAll('button')].find(b => /connect\s*wallet|sign in|connect|login/i.test(b.textContent));
                  if (btn) btn.click();
                }, inst.walletAddr);
              } catch(e) {}
            } else {
              inst.status.state = '⚠️ Login Required';
              inst.status.loopStatus = 'Menunggu login manual via browser.';
            }
          } else {
            const remSec = Math.ceil((data.startupCooldownRemaining || 0) / 1000);
            const timeStr = remSec >= 60 ? `${Math.floor(remSec / 60)}m ${remSec % 60}s` : `${remSec}s`;
            inst.status.state = remSec > 0 ? `Syncing (${timeStr})` : 'Loading game...';
            inst.status.loopStatus = remSec > 0 ? `Memuat game & warmup sinkronisasi (${timeStr})...` : 'Memuat game dan sinkronisasi desa...';
          }
        }
        inst.lastUpdate = Date.now();
      } catch (e) {
        // Page might be navigating or reloading
      }

      if (this.isRunning) {
        setTimeout(check, 2500);
      }
    };

    check();
  }

  async start(accounts, options = {}) {
    this.isRunning = true;
    logger.system(`Memulai ${accounts.length} akun bot... (Mode: ${options.visible ? 'VISIBLE' : 'HEADLESS'})`);
    console.log(`\nMemulai ${accounts.length} akun...`);

    // Start Web Dashboard Server
    try {
      this.webServerUrl = await this.webServer.start();
      console.log('========================================================================================================================');
      console.log(`   🌐 LIVE WEB DASHBOARD AKTIF!`);
      console.log(`   👉 Buka di browser: ${this.webServerUrl}`);
      console.log('========================================================================================================================\n');
      
      // Otomatis buka web dashboard di browser pengguna
      if (this.config.autoOpenWeb !== false) {
        try {
          exec(`start ${this.webServerUrl}`);
        } catch (e) {}
      }
    } catch (e) {
      console.warn(`[Web Dashboard] Gagal memulai server web: ${e.message}`);
    }

    // Stagger startup by 1.5 seconds per account to prevent CPU spikes
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      console.log(`[${i + 1}/${accounts.length}] Menyiapkan ${acc.name} (ID: ${acc.id})...`);
      this.launchAccount(acc, options);
      if (i < accounts.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (!options.noDashboard && !options.webOnly) {
      this.startDashboard();
    } else if (options.webOnly) {
      console.log(`\n========================================================================================================================`);
      console.log(`   [Web Mode] CLI Dashboard dinonaktifkan agar terminal bersih.`);
      console.log(`   🟢 Bot sedang aktif berjalan 24/7 di background.`);
      console.log(`   👉 Pantau aktivitas & status lengkap di browser: ${this.webServerUrl}`);
      console.log(`   💡 Tekan [Ctrl + C] kapan saja untuk menghentikan bot dengan aman.`);
      console.log(`========================================================================================================================\n`);
    }
  }

  startDashboard() {
    if (this.dashboardInterval) clearInterval(this.dashboardInterval);

    this.dashboardInterval = setInterval(() => {
      this.renderDashboard();
    }, 2000);
  }

  renderDashboard() {
    // Clear screen
    process.stdout.write('\x1Bc');

    const total = this.instances.size;
    const now = new Date().toLocaleTimeString();

    // Dinamis sesuaikan lebar kolom Status dengan lebar terminal jendela pengguna
    const termCols = (process.stdout && process.stdout.columns) ? process.stdout.columns : 145;
    const statusColWidth = Math.max(50, Math.min(85, termCols - 88));
    const totalBannerWidth = 85 + statusColWidth;
    const bannerLine = '='.repeat(totalBannerWidth);
    const dividerLine = '----+-------------+----------+-----------+----------------+----------------+--------+' + '-'.repeat(statusColWidth);

    console.log(bannerLine);
    console.log(`   🌾 FARMING SEASON MULTI-BOT DASHBOARD — ${now} (${total} Akun Aktif)`);
    if (this.webServerUrl) {
      console.log(`   👉 WEB DASHBOARD: ${this.webServerUrl} (Buka di browser untuk visual lengkap & auto-refresh)`);
    }
    console.log(bannerLine);
    console.log(' ID | Nama Akun   | ⚡ Energy | 🪙 Saldo    | ⚔️ Battle Cap   | 🌾 Harvest Cap  | Ladang | Status Alur Kerja');
    console.log(dividerLine);

    const pendingTopups = [];

    for (const [id, inst] of this.instances) {
      const acc = inst.account;
      const st = inst.status;
      const idStr = String(id).padStart(2, ' ');
      const nameStr = (acc.name || `Akun ${id}`).slice(0, 11).padEnd(11, ' ');
      
      const energyStr = String(st.energy).padStart(4, ' ') + '⚡   ';
      const seasonVal = (st.seasonTokens && st.seasonTokens > 0) ? st.seasonTokens : (st.totalEarnedToday || 0);
      const seasonStr = (Number(seasonVal).toLocaleString('en-US') + ' 🪙').padStart(10, ' ').padEnd(11, ' ');

      // Battle Loot status (Selalu tampilkan earned/cap, jangan ditimpa tulisan MAX)
      let battleStr = '-';
      if (st.battleLoot) {
        battleStr = `${st.battleLoot.earned}/${st.battleLoot.cap}`.padStart(14, ' ');
      }
      battleStr = battleStr.slice(0, 14).padEnd(14, ' ');

      // Harvest Loot status (Selalu tampilkan earned/cap, jangan ditimpa tulisan MAX)
      let harvestStr = '-';
      if (st.harvestLoot) {
        harvestStr = `${st.harvestLoot.earned}/${st.harvestLoot.cap}`.padStart(14, ' ');
      }
      harvestStr = harvestStr.slice(0, 14).padEnd(14, ' ');

      const c = st.counts || { empty: 0, growing: 0, ready: 0 };
      const countsStr = `${c.empty}/${c.growing}/${c.ready}`.padEnd(6, ' ');
      
      let loopStr = st.loopStatus || 'Active';
      if (st.needsCaptcha) {
        loopStr = '⚡ PRIORITAS 1: Auto-Solving CAPTCHA...';
      } else if (st.state && st.state.startsWith('Syncing')) {
        loopStr = `⏳ ${st.state} - Sinkronisasi server...`;
      } else if (st.needsLogin) loopStr = '⚠️ Perlu Login Wallet';
      loopStr = loopStr.slice(0, statusColWidth);

      if (st.regBalanceAlert) {
        pendingTopups.push({ id, name: acc.name, ...st.regBalanceAlert });
      }

      console.log(` ${idStr} | ${nameStr} | ${energyStr} | ${seasonStr} | ${battleStr} | ${harvestStr} | ${countsStr} | ${loopStr}`);
    }

    if (pendingTopups.length > 0) {
      console.log(bannerLine);
      console.log(' ⚠️  PERINGATAN SALDO KURANG — MENUNGGU TOP-UP ETH (ROBINHOOD CHAIN - ID: 4663):');
      for (const t of pendingTopups) {
        console.log(`   • [ID ${t.id}] ${t.name}: Alamat ${t.address} | Saldo: ${t.balance} ETH | Butuh: ~${t.needed} ETH`);
      }
      console.log('   👉 Kirim ETH jaringan Robinhood ke alamat di atas. Bot otomatis sign & lanjut saat saldo masuk!');
    }

    console.log(bannerLine);
    console.log(' Urutan Alur: [1] Taruh 6 Field -> [2] Tanam Radish -> [3] Harvest smp Cap -> [4] Battle On-Demand via Tombol Dashboard');
    console.log(' Keterangan Ladang: Kosong / Tumbuh / Siap Panen | 📁 Log: logs/all.log & logs/error.log');
    console.log(' Tekan [Ctrl + C] untuk menghentikan semua akun dengan aman.');
  }

  async stop() {
    this.isRunning = false;
    if (this.dashboardInterval) clearInterval(this.dashboardInterval);
    if (this.webServer) {
      try {
        await this.webServer.stop();
      } catch (e) {}
    }

    console.log('\n\nMenutup semua browser instances (menyimpan battle loot jika ada)...');

    // Beri kesempatan instance yang sedang battle untuk retreat & save loot ke server
    for (const [id, inst] of this.instances) {
      if (inst.page && !inst.page.isClosed()) {
        try {
          await inst.page.evaluate(() => {
            const games = (window.Phaser && window.Phaser.GAMES) || [];
            for (const g of games) {
              const scenes = (g.scene && g.scene.scenes) || [];
              for (const s of scenes) {
                if (s && s.sys && s.sys.settings && s.sys.settings.key === 'battle') {
                  if (typeof s.endRun === 'function' && s.mode !== 'lobby' && s.mode !== 'over') {
                    console.log('[SHIELD] Shutdown: Mengakhiri battle untuk simpan loot...');
                    s.endRun(false);
                  }
                }
              }
            }
          });
        } catch (e) {}
      }
    }

    // Beri jeda 1.2 detik agar request /api/farm/battle/end terkirim
    await new Promise(r => setTimeout(r, 1200));

    logger.system('Semua browser instances telah dihentikan.');
    for (const [id, inst] of this.instances) {
      if (inst.browser) {
        try {
          await inst.browser.close();
        } catch (e) {}
      }
    }
    this.instances.clear();
    console.log('Semua akun berhasil dihentikan.\n');
  }

  async executeWithdraw(accountId, amount = 'all') {
    const { executeWithdraw } = require('./wallet.js');
    return await executeWithdraw(accountId, amount, this, this.accounts || this.config.accounts || []);
  }

  async executeWithdrawAll() {
    const { executeWithdraw } = require('./wallet.js');
    const accs = this.accounts || this.config.accounts || [];
    const results = [];
    for (const acc of accs) {
      const inst = this.instances.get(acc.id);
      const tokens = inst?.status?.seasonTokens || 0;
      if (tokens >= 1) {
        try {
          const res = await executeWithdraw(acc.id, 'all', this, accs);
          results.push({ accountId: acc.id, name: acc.name, ok: true, message: res.message });
        } catch (e) {
          results.push({ accountId: acc.id, name: acc.name, ok: false, error: e.message });
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    return results;
  }

  async startBattle(accountId) {
    const inst = this.instances.get(Number(accountId));
    if (!inst || !inst.page) {
      return { ok: false, message: `Instance akun #${accountId} tidak aktif atau browser belum siap` };
    }
    try {
      const result = await inst.page.evaluate(() => {
        if (typeof window.__fsStartBattle === 'function') {
          return window.__fsStartBattle();
        }
        return { ok: false, message: 'Script bot FarmingSeason belum terpasang di halaman' };
      });
      return result;
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async startBattleAll() {
    const results = [];
    for (const [id, inst] of this.instances) {
      if (inst && inst.page) {
        try {
          const res = await inst.page.evaluate(() => {
            if (typeof window.__fsStartBattle === 'function') {
              return window.__fsStartBattle();
            }
            return { ok: false, message: 'Script bot belum terpasang' };
          });
          results.push({ accountId: id, name: inst.account.name, ...res });
        } catch (e) {
          results.push({ accountId: id, name: inst.account.name, ok: false, message: e.message });
        }
      }
    }
    return results;
  }

  async buyEnergy(accountId, amount = 10) {
    const inst = this.instances.get(Number(accountId));
    if (!inst || !inst.page) {
      return { ok: false, message: `Instance akun #${accountId} tidak aktif atau browser belum siap` };
    }
    try {
      const result = await inst.page.evaluate((amt) => {
        if (typeof window.__fsBuyEnergy === 'function') {
          return window.__fsBuyEnergy(amt);
        }
        // Fallback: cari tombol buy energy di DOM
        const targetBtn = document.querySelector(`button[data-action="energy"][data-arg="${amt}"]`);
        if (targetBtn && !targetBtn.disabled) {
          targetBtn.click();
          return { ok: true, message: `+${amt} energy diproses via tombol game` };
        }
        const btn = document.createElement('button');
        btn.dataset.action = 'energy';
        btn.dataset.arg = String(amt);
        btn.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;z-index:-1;';
        document.body.appendChild(btn);
        btn.click();
        btn.remove();
        return { ok: true, message: `Perintah beli +${amt} energy terkirim ke game` };
      }, Number(amount) || 10);

      if (result && result.ok) {
        if (typeof result.newEnergy === 'number') {
          inst.status.energy = result.newEnergy;
        }
        if (typeof result.newTokens === 'number') {
          inst.status.seasonTokens = result.newTokens;
        }
      }
      return result;
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async mixFeed(accountId, amount = 'max') {
    const inst = this.instances.get(Number(accountId));
    if (!inst || !inst.page) {
      return { ok: false, message: `Instance akun #${accountId} tidak aktif atau browser belum siap` };
    }
    try {
      const result = await inst.page.evaluate((amt) => {
        if (typeof window.__fsMixFeed === 'function') {
          return window.__fsMixFeed(amt);
        }
        const targetBtn = document.querySelector(`button[data-action="make-feed"][data-arg="${amt}"]`);
        if (targetBtn && !targetBtn.disabled) {
          targetBtn.click();
          return { ok: true, message: `Mix feed diproses via tombol game` };
        }
        return { ok: false, message: 'Game belum siap untuk mix feed.' };
      }, amount);

      if (result && result.ok) {
        logger.action(accountId, inst.account.name, `🥣 Silo: Berhasil mix feed bags (+${result.bags || '10+'} bags)`);
      }
      return result;
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async mixFeedAll(amount = 'max') {
    const results = [];
    for (const [id, inst] of this.instances) {
      if (inst && inst.page) {
        const res = await this.mixFeed(id, amount);
        results.push({ accountId: id, name: inst.account.name, ...res });
        await new Promise(r => setTimeout(r, 600));
      }
    }
    return results;
  }

  // Khusus mode setup / login wallet (Satu jendela terbuka dengan Virtual Wallet aktif)
  async openLogin(account) {
    const profileDir = this.getProfileDir(account.id);
    console.log(`\n======================================================`);
    console.log(`  Membuka browser untuk ${account.name} (ID: ${account.id})`);
    console.log(`  Lokasi profil: ${profileDir}`);
    console.log(`  Browser terbuka secara visual (1 jendela).`);
    console.log(`  Virtual Wallet otomatis aktif jika ada Private Key.`);
    console.log(`  Silakan klik checkbox Turnstile jika muncul di layar.`);
    console.log(`  Setelah farm terbuat, tutup jendela browser untuk menyimpan session.`);
    console.log(`======================================================\n`);

    let wallet = null;
    let walletAddr = null;
    if (account.privateKey) {
      try {
        wallet = createWallet(account.privateKey);
        walletAddr = wallet.address.toLowerCase();
      } catch (err) {}
    }

    const browser = await puppeteer.launch({
      executablePath: this.chromePath,
      headless: false,
      userDataDir: profileDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        '--window-size=1280,850',
        '--disable-blink-features=AutomationControlled',
        '--mute-audio',
        '--disable-background-networking',
        '--no-pings',
        `--host-resolver-rules=MAP rpc.mainnet.chain.robinhood.com ${ROBINHOOD_IP}`
      ],
      defaultViewport: null
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    if (wallet && walletAddr) {
      await page.exposeFunction('__fs_wallet_rpc', async (method, params) => {
        params = params || [];
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
          return [walletAddr];
        }
        if (method === 'eth_chainId') return ROBINHOOD_CHAIN_ID_HEX;
        if (method === 'net_version') return String(ROBINHOOD_CHAIN_ID);
        if (method === 'personal_sign') {
          const [msgData] = params;
          let msg = msgData;
          try {
            if (typeof msgData === 'string' && msgData.startsWith('0x')) {
              msg = ethers.toUtf8String(msgData);
            }
          } catch (e) {}
          return await wallet.signMessage(msg);
        }
        return null;
      });

      await page.evaluateOnNewDocument((addr) => {
        const listeners = {};
        const provider = {
          isMetaMask: true,
          isVirtualWallet: true,
          chainId: '0x1237',
          networkVersion: '4663',
          selectedAddress: addr,
          request: async ({ method, params }) => {
            return await window.__fs_wallet_rpc(method, params || []);
          },
          send: (method, params) => provider.request({ method, params }),
          sendAsync: (payload, cb) => {
            provider.request({ method: payload.method, params: payload.params })
              .then(result => cb(null, { id: payload.id, jsonrpc: '2.0', result }))
              .catch(error => cb(error));
          },
          on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
          removeListener: (evt, fn) => {
            if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn);
          },
          emit: (evt, ...args) => {
            if (listeners[evt]) listeners[evt].forEach(fn => fn(...args));
          }
        };
        window.ethereum = provider;
      }, walletAddr);
    }

    await page.evaluateOnNewDocument(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      } catch (e) {}
    });

    if (this.extensionScript) {
      await page.evaluateOnNewDocument(this.extensionScript);
    }

    await page.goto(this.gameUrl, { waitUntil: 'domcontentloaded' });

    // Auto-assist di mode login: klik Connect wallet & isi nama farm otomatis
    const targetFarmName = (account.farmName || account.name || `Farm ${account.id}`).trim().slice(0, 24);
    const poller = setInterval(async () => {
      try {
        if (browser.isConnected() && !page.isClosed()) {
          await page.evaluate((name) => {
            // 1. Accept cookies
            const cookieBtn = [...document.querySelectorAll('button')].find(b => /accept all/i.test(b.textContent));
            if (cookieBtn && cookieBtn.offsetParent !== null) cookieBtn.click();

            // 2. Connect wallet
            const loginBtn = [...document.querySelectorAll('button')].find(b => /connect\s*wallet/i.test(b.textContent));
            if (loginBtn && loginBtn.offsetParent !== null) loginBtn.click();

            // 3. Auto-fill nama farm
            const nameInput = document.getElementById('farm-name');
            if (nameInput && nameInput.value !== name) {
              nameInput.value = name;
              nameInput.dispatchEvent(new Event('input', { bubbles: true }));
              nameInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, targetFarmName);
        } else {
          clearInterval(poller);
        }
      } catch (e) {}
    }, 2000);

    return new Promise((resolve) => {
      browser.on('disconnected', () => {
        clearInterval(poller);
        console.log(`Jendela ${account.name} telah ditutup. Session berhasil disimpan!`);
        resolve();
      });
    });
  }
}

module.exports = BotRunner;
