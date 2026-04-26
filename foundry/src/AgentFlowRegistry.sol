// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentFlowRegistry — .arc-style handle registry (Arc Testnet)
contract AgentFlowRegistry {
    mapping(string => address) private _handleToWallet;
    mapping(address => string) private _walletToHandle;

    mapping(string => bool) private _reserved;

    event HandleRegistered(string handle, address indexed wallet);

    constructor() {
        _reserve("circle");
        _reserve("arc");
        _reserve("agentflow");
        _reserve("usdc");
        _reserve("ethereum");
        _reserve("bitcoin");
    }

    function _reserve(string memory h) private {
        _reserved[h] = true;
    }

    function _validateHandle(string calldata handle) internal view {
        bytes memory b = bytes(handle);
        require(b.length > 0 && b.length <= 128, "Registry: handle length");
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a) || c == 0x2e || c == 0x2d;
            require(ok, "Registry: invalid char");
        }
        require(!_reserved[handle], "Registry: reserved");
    }

    function register(string calldata handle, address wallet) external {
        require(wallet != address(0), "Registry: zero wallet");
        require(msg.sender == wallet, "Registry: not wallet");
        _validateHandle(handle);
        require(_handleToWallet[handle] == address(0), "Registry: handle taken");
        bytes memory existing = bytes(_walletToHandle[wallet]);
        require(existing.length == 0, "Registry: wallet has handle");

        _handleToWallet[handle] = wallet;
        _walletToHandle[wallet] = handle;

        emit HandleRegistered(handle, wallet);
    }

    function resolve(string calldata handle) external view returns (address) {
        return _handleToWallet[handle];
    }

    function reverseResolve(address wallet) external view returns (string memory) {
        return _walletToHandle[wallet];
    }
}
