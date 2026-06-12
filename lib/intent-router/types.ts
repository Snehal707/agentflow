export enum AgentFlowDomain {
  Balance = 'balance',
  Portfolio = 'portfolio',
  Swap = 'swap',
  Vault = 'vault',
  Bridge = 'bridge',
  Predmarket = 'predmarket',
  Research = 'research',
  AgentPay = 'agentpay',
  Contacts = 'contacts',
  Schedule = 'schedule',
  Split = 'split',
  Batch = 'batch',
  Invoice = 'invoice',
  Vision = 'vision',
  Transcribe = 'transcribe',
  Treasury = 'treasury',
  General = 'general',
}

export enum AgentFlowIntentName {
  BalanceGet = 'balance.get',
  PortfolioReport = 'portfolio.report',
  SwapExecute = 'swap.execute',
  VaultList = 'vault.list',
  VaultPosition = 'vault.position',
  VaultDeposit = 'vault.deposit',
  VaultWithdraw = 'vault.withdraw',
  BridgePrecheck = 'bridge.precheck',
  BridgeExecute = 'bridge.execute',
  PredmarketList = 'predmarket.list',
  PredmarketDetail = 'predmarket.detail',
  PredmarketPosition = 'predmarket.position',
  PredmarketBuy = 'predmarket.buy',
  PredmarketSell = 'predmarket.sell',
  PredmarketRedeem = 'predmarket.redeem',
  PredmarketRefund = 'predmarket.refund',
  ResearchReport = 'research.report',
  AgentpaySend = 'agentpay.send',
  AgentpayRequest = 'agentpay.request',
  AgentpayHistory = 'agentpay.history',
  AgentpayPaymentLink = 'agentpay.payment_link',
  ContactsList = 'contacts.list',
  ContactsCreate = 'contacts.create',
  ContactsUpdate = 'contacts.update',
  ContactsDelete = 'contacts.delete',
  ScheduleCreate = 'schedule.create',
  ScheduleCancel = 'schedule.cancel',
  ScheduleList = 'schedule.list',
  SplitExecute = 'split.execute',
  BatchExecute = 'batch.execute',
  InvoiceCreate = 'invoice.create',
  InvoiceStatus = 'invoice.status',
  VisionAnalyze = 'vision.analyze',
  TranscribeTranscribe = 'transcribe.transcribe',
  TreasuryStatus = 'treasury.status',
  TreasuryTopup = 'treasury.topup',
  GeneralChat = 'general.chat',
}

export type HexAddress = `0x${string}`;

export type SupportedCurrency = 'USDC' | 'EURC';
export type SupportedAttachmentKind = 'image' | 'audio';
export type SupportedPaginationMode = 'first' | 'next' | 'all';
export type IntentSource = 'fastpath' | 'llm_router' | 'hermes_agent';
export type ExecutionTarget = 'EOA' | 'DCW';
export type WalletScope =
  | 'owner_wallet'
  | 'execution_wallet'
  | 'connected_wallet'
  | 'current_wallet';

export interface AmountSlot {
  value: number;
  currency?: SupportedCurrency;
}

export interface RecipientSlot {
  handle?: string;
  address?: HexAddress;
  resolved?: HexAddress;
}

export interface TokenSlot {
  symbol: string;
  address?: HexAddress;
}

export interface MarketSlot {
  address?: HexAddress;
  title_hint?: string;
}

export interface OutcomeSlot {
  index?: number;
  label?: 'yes' | 'no' | string;
}

export interface FilterSlot {
  category?: string;
  stage?: string;
  search?: string;
  time_window?: string;
  limit?: number;
}

export interface PaginationSlot {
  mode: SupportedPaginationMode;
  cursor?: string;
}

export interface ChainSlot {
  source?: string;
  target?: string;
}

export interface AttachmentSlot {
  id?: string;
  kind: SupportedAttachmentKind;
}

export interface ScheduleSlot {
  cadence: string;
  first_run?: string;
}

export interface ConfirmationSlot {
  confirmed: boolean;
}

export interface WalletScopedSlot {
  wallet_scope?: WalletScope;
}

