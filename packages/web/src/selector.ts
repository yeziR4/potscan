import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** The 4-byte function selector for a canonical signature such as "transfer(address,uint256)". */
export const selectorOf = (signature: string) => `0x${bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, 8)}`;
