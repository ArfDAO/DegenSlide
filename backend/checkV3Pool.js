import { JsonRpcProvider, Wallet, Contract, parseEther } from 'ethers';

const RPC_URL = 'https://testnet-rpc.monad.xyz';
const WMON = '0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const V3_ROUTER = '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900';
const PRIVATE_KEY = '0xd4170d354ff1497615599d1602c04a9a9d6d93957447d12caf14d756a5d0cbc3';

const ABI = [
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
];
const WMON_ABI = ['function deposit() payable', 'function approve(address, uint256) returns (bool)'];

async function main() {
    const provider = new JsonRpcProvider(RPC_URL);
    const wallet = new Wallet(PRIVATE_KEY, provider);
    
    console.log('1. Wrapping 0.001 MON...');
    const wmonContract = new Contract(WMON, WMON_ABI, wallet);
    // await (await wmonContract.deposit({ value: parseEther('0.001') })).wait();
    
    // console.log('2. Approving V3 router...');
    // await (await wmonContract.approve(V3_ROUTER, parseEther('0.001'))).wait();
    
    console.log('3. Estimating V3 swap (WMON -> USDC, fee 3000)...');
    const v3Router = new Contract(V3_ROUTER, ABI, wallet);
    
    try {
        const est = await v3Router.exactInputSingle.estimateGas({
            tokenIn: WMON,
            tokenOut: USDC,
            fee: 3000,
            recipient: wallet.address,
            deadline: Math.floor(Date.now() / 1000) + 600,
            amountIn: parseEther('0.001'),
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        console.log('V3 Swap estimateGas:', est.toString());
    } catch (e) {
        console.log('V3 Swap failed:', e.message);
    }
}
main();