export interface ExecutionTargetSlot {
  execution_target?: ExecutionTarget;
}

export interface PortfolioFollowupSlot {
  portfolio_followup?: boolean;
}

export interface ProviderSlot {
  provider?: string;
}

export interface RemarkSlot {
  remark?: string;
}

export interface SlippageSlot {
  slippage_bps?: number;
}

export interface RecipientFilterSlot {
  recipient_filter?: RecipientSlot;
}

export interface PaymentIdSlot {
  payment_id?: string;
}

export interface InvoiceIdSlot {
  invoice_id?: string;
}

export interface ReasoningModeSlot {
  reasoning_mode?: 'fast' | 'deep';
}

export interface BalanceGetSlots extends WalletScopedSlot, ExecutionTargetSlot {
  asset_hint?: SupportedCurrency | string;
}

export interface PortfolioReportSlots extends WalletScopedSlot, ExecutionTargetSlot {
  response_style?: 'full' | 'concise_post_action';
}

export interface SwapExecuteSlots
  extends ExecutionTargetSlot,
    PortfolioFollowupSlot,
    ConfirmationSlot {
  amount: AmountSlot;
  token_in: TokenSlot;
  token_out: TokenSlot;
}

export interface VaultListSlots extends ProviderSlot {
  filter?: FilterSlot;
}

export interface VaultPositionSlots
  extends WalletScopedSlot,
    ExecutionTargetSlot,
    ProviderSlot {
  market_filter?: FilterSlot;
}

export interface VaultDepositSlots
  extends ProviderSlot,
    ExecutionTargetSlot,
    PortfolioFollowupSlot,
    ConfirmationSlot {
  amount: AmountSlot;
  vault_symbol?: string;
  amount_token_hint?: SupportedCurrency | string;
}

export interface VaultWithdrawSlots
  extends ProviderSlot,
    ExecutionTargetSlot,
    PortfolioFollowupSlot,
    ConfirmationSlot {
  amount: AmountSlot;
  vault_symbol?: string;
  amount_token_hint?: SupportedCurrency | string;
}

export interface BridgePrecheckSlots extends WalletScopedSlot {
  chain?: ChainSlot;
  amount?: AmountSlot;
}

export interface BridgeExecuteSlots extends PortfolioFollowupSlot, ConfirmationSlot {
  chain: ChainSlot;
  amount: AmountSlot;
}

export interface PredmarketListSlots extends ProviderSlot {
  filter?: FilterSlot;
  pagination?: PaginationSlot;
}

export interface PredmarketDetailSlots extends ProviderSlot {
  market: MarketSlot;
}

export interface PredmarketPositionSlots extends WalletScopedSlot, ProviderSlot {
  filter?: FilterSlot;
}

export interface PredmarketBuySlots extends ProviderSlot, SlippageSlot, ConfirmationSlot {
  market: MarketSlot;
  outcome: OutcomeSlot;
  amount: AmountSlot;
}

export interface PredmarketSellSlots extends ProviderSlot, SlippageSlot, ConfirmationSlot {
  market: MarketSlot;
  outcome: OutcomeSlot;
  shares: AmountSlot;
}

export interface PredmarketRedeemSlots extends ProviderSlot, ConfirmationSlot {
  market: MarketSlot;
}

export interface PredmarketRefundSlots extends ProviderSlot, ConfirmationSlot {
  market: MarketSlot;
}

export interface ResearchReportSlots extends WalletScopedSlot, ReasoningModeSlot {
  task?: string;
  deep_research?: boolean;
  query?: string;
  portfolio_impact?: boolean;
}

export interface AgentpaySendSlots extends RemarkSlot, WalletScopedSlot {
  recipient: RecipientSlot;
  amount: AmountSlot;
  resolved_address?: HexAddress;
}

export interface AgentpayRequestSlots extends RemarkSlot, WalletScopedSlot {
  recipient: RecipientSlot;
  amount: AmountSlot;
}

export interface AgentpayHistorySlots extends WalletScopedSlot {
  filter?: FilterSlot;
}

