import { Contract } from "ethers";
import { Zero } from "ethers/constants";
import { BigNumber } from "ethers/utils";
import { jsonRpcMethod } from "rpc-server";

import { CONVENTION_FOR_ETH_TOKEN_ADDRESS } from "../../../constants";
import { ERC20 } from "../../../contracts";
import { xkeyKthAddress } from "../../../machine";
import { RequestHandler } from "../../../request-handler";
import { Node } from "../../../types";
import { getCreate2MultisigAddress } from "../../../utils";
import { NodeController } from "../../controller";
import { INCORRECT_MULTISIG_ADDRESS } from "../../errors";
import {
  installBalanceRefundApp,
  uninstallBalanceRefundApp
} from "../deposit/operation";

// TODO: maybe a better name? since it's a little smarter than just a plain install
export default class RequestDepositRightsController extends NodeController {
  @jsonRpcMethod(Node.RpcMethodName.REQUEST_DEPOSIT_RIGHTS)
  public executeMethod: (
    requestHandler: RequestHandler,
    params: Node.MethodParams
  ) => Promise<Node.MethodResult> = super.executeMethod;

  protected async getRequiredLockNames(
    requestHandler: RequestHandler,
    params: Node.RequestDepositRightsParams
  ): Promise<string[]> {
    return [params.multisigAddress];
  }

  protected async beforeExecution(
    requestHandler: RequestHandler,
    params: Node.RequestDepositRightsParams
  ): Promise<void> {
    const { store, provider, networkContext } = requestHandler;
    const { multisigAddress } = params;

    const channel = await store.getStateChannel(multisigAddress);

    const expectedMultisigAddress = await getCreate2MultisigAddress(
      channel.userNeuteredExtendedKeys,
      networkContext.ProxyFactory,
      networkContext.MinimumViableMultisig,
      provider
    );

    if (expectedMultisigAddress !== channel.multisigAddress) {
      throw Error(INCORRECT_MULTISIG_ADDRESS);
    }
  }

  protected async executeMethodImplementation(
    requestHandler: RequestHandler,
    params: Node.RequestDepositRightsParams
  ): Promise<Node.RequestDepositRightsResult> {
    const {
      provider,
      store,
      networkContext,
      publicIdentifier
    } = requestHandler;
    const { multisigAddress, tokenAddress } = params;

    params.tokenAddress = tokenAddress || CONVENTION_FOR_ETH_TOKEN_ADDRESS;

    const freeBalanceAddress = xkeyKthAddress(publicIdentifier, 0);

    const channel = await store.getStateChannel(multisigAddress);
    let multisigBalance: BigNumber;
    if (params.tokenAddress === CONVENTION_FOR_ETH_TOKEN_ADDRESS) {
      multisigBalance = await provider.getBalance(multisigAddress);
    } else {
      const erc20Contract = new Contract(tokenAddress!, ERC20.abi, provider);
      multisigBalance = await erc20Contract.balanceOf(multisigAddress);
    }

    if (
      channel.hasBalanceRefundAppInstance(
        networkContext.CoinBalanceRefundApp,
        params.tokenAddress
      )
    ) {
      const balanceRefundApp = channel.getBalanceRefundAppInstance(
        networkContext.CoinBalanceRefundApp,
        params.tokenAddress
      );
      // if app is already pointing at us and the multisig balance has not changed,
      // do not uninstall
      const appIsCorrectlyInstalled =
        balanceRefundApp.latestState["recipient"] === freeBalanceAddress &&
        multisigBalance.eq(balanceRefundApp.latestState["threshold"]);

      if (appIsCorrectlyInstalled) {
        return {
          freeBalance: channel
            .getFreeBalanceClass()
            .withTokenAddress(params.tokenAddress),
          recipient: freeBalanceAddress,
          tokenAddress: params.tokenAddress
        };
      }

      // balance refund app is installed but in the wrong state, so reinstall
      await uninstallBalanceRefundApp(requestHandler, {
        ...params,
        amount: Zero
      });
    }
    await installBalanceRefundApp(requestHandler, { ...params, amount: Zero });
    return {
      freeBalance: channel
        .getFreeBalanceClass()
        .withTokenAddress(params.tokenAddress),
      recipient: freeBalanceAddress,
      tokenAddress: params.tokenAddress
    };
  }
}
