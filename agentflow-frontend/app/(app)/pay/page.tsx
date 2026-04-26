"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { QRCodeSVG } from "qrcode.react";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import {
  deleteScheduledPayment,
  exportAgentPayWorkbook,
  fetchArcNameAvailability,
  fetchMyArcName,
  fetchPayContext,
  fetchPayHistory,
  fetchPayRequests,
  fetchScheduledPayments,
  fetchWalletBalance,
  pickUsdcBalance,
  postArcNameRegister,
  postArcNameRenew,
  postPayApprove,
  postPayDecline,
  postPayRequest,
  postPaySend,
  putArcNameDcw,
  type PayContextResponse,
  type PayHistoryRow,
  type PaymentRequestRow,
  type ScheduledPaymentRow,
  type WalletBalanceResponse,
} from "@/lib/liveProductClient";
import { shortenAddress } from "@/lib/appData";
import { formatServerDate, formatServerDateTime, parseServerDate } from "@/lib/dateUtils";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import { useSidebarPreference } from "@/lib/useSidebarPreference";

type TabId =
  | "send"
  | "receive"
  | "requests"
  | "history"
  | "scheduled"
  | "invoices"
  | "contacts"
  | "batch";

type PayContactRow = {
  id: string;
  name: string;
  address: string;
  label?: string | null;
  notes?: string | null;
};

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function AgentPayPage() {
  const router = useRouter();
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const {
    isAuthenticated,
    signIn,
    loading: authLoading,
    error: authError,
    getAuthHeaders,
  } = useAgentJwt();

  const [tab, setTab] = useState<TabId>("send");
  const [hydrated, setHydrated] = useState(false);
  const [payContext, setPayContext] = useState<PayContextResponse | null>(null);

  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  /** Send tab: scanner / unexpected send errors (not validation in modal). */
  const [sendFlowError, setSendFlowError] = useState<string | null>(null);
  /** Requests / history operations (not shown on Send tab). */
  const [operationsError, setOperationsError] = useState<string | null>(null);
  /** Validation + send API errors while confirm modal is open. */
  const [confirmModalError, setConfirmModalError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{
    txHash: string;
    explorerLink: string;
  } | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanControlsRef = useRef<{ stop: () => void } | null>(null);
  const qrFileInputRef = useRef<HTMLInputElement>(null);

  const [balanceInfo, setBalanceInfo] = useState<WalletBalanceResponse | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const [reqFrom, setReqFrom] = useState("");
  const [reqAmount, setReqAmount] = useState("");
  const [reqRemark, setReqRemark] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [incoming, setIncoming] = useState<PaymentRequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<PaymentRequestRow[]>([]);
  const [reqLoading, setReqLoading] = useState(false);

  const [history, setHistory] = useState<PayHistoryRow[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"" | "in" | "out">("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledPaymentRow[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [scheduledBusyId, setScheduledBusyId] = useState<string | null>(null);
  const [scheduledToast, setScheduledToast] = useState<string | null>(null);

  const [sentInvoices, setSentInvoices] = useState<any[]>([]);
  const [receivedInvoices, setReceivedInvoices] = useState<any[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [payingRequestId, setPayingRequestId] = useState<string | null>(null);

  // Batch tab state
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const [batchCSVText, setBatchCSVText] = useState("");
  const [batchPreview, setBatchPreview] = useState<any>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchExecuting, setBatchExecuting] = useState(false);
  const [batchResult, setBatchResult] = useState<any>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<PayContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [contactLabel, setContactLabel] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  const [addingContact, setAddingContact] = useState(false);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);

  const [paymentBaseUrl, setPaymentBaseUrl] = useState(
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "",
  );
  const payPublicOrigin =
    process.env.NEXT_PUBLIC_AGENTFLOW_PAY_ORIGIN?.trim() || "https://agentflow.one";

  const [myChainArc, setMyChainArc] = useState<{
    name: string | null;
    expiresAt: string | null;
  } | null>(null);
  const [arcRegDraft, setArcRegDraft] = useState("");
  const [arcAvailCheck, setArcAvailCheck] = useState<{
    available: boolean;
    name: string;
    registrationFeeUsdc?: number;
  } | null>(null);
  const [arcChecking, setArcChecking] = useState(false);
  const [arcRegModal, setArcRegModal] = useState(false);
  const [arcRegBusy, setArcRegBusy] = useState(false);
  const [arcRegSuccess, setArcRegSuccess] = useState<string | null>(null);
  const [arcLinkCopied, setArcLinkCopied] = useState(false);
  const [arcNameError, setArcNameError] = useState<string | null>(null);
  const [renewBusy, setRenewBusy] = useState(false);
  const [newDcwInput, setNewDcwInput] = useState("");
  const [dcwBusy, setDcwBusy] = useState(false);
  const arcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const balanceFetchInFlight = useRef(false);

  const previewRecipient = toAddress.trim() || "recipient";
  const previewAmount = Number(amount);
  const previewLabel = Number.isFinite(previewAmount)
    ? `Sending ${formatUsd(previewAmount)} to ${previewRecipient}`
    : "Enter amount and recipient";

  const loadContext = useCallback(async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    try {
      const ctx = await fetchPayContext(headers);
      setPayContext(ctx);
      if (ctx.chain_arc_name) {
        setMyChainArc((prev) => ({
          name: ctx.chain_arc_name ?? prev?.name ?? null,
          expiresAt: ctx.chain_arc_expires_at ?? prev?.expiresAt ?? null,
        }));
      }
    } catch {
      setPayContext(null);
    }
  }, [getAuthHeaders]);

  const loadBalance = useCallback(async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    if (balanceFetchInFlight.current) return;
    balanceFetchInFlight.current = true;
    if (process.env.NODE_ENV === "development" && address) {
      console.log("[agentpay] fetching balance for:", address);
    }
    setBalanceLoading(true);
    try {
      const b = await fetchWalletBalance(headers);
      setBalanceInfo(b);
      if (process.env.NODE_ENV === "development") {
        console.log("[agentpay] balance DCW:", b.userAgentWalletAddress, "holdings:", b.holdings?.length);
      }
    } catch {
      setBalanceInfo(null);
    } finally {
      balanceFetchInFlight.current = false;
      setBalanceLoading(false);
    }
  }, [getAuthHeaders, address]);

  const loadRequests = useCallback(async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setReqLoading(true);
    try {
      const r = await fetchPayRequests(headers);
      setIncoming(r.incoming ?? []);
      setOutgoing(r.outgoing ?? []);
    } finally {
      setReqLoading(false);
    }
  }, [getAuthHeaders]);

  const loadHistory = useCallback(async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setHistoryLoading(true);
    try {
      const rows = await fetchPayHistory(headers, {
        limit: 100,
        type: historyFilter,
      });
      setHistory(rows ?? []);
    } finally {
      setHistoryLoading(false);
    }
  }, [getAuthHeaders, historyFilter]);

  const loadScheduled = useCallback(async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setScheduledLoading(true);
    try {
      const rows = await fetchScheduledPayments(headers);
      setScheduled(
        (rows ?? []).filter(
          (row) => String(row.status ?? "active").toLowerCase() === "active",
        ),
      );
    } finally {
      setScheduledLoading(false);
    }
  }, [getAuthHeaders]);

  const loadInvoices = useCallback(async () => {
    if (!isAuthenticated || !address) return;
    setInvoiceLoading(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch("/api/pay/invoices", { headers: headers ?? {} });
      if (res.ok) {
        const data = (await res.json()) as { sent?: any[]; received?: any[] };
        setSentInvoices(data.sent ?? []);
        setReceivedInvoices(data.received ?? []);
      }
    } finally {
      setInvoiceLoading(false);
    }
  }, [isAuthenticated, address, getAuthHeaders]);

  const loadContacts = useCallback(async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setContactsLoading(true);
    setContactsError(null);
    try {
      const res = await fetch("/api/pay/contacts", { headers });
      const data = (await res.json()) as { contacts?: PayContactRow[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not load contacts");
      }
      setContacts(data.contacts ?? []);
    } catch (e) {
      setContactsError(e instanceof Error ? e.message : "Could not load contacts");
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  }, [getAuthHeaders]);

  const goTab = (id: TabId) => {
    setTab(id);
    if (id === "send") {
      setOperationsError(null);
    } else {
      setSendFlowError(null);
    }
    if (id !== "scheduled") {
      setScheduledToast(null);
    }
    if (id !== "contacts") {
      setContactsError(null);
    }
  };

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!paymentBaseUrl && typeof window !== "undefined") {
      setPaymentBaseUrl(window.location.origin);
    }
  }, [paymentBaseUrl]);

  useEffect(() => {
    if (!address || !isAuthenticated) {
      setPayContext(null);
      setBalanceInfo(null);
      return;
    }
    void loadContext();
    void loadBalance();
  }, [address, isAuthenticated, loadContext, loadBalance]);

  useEffect(() => {
    if (tab === "requests" && address && isAuthenticated) {
      void loadRequests();
    }
  }, [tab, address, isAuthenticated, loadRequests]);

  useEffect(() => {
    if (tab === "history" && address && isAuthenticated) {
      void loadHistory();
    }
  }, [tab, address, isAuthenticated, historyFilter, loadHistory]);

  useEffect(() => {
    if (tab === "scheduled" && address && isAuthenticated) {
      void loadScheduled();
    }
  }, [tab, address, isAuthenticated, loadScheduled]);

  useEffect(() => {
    if (tab === "invoices" && address && isAuthenticated) {
      void loadInvoices();
    }
  }, [tab, address, isAuthenticated, loadInvoices]);

  useEffect(() => {
    if (tab === "contacts" && address && isAuthenticated) {
      void loadContacts();
    }
  }, [tab, address, isAuthenticated, loadContacts]);

  useEffect(() => {
    if (tab !== "scheduled" || !address || !isAuthenticated) {
      return;
    }

    const refreshScheduled = () => {
      void loadScheduled();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshScheduled();
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "agentpay:schedules:refresh") {
        refreshScheduled();
      }
    };

    window.addEventListener("focus", refreshScheduled);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("focus", refreshScheduled);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
    };
  }, [tab, address, isAuthenticated, loadScheduled]);

  const loadMyChainArc = useCallback(async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    try {
      const r = await fetchMyArcName(headers);
      setMyChainArc((prev) => ({
        name: r.name ?? prev?.name ?? null,
        expiresAt: r.expiresAt ?? prev?.expiresAt ?? null,
      }));
    } catch {
      /* keep prior state — do not clear name loaded from /pay/context */
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (tab === "receive" && address && isAuthenticated) {
      void loadMyChainArc();
    }
  }, [tab, address, isAuthenticated, loadMyChainArc]);

  useEffect(() => {
    const raw = arcRegDraft.trim().replace(/\.arc$/i, "");
    if (raw.length < 3 || !/^[a-z0-9]+$/.test(raw)) {
      setArcAvailCheck(null);
      setArcChecking(false);
      return;
    }
    setArcChecking(true);
    if (arcDebounceRef.current) clearTimeout(arcDebounceRef.current);
    arcDebounceRef.current = setTimeout(() => {
      void fetchArcNameAvailability(raw)
        .then((r) => setArcAvailCheck(r))
        .catch(() => setArcAvailCheck(null))
        .finally(() => setArcChecking(false));
    }, 500);
    return () => {
      if (arcDebounceRef.current) clearTimeout(arcDebounceRef.current);
    };
  }, [arcRegDraft]);

  const stopScanner = useCallback(() => {
    try {
      scanControlsRef.current?.stop();
    } catch {
      /* ignore */
    }
    scanControlsRef.current = null;
    setScanOpen(false);
  }, []);

  const startScanner = async () => {
    setScanOpen(true);
    setSendFlowError(null);
    await new Promise((r) => setTimeout(r, 150));
    const video = videoRef.current;
    if (!video) return;
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoDevice(undefined, video, (result, _err, ctl) => {
        if (result) {
          setToAddress(result.getText());
          ctl.stop();
          scanControlsRef.current = null;
          setScanOpen(false);
        }
      });
      scanControlsRef.current = controls;
    } catch (e) {
      setSendFlowError(e instanceof Error ? e.message : "Could not start camera");
      setScanOpen(false);
    }
  };

  const onQrImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSendFlowError(null);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Could not load image"));
          img.src = url;
        });
        const result = await reader.decodeFromImageElement(img);
        setToAddress(result.getText());
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setSendFlowError(err instanceof Error ? err.message : "Could not read QR from image");
    }
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const runSend = async () => {
    setConfirmModalError(null);
    const headers = getAuthHeaders();
    if (!headers) {
      setConfirmModalError("Sign your session first.");
      return;
    }
    const amt = Number(amount);
    if (!toAddress.trim() || !Number.isFinite(amt) || amt <= 0) {
      setConfirmModalError("Enter recipient and a valid amount.");
      return;
    }
    setSendBusy(true);
    setSendFlowError(null);
    try {
      const res = await postPaySend(headers, {
        toAddress: toAddress.trim(),
        amount: amt,
        remark: remark.trim().slice(0, 100) || null,
      });
      setLastReceipt({ txHash: res.txHash, explorerLink: res.explorerLink });
      setRemark("");
      setConfirmOpen(false);
      void loadBalance();
    } catch (e) {
      setConfirmModalError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSendBusy(false);
    }
  };

  const openReviewModal = () => {
    setConfirmModalError(null);
    setConfirmOpen(true);
  };

  const submitRequest = async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setOperationsError(null);
    const amt = Number(reqAmount);
    if (!reqFrom.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setReqBusy(true);
    try {
      await postPayRequest(headers, {
        fromWallet: reqFrom.trim(),
        amount: amt,
        remark: reqRemark.trim() || null,
      });
      setReqFrom("");
      setReqAmount("");
      setReqRemark("");
      await loadRequests();
    } catch (e) {
      setOperationsError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setReqBusy(false);
    }
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setBatchCSVText((ev.target?.result as string) ?? "");
      setBatchPreview(null);
      setBatchResult(null);
      setBatchError(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const downloadTemplate = () => {
    const csv = ["address,amount,remark", "alice.arc,100,salary", "bob.arc,100,salary", "charlie.arc,100,salary"].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agentpay-batch-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const payFromContact = (addr: string) => {
    setToAddress(addr);
    goTab("send");
  };

  const handleAddContact = async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    const name = contactName.trim().toLowerCase();
    const address = contactAddress.trim();
    if (!name || !address) {
      setContactsError("Enter a display name and recipient address.");
      return;
    }
    setAddingContact(true);
    setContactsError(null);
    try {
      const body: Record<string, string> = { name, address };
      const lab = contactLabel.trim();
      const notes = contactNotes.trim();
      if (lab) body.label = lab;
      if (notes) body.notes = notes;
      const res = await fetch("/api/pay/contacts", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not save contact");
      }
      setContactName("");
      setContactAddress("");
      setContactLabel("");
      setContactNotes("");
      await loadContacts();
    } catch (e) {
      setContactsError(e instanceof Error ? e.message : "Could not save contact");
    } finally {
      setAddingContact(false);
    }
  };

  const handleDeleteContact = async (id: string) => {
    if (typeof window !== "undefined") {
      const ok = window.confirm("Remove this contact from your address book?");
      if (!ok) return;
    }
    const headers = getAuthHeaders();
    if (!headers) return;
    setDeletingContactId(id);
    setContactsError(null);
    try {
      const res = await fetch(`/api/pay/contacts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not remove contact");
      }
      await loadContacts();
    } catch (e) {
      setContactsError(e instanceof Error ? e.message : "Could not remove contact");
    } finally {
      setDeletingContactId(null);
    }
  };

  const handleBatchPreview = async () => {
    if (!batchCSVText || !isAuthenticated) return;
    setBatchLoading(true);
    setBatchPreview(null);
    setBatchError(null);
    try {
      const headers = getAuthHeaders();
      if (!headers) return;
      const res = await fetch("/api/batch/preview", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ csvText: batchCSVText }),
      });
      const data = await res.json();
      if (res.ok && data.action === "preview") {
        setBatchPreview(data);
      } else {
        setBatchError(data.message ?? "Preview failed");
      }
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchConfirm = async (confirmId: string) => {
    setBatchExecuting(true);
    setBatchError(null);
    try {
      const headers = getAuthHeaders();
      if (!headers) return;
      const res = await fetch(`/api/batch/confirm/${encodeURIComponent(confirmId)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok) {
        setBatchResult(data);
        setBatchPreview(null);
        setBatchCSVText("");
      } else {
        setBatchError(data.message ?? "Batch failed");
      }
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "Batch failed");
    } finally {
      setBatchExecuting(false);
    }
  };

  const downloadBatchReceipt = () => {
    if (!batchResult?.results) return;
    const rows = [
      ["address", "amount", "remark", "status", "txHash"],
      ...batchResult.results.map((r: any) => [r.to, r.amount, r.remark ?? "", r.status, r.txHash ?? ""]),
    ];
    const csv = rows.map((r: string[]) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "batch-receipt.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApprove = async (id: string) => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setSendBusy(true);
    setPayingRequestId(id);
    try {
      await postPayApprove(headers, id);

      // Optimistic UI: flip this invoice to "paid" in local state so the user
      // sees the change instantly, even before the reload roundtrip.
      setReceivedInvoices((prev) =>
        prev.map((row: any) => {
          if (row.id !== id) return row;
          return {
            ...row,
            status: "paid",
            invoices: row.invoices
              ? { ...row.invoices, status: "paid" }
              : row.invoices,
          };
        }),
      );

      // Fire background reloads in parallel; don't block the click handler on them.
      void Promise.all([loadRequests(), loadHistory(), loadInvoices()]);
    } catch (e) {
      setOperationsError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setSendBusy(false);
      setPayingRequestId(null);
    }
  };

  const handleDecline = async (id: string) => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setSendBusy(true);
    try {
      await postPayDecline(headers, id);
      await loadRequests();
    } catch (e) {
      setOperationsError(e instanceof Error ? e.message : "Decline failed");
    } finally {
      setSendBusy(false);
    }
  };

  const handleExport = async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    try {
      const blob = await exportAgentPayWorkbook(headers);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "agentpay-transactions.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setOperationsError(e instanceof Error ? e.message : "Export failed");
    }
  };

  const handleCancelScheduled = async (row: ScheduledPaymentRow) => {
    const headers = getAuthHeaders();
    if (!headers) return;
    if (typeof window !== "undefined") {
      const recipient = row.to_name?.trim() || shortenAddress(row.to_address);
      const confirmed = window.confirm(
        `Cancel this scheduled payment?\n\nTo: ${recipient}`,
      );
      if (!confirmed) return;
    }

    setOperationsError(null);
    setScheduledToast(null);
    setScheduledBusyId(row.id);
    try {
      await deleteScheduledPayment(headers, row.id);
      setScheduled((current) => current.filter((item) => item.id !== row.id));
      await loadScheduled();
      setScheduledToast(`Cancelled scheduled payment ${row.id}.`);
    } catch (e) {
      setOperationsError(
        e instanceof Error ? e.message : "Scheduled payment cancel failed",
      );
    } finally {
      setScheduledBusyId(null);
    }
  };

  const openAgentPayChat = useCallback(
    (message: string) => {
      const params = new URLSearchParams({
        message: encodeURIComponent(message),
      });
      router.push(`/chat?${params.toString()}`);
    },
    [router],
  );

  const shareLink = async (url: string) => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "AgentPay", url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* ignore */
    }
  };

  const runArcRegister = async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    const clean = arcRegDraft.trim().replace(/\.arc$/i, "");
    if (clean.length < 3) return;
    setArcRegBusy(true);
    setArcNameError(null);
    try {
      const r = await postArcNameRegister(headers, { name: clean });
      setArcRegSuccess(`${r.name} registered!`);
      setArcRegModal(false);
      setArcRegDraft("");
      setArcAvailCheck(null);
      await loadMyChainArc();
      await loadContext();
    } catch (e) {
      setArcNameError(e instanceof Error ? e.message : "Register failed");
    } finally {
      setArcRegBusy(false);
    }
  };

  const runRenewArc = async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    setRenewBusy(true);
    setArcNameError(null);
    try {
      await postArcNameRenew(headers);
      await loadMyChainArc();
    } catch (e) {
      setArcNameError(e instanceof Error ? e.message : "Renew failed");
    } finally {
      setRenewBusy(false);
    }
  };

  const runUpdateDcw = async () => {
    const headers = getAuthHeaders();
    if (!headers) return;
    const raw = newDcwInput.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
      setArcNameError("Enter a valid 0x address");
      return;
    }
    setDcwBusy(true);
    setArcNameError(null);
    try {
      await putArcNameDcw(headers, { newDcwWallet: raw });
      setNewDcwInput("");
      await loadMyChainArc();
      await loadBalance();
    } catch (e) {
      setArcNameError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setDcwBusy(false);
    }
  };

  const chainArcExpiresInDays =
    myChainArc?.expiresAt != null
      ? (new Date(myChainArc.expiresAt).getTime() - Date.now()) / (86400 * 1000)
      : null;

  const dcwExecutionAddress =
    balanceInfo?.userAgentWalletAddress?.trim() ||
    payContext?.userAgentWalletAddress?.trim() ||
    "";

  useEffect(() => {
    if (tab !== "receive") {
      return;
    }
    if (!address || !isAuthenticated || authLoading || balanceLoading) {
      return;
    }
    const needsExecutionAddress = !dcwExecutionAddress;
    const needsBalance = !balanceInfo && !balanceLoading;
    const needsArcName = !myChainArc?.name;

    if (!needsExecutionAddress && !needsBalance && !needsArcName) {
      return;
    }

    // Keep retrying missing receive-panel data so a transient boot/API failure
    // cannot leave the QR visible while the .arc name or USDC balance stays blank.
    void loadContext();
    if (needsBalance) void loadBalance();
    if (needsArcName) void loadMyChainArc();

    const timer = window.setInterval(() => {
      void loadContext();
      void loadBalance();
      void loadMyChainArc();
    }, 12000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    tab,
    address,
    isAuthenticated,
    authLoading,
    balanceInfo,
    balanceLoading,
    dcwExecutionAddress,
    loadContext,
    loadBalance,
    loadMyChainArc,
    myChainArc?.name,
  ]);

  const arcHandleTrimmed = payContext?.arc_handle?.trim() || "";
  const publicPayUrl = arcHandleTrimmed
    ? `${payPublicOrigin.replace(/\/+$/, "")}/pay/${encodeURIComponent(arcHandleTrimmed)}`
    : "";

  const handleOrAddr =
    (payContext?.arc_handle?.trim() && payContext.arc_handle) || dcwExecutionAddress || "";
  const payLink =
    paymentBaseUrl && handleOrAddr
      ? `${paymentBaseUrl.replace(/\/+$/, "")}/pay/${encodeURIComponent(handleOrAddr)}`
      : "";

  // Shareable payment link for the user's on-chain .arc name
  const chainArcPayLink = myChainArc?.name && paymentBaseUrl
    ? `${paymentBaseUrl.replace(/\/+$/, "")}/pay/${myChainArc.name.replace(/\.arc$/i, "")}`
    : "";

  const usdcAvailable = balanceInfo ? pickUsdcBalance(balanceInfo.holdings) : null;
  const uiAddress = hydrated ? address : undefined;
  const uiIsAuthenticated = hydrated ? isAuthenticated : false;
  const uiAuthLoading = hydrated ? authLoading : false;

  const arcRegistrationFeePhrase =
    arcAvailCheck &&
    typeof arcAvailCheck.registrationFeeUsdc === "number" &&
    Number.isFinite(arcAvailCheck.registrationFeeUsdc)
      ? `${formatUsd(arcAvailCheck.registrationFeeUsdc)} registration fee (on-chain, from your agent wallet)`
      : "the on-chain registration fee (from your agent wallet)";

  const formatScheduleLabel = (row: ScheduledPaymentRow): string => {
    const amountValue = Number(row.amount || 0);
    const amountText = `${Number.isFinite(amountValue) ? amountValue : 0} USDC`;
    const value = String(row.schedule_value || "").trim().toLowerCase();

    if (row.schedule_type === "daily") {
      return `${amountText} every day`;
    }
    if (row.schedule_type === "weekly_day") {
      const day = value ? value.charAt(0).toUpperCase() + value.slice(1) : "week";
      return `${amountText} every ${day}`;
    }
    if (row.schedule_type === "monthly_day") {
      const dayNumber = Number.parseInt(value || "1", 10) || 1;
      const mod10 = dayNumber % 10;
      const mod100 = dayNumber % 100;
      const suffix =
        mod10 === 1 && mod100 !== 11
          ? "st"
          : mod10 === 2 && mod100 !== 12
            ? "nd"
            : mod10 === 3 && mod100 !== 13
              ? "rd"
              : "th";
      return `${amountText} every ${dayNumber}${suffix} of the month`;
    }

    return `${amountText} on ${row.schedule_type}${value ? ` (${value})` : ""}`;
  };

  const formatShortDate = (value: string | null | undefined): string => {
    if (!value) return "—";
    const parsed = parseServerDate(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "send", label: "Send" },
    { id: "receive", label: "Receive" },
    { id: "requests", label: "Requests" },
    { id: "history", label: "History" },
    { id: "scheduled", label: "Scheduled" },
    { id: "invoices", label: "Invoices" },
    { id: "contacts", label: "Contacts" },
    { id: "batch", label: "Batch" },
  ];
  const recentRelocations = (history ?? []).slice(0, 3);

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] text-[#f2f2f2]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatTopNavbar
          actions={(
            <SessionStatusChip
              address={uiAddress}
              isAuthenticated={uiIsAuthenticated}
              isLoading={uiAuthLoading}
              onAction={() => {
                if (!address) { openConnectModal?.(); return; }
                if (!isAuthenticated) { void signIn().catch(() => {}); }
              }}
              compact
            />
          )}
        />

        <main className="flex-1 overflow-y-auto pb-16 px-10 pt-12">
          <div className="mx-auto max-w-[1240px]">
            {/* Page header */}
            <header className="mb-14 flex flex-col md:flex-row md:items-end justify-between gap-10">
              <div>
                <h2 className="mb-4 font-headline text-5xl tracking-tight text-white">
                  Agent<span className="text-[#f2ca50]">Pay</span>
                </h2>
                <div className="flex items-center gap-5">
                  <span className="border border-[#f2ca50]/25 bg-[#f2ca50]/6 px-2.5 py-1 font-label text-[9px] uppercase tracking-[0.28em] text-[#f2ca50]">
                    {uiIsAuthenticated ? "Authorized Session" : uiAddress ? "Sign Session" : "Connect Wallet"}
                  </span>
                  <div className="flex items-center gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f2ca50]/80 shadow-[0_0_8px_rgba(212,175,55,0.4)]" />
                    <span className="text-white/55 text-[10px] uppercase tracking-[0.25em]">Arc live</span>
                  </div>
                </div>
              </div>
              <div className="bg-[#020202] p-8 border border-[rgba(212,175,55,0.12)] relative group transition-all duration-500 hover:border-[#f2ca50]/20 obsidian-shadow">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#f2ca50]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                <p className="font-label uppercase tracking-[0.4em] text-[8px] text-white/30 mb-2.5">Available USDC</p>
                <div className="flex items-baseline gap-3 relative z-10">
                  {balanceLoading ? (
                    <span className="text-white/30 text-sm">Loading…</span>
                  ) : (
                    <>
                      <h3 className="text-4xl font-headline italic text-[#f2ca50]" style={{ letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                        {usdcAvailable !== null ? usdcAvailable.toFixed(2) : "—"}
                      </h3>
                      <span className="text-white/20 font-label text-[10px] tracking-widest uppercase">USDC</span>
                    </>
                  )}
                </div>
              </div>
            </header>

            {!uiAddress ? (
              <div className="border border-white/10 bg-[#0a0a0a] p-6 text-sm text-white/40">
                Connect your wallet to use AgentPay.
              </div>
            ) : !uiIsAuthenticated ? (
              <div className="border border-[rgba(242,202,80,0.35)] bg-[#0a0a0a] p-6">
                <div className="text-sm text-white/90">Sign your AgentFlow session to continue.</div>
                <button
                  type="button"
                  onClick={() => {
                    void signIn().catch(() => {});
                  }}
                  disabled={uiAuthLoading}
                  className="transition-all burnished-gold mt-4 px-4 py-2 text-sm font-bold disabled:opacity-60"
                >
                  {uiAuthLoading ? "Signing..." : "Sign session"}
                </button>
                {authError ? (
                  <div className="mt-3 text-sm text-[#ffa8a3]">{authError}</div>
                ) : null}
              </div>
            ) : (
              <>
                <nav className="mb-12 flex flex-wrap gap-3 border-b border-white/5 pb-5">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => goTab(t.id)}
                      className={`rounded-full border px-4 py-2 font-label text-[11px] uppercase tracking-[0.22em] transition-all ${
                        tab === t.id
                          ? "border-[#f2ca50]/60 bg-[#f2ca50]/10 text-[#f2ca50] shadow-[0_0_0_1px_rgba(242,202,80,0.08)]"
                          : "border-white/10 text-white/60 hover:border-white/25 hover:text-white/90"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>

                {tab === "send" && sendFlowError ? (
                  <div className="mb-4 rounded-xl border border-[#ff716c]/30 bg-[#9f0519]/10 px-4 py-3 text-sm text-[#ffa8a3]">
                    {sendFlowError}
                  </div>
                ) : null}
                {(tab === "requests" || tab === "history" || tab === "scheduled") && operationsError ? (
                  <div className="mb-4 rounded-xl border border-[#ff716c]/30 bg-[#9f0519]/10 px-4 py-3 text-sm text-[#ffa8a3]">
                    {operationsError}
                  </div>
                ) : null}
                {tab === "contacts" && contactsError ? (
                  <div className="mb-4 rounded-xl border border-[#ff716c]/30 bg-[#9f0519]/10 px-4 py-3 text-sm text-[#ffa8a3]">
                    {contactsError}
                  </div>
                ) : null}
                {tab === "scheduled" && scheduledToast ? (
                  <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    {scheduledToast}
                  </div>
                ) : null}

                {tab === "send" ? (
                  <div className="grid gap-8 xl:grid-cols-12">
                    <div className="space-y-8 xl:col-span-8">
                      <div className="space-y-4 border border-[rgba(212,175,55,0.08)] bg-[#0a0a0a] p-8">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                        Recipient
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <input
                          value={toAddress}
                          onChange={(e) => {
                            setSendFlowError(null);
                            setToAddress(e.target.value);
                          }}
                          className="min-w-0 flex-1 w-full bg-[#0e0e0e]/50 border border-[rgba(212,175,55,0.12)] hover:border-[#f2ca50]/30 focus:border-[#f2ca50]/50 px-5 py-4 text-white/90 font-body tracking-[0.05em] transition-all outline-none focus:ring-0 text-sm"
                          placeholder="Enter .arc name, 0x address, or scan QR"
                          autoComplete="off"
                        />
                        <input
                          ref={qrFileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => void onQrImageSelected(e)}
                        />
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => void startScanner()}
                            className="transition-all rounded-xl border border-[rgba(242,202,80,0.35)] px-3 py-2 text-xs font-semibold text-[#f2ca50] whitespace-nowrap hover:bg-[rgba(242,202,80,0.12)] active:scale-[0.98]"
                          >
                            Scan QR
                          </button>
                          <button
                            type="button"
                            onClick={() => qrFileInputRef.current?.click()}
                            className="transition-all rounded-xl border border-white/10 bg-[#0e0e0e] px-3 py-2 text-xs font-semibold text-white/90 whitespace-nowrap hover:bg-[#161616] active:scale-[0.98]"
                          >
                            Upload QR
                          </button>
                        </div>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-white/40">
                          Amount (USDC)
                        </span>
                        <input
                          value={amount}
                          onChange={(e) => {
                            setSendFlowError(null);
                            setAmount(e.target.value);
                          }}
                          className="w-full w-full bg-[#0e0e0e]/50 border border-[rgba(212,175,55,0.12)] hover:border-[#f2ca50]/30 focus:border-[#f2ca50]/50 px-5 py-4 text-white/90 font-body tracking-[0.05em] transition-all outline-none focus:ring-0 text-sm"
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-white/40">
                          Remark (optional, max 100 chars)
                        </span>
                        <input
                          value={remark}
                          onChange={(e) => {
                            setSendFlowError(null);
                            setRemark(e.target.value.slice(0, 100));
                          }}
                          className="w-full w-full bg-[#0e0e0e]/50 border border-[rgba(212,175,55,0.12)] hover:border-[#f2ca50]/30 focus:border-[#f2ca50]/50 px-5 py-4 text-white/90 font-body tracking-[0.05em] transition-all outline-none focus:ring-0 text-sm"
                          maxLength={100}
                        />
                      </label>
                      <div className="rounded-xl border border-white/10 bg-[#0e0e0e]/50 px-4 py-3 text-sm text-white/40">
                        Preview: {previewLabel}
                      </div>
                      <button
                        type="button"
                        disabled={sendBusy}
                        onClick={openReviewModal}
                        className="burnished-gold w-full py-5 text-[#1a1500] font-label text-[11px] uppercase tracking-[0.5em] font-extrabold flex items-center justify-center gap-4 transition-all active:scale-[0.985] disabled:opacity-60"
                      >
                        Confirm & authorize
                      </button>
                      {lastReceipt ? (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
                          <div className="font-semibold text-emerald-200">Payment sent</div>
                          <div className="mt-2 font-mono text-xs break-all text-white/40">
                            {lastReceipt.txHash}
                          </div>
                          <a
                            href={lastReceipt.explorerLink}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-[#f2ca50]"
                          >
                            View on Arcscan
                          </a>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-6">
                      <h4 className="font-headline text-2xl italic text-white/90/85">
                        Recent transfers
                      </h4>
                      <div className="space-y-3">
                        {recentRelocations.length === 0 ? (
                          <div className="rounded-xl border border-white/10 bg-[#0e0e0e] p-5 text-sm text-white/40">
                            No completed transfers yet.
                          </div>
                        ) : (
                          recentRelocations.map((row, idx) => {
                            const outgoing = row.direction === "out";
                            const counterparty = outgoing ? row.to_wallet : row.from_wallet;
                            return (
                              <div
                                key={row.id}
                                className={`rounded-xl p-5 transition ${
                                  idx === 0
                                    ? "border-l-4 border-[#f2ca50] bg-[#161616] shadow-inner"
                                    : "border border-white/10 bg-[#0e0e0e] hover:bg-[#161616]"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-bold text-white/90">
                                      {shortenAddress(counterparty)}
                                    </p>
                                    <p className="mt-1 text-xs text-white/40/70">
                                      {formatServerDateTime(row.created_at)}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className={`font-bold ${outgoing ? "text-[#f2ca50]" : "text-white/90"}`}>
                                      {outgoing ? "-" : "+"}
                                      {formatUsd(Number(row.amount))}
                                    </p>
                                    <p className="text-[10px] uppercase tracking-[0.16em] text-white/40/70">
                                      {row.status || "processed"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    </div>

                    <div className="space-y-6 xl:col-span-4">
                      <div className="relative overflow-hidden border border-[rgba(212,175,55,0.08)] bg-[#0a0a0a] p-6">
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                        <div className="relative">
                          <span className="inline-block rounded-full bg-[rgba(242,202,80,0.14)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#f2ca50]">
                            Arc Testnet
                          </span>
                          <h4 className="mt-3 font-headline text-2xl italic text-white/90">Settlement rail</h4>
                          <p className="mt-2 text-sm text-white/40">
                            Send and receive USDC from the Agent wallet on Arc Testnet.
                          </p>
                        </div>
                      </div>
                      <div className="border border-[rgba(212,175,55,0.08)] bg-[#0a0a0a]/80 p-6 text-sm text-white/40">
                        <p>
                          Transfers use your <strong className="text-white/90">Circle developer-controlled</strong>{" "}
                          agent wallet on Arc Testnet. Ensure the wallet holds enough USDC for the amount plus fees.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {tab === "receive" ? (
                  <div className="space-y-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div className="space-y-4 border border-[rgba(212,175,55,0.08)] bg-[#0a0a0a] p-6">
                        <h2 className="font-headline text-lg font-bold text-white/90">
                          Direct USDC (any wallet)
                        </h2>
                        <p className="text-sm text-white/40">
                          Anyone can send you USDC directly to your execution wallet address below — no AgentFlow
                          account needed.
                        </p>
                        <div className="flex justify-center rounded-2xl bg-white p-4">
                          {dcwExecutionAddress ? (
                            <QRCodeSVG value={dcwExecutionAddress} size={200} level="M" />
                          ) : authLoading || balanceLoading ? (
                            <div className="flex h-[200px] w-[200px] flex-col items-center justify-center rounded-xl bg-[#d6d9de] text-center text-xs text-black/55">
                              <div className="h-10 w-10 animate-spin rounded-full border-4 border-black/15 border-t-black/45" />
                              <span className="mt-4 max-w-[140px] font-medium">Loading execution wallet QR...</span>
                            </div>
                          ) : (
                            <div className="flex h-[200px] w-[200px] flex-col items-center justify-center rounded-xl bg-[#d6d9de] px-4 text-center text-xs text-black/60">
                              <span className="max-w-[150px] font-medium">
                                Execution wallet address is unavailable right now.
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  void loadContext();
                                  void loadBalance();
                                }}
                                className="mt-4 rounded-full border border-black/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-black/75 transition hover:border-black/30 hover:text-black"
                              >
                                Reload address
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="break-all font-mono text-xs text-white/90">
                          {dcwExecutionAddress || "—"}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (dcwExecutionAddress) void navigator.clipboard.writeText(dcwExecutionAddress);
                          }}
                          disabled={!dcwExecutionAddress}
                          className="burnished-gold rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50"
                        >
                          Copy address
                        </button>
                      </div>

                      <div className="space-y-4 border border-[rgba(212,175,55,0.08)] bg-[#0a0a0a] p-6">
                        {myChainArc?.name ? (
                          <>
                            <h2 className="font-headline text-lg font-bold text-white/90">
                              Your AgentPay .arc name
                            </h2>
                            {arcRegSuccess ? (
                              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                                {arcRegSuccess}
                              </div>
                            ) : null}
                            {arcNameError ? (
                              <div className="rounded-lg border border-[#ff716c]/30 bg-[#9f0519]/10 px-3 py-2 text-sm text-[#ffa8a3]">
                                {arcNameError}
                              </div>
                            ) : null}
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                                Your .arc name
                              </div>
                              <p className="font-mono text-lg text-[#f2ca50]">{myChainArc.name}</p>
                              {myChainArc.expiresAt ? (
                                <p className="mt-1 text-sm text-white/40">
                                  Expires:{" "}
                                  {new Date(myChainArc.expiresAt).toLocaleDateString(undefined, {
                                    day: "numeric",
                                    month: "long",
                                    year: "numeric",
                                  })}
                                </p>
                              ) : null}
                            </div>
                            {chainArcExpiresInDays !== null &&
                            chainArcExpiresInDays < 30 &&
                            chainArcExpiresInDays > 0 ? (
                              <button
                                type="button"
                                disabled={renewBusy}
                                onClick={() => void runRenewArc()}
                                className="rounded-xl bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-200 disabled:opacity-50"
                              >
                                {renewBusy ? "Renewing…" : "Renew"}
                              </button>
                            ) : null}
                            {chainArcPayLink && (
                              <div className="border-t border-white/10 pt-4">
                                <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
                                  Your Payment Link
                                </div>
                                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black px-3 py-2">
                                  <span className="flex-1 truncate font-mono text-xs text-[#69daff]">
                                    {chainArcPayLink}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void navigator.clipboard.writeText(chainArcPayLink);
                                      setArcLinkCopied(true);
                                      setTimeout(() => setArcLinkCopied(false), 2000);
                                    }}
                                    className="shrink-0 text-xs text-white/40 hover:text-white"
                                  >
                                    {arcLinkCopied ? "Copied!" : "Copy"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void shareLink(chainArcPayLink)}
                                    className="shrink-0 text-xs font-semibold text-[#f2ca50]"
                                  >
                                    Share
                                  </button>
                                </div>
                                <p className="mt-1 text-xs text-white/40">
                                  Share to receive USDC. Anyone can pay without an AgentFlow account.
                                </p>
                              </div>
                            )}

                            <div className="border-t border-white/10 pt-4">
                              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
                                Update payment (DCW) address
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <input
                                  value={newDcwInput}
                                  onChange={(e) => setNewDcwInput(e.target.value)}
                                  placeholder="0x… new DCW address"
                                  className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black px-3 py-2 font-mono text-xs"
                                />
                                <button
                                  type="button"
                                  disabled={dcwBusy}
                                  onClick={() => void runUpdateDcw()}
                                  className="rounded-xl border border-[rgba(242,202,80,0.35)] px-4 py-2 text-sm font-semibold text-[#f2ca50] disabled:opacity-50"
                                >
                                  {dcwBusy ? "Updating…" : "Update DCW"}
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <h2 className="font-headline text-lg font-bold text-white/90">
                              Get your .arc name
                            </h2>
                            <p className="text-xs text-white/40">
                              On-chain AgentPay registry on Arc. Names are a–z and 0–9, 3–20 characters. Fee is
                              charged in USDC from your agent wallet.
                            </p>
                            {arcRegSuccess ? (
                              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                                {arcRegSuccess}
                              </div>
                            ) : null}
                            {arcNameError ? (
                              <div className="rounded-lg border border-[#ff716c]/30 bg-[#9f0519]/10 px-3 py-2 text-sm text-[#ffa8a3]">
                                {arcNameError}
                              </div>
                            ) : null}
                            <label className="block">
                              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-white/40">
                                Choose your name
                              </span>
                              <div className="flex items-center gap-2">
                                <input
                                  value={arcRegDraft}
                                  onChange={(e) => {
                                    setArcRegSuccess(null);
                                    setArcNameError(null);
                                    setArcRegDraft(e.target.value.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase());
                                  }}
                                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-white/90 outline-none focus:border-[rgba(242,202,80,0.45)]"
                                  placeholder="yourname"
                                  autoComplete="off"
                                />
                                <span className="shrink-0 text-sm text-white/40">.arc</span>
                              </div>
                            </label>
                            {arcChecking ? (
                              <p className="text-xs text-[#6d7078]">Checking…</p>
                            ) : arcAvailCheck ? (
                              <p
                                className={`text-sm ${arcAvailCheck.available ? "text-emerald-300" : "text-[#ffa8a3]"}`}
                              >
                                {arcAvailCheck.name}{" "}
                                {arcAvailCheck.available ? "is available ✓" : "taken ✗"}
                              </p>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                setArcRegModal(true);
                                setArcNameError(null);
                              }}
                              disabled={
                                !arcAvailCheck?.available ||
                                arcRegDraft.trim().replace(/\.arc$/i, "").length < 3
                              }
                              className="burnished-gold rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50"
                            >
                              Register
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {arcHandleTrimmed ? (
                      <div className="border border-[rgba(212,175,55,0.08)] bg-[#0a0a0a] p-6">
                        <h3 className="mb-2 font-headline text-sm font-bold text-white/90">
                          In-app profile handle
                        </h3>
                        <p className="mb-3 text-xs text-white/40/70">
                          Separate from your on-chain AgentPay name — used for legacy in-app payment links.
                        </p>
                        <p className="font-mono text-sm text-[#f2ca50]">{arcHandleTrimmed}</p>
                        {publicPayUrl ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <div className="break-all font-mono text-xs text-white/40">{publicPayUrl}</div>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard.writeText(publicPayUrl)}
                              className="rounded-lg border border-[rgba(242,202,80,0.35)] px-3 py-1 text-xs font-semibold text-[#f2ca50]"
                            >
                              Copy link
                            </button>
                            <button
                              type="button"
                              onClick={() => void shareLink(publicPayUrl)}
                              className="rounded-lg border border-white/10 px-3 py-1 text-xs font-semibold text-white/90"
                            >
                              Share
                            </button>
                          </div>
                        ) : null}
                        {payLink && payLink !== publicPayUrl ? (
                          <p className="mt-4 border-t border-white/10 pt-4 text-xs text-white/40/70">
                            This app URL:{" "}
                            <span className="break-all font-mono text-white/40">{payLink}</span>
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {tab === "requests" ? (
                  <div className="space-y-8">
                    <div className="border border-[rgba(212,175,55,0.08)] bg-[#0a0a0a] p-6">
                      <h2 className="mb-4 font-headline text-lg font-bold">Request money</h2>
                      <div className="grid gap-4 md:grid-cols-3">
                        <input
                          value={reqFrom}
                          onChange={(e) => setReqFrom(e.target.value)}
                          placeholder="From (wallet or handle)"
                          className="rounded-xl border border-white/10 bg-black px-4 py-3 text-sm"
                        />
                        <input
                          value={reqAmount}
                          onChange={(e) => setReqAmount(e.target.value)}
                          placeholder="Amount USDC"
                          className="rounded-xl border border-white/10 bg-black px-4 py-3 text-sm"
                        />
                        <input
                          value={reqRemark}
                          onChange={(e) => setReqRemark(e.target.value)}
                          placeholder="Remark"
                          className="rounded-xl border border-white/10 bg-black px-4 py-3 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={reqBusy}
                        onClick={() => void submitRequest()}
                        className="burnished-gold mt-4 rounded-xl px-5 py-2 text-sm font-bold disabled:opacity-60"
                      >
                        {reqBusy ? "Submitting…" : "Create request"}
                      </button>
                    </div>

                    <div>
                      <h3 className="mb-3 font-semibold text-white/90">Incoming (you pay)</h3>
                      {reqLoading ? (
                        <div className="text-sm text-white/40">Loading…</div>
                      ) : (incoming ?? []).length === 0 ? (
                        <div className="text-sm text-white/40">No pending incoming requests.</div>
                      ) : (
                        <div className="space-y-3">
                          {(incoming ?? []).map((r) => (
                            <div
                              key={r.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0e0e0e] p-4 transition hover:border-[rgba(242,202,80,0.25)] hover:bg-[#161616]"
                            >
                              <div>
                                <div className="font-bold">{formatUsd(Number(r.amount))}</div>
                                <div className="text-xs text-white/40">
                                  To {shortenAddress(r.to_wallet)} · {r.remark || "—"}
                                </div>
                                {r.invoices && (
                                  <div className="mt-1 text-xs text-[#69daff]">
                                    Invoice {r.invoices.invoice_number ?? ""}
                                    {r.invoices.vendor_name ? ` · ${r.invoices.vendor_name}` : ""}
                                  </div>
                                )}
                                <div className="text-[10px] text-[#6d7078]">
                                  {formatServerDateTime(r.created_at)}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={sendBusy}
                                  onClick={() => void handleApprove(r.id)}
                                  className="rounded-lg border border-[rgba(242,202,80,0.35)] px-3 py-1.5 text-xs font-semibold text-[#f2ca50]"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={sendBusy}
                                  onClick={() => void handleDecline(r.id)}
                                  className="rounded-lg border border-[#ff716c]/40 px-3 py-1.5 text-xs font-semibold text-[#ff716c]"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className="mb-3 font-semibold text-white/90">Outgoing (you requested)</h3>
                      {(outgoing ?? []).length === 0 ? (
                        <div className="text-sm text-white/40">No outgoing requests yet.</div>
                      ) : (
                        <div className="space-y-3">
                          {(outgoing ?? []).map((r) => (
                            <div
                              key={r.id}
                              className="rounded-xl border border-white/10 bg-[#0e0e0e] p-4 transition hover:border-[rgba(242,202,80,0.25)] hover:bg-[#161616]"
                            >
                              <div className="flex justify-between gap-2">
                                <span className="font-bold">{formatUsd(Number(r.amount))}</span>
                                <span
                                  className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                                    r.status === "paid"
                                      ? "bg-emerald-500/15 text-emerald-300"
                                      : r.status === "declined"
                                        ? "bg-red-500/15 text-red-300"
                                        : "bg-amber-500/15 text-amber-200"
                                  }`}
                                >
                                  {r.status}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-white/40">
                                From {shortenAddress(r.from_wallet)} · {r.remark || "—"}
                              </div>
                              <div className="text-[10px] text-[#6d7078]">
                                {formatServerDateTime(r.created_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {tab === "history" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        value={historyFilter}
                        onChange={(e) =>
                          setHistoryFilter(e.target.value as "" | "in" | "out")
                        }
                        className="rounded-xl border border-[#46484d]/20 bg-[#000000] px-3 py-2 text-sm"
                      >
                        <option value="">All</option>
                        <option value="in">Incoming</option>
                        <option value="out">Outgoing</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void loadHistory()}
                        className="rounded-xl border border-white/10 px-3 py-2 text-sm text-[#aaabb0]"
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExport()}
                        className="burnished-gold rounded-xl px-4 py-2 text-sm font-bold"
                      >
                        Export Excel
                      </button>
                    </div>
                    {historyLoading ? (
                      <div className="text-sm text-[#aaabb0]">Loading history…</div>
                    ) : (
                      <div className="space-y-3">
                        {(history ?? []).length === 0 ? (
                          <div className="rounded-xl border border-white/10 bg-[#0e0e0e] px-4 py-8 text-center text-sm text-white/40">
                            No transactions yet.
                          </div>
                        ) : (
                          (history ?? []).map((row) => {
                            const cp = row.direction === "in" ? row.from_wallet : row.to_wallet;
                            return (
                              <div
                                key={row.id}
                                className="rounded-xl border border-white/10 bg-[#0e0e0e] p-4 transition hover:border-[rgba(242,202,80,0.25)] hover:bg-[#161616]"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-semibold text-white/90">
                                      {formatUsd(Number(row.amount))}
                                    </div>
                                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-white/40/70">
                                      {row.direction} · {row.status || "processed"}
                                    </div>
                                  </div>
                                  <div className="text-right text-xs text-white/40">
                                    {formatServerDateTime(row.created_at)}
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-2 text-xs text-white/40 sm:grid-cols-2">
                                  <div className="truncate">
                                    Counterparty: <span className="font-mono text-white/90">{shortenAddress(cp)}</span>
                                  </div>
                                  <div className="truncate">Remark: {row.remark || "—"}</div>
                                </div>
                                {row.explorerLink ? (
                                  <a
                                    href={row.explorerLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-3 inline-flex text-xs font-semibold uppercase tracking-[0.14em] text-[#f2ca50]"
                                  >
                                    View on Arcscan
                                  </a>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {tab === "scheduled" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0e0e0e] px-4 py-4">
                      <div>
                        <div className="text-sm font-semibold text-white/90">Recurring USDC payments</div>
                        <div className="mt-1 text-sm text-white/45">
                          Create, review, or cancel recurring payments here, or manage them in chat with natural language.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void loadScheduled()}
                          className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/70 transition hover:border-[rgba(242,202,80,0.25)] hover:text-white"
                        >
                          Refresh
                        </button>
                        <button
                          type="button"
                          onClick={() => openAgentPayChat("show my scheduled payments")}
                          className="rounded-lg border border-[rgba(242,202,80,0.35)] bg-[rgba(242,202,80,0.08)] px-3 py-2 text-sm font-medium text-[#f2ca50] transition hover:bg-[rgba(242,202,80,0.16)]"
                        >
                          Open in chat
                        </button>
                      </div>
                    </div>
                    {scheduledLoading ? (
                      <div className="text-sm text-[#aaabb0]">Loading scheduled payments…</div>
                    ) : scheduled.length === 0 ? (
                      <div className="rounded-xl border border-white/10 bg-[#0e0e0e] px-4 py-8 text-center text-sm text-white/40">
                        <div>No scheduled payments yet.</div>
                        <div className="mt-2">Tell the agent to set one up:</div>
                        <div className="mt-2 font-mono text-xs text-[#f2ca50]">
                          &quot;Pay alice.arc 10 USDC every monday&quot;
                        </div>
                        <button
                          type="button"
                          onClick={() => openAgentPayChat("pay alice.arc 10 USDC every monday")}
                          className="mt-4 rounded-lg border border-[rgba(242,202,80,0.35)] bg-[rgba(242,202,80,0.08)] px-4 py-2 text-sm font-medium text-[#f2ca50] transition hover:bg-[rgba(242,202,80,0.16)]"
                        >
                          Create in chat
                        </button>
                      </div>
                    ) : (
                      scheduled.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-xl border border-white/10 bg-[#0e0e0e] p-5 transition hover:border-[rgba(242,202,80,0.25)] hover:bg-[#161616]"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="space-y-2">
                              <div className="text-lg font-semibold text-white/90">
                                💸 {formatScheduleLabel(row)}
                              </div>
                              <div className="text-sm text-white/50">
                                To:{" "}
                                <span className="font-mono text-white/85">
                                  {row.to_name?.trim() || shortenAddress(row.to_address)}
                                </span>
                              </div>
                              <div className="text-sm text-white/50">
                                Remark: {row.remark?.trim() || "none"}
                              </div>
                              <div className="text-sm text-white/50">
                                Next run: {formatShortDate(row.next_run)}
                              </div>
                              <div className="text-sm text-white/50">
                                Created: {formatShortDate(row.created_at)}
                              </div>
                              <div className="text-sm text-white/50">
                                Executions: {row.execution_count ?? 0}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.18em] text-white/30">
                                ID: {row.id}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={scheduledBusyId === row.id}
                                onClick={() => void handleCancelScheduled(row)}
                                className="rounded-lg border border-[#ff716c]/40 px-4 py-2 text-sm font-semibold text-[#ff716c] disabled:opacity-60"
                              >
                                {scheduledBusyId === row.id ? "Cancelling..." : "Cancel now"}
                              </button>
                            </div>
                          </div>
                        </div>
                    )))}
                  </div>
                ) : null}

                {tab === "invoices" ? (
                  <div className="space-y-6">
                    {invoiceLoading ? (
                      <div className="text-sm text-[#aaabb0]">
                        Loading invoices...
                      </div>
                    ) : (
                      <>
                        {/* Received invoices (you owe) */}
                        {receivedInvoices.length > 0 && (
                          <div className="space-y-3">
                            <div className="text-xs font-medium text-[#aaabb0] uppercase tracking-wider">
                              Invoices to Pay
                            </div>
                            {receivedInvoices.map((inv: any) => {
                              const detail = inv.invoices as any;
                              if (!detail) return null;
                              return (
                                <div
                                  key={inv.id}
                                  className="rounded-2xl border border-white/10 bg-[#111318] p-4"
                                >
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <div className="text-sm font-medium text-white">
                                        {detail.invoice_number}
                                      </div>
                                      <div className="text-xs text-[#aaabb0] mt-0.5">
                                        From: {String(detail.business_wallet ?? "").slice(0, 6)}...
                                      </div>
                                      {detail.line_items?.[0] && (
                                        <div className="text-xs text-[#aaabb0]">
                                          {detail.line_items[0].description}
                                        </div>
                                      )}
                                    </div>
                                    <div className="text-right">
                                      <div className="text-sm font-medium text-white">
                                        ${Number(inv.amount).toFixed(2)} USDC
                                      </div>
                                      <span
                                        className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
                                          detail.status === "paid"
                                            ? "text-green-400 bg-green-400/10"
                                            : "text-yellow-400 bg-yellow-400/10"
                                        }`}
                                      >
                                        {detail.status === "paid" ? "✅ Paid" : "⏳ Pending"}
                                      </span>
                                    </div>
                                  </div>
                                  {detail.line_items?.length > 1 && (
                                    <div className="border-t border-white/10 pt-2 mt-2 mb-2">
                                      {detail.line_items.map((item: any, i: number) => (
                                        <div
                                          key={i}
                                          className="flex justify-between text-xs text-[#aaabb0] py-0.5"
                                        >
                                          <span>{item.description}</span>
                                          <span>${Number(item.amount).toFixed(2)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex justify-between items-center mt-3">
                                    <div className="text-xs text-[#aaabb0]">
                                      {formatServerDate(inv.created_at)}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {detail.arc_tx_id && (
                                        <a
                                          href={`https://testnet.arcscan.app/tx/${detail.arc_tx_id}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-[#69daff]"
                                        >
                                          Arcscan ↗
                                        </a>
                                      )}
                                      {detail.status === "pending" && (
                                        <button
                                          onClick={() => handleApprove(inv.id)}
                                          disabled={sendBusy}
                                          className="px-3 py-1 bg-[#69daff] text-black rounded-lg text-xs font-medium hover:bg-[#69daff]/90 transition disabled:opacity-50 inline-flex items-center gap-1.5"
                                        >
                                          {payingRequestId === inv.id ? (
                                            <>
                                              <svg
                                                className="animate-spin h-3 w-3 text-black"
                                                xmlns="http://www.w3.org/2000/svg"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                              >
                                                <circle
                                                  className="opacity-25"
                                                  cx="12"
                                                  cy="12"
                                                  r="10"
                                                  stroke="currentColor"
                                                  strokeWidth="4"
                                                />
                                                <path
                                                  className="opacity-75"
                                                  fill="currentColor"
                                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                />
                                              </svg>
                                              Paying...
                                            </>
                                          ) : (
                                            "Pay Invoice"
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Sent invoices (you created) */}
                        <div className="space-y-3">
                          {sentInvoices.length > 0 && (
                            <div className="text-xs font-medium text-[#aaabb0] uppercase tracking-wider">
                              Sent Invoices
                            </div>
                          )}
                          {sentInvoices.length === 0 && receivedInvoices.length === 0 ? (
                            <div className="rounded-2xl border border-white/10 bg-[#111318] p-6 text-center space-y-2">
                              <div className="text-2xl">📄</div>
                              <div className="text-sm text-[#aaabb0]">
                                No invoices yet.
                              </div>
                              <div className="text-xs text-[#69daff]">
                                Try: &quot;create invoice for alice.arc 50 USDC for design work&quot;
                              </div>
                            </div>
                          ) : (
                            sentInvoices.map((inv: any) => (
                              <div
                                key={inv.id}
                                className="rounded-2xl border border-white/10 bg-[#111318] p-4"
                              >
                                <div className="flex justify-between items-start">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      {inv.invoice_number}
                                    </div>
                                    <div className="text-xs text-[#aaabb0] mt-0.5">
                                      To: {inv.vendor_name || inv.vendor_handle}
                                    </div>
                                    {inv.line_items?.[0] && (
                                      <div className="text-xs text-[#aaabb0]">
                                        {inv.line_items[0].description}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <div className="text-sm font-medium text-white">
                                      ${Number(inv.amount).toFixed(2)} USDC
                                    </div>
                                    <span
                                      className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
                                        inv.status === "paid"
                                          ? "text-green-400 bg-green-400/10"
                                          : inv.status === "pending"
                                            ? "text-yellow-400 bg-yellow-400/10"
                                            : "text-gray-400 bg-gray-400/10"
                                      }`}
                                    >
                                      {inv.status === "paid"
                                        ? "✅ Paid"
                                        : inv.status === "pending"
                                          ? "⏳ Pending"
                                          : inv.status}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center mt-3">
                                  <div className="text-xs text-[#aaabb0]">
                                    {formatServerDate(inv.created_at)}
                                  </div>
                                  {inv.arc_tx_id && (
                                    <a
                                      href={`https://testnet.arcscan.app/tx/${inv.arc_tx_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-[#69daff]"
                                    >
                                      Arcscan ↗
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    )}
                    <div className="rounded-2xl border border-[#69daff]/20 bg-[#111318] p-4 text-center">
                      <div className="text-xs text-[#aaabb0]">
                        Create invoices via chat:
                      </div>
                      <div className="text-xs text-[#69daff] mt-1 font-mono">
                        &quot;create invoice for alice.arc 50 USDC for design&quot;
                      </div>
                    </div>
                  </div>
                ) : null}

                {tab === "contacts" ? (
                  <div className="space-y-6">
                    <div className="text-sm text-[#d0c5af]/70">
                      Save names for people and businesses you pay often. Use them in chat or prefill Send.
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#111318] p-6 space-y-4">
                      <div className="text-xs font-medium text-[#aaabb0] uppercase tracking-wider">
                        Add contact
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] uppercase tracking-[0.18em] text-white/40 mb-1.5">
                            Name
                          </label>
                          <input
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                            placeholder="alice"
                            autoComplete="off"
                            className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#f2ca50]/50"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] uppercase tracking-[0.18em] text-white/40 mb-1.5">
                            Address (.arc or 0x)
                          </label>
                          <input
                            value={contactAddress}
                            onChange={(e) => setContactAddress(e.target.value)}
                            placeholder="vendor.arc or 0x…"
                            autoComplete="off"
                            className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono focus:outline-none focus:border-[#f2ca50]/50"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] uppercase tracking-[0.18em] text-white/40 mb-1.5">
                            Label (optional)
                          </label>
                          <input
                            value={contactLabel}
                            onChange={(e) => setContactLabel(e.target.value)}
                            placeholder="Freelance vendor"
                            autoComplete="off"
                            className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#f2ca50]/50"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] uppercase tracking-[0.18em] text-white/40 mb-1.5">
                            Notes (optional)
                          </label>
                          <textarea
                            value={contactNotes}
                            onChange={(e) => setContactNotes(e.target.value)}
                            placeholder="Invoice ref, Telegram, …"
                            rows={2}
                            className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#f2ca50]/50 resize-none"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleAddContact()}
                        disabled={addingContact || !contactName.trim() || !contactAddress.trim()}
                        className="burnished-gold btn-hover-effect px-6 py-2.5 rounded-xl text-sm font-semibold text-[#1a1200] disabled:opacity-50"
                      >
                        {addingContact ? "Saving…" : "Save contact"}
                      </button>
                    </div>
                    {contactsLoading ? (
                      <div className="text-sm text-[#aaabb0]">Loading contacts…</div>
                    ) : contacts.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-[#111318] p-8 text-center text-sm text-[#aaabb0]">
                        No saved contacts yet. Add one above or say in chat: &quot;save contact alice as vendor.arc&quot;.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-xs font-medium text-[#aaabb0] uppercase tracking-wider">
                          Your contacts
                        </div>
                        {contacts.map((c) => (
                          <div
                            key={c.id}
                            className="rounded-2xl border border-white/10 bg-[#111318] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="text-sm font-medium text-white">{c.name}</div>
                              <div className="text-xs font-mono text-[#aaabb0] break-all">
                                {c.address}
                              </div>
                              {c.label ? (
                                <div className="text-xs text-[#d0c5af]/80">{c.label}</div>
                              ) : null}
                              {c.notes ? (
                                <div className="text-[11px] text-white/40 line-clamp-2">{c.notes}</div>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => payFromContact(c.address)}
                                className="rounded-lg border border-[#f2ca50]/40 px-4 py-2 text-sm font-semibold text-[#f2ca50] hover:bg-[#f2ca50]/10 transition"
                              >
                                Pay
                              </button>
                              <button
                                type="button"
                                disabled={deletingContactId === c.id}
                                onClick={() => void handleDeleteContact(c.id)}
                                className="rounded-lg border border-[#ff716c]/40 px-4 py-2 text-sm font-semibold text-[#ff716c] disabled:opacity-50"
                              >
                                {deletingContactId === c.id ? "Removing…" : "Remove"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {tab === "batch" ? (
                  <div className="space-y-5">
                    <div className="text-sm text-[#d0c5af]/70">
                      Send USDC to multiple recipients at once. Upload a CSV or paste payment data below.
                    </div>

                    {/* CSV upload */}
                    <div className="rounded-2xl border border-white/10 bg-[#111318] p-4 space-y-3">
                      <div className="text-xs text-[#d0c5af] uppercase tracking-wide">Upload CSV</div>
                      <div
                        className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-[#f2ca50]/30 transition cursor-pointer"
                        onClick={() => batchFileInputRef.current?.click()}
                      >
                        <div className="text-2xl mb-2">📂</div>
                        <div className="text-sm text-[#d0c5af]/70">Drop CSV file or click to upload</div>
                        <div className="text-xs text-[#d0c5af]/40 mt-1">Format: address, amount, remark</div>
                        <input
                          ref={batchFileInputRef}
                          type="file"
                          accept=".csv,text/csv"
                          className="hidden"
                          onChange={handleCSVUpload}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={downloadTemplate}
                        className="text-xs text-[#f2ca50] hover:underline"
                      >
                        Download template CSV →
                      </button>
                    </div>

                    {/* Manual paste */}
                    <div className="rounded-2xl border border-white/10 bg-[#111318] p-4 space-y-3">
                      <div className="text-xs text-[#d0c5af] uppercase tracking-wide">Or paste CSV data</div>
                      <textarea
                        value={batchCSVText}
                        onChange={(e) => { setBatchCSVText(e.target.value); setBatchPreview(null); setBatchResult(null); setBatchError(null); }}
                        placeholder={"alice.arc,100,salary\nbob.arc,100,salary\ncharlie.arc,100,salary"}
                        rows={6}
                        className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono focus:outline-none focus:border-[#f2ca50]/50 resize-none"
                      />
                    </div>

                    {batchError ? (
                      <div className="rounded-xl border border-[#ff716c]/30 bg-[#9f0519]/10 px-4 py-3 text-sm text-[#ffa8a3] whitespace-pre-wrap">
                        {batchError}
                      </div>
                    ) : null}

                    {/* Preview button */}
                    {batchCSVText && !batchPreview && !batchResult ? (
                      <button
                        type="button"
                        onClick={() => void handleBatchPreview()}
                        disabled={batchLoading || !isAuthenticated}
                        className="burnished-gold btn-hover-effect w-full py-3 rounded-xl text-sm font-semibold text-[#1a1200] disabled:opacity-50"
                      >
                        {batchLoading ? "Validating…" : "Preview Batch Payment"}
                      </button>
                    ) : null}

                    {/* Preview results */}
                    {batchPreview ? (
                      <div className="rounded-2xl border border-white/10 bg-[#111318] p-4 space-y-3">
                        <div className="flex justify-between items-center">
                          <div className="text-sm font-medium text-white">Batch Preview</div>
                          <div className="text-sm text-[#f2ca50]">
                            Total: {Number(batchPreview.total).toFixed(2)} USDC
                          </div>
                        </div>
                        <div className="space-y-1 max-h-60 overflow-y-auto">
                          {batchPreview.payments?.map((p: any, i: number) => (
                            <div key={i} className="flex justify-between items-center py-1 border-b border-white/5 text-xs">
                              <div>
                                <div className="text-white">{p.displayName}</div>
                                {p.remark ? <div className="text-[#d0c5af]/60">{p.remark}</div> : null}
                              </div>
                              <div className="text-white ml-4 shrink-0">
                                {p.amount} USDC {p.resolved ? <span className="text-green-400">✓</span> : <span className="text-red-400">✗</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleBatchConfirm(batchPreview.confirmId)}
                          disabled={batchExecuting}
                          className="burnished-gold btn-hover-effect w-full py-3 rounded-xl text-sm font-semibold text-[#1a1200] disabled:opacity-50"
                        >
                          {batchExecuting
                            ? "Sending…"
                            : `Confirm & Send ${batchPreview.count} Payments`}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setBatchPreview(null); }}
                          className="w-full text-xs text-[#d0c5af]/50 hover:text-white/70 transition text-center"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}

                    {/* Batch receipt */}
                    {batchResult ? (
                      <div className="rounded-2xl border border-[#f2ca50]/20 bg-[#111318] p-4 space-y-3">
                        <div className="text-sm font-medium text-[#f2ca50]">✅ Batch Complete</div>
                        <div className="text-xs text-[#d0c5af]/70">
                          {batchResult.results?.filter((r: any) => r.status === "success").length ?? 0} sent ·{" "}
                          {batchResult.results?.filter((r: any) => r.status === "failed").length ?? 0} failed ·{" "}
                          {Number(batchResult.total).toFixed(2)} USDC total
                        </div>

                        {batchResult.results?.length ? (
                          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                            {batchResult.results.map((r: any, i: number) => (
                              <div
                                key={i}
                                className="flex items-center justify-between gap-2 border-b border-white/5 py-1.5 last:border-b-0"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs text-white truncate">
                                    {r.to}
                                    {r.remark ? (
                                      <span className="text-[#d0c5af]/60"> · {r.remark}</span>
                                    ) : null}
                                  </div>
                                  {r.status === "failed" && r.error ? (
                                    <div className="text-[11px] text-red-400 truncate">{r.error}</div>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs text-white tabular-nums">
                                    {Number(r.amount).toFixed(2)} USDC
                                  </span>
                                  {r.status === "success" && r.txHash ? (
                                    <a
                                      href={`https://testnet.arcscan.app/tx/${r.txHash}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[11px] text-[#f2ca50] hover:underline font-mono"
                                      title={r.txHash}
                                    >
                                      {r.txHash.slice(0, 6)}…{r.txHash.slice(-4)} ↗
                                    </a>
                                  ) : (
                                    <span className="text-[11px] text-red-400">failed</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="flex items-center gap-4">
                          <button
                            type="button"
                            onClick={downloadBatchReceipt}
                            className="text-xs text-[#f2ca50] hover:underline"
                          >
                            Download receipt CSV →
                          </button>
                          <button
                            type="button"
                            onClick={() => { setBatchResult(null); setBatchCSVText(""); setBatchError(null); }}
                            className="text-xs text-[#d0c5af]/60 hover:text-white/80 transition"
                          >
                            Start new batch
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Chat hint */}
                    <div className="rounded-2xl border border-[#f2ca50]/15 bg-[#111318] p-4 text-center">
                      <div className="text-xs text-[#d0c5af]/60">Or use chat:</div>
                      <div className="text-xs text-[#f2ca50] mt-1 font-mono">
                        batch pay{"\n"}alice.arc,100,salary{"\n"}bob.arc,100,salary
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </main>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-xl" onClick={() => { setConfirmOpen(false); setConfirmModalError(null); }} />
          <div className="relative bg-[#0a0a0a] border border-[#f2ca50]/20 w-full max-w-xl obsidian-shadow overflow-hidden">
            <div className="h-1 burnished-gold w-full opacity-80" />
            <div className="px-10 py-7 border-b border-[rgba(212,175,55,0.08)] flex justify-between items-center bg-[#161616]/30">
              <h3 className="font-headline text-2xl italic text-white/90">Payment Authorization</h3>
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setConfirmModalError(null); }}
                className="text-white/20 hover:text-red-500 transition-colors"
              >
                <span className="material-symbols-outlined icon-standard">close</span>
              </button>
            </div>
            <div className="p-10 space-y-10">
              <div className="text-center py-4">
                <p className="font-label text-[9px] uppercase tracking-[0.5em] text-white/30 mb-6">Ready to send</p>
                <h4 className="text-5xl font-headline italic text-[#f2ca50]" style={{ letterSpacing: "-0.02em" }}>
                  {amount || "0.00"} <span className="text-sm tracking-[0.4em] not-italic opacity-30 ml-2">USDC</span>
                </h4>
              </div>
              <div className="space-y-5 px-4">
                <div className="flex justify-between items-center pb-4 border-b border-[rgba(212,175,55,0.08)]">
                  <span className="font-label text-[9px] uppercase tracking-[0.3em] text-white/30">Recipient</span>
                  <span className="font-body text-[11px] text-white/80 tracking-[0.1em] uppercase">{toAddress ? shortenAddress(toAddress) : "—"}</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-[rgba(212,175,55,0.08)]">
                  <span className="font-label text-[9px] uppercase tracking-[0.3em] text-white/30">Protocol</span>
                  <span className="font-body text-[11px] text-white/80 tracking-[0.1em] uppercase">Arc Testnet</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-label text-[9px] uppercase tracking-[0.3em] text-white/30">Execution</span>
                  <span className="font-body text-[11px] text-[#f2ca50] tracking-[0.15em] uppercase italic">Immediate</span>
                </div>
              </div>
              {confirmModalError ? (
                <div className="rounded border border-[#ff716c]/30 bg-[#9f0519]/10 px-4 py-3 text-sm text-[#ffa8a3]">
                  {confirmModalError}
                </div>
              ) : null}
              <div className="flex flex-col gap-5 pt-4">
                <button
                  type="button"
                  disabled={sendBusy}
                  onClick={() => void runSend()}
                  className="burnished-gold w-full py-5 text-[#1a1500] font-label text-[11px] uppercase tracking-[0.5em] font-extrabold flex items-center justify-center gap-4 transition-all active:scale-[0.985] disabled:opacity-60"
                >
                  <span className="material-symbols-outlined icon-filled text-lg opacity-70">fingerprint</span>
                  {sendBusy ? "Confirming..." : "Confirm & Authorize"}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmOpen(false); setConfirmModalError(null); }}
                  className="w-full py-2 text-white/20 hover:text-red-500/60 transition-colors font-label text-[9px] uppercase tracking-[0.4em]"
                >
                  Cancel
                </button>
              </div>
              <div className="flex items-center justify-center gap-3 text-white/10 pt-4 border-t border-[rgba(212,175,55,0.08)]">
                <span className="material-symbols-outlined icon-standard text-sm">verified_user</span>
                <span className="text-[8px] font-label uppercase tracking-[0.4em]">Session verified</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {arcRegModal ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4">
          <div className="w-full max-w-md overflow-hidden border border-[#f2ca50]/20 bg-[#0a0a0a] obsidian-shadow">
            <div className="h-1 burnished-gold w-full opacity-80" />
            <div className="space-y-4 p-8">
            <h3 className="font-headline text-2xl italic text-white/90">Confirm Registration</h3>
            <p className="text-sm text-white/40">
              This name is soulbound to your wallet — it stays tied to the registering address and is not
              transferable.
            </p>
            <p className="mt-3 text-sm text-white/40">
              Register{" "}
              <span className="font-mono text-[#f2ca50]">
                {arcAvailCheck?.name ?? `${arcRegDraft.replace(/\.arc$/i, "").trim() || "name"}.arc`}
              </span>{" "}
              for {arcRegistrationFeePhrase}. Annual renewal uses the contract fee at renewal time.
            </p>
            {arcNameError ? (
              <div className="mt-3 rounded-lg border border-[#ff716c]/30 bg-[#9f0519]/10 px-3 py-2 text-sm text-[#ffa8a3]">
                {arcNameError}
              </div>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setArcRegModal(false);
                  setArcNameError(null);
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={arcRegBusy}
                onClick={() => void runArcRegister()}
                className="burnished-gold rounded-xl px-4 py-2 text-sm font-bold uppercase tracking-[0.14em] disabled:opacity-60"
              >
                {arcRegBusy ? "Submitting…" : "Confirm"}
              </button>
            </div>
          </div>
          </div>
        </div>
      ) : null}

      {scanOpen ? (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 p-4">
          <video ref={videoRef} className="max-h-[50vh] w-full max-w-md rounded-xl bg-black" muted playsInline />
          <button
            type="button"
            onClick={() => stopScanner()}
            className="mt-4 rounded-xl border border-white/20 px-4 py-2 text-sm"
          >
            Close camera
          </button>
        </div>
      ) : null}
    </div>
  );
}
