import _ from "lodash";
import { createHook, createSelector, createStore, StoreActionApi } from "react-sweet-state";
import { PositionArgs, PositionV1 } from "../positionsv1/base/PositionV1";
import { PositionFactory } from "../positionsv1/base/PositionFactory";
import { registerAllPositions } from "../positionsv1";
import { BN, Token, zero } from "@defi.org/web3-candies";
import { currentNetwork } from "../positionsv1/base/consts";

registerAllPositions();

const STORAGE_KEY = "PositionArgs:v1";
export const loadPositionsFromStorage = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, PositionArgs>;
export const savePositionsToStorage = (data: Record<string, PositionArgs>) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

const AllPositionsState = createStore({
  name: "AllPositionsState",

  initialState: {
    positions: {} as Record<string, PositionV1>,
  },

  actions: {
    load: () => async (api) => {
      await load(api);
    },

    addPosition: (type: string, address: string, input: string, name: string) => async (api) => {
      const position = PositionFactory.create({ type, address, input, name, id: "" });
      if (!position) {
        alert(`unknown type ${type} at ${address}`);
        return;
      }

      const data = _.mapValues(api.getState().positions, (p) => p.getArgs());
      data[position.getArgs().id] = position.getArgs();
      savePositionsToStorage(data);
      await load(api);
    },

    update: (position: PositionV1, newArgs: PositionArgs) => async (api) => {
      const data = _.mapValues(api.getState().positions, (p) => p.getArgs());
      data[position.getArgs().id] = newArgs;
      savePositionsToStorage(data);
      await load(api);
    },

    delete: (posId: string) => async (api) => {
      const data = _.mapValues(api.getState().positions, (p) => p.getArgs());
      delete data[posId];
      savePositionsToStorage(data);
      await load(api);
    },

    sendTransaction:
      (posId: string, useLegacyTx: boolean, method: string, args: string[]) =>
      async ({ getState }) => {
        await getState().positions[posId].sendTransaction(method, args, useLegacyTx);
      },

    harvest:
      (posId: string, useLegacyTx: boolean) =>
      async ({ getState }) => {
        await getState().positions[posId].harvest(useLegacyTx);
      },
  },
});

async function load(api: StoreActionApi<typeof AllPositionsState.initialState>) {
  console.log("LOAD positions...");
  const current = api.getState().positions;
  const positions = _.mapValues(loadPositionsFromStorage(), (args) => current[args.id] || PositionFactory.create(args));

  for (const id in positions) if (!positions[id]) delete positions[id];

  await PositionFactory.oracle.warmup(_.values(positions));

  const network = await currentNetwork();

  await Promise.all(
    _.map(positions, (p) => {
      if (!p || !network || !PositionFactory.shouldLoad(p, network)) return;
      return p
        .load()
        .then(() => ((p as any).loaded = true))
        .catch((e) => {
          (p as any).loaded = false;
          console.log(p.getArgs().type, e);
        });
    })
  );
  api.setState({ positions });
  console.log(`...done loading ${network?.name}`);
}

export const useAllPositionsActions = createHook(AllPositionsState, { selector: null });

export const useAllPositionRows = createHook(AllPositionsState, {
  selector: createSelector(
    (state) =>
      _(state.positions)
        .values()
        .sortBy((p) => p.getArgs().type)
        .value(),
    (positions) =>
      _.map(positions, (p) => ({
        id: p.getArgs().id,
        type: p.getArgs().type,
        name: p.getArgs().name || p.getName() || p.getArgs().type,
        chain: p.getNetwork().name,
        health: p.getHealth(),
        marketValue: num(marketValue(p)),
        pending: num(p.getPendingRewards().reduce((sum, v) => sum.plus(v.value), zero)),
        tvl: num(p.getTVL()),
        position: p,
        address: p.getArgs().address,
        loaded: !!(p as any).loaded,
      }))
  ),
});
export const useAllPositions = createHook(AllPositionsState, {
  selector: (state) => state.positions,
});

export const useAllPositionsValuePerPosition = createHook(AllPositionsState, {
  selector: createSelector(
    (state) => _.map(state.positions, (position) => ({ position, marketValue: Math.round(num(marketValue(position))) })),
    (rows) => {
      const sorted = _.sortBy(rows, (r) => -r.marketValue);
      return {
        labels: sorted.map((p) => p.position.getArgs().name || p.position.getName() || p.position.getArgs().type),
        values: sorted.map((p) => p.marketValue),
      };
    }
  ),
});

export const useAllPositionsValuePerAssetClass = createHook(AllPositionsState, {
  selector: createSelector(
    (state) =>
      _(state.positions)
        .map((position) => position.getAmounts())
        .flatten()
        .value(),
    (amounts) => {
      const reduced = _(amounts)
        .groupBy((a) => assetClass(a.asset))
        .map((values, key) => ({ assetClass: key, value: _.reduce(values, (sum, a) => sum + num(a.value), 0) }))
        .sortBy((v) => -v.value)
        .value();
      return {
        labels: _.map(reduced, (ac) => ac.assetClass),
        values: _.map(reduced, (ac) => Math.round(ac.value)),
      };
    }
  ),
});

export const useAllPositionsValuePerChain = createHook(AllPositionsState, {
  selector: createSelector(
    (state) => _.groupBy(state.positions, (p) => p.getNetwork().name),
    (grouped) => {
      const totalPerChain = _(grouped)
        .map((positions, chain) => ({
          chain,
          marketValue: Math.round(num(totalMarketValue(positions))),
        }))
        .sortBy((t) => -t.marketValue)
        .value();
      return {
        labels: _.map(totalPerChain, (t) => t.chain),
        values: _.map(totalPerChain, (t) => t.marketValue),
        grandtotal: _.reduce(totalPerChain, (sum, t) => sum + t.marketValue, 0),
      };
    }
  ),
});

function num(bn: BN) {
  return bn.times(1000).idiv(1000).toNumber();
}

function marketValue(p: PositionV1) {
  return _.reduce(p.getAmounts(), (sum, v) => sum.plus(v.value), zero);
}

function totalMarketValue(positions: PositionV1[]) {
  return _.reduce(positions, (sum, pos) => sum.plus(marketValue(pos)), zero);
}

function assetClass(a: Token): string {
  const ext = (a as any).symbol || (a as any).tokenId;
  if (ext) return ext;
  if (a.name.toLowerCase().includes("usd") || ["dai", "mai", "mim"].includes(a.name.toLowerCase())) return "USD";
  if (a.name.toLowerCase().includes("btc")) return "BTC";
  if (a.name.toLowerCase().includes("eth")) return "ETH";
  if (a.name.toLowerCase().includes("bnb")) return "BNB";
  if (a.name.toLowerCase().includes("avax")) return "AVAX";
  if (a.name.toLowerCase().includes("matic")) return "MATIC";
  if (a.name.toLowerCase().includes("ftm")) return "FTM";
  if ((a as any).bech32) return "BTC";
  return a.name || a.address;
}