export interface AgentpayPaymentLinkSlots extends RemarkSlot {
  recipient: RecipientSlot;
  amount?: AmountSlot;
}

export interface ContactsListSlots extends FilterSlot {
  include_addresses?: boolean;
}

export interface ContactsCreateSlots extends RemarkSlot {
  name: string;
  recipient: RecipientSlot;
  label?: string;
  notes?: string;
}

export interface ContactsUpdateSlots extends RemarkSlot {
  name: string;
  recipient: RecipientSlot;
  label?: string;
  notes?: string;
}

export interface ContactsDeleteSlots {
  name: string;
}

export interface ScheduleCreateSlots extends RemarkSlot, WalletScopedSlot {
  recipient: RecipientSlot;
  amount: AmountSlot;
  schedule: ScheduleSlot;
}

export interface ScheduleCancelSlots
  extends WalletScopedSlot,
    RecipientFilterSlot,
    PaymentIdSlot {
  recipient?: RecipientSlot;
  schedule?: ScheduleSlot;
  amount?: AmountSlot;
}

export interface ScheduleListSlots extends WalletScopedSlot {
  filter?: FilterSlot;
}

export interface SplitExecuteSlots extends RemarkSlot, ConfirmationSlot {
  total_amount: AmountSlot;
  recipients: RecipientSlot[];
}

export interface BatchPaymentSlot extends RemarkSlot {
  recipient: RecipientSlot;
  amount: AmountSlot;
}

export interface BatchExecuteSlots extends ConfirmationSlot {
  payments: BatchPaymentSlot[];
  source_format?: 'inline' | 'csv';
}

export interface InvoiceCreateSlots extends RemarkSlot {
  recipient: RecipientSlot;
  amount: AmountSlot;
  description: string;
  channel?: 'json' | 'pdf' | 'image' | 'email';
  invoice_number?: string;
  payer_wallet?: HexAddress;
  execute_payment?: boolean;
  research_followup?: boolean;
}

export interface InvoiceStatusSlots extends WalletScopedSlot, InvoiceIdSlot {
  filter?: FilterSlot;
}

export interface VisionAnalyzeSlots extends WalletScopedSlot {
  attachment: AttachmentSlot;
  prompt?: string;
}

export interface TranscribeTranscribeSlots extends WalletScopedSlot {
  attachment: AttachmentSlot;
}

export interface TreasuryStatusSlots {
  agent_slug?: string;
}

export interface TreasuryTopupSlots {
  agent_slug?: string;
}

export interface GeneralChatSlots {
  topic_hint?: string;
}

