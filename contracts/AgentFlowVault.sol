// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AgentFlowVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    uint256 public apyBps;

    event Compound(uint256 amountInjected, uint256 apyBps);

    constructor(IERC20 asset_)
        ERC20("AgentFlow Vault USDC", "afvUSDC")
        ERC4626(asset_)
        Ownable()
    {}

    function setApyBps(uint256 bps) external onlyOwner {
        apyBps = bps;
    }

    function compound(uint256 amount) external onlyOwner {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        emit Compound(amount, apyBps);
    }
}