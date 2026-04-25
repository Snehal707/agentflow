import { ChatCompletionTool } from 'openai/resources'

export const AGENTFLOW_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_balance",
      description: "Get user USDC, EURC and vault balance. Call when user asks about balance or uses words like half, all, everything.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "swap_tokens",
      description: "Swap USDC to EURC or EURC to USDC. Set confirmed=false to show simulation first. Set confirmed=true only if user said YES in conversation.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "string" },
          tokenIn: { type: "string", enum: ["USDC", "EURC"] },
          tokenOut: { type: "string", enum: ["USDC", "EURC"] },
          confirmed: { type: "boolean" }
        },
        required: ["amount", "tokenIn", "tokenOut", "confirmed"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "vault_action",
      description: "Deposit or withdraw USDC from 5% APY vault. Set confirmed=false to simulate first.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["deposit", "withdraw"] },
          amount: { type: "string" },
          confirmed: { type: "boolean" }
        },
        required: ["action", "amount", "confirmed"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "bridge_usdc",
      description: "Bridge USDC from Ethereum Sepolia or Base Sepolia to Arc Testnet via CCTP V2. Set confirmed=false to show estimate first. Never guess the source chain: if the user did not explicitly state it, ask a clarification question instead of calling this tool.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "string" },
          sourceChain: {
            type: "string",
            enum: ["ethereum-sepolia", "base-sepolia"],
            description: "Only include this if the user explicitly said Ethereum Sepolia or Base Sepolia. Never guess."
          },
          confirmed: { type: "boolean" }
        },
        required: ["amount", "confirmed"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "bridge_precheck",
      description: "Read-only bridge source check. Use it to list currently supported bridge source chains and to check whether the connected source wallet has gas and USDC on Ethereum Sepolia or Base Sepolia. Optional amount checks whether the wallet has enough USDC for that amount. Safe in both EOA and DCW mode.",
      parameters: {
        type: "object",
        properties: {
          sourceChain: {
            type: "string",
            enum: ["ethereum-sepolia", "base-sepolia"],
            description: "Optional source chain filter."
          },
          amount: { type: "string" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_portfolio",
      description: "Get full portfolio analysis with holdings and PnL. Execute immediately, no confirmation needed.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "research",
      description: "Research any topic. Use for news, markets, crypto, geopolitics, any question. Execute immediately, no confirmation needed.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          mode: {
            type: "string",
            enum: ["fast", "deep"]
          }
        },
        required: ["query"]
      }
    }
  }
]
