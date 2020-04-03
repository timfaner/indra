/* global before */
import { Contract, Wallet, ContractFactory } from "ethers";

import { expect, restore, snapshot, setupContext, provider, AppWithCounterState, computeCancelChallengeHash, AppWithCounterClass } from "../utils";

import AppWithAction from "../../../build/AppWithAction.json";
import ChallengeRegistry from "../../../build/ChallengeRegistry.json";
import { sortSignaturesBySignerAddress, toBN } from "@connext/types";
import { signDigest, recoverAddress } from "@connext/crypto";

describe("cancelChallenge", () => {

  let appRegistry: Contract;
  let appDefinition: Contract;
  let wallet: Wallet;
  let snapshotId: number;

  // app instance
  let appInstance: AppWithCounterClass;
  let bob: Wallet;

  // helpers
  let isDisputable: () => Promise<boolean>;
  let isProgressable: () => Promise<boolean>;

  let setState: (
    versionNumber: number,
    appState?: string,
    timeout?: number,
  ) => Promise<void>;
  let setAndProgressState: (versionNumber: number, state?: AppWithCounterState, turnTaker?: Wallet) => Promise<void>;
  let cancelChallenge: (
    versionNumber: number, 
    signatures?: string[]
  ) => Promise<void>;
  let cancelChallengeAndVerify: (versionNumber: number, signatures?: string[]) => Promise<void>;

  before(async () => {
    wallet = (await provider.getWallets())[0];
    await wallet.getTransactionCount();

    appRegistry = await new ContractFactory(
      ChallengeRegistry.abi as any,
      ChallengeRegistry.bytecode,
      wallet,
    ).deploy();
    appDefinition = await new ContractFactory(
      AppWithAction.abi as any,
      AppWithAction.bytecode,
      wallet,
    ).deploy();
  });

  beforeEach(async () => {
    snapshotId = await snapshot();
    const context = await setupContext(appRegistry, appDefinition);

    // app instance
    appInstance = context["appInstance"];
    bob = context["bob"];

    // helpers
    isProgressable = context["isProgressable"];
    isDisputable = context["isDisputable"];

    setState = context["setStateAndVerify"];
    setAndProgressState = 
      (versionNumber: number, state?: AppWithCounterState, turnTaker?: Wallet) => context["setAndProgressStateAndVerify"](
        versionNumber, // nonce
        state || context["state0"], // state
        context["action"], // action
        undefined, // timeout
        turnTaker || bob, // turn taker
      );
    cancelChallenge = context["cancelChallenge"];
    cancelChallengeAndVerify = context["cancelChallengeAndVerify"];
  });

  afterEach(async () => {
    await restore(snapshotId);
  });


  it("works", async () => {
    // when in set state phase
    await setState(1);
    expect(await isDisputable()).to.be.true;
    await cancelChallengeAndVerify(1);

    // when in progress state phase
    await setAndProgressState(1);
    expect(await isProgressable()).to.be.true;
    await cancelChallengeAndVerify(2);
  });

  it("fails if is not cancellable", async () => {
    await expect(cancelChallenge(0)).to.be.revertedWith("cancelChallenge called on challenge that cannot be cancelled");
  });

  it("fails if incorrect sigs", async () => {
    const versionNumber = 2;
    await setState(versionNumber);

    const digest = computeCancelChallengeHash(appInstance.identityHash, toBN(versionNumber));
    const signatures = await sortSignaturesBySignerAddress(
      digest,
      [
        await signDigest(wallet.privateKey, digest),
        await signDigest(bob.privateKey, digest),
      ],
      recoverAddress,
    );
    await expect(cancelChallenge(versionNumber, signatures)).to.be.revertedWith("Invalid signature");
  });

  it("fails if wrong version number submitted", async () => {
    // when in set state phase
    await setState(1);
    await expect(cancelChallenge(2)).to.be.revertedWith("cancelChallenge was called with wrong version number");
  });
});
