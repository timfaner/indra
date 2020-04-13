import { Address, BigNumber, Bytes32, SolidityValueType, Xpub } from "./basic";
import { AppState } from "./contracts";

import { AppABIEncodings, AppInstanceJson, AppInstanceProposal } from "./app";
import { OutcomeType } from "./contracts";
import { PublicParams, PublicResults } from "./public";
import { StateChannelJSON } from "./state";
import { MinimalTransaction } from "./commitments";
import { enumify } from "./utils";

////////////////////////////////////////

type CreateChannelParams = {
  owners: Xpub[];
};

type CreateChannelResult = {
  multisigAddress: Address;
  owners?: Xpub[];
  counterpartyXpub?: Xpub;
};

////////////////////////////////////////

type DepositParams = PublicParams.Deposit;

type DepositResult = PublicResults.Deposit;

////////////////////////////////////////

type DeployStateDepositHolderParams = {
  multisigAddress: Address;
  retryCount?: number;
};

type DeployStateDepositHolderResult = {
  transactionHash: Bytes32;
};

////////////////////////////////////////

type GetChannelAddressesParams = {};

type GetChannelAddressesResult = {
  multisigAddresses: Address[];
};

////////////////////////////////////////

type GetAppInstanceDetailsParams = {
  appIdentityHash: Bytes32;
};

type GetAppInstanceDetailsResult = {
  appInstance: AppInstanceJson;
};

////////////////////////////////////////

type GetAppInstancesParams = {
  multisigAddress: Address;
};

type GetAppInstancesResult = {
  appInstances: AppInstanceJson[];
};

////////////////////////////////////////

type GetStateDepositHolderAddressParams = {
  owners: Address[]; // [initiator, responder]
};

type GetStateDepositHolderAddressResult = {
  address: Address;
};

////////////////////////////////////////

type GetFreeBalanceStateParams = {
  multisigAddress: Address;
  tokenAddress?: Address;
};

type GetFreeBalanceStateResult = {
  [s: string]: BigNumber;
};

////////////////////////////////////////

type GetTokenIndexedFreeBalanceStatesParams = {
  multisigAddress: Address;
};

type GetTokenIndexedFreeBalanceStatesResult = {
  [tokenAddress: string]: {
    [s: string]: BigNumber;
  };
};

////////////////////////////////////////

type GetProposedAppInstanceParams = {
  appIdentityHash: Bytes32;
};

type GetProposedAppInstanceResult = {
  appInstance: AppInstanceProposal;
};

////////////////////////////////////////

type GetProposedAppInstancesParams = {
  multisigAddress: Address;
};

type GetProposedAppInstancesResult = {
  appInstances: AppInstanceProposal[];
};

////////////////////////////////////////

type GetStateChannelParams = {
  multisigAddress: Address;
};

type GetStateChannelResult = {
  data: StateChannelJSON;
};

////////////////////////////////////////

type InstallParams = {
  appIdentityHash: Bytes32;
};

type InstallResult = {
  appInstance: AppInstanceJson;
};

////////////////////////////////////////

type RequestDepositRightsParams = {
  assetId?: Address;
};

type RequestDepositRightsResult = {
  appIdentityHash: Bytes32;
  multisigAddress: Address;
};

////////////////////////////////////////

type ProposeInstallParams = {
  abiEncodings: AppABIEncodings;
  appDefinition: Address;
  defaultTimeout: BigNumber;
  initialState: AppState;
  initiatorDeposit: BigNumber;
  initiatorDepositTokenAddress: Address;
  meta?: Object;
  outcomeType: OutcomeType;
  proposedToIdentifier: Xpub;
  responderDeposit: BigNumber;
  responderDepositTokenAddress: Address;
  stateTimeout?: BigNumber;
};

type ProposeInstallResult = {
  appIdentityHash: Bytes32;
};

////////////////////////////////////////

type RejectInstallParams = {
  appIdentityHash: Bytes32;
};

type RejectInstallResult = {};

////////////////////////////////////////

type UpdateStateParams = {
  appIdentityHash: Bytes32;
  newState: SolidityValueType;
  stateTimeout?: BigNumber;
};

type UpdateStateResult = {
  newState: SolidityValueType;
};

////////////////////////////////////////

type TakeActionParams = {
  appIdentityHash: Bytes32;
  action: SolidityValueType;
  stateTimeout?: BigNumber;
};

type TakeActionResult = {
  newState: SolidityValueType;
};

////////////////////////////////////////

type UninstallParams = {
  appIdentityHash: Bytes32;
};

type UninstallResult = {};

////////////////////////////////////////

type RescindDepositRightsParams = {
  assetId?: Address;
  appIdentityHash?: Bytes32;
};

type RescindDepositRightsResult = {
  freeBalance: {
    [s: string]: BigNumber;
  };
};

////////////////////////////////////////

type WithdrawParams = {
  multisigAddress: Address;
  recipient?: Address;
  amount: BigNumber;
  tokenAddress?: Address;
};

type WithdrawResult = {
  recipient: Address;
  txHash: Bytes32;
};

////////////////////////////////////////

type WithdrawCommitmentParams = WithdrawParams;

type WithdrawCommitmentResult = {
  transaction: MinimalTransaction;
};

////////////////////////////////////////
// exports

