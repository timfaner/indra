import { MemoryStorage as MemoryStoreService } from "@connext/store";
import { OutcomeType, ProtocolNames, toBN, ProtocolParams } from "@connext/types";
import { Contract, ContractFactory } from "ethers";
import { One, Two, Zero, HashZero } from "ethers/constants";
import { JsonRpcProvider } from "ethers/providers";
import { BigNumber, bigNumberify } from "ethers/utils";

import { CONVENTION_FOR_ETH_TOKEN_ADDRESS } from "../constants";
import { getCreate2MultisigAddress } from "../utils";
import { xkeyKthAddress } from "../xkeys";

import { IdentityApp } from "./contracts";
import { toBeEq } from "./bignumber-jest-matcher";
import { MessageRouter } from "./message-router";
import { MiniNode } from "./mininode";
import { newWallet } from "./utils";
import { StateChannel } from "../models";

expect.extend({ toBeEq });

export enum Participant {
  A,
  B,
  C,
}

export class TestRunner {
  static readonly TEST_TOKEN_ADDRESS: string = "0x88a5C2d9919e46F883EB62F7b8Dd9d0CC45bc290";

  private identityApp!: Contract;
  public mininodeA!: MiniNode;
  public mininodeB!: MiniNode;
  public mininodeC!: MiniNode;
  public multisigAB!: string;
  public multisigAC!: string;
  public multisigBC!: string;
  public provider!: JsonRpcProvider;
  public defaultTimeout!: BigNumber;
  private mr!: MessageRouter;

  async connectToGanache(): Promise<void> {
    const wallet = newWallet(global["wallet"]);
    const network = global["network"];
    this.provider = wallet.provider as JsonRpcProvider;

    this.identityApp = await new ContractFactory(
      IdentityApp.abi,
      IdentityApp.bytecode,
      wallet,
    ).deploy();

    this.defaultTimeout = bigNumberify(100);

    this.mininodeA = new MiniNode(network, this.provider, new MemoryStoreService());
    this.mininodeB = new MiniNode(network, this.provider, new MemoryStoreService());
    this.mininodeC = new MiniNode(network, this.provider, new MemoryStoreService());

    this.multisigAB = await getCreate2MultisigAddress(
      this.mininodeA.xpub,
      this.mininodeB.xpub,
      {
        proxyFactory: network.ProxyFactory,
        multisigMastercopy: network.MinimumViableMultisig,
      },
      this.provider,
    );

    this.multisigAC = await getCreate2MultisigAddress(
      this.mininodeA.xpub,
      this.mininodeC.xpub,
      {
        proxyFactory: network.ProxyFactory,
        multisigMastercopy: network.MinimumViableMultisig,
      },
      this.provider,
    );

    this.multisigBC = await getCreate2MultisigAddress(
      this.mininodeB.xpub,
      this.mininodeC.xpub,
      {
        proxyFactory: network.ProxyFactory,
        multisigMastercopy: network.MinimumViableMultisig,
      },
      this.provider,
    );

    this.mr = new MessageRouter([this.mininodeA, this.mininodeB, this.mininodeC]);
  }

  /*
  Run the setup protocol to create the AB and BC channels, and update the
  state channel maps accordingly
  */
  async setup() {
    await this.mininodeA.protocolRunner.runSetupProtocol({
      initiatorXpub: this.mininodeA.xpub,
      responderXpub: this.mininodeB.xpub,
      multisigAddress: this.multisigAB,
    });

    const jsonAB = await this.mininodeA.store.getStateChannel(this.multisigAB);
    this.mininodeA.scm.set(this.multisigAB, StateChannel.fromJson(jsonAB!));

    await this.mr.waitForAllPendingPromises();

    await this.mininodeB.protocolRunner.runSetupProtocol({
      initiatorXpub: this.mininodeB.xpub,
      responderXpub: this.mininodeC.xpub,
      multisigAddress: this.multisigBC,
    });

    const jsonBC = await this.mininodeB.store.getStateChannel(this.multisigBC);
    this.mininodeB.scm.set(this.multisigBC, StateChannel.fromJson(jsonBC!));

    await this.mr.waitForAllPendingPromises();
  }

