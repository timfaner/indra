import {
  IConnextClient,
  CONVENTION_FOR_ETH_ASSET_ID,
  EventNames,
  PublicParams,
  EventPayloads,
  ConditionalTransferTypes,
} from "@connext/types";
import { getPostgresStore } from "@connext/store";
import { ConnextClient } from "@connext/client";
import { toBN, getRandomBytes32 } from "@connext/utils";
import { Sequelize } from "sequelize";

import { createClient, fundChannel, ETH_AMOUNT_MD, expect, env } from "../util";
import { BigNumber, hexlify, randomBytes, solidityKeccak256 } from "ethers/utils";

// NOTE: only groups correct number of promises associated with a payment together.
// there is no validation done to ensure the events correspond to the payments, or
// to ensure that the event payloads are correct.

const performTransfer = async (params: {
  ASSET: string;
  TRANSFER_AMT: BigNumber;
  sender: IConnextClient;
  recipient: IConnextClient;
}): Promise<string> => {
  const { ASSET, TRANSFER_AMT, sender, recipient } = params;
  const TRANSFER_PARAMS = {
    amount: TRANSFER_AMT,
    recipient: recipient.publicIdentifier,
    assetId: ASSET,
  };

  // send transfers from sender to recipient
  const [preImage] = await Promise.all([
    new Promise(async (resolve, reject) => {
      sender.once(EventNames.CONDITIONAL_TRANSFER_FAILED_EVENT, () => reject());
      try {
        const res = await sender.transfer(TRANSFER_PARAMS);
        return resolve(res.preImage);
      } catch (e) {
        return reject(e.message);
      }
    }),
    new Promise((resolve, reject) => {
      recipient.once(EventNames.CONDITIONAL_TRANSFER_UNLOCKED_EVENT, (data) => {
        return resolve(data);
      });
      recipient.once(EventNames.CONDITIONAL_TRANSFER_FAILED_EVENT, () => reject());
    }),
    new Promise((resolve) => {
      sender.once(EventNames.CONDITIONAL_TRANSFER_UNLOCKED_EVENT, (data) => {
        return resolve(data);
      });
    }),
  ]);
  return preImage as string;
};

