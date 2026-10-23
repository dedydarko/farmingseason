const { ethers } = require('ethers');
const fs = require('fs');

async function solveAndCreate(accountId, apiKey) {
  const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  const acc = config.accounts.find(a => a.id === accountId);
  if (!acc || !acc.privateKey) {
    console.error('Akun tidak ditemukan atau tidak memiliki private key.');
    return;
  }

  const wallet = new ethers.Wallet(acc.privateKey);
  const owner = wallet.address.toLowerCase();
  console.log(`\n=========================================`);
  console.log(`[Akun ${acc.id} - ${acc.name}]`);
  console.log(`Alamat Wallet: ${owner}`);
  console.log(`Farm Name: ${acc.farmName || acc.name}`);
  console.log(`=========================================`);

  // 1. Dapatkan Challenge dan Sign via Private Key
  console.log('[1/4] Mengambil challenge autentikasi dari server...');
  const chalRes = await fetch(`https://farmingseason.io/api/farm/challenge?address=${owner}`);
  const chal = await chalRes.json();
  const signature = await wallet.signMessage(chal.message);

  // 2. Login ke game untuk mendapatkan session cookie
  console.log('[2/4] Melakukan login (POST /api/farm/login)...');
  const loginRes = await fetch('https://farmingseason.io/api/farm/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: owner, nonce: chal.nonce, signature })
  });
  const cookie = loginRes.headers.get('set-cookie');
  const loginData = await loginRes.json();

  if (!loginRes.ok || !cookie) {
    console.error('Gagal login ke game:', loginData);
    return;
  }
  console.log('Login berhasil! Session cookie diperoleh.');

  if (loginData.farm) {
    console.log('✅ Farm sudah terdaftar dan siap dimainkan! Tidak perlu create farm lagi.');
    return;
  }

  // 3. Request Token Turnstile ke SolveGate API
  console.log('[3/4] Meminta token Turnstile ke SolveGate API...');
  console.log(`Menggunakan API Key: ${apiKey.slice(0, 12)}...`);
  
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
  if (!sgRes.ok || !sgData.token) {
    console.error('❌ SolveGate API Error:', sgData);
    return;
  }

  const token = sgData.token;
  console.log(`✅ Token Turnstile diperoleh (${token.length} chars)! Waktu solve: ${sgData.solve_ms} ms`);

  // 4. Submit Token Turnstile ke Farming Season
  console.log('[4/4] Memverifikasi token ke Farming Season (/api/human/verify)...');
  const verifyRes = await fetch('https://farmingseason.io/api/human/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie
    },
    body: JSON.stringify({ owner, token })
  });
  const verifyData = await verifyRes.json();
  console.log('Hasil Verifikasi Turnstile:', verifyData);

  if (!verifyData.ok) {
    console.error('❌ Gagal verifikasi Turnstile di server game.');
    return;
  }

  // 5. Create Farm!
  const targetFarmName = (acc.farmName || acc.name).trim().slice(0, 24);
  console.log(`[Final] Membuat farm "${targetFarmName}" (/api/farm/create)...`);
  const createRes = await fetch('https://farmingseason.io/api/farm/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie
    },
    body: JSON.stringify({
      name: targetFarmName,
      tz: -new Date().getTimezoneOffset()
    })
  });
  const createData = await createRes.json();
  console.log('Status pembuatan farm:', createRes.status);
  console.log('Respon server:', createData);

  if (createData.farm) {
    console.log(`\n🎉 SUKSES BESAR! Farm "${createData.farm.name}" berhasil dibuat secara otomatis tanpa browser!`);
  }
}

const accountId = parseInt(process.argv[2], 10) || 1;
let cfgKey = '';
try {
  if (fs.existsSync('config.json')) {
    cfgKey = JSON.parse(fs.readFileSync('config.json', 'utf8')).solvegateApiKey || '';
  }
} catch (e) {}
const apiKey = process.argv[3] || cfgKey;

if (!apiKey) {
  console.error('Error: solvegateApiKey tidak ditemukan di config.json atau argumen baris perintah.');
  process.exit(1);
}

solveAndCreate(accountId, apiKey).catch(console.error);
