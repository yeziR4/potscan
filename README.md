# PotScan

Explorer and developer portal for **Portaldot V3**, covering both of its contract engines: Solidity (pallet-revive) and ink! (pallet-contracts).

Built for the [Portaldot Hacker House 2026](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail), Node Operations & Tooling track.

## Why

On the V3 testnet today:

- There is no explorer for the Solidity side; the official guide leaves the MetaMask explorer field empty.
- To fund a MetaMask address you must look up its mapped Substrate address through a developer runtime call.
- When the RPC is down, nothing tells you whether it is your setup or the network.

## Status

Early development.

| Piece | State |
| --- | --- |
| Address mapper (EVM ↔ Substrate) | Done, tested against addresses published for the V3 testnet |
| Network status, checked every minute, 24 h history | Done |
| Indexer: blocks, extrinsics, events, Solidity transactions, contract deployments (Revive and ink!) | Done |
| Explorer pages and search | Done |
| Contract verification (Solidity to PolkaVM with resolc), attested on chain | Done |

## State of Portaldot V3

PotScan's home page is a live research report computed from its own index of every V3 block since genesis, refreshed every five minutes (raw data: `/api/insights`). It answers four questions, each with evidence linked into the explorer:

1. **Is the network healthy?** Block times against the 6 s slot, stalls, and the validator set from the runtime.
2. **Who is building?** Accounts, transactions by engine (Solidity, ink!, native), deployments, most-called contracts.
3. **Why do transactions fail?** Revert rate, native dispatch errors, and Solidity reverts that still show success on the Substrate side.
4. **What does it cost?** A deploy-cost estimator built from the runtime's own deposit settings, checked against a real deployment.

Findings on the V3 testnet as of 4 November 2026: two validators produce every block, so both must be online for GRANDPA to finalize; the chain stopped for 13 h 24 m before block 232,116 on 29 October; every reverted Solidity transaction also appears as a successful `revive.ethTransact` extrinsic.

## Verification

pallet-revive runs two kinds of code, and PotScan verifies both. It reads the deployed code first and picks the compiler it calls for:

- **EVM bytecode (solc).** 97% of contracts on V3. The solc release is read from the metadata solc appends to the bytecode, and that exact release is downloaded from `binaries.soliditylang.org`, checked against its published SHA-256, cached, and run in a worker. Immutables are masked before comparing. An **exact** match includes solc's metadata hash, which fingerprints the source files; a **bytecode** match means identical code with different metadata, as when comments or paths differ.
- **PolkaVM (resolc).** Compiled with Parity's `resolc`. PolkaVM code carries no fingerprint of the source text, so every match is a bytecode match.

Verification is stored by code hash, so it covers every contract running the same code, and an exact match is never replaced by a weaker one.

Imports are never read from the server: only the submitted files are compiled. (`@parity/resolc`'s `compile()` helper resolves imports from disk, which is why PotScan calls the compiler directly.)

Matches are then recorded in `VerificationRegistry` (`packages/contracts`), bound to the code hash the contract reads on chain, so an attestation stops counting if the target's code changes. Anyone can attest; readers choose whose attestations to trust with `isVerified(attester, target)`.

| Network | VerificationRegistry | Deployed in | PotScan attester |
| --- | --- | --- | --- |
| Polkadot Hub TestNet | `0xf869d5EB8103490260Dd9D765663C6608b96Fb8A` | `0xdf9169c5d86ce1d96ebcd69381fb6db5fac04e5d5cd0d643d08b8e200cd15a77` | `0xF636741Fa260225B51cDD69f8f2052CcD85755F0` |
| Portaldot V3 Testnet | `0xf869d5EB8103490260Dd9D765663C6608b96Fb8A` | `0xc2ac7d7c990de9fd6748cc93de6ec5b85804e4a399b2e3a9165da9162e8943a7` (block 303,856) | `0xF636741Fa260225B51cDD69f8f2052CcD85755F0` |

On both networks the registry verified its own source through PotScan and recorded it on chain:

- Portaldot V3: attestation `0x29247ea2bc06c9efe0af73da05ecd1cc0d893f5a3a9065e575792fa6ffd3c781` (block 306,083)
- Polkadot Hub TestNet: attestation `0x4110886fa07b00b6adc48568972f2528f7f3fffd7739c69119e58b377f566423`

Deploying on V3 reserves a storage deposit set by the runtime: 0.06 tPOT per byte (`revive.depositPerByte`), plus a 30 % code-hash lockup (`codeHashLockupDepositPercent`). For the 23,899-byte registry that is about 1,864 tPOT, held rather than spent, so a deployer needs roughly 1,910 tPOT available.

Each Solidity transaction is linked to the Substrate extrinsic that carried it: pallet-revive keeps the Ethereum block number equal to the Substrate one, and the transaction index equal to the extrinsic index. The transaction page therefore shows both the Ethereum receipt and the native fee and balance events.

Extrinsics that polkadot.js cannot decode, such as ones with a chain-specific signed extension, are stored as `unknown.undecodable` with their hash, and their outcome and fee still come from their events. Indexing never stops on them.

While the Portaldot testnet is unavailable, PotScan also tracks Polkadot Hub TestNet, which runs the same pallet-revive stack.

## Develop

Requires Node ≥ 22.13.

```bash
npm install
npm run dev      # API on :8787, UI on http://localhost:5173
npm test
```

Production: `npm run build && npm start` serves the UI and API from one process on `PORT` (default 8787). Probe history is kept in SQLite at `POTSCAN_DB` (default `data/potscan.db`).

## Deploy on Railway

The repository includes a `Dockerfile` and `railway.json`.

1. New project → Deploy from GitHub repo → `potscan`.
2. Add a volume mounted at `/data` (the index and status history live there).
3. Variables:
   - `POTSCAN_PUBLIC_URL`: the public URL Railway gives the service, used in on-chain attestation links.
   - `POTSCAN_KEY` (optional): a funded testnet key that records verifications in the registry. Without it, verification still works, off chain only.
4. Settings → Networking → Generate domain.

A fresh deployment indexes Portaldot V3 from genesis, which takes a few hours. The explorer is usable meanwhile, and the Status page shows progress.

## Layout

| Package | What it holds |
| --- | --- |
| `packages/core` | Network list, address mapping, endpoint probes; no I/O beyond the probes |
| `packages/server` | Probe scheduler, SQLite history, JSON API, static hosting for the UI |
| `packages/web` | React UI |

The Portaldot logo and colours belong to the Portaldot project and are used to mark PotScan as a Portaldot tool. PotScan itself is independent and MIT licensed.

MIT
