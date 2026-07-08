import { JsonRpcProvider, Wallet, Contract, parseEther } from 'ethers';

const RPC_URL = 'https://testnet-rpc.monad.xyz';
const WMON = '0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37';
const PRIVATE_KEY = '0xd4170d354ff1497615599d1602c04a9a9d6d93957447d12caf14d756a5d0cbc3';

const ABI = ['function deposit() payable'];

async function main() {
    const provider = new JsonRpcProvider(RPC_URL);
    const wallet = new Wallet(PRIVATE_KEY, provider);
    const contract = new Contract(WMON, ABI, wallet);
    
    console.log('Testing deposit() on WMON...');
    try {
        const est = await contract.deposit.estimateGas({ value: parseEther('0.001') });
        console.log('deposit() gas estimate:', est.toString());
    } catch (e) {
        console.log('deposit() failed:', e.message);
    }
}
main();