export type IntentWithSlots =
  | {
      domain: AgentFlowDomain.Balance;
      intent: AgentFlowIntentName.BalanceGet;
      slots: BalanceGetSlots;
    }
  | {
      domain: AgentFlowDomain.Portfolio;
      intent: AgentFlowIntentName.PortfolioReport;
      slots: PortfolioReportSlots;
    }
  | {
      domain: AgentFlowDomain.Swap;
      intent: AgentFlowIntentName.SwapExecute;
      slots: SwapExecuteSlots;
    }
  | {
      domain: AgentFlowDomain.Vault;
      intent: AgentFlowIntentName.VaultList;
      slots: VaultListSlots;
    }
  | {
      domain: AgentFlowDomain.Vault;
      intent: AgentFlowIntentName.VaultPosition;
      slots: VaultPositionSlots;
    }
  | {
      domain: AgentFlowDomain.Vault;
      intent: AgentFlowIntentName.VaultDeposit;
      slots: VaultDepositSlots;
    }
  | {
      domain: AgentFlowDomain.Vault;
      intent: AgentFlowIntentName.VaultWithdraw;
      slots: VaultWithdrawSlots;
    }
  | {
      domain: AgentFlowDomain.Bridge;
      intent: AgentFlowIntentName.BridgePrecheck;
      slots: BridgePrecheckSlots;
    }
  | {
      domain: AgentFlowDomain.Bridge;
      intent: AgentFlowIntentName.BridgeExecute;
      slots: BridgeExecuteSlots;
    }
  | {
      domain: AgentFlowDomain.Predmarket;
      intent: AgentFlowIntentName.PredmarketList;
      slots: PredmarketListSlots;
    }
  | {
      domain: AgentFlowDomain.Predmarket;
      intent: AgentFlowIntentName.PredmarketDetail;
      slots: PredmarketDetailSlots;
    }
  | {
      domain: AgentFlowDomain.Predmarket;
      intent: AgentFlowIntentName.PredmarketPosition;
      slots: PredmarketPositionSlots;
    }
  | {
      domain: AgentFlowDomain.Predmarket;
      intent: AgentFlowIntentName.PredmarketBuy;
      slots: PredmarketBuySlots;
    }
  | {
      domain: AgentFlowDomain.Predmarket;
      intent: AgentFlowIntentName.PredmarketSell;
      slots: PredmarketSellSlots;
    }
  | {
      domain: AgentFlowDomain.Predmarket;
      intent: AgentFlowIntentName.PredmarketRedeem;
      slots: PredmarketRedeemSlots;
    }
  | {
      domain: AgentFlowDomain.Predmarket;
      intent: AgentFlowIntentName.PredmarketRefund;
      slots: PredmarketRefundSlots;
    }
  | {
      domain: AgentFlowDomain.Research;
      intent: AgentFlowIntentName.ResearchReport;
      slots: ResearchReportSlots;
    }
  | {
      domain: AgentFlowDomain.AgentPay;
      intent: AgentFlowIntentName.AgentpaySend;
      slots: AgentpaySendSlots;
    }
  | {
      domain: AgentFlowDomain.AgentPay;
      intent: AgentFlowIntentName.AgentpayRequest;
      slots: AgentpayRequestSlots;
    }
  | {
      domain: AgentFlowDomain.AgentPay;
      intent: AgentFlowIntentName.AgentpayHistory;
      slots: AgentpayHistorySlots;
    }
  | {
      domain: AgentFlowDomain.AgentPay;
      intent: AgentFlowIntentName.AgentpayPaymentLink;
      slots: AgentpayPaymentLinkSlots;
    }
  | {
      domain: AgentFlowDomain.Contacts;
      intent: AgentFlowIntentName.ContactsList;
      slots: ContactsListSlots;
    }
  | {
      domain: AgentFlowDomain.Contacts;
      intent: AgentFlowIntentName.ContactsCreate;
      slots: ContactsCreateSlots;
    }
  | {
      domain: AgentFlowDomain.Contacts;
      intent: AgentFlowIntentName.ContactsUpdate;
      slots: ContactsUpdateSlots;
    }
  | {
      domain: AgentFlowDomain.Contacts;
      intent: AgentFlowIntentName.ContactsDelete;
      slots: ContactsDeleteSlots;
    }
  | {
      domain: AgentFlowDomain.Schedule;
      intent: AgentFlowIntentName.ScheduleCreate;
      slots: ScheduleCreateSlots;
    }
  | {
      domain: AgentFlowDomain.Schedule;
      intent: AgentFlowIntentName.ScheduleCancel;
      slots: ScheduleCancelSlots;
    }
  | {
      domain: AgentFlowDomain.Schedule;
      intent: AgentFlowIntentName.ScheduleList;
      slots: ScheduleListSlots;
    }
  | {
      domain: AgentFlowDomain.Split;
      intent: AgentFlowIntentName.SplitExecute;
      slots: SplitExecuteSlots;
    }
  | {
      domain: AgentFlowDomain.Batch;
      intent: AgentFlowIntentName.BatchExecute;
      slots: BatchExecuteSlots;
    }
  | {
      domain: AgentFlowDomain.Invoice;
      intent: AgentFlowIntentName.InvoiceCreate;
      slots: InvoiceCreateSlots;
    }
  | {
      domain: AgentFlowDomain.Invoice;
      intent: AgentFlowIntentName.InvoiceStatus;
      slots: InvoiceStatusSlots;
    }
  | {
      domain: AgentFlowDomain.Vision;
      intent: AgentFlowIntentName.VisionAnalyze;
      slots: VisionAnalyzeSlots;
    }
  | {
      domain: AgentFlowDomain.Transcribe;
      intent: AgentFlowIntentName.TranscribeTranscribe;
      slots: TranscribeTranscribeSlots;
    }
  | {
      domain: AgentFlowDomain.Treasury;
      intent: AgentFlowIntentName.TreasuryStatus;
      slots: TreasuryStatusSlots;
    }
  | {
      domain: AgentFlowDomain.Treasury;
      intent: AgentFlowIntentName.TreasuryTopup;
      slots: TreasuryTopupSlots;
    }
  | {
      domain: AgentFlowDomain.General;
      intent: AgentFlowIntentName.GeneralChat;
      slots: GeneralChatSlots;
    };

