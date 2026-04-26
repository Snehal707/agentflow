import hre from "hardhat";

const { ethers } = hre;

const DEFAULT_ARC_USDC = "0x3600000000000000000000000000000000000000";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const usdc = (process.env.ARC_USDC_ADDRESS || DEFAULT_ARC_USDC).trim();
  let pairToken = process.env.SWAP_PAIR_TOKEN_ADDRESS?.trim();

  if (!pairToken) {
    console.log("SWAP_PAIR_TOKEN_ADDRESS unset — deploying MockERC20 as pair token (6 decimals)");
    const Mock = await ethers.getContractFactory("MockERC20");
    const mock = await Mock.deploy("AgentFlow Pair", "AFP", 6);
    await mock.waitForDeployment();
    pairToken = await mock.getAddress();
    console.log("MockERC20 (pair):", pairToken);
  }

  const Registry = await ethers.getContractFactory("AgentFlowRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("AgentFlowRegistry:", registryAddr);

  const Swap = await ethers.getContractFactory("AgentFlowSwap");
  const swap = await Swap.deploy(usdc, pairToken);
  await swap.waitForDeployment();
  const swapAddr = await swap.getAddress();
  console.log("AgentFlowSwap:", swapAddr);

  const Vault = await ethers.getContractFactory("AgentFlowVault");
  const vault = await Vault.deploy(usdc);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("AgentFlowVault:", vaultAddr);

  console.log("\n--- Add to .env ---\n");
  console.log(`AGENTFLOW_REGISTRY_ADDRESS=${registryAddr}`);
  console.log(`SWAP_CONTRACT_ADDRESS=${swapAddr}`);
  console.log(`VAULT_CONTRACT_ADDRESS=${vaultAddr}`);
  if (!process.env.SWAP_PAIR_TOKEN_ADDRESS?.trim()) {
    console.log(`SWAP_PAIR_TOKEN_ADDRESS=${pairToken}`);
  }
  console.log("\nVerify (replace ARGS, get API key from Arc explorer if required):");
  console.log(`npx hardhat verify --network arcTestnet ${registryAddr}`);
  console.log(`npx hardhat verify --network arcTestnet ${swapAddr} "${usdc}" "${pairToken}"`);
  console.log(`npx hardhat verify --network arcTestnet ${vaultAddr} "${usdc}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});