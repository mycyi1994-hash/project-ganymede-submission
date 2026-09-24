"use client";

import { useEffect, useId, useState } from "react";
import { DEFAULT_SETTLEMENT_CHAIN } from "@/lib/chains";

type EthereumProvider = {
  request: (request: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    okxwallet?: EthereumProvider;
  }
}

/** OKX Wallet first — it is the native wallet for X Layer — then any injected EIP-1193 wallet. */
function injectedProvider(): EthereumProvider | undefined {
  return window.okxwallet ?? window.ethereum;
}

/** EIP-3085 parameters for wallet_addEthereumChain. */
export const WALLET_CHAIN = {
  chainId: `0x${DEFAULT_SETTLEMENT_CHAIN.chainId.toString(16)}`,
  chainName: DEFAULT_SETTLEMENT_CHAIN.name,
  rpcUrls: [DEFAULT_SETTLEMENT_CHAIN.rpcUrl],
  nativeCurrency: DEFAULT_SETTLEMENT_CHAIN.nativeCurrency,
  blockExplorerUrls: [DEFAULT_SETTLEMENT_CHAIN.explorerUrl],
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletConnect({ compact = false }: { compact?: boolean }) {
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState("");
  const [status, setStatus] = useState("Connect wallet");
  const [error, setError] = useState("");
  const [missingWallet, setMissingWallet] = useState(false);
  const errorId = useId();
  const statusId = useId();

  const onCorrectChain = chainId.toLowerCase() === WALLET_CHAIN.chainId.toLowerCase();

  useEffect(() => {
    const provider = injectedProvider();
    if (!provider) return;

    const syncWallet = async () => {
      try {
        const [accounts, currentChain] = await Promise.all([
          provider.request({ method: "eth_accounts" }) as Promise<string[]>,
          provider.request({ method: "eth_chainId" }) as Promise<string>,
        ]);
        setAddress(accounts[0] ?? "");
        setChainId(currentChain);
      } catch {
        setError("Wallet status could not be read.");
      }
    };

    const handleAccounts = (...args: unknown[]) => setAddress(((args[0] as string[]) ?? [])[0] ?? "");
    const handleChain = (...args: unknown[]) => setChainId(String(args[0] ?? ""));
    provider.on?.("accountsChanged", handleAccounts);
    provider.on?.("chainChanged", handleChain);
    syncWallet();

    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  const ensureSettlementChain = async (provider: EthereumProvider) => {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: WALLET_CHAIN.chainId }],
      });
    } catch (switchError) {
      const code = (switchError as { code?: number }).code;
      if (code !== 4902) throw switchError;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [WALLET_CHAIN],
      });
    }
    setChainId(WALLET_CHAIN.chainId);
  };

  const connect = async () => {
    const provider = injectedProvider();
    setError("");
    setMissingWallet(false);

    if (!provider) {
      setMissingWallet(true);
      setError("No browser wallet found. You can continue without a wallet.");
      return;
    }

    setStatus("Connecting…");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      setAddress(accounts[0] ?? "");
      const currentChain = await provider.request({ method: "eth_chainId" }) as string;
      if (currentChain.toLowerCase() !== WALLET_CHAIN.chainId.toLowerCase()) await ensureSettlementChain(provider);
      else setChainId(currentChain);
      setStatus("Connected");
    } catch (walletError) {
      const code = (walletError as { code?: number }).code;
      setError(code === 4001 ? "Connection request was cancelled." : `Could not connect to ${DEFAULT_SETTLEMENT_CHAIN.name}. Please try again.`);
      setStatus("Connect wallet");
    }
  };

  return (
    <div className={`wallet-connect${compact ? " is-compact" : ""}`} onKeyDown={(event) => { if (event.key === "Escape" && error) { setError(""); event.currentTarget.querySelector("button")?.focus(); } }}>
      <button
        type="button"
        className={address && onCorrectChain ? "is-connected" : ""}
        onClick={connect}
        aria-describedby={`${statusId}${error ? ` ${errorId}` : ""}`}
        aria-label={address && onCorrectChain ? `${shortAddress(address)}, connected to ${DEFAULT_SETTLEMENT_CHAIN.name}` : address ? `Switch wallet to ${DEFAULT_SETTLEMENT_CHAIN.name}` : "Connect optional test wallet"}
        disabled={status === "Connecting…"}
      >
        <span className="wallet-network-dot" />
        {address && onCorrectChain ? shortAddress(address) : address ? "Switch network" : compact && status === "Connect wallet" ? "Optional wallet" : status}
      </button>
      {!compact && <span id={statusId} className="wallet-chain-label" aria-live="polite">OPTIONAL TEST WALLET · {DEFAULT_SETTLEMENT_CHAIN.label} {DEFAULT_SETTLEMENT_CHAIN.chainId}</span>}
      {compact && <span id={statusId} className="sr-only" aria-live="polite">Optional {DEFAULT_SETTLEMENT_CHAIN.name} test wallet</span>}
      {error && <small id={errorId} role="alert">{error}<button type="button" className="wallet-dismiss" aria-label="Dismiss wallet message" onClick={(event) => { setError(""); event.currentTarget.closest(".wallet-connect")?.querySelector<HTMLButtonElement>("button")?.focus(); }}>×</button>{missingWallet && <> <a href="https://web3.okx.com/download" target="_blank" rel="noreferrer">Install OKX Wallet ↗</a></>}</small>}
    </div>
  );
}
