const fs = require('fs');
const path = require('path');
const readline = require('readline');
const BotRunner = require('./lib/runner');
const logger = require('./lib/logger');
const { getBalance, createWallet, SAFE_REG_ETH } = require('./lib/robinhood');

const CONFIG_PATH = path.resolve(__dirname, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const EXAMPLE_PATH = path.resolve(__dirname, 'config.example.json');
    if (fs.existsSync(EXAMPLE_PATH)) {
      const example = fs.readFileSync(EXAMPLE_PATH, 'utf8');
      fs.writeFileSync(CONFIG_PATH, example, 'utf8');
      console.log('⚠️ File config.json belum ada. Berhasil dibuat template baru dari config.example.json.');
      console.log('👉 Silakan masukkan Private Key dompet Anda ke dalam config.json sebelum menjalankan bot.\n');
      return JSON.parse(example);
    }

    const defaultConfig = {
      chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      webPort: 3000,
      solvegateApiKey: '',
      referralCode: 'FARM-WBF9L',
      defaultSettings: {
        autoFarm: true,
        harvestMode: 'all',
        autoPlant: true,
        plantMode: 'all',
        plantCrop: 'radish',
        autoFeed: true,
        hp: true,
        autoDodge: true,
        autoPlay: true,
        autoRestart: false,
        autoPerk: true,
        dmg: 1,
        spd: 1,
        loot: 1
      },
      accounts: [
        { id: 1, name: 'Akun 1', farmName: 'Sunny Valley 1', enabled: true, crop: 'radish', privateKey: '' }
      ]
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

function printHeader() {
  console.log('\n======================================================');
  console.log('   🌾 FARMING SEASON — MULTI-ACCOUNT CLI MANAGER');
  console.log('======================================================');
}

function listAccounts(config) {
  console.log('\n--- DAFTAR AKUN TERDAFTAR ---');
  console.log('ID  | Nama Akun    | Nama Farm        | Status   | Benih      | Auth Mode           | Wallet Address / Profil');
  console.log('----+--------------+------------------+----------+------------+---------------------+---------------------------');
  for (const acc of config.accounts) {
    const idStr = String(acc.id).padEnd(3, ' ');
    const nameStr = (acc.name || `Akun ${acc.id}`).slice(0, 12).padEnd(12, ' ');
    const farmStr = (acc.farmName || acc.name || `Farm ${acc.id}`).slice(0, 16).padEnd(16, ' ');
    const statusStr = (acc.enabled ? 'Aktif' : 'Nonaktif').padEnd(8, ' ');
    const cropStr = (acc.crop || config.defaultSettings.plantCrop || 'radish').padEnd(10, ' ');
    
    let authStr = '🌐 Manual Session   ';
    let detailStr = fs.existsSync(path.resolve(__dirname, 'profiles', `acc_${acc.id}`)) ? 'Session Tersimpan' : 'Belum Login';
    
    if (acc.privateKey) {
      authStr = '🔑 Auto Private Key ';
      try {
        const w = createWallet(acc.privateKey);
        detailStr = `${w.address.slice(0, 8)}...${w.address.slice(-6)}`;
      } catch (e) {
        detailStr = 'Invalid Key';
      }
    }

    console.log(`${idStr} | ${nameStr} | ${farmStr} | ${statusStr} | ${cropStr} | ${authStr} | ${detailStr}`);
  }
  console.log('------------------------------------------------------------------------------------------------------------\n');
}

async function checkBalances(config) {
  console.log('\n========================================================================================');
  console.log(` 💰 CEK SALDO ETH ROBINHOOD CHAIN (ID: 4663) — AMBANG REGISTRASI: ${SAFE_REG_ETH} ETH (~$1.00 - $1.20)`);
  console.log('========================================================================================');
  console.log('ID  | Nama Akun    | Nama Farm        | Alamat Wallet (Robinhood)                  | Saldo ETH   | Status');
  console.log('----+--------------+------------------+--------------------------------------------+-------------+-----------------------------');

  let needTopupCount = 0;
  for (const acc of config.accounts) {
    const idStr = String(acc.id).padEnd(3, ' ');
    const nameStr = (acc.name || `Akun ${acc.id}`).slice(0, 12).padEnd(12, ' ');
    const farmStr = (acc.farmName || acc.name || `Farm ${acc.id}`).slice(0, 16).padEnd(16, ' ');

    if (!acc.privateKey) {
      console.log(`${idStr} | ${nameStr} | ${farmStr} | [Belum ada Private Key - Mode Manual]      | -           | 🌐 Manual Browser Login`);
      continue;
    }

    try {
      const w = createWallet(acc.privateKey);
      const bal = await getBalance(w.address);
      const balEth = bal.eth.slice(0, 9).padEnd(11, ' ');
      let statusStr = '';
      if (bal.isSufficientForReg) {
        statusStr = '✅ Siap Registrasi / Aktif';
      } else {
        needTopupCount++;
        statusStr = `⚠️ Kurang (Butuh ~${SAFE_REG_ETH} ETH)`;
      }
      console.log(`${idStr} | ${nameStr} | ${farmStr} | ${w.address} | ${balEth} | ${statusStr}`);
    } catch (e) {
      console.log(`${idStr} | ${nameStr} | ${farmStr} | Format Private Key Error                   | -           | ❌ Error`);
    }
  }

  console.log('========================================================================================');
  if (needTopupCount > 0) {
    console.log(`⚠️ Ada ${needTopupCount} akun dengan saldo di bawah ${SAFE_REG_ETH} ETH.`);
    console.log('👉 Kirimkan ETH ke alamat di atas via jaringan Robinhood Chain.');
    console.log('   Bot otomatis mendeteksi saldo saat masuk dan tidak akan spam sign jika saldo kurang!\n');
  } else {
    console.log('✅ Semua akun dengan Private Key memiliki saldo yang cukup untuk registrasi!\n');
  }
}

async function addAccount(config, customName = null, customCrop = null, customPk = null, customFarm = null) {
  const nextId = config.accounts.reduce((max, a) => Math.max(max, a.id), 0) + 1;
  const name = customName || await askQuestion(`Masukkan label Akun baru (Default: Akun ${nextId}): `) || `Akun ${nextId}`;
  
  let farmName = customFarm;
  if (!farmName && !customName) {
    farmName = await askQuestion(`Masukkan Nama Farm di game (maks 24 huruf, default: ${name}): `);
  }
  farmName = (farmName || name).trim().slice(0, 24);

  let crop = customCrop;
  if (!crop && !customName) {
    crop = (await askQuestion(`Pilih benih (default: radish): `)) || 'radish';
  } else if (!crop) {
    crop = config.defaultSettings.plantCrop || 'radish';
  }

  let pk = customPk;
  if (!pk && !customName) {
    const inputPk = await askQuestion(`Masukkan Private Key (opsional, tekan Enter jika ingin login manual): `);
    if (inputPk && inputPk.trim().length > 10) pk = inputPk.trim();
  }

  const newAcc = {
    id: nextId,
    name: name,
    farmName: farmName,
    enabled: true,
    crop: crop
  };
  if (pk) newAcc.privateKey = pk;

  config.accounts.push(newAcc);
  saveConfig(config);
  console.log(`✅ Berhasil menambahkan ${name} [Farm: "${farmName}"] [Auth: ${pk ? 'Auto Private Key' : 'Manual Session'}]!`);
}

async function removeAccount(config, targetId = null) {
  listAccounts(config);
  const idStr = targetId || await askQuestion('Masukkan ID Akun yang ingin dihapus: ');
  const id = parseInt(idStr, 10);
  const idx = config.accounts.findIndex(a => a.id === id);

  if (idx === -1) {
    console.log(`❌ Akun dengan ID ${id} tidak ditemukan.`);
    return;
  }

  const removed = config.accounts.splice(idx, 1)[0];
  saveConfig(config);
  console.log(`✅ Akun ${removed.name} (ID: ${removed.id}) telah dihapus dari daftar.`);
}

async function startBot(config, selectedAccounts, options = {}) {
  const runner = new BotRunner(config);

  let isStopping = false;
  const handleExit = async () => {
    if (isStopping) return;
    isStopping = true;
    console.log('\n🛑 [Ctrl + C] Terdeteksi! Menutup semua bot & browser instances...');
    try {
      await runner.stop();
    } catch (e) {}
    console.log('✅ Bot dan seluruh browser telah berhasil berhenti sepenuhnya.\n');
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);

  const runOpts = typeof options === 'boolean' ? { visible: options } : (options || {});
  await runner.start(selectedAccounts, runOpts);
}

async function showLogsInteractive(config) {
  console.log('\n--- PILIHAN LOG YANG INGIN DILIHAT ---');
  console.log('1. Semua Log Aktivitas Gabungan (logs/all.log)');
  console.log('2. Log Error & Warning Saja (logs/error.log)');
  console.log('3. Log Khusus Akun Tertentu (logs/acc_<id>.log)');
  console.log('0. Kembali ke Menu');
  const opt = await askQuestion('Pilih opsi [0-3]: ');

  if (opt === '1') {
    console.log('\n========================================================================');
    console.log(' 📜 35 BARIS LOG TERAKHIR DARI SELURUH AKUN (logs/all.log)');
    console.log('========================================================================');
    console.log(logger.getRecentLogs('all', 35));
    console.log('========================================================================\n');
    await askQuestion('Tekan [Enter] untuk kembali...');
  } else if (opt === '2') {
    console.log('\n========================================================================');
    console.log(' ⚠️ 35 BARIS LOG ERROR & WARNING TERAKHIR (logs/error.log)');
    console.log('========================================================================');
    console.log(logger.getRecentLogs('error', 35));
    console.log('========================================================================\n');
    await askQuestion('Tekan [Enter] untuk kembali...');
  } else if (opt === '3') {
    listAccounts(config);
    const idStr = await askQuestion('Masukkan ID Akun yang ingin dicek: ');
    const id = parseInt(idStr, 10);
    console.log('\n========================================================================');
    console.log(` 📜 35 BARIS LOG TERAKHIR UNTUK AKUN ${id} (logs/acc_${id}.log)`);
    console.log('========================================================================');
    console.log(logger.getRecentLogs(id, 35));
    console.log('========================================================================\n');
    await askQuestion('Tekan [Enter] untuk kembali...');
  }
}

async function runInteractiveMenu() {
  const config = loadConfig();

  while (true) {
    printHeader();
    console.log(`Jumlah akun terdaftar: ${config.accounts.length}`);
    console.log('1. Jalankan Semua Akun Aktif (Background / Headless)');
    console.log('2. Jalankan N Akun (Tentukan jumlah, misal 5, 10, dll.)');
    console.log('3. Jalankan Akun Tertentu (Pilih ID, misal: 1, 3)');
    console.log('4. Jalankan dengan Jendela Terlihat (Mode Debug GUI)');
    console.log('5. Cek Saldo ETH (Robinhood Chain) Semua Akun 💰');
    console.log('6. Login / Setup Akun Manual (Connect Wallet via Browser)');
    console.log('7. Tambah Akun Baru');
    console.log('8. Hapus / Kurangi Akun');
    console.log('9. Lihat Daftar Akun');
    console.log('10. Ganti Benih / Crop');
    console.log('11. Lihat Log Aktivitas / Error 📜');
    console.log('0. Keluar');
    console.log('======================================================');

    const choice = await askQuestion('Pilih menu [0-11]: ');

    if (choice === '1') {
      const active = config.accounts.filter(a => a.enabled);
      if (active.length === 0) {
        console.log('⚠️ Tidak ada akun yang aktif. Aktifkan atau tambah akun dulu.');
        continue;
      }
      await startBot(config, active, false);
      break;
    } else if (choice === '2') {
      const countStr = await askQuestion(`Berapa akun yang ingin dijalankan? (Tersedia ${config.accounts.length}): `);
      const count = parseInt(countStr, 10);
      if (isNaN(count) || count <= 0) {
        console.log('Input tidak valid.');
        continue;
      }

      while (config.accounts.length < count) {
        const nextId = config.accounts.reduce((max, a) => Math.max(max, a.id), 0) + 1;
        config.accounts.push({
          id: nextId,
          name: `Akun ${nextId}`,
          farmName: `Farm ${nextId}`,
          enabled: true,
          crop: config.defaultSettings.plantCrop || 'radish'
        });
      }
      saveConfig(config);

      const toRun = config.accounts.slice(0, count);
      await startBot(config, toRun, false);
      break;
    } else if (choice === '3') {
      listAccounts(config);
      const idsStr = await askQuestion('Masukkan ID akun yang ingin dijalankan (pisahkan dengan koma, misal: 1, 2, 4): ');
      const ids = idsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const toRun = config.accounts.filter(a => ids.includes(a.id));
      if (toRun.length === 0) {
        console.log('Tidak ada akun yang cocok.');
        continue;
      }
      await startBot(config, toRun, false);
      break;
    } else if (choice === '4') {
      const active = config.accounts.filter(a => a.enabled);
      await startBot(config, active, true);
      break;
    } else if (choice === '5') {
      await checkBalances(config);
      await askQuestion('Tekan [Enter] untuk kembali ke menu...');
    } else if (choice === '6') {
      listAccounts(config);
      const idStr = await askQuestion('Pilih ID Akun yang ingin di-login: ');
      const id = parseInt(idStr, 10);
      const acc = config.accounts.find(a => a.id === id);
      if (!acc) {
        console.log('Akun tidak ditemukan.');
        continue;
      }
      const runner = new BotRunner(config);
      await runner.openLogin(acc);
    } else if (choice === '7') {
      await addAccount(config);
    } else if (choice === '8') {
      await removeAccount(config);
    } else if (choice === '9') {
      listAccounts(config);
      await askQuestion('Tekan [Enter] untuk kembali ke menu...');
    } else if (choice === '10') {
      console.log('\nPilihan benih populer: radish (30m), turnip (30m), carrot (30m), onion (1h), wheat (2h), tomato (4h), pumpkin (24h)');
      const crop = await askQuestion('Ketik nama benih: ');
      if (crop) {
        const target = await askQuestion('Terapkan untuk semua akun? (y/n, default: y): ');
        if (target.toLowerCase() !== 'n') {
          config.accounts.forEach(a => a.crop = crop);
          config.defaultSettings.plantCrop = crop;
          saveConfig(config);
          console.log(`✅ Semua akun sekarang menanam benih: ${crop}`);
        } else {
          listAccounts(config);
          const idStr = await askQuestion('Pilih ID akun: ');
          const id = parseInt(idStr, 10);
          const acc = config.accounts.find(a => a.id === id);
          if (acc) {
            acc.crop = crop;
            saveConfig(config);
            console.log(`✅ ${acc.name} sekarang menanam benih: ${crop}`);
          }
        }
      }
    } else if (choice === '11') {
      await showLogsInteractive(config);
    } else if (choice === '0') {
      console.log('Sampai jumpa!');
      process.exit(0);
    }
  }
}

// CLI Parameter Parsing
async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args.length === 0) {
    await runInteractiveMenu();
    return;
  }

  const cmd = args[0];

  if (cmd === 'start') {
    let count = null;
    let selectedIds = null;
    let visible = args.includes('--visible') || args.includes('-v');
    let webOnly = args.includes('--web-only') || args.includes('--no-cli');

    for (let i = 1; i < args.length; i++) {
      if ((args[i] === '-n' || args[i] === '--count') && args[i + 1]) {
        count = parseInt(args[i + 1], 10);
        i++;
      } else if ((args[i] === '--accounts' || args[i] === '--acc') && args[i + 1]) {
        selectedIds = args[i + 1].split(',').map(s => parseInt(s.trim(), 10));
        i++;
      }
    }

    let toRun = config.accounts.filter(a => a.enabled);

    if (count !== null && !isNaN(count)) {
      while (config.accounts.length < count) {
        const nextId = config.accounts.reduce((max, a) => Math.max(max, a.id), 0) + 1;
        config.accounts.push({
          id: nextId,
          name: `Akun ${nextId}`,
          farmName: `Farm ${nextId}`,
          enabled: true,
          crop: config.defaultSettings.plantCrop || 'radish'
        });
      }
      saveConfig(config);
      toRun = config.accounts.slice(0, count);
    } else if (selectedIds) {
      toRun = config.accounts.filter(a => selectedIds.includes(a.id));
    }

    console.log(`Menjalankan ${toRun.length} akun dalam mode ${visible ? 'VISIBLE' : 'HEADLESS / BACKGROUND'}...`);
    await startBot(config, toRun, { visible, webOnly });

  } else if (cmd === 'balance' || cmd === 'balances' || cmd === 'cek') {
    await checkBalances(config);

  } else if (cmd === 'logs' || cmd === 'log') {
    const target = args[1] || 'all';
    const lines = parseInt(args[2], 10) || 40;
    console.log(`\n========================================================================`);
    console.log(` 📜 MENAMPILKAN ${lines} BARIS LOG TERAKHIR [${target.toUpperCase()}]`);
    console.log(`========================================================================`);
    console.log(logger.getRecentLogs(target, lines));
    console.log(`========================================================================\n`);

  } else if (cmd === 'login') {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) {
      listAccounts(config);
      const inputId = parseInt(await askQuestion('Pilih ID Akun yang ingin di-login: '), 10);
      const acc = config.accounts.find(a => a.id === inputId);
      if (acc) {
        const runner = new BotRunner(config);
        await runner.openLogin(acc);
      }
    } else {
      let acc = config.accounts.find(a => a.id === id);
      if (!acc) {
        acc = { id, name: `Akun ${id}`, farmName: `Farm ${id}`, enabled: true, crop: 'radish' };
        config.accounts.push(acc);
        saveConfig(config);
      }
      const runner = new BotRunner(config);
      await runner.openLogin(acc);
    }

  } else if (cmd === 'list') {
    listAccounts(config);

  } else if (cmd === 'add') {
    const name = args[1] || null;
    const crop = args[2] || null;
    await addAccount(config, name, crop);

  } else if (cmd === 'remove' || cmd === 'rm') {
    const id = args[1] || null;
    await removeAccount(config, id);

  } else {
    console.log('Perintah tidak dikenali.');
    console.log('Gunakan:');
    console.log('  node cli.js                          (Buka menu interaktif)');
    console.log('  node cli.js start                    (Jalankan semua akun di background)');
    console.log('  node cli.js start -n 5               (Jalankan 5 akun di background)');
    console.log('  node cli.js start -n 10              (Jalankan 10 akun di background)');
    console.log('  node cli.js start --acc 1,3,5        (Jalankan akun ID 1, 3, dan 5)');
    console.log('  node cli.js start --visible          (Jalankan dengan jendela terlihat)');
    console.log('  node cli.js balance                  (Cek saldo ETH Robinhood semua akun)');
    console.log('  node cli.js logs                     (Lihat log aktivitas terbaru)');
    console.log('  node cli.js logs error               (Lihat log error & warning saja)');
    console.log('  node cli.js logs <id>                (Lihat log khusus Akun ID tertentu)');
    console.log('  node cli.js login <id>               (Buka browser untuk login wallet Akun ID)');
    console.log('  node cli.js list                     (Lihat daftar akun)');
    console.log('  node cli.js add [nama]               (Tambah akun baru)');
    console.log('  node cli.js remove <id>              (Hapus akun)');
  }
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
