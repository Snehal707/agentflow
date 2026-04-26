import hre from "hardhat";

const { ethers } = hre;

const DEFAULT_ARC_USDC = "0x3600000000000000000000000000000000000000";

async function main() {
  const USDC = (process.env.ARC_USDC_ADDRESS || DEFAULT_ARC_USDC).trim();
  const TREASURY = process.env.TREASURY_WALLET_ADDRESS?.trim();

  if (!TREASURY) {
    throw new Error("Missing TREASURY_WALLET_ADDRESS (optional: ARC_USDC_ADDRESS, defaults to Arc native USDC)");
  }

  console.log("Deploying AgentPayRegistry...");
  console.log("USDC:", USDC);
  console.log("Treasury:", TREASURY);

  const Registry = await ethers.getContractFactory("AgentPayRegistry");
  const registry = await Registry.deploy(USDC, TREASURY);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("AgentPayRegistry deployed to:", address);
  console.log("Add to .env: AGENTPAY_REGISTRY_ADDRESS=" + address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
