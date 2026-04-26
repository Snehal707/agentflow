# AgentFlow Foundry contracts (Arc Testnet)

Solidity contracts: **AgentFlowRegistry**, **AgentFlowSwap**, **AgentFlowVault**.  
Uses [OpenZeppelin](https://github.com/OpenZeppelin/openzeppelin-contracts) `v5.0.2` in `lib/openzeppelin-contracts/` (install via `forge install` or the committed clone).  
**AgentFlowSwap** is a two-asset **Curve StableSwap**-style pool (`A = 100`, **3 bps** swap fee, 6-decimal stables). The Hardhat copy under `contracts/AgentFlowSwap.sol` stays in sync for `npx hardhat compile` (OpenZeppelin v4 `Ownable()` there; Foundry uses v5 `Ownable(msg.sender)`).

## Arc Testnet USDC (ERC-20 interface)

Per [Arc contract addresses](https://docs.arc.network/arc/references/contract-addresses):

`0x3600000000000000000000000000000000000000` (6 decimals for the interface)

## 1. Install Foundry (WSL2 Ubuntu)

```bash
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc   # or open a new terminal
foundryup
forge --version
```

## 2. Open this project

From WSL (adjust path if your repo lives elsewhere):

```bash
cd /mnt/c/Users/ASUS/agent-economy/foundry
```

If `lib/openzeppelin-contracts` is missing:

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
```

Ensure `foundry.toml` contains remappings for OpenZeppelin and **forge-std** (for `forge test`). If `lib/forge-std` is missing:

```bash
forge install foundry-rs/forge-std@v1.9.4 --no-commit
```

## 3. Build

```bash
forge build
```

## 3b. Tests

```bash
forge test -vv
```

Swap tests compare StableSwap output to a **constant-product** reference on a balanced 100k/100k pool (expect ~3 bps implied slippage vs 1:1 from fee only).

## 4. Environment (do not commit secrets)

Create `foundry/.env`:

```bash
export ARC_RPC=https://rpc.testnet.arc.network
export DEPLOYER_PRIVATE_KEY=0xYOUR_KEY_HERE
export USDC_ADDRESS=0x3600000000000000000000000000000000000000
# Second leg of the pool (e.g. Arc Testnet EURC from Arc docs)
export PAIR_TOKEN_ADDRESS=0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
```

Load:

```bash
set -a && source .env && set +a
```

## 5. Deploy (`forge create`)

**Registry** (no constructor args):

```bash
forge create src/AgentFlowRegistry.sol:AgentFlowRegistry \
  --rpc-url "$ARC_RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast
```

**Swap** (USDC + pair token):

```bash
forge create src/AgentFlowSwap.sol:AgentFlowSwap \
  --rpc-url "$ARC_RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --constructor-args "$USDC_ADDRESS" "$PAIR_TOKEN_ADDRESS" \
  --broadcast
```

**Vault** (underlying = USDC):

```bash
forge create src/AgentFlowVault.sol:AgentFlowVault \
  --rpc-url "$ARC_RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --constructor-args "$USDC_ADDRESS" \
  --broadcast
```

Copy each **Deployed to:** address from the output.

## 6. Backend `.env` (repo root)

Append to `agent-economy/.env`:

```env
AGENTFLOW_REGISTRY_ADDRESS=0x...
SWAP_CONTRACT_ADDRESS=0x...
VAULT_CONTRACT_ADDRESS=0x...
SWAP_PAIR_TOKEN_ADDRESS=0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
```

(`SWAP_PAIR_TOKEN_ADDRESS` optional; useful for agents that reference the pool’s second token.)

## 7. Verify on Arc explorer (optional)

If [testnet.arcscan.app](https://testnet.arcscan.app) exposes a verification API compatible with Hardhat/Foundry, use `forge verify-contract` with their endpoint and an API key. Details change over time; check Arc docs.

## Contracts summary

| Contract | Role |
|----------|------|
| `AgentFlowRegistry` | `.arc`-style handles; reserved names; `msg.sender == wallet` on register |
| `AgentFlowSwap` | USDC + `pairToken` StableSwap pool (`A=100`); 3 bps fee; owner liquidity; ABI aliases `usdc`/`pairToken`/`reserveUsdc`/`reservePair` |
| `AgentFlowVault` | ERC-4626 over USDC; `setApyBps`; `compound` pulls USDC from owner |
