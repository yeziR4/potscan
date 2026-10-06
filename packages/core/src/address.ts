import { u8aConcat, u8aEq, u8aToHex } from "@polkadot/util";
import { decodeAddress, encodeAddress, ethereumEncode, isEthereumAddress, keccakAsU8a } from "@polkadot/util-crypto";

// pallet-revive's AccountId32Mapper: an H160 that was never mapped explicitly owns the account
// made of its 20 bytes followed by 12 bytes of 0xEE, and an account built that way maps back to those 20 bytes.
const ETH_SUFFIX = new Uint8Array(12).fill(0xee);

export type MappedAddress = {
  evm: string;
  accountId: `0x${string}`;
  ss58: string;
  /** True when the account was derived from an Ethereum key rather than a native Substrate key. */
  ethDerived: boolean;
};

export const isEthDerived = (accountId: Uint8Array): boolean =>
  accountId.length === 32 && u8aEq(accountId.subarray(20), ETH_SUFFIX);

export function fromEvm(h160: string, ss58Format: number): MappedAddress {
  if (!isEthereumAddress(h160)) throw new Error(`Not an EVM address: ${h160}`);
  const accountId = u8aConcat(decodeHex(h160), ETH_SUFFIX);
  return { evm: ethereumEncode(h160), accountId: u8aToHex(accountId), ss58: encodeAddress(accountId, ss58Format), ethDerived: true };
}

/** Accepts an SS58 address or a 32-byte hex account id. */
export function fromSubstrate(address: string, ss58Format: number): MappedAddress {
  const accountId = decodeAddress(address);
  const ethDerived = isEthDerived(accountId);
  const evmBytes = ethDerived ? accountId.subarray(0, 20) : keccakAsU8a(accountId, 256).subarray(12);
  return { evm: ethereumEncode(evmBytes), accountId: u8aToHex(accountId), ss58: encodeAddress(accountId, ss58Format), ethDerived };
}

/** Maps whatever the user pasted: an EVM address, an SS58 address, or a 32-byte account id. */
export function mapAddress(input: string, ss58Format: number): MappedAddress {
  const value = input.trim();
  return isEthereumAddress(value) ? fromEvm(value, ss58Format) : fromSubstrate(value, ss58Format);
}

const decodeHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));
