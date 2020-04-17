import { DEFAULT_APP_TIMEOUT, SWAP_STATE_TIMEOUT } from "@connext/apps";
import { delayAndThrow, getSignerAddressFromPublicIdentifier, stringify } from "@connext/utils";
import {
  CF_METHOD_TIMEOUT,
  DefaultApp,
  MethodParams,
  PublicParams,
  PublicResults,
  SimpleSwapAppState,
  SimpleTwoPartySwapAppName,
  Address,
} from "@connext/types";
import {
  calculateExchange,
  getAddressFromAssetId,
  invalidAddress,
  notGreaterThan,
  notLessThanOrEqualTo,
  notPositive,
  toBN,
  validate,
} from "@connext/utils";
import { AddressZero, Zero } from "ethers/constants";
import { BigNumber, formatEther, parseEther } from "ethers/utils";

import { AbstractController } from "./AbstractController";

export class SwapController extends AbstractController {
  public async swap(params: PublicParams.Swap): Promise<PublicResults.Swap> {
    this.log.info(`Swap called with params: ${stringify(params)}`);
    const amount = toBN(params.amount);
    const { swapRate } = params;

    const toTokenAddress = getAddressFromAssetId(params.toAssetId);
    const fromTokenAddress = getAddressFromAssetId(params.fromAssetId);
  
    const preSwapFromBal = await this.connext.getFreeBalance(fromTokenAddress);
    const preSwapToBal = await this.connext.getFreeBalance(toTokenAddress);
    const userBal = preSwapFromBal[this.connext.signerAddress];
    const swappedAmount = calculateExchange(amount, swapRate);

    validate(
      invalidAddress(fromTokenAddress),
      invalidAddress(toTokenAddress),
      notLessThanOrEqualTo(amount, userBal),
      notGreaterThan(amount, Zero),
      notPositive(parseEther(swapRate)),
    );

    const error = notLessThanOrEqualTo(
      amount,
      toBN(preSwapFromBal[this.connext.signerAddress]),
    );
    if (error) {
      throw new Error(error);
    }

    // get app definition
    const network = await this.ethProvider.getNetwork();
    const appInfo = await this.connext.getAppRegistry({
      name: SimpleTwoPartySwapAppName,
      chainId: network.chainId,
    }) as DefaultApp;

    // install the swap app
    this.log.debug(`Installing swap app`);
    const appIdentityHash = await this.swapAppInstall(
      amount,
      toTokenAddress,
      fromTokenAddress,
      swapRate,
      appInfo,
    );
    this.log.debug(`Swap app installed: ${appIdentityHash}, uninstalling`);

    // if app installed, that means swap was accepted now uninstall
    try {
      await Promise.race([
        delayAndThrow(
          CF_METHOD_TIMEOUT,
          `App uninstall took longer than ${CF_METHOD_TIMEOUT / 1000} seconds`,
        ),
        this.connext.uninstallApp(appIdentityHash),
      ]);
    } catch (e) {
      const msg = `Failed to uninstall swap: ${e.stack || e.message}`;
      this.log.error(msg);
      throw new Error(msg);
    }

    // Sanity check to ensure swap was executed correctly
    const postSwapFromBal = await this.connext.getFreeBalance(fromTokenAddress);
    const postSwapToBal = await this.connext.getFreeBalance(toTokenAddress);
    // balance decreases
    const diffFrom = preSwapFromBal[this.connext.signerAddress].sub(
      postSwapFromBal[this.connext.signerAddress],
    );
    // balance increases
    const diffTo = postSwapToBal[this.connext.signerAddress].sub(
      preSwapToBal[this.connext.signerAddress],
    );
    if (!diffFrom.eq(amount) || !diffTo.eq(swappedAmount)) {
      throw new Error("Invalid final swap amounts - this shouldn't happen!!");
    }
    const res = await this.connext.getChannel();

    this.log.info(`Swap completed!`);
    // TODO: fix the state / types!!
    return res as PublicResults.Swap;
  }

  /////////////////////////////////
  ////// PRIVATE METHODS

  private swapAppInstall = async (
    amount: BigNumber,
    toTokenAddress: Address,
    fromTokenAddress: Address,
    swapRate: string,
    appInfo: DefaultApp,
  ): Promise<string> => {
    const swappedAmount = calculateExchange(amount, swapRate);

    this.log.debug(
      `Swapping ${formatEther(amount)} ${ toTokenAddress === AddressZero ? "ETH" : "Tokens"
      } for ${formatEther(swappedAmount)} ${fromTokenAddress === AddressZero ? "ETH" : "Tokens"}`,
    );

    // NOTE: always put the initiators swap information FIRST
    // followed by responders. If this is not included, the swap will
    // fail, causing the balances to be indexed on the wrong token
    // address key in `get-outcome-increments.ts` in cf code base
    // ideally this would be fixed at some point
    const initialState: SimpleSwapAppState = {
      coinTransfers: [
        [
          {
            amount,
            to: this.connext.signerAddress,
          },
        ],
        [
          {
            amount: swappedAmount,
            to: getSignerAddressFromPublicIdentifier(this.connext.nodeIdentifier),
          },
        ],
      ],
    };

    const { actionEncoding, appDefinitionAddress: appDefinition, stateEncoding } = appInfo;

    const params: MethodParams.ProposeInstall = {
      abiEncodings: {
        actionEncoding,
        stateEncoding,
      },
      appDefinition,
      initialState,
      initiatorDeposit: amount,
      initiatorDepositAssetId: fromTokenAddress,
      outcomeType: appInfo.outcomeType,
      responderIdentifier: this.connext.nodeIdentifier,
      responderDeposit: swappedAmount,
      responderDepositAssetId: toTokenAddress,
      defaultTimeout: DEFAULT_APP_TIMEOUT,
      stateTimeout: SWAP_STATE_TIMEOUT,
    };

    this.log.debug(`Installing app with params: ${stringify(params, 2)}`)
    const appIdentityHash = await this.proposeAndInstallLedgerApp(params);
    return appIdentityHash;
  };
}
