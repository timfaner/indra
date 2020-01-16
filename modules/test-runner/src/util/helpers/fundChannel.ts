import { IConnextClient } from "@connext/types";
import { AddressZero } from "ethers/constants";
import { BigNumber } from "ethers/utils";

import { expect } from "../assertions";

export const fundChannel = async (
  client: IConnextClient,
  amount: BigNumber,
  assetId: string = AddressZero,
): Promise<void> => {
  const prevFreeBalance = await client.getFreeBalance(assetId);
  await new Promise(async (resolve, reject) => {
    client.once("DEPOSIT_CONFIRMED_EVENT", async () => {
      const freeBalance = await client.getFreeBalance(assetId);
      // verify free balance increased as expected
      const expected = prevFreeBalance[client.freeBalanceAddress].add(amount);
      expect(freeBalance[client.freeBalanceAddress].toString()).to.be.eq(expected.toString());
      resolve();
    });
    client.once("DEPOSIT_FAILED_EVENT", async (msg: any) => {
      reject(new Error(JSON.stringify(msg)));
    });

    await client.deposit({ amount: amount.toString(), assetId });
  });

  return;
};
