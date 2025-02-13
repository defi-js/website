import { createHook, createSelector, createStore } from "react-sweet-state";
import { PositionV1 } from "../positionsv1/base/PositionV1";
import _ from "lodash";
import { BN } from "@defi.org/web3-candies";

const PositionDialogState = createStore({
  name: "PositionDialogState",

  initialState: {
    position: null as PositionV1 | null,
    useLegacy: false,
    selectedMethod: "",
    selectedMethodArgs: {},
  },

  actions: {
    showPosition:
      (position: PositionV1) =>
      async ({ setState, getState }) => {
        if (getState().position !== position) {
          setState({ position, selectedMethod: "", selectedMethodArgs: {}, useLegacy: false });
        }
      },

    closeDialog:
      () =>
      async ({ setState }) => {
        setState({ position: null });
      },

    selectMethod:
      (method: string) =>
      async ({ setState }) => {
        setState({ selectedMethod: method, selectedMethodArgs: {} });
      },

    setMethodArg:
      (index: number, arg: string) =>
      async ({ setState, getState }) => {
        setState({ selectedMethodArgs: { ...getState().selectedMethodArgs, [index]: arg } });
      },

    setUseLegacy:
      (useLegacy: boolean) =>
      async ({ setState }) => {
        setState({ useLegacy });
      },

    harvest:
      () =>
      async ({ getState }) => {
        await getState().position!.harvest(getState().useLegacy);
      },

    send:
      () =>
      async ({ getState }) => {
        await getState().position!.sendTransaction(getState().selectedMethod, _.values(getState().selectedMethodArgs), getState().useLegacy);
      },

    call:
      (showAlert: (a: string) => void) =>
      async ({ getState }) => {
        try {
          const result = await getState().position!.callContract(getState().selectedMethod, _.values(getState().selectedMethodArgs));
          showAlert(_.toString(result) || "undefined");
        } catch (e: any) {
          showAlert(_.toString(e));
        }
      },
  },
});

export const usePositionDialogActions = createHook(PositionDialogState, { selector: null });
export const usePositionDialogSelector = createHook(PositionDialogState, {
  selector: createSelector(
    (state) => state,
    (state) => state.position?.getContractMethods().filter((m) => !m.startsWith("0x") && m.endsWith(")")) || [],
    (state) =>
      state.selectedMethod
        .substring(state.selectedMethod.indexOf("(") + 1, state.selectedMethod.length - 1)
        .split(",")
        .filter((a) => a.length > 0),
    (state) =>
      _(state.position?.getAssets())
        .mapKeys((a) => a.name)
        .mapValues((v) => v.address)
        .value(),
    (state) =>
      _(state.position?.getRewardAssets())
        .mapKeys((a) => a.name)
        .mapValues((v) => v.address)
        .value(),
    (state) => _.mapValues(state.position?.getData(), fmtData),
    (state, positionMethods, selectedMethodArgTypes, assets, rewardAssets, data) => ({
      position: state.position,
      positionMethods,
      selectedMethod: state.selectedMethod,
      selectedMethodArgTypes,
      useLegacy: state.useLegacy,
      rawData: JSON.stringify({ assets, rewardAssets, data }, null, 4),
    })
  ),
});

function fmtData(data: any): any {
  if (_.isArray(data)) return _.map(data, fmtData);
  return data instanceof BN ? data.toFormat(3) : data;
}
