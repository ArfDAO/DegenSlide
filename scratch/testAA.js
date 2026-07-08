import { JsonRpcProvider, Wallet, Contract, ZeroAddress, parseEther } from 'ethers';

const RPC_URL = 'https://testnet-rpc.monad.xyz';
// The newly deployed Factory Address
const FACTORY_ADDRESS = '0x96165cDEDF4F5f1eEF978dCff949DC4491d9c465';

const FACTORY_ABI = [
  'function getSmartAccount(address owner) view returns (address)',
  'function createAccount() external returns (address)',
  'event AccountCreated(address indexed owner, address accountAddress)'
];

const SMART_ACCOUNT_ABI = [
  'function owner() view returns (address)',
  'function nonce() view returns (uint256)',
  'function sessionKeys(address key) view returns (uint256 validUntil, uint256 maxSpend, uint256 spent, bool active)',
  'function setSessionKey(address key, uint256 validUntil, uint256 maxSpend) external'
];

// User Private Key (provided in previous forge command)
const USER_PRIVATE_KEY = '0xd4170d354ff1497615599d1602c04a9a9d6d93957447d12caf14d756a5d0cbc3';

async function main() {
  console.log('[Test] Connecting to Monad Testnet RPC...');
  const provider = new JsonRpcProvider(RPC_URL);
  const userWallet = new Wallet(USER_PRIVATE_KEY, provider);
  console.log('[Test] User EOA Wallet Address:', userWallet.address);

  const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, userWallet);

  console.log('[Test] Checking if Smart Account is already deployed...');
  let accountAddr = await factory.getSmartAccount(userWallet.address);

  if (accountAddr === ZeroAddress) {
    console.log('[Test] Smart Account not found. Deploying new Smart Account...');
    const tx = await factory.createAccount();
    console.log('[Test] Deployment Tx sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('[Test] Tx confirmed in block:', receipt.blockNumber);
    accountAddr = await factory.getSmartAccount(userWallet.address);
    console.log('[Test] Smart Account successfully deployed at:', accountAddr);
  } else {
    console.log('[Test] Found existing Smart Account at:', accountAddr);
  }

  // Load smart account contract
  const smartAccount = new Contract(accountAddr, SMART_ACCOUNT_ABI, userWallet);

  // Generate a random ephemeral session key
  const sessionWallet = Wallet.createRandom();
  console.log('[Test] Generated random ephemeral session key address:', sessionWallet.address);

  // Set validity for 1 day, max spend 1 MON
  const validUntil = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const maxSpend = parseEther('1.0');

  console.log('[Test] Authorizing Session Key on-chain...');
  const txAuth = await smartAccount.setSessionKey(sessionWallet.address, validUntil, maxSpend);
  console.log('[Test] Authorization Tx sent:', txAuth.hash);
  await txAuth.wait();
  console.log('[Test] Authorization Tx confirmed!');

  // Query and check session key status
  console.log('[Test] Querying Session Key status on-chain...');
  const info = await smartAccount.sessionKeys(sessionWallet.address);
  console.log('[Test] --- Session Key Info ---');
  console.log('Active:', info.active);
  console.log('Valid Until:', new Date(Number(info.validUntil) * 1000).toLocaleString());
  console.log('Max Spend (Budget):', info.maxSpend.toString(), 'Wei');
  console.log('Spent:', info.spent.toString(), 'Wei');

  if (info.active) {
    console.log('\n[SUCCESS] Smart Account and Session Key verified successfully on Monad Testnet!');
  } else {
    console.log('\n[FAILURE] Session Key is not active.');
  }
}

main().catch(console.error);