export const MethodNames = enumify({
  chan_create: "chan_create",
  chan_deployStateDepositHolder: "chan_deployStateDepositHolder",
  chan_getAppInstance: "chan_getAppInstance",
  chan_getAppInstances: "chan_getAppInstances",
  chan_getChannelAddresses: "chan_getChannelAddresses",
  chan_getFreeBalanceState: "chan_getFreeBalanceState",
  chan_getProposedAppInstance: "chan_getProposedAppInstance",
  chan_getProposedAppInstances: "chan_getProposedAppInstances",
  chan_getStateChannel: "chan_getStateChannel",
  chan_getStateDepositHolderAddress: "chan_getStateDepositHolderAddress",
  chan_getTokenIndexedFreeBalanceStates: "chan_getTokenIndexedFreeBalanceStates",
  chan_install: "chan_install",
  chan_proposeInstall: "chan_proposeInstall",
  chan_rejectInstall: "chan_rejectInstall",
  chan_takeAction: "chan_takeAction",
  chan_uninstall: "chan_uninstall",
  chan_updateState: "chan_updateState",
  chan_withdraw: "chan_withdraw",
  chan_withdrawCommitment: "chan_withdrawCommitment",
});
type MethodNames = (typeof MethodNames)[keyof typeof MethodNames];
export type MethodName = keyof typeof MethodNames;

export namespace MethodParams {
  export type CreateChannel = CreateChannelParams;
  export type DeployStateDepositHolder = DeployStateDepositHolderParams;
  export type Deposit = DepositParams;
  export type GetAppInstanceDetails = GetAppInstanceDetailsParams;
  export type GetAppInstances = GetAppInstancesParams
  export type GetChannelAddresses = GetChannelAddressesParams;
  export type GetFreeBalanceState = GetFreeBalanceStateParams;
  export type GetProposedAppInstance = GetProposedAppInstanceParams;
  export type GetProposedAppInstances = GetProposedAppInstancesParams;
  export type GetStateChannel = GetStateChannelParams;
  export type GetStateDepositHolderAddress = GetStateDepositHolderAddressParams;
  export type GetTokenIndexedFreeBalanceStates = GetTokenIndexedFreeBalanceStatesParams;
  export type Install = InstallParams;
  export type ProposeInstall = ProposeInstallParams;
  export type RejectInstall = RejectInstallParams;
  export type RequestDepositRights = RequestDepositRightsParams;
  export type RescindDepositRights = RescindDepositRightsParams;
  export type TakeAction = TakeActionParams;
  export type Uninstall = UninstallParams;
  export type UpdateState = UpdateStateParams;
  export type Withdraw = WithdrawParams;
  export type WithdrawCommitment = WithdrawCommitmentParams;
}

export type MethodParam =
  | CreateChannelParams
  | DeployStateDepositHolderParams
  | DepositParams
  | GetAppInstanceDetailsParams
  | GetAppInstancesParams
  | GetChannelAddressesParams
  | GetFreeBalanceStateParams
  | GetProposedAppInstanceParams
  | GetProposedAppInstancesParams
  | GetStateChannelParams
  | GetStateDepositHolderAddressParams
  | GetTokenIndexedFreeBalanceStatesParams
  | InstallParams
  | ProposeInstallParams
  | RejectInstallParams
  | RequestDepositRightsParams
  | RescindDepositRightsParams
  | TakeActionParams
  | UninstallParams
  | UpdateStateParams
  | WithdrawParams
  | WithdrawCommitmentParams;

export namespace MethodResults {
  export type CreateChannel = CreateChannelResult;
  export type DeployStateDepositHolder = DeployStateDepositHolderResult;
  export type Deposit = DepositResult;
  export type GetAppInstanceDetails = GetAppInstanceDetailsResult;
  export type GetAppInstances = GetAppInstancesResult
  export type GetChannelAddresses = GetChannelAddressesResult;
  export type GetFreeBalanceState = GetFreeBalanceStateResult;
  export type GetProposedAppInstance = GetProposedAppInstanceResult;
  export type GetProposedAppInstances = GetProposedAppInstancesResult;
  export type GetStateChannel = GetStateChannelResult;
  export type GetStateDepositHolderAddress = GetStateDepositHolderAddressResult;
  export type GetTokenIndexedFreeBalanceStates = GetTokenIndexedFreeBalanceStatesResult;
  export type Install = InstallResult;
  export type ProposeInstall = ProposeInstallResult;
  export type RejectInstall = RejectInstallResult;
  export type RequestDepositRights = RequestDepositRightsResult;
  export type RescindDepositRights = RescindDepositRightsResult;
  export type TakeAction = TakeActionResult;
  export type Uninstall = UninstallResult;
  export type UpdateState = UpdateStateResult;
  export type Withdraw = WithdrawResult;
  export type WithdrawCommitment = WithdrawCommitmentResult;
}

export type MethodResult =
  | CreateChannelResult
  | DeployStateDepositHolderResult
  | DepositResult
  | GetAppInstanceDetailsResult
  | GetAppInstancesResult
  | GetChannelAddressesResult
  | GetFreeBalanceStateResult
  | GetProposedAppInstanceResult
  | GetProposedAppInstancesResult
  | GetStateChannelResult
  | GetStateDepositHolderAddressResult
  | GetTokenIndexedFreeBalanceStatesResult
  | InstallResult
  | ProposeInstallResult
  | RejectInstallResult
  | RequestDepositRightsResult
  | RescindDepositRightsResult
  | TakeActionResult
  | UninstallResult
  | UpdateStateResult
  | WithdrawResult
  | WithdrawCommitmentResult;