  /*
  Adds one ETH and one TEST_TOKEN to the free balance of everyone. Note this
  does not actually transfer any tokens.
  */
  async unsafeFund() {
    for (const mininode of [this.mininodeA, this.mininodeB]) {
      const json = await mininode.store.getStateChannel(this.multisigAB)!;
      const sc = StateChannel.fromJson(json!);
      const updatedBalance = sc.addActiveAppAndIncrementFreeBalance(HashZero, {
        [CONVENTION_FOR_ETH_TOKEN_ADDRESS]: {
          [sc.getFreeBalanceAddrOf(this.mininodeA.xpub)]: One,
          [sc.getFreeBalanceAddrOf(this.mininodeB.xpub)]: One,
        },
        [TestRunner.TEST_TOKEN_ADDRESS]: {
          [sc.getFreeBalanceAddrOf(this.mininodeA.xpub)]: One,
          [sc.getFreeBalanceAddrOf(this.mininodeB.xpub)]: One,
        },
      });
      await mininode.store.updateFreeBalance(
        updatedBalance.multisigAddress,
        updatedBalance.freeBalance.toJson(),
      );
      mininode.scm.set(this.multisigAB, updatedBalance);
    }

    for (const mininode of [this.mininodeB, this.mininodeC]) {
      const json = await mininode.store.getStateChannel(this.multisigBC)!;
      const sc = StateChannel.fromJson(json!);
      const updatedSc = sc.addActiveAppAndIncrementFreeBalance(HashZero, {
        [CONVENTION_FOR_ETH_TOKEN_ADDRESS]: {
          [sc.getFreeBalanceAddrOf(this.mininodeB.xpub)]: One,
          [sc.getFreeBalanceAddrOf(this.mininodeC.xpub)]: One,
        },
        [TestRunner.TEST_TOKEN_ADDRESS]: {
          [sc.getFreeBalanceAddrOf(this.mininodeB.xpub)]: One,
          [sc.getFreeBalanceAddrOf(this.mininodeC.xpub)]: One,
        },
      });
      await mininode.store.updateFreeBalance(
        updatedSc.multisigAddress,
        updatedSc.freeBalance.toJson(),
      );
      mininode.scm.set(this.multisigBC, updatedSc);
    }
  }

  async installEqualDeposits(outcomeType: OutcomeType, tokenAddress: string) {
    const stateEncoding = {
      [OutcomeType.TWO_PARTY_FIXED_OUTCOME]: "uint8",
      [OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER]: "tuple(address to, uint256 amount)[2]",
      [OutcomeType.MULTI_ASSET_MULTI_PARTY_COIN_TRANSFER]: "tuple(address to, uint256 amount)[][]",
    }[outcomeType];

    const initialState = {
      [OutcomeType.TWO_PARTY_FIXED_OUTCOME]: 0,
      [OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER]: [
        {
          to: xkeyKthAddress(this.mininodeA.xpub, 0),
          amount: Two,
        },
        {
          to: xkeyKthAddress(this.mininodeB.xpub, 0),
          amount: Zero,
        },
      ],
      [OutcomeType.MULTI_ASSET_MULTI_PARTY_COIN_TRANSFER]: [
        [
          {
            to: xkeyKthAddress(this.mininodeA.xpub, 0),
            amount: Two,
          },
          {
            to: xkeyKthAddress(this.mininodeB.xpub, 0),
            amount: Zero,
          },
        ],
      ],
    }[outcomeType];

    await this.mininodeA.protocolRunner.initiateProtocol(ProtocolNames.propose, {
      multisigAddress: this.multisigAB,
      initiatorXpub: this.mininodeA.xpub,
      responderXpub: this.mininodeB.xpub,
      appDefinition: this.identityApp.address,
      abiEncodings: {
        stateEncoding,
        actionEncoding: undefined,
      },
      initiatorDeposit: One,
      initiatorDepositTokenAddress: tokenAddress,
      responderDeposit: One,
      responderDepositTokenAddress: tokenAddress,
      defaultTimeout: this.defaultTimeout,
      stateTimeout: Zero,
      initialState,
      outcomeType,
    });

    const postProposalStateChannel = await this.mininodeA.store.getStateChannel(this.multisigAB);
    const [proposal] = [
      ...StateChannel.fromJson(postProposalStateChannel!).proposedAppInstances.values(),
    ];

    await this.mininodeA.protocolRunner.initiateProtocol(ProtocolNames.install, {
      appInterface: {
        stateEncoding,
        addr: this.identityApp.address,
        actionEncoding: undefined,
      },
      appSeqNo: proposal.appSeqNo,
      defaultTimeout: this.defaultTimeout,
      stateTimeout: Zero,
      disableLimit: false,
      initialState,
      initiatorBalanceDecrement: One,
      initiatorDepositTokenAddress: tokenAddress,
      initiatorXpub: this.mininodeA.xpub,
      multisigAddress: this.multisigAB,
      outcomeType,
      responderBalanceDecrement: One,
      responderDepositTokenAddress: tokenAddress,
      responderXpub: this.mininodeB.xpub,
      appInitiatorAddress: xkeyKthAddress(
        this.mininodeA.xpub,
        proposal.appSeqNo,
      ),
      appResponderAddress: xkeyKthAddress(this.mininodeB.xpub, proposal.appSeqNo),
    } as ProtocolParams.Install);
  }

