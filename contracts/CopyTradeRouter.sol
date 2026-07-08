// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUniswapV2Router {
    function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        payable
        returns (uint[] memory amounts);
    
    function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        returns (uint[] memory amounts);
        
    function WETH() external pure returns (address);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface ISwapRouterV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract CopyTradeRouter {
    address public immutable weth;
    address public immutable uniswapV2Router; // e.g. PancakeSwap V2 Router
    address public immutable uniswapV3Router; // e.g. Uniswap V3 SwapRouter02

    event TokenSwapped(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(address _v2Router, address _v3Router, address _weth) {
        uniswapV2Router = _v2Router;
        uniswapV3Router = _v3Router;
        weth = _weth;
    }

    receive() external payable {}

    // Swap MON for ERC20 Tokens
    function buyToken(
        uint8 dexType, // 0 = UniswapV2, 1 = UniswapV3
        address tokenOut,
        uint24 fee, // Only for V3 (e.g. 3000 = 0.3%)
        uint256 minAmountOut
    ) external payable returns (uint256 amountOut) {
        require(msg.value > 0, "CopyTradeRouter: must send MON");

        if (dexType == 0) {
            // UniswapV2 Swap
            address[] memory path = new address[](2);
            path[0] = weth;
            path[1] = tokenOut;
            
            uint[] memory amounts = IUniswapV2Router(uniswapV2Router).swapExactETHForTokens{value: msg.value}(
                minAmountOut,
                path,
                msg.sender,
                block.timestamp + 600
            );
            amountOut = amounts[amounts.length - 1];
        } else {
            // UniswapV3 Swap (Requires wrapping native MON to WMON first, then approving V3 router to pull it)
            IWETH(weth).deposit{value: msg.value}();
            require(IERC20(weth).approve(uniswapV3Router, msg.value), "CopyTradeRouter: WMON V3 approval failed");

            amountOut = ISwapRouterV3(uniswapV3Router).exactInputSingle(
                ISwapRouterV3.ExactInputSingleParams({
                    tokenIn: weth,
                    tokenOut: tokenOut,
                    fee: fee,
                    recipient: msg.sender,
                    deadline: block.timestamp + 600,
                    amountIn: msg.value,
                    amountOutMinimum: minAmountOut,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        emit TokenSwapped(msg.sender, weth, tokenOut, msg.value, amountOut);
    }

    // Swap ERC20 Tokens for MON
    function sellToken(
        uint8 dexType, // 0 = UniswapV2, 1 = UniswapV3
        address tokenIn,
        uint256 amountIn,
        uint24 fee, // Only for V3
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        require(amountIn > 0, "CopyTradeRouter: amount must be > 0");

        // Pull tokens from user (requires approval)
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "CopyTradeRouter: transferFrom failed");

        if (dexType == 0) {
            // UniswapV2 Sell
            require(IERC20(tokenIn).approve(uniswapV2Router, amountIn), "CopyTradeRouter: approval failed");
            
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = weth;

            uint[] memory amounts = IUniswapV2Router(uniswapV2Router).swapExactTokensForETH(
                amountIn,
                minAmountOut,
                path,
                msg.sender,
                block.timestamp + 600
            );
            amountOut = amounts[amounts.length - 1];
        } else {
            // UniswapV3 Sell
            require(IERC20(tokenIn).approve(uniswapV3Router, amountIn), "CopyTradeRouter: approval failed");

            amountOut = ISwapRouterV3(uniswapV3Router).exactInputSingle(
                ISwapRouterV3.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: weth,
                    fee: fee,
                    recipient: msg.sender,
                    deadline: block.timestamp + 600,
                    amountIn: amountIn,
                    amountOutMinimum: minAmountOut,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        emit TokenSwapped(msg.sender, tokenIn, weth, amountIn, amountOut);
    }
}
