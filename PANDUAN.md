# 🌾 PANDUAN LENGKAP BOT MULTI-ACCOUNT FARMING SEASON

Panduan resmi penggunaan CLI Multi-Account Farming Season: daftar seluruh perintah, alur kerja otomatis, konfigurasi, dan panduan langkah demi langkah menjalankan bot untuk pertama kali.

---

## 📑 DAFTAR ISI
1. [Konsep Utama & Arsitektur Bot](#-1-konsep-utama--arsitektur-bot)
2. [Alur Kerja Otomatis Permainan (In-Game Workflow)](#-2-alur-kerja-otomatis-permainan-in-game-workflow)
3. [Panduan Langkah Demi Langkah Pertama Kali Running](#-3-panduan-langkah-demi-langkah-pertama-kali-running)
4. [Daftar Seluruh Perintah CLI & Fungsinya](#-4-daftar-seluruh-perintah-cli--fungsinya)
5. [Struktur File `config.json`](#-5-struktur-file-configjson)
6. [Tampilan Dashboard Terminal](#-6-tampilan-dashboard-terminal)
7. [Troubleshooting & Tanya Jawab (FAQ)](#-7-troubleshooting--tanya-jawab-faq)

---

## 🧠 1. KONSEP UTAMA & ARSITEKTUR BOT

Bot ini dirancang untuk menjalankan banyak akun permainan Farming Season secara simultan di **background (headless mode)** tanpa membebani komputer Anda dengan membuka puluhan jendela browser.

### Keunggulan Sistem:
* **Background Runner (Headless):** Setiap akun berjalan dalam sesi Chromium terisolasi di folder `profiles/acc_<id>`.
* **Virtual Web3 Wallet Injector:** Menggunakan `ethers.js` untuk menyediakan provider `window.ethereum` virtual. Anda **TIDAK PERLU** menginstal ekstensi dompet (seperti MetaMask) di setiap browser.
* **Auto-Register & Auto-Login:** Bot menandatangani pesan login (`personal_sign`) dan membayar registrasi akun baru di **Robinhood Chain (Chain ID: 4663)** secara otomatis.
* **Zero-Fail Registration Guard:** Ambang batas aman saldo disetel ke **`0.0005 ETH`** (sekitar $1.00 – $1.20). Jika saldo kurang, bot **tidak akan melakukan spam transaksi**; bot akan menjeda, menampilkan alamat dompet di terminal, dan otomatis lanjut saat dana masuk.
* **Anti-DNS Poisoning ISP Indonesia:** Koneksi RPC Robinhood Chain dilengkapi resolusi langsung ke IP Cloudflare Edge (`104.20.46.209`) sehingga kebal dari pemblokiran DNS (seperti Telkomsel/IndiHome).

---

## 🔄 2. ALUR KERJA OTOMATIS PERMAINAN (IN-GAME WORKFLOW)

Setiap akun yang berjalan akan mengikuti alur kerja yang disiplin dan hemat energi:

```
[0] Cek Saldo & Registrasi Baru (Jika Akun Baru)
    ├── Periksa saldo ETH Robinhood (Ambang aman: >= 0.0005 ETH).
    ├── Jika saldo kurang: Pause & tampilkan alert alamat dompet di Dashboard sampai top-up masuk.
    └── Jika saldo cukup: Isi nama farm ("farmName") -> Bayar $1 ETH -> Buat Farm -> Sign Login.

[1] Pasang Bangunan Hewan Starter (Level 1)
    ├── Bangun Coop di koordinat (18, 17) -> 6 Ayam masuk otomatis (GRATIS).
    └── Bangun Sheep Pen di koordinat (16, 24) -> 4 Domba masuk otomatis (GRATIS).
    └── Total: 10 Hewan terisi penuh.

[2] Pasang 6 Ladang (Fields Level 1)
    └── Menaruh ladang di ruang kosong sekitar Town Hall hingga maksimal 6 ladang terpasang.

[3] Tanam Benih Radish
    └── Begitu 6 ladang siap, bot menanam benih Radish (waktu tumbuh: 30 menit).

[4] Grinding Battle Arena (Mengejar Daily Battle Cap)
    ├── Masuk ke Battle Arena dengan biaya 5 Energy.
    ├── Bertarung otomatis dengan fitur God Mode (HP Tak Terbatas, Auto-Dodge, Auto-Perk, Auto-Bot).
    ├── PENTING: Bot TIDAK PERNAH keluar-masuk arena agar tidak memboroskan 5 energy berkali-kali!
    └── Begitu Daily Battle Cap tercapai (misal: 1,509 / 1,509 SEASON pada Lv 1):
        Bot langsung RETREAT mengamankan loot, kembali ke desa, dan DILARANG masuk battle lagi hari itu!

[5] Farming & Harvesting Loop (Sisa Energi Khusus Panen)
    ├── Seluruh sisa energi dialokasikan eksklusif untuk ladang.
    ├── Panen Radish segera saat matang (Harvest All 2⚡) dan tanam kembali benih Radish.
    └── Terus panen hingga Daily Harvest Cap tercapai (misal: 2,444 / 2,444 SEASON pada Lv 1).

[6] Pakan Hewan & Ambil Produk (Zero-Spam Cooldown)
    ├── Hewan makan 2x sehari (Jendela Pagi: 00:00–11:59 & Jendela Sore: 12:00–23:59).
    ├── Bot mendeteksi countdown ("Next meal in ...") dan TIDAK AKAN spam cek jika sedang cooldown.
    └── Ambil Telur ayam harian & Wol domba 3-harian saat siap ("Collect All").

[7] Standby Hemat Energi
    └── Ketika Daily Battle Cap & Daily Harvest Cap penuh, bot masuk mode standby santai.
```

---

## 🚀 3. PANDUAN LANGKAH DEMI LANGKAH PERTAMA KALI RUNNING

Ikuti panduan 5 langkah ini untuk menjalankan bot dari awal:

### Langkah 1: Persiapan Awal
Pastikan Anda sudah berada di folder proyek:
```bash
cd d:\Project\farmingseason
```
Pastikan modul Node.js telah terpasang:
```bash
npm install
```

### Langkah 2: Konfigurasi Akun & Private Key
Buka file [**`config.json`**](file:///d:/Project/farmingseason/config.json). Masukkan data akun, nama farm yang diinginkan, dan Private Key wallet EVM Anda:
```json
{
  "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "headless": true,
  "defaultSettings": {
    "autoFarm": true,
    "harvestMode": "all",
    "autoPlant": true,
    "plantMode": "all",
    "plantCrop": "radish",
    "autoFeed": true,
    "hp": true,
    "autoDodge": true,
    "autoPlay": true,
    "autoRestart": false,
    "autoPerk": true,
    "dmg": 1,
    "spd": 1,
    "loot": 1
  },
  "accounts": [
    {
      "id": 1,
      "name": "Akun 1",
      "farmName": "Sunny Valley 1",
      "crop": "radish",
      "enabled": true,
      "privateKey": "0x1234567890abcdef..."
    },
    {
      "id": 2,
      "name": "Akun 2",
      "farmName": "Sunny Valley 2",
      "crop": "radish",
      "enabled": true,
      "privateKey": "0xabcdef12345678..."
    }
  ]
}
```

> **Tips Penamaan Farm:**
> * `farmName` adalah nama desa di dalam game (maksimal 24 karakter).
> * Jika `farmName` tidak diisi, bot akan otomatis memakai nama dari kolom `name`.

### Langkah 3: Cek Saldo Sebelum Menjalankan Bot
Jalankan perintah cek saldo on-chain:
```bash
node cli.js balance
```
Terminal akan menampilkan alamat dompet dari masing-masing Private Key beserta saldonya di **Robinhood Chain (Chain ID: 4663)**.
* Jika ada akun yang berstatus `⚠️ Kurang (Butuh ~0.0005 ETH)`, kirimkan minimal **0.0005 ETH** (sekitar $1.10 - $1.20) ke alamat tersebut di jaringan Robinhood Chain.

### Langkah 4: Menjalankan Bot
Setelah saldo siap, jalankan bot secara langsung:
```bash
node cli.js start
```
Atau jika ingin menjalankan 10 akun sekaligus:
```bash
node cli.js start -n 10
```

### Langkah 5: Memantau Lewat Terminal Dashboard
Terminal Anda akan berubah menjadi dashboard interaktif realtime. Bot akan:
1. Membuka browser masing-masing akun di latar belakang.
2. Melakukan sign login / registrasi otomatis.
3. Membangun Coop, Sheep Pen, menaruh 6 Ladang, menanam Radish.
4. Masuk battle hingga cap penuh, lalu fokus panen ladang.

---

## 💻 4. DAFTAR SELURUH PERINTAH CLI & FUNGSINYA

Berikut adalah referensi lengkap perintah yang tersedia di terminal:

| Perintah | Deskripsi & Kegunaan |
| :--- | :--- |
| `node cli.js` | **Menu Interaktif Utama.** Membuka antarmuka menu angka (0–11) untuk memilih aksi secara langsung. |
| `node cli.js start` | **Jalankan Semua Akun Aktif.** Menjalankan seluruh akun yang memiliki status `"enabled": true` di latar belakang (background / headless). |
| `node cli.js start -n <jumlah>` | **Jalankan N Akun.** Menentukan jumlah akun yang ingin dijalankan (misal `node cli.js start -n 10` untuk 10 akun). Jika jumlah melebihi daftar yang ada, bot akan otomatis membuat akun tambahan di `config.json`. |
| `node cli.js start --acc <id1,id2>` | **Jalankan Akun Tertentu.** Hanya menjalankan akun dengan ID yang disebutkan (misal `node cli.js start --acc 1,3,5` hanya menjalankan akun 1, 3, dan 5). |
| `node cli.js start --visible` atau `-v` | **Mode Debug GUI (Jendela Terlihat).** Menjalankan bot dengan jendela Google Chrome yang terbuka di layar Anda. Sangat berguna jika Anda ingin melihat visual permainan atau melakukan pengecekan visual. |
| `node cli.js balance` | **Cek Saldo Registrasi Semua Akun.** Memeriksa saldo ETH di jaringan Robinhood Chain untuk seluruh akun yang memiliki Private Key. Menampilkan status kesiapan registrasi (apakah saldo >= 0.0005 ETH). |
| `node cli.js logs` | **Lihat Log Aktivitas Terbaru.** Menampilkan 40 baris log aktivitas terbaru dari semua akun secara gabungan (`logs/all.log`). |
| `node cli.js logs error` | **Lihat Log Error & Warning.** Menampilkan hanya log error, kendala, atau warning (`logs/error.log`). |
| `node cli.js logs <id>` | **Lihat Log Akun Tertentu.** Menampilkan riwayat aksi khusus untuk satu ID akun (misal `node cli.js logs 1`). |
| `node cli.js list` | **Lihat Daftar Akun.** Menampilkan tabel daftar akun yang terdaftar di konfigurasi, termasuk ID, Nama Akun, Nama Farm, Status (Aktif/Nonaktif), Jenis Benih, Mode Login, dan Alamat Wallet / Profil. |
| `node cli.js add` | **Tambah Akun Baru.** Menambahkan akun secara interaktif dengan menanyakan Label Akun, Nama Farm, Pilihan Benih, dan Private Key. |
| `node cli.js add [nama] [benih]` | **Tambah Akun Cepat.** Menambahkan akun baru secara langsung via argumen baris perintah (misal `node cli.js add "Akun Budi" "radish"`). |
| `node cli.js remove <id>` atau `rm` | **Hapus Akun.** Menghapus akun tertentu dari daftar `config.json` berdasarkan ID. |
| `node cli.js login <id>` | **Manual Setup Browser.** Khusus untuk akun yang tidak ingin menggunakan Private Key. Perintah ini membuka satu jendela Chrome agar Anda bisa login manual via ekstensi MetaMask atau WalletConnect QR Code. |

> **Cara Menghentikan Bot:** Tekan tombol **`Ctrl + C`** di terminal. Bot akan menutup semua browser Chromium di background dengan aman tanpa merusak sesi data.

---

## ⚙️ 5. STRUKTUR FILE `config.json`

File [**`config.json`**](file:///d:/Project/farmingseason/config.json) mengatur konfigurasi global dan daftar akun.

```json
{
  "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "headless": true,
  "defaultSettings": {
    "autoFarm": true,
    "harvestMode": "all",
    "autoPlant": true,
    "plantMode": "all",
    "plantCrop": "radish",
    "autoFeed": true,
    "hp": true,
    "autoDodge": true,
    "autoPlay": true,
    "autoRestart": false,
    "autoPerk": true,
    "dmg": 1,
    "spd": 1,
    "loot": 1
  },
  "accounts": [
    {
      "id": 1,
      "name": "Akun 1",
      "farmName": "Sunny Valley 1",
      "crop": "radish",
      "enabled": true,
      "privateKey": "0x..."
    }
  ]
}
```

### Penjelasan Parameter:
* **`chromePath`**: Lokasi file eksekusi Google Chrome di komputer Anda.
* **`headless`**: Nilai `true` agar berjalan di background tanpa jendela; `false` jika ingin jendela terlihat.
* **`defaultSettings`**:
  * `plantCrop`: Jenis tanaman bawaan (disarankan: `"radish"` untuk grinding 30 menit). Pilihan lain: `"turnip"`, `"carrot"`, `"onion"`, `"wheat"`, `"tomato"`, `"pumpkin"`.
  * `autoFarm` & `autoPlant`: Mengaktifkan panen dan tanam otomatis.
  * `autoFeed`: Mengaktifkan pemberian makan hewan otomatis.
  * `hp`, `autoDodge`, `autoPlay`, `autoPerk`: Modul God Mode dan bot otomatis saat bertarung di arena battle.
* **`accounts`**:
  * `id`: Nomor urut unik akun.
  * `name`: Nama identitas akun pada dashboard terminal.
  * `farmName`: Nama desa yang akan didaftarkan di dalam game (maksimal 24 huruf).
  * `crop`: Jenis benih khusus untuk akun tersebut.
  * `enabled`: Setel ke `true` untuk mengaktifkan akun, atau `false` untuk menonaktifkannya sementara.
  * `privateKey`: Private key dompet kripto untuk login dan transaksi otomatis.

---

## 📊 6. TAMPILAN DASHBOARD TERMINAL

Saat bot berjalan, terminal menampilkan dashboard tabel status realtime yang diperbarui setiap 2 detik:

```text
====================================================================================================
   🌾 FARMING SEASON MULTI-BOT DASHBOARD — 09:45:00 (10 Akun Aktif)
====================================================================================================
 ID | Nama Akun   | ⚡ Energy | ⚔️ Battle Cap   | 🌾 Harvest Cap  | Ladang | Status Alur Kerja
----+-------------+----------+----------------+----------------+--------+-----------------------------------
  1 | Akun 1      |   95⚡   |    510/1509    |      -         | 0/6/0  | ⚔️ In Arena | Kills: 142 | Lv 5
  2 | Akun 2      |  100⚡   |     MAX ⚔️    |    620/2444    | 2/4/0  | 🌱 Menunggu panen dalam 14m
  3 | Akun 3      |   --⚡   |       -        |      -         | -      | ⚠️ Butuh ~0.0005 ETH (Punya: 0 ETH)
====================================================================================================
 ⚠️  PERINGATAN SALDO KURANG — MENUNGGU TOP-UP ETH (ROBINHOOD CHAIN - ID: 4663):
   • [ID 3] Akun 3: Alamat 0x8a1bb...90ac | Saldo: 0.00000 ETH | Butuh: ~0.0005 ETH
   👉 Kirim ETH jaringan Robinhood ke alamat di atas. Bot otomatis sign & lanjut saat saldo masuk!
====================================================================================================
 Urutan Alur: [1] Taruh 6 Field -> [2] Tanam Radish -> [3] Battle smp Cap -> [4] Harvest smp Cap
 Keterangan Ladang: Kosong / Tumbuh / Siap Panen
 Tekan [Ctrl + C] untuk menghentikan semua akun dengan aman.
```

### Arti Kolom Dashboard:
* **ID & Nama Akun:** Identitas akun yang sedang berjalan.
* **⚡ Energy:** Sisa energi akun saat ini (maksimal 100).
* **⚔️ Battle Cap:** Perolehan koin SEASON dari arena battle hari ini. Menampilkan `MAX ⚔️` jika sudah menyentuh batas daily cap.
* **🌾 Harvest Cap:** Perolehan koin SEASON dari hasil panen hari ini. Menampilkan `MAX 🌾` jika sudah menyentuh batas daily cap.
* **Ladang:** Status 6 ladang dengan format `Kosong / Tumbuh / Siap Panen` (contoh: `0/6/0` berarti semua 6 ladang sedang ditanami).
* **Status Alur Kerja:** Keterangan tindakan yang sedang dikerjakan bot secara langsung.

---

## 📁 7. SISTEM LOGGING (FOLDER `logs/`)

Semua aktivitas, transaksi on-chain, aksi ladang, pertempuran, peringatan, dan error dicatat secara otomatis ke folder [**`logs/`**](file:///d:/Project/farmingseason/logs).

### Struktur File Log:
* [**`logs/all.log`**](file:///d:/Project/farmingseason/logs/all.log): Catatan kronologis seluruh aksi dan kejadian dari semua akun yang sedang berjalan secara gabungan.
* [**`logs/error.log`**](file:///d:/Project/farmingseason/logs/error.log): Khusus mencatat kejadian `WARN` dan `ERROR` (misal: saldo kurang, kendala jaringan, atau deteksi captcha) sehingga mudah ditinjau tanpa tertutup log aksi panen.
* **`logs/acc_<id>.log`** (contoh: `logs/acc_1.log`, `logs/acc_2.log`): Riwayat khusus untuk akun tertentu, sangat praktis jika Anda ingin memeriksa riwayat akun spesifik.

### Format Catatan Log:
```text
[2026-10-21 10:12:13] [ACTION] [Acc 01 - Sunny Valley 1] Menaruh Coop di (18, 17)
[2026-10-21 10:14:02] [ACTION] [Acc 01 - Sunny Valley 1] Menanam Radish pada 6 ladang kosong
[2026-10-21 10:14:45] [ACTION] [Acc 01 - Sunny Valley 1] ⚔️ Daily Battle Cap tercapai (1509/1509 SEASON). Berhenti battle hari ini.
[2026-10-21 10:15:10] [WARN  ] [Acc 02 - Sunny Valley 2] Saldo ETH kurang (0.0001 ETH < 0.0005 ETH). Menunggu topup...
[2026-10-21 10:15:30] [ACTION] [Acc 02 - Sunny Valley 2] Transaksi pembayaran registrasi terkirim! Hash: 0x9a8b...
```

### Cara Cepat Melihat Log dari Terminal:
* Lihat 40 log aktivitas terbaru:
  ```bash
  node cli.js logs
  ```
* Lihat hanya log error / warning:
  ```bash
  node cli.js logs error
  ```
* Lihat log khusus Akun 1:
  ```bash
  node cli.js logs 1
  ```
* Atau melalui menu interaktif nomor **11** (`node cli.js`).

---

## ❓ 8. TROUBLESHOOTING & TANYA JAWAB (FAQ)

### T: Berapa biaya yang dibutuhkan untuk membuat 1 akun baru?
**J:** Biaya registrasi dari game adalah **$1 USD** yang dibayarkan dalam mata uang ETH di jaringan **Robinhood Chain (Chain ID: 4663)** ditambah sedikit biaya gas L2. Anda cukup mengisi minimal **`0.0005 ETH`** (sekitar $1.10 – $1.20) per akun.

### T: Apa yang terjadi jika saldo ETH di dompet saya kurang saat pertama kali jalan?
**J:** Bot dilengkapi **Zero-Fail Registration Guard**. Bot **tidak akan** mencoba melakukan sign transaksi yang gagal (tidak ada gas fee yang terbuang sia-sia). Bot akan berhenti sejenak, menampilkan notifikasi alamat dompet dan kekurangan saldo di dashboard. Begitu Anda mentransfer ETH ke dompet tersebut, bot langsung mendeteksi saldo baru dan otomatis melanjutkan pendaftaran.

### T: Bagaimana jika saya tidak ingin memasukkan Private Key ke `config.json`?
**J:** Anda bisa menggunakan **Metode Manual Session**:
1. Jalankan `node cli.js login <id>`.
2. Browser akan terbuka, silakan connect dompet via WalletConnect (scan QR dari aplikasi HP) atau ekstensi MetaMask.
3. Selesaikan pendaftaran akun dan bayar $1 ETH.
4. Begitu masuk ke desa, tutup browser. Sesi login tersimpan permanen di folder `profiles/acc_<id>` dan akun tersebut sudah bisa berjalan di background tanpa Private Key.

### T: Mengapa koneksi RPC Robinhood tidak diblokir internet positif?
**J:** Bot menggunakan provider RPC khusus dengan pemetaan IP langsung ke Cloudflare Edge (`104.20.46.209`) dan argumen resolver Chrome `--host-resolver-rules`. Ini sepenuhnya menghindari pemalsuan DNS (DNS hijacking/poisoning) yang biasa dilakukan oleh ISP Indonesia (seperti Telkomsel dan IndiHome).

### T: Apa yang harus dilakukan jika muncul CAPTCHA (*Human Gate*)?
**J:** Ada 2 opsi:
1. **Otomatis (Direkomendasikan)**: Masukkan API Key dari [SolveGate.io](https://solvegate.io) ke dalam parameter `"solvegateApiKey"` di `config.json`. Bot akan mem-bypass dan memverifikasi Turnstile CAPTCHA secara instan (~1 detik) baik saat login, registrasi, maupun saat penarikan saldo on-chain.
2. **Manual**: Jika tidak menggunakan SolveGate API, jalankan akun tersebut dengan mode jendela terlihat (`node cli.js start --visible` atau `node cli.js login <id>`), centang kotak Turnstile sekali di layar, lalu tutup browser.

---

## 🌐 9. PANDUAN LIVE WEB DASHBOARD & ON-CHAIN WITHDRAW

Bot dilengkapi dengan antarmuka web modern yang dapat diakses di browser:
👉 **`http://localhost:3000`**

### Fitur Web Dashboard:
1. **Ringkasan Portofolio Realtime**:
   * Menampilkan total saldo $SEASON in-game dan on-chain.
   * Nilai total portofolio dalam USD berdasarkan harga live DexScreener.
   * Cadangan saldo ETH untuk gas fee di seluruh akun.
2. **Card Akun Interaktif**:
   * Status aktivitas terkini (*Running*, *Syncing*, *Battle*, *Panen*, dll.).
   * Countdown waktu panen ladang dan waktu pakan ternak berikutnya.
   * Tombol **"Withdraw"** per akun untuk penarikan 1x klik.
3. **Tombol "Tarik Semua Saldo"**:
   * Melakukan penarikan saldo harian untuk seluruh akun yang aktif secara sekuensial dengan jeda aman.
4. **Tabel Riwayat Transaksi On-Chain**:
   * Kolom TX Hash dilengkapi link langsung yang dapat diklik menuju **Robinhood Blockscout Explorer**.
   * Status transaksi (*Berhasil*, *Memproses*, *Gagal*) dan detail keterangan lengkap tanpa pemotongan teks.

### Aturan & Mekanisme Penarikan (Withdraw):
* **Daily Limit**: Ditentukan oleh level Town Hall (Level 1: $1.88 USD per hari, sekitar 5.400 - 5.800 $SEASON). Limit ter-reset otomatis setiap hari pada pukul **00:00 UTC (07:00 WIB pagi)**.
* **Potongan Game**: Server game memotong pajak/fee 5% otomatis saat penarikan ke blockchain.
* **Syarat Hold On-Chain**: Game menjadwalkan aturan minimal hold **5.000 $SEASON** on-chain mulai 24 Oktober 01:00 WIB. Saldo yang telah ditarik ke wallet on-chain otomatis memenuhi syarat ini.

---

## 🔒 10. PANDUAN PUSH KE GITHUB DENGAN AMAN

Jika Anda ingin menyimpan kode ini di repositori GitHub pribadi atau membagikannya kepada teman, ikuti langkah berikut agar **Private Key dan sesi akun tidak bocor**:

1. **Pastikan `.gitignore` Aktif**:
   File `.gitignore` sudah otomatis mengecualikan:
   * `config.json` (berisi private key dan API key)
   * `profiles/` (berisi login sesi dan cookie Chrome)
   * `data/` & `logs/` (berisi riwayat transaksi dan log lokal)

2. **Gunakan Template `config.example.json`**:
   Teman Anda cukup menyalin file template tersebut:
   ```bash
   cp config.example.json config.json
   ```
   Lalu mengisi Private Key milik mereka sendiri di `config.json`.

3. **Periksa File Sebelum Commit**:
   Jalankan:
   ```bash
   git status
   ```
   Pastikan file `config.json` dan folder `profiles/` **TIDAK** tercantum di daftar *Untracked files* atau *Changes to be committed*.
