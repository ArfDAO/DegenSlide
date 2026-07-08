import { BrowserProvider, Contract, Wallet, ethers } from 'ethers';

// Factory Address on Monad Testnet (To be set after deployment)
export const FACTORY_ADDRESS = '0x96165cDEDF4F5f1eEF978dCff949DC4491d9c465';
export const ROUTER_ADDRESS = '0xBCe9dfa2f91c63C2C8D853449d064eFf3C1088B2';

export const FACTORY_ABI = [
  'function getSmartAccount(address owner) view returns (address)',
  'function createAccount() external returns (address)',
  'event AccountCreated(address indexed owner, address accountAddress)'
];

export const SMART_ACCOUNT_ABI = [
  'function owner() view returns (address)',
  'function nonce() view returns (uint256)',
  'function sessionKeys(address key) view returns (uint256 validUntil, uint256 maxSpend, uint256 spent, bool active)',
  'function setSessionKey(address key, uint256 validUntil, uint256 maxSpend) external',
  'function revokeSessionKey(address key) external',
  'function execute(address dest, uint256 value, bytes calldata data) external returns (bytes)',
  'function executeBySession(address dest, uint256 value, bytes calldata data) external returns (bytes)',
  'function executeWithSig(address dest, uint256 value, bytes calldata data, address sessionKey, uint256 nonce, bytes calldata signature) external returns (bytes)',
  'function getMessageHash(address dest, uint256 value, bytes calldata data, address sessionKey, uint256 nonce) view returns (bytes32)'
];

// Load or generate ephemeral session key in browser localStorage
export function getOrCreateSessionKey() {
  let storedKey = localStorage.getItem('degen_session_pk');
  if (!storedKey) {
    const wallet = Wallet.createRandom();
    localStorage.setItem('degen_session_pk', wallet.privateKey);
    console.log('[SessionKey] Created new ephemeral session key:', wallet.address);
    return wallet;
  }
  const wallet = new Wallet(storedKey);
  console.log('[SessionKey] Loaded existing ephemeral session key:', wallet.address);
  return wallet;
}

// Check if user has deployed a Smart Account
export async function getSmartAccountAddress(ownerAddress) {
  if (!window.ethereum) return null;
  const provider = new BrowserProvider(window.ethereum);
  const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  const account = await factory.getSmartAccount(ownerAddress);
  return account === ethers.ZeroAddress ? null : account;
}

// Deploy Smart Account via Factory
export async function deploySmartAccount() {
  if (!window.ethereum) throw new Error('MetaMask not installed');
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  
  const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
  console.log('[SmartAccount] Requesting deploy via factory...');
  const tx = await factory.createAccount();
  const receipt = await tx.wait();
  
  // Find AccountCreated event to get address
  const accountAddr = await factory.getSmartAccount(signer.address);
  console.log('[SmartAccount] Deployed successfully at:', accountAddr);
  return accountAddr;
}

// Approve Session Key inside the user's Smart Account
export async function authorizeSessionKey(smartAccountAddress, sessionKeyAddress, durationSeconds = 86400, maxSpendWei = ethers.parseEther('10')) {
  if (!window.ethereum) throw new Error('MetaMask not installed');
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const account = new Contract(smartAccountAddress, SMART_ACCOUNT_ABI, signer);
  const validUntil = Math.floor(Date.now() / 1000) + durationSeconds;
  
  console.log(`[SmartAccount] Authorizing session key ${sessionKeyAddress} until timestamp ${validUntil}...`);
  const tx = await account.setSessionKey(sessionKeyAddress, validUntil, maxSpendWei);
  await tx.wait();
  console.log('[SmartAccount] Session key authorized successfully!');
}

// Check if session key is active and has budget
export async function getSessionKeyStatus(smartAccountAddress, sessionKeyAddress) {
  if (!window.ethereum) return null;
  const provider = new BrowserProvider(window.ethereum);
  const account = new Contract(smartAccountAddress, SMART_ACCOUNT_ABI, provider);
  const info = await account.sessionKeys(sessionKeyAddress);
  return {
    validUntil: Number(info.validUntil),
    maxSpend: info.maxSpend.toString(),
    spent: info.spent.toString(),
    active: info.active && Number(info.validUntil) > Math.floor(Date.now() / 1000)
  };
}

// Generate signed UserOperation-like execution payload for Keeper Relayer
export async function signSessionExecution(smartAccountAddress, dest, value, data, sessionWallet) {
  const provider = new BrowserProvider(window.ethereum);
  const account = new Contract(smartAccountAddress, SMART_ACCOUNT_ABI, provider);
  
  const nonce = await account.nonce();
  
  // Get message hash using the contract's view function
  const messageHash = await account.getMessageHash(dest, value, data, sessionWallet.address, nonce);
  
  // Sign hash with the session private key
  const signature = await sessionWallet.signMessage(ethers.getBytes(messageHash));
  
  return {
    dest,
    value: value.toString(),
    data,
    sessionKey: sessionWallet.address,
    nonce: nonce.toString(),
    signature
  };
}