  async installSplitDeposits(
    outcomeType: OutcomeType,
    tokenAddressA: string,
    tokenAddressB: string,
  ) {
    const stateEncoding = {
      [OutcomeType.TWO_PARTY_FIXED_OUTCOME]: "uint8",
      [OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER]: "tuple(address to, uint256 amount)[2]",
      [OutcomeType.MULTI_ASSET_MULTI_PARTY_COIN_TRANSFER]: "tuple(address to, uint256 amount)[][]",
    }[outcomeType];

    const initialState = {
      [OutcomeType.TWO_PARTY_FIXED_OUTCOME]: 0,
      [OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER]: [
        {
          to: xkeyKthAddress(this.mininodeA.xpub, 0),
          amount: Two,
        },
        {
          to: xkeyKthAddress(this.mininodeB.xpub, 0),
          amount: Zero,
        },
      ],
      [OutcomeType.MULTI_ASSET_MULTI_PARTY_COIN_TRANSFER]: [
        [
          {
            to: xkeyKthAddress(this.mininodeA.xpub, 0),
            amount: Two,
          },
          {
            to: xkeyKthAddress(this.mininodeB.xpub, 0),
            amount: Zero,
          },
        ],
      ],
    }[outcomeType];

    await this.mininodeA.protocolRunner.initiateProtocol(ProtocolNames.propose, {
      multisigAddress: this.multisigAB,
      initiatorXpub: this.mininodeA.xpub,
      responderXpub: this.mininodeB.xpub,
      appDefinition: this.identityApp.address,
      abiEncodings: {
        stateEncoding,
        actionEncoding: undefined,
      },
      initiatorDeposit: One,
      initiatorDepositTokenAddress: tokenAddressA,
      responderDeposit: One,
      responderDepositTokenAddress: tokenAddressB,
      defaultTimeout: this.defaultTimeout,
      stateTimeout: Zero,
      initialState,
      outcomeType,
    });

    const postProposalStateChannel = await this.mininodeA.store.getStateChannel(this.multisigAB);
    const [proposal] = [
      ...StateChannel.fromJson(postProposalStateChannel!).proposedAppInstances.values(),
    ];

    await this.mininodeA.protocolRunner.initiateProtocol(ProtocolNames.install, {
      outcomeType,
      initialState,
      initiatorXpub: this.mininodeA.xpub,
      responderXpub: this.mininodeB.xpub,
      multisigAddress: this.multisigAB,
      initiatorBalanceDecrement: One,
      responderBalanceDecrement: One,
      appInterface: {
        stateEncoding,
        addr: this.identityApp.address,
        actionEncoding: undefined,
      },
      appSeqNo: proposal.appSeqNo,
      defaultTimeout: this.defaultTimeout,
      stateTimeout: Zero,
      initiatorDepositTokenAddress: tokenAddressA,
      responderDepositTokenAddress: tokenAddressB,
      disableLimit: false,
      appInitiatorAddress: xkeyKthAddress(this.mininodeA.xpub, proposal.appSeqNo),
      appResponderAddress: xkeyKthAddress(this.mininodeB.xpub, proposal.appSeqNo),
    } as ProtocolParams.Install);
  }

  async uninstall() {
    const multisig = await this.mininodeA.store.getStateChannel(this.multisigAB);
    if (!multisig) {
      throw new Error(`uninstall: Couldn't find multisig for ${this.multisigAC}`);
    }
    const appInstances = StateChannel.fromJson(multisig!).appInstances;

    const [key] = [...appInstances.keys()].filter(key => {
      return key !== this.mininodeA.scm.get(this.multisigAB)!.freeBalance.identityHash;
    });

    await this.mininodeA.protocolRunner.initiateProtocol(ProtocolNames.uninstall, {
      appIdentityHash: key,
      initiatorXpub: this.mininodeA.xpub,
      responderXpub: this.mininodeB.xpub,
      multisigAddress: this.multisigAB,
    });

    await this.mr.waitForAllPendingPromises();
  }

  assertFB(participant: Participant, tokenAddress: string, expected: BigNumber) {
    const mininode = {
      [Participant.A]: this.mininodeA,
      [Participant.B]: this.mininodeB,
      [Participant.C]: this.mininodeC,
    }[participant];
    for (const multisig in [this.multisigAB, this.multisigBC, this.multisigAC]) {
      if (mininode.scm.has(multisig)) {
        expect(
          mininode.scm
            .get(multisig)!
            .getFreeBalanceClass()
            .getBalance(tokenAddress, xkeyKthAddress(mininode.xpub, 0)),
        ).toBeEq(expected);
      }
    }
  }
}