export type AgentFlowIntent = IntentWithSlots & {
  confidence: number;
  source: IntentSource;
  raw_message: string;
};

export type AgentFlowIntentSlotsByName = {
  [AgentFlowIntentName.BalanceGet]: BalanceGetSlots;
  [AgentFlowIntentName.PortfolioReport]: PortfolioReportSlots;
  [AgentFlowIntentName.SwapExecute]: SwapExecuteSlots;
  [AgentFlowIntentName.VaultList]: VaultListSlots;
  [AgentFlowIntentName.VaultPosition]: VaultPositionSlots;
  [AgentFlowIntentName.VaultDeposit]: VaultDepositSlots;
  [AgentFlowIntentName.VaultWithdraw]: VaultWithdrawSlots;
  [AgentFlowIntentName.BridgePrecheck]: BridgePrecheckSlots;
  [AgentFlowIntentName.BridgeExecute]: BridgeExecuteSlots;
  [AgentFlowIntentName.PredmarketList]: PredmarketListSlots;
  [AgentFlowIntentName.PredmarketDetail]: PredmarketDetailSlots;
  [AgentFlowIntentName.PredmarketPosition]: PredmarketPositionSlots;
  [AgentFlowIntentName.PredmarketBuy]: PredmarketBuySlots;
  [AgentFlowIntentName.PredmarketSell]: PredmarketSellSlots;
  [AgentFlowIntentName.PredmarketRedeem]: PredmarketRedeemSlots;
  [AgentFlowIntentName.PredmarketRefund]: PredmarketRefundSlots;
  [AgentFlowIntentName.ResearchReport]: ResearchReportSlots;
  [AgentFlowIntentName.AgentpaySend]: AgentpaySendSlots;
  [AgentFlowIntentName.AgentpayRequest]: AgentpayRequestSlots;
  [AgentFlowIntentName.AgentpayHistory]: AgentpayHistorySlots;
  [AgentFlowIntentName.AgentpayPaymentLink]: AgentpayPaymentLinkSlots;
  [AgentFlowIntentName.ContactsList]: ContactsListSlots;
  [AgentFlowIntentName.ContactsCreate]: ContactsCreateSlots;
  [AgentFlowIntentName.ContactsUpdate]: ContactsUpdateSlots;
  [AgentFlowIntentName.ContactsDelete]: ContactsDeleteSlots;
  [AgentFlowIntentName.ScheduleCreate]: ScheduleCreateSlots;
  [AgentFlowIntentName.ScheduleCancel]: ScheduleCancelSlots;
  [AgentFlowIntentName.ScheduleList]: ScheduleListSlots;
  [AgentFlowIntentName.SplitExecute]: SplitExecuteSlots;
  [AgentFlowIntentName.BatchExecute]: BatchExecuteSlots;
  [AgentFlowIntentName.InvoiceCreate]: InvoiceCreateSlots;
  [AgentFlowIntentName.InvoiceStatus]: InvoiceStatusSlots;
  [AgentFlowIntentName.VisionAnalyze]: VisionAnalyzeSlots;
  [AgentFlowIntentName.TranscribeTranscribe]: TranscribeTranscribeSlots;
  [AgentFlowIntentName.TreasuryStatus]: TreasuryStatusSlots;
  [AgentFlowIntentName.TreasuryTopup]: TreasuryTopupSlots;
  [AgentFlowIntentName.GeneralChat]: GeneralChatSlots;
};

