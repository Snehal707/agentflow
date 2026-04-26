// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {AgentFlowSwap} from "../src/AgentFlowSwap.sol";

contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Reference constant-product quote (old pool: 997/1000 fee) for before/after logging.
library ConstantProductQuote {
    function quoteOut(uint256 reserveIn, uint256 reserveOut, uint256 amountIn)
        internal
        pure
        returns (uint256)
    {
        uint256 fee = (amountIn * 3) / 1000;
        uint256 amountInWithFee = amountIn - fee;
        return (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
    }
}

contract AgentFlowSwapTest is Test {
    MockERC20 public t0;
    MockERC20 public t1;
    AgentFlowSwap public swap;

    address public owner = address(this);
    address public user = address(0xBEEF);

    uint256 public constant LIQ = 100_000 * 1e6;

    function setUp() public {
        t0 = new MockERC20("USDC", "USDC");
        t1 = new MockERC20("EURC", "EURC");
        swap = new AgentFlowSwap(address(t0), address(t1));

        t0.mint(owner, LIQ * 10);
        t1.mint(owner, LIQ * 10);

        t0.approve(address(swap), type(uint256).max);
        t1.approve(address(swap), type(uint256).max);

        swap.addLiquidity(LIQ, LIQ);

        t0.mint(user, 100 * 1e6);
        t1.mint(user, 100 * 1e6);
        vm.startPrank(user);
        t0.approve(address(swap), type(uint256).max);
        t1.approve(address(swap), type(uint256).max);
        vm.stopPrank();
    }

    function test_stableSwap_oneUsdc_quote_near_parity() public view {
        uint256 one = 1e6;
        (uint256 outStable,) = swap.getQuote(address(t0), address(t1), one);

        uint256 cpOut = ConstantProductQuote.quoteOut(LIQ, LIQ, one);

        console2.log("=== 1 USDC -> EURC (100k / 100k pool) ===");
        console2.log("StableSwap out (raw 6dp):", outStable);
        console2.log("Constant-product ref out (raw 6dp):", cpOut);
        console2.log("StableSwap implied slippage vs 1:1 (bps):", (1e6 - outStable) * 10_000 / 1e6);

        assertGt(outStable, cpOut, "StableSwap should beat CP on balanced stables");
        assertGt(outStable, 999_000, "expect >0.999 EURC for 1 USDC (balanced pool, 3bps fee)");
        assertLt((1e6 - outStable) * 10_000 / 1e6, 20, "expect <20 bps total vs parity (soft)");
    }

    function test_swap_executes_and_syncs_reserves() public {
        uint256 one = 1e6;
        uint256 r0b = swap.reserveUsdc();
        uint256 r1b = swap.reservePair();

        vm.prank(user);
        uint256 out = swap.swap(address(t0), address(t1), one, 0);

        uint256 r0a = swap.reserveUsdc();
        uint256 r1a = swap.reservePair();

        assertEq(t0.balanceOf(address(swap)), r0a);
        assertEq(t1.balanceOf(address(swap)), r1a);
        assertEq(r0a, r0b + one);
        assertEq(r1a + out, r1b);
        assertGt(out, 0);
    }
}