describe("Full Flow: Multichannel stores (clients share single sequelize instance)", () => {
  let sender: ConnextClient;
  let recipient: ConnextClient;

  beforeEach(async () => {
    const { host, port, user: username, password, database } = env.dbConfig;
    const sequelize = new Sequelize({
      host,
      port,
      username,
      password,
      database,
      dialect: "postgres",
      logging: false,
    });
    // create stores with different prefixes
    const senderStore = getPostgresStore(sequelize, "sender");
    const recipientStore = getPostgresStore(sequelize, "recipient");
    // create clients with shared store
    sender = (await createClient({ store: senderStore, id: "S" })) as ConnextClient;
    recipient = (await createClient({ store: recipientStore, id: "R" })) as ConnextClient;
  });

  afterEach(async () => {
    await sender.messaging.disconnect();
    await recipient.messaging.disconnect();
    // clear stores
    await sender.store.clear();
    await recipient.store.clear();
  });

  it("should work when clients share the same sequelize instance with a different prefix (1 payment sent)", async () => {
    // establish tests constants
    const DEPOSIT_AMT = ETH_AMOUNT_MD;
    const ASSET = CONVENTION_FOR_ETH_ASSET_ID;
    const TRANSFER_AMT = toBN(100);
    await fundChannel(sender, DEPOSIT_AMT, ASSET);

    // get initial balances
    const initialSenderFb = await sender.getFreeBalance(ASSET);
    const initialRecipientFb = await recipient.getFreeBalance(ASSET);

    await performTransfer({
      sender,
      recipient,
      ASSET,
      TRANSFER_AMT,
    });

    // verify transfer amounts
    const finalSenderFb = await sender.getFreeBalance(ASSET);
    const finalRecipientFb = await recipient.getFreeBalance(ASSET);
    expect(finalSenderFb[sender.signerAddress]).to.be.eq(
      initialSenderFb[sender.signerAddress].sub(TRANSFER_AMT),
    );
    expect(finalRecipientFb[recipient.signerAddress]).to.be.eq(
      initialRecipientFb[recipient.signerAddress].add(TRANSFER_AMT),
    );
  });

  it("should work when clients share the same sequelize instance with a different prefix (many payments sent)", async () => {
    // establish tests constants
    const DEPOSIT_AMT = ETH_AMOUNT_MD;
    const ASSET = CONVENTION_FOR_ETH_ASSET_ID;
    const TRANSFER_AMT = toBN(100);
    const MIN_TRANSFERS = 25;
    const TRANSFER_INTERVAL = 500; // ms between consecutive transfer calls

    await fundChannel(sender, DEPOSIT_AMT, ASSET);

    const initialSenderFb = await sender.getFreeBalance(ASSET);
    const initialRecipientFb = await recipient.getFreeBalance(ASSET);

    let receivedTransfers = 0;
    let intervals = 0;
    let pollerError: any;

    recipient.on(
      EventNames.CONDITIONAL_TRANSFER_CREATED_EVENT,
      async (payload: EventPayloads.SignedTransferCreated) => {
        console.log(`Created signed transfer: ${JSON.stringify(payload)}`);
        const data = hexlify(randomBytes(32));
        const digest = solidityKeccak256(["bytes32", "bytes32"], [data, payload.paymentId]);
        const signature = await recipient.signer.signMessage(digest);
        const res = await recipient.resolveCondition({
          conditionType: ConditionalTransferTypes.SignedTransfer,
          data,
          paymentId: payload.paymentId,
          signature,
        } as PublicParams.ResolveSignedTransfer);
        console.log(`Resolved signed transfer: ${JSON.stringify(res)}`);
      },
    );

    // call transfers on interval
    const interval = setInterval(async () => {
      intervals += 1;
      if (intervals > MIN_TRANSFERS) {
        clearInterval(interval);
        return;
      }
      let error: any = undefined;
      try {
        const transferRes = await sender.conditionalTransfer({
          amount: TRANSFER_AMT,
          paymentId: getRandomBytes32(),
          conditionType: ConditionalTransferTypes.SignedTransfer,
          signer: recipient.signerAddress,
          assetId: ASSET,
          recipient: recipient.publicIdentifier,
        } as PublicParams.SignedTransfer);
        console.log(`[${intervals}/${MIN_TRANSFERS}] senderApp: ${transferRes.appIdentityHash}`);
      } catch (e) {
        clearInterval(interval);
        throw error;
      }
    }, TRANSFER_INTERVAL);

    // setup promise to properly wait out the transfers / stop interval
    // will also periodically check if a poller error has been set and reject
    await new Promise((resolve, reject) => {
      // setup listeners (increment on reclaim)
      recipient.on(EventNames.CONDITIONAL_TRANSFER_UNLOCKED_EVENT, () => {
        receivedTransfers += 1;
        if (receivedTransfers >= MIN_TRANSFERS) {
          resolve();
        }
      });
      recipient.on(EventNames.CONDITIONAL_TRANSFER_FAILED_EVENT, reject);
      sender.on(EventNames.CONDITIONAL_TRANSFER_FAILED_EVENT, reject);

      // register a check to see if the poller has been cleared
      setInterval(() => {
        if (pollerError) {
          reject(pollerError);
        }
      }, 250);
    });

    expect(receivedTransfers).to.be.eq(MIN_TRANSFERS);
    const finalSenderFb = await sender.getFreeBalance(ASSET);
    const finalRecipientFb = await recipient.getFreeBalance(ASSET);
    expect(finalSenderFb[sender.signerAddress]).to.be.eq(
      initialSenderFb[sender.signerAddress].sub(TRANSFER_AMT.mul(receivedTransfers)),
    );
    expect(finalRecipientFb[recipient.signerAddress]).to.be.eq(
      initialRecipientFb[recipient.signerAddress].add(TRANSFER_AMT.mul(receivedTransfers)),
    );
  });
});