export type AgentFlowIntentDomainByName = {
  [AgentFlowIntentName.BalanceGet]: AgentFlowDomain.Balance;
  [AgentFlowIntentName.PortfolioReport]: AgentFlowDomain.Portfolio;
  [AgentFlowIntentName.SwapExecute]: AgentFlowDomain.Swap;
  [AgentFlowIntentName.VaultList]: AgentFlowDomain.Vault;
  [AgentFlowIntentName.VaultPosition]: AgentFlowDomain.Vault;
  [AgentFlowIntentName.VaultDeposit]: AgentFlowDomain.Vault;
  [AgentFlowIntentName.VaultWithdraw]: AgentFlowDomain.Vault;
  [AgentFlowIntentName.BridgePrecheck]: AgentFlowDomain.Bridge;
  [AgentFlowIntentName.BridgeExecute]: AgentFlowDomain.Bridge;
  [AgentFlowIntentName.PredmarketList]: AgentFlowDomain.Predmarket;
  [AgentFlowIntentName.PredmarketDetail]: AgentFlowDomain.Predmarket;
  [AgentFlowIntentName.PredmarketPosition]: AgentFlowDomain.Predmarket;
  [AgentFlowIntentName.PredmarketBuy]: AgentFlowDomain.Predmarket;
  [AgentFlowIntentName.PredmarketSell]: AgentFlowDomain.Predmarket;
  [AgentFlowIntentName.PredmarketRedeem]: AgentFlowDomain.Predmarket;
  [AgentFlowIntentName.PredmarketRefund]: AgentFlowDomain.Predmarket;
  [AgentFlowIntentName.ResearchReport]: AgentFlowDomain.Research;
  [AgentFlowIntentName.AgentpaySend]: AgentFlowDomain.AgentPay;
  [AgentFlowIntentName.AgentpayRequest]: AgentFlowDomain.AgentPay;
  [AgentFlowIntentName.AgentpayHistory]: AgentFlowDomain.AgentPay;
  [AgentFlowIntentName.AgentpayPaymentLink]: AgentFlowDomain.AgentPay;
  [AgentFlowIntentName.ContactsList]: AgentFlowDomain.Contacts;
  [AgentFlowIntentName.ContactsCreate]: AgentFlowDomain.Contacts;
  [AgentFlowIntentName.ContactsUpdate]: AgentFlowDomain.Contacts;
  [AgentFlowIntentName.ContactsDelete]: AgentFlowDomain.Contacts;
  [AgentFlowIntentName.ScheduleCreate]: AgentFlowDomain.Schedule;
  [AgentFlowIntentName.ScheduleCancel]: AgentFlowDomain.Schedule;
  [AgentFlowIntentName.ScheduleList]: AgentFlowDomain.Schedule;
  [AgentFlowIntentName.SplitExecute]: AgentFlowDomain.Split;
  [AgentFlowIntentName.BatchExecute]: AgentFlowDomain.Batch;
  [AgentFlowIntentName.InvoiceCreate]: AgentFlowDomain.Invoice;
  [AgentFlowIntentName.InvoiceStatus]: AgentFlowDomain.Invoice;
  [AgentFlowIntentName.VisionAnalyze]: AgentFlowDomain.Vision;
  [AgentFlowIntentName.TranscribeTranscribe]: AgentFlowDomain.Transcribe;
  [AgentFlowIntentName.TreasuryStatus]: AgentFlowDomain.Treasury;
  [AgentFlowIntentName.TreasuryTopup]: AgentFlowDomain.Treasury;
  [AgentFlowIntentName.GeneralChat]: AgentFlowDomain.General;
};

export const AGENTFLOW_DOMAIN_VALUES = Object.values(AgentFlowDomain);
export const AGENTFLOW_INTENT_VALUES = Object.values(AgentFlowIntentName);
export const AGENTFLOW_DOMAIN_COUNT = AGENTFLOW_DOMAIN_VALUES.length;
export const AGENTFLOW_INTENT_COUNT = AGENTFLOW_INTENT_VALUES.length;
