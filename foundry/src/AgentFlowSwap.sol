// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Two-asset Curve StableSwap-style pool (USDC / EURC), 6-decimal tokens.
/// @dev Amplification `A = 100`, fee 3 bps. Math follows Curve StableSwap `get_D` / `get_y` (N_COINS=2).
contract AgentFlowSwap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    /// @dev Amplification coefficient (Curve `amp`).
    uint256 public constant A = 100;
    uint256 public constant N_COINS = 2;
    /// @notice Swap fee in basis points (3 = 0.03%).
    uint256 public constant FEE_BPS = 3;
    uint256 public constant BPS_DENOM = 10_000;

    uint256 public reserve0;
    uint256 public reserve1;

    event Swap(
        address indexed tokenIn,
        address indexed tokenOut,
        address indexed to,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount
    );

    event LiquidityAdded(address indexed from, uint256 amount0, uint256 amount1);
    event LiquidityWithdrawn(address indexed to, uint256 amount0, uint256 amount1);

    /// @param _token0 USDC (or first stable)
    /// @param _token1 EURC (or second stable)
    constructor(address _token0, address _token1) Ownable(msg.sender) {
        require(_token0 != address(0) && _token1 != address(0), "Swap: zero addr");
        require(_token0 != _token1, "Swap: same token");
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
    }

    // --- ABI compatibility with previous constant-product pool ---

    function usdc() external view returns (address) {
        return address(token0);
    }

    function pairToken() external view returns (address) {
        return address(token1);
    }

    function reserveUsdc() external view returns (uint256) {
        return reserve0;
    }

    function reservePair() external view returns (uint256) {
        return reserve1;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    /// @notice Equal 1:1 deposit (same raw units).
    function addLiquidity(uint256 amount) external onlyOwner nonReentrant {
        _addLiquidity(amount, amount);
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external onlyOwner nonReentrant {
        _addLiquidity(amount0, amount1);
    }

    function _addLiquidity(uint256 amount0, uint256 amount1) private {
        require(amount0 > 0 && amount1 > 0, "Swap: amount");
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        _sync();
        emit LiquidityAdded(msg.sender, amount0, amount1);
    }

    function withdrawLiquidity(address to) external onlyOwner nonReentrant {
        uint256 u = token0.balanceOf(address(this));
        uint256 p = token1.balanceOf(address(this));
        if (u > 0) token0.safeTransfer(to, u);
        if (p > 0) token1.safeTransfer(to, p);
        reserve0 = 0;
        reserve1 = 0;
        emit LiquidityWithdrawn(to, u, p);
    }

    function getQuote(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (uint256 amountOut, uint256 fee)
    {
        return _quote(tokenIn, tokenOut, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "Swap: amountIn");
        require(
            (address(token0) == tokenIn && address(token1) == tokenOut)
                || (address(token1) == tokenIn && address(token0) == tokenOut),
            "Swap: pair only"
        );

        (uint256 out, uint256 feeAmt) = _quote(tokenIn, tokenOut, amountIn);
        require(out >= minAmountOut, "Swap: slippage");
        require(out > 0, "Swap: zero out");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, out);

        _sync();

        emit Swap(tokenIn, tokenOut, msg.sender, amountIn, out, feeAmt);
        return out;
    }

    function _sync() internal {
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
    }

    function _quote(address tokenIn, address tokenOut, uint256 amountIn)
        internal
        view
        returns (uint256 amountOut, uint256 fee)
    {
        require(tokenIn != tokenOut, "Swap: same token");
        require(amountIn > 0, "Swap: amountIn");

        uint256 amountInWithFee = (amountIn * (BPS_DENOM - FEE_BPS)) / BPS_DENOM;
        fee = amountIn - amountInWithFee;

        uint256 xp0 = reserve0;
        uint256 xp1 = reserve1;
        require(xp0 > 0 && xp1 > 0, "Swap: no liq");

        if (tokenIn == address(token0) && tokenOut == address(token1)) {
            uint256 xNew = xp0 + amountInWithFee;
            uint256 yNew = _getY(0, 1, xNew, xp0, xp1);
            require(xp1 >= yNew, "Swap: y");
            amountOut = xp1 - yNew;
        } else if (tokenIn == address(token1) && tokenOut == address(token0)) {
            uint256 xNew = xp1 + amountInWithFee;
            uint256 yNew = _getY(1, 0, xNew, xp0, xp1);
            require(xp0 >= yNew, "Swap: y");
            amountOut = xp0 - yNew;
        } else {
            revert("Swap: bad pair");
        }
    }

    /// @dev Curve StableSwap `get_D` for N_COINS = 2, Ann = A * N_COINS.
    function _getD(uint256 x0, uint256 x1) internal pure returns (uint256) {
        uint256 S = x0 + x1;
        if (S == 0) return 0;

        uint256 D = S;
        uint256 Ann = A * N_COINS;

        for (uint256 i = 0; i < 255; i++) {
            uint256 D_P = D;
            D_P = (D_P * D) / (x0 * N_COINS);
            D_P = (D_P * D) / (x1 * N_COINS);

            uint256 Dprev = D;
            D = (Ann * S + D_P * N_COINS) * D / ((Ann - 1) * D + (N_COINS + 1) * D_P);

            if (D > Dprev) {
                if (D - Dprev <= 1) break;
            } else {
                if (Dprev - D <= 1) break;
            }
        }
        return D;
    }

    /// @dev Curve StableSwap `get_y`: new balance of coin `j` given new balance `x` of coin `i`.
    function _getY(uint256 i, uint256 j, uint256 xNew, uint256 xp0, uint256 xp1) internal pure returns (uint256) {
        require(i != j && i < 2 && j < 2);

        uint256 D = _getD(xp0, xp1);
        require(D > 0, "Swap: D");

        uint256 Ann = A * N_COINS;
        uint256 c = D;

        for (uint256 k = 0; k < 2; k++) {
            if (k != j) {
                uint256 xx = k == i ? xNew : (k == 0 ? xp0 : xp1);
                c = (c * D) / (xx * N_COINS);
            }
        }
        c = (c * D) / (Ann * N_COINS);
        uint256 b = xNew + D / Ann;

        // Newton initial guess: old balance of coin j (Curve often uses D/Ann; that can make 2y+b<D for raw 6dp).
        uint256 y = j == 0 ? xp0 : xp1;
        for (uint256 z = 0; z < 255; z++) {
            uint256 yPrev = y;
            uint256 denomPart = 2 * y + b;
            require(denomPart > D, "Swap: denom");
            y = (y * y + c) / (denomPart - D);

            if (y > yPrev) {
                if (y - yPrev <= 1) break;
            } else {
                if (yPrev - y <= 1) break;
            }
        }
        return y;
    }
}
