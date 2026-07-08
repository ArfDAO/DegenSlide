import { JsonRpcProvider, Wallet, Contract, parseEther } from 'ethers';

const RPC_URL = 'https://testnet-rpc.monad.xyz';
// The new CopyTradeRouter Address
const ROUTER_ADDRESS = '0xBCe9dfa2f91c63C2C8D853449d064eFf3C1088B2';
const WMON_ADDRESS = '0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37';
const USDC_ADDRESS = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';

const ROUTER_ABI = [
  'function buyToken(uint8 dexType, address tokenOut, uint24 fee, uint256 minAmountOut) external payable returns (uint256 amountOut)',
  'function weth() view returns (address)'
];

const USER_PRIVATE_KEY = '0xd4170d354ff1497615599d1602c04a9a9d6d93957447d12caf14d756a5d0cbc3';

async function main() {
  if (ROUTER_ADDRESS === 'REPLACE_ME_AFTER_DEPLOY') {
    console.error('Please deploy CopyTradeRouter with the correct WMON address first, then put its address in ROUTER_ADDRESS.');
    return;
  }

  console.log('[Test] Connecting to Monad Testnet RPC...');
  const provider = new JsonRpcProvider(RPC_URL);
  const userWallet = new Wallet(USER_PRIVATE_KEY, provider);
  console.log('[Test] Sender Address:', userWallet.address);

  const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, userWallet);

  console.log('[Test] Verifying WETH/WMON address in Router...');
  const routerWeth = await router.weth();
  console.log('[Test] Router WMON Address:', routerWeth);

  if (routerWeth.toLowerCase() !== WMON_ADDRESS.toLowerCase()) {
    console.warn('[WARNING] WMON address mismatch in contract! Should be:', WMON_ADDRESS);
  }

  // Swap 0.01 MON for USDC using UniswapV2 (DexType: 0)
  const swapAmount = parseEther('0.01');
  console.log(`[Test] Swapping ${swapAmount.toString()} Wei of MON for USDC via UniswapV2 route...`);
  
  const tx = await router.buyToken(
    0, // dexType: 0 (UniswapV2 Router)
    USDC_ADDRESS, // tokenOut: USDC
    0, // fee: 0 (unused in V2)
    0, // minAmountOut: 0
    { value: swapAmount }
  );

  console.log('[Test] Swap Tx sent:', tx.hash);
  const receipt = await tx.wait();
  console.log('[Test] Tx confirmed in block:', receipt.blockNumber);
  
  console.log('\n[SUCCESS] Swap transaction completed successfully on Monad Testnet using CopyTradeRouter!');
}

main().catch(console.error);
