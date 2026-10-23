const fs = require('fs');
const path = require('path');

async function run() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const folderName = `fs_${dateStr}`;
  const targetDir = path.resolve('asset', folderName);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  console.log(`Target directory: ${targetDir}`);

  // 1. Fetch site root HTML
  console.log('Fetching https://farmingseason.io ...');
  const res = await fetch('https://farmingseason.io', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    }
  });
  const html = await res.text();
  fs.writeFileSync(path.join(targetDir, 'index.html'), html, 'utf8');

  // Extract all <script src="...">
  const scriptRegex = /<script[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let m;
  const scriptUrls = new Set();
  while ((m = scriptRegex.exec(html)) !== null) {
    scriptUrls.add(m[1]);
  }

  // Extract any modulepreload or link rel="preload" as="script"
  const linkRegex = /<link[^>]*href=["']([^"']+\.js[^"']*)["'][^>]*>/gi;
  while ((m = linkRegex.exec(html)) !== null) {
    scriptUrls.add(m[1]);
  }

  console.log('Found scripts from HTML:', Array.from(scriptUrls));

  // Download all discovered scripts
  const downloadedFiles = [];
  for (const sUrl of scriptUrls) {
    const fullUrl = sUrl.startsWith('http') ? sUrl : new URL(sUrl, 'https://farmingseason.io').toString();
    console.log(`Downloading: ${fullUrl}`);
    try {
      const sRes = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        }
      });
      const content = await sRes.text();
      const filename = path.basename(new URL(fullUrl).pathname);
      const filePath = path.join(targetDir, filename);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Saved ${filename} (${content.length} bytes)`);
      downloadedFiles.push({ filename, filePath, content, url: fullUrl });

      // Scan content for dynamic imports or other .js chunks
      const chunkRegex = /["'](\/assets\/[^"']+\.js)["']/g;
      let cm;
      while ((cm = chunkRegex.exec(content)) !== null) {
        const chunkPath = cm[1];
        if (!scriptUrls.has(chunkPath)) {
          scriptUrls.add(chunkPath);
          console.log(`Discovered chunk: ${chunkPath}`);
        }
      }
    } catch (e) {
      console.error(`Failed to download ${fullUrl}:`, e.message);
    }
  }

  // Check version endpoint
  try {
    const vRes = await fetch('https://farmingseason.io/api/version');
    const vData = await vRes.text();
    fs.writeFileSync(path.join(targetDir, 'version.json'), vData, 'utf8');
    console.log('Version endpoint response:', vData);
  } catch (e) {}

  console.log('\nAll downloads complete!');
}

run().catch(console.error);
