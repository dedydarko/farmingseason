const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.resolve(__dirname, '..', 'logs');

class Logger {
  constructor() {
    this.ensureDir();
  }

  ensureDir() {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  }

  formatTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  }

  write(level, accId, accName, message) {
    this.ensureDir();
    const time = this.formatTimestamp();
    const tag = `[${level.toUpperCase().padEnd(6, ' ')}]`;
    const accTag = accId ? `[Acc ${String(accId).padStart(2, '0')}${accName ? ' - ' + accName : ''}]` : '[SYSTEM]';
    const logLine = `[${time}] ${tag} ${accTag} ${message}\n`;

    // 1. Tulis ke logs/all.log
    this.appendToFile(path.join(LOGS_DIR, 'all.log'), logLine);

    // 2. Jika WARN atau ERROR, tulis juga ke logs/error.log
    if (level === 'ERROR' || level === 'WARN') {
      this.appendToFile(path.join(LOGS_DIR, 'error.log'), logLine);
    }

    // 3. Tulis ke log khusus per akun jika accId tersedia
    if (accId) {
      this.appendToFile(path.join(LOGS_DIR, `acc_${accId}.log`), logLine);
    }
  }

  appendToFile(filePath, text) {
    try {
      // Rotasi log jika > 10MB
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 10 * 1024 * 1024) {
          const oldPath = filePath + '.1';
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          fs.renameSync(filePath, oldPath);
        }
      }
      fs.appendFileSync(filePath, text, 'utf8');
    } catch (e) {
      // Abaikan error penulisan disk agar bot tidak crash
    }
  }

  info(accId, accName, msg) {
    this.write('INFO', accId, accName, msg);
  }

  action(accId, accName, msg) {
    this.write('ACTION', accId, accName, msg);
  }

  warn(accId, accName, msg) {
    this.write('WARN', accId, accName, msg);
  }

  error(accId, accName, msg) {
    this.write('ERROR', accId, accName, msg);
  }

  system(msg) {
    this.write('SYSTEM', null, null, msg);
  }

  // Helper untuk membaca baris terakhir file log
  getRecentLogs(logType = 'all', lineCount = 30) {
    let filePath = path.join(LOGS_DIR, 'all.log');
    if (logType === 'error') filePath = path.join(LOGS_DIR, 'error.log');
    else if (typeof logType === 'number' || !isNaN(parseInt(logType, 10))) {
      filePath = path.join(LOGS_DIR, `acc_${logType}.log`);
    }

    if (!fs.existsSync(filePath)) {
      return `File log ${path.basename(filePath)} belum ada atau masih kosong.`;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n');
      return lines.slice(-lineCount).join('\n');
    } catch (e) {
      return `Gagal membaca log: ${e.message}`;
    }
  }
}

const logger = new Logger();
module.exports = logger;
