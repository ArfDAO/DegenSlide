import { JsonRpcProvider, Contract } from 'ethers';

const RPC_URL = 'https://testnet-rpc.monad.xyz';
const WMON = '0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';

// UniswapV3 Factory on Monad Testnet (assuming standard deployment)
// Wait, we can just call V3 router to get factory? No, router doesn't expose it.
// PancakeSwap V2 Factory is often used.
// Let's check PancakeSwap V2 Router's factory
const V2_ROUTER = '0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9';
const V3_ROUTER = '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900';

const V2_ROUTER_ABI = ['function factory() view returns (address)'];
const V2_FACTORY_ABI = ['function getPair(address, address) view returns (address)'];
const V3_ROUTER_ABI = ['function factory() view returns (address)'];

async function main() {
    const provider = new JsonRpcProvider(RPC_URL);
    
    try {
        const v2Router = new Contract(V2_ROUTER, V2_ROUTER_ABI, provider);
        const v2FactoryAddr = await v2Router.factory();
        console.log('PancakeSwap V2 Factory:', v2FactoryAddr);

        const v2Factory = new Contract(v2FactoryAddr, V2_FACTORY_ABI, provider);
        const v2Pair = await v2Factory.getPair(WMON, USDC);
        console.log('PancakeSwap V2 WMON/USDC Pair:', v2Pair);
    } catch (e) {
        console.log('Error checking V2:', e.message);
    }

    try {
        const v3Router = new Contract(V3_ROUTER, V3_ROUTER_ABI, provider);
        const v3FactoryAddr = await v3Router.factory();
        console.log('Uniswap V3 Factory:', v3FactoryAddr);
    } catch (e) {
        console.log('V3 Router does not expose factory(), trying common addresses...');
    }
}

main();
