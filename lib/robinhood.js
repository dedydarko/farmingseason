const { ethers } = require('ethers');
const https = require('https');

const ROBINHOOD_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const ROBINHOOD_IP = '104.20.46.209'; // Direct Cloudflare edge IP to bypass ISP DNS poisoning
const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_CHAIN_ID_HEX = '0x1237';
const SAFE_REG_ETH = '0.0005'; // Safe threshold for $1 registration + L2 gas fee
const SEASON_TOKEN_ADDRESS = '0xea0071a8778fA02C12378E88868255E0e0952Be6';
const VAULT_ADDRESS = '0xF7493177D7465E0586087C1CB9d010d920d051f5';
const ROBINHOOD_EXPLORER = 'https://robinhoodchain.blockscout.com';

const VAULT_ABI = [
  'function withdraw(uint256 amount, uint256 deadline, bytes signature) returns (uint256)',
  'event Withdrawn(address indexed player, uint256 amount)',
  'function paused() view returns (bool)'
];

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

class RobinhoodProvider extends ethers.AbstractProvider {
  constructor() {
    super(ROBINHOOD_CHAIN_ID);
  }

  async _detectNetwork() {
    return ethers.Network.from(ROBINHOOD_CHAIN_ID);
  }

  async _perform(req) {
    switch (req.method) {
      case 'call': {
        return await this.rpc('eth_call', [{
          to: req.transaction.to,
          data: req.transaction.data || '0x',
          value: req.transaction.value ? ethers.toBeHex(req.transaction.value) : undefined
        }, req.blockTag || 'latest']);
      }
      case 'estimateGas': {
        const res = await this.rpc('eth_estimateGas', [req.transaction]);
        return BigInt(res);
      }
      case 'getBalance': {
        const res = await this.rpc('eth_getBalance', [req.address, req.blockTag || 'latest']);
        return BigInt(res);
      }
      case 'getTransactionCount': {
        const res = await this.rpc('eth_getTransactionCount', [req.address, req.blockTag || 'latest']);
        return parseInt(res, 16);
      }
      case 'broadcastTransaction': {
        const res = await this.rpc('eth_sendRawTransaction', [req.signedTransaction]);
        return res;
      }
      case 'getTransactionReceipt': {
        const res = await this.rpc('eth_getTransactionReceipt', [req.hash]);
        return res;
      }
      case 'getBlockNumber': {
        const res = await this.rpc('eth_blockNumber', []);
        return parseInt(res, 16);
      }
      case 'getFeeData': {
        try {
          const gasPrice = await this.rpc('eth_gasPrice', []);
          return { gasPrice: BigInt(gasPrice) };
        } catch (e) {
          return { gasPrice: ethers.parseUnits('0.1', 'gwei') };
        }
      }
      default:
        throw new Error(`Unsupported method in RobinhoodProvider: ${req.method}`);
    }
  }

  async getBalance(address) {
    const res = await this.rpc('eth_getBalance', [address, 'latest']);
    return BigInt(res);
  }

  async getTransactionCount(address) {
    const res = await this.rpc('eth_getTransactionCount', [address, 'latest']);
    return parseInt(res, 16);
  }

  async getFeeData() {
    try {
      const gasPrice = await this.rpc('eth_gasPrice', []);
      const bp = BigInt(gasPrice);
      const safeGasPrice = (bp * 135n) / 100n; // +35% buffer to safely beat block baseFee
      return new ethers.FeeData(safeGasPrice, safeGasPrice, safeGasPrice);
    } catch (e) {
      return new ethers.FeeData(ethers.parseUnits('28', 'gwei'));
    }
  }

  async estimateGas(tx) {
    try {
      const res = await this.rpc('eth_estimateGas', [tx]);
      const gas = BigInt(res);
      return (gas * 135n) / 100n; // +35% safe gas buffer
    } catch (e) {
      return 350000n; // Safe fallback (sufficient for vault withdraw which needs ~170k)
    }
  }

  async broadcastTransaction(signedTx) {
    const res = await this.rpc('eth_sendRawTransaction', [signedTx]);
    return { hash: res };
  }

