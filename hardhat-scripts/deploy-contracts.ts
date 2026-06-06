import hre from "hardhat";

const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Registry = await ethers.getContractFactory("AgentFlowRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("AgentFlowRegistry:", registryAddr);

  console.log("\n--- Add to .env ---\n");
  console.log(`AGENTFLOW_REGISTRY_ADDRESS=${registryAddr}`);
  console.log("\nVerify (replace ARGS, get API key from Arc explorer if required):");
  console.log(`npx hardhat verify --network arcTestnet ${registryAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
