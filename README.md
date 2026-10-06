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
| Network status probes | In progress |
| Block and contract indexer | Planned |
| Contract verification | Planned |

## Develop

Requires Node ≥ 22.13.

```bash
npm install
npm test
```

MIT
