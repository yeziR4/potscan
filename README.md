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
| Contract verification | Planned |

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

## Layout

| Package | What it holds |
| --- | --- |
| `packages/core` | Network list, address mapping, endpoint probes; no I/O beyond the probes |
| `packages/server` | Probe scheduler, SQLite history, JSON API, static hosting for the UI |
| `packages/web` | React UI |

The Portaldot logo and colours belong to the Portaldot project and are used to mark PotScan as a Portaldot tool. PotScan itself is independent and MIT licensed.

MIT