  async send(method, params = []) {
    return await this.rpc(method, params);
  }

  rpc(method, params = []) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
      const req = https.request({
        hostname: ROBINHOOD_IP,
        port: 443,
        path: '/',
        method: 'POST',
        headers: {
          'Host': 'rpc.mainnet.chain.robinhood.com',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        servername: 'rpc.mainnet.chain.robinhood.com'
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              reject(new Error(json.error.message || JSON.stringify(json.error)));
            } else {
              resolve(json.result);
            }
          } catch (e) {
            reject(new Error(`Gagal parse JSON RPC response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Koneksi RPC Robinhood gagal: ${err.message}`));
      });

      req.setTimeout(12000, () => {
        req.destroy();
        reject(new Error('Koneksi RPC Robinhood timeout (12s)'));
      });

      req.write(postData);
      req.end();
    });
  }
}

const defaultProvider = new RobinhoodProvider();

async function getBalance(address) {
  try {
    const balanceWei = await defaultProvider.getBalance(address);
    const balanceEth = ethers.formatEther(balanceWei);
    return {
      wei: balanceWei,
      eth: balanceEth,
      isSufficientForReg: balanceWei >= ethers.parseEther(SAFE_REG_ETH)
    };
  } catch (e) {
    return {
      wei: 0n,
      eth: '0.0',
      error: e.message,
      isSufficientForReg: false
    };
  }
}

async function getSeasonBalance(address) {
  try {
    const token = new ethers.Contract(SEASON_TOKEN_ADDRESS, ERC20_ABI, defaultProvider);
    const rawBal = await token.balanceOf(address);
    const tokens = parseFloat(ethers.formatEther(rawBal));
    return {
      wei: rawBal,
      tokens: tokens,
      formatted: tokens.toLocaleString('en-US', { maximumFractionDigits: 4 })
    };
  } catch (e) {
    return {
      wei: 0n,
      tokens: 0,
      formatted: '0.0',
      error: e.message
    };
  }
}

async function sendSeasonTokens(privateKey, toAddress, amountTokens) {
  let pk = privateKey.trim();
  if (!pk.startsWith('0x')) pk = '0x' + pk;
  const wallet = new ethers.Wallet(pk, defaultProvider);

  if (!ethers.isAddress(toAddress)) {
    throw new Error('Alamat tujuan tidak valid');
  }

  const numTokens = parseFloat(amountTokens);
  if (isNaN(numTokens) || numTokens <= 0) {
    throw new Error('Jumlah token harus lebih dari 0');
  }

  // Check ETH gas balance
  const ethBal = await defaultProvider.getBalance(wallet.address);
  if (ethBal < 10000000000000n) { // 0.00001 ETH
    throw new Error(`Saldo ETH akun tidak cukup untuk gas fee (hanya ${ethers.formatEther(ethBal)} ETH)`);
  }

  const token = new ethers.Contract(SEASON_TOKEN_ADDRESS, ERC20_ABI, wallet);
  const amountWei = ethers.parseEther(String(numTokens));

  // Check token balance
  const currentBal = await token.balanceOf(wallet.address);
  if (currentBal < amountWei) {
    throw new Error(`Saldo SEASON on-chain tidak mencukupi (Tersedia: ${ethers.formatEther(currentBal)} SEASON)`);
  }

  // Send transaction
  const tx = await token.transfer(toAddress, amountWei);
  return {
    hash: tx.hash,
    from: wallet.address,
    to: toAddress,
    amount: numTokens
  };
}

function createWallet(privateKey) {
  let pk = privateKey.trim();
  if (!pk.startsWith('0x')) pk = '0x' + pk;
  return new ethers.Wallet(pk, defaultProvider);
}

module.exports = {
  ROBINHOOD_RPC,
  ROBINHOOD_IP,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_ID_HEX,
  SAFE_REG_ETH,
  SEASON_TOKEN_ADDRESS,
  VAULT_ADDRESS,
  ROBINHOOD_EXPLORER,
  ERC20_ABI,
  VAULT_ABI,
  RobinhoodProvider,
  defaultProvider,
  getBalance,
  getSeasonBalance,
  sendSeasonTokens,
  createWallet
};
