import { ChatCompletionTool } from 'openai/resources'
import { SUPPORTED_BRIDGE_SOURCE_KEYS } from './bridge/supportedSources';

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
      description: "Lists yield vaults across all integrated Arc protocols, deposits underlying tokens to a chosen vault, and withdraws to underlying. Always shows provider name, network status, and experimental markers transparently. Always fetches live APY from on-chain snapshots and never asserts APY from memory. Use action='list' first for yield/earn/vault questions, then deposit/withdraw with confirmed=false for preview, and confirmed=true only after the user confirms.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "position", "deposit", "withdraw"] },
          amount: { type: "string" },
          provider: { type: "string" },
          vaultSymbol: { type: "string", enum: ["luneUSDC", "luneEURC"] },
          confirmed: { type: "boolean" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "predict_action",
      description: "Lists prediction markets across integrated Arc protocols, deposits USDC to bet on outcomes, sells positions, redeems winnings, refunds cancelled or expired markets. Always shows provider name, network status, experimental markers, resolution disclaimer (admin-resolved with proofUri + 3-day grace period), and fee disclaimer (0.25% from winning pool).\n\nUse action='list' first when user asks about markets, predictions, betting, or yield-via-betting. Then action='detail' for a specific market. action='buy'/'sell' with confirmed=false for preview, then confirmed=true after user replies YES.\n\nAlways fetch live data from on-chain - never assert market state from memory.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "detail", "position", "buy", "sell", "redeem", "refund"]
          },
          amount: { type: "string" },
          sharesWad: { type: "string" },
          marketAddress: { type: "string" },
          outcomeIdx: { type: "number" },
          provider: { type: "string" },
          filter: {
            type: "object",
            properties: {
              category: { type: "string" },
              stage: { type: "string", enum: ["active", "suspended", "resolved", "cancelled", "expired"] },
              minVolumeRaw: { type: "string" },
              searchTerm: { type: "string" }
            },
            required: []
          },
          confirmed: { type: "boolean" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentpay_send",
      description: "Prepare an AgentPay USDC send preview in chat. Always stores pending state and asks for YES before execution. Use when the user wants to send USDC to a .arc handle or wallet address.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          amount: { type: "string" },
          remark: { type: "string" }
        },
        required: ["to", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentpay_request",
      description: "Request USDC payment from a person or address via AgentPay. Creates a payment request in their inbox. They can approve or decline. No immediate onchain action.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Handle (.arc) or 0x address to request from" },
          amount: { type: "string", description: "Amount in USDC" },
          remark: { type: "string", description: "Optional note or reason for the request" }
        },
        required: ["from", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "bridge_precheck",
      description: "Read-only bridge capability check. Use it to list the currently supported bridge source chains and explain the web bridge flow. Bridge uses user-EOA signing on the source chain and mints directly into the user's AgentFlow wallet on Arc. Safe in both EOA and DCW mode.",
      parameters: {
        type: "object",
        properties: {
          sourceChain: {
            type: "string",
            enum: SUPPORTED_BRIDGE_SOURCE_KEYS,
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
