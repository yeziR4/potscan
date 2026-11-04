/**
 * solc appends a CBOR map to runtime bytecode, followed by its length in two bytes:
 *   ... code ... | a2 64 'ipfs' 58 22 <34 bytes> 64 'solc' 43 <3 bytes> | 00 33
 * It names the compiler release that built the code, and hashes the metadata (sources, settings), so two builds
 * with different comments differ only here.
 */

export type CodeKind = "polkavm" | "evm";

export type EvmMetadata = {
  /** "0.8.24" for releases; undefined for nightlies, which encode a string instead. */
  solc?: string;
  /** Bytes the CBOR section and its length suffix occupy at the end of the code. */
  length: number;
};

const PVM_MAGIC = "50564d00"; // "PVM\0"

export function codeKind(code: string): CodeKind | undefined {
  const hex = code.replace(/^0x/, "").toLowerCase();
  if (hex.length === 0) return undefined;
  return hex.startsWith(PVM_MAGIC) ? "polkavm" : "evm";
}

/** Reads solc's metadata trailer, or returns undefined when the code has none (other compilers, metadata disabled). */
export function readMetadata(code: string): EvmMetadata | undefined {
  const bytes = Buffer.from(code.replace(/^0x/, ""), "hex");
  if (bytes.length < 4) return undefined;
  const cborLength = bytes.readUInt16BE(bytes.length - 2);
  const start = bytes.length - 2 - cborLength;
  if (cborLength === 0 || start < 0) return undefined;
  const map = decodeCborMap(bytes.subarray(start, bytes.length - 2));
  if (!map) return undefined;
  const solc = map.get("solc");
  return {
    solc: solc instanceof Uint8Array && solc.length === 3 ? `${solc[0]}.${solc[1]}.${solc[2]}` : undefined,
    length: cborLength + 2,
  };
}

/** The code without its metadata trailer, for comparing builds whose sources differ only in comments or paths. */
export function stripMetadata(code: string): string {
  const meta = readMetadata(code);
  const hex = code.replace(/^0x/, "");
  return `0x${meta ? hex.slice(0, hex.length - meta.length * 2) : hex}`;
}

/**
 * Just enough CBOR for solc's trailer: one map with text keys and byte-string, text or boolean values.
 * Anything else means this is not a solc trailer, and decoding gives up.
 */
function decodeCborMap(buf: Uint8Array): Map<string, Uint8Array | string | boolean> | undefined {
  let pos = 0;
  const head = () => {
    const byte = buf[pos++];
    if (byte === undefined) throw new Error("truncated");
    const major = byte >> 5;
    const info = byte & 0x1f;
    let value = info;
    if (info === 24) value = buf[pos++]!;
    else if (info === 25) {
      value = (buf[pos]! << 8) | buf[pos + 1]!;
      pos += 2;
    } else if (info > 25) throw new Error("unsupported length");
    return { major, info, value };
  };
  try {
    const top = head();
    if (top.major !== 5) return undefined;
    const map = new Map<string, Uint8Array | string | boolean>();
    for (let i = 0; i < top.value; i++) {
      const key = head();
      if (key.major !== 3) return undefined;
      const name = Buffer.from(buf.subarray(pos, pos + key.value)).toString("utf8");
      pos += key.value;
      const val = head();
      if (val.major === 2 || val.major === 3) {
        const raw = buf.subarray(pos, pos + val.value);
        pos += val.value;
        map.set(name, val.major === 2 ? raw : Buffer.from(raw).toString("utf8"));
      } else if (val.major === 7 && (val.info === 20 || val.info === 21)) {
        map.set(name, val.info === 21);
      } else return undefined;
    }
    return pos === buf.length ? map : undefined;
  } catch {
    return undefined;
  }
}
