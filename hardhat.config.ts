import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

dotenv.config();

const arcRpc = process.env.ARC_RPC?.trim() || "https://rpc.testnet.arc.network";
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache_hardhat",
    artifacts: "./artifacts",
    scripts: "./hardhat-scripts",
  },
  networks: {
    hardhat: { chainId: 5042002 },
    arcTestnet: {
      url: arcRpc,
      chainId: 5042002,
      accounts: deployerKey
        ? [deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`]
        : [],
    },
  },
  etherscan: {
    apiKey: { arcTestnet: process.env.ARCSCAN_API_KEY?.trim() || "empty" },
    customChains: [
      {
        network: "arcTestnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
    ],
  },
};

export default config;
