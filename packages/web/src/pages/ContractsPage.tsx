import { withNetwork, type Contract, type Network } from "../api.ts";
import { blockNumber } from "../format.ts";
import { Link } from "../router.tsx";
import { useApi } from "../useApi.ts";
import { Empty, Engine, Hash, PageHead } from "../ui.tsx";

export function ContractsPage({ network }: { network: Network }) {
  const { data, error } = useApi<Contract[]>(withNetwork("/api/contracts?limit=100", network.id), 15_000);
  return (
    <>
      <PageHead
        title="Contracts"
        lede={`Contracts deployed on ${network.name} since PotScan started indexing it: Solidity through pallet-revive and ink! through pallet-contracts, side by side.`}
      />
      {error && !data && <p className="panel error-text pad">{error}</p>}
      <section className="panel">
        {!data || data.length === 0 ? (
          <Empty>No deployments indexed yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Engine</th>
                <th>Deployer</th>
                <th className="right">Deployed</th>
              </tr>
            </thead>
            <tbody>
              {data.map(c => (
                <tr key={c.address}>
                  <td>
                    <Hash value={c.address} to={`/account/${c.address}`} />
                  </td>
                  <td>
                    <Engine vm={c.vm} />
                  </td>
                  <td>
                    <Hash value={c.deployer} to={`/account/${c.deployer}`} />
                  </td>
                  <td className="right">
                    <Link to={`/extrinsic/${c.block}-${c.extrinsic}`}>
                      <span className="num">{blockNumber(c.block)}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
