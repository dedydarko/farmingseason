# 🌾 FarmingSeason Multi-Account Automation & Live Web Dashboard

Sistem otomatisasi multi-akun cerdas untuk game **[Farming Season](https://farmingseason.io)** di jaringan **Robinhood Chain (Chain ID: 4663)**. Dilengkapi antarmuka **Live Web Dashboard**, modul **God Mode Battle Arena**, **Auto Panen & Pakan Ternak**, **Bypass Cloudflare Turnstile**, serta **1-Click Smart Contract On-Chain Withdraw**.

---

## ⚠️ PERINGATAN KEAMANAN (SECURITY FIRST)

> [!CAUTION]
> **JANGAN PERNAH MENG-COMMIT ATAU MEMBAGIKAN FILE BERIKUT KE GITHUB PUBLIK:**
> 1. **`config.json`** — Berisi **Private Key** dompet kripto dan **SolveGate API Key** Anda!
> 2. **`profiles/`** — Berisi sesi login Chrome, cookie autentikasi, dan data browser pribadi.
> 3. **`data/` & `logs/`** — Berisi riwayat transaksi dan log aktivitas akun pribadi Anda.
>
> File `.gitignore` bawaan proyek ini **sudah otomatis mengecualikan** file-file sensitif tersebut. Gunakan file template [**`config.example.json`**](config.example.json) untuk dibagikan kepada teman atau publik.

---

## ✨ Fitur Unggulan

* 🚀 **Multi-Account Headless Runner**: Menjalankan puluhan akun secara simultan di latar belakang (*background*) tanpa membebani memori CPU/RAM dengan jendela browser terbuka.
* 🌐 **Live Web Dashboard Modern (`http://localhost:3000`)**: Pantau status semua akun, saldo in-game, saldo on-chain, timer panen ladang, status hewan ternak, dan grafik harga live $SEASON dari DexScreener.
* 🛡️ **Auto-Solver Cloudflare Turnstile**: Terintegrasi langsung dengan SolveGate API untuk menyelesaikan *quick check* Turnstile secara instan (~1 detik) saat registrasi akun baru maupun saat penarikan saldo.
* 💰 **1-Click On-Chain Withdraw (Smart Contract Vault)**: Tarik token $SEASON dari game langsung ke dompet on-chain Robinhood Chain hanya dengan 1 kali klik. Otomatis menghitung daily limit, biaya gas aman, serta konfirmasi blok explorer.
* ⚔️ **God Mode Battle Arena**: Auto battle dengan HP tak terbatas, auto-dodge serangan monster, auto-perk buff, dan otomatis *retreat* mengamankan loot saat *Daily Battle Cap* tercapai.
* 🌾 **Smart Farm & Livestock Management**:
  * Auto panen serentak (*Bulk Harvest 2⚡*) & tanam otomatis (Radish/benih lain).
  * Auto beli energi dari game saat dibutuhkan.
  * Auto pakan ternak 2x sehari (Jendela Pagi & Sore) dengan deteksi waktu mundur (*zero spam cooldown*).
* 🔑 **Virtual Web3 Wallet Injector**: Menggunakan provider virtual EIP-1193 berbasis `ethers.js`. **TIDAK PERLU** menginstal ekstensi MetaMask di setiap profil browser.
* 🌐 **Anti-DNS Poisoning ISP Indonesia**: Dilengkapi edge direct resolution ke IP Cloudflare (`104.20.46.209`) untuk menjamin koneksi RPC Robinhood Chain tetap lancar tanpa terblokir internet positif/DNS nawala.

---

## 🛠️ Prasyarat Sistem

1. **Node.js**: Versi **v18.x** atau **v20.x** ke atas ([Download Node.js](https://nodejs.org/)).
2. **Google Chrome**: Browser Google Chrome terinstal di komputer.
3. **Saldo Gas Fee ETH**: Minimal **0.0005 ETH** di jaringan **Robinhood Chain (Chain ID: 4663)** pada masing-masing wallet akun untuk biaya registrasi $1 dan gas fee klaim.
4. *(Disarankan)* **API Key SolveGate**: Kunci API dari [SolveGate.io](https://solvegate.io) untuk menyelesaikan Turnstile CAPTCHA otomatis tanpa klik manual.

---

## 🚀 Panduan Memulai Cepat (Quick Start)

### 1. Clone Repositori
```bash
git clone <URL_REPOSITORY_ANDA>
cd farmingseason
```

### 2. Pasang Dependensi
```bash
npm install
```

### 3. Buat File Konfigurasi
Salin file template `config.example.json` menjadi `config.json`:
```bash
# Windows PowerShell
copy config.example.json config.json

# Linux / MacOS / Git Bash
cp config.example.json config.json
```

### 4. Edit `config.json`
Buka file `config.json` dengan text editor (VS Code, Notepad, dll.) lalu masukkan Private Key dan API Key Anda:
```json
{
  "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "headless": true,
  "webPort": 3000,
  "solvegateApiKey": "YOUR_SOLVEGATE_API_KEY_HERE",
  "referralCode": "FARM-WBF9L",
  "accounts": [
    {
      "id": 1,
      "name": "Akun 1",
      "farmName": "Sunny Valley 1",
      "crop": "radish",
      "enabled": true,
      "privateKey": "0xMASUKKAN_PRIVATE_KEY_AKUN_1"
    },
    {
      "id": 2,
      "name": "Akun 2",
      "farmName": "Sunny Valley 2",
      "crop": "radish",
      "enabled": true,
      "privateKey": "0xMASUKKAN_PRIVATE_KEY_AKUN_2"
    }
  ]
}
```

### 5. Cek Saldo & Kesiapan Akun
Periksa kesiapan saldo ETH registrasi di Robinhood Chain:
```bash
node cli.js balance
```

### 6. Jalankan Bot & Web Dashboard
```bash
# Menjalankan bot di background + buka Web Dashboard
node cli.js start --web-only
```
Buka browser Anda dan akses:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 💻 Daftar Perintah CLI

| Perintah | Deskripsi |
| :--- | :--- |
| `node cli.js` | **Menu Interaktif.** Membuka antarmuka menu CLI pilihan angka (0-11). |
| `node cli.js start` | **Jalankan Semua Akun.** Mode CLI terminal dashboard. |
| `node cli.js start --web-only` | **Jalankan Mode Web.** Menjalankan bot di background dan fokus pada Web Dashboard (`localhost:3000`). |
| `node cli.js start -n <jumlah>` | **Jalankan N Akun.** Menjalankan sejumlah akun yang ditentukan (misal `node cli.js start -n 5`). |
| `node cli.js start --acc <id1,id2>` | **Jalankan Akun Tertentu.** Hanya menjalankan akun dengan ID yang dipilih (misal `node cli.js start --acc 1,3`). |
| `node cli.js start --visible` | **Mode Debug GUI.** Menjalankan bot dengan jendela Chrome yang terbuka di layar. |
| `node cli.js balance` | **Cek Saldo.** Memeriksa saldo ETH di Robinhood Chain untuk seluruh akun terdaftar. |
| `node cli.js list` | **Daftar Akun.** Menampilkan tabel seluruh akun, status, dan wallet address. |
| `node cli.js add` | **Tambah Akun.** Menambahkan akun baru secara interaktif ke `config.json`. |
| `node cli.js remove <id>` | **Hapus Akun.** Menghapus akun dari daftar konfigurasi. |
| `node cli.js login <id>` | **Manual Setup.** Membuka jendela visual untuk login manual tanpa Private Key. |
| `node cli.js logs` | **Cek Log.** Menampilkan baris log aktivitas terbaru (`logs/all.log`). |

> **Menghentikan Bot:** Tekan **`Ctrl + C`** pada terminal. Bot akan menutup seluruh instance Chromium di background secara aman tanpa merusak sesi permainan.

---

## ⚙️ Penjelasan Konfigurasi (`config.json`)

* **`chromePath`**: Lokasi file `chrome.exe` di komputer Anda.
* **`headless`**: `true` untuk berjalan di background tanpa jendela; `false` untuk memunculkan jendela browser.
* **`webPort`**: Port server Web Dashboard (default: `3000`).
* **`solvegateApiKey`**: Kunci API SolveGate untuk bypass Turnstile CAPTCHA otomatis.
* **`referralCode`**: Kode referral akun yang dipasang saat pembuatan akun baru (bisa disesuaikan).
* **`defaultSettings`**:
  * `plantCrop`: Jenis tanaman bawaan (direkomendasikan: `"radish"` untuk siklus 30 menit).
  * `autoFarm` & `autoPlant`: Mengaktifkan panen dan penanaman otomatis.
  * `autoFeed`: Mengaktifkan pemberian pakan hewan ternak terjadwal.
  * `hp`, `autoDodge`, `autoPlay`, `autoPerk`: Konfigurasi God Mode battle arena.
* **`accounts`**:
  * `id`: Nomor identitas akun.
  * `name`: Nama label akun di dashboard.
  * `farmName`: Nama desa in-game (maksimal 24 karakter).
  * `crop`: Jenis benih khusus akun (misal `"radish"`, `"wheat"`, `"pumpkin"`).
  * `enabled`: `true` untuk mengaktifkan akun, `false` untuk menjeda.
  * `privateKey`: Private key EVM akun (format hex `0x...`).

---

## 🌐 Informasi Jaringan Blockchain

* **Network Name**: Robinhood Chain
* **Chain ID**: `4663` (Hex: `0x1237`)
* **RPC URL**: `https://rpc.mainnet.chain.robinhood.com`
* **Direct Edge IP**: `104.20.46.209`
* **Currency Symbol**: `ETH`
* **Block Explorer**: [https://robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)
* **$SEASON Token Contract**: `0xea0071a8778fA02C12378E88868255E0e0952Be6`
* **Vault Contract (Withdraw)**: `0xF7493177D7465E0586087C1CB9d010d920d051f5`

---

## 📄 Lisensi

Proyek ini dibuat untuk keperluan edukasi dan otomasi personal. Gunakan secara bijak sesuai ketentuan platform terkait.
