// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AgentPayRegistry is Ownable {
    // ─── Structs ───────────────────────────────
    struct ArcName {
        address owner; // Caller at registration (typically DCW)
        address paymentAddress; // DCW wallet
        uint256 registeredAt;
        uint256 expiresAt; // 1 year
        bool active;
    }

    // ─── State ─────────────────────────────────
    IERC20 public usdc;
    address public treasury;
    uint256 public registrationFee = 1_000_000; // 1 USDC (6 decimals)
    uint256 public renewalFee = 1_000_000; // 1 USDC
    uint256 public renewalPeriod = 365 days;

    mapping(string => ArcName) public names;
    mapping(address => string) public ownerToName;
    mapping(string => bool) public reserved;

    // ─── Events ────────────────────────────────
    event NameRegistered(string indexed name, address indexed owner, address paymentAddress);
    event NameRenewed(string indexed name, uint256 newExpiry);
    event DCWUpdated(string indexed name, address newDCW);
    event NameExpired(string indexed name);

    // ─── Constructor ───────────────────────────
    constructor(address _usdc, address _treasury) {
        usdc = IERC20(_usdc);
        treasury = _treasury;

        reserved["agentflow"] = true;
        reserved["admin"] = true;
        reserved["treasury"] = true;
        reserved["circle"] = true;
        reserved["arc"] = true;
        reserved["usdc"] = true;
        reserved["eurc"] = true;
    }

    // ─── Registration ──────────────────────────
    function register(string calldata name, address dcwWallet) external {
        require(!reserved[name], "Name is reserved");
        require(
            names[name].owner == address(0) || block.timestamp > names[name].expiresAt,
            "Name already taken"
        );
        require(bytes(name).length >= 3, "Name too short (min 3)");
        require(bytes(name).length <= 20, "Name too long (max 20)");
        require(_isValidName(name), "Invalid characters. Use a-z and 0-9 only");
        require(dcwWallet != address(0), "Invalid DCW wallet");
        require(bytes(ownerToName[msg.sender]).length == 0, "You already have a registered name");

        require(usdc.transferFrom(msg.sender, treasury, registrationFee), "Fee payment failed");

        names[name] = ArcName({
            owner: msg.sender,
            paymentAddress: dcwWallet,
            registeredAt: block.timestamp,
            expiresAt: block.timestamp + renewalPeriod,
            active: true
        });

        ownerToName[msg.sender] = name;

        emit NameRegistered(name, msg.sender, dcwWallet);
    }

    // ─── Resolve ───────────────────────────────
    function resolve(string calldata name) external view returns (address) {
        ArcName memory n = names[name];
        require(n.active, "Name not registered on AgentPay");
        require(block.timestamp < n.expiresAt, "Name expired. Ask recipient to renew.");
        return n.paymentAddress;
    }

    // ─── Update DCW ────────────────────────────
    function updateDCW(address newDcwWallet) external {
        string memory name = ownerToName[msg.sender];
        require(bytes(name).length > 0, "No name registered");
        require(newDcwWallet != address(0), "Invalid address");
        names[name].paymentAddress = newDcwWallet;
        emit DCWUpdated(name, newDcwWallet);
    }

    // ─── Renew ─────────────────────────────────
    function renew() external {
        string memory name = ownerToName[msg.sender];
        require(bytes(name).length > 0, "No name registered");

        require(usdc.transferFrom(msg.sender, treasury, renewalFee), "Renewal fee payment failed");

        uint256 base = names[name].expiresAt > block.timestamp ? names[name].expiresAt : block.timestamp;

        names[name].expiresAt = base + renewalPeriod;
        emit NameRenewed(name, names[name].expiresAt);
    }

    // ─── Admin ─────────────────────────────────
    function reserveName(string calldata name) external onlyOwner {
        reserved[name] = true;
    }

    function setFees(uint256 _registrationFee, uint256 _renewalFee) external onlyOwner {
        registrationFee = _registrationFee;
        renewalFee = _renewalFee;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    // ─── View helpers ──────────────────────────
    function getNameInfo(string calldata name)
        external
        view
        returns (address owner, address paymentAddress, uint256 expiresAt, bool active, bool expired)
    {
        ArcName memory n = names[name];
        return (n.owner, n.paymentAddress, n.expiresAt, n.active, block.timestamp > n.expiresAt);
    }

    function getMyName() external view returns (string memory) {
        return ownerToName[msg.sender];
    }

    function isAvailable(string calldata name) external view returns (bool) {
        if (reserved[name]) return false;
        if (bytes(name).length < 3) return false;
        if (bytes(name).length > 20) return false;
        if (!_isValidName(name)) return false;
        ArcName memory n = names[name];
        if (n.owner == address(0)) return true;
        if (block.timestamp > n.expiresAt) return true;
        return false;
    }

    // ─── Internal ──────────────────────────────
    function _isValidName(string calldata name) internal pure returns (bool) {
        bytes memory b = bytes(name);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 char = b[i];
            bool isLower = char >= 0x61 && char <= 0x7A; // a-z
            bool isDigit = char >= 0x30 && char <= 0x39; // 0-9
            if (!isLower && !isDigit) return false;
        }
        return true;
    }
}
