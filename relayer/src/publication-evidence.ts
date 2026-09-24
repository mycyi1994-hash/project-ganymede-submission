import { encodeAbiParameters, keccak256, type Hex } from "viem";

/** Matches GanymedeNavRegistry's exact abi.encode tuple, not only its timestamp. */
export function navPayloadHash(args: readonly unknown[]): Hex {
  const [productId, nav, shares, holdingsHash, effectiveAt] = args as [Hex, bigint, bigint, Hex, bigint];
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint64" },
  ], [productId, nav, shares, holdingsHash, effectiveAt]));
}

/** A rejected task must not poison later submissions. Serializes external awaits too. */
export class SubmissionQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
