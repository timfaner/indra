import {
  ChannelAppSequences,
  maxBN,
  MethodParams,
  MethodResults,
  RebalanceProfile as RebalanceProfileType,
  StateChannelJSON,
  GetChannelResponse,
  stringify,
} from "@connext/types";
import { Injectable, HttpService } from "@nestjs/common";
import { AxiosResponse } from "axios";
import { Contract } from "ethers";
import { AddressZero, Zero } from "ethers/constants";
import { TransactionResponse, TransactionReceipt } from "ethers/providers";
import { BigNumber, getAddress, toUtf8Bytes, sha256, bigNumberify } from "ethers/utils";

import { AppRegistryRepository } from "../appRegistry/appRegistry.repository";
import { CFCoreService } from "../cfCore/cfCore.service";
import { ConfigService } from "../config/config.service";
import { LoggerService } from "../logger/logger.service";
import { WithdrawService } from "../withdraw/withdraw.service";
import { DepositService } from "../deposit/deposit.service";
import { OnchainTransactionRepository } from "../onchainTransactions/onchainTransaction.repository";
import { RebalanceProfile } from "../rebalanceProfile/rebalanceProfile.entity";
import { xkeyKthAddress } from "../util";
import { CreateChannelMessage } from "../util/cfCore";

import { Channel } from "./channel.entity";
import { ChannelRepository } from "./channel.repository";

type RebalancingTargetsResponse<T = string> = {
  assetId: string;
  upperBoundCollateralize: T;
  lowerBoundCollateralize: T;
  upperBoundReclaim: T;
  lowerBoundReclaim: T;
};

export enum RebalanceType {
  COLLATERALIZE,
  RECLAIM,
}

@Injectable()
export class ChannelService {
  constructor(
    private readonly cfCoreService: CFCoreService,
    private readonly channelRepository: ChannelRepository,
    private readonly configService: ConfigService,
    private readonly withdrawService: WithdrawService,
    private readonly log: LoggerService,
    private readonly httpService: HttpService,
    private readonly depositService: DepositService,
    private readonly onchainTransactionRepository: OnchainTransactionRepository,
    private readonly appRegistryRepository: AppRegistryRepository,
  ) {
    this.log.setContext("ChannelService");
  }

  /**
   * Returns all channel records.
   * @param available available value of channel
   */
  async findAll(available: boolean = true): Promise<Channel[]> {
    return await this.channelRepository.findAll(available);
  }

  // NOTE: this is used by the `channel.provider`. if you use the
  // repository at that level, there is some ordering weirdness
  // where an empty array is returned from the query call, then
  // the provider method returns, and the query is *ACTUALLY* executed
  async getByUserPublicIdentifier(userPublicIdentifier: string): Promise<GetChannelResponse | undefined> {
    const channel = await this.channelRepository.findByUserPublicIdentifier(userPublicIdentifier);
    return (!channel || !channel.id) ? undefined : ({
      id: channel.id,
      available: channel.available,
      collateralizationInFlight: channel.collateralizationInFlight,
      multisigAddress: channel.multisigAddress,
      nodePublicIdentifier: channel.nodePublicIdentifier,
      userPublicIdentifier: channel.userPublicIdentifier,
    });
  }

  /**
   * Starts create channel process within CF core
   * @param counterpartyPublicIdentifier
   */
  async create(counterpartyPublicIdentifier: string): Promise<MethodResults.CreateChannel> {
    const existing = await this.channelRepository.findByUserPublicIdentifier(
      counterpartyPublicIdentifier,
    );
    if (existing) {
      throw new Error(`Channel already exists for ${counterpartyPublicIdentifier}`);
    }

    const createResult = await this.cfCoreService.createChannel(counterpartyPublicIdentifier);
    return createResult;
  }

  async rebalance(
    userPubId: string,
    assetId: string = AddressZero,
    rebalanceType: RebalanceType,
    minimumRequiredCollateral: BigNumber = Zero,
  ): Promise<void> {
    const normalizedAssetId = getAddress(assetId);
    const channel = await this.channelRepository.findByUserPublicIdentifierOrThrow(userPubId);

    // option 1: rebalancing service, option 2: rebalance profile, option 3: default
    let rebalancingTargets = await this.getDataFromRebalancingService(userPubId, assetId);
    if (!rebalancingTargets) {
      this.log.debug(`Unable to get rebalancing targets from service, falling back to profile`);
      rebalancingTargets = await this.channelRepository.getRebalanceProfileForChannelAndAsset(
        userPubId,
        normalizedAssetId,
      );
      if (!rebalancingTargets) {
        rebalancingTargets = await this.configService.getDefaultRebalanceProfile(assetId);
        if (rebalancingTargets) {
          this.log.debug(`Rebalancing with default profile: ${stringify(rebalancingTargets)}`);
        }
      }
    }

    if (!rebalancingTargets) {
      throw new Error(`Node is not configured to rebalance asset ${assetId} for user ${userPubId}`);
    }

    const {
      lowerBoundCollateralize,
      upperBoundCollateralize,
      lowerBoundReclaim,
      upperBoundReclaim,
    } = rebalancingTargets;

    if (
      upperBoundCollateralize.lt(lowerBoundCollateralize) ||
      upperBoundReclaim.lt(lowerBoundReclaim)
    ) {
      throw new Error(`Rebalancing targets not properly configured: ${rebalancingTargets}`);
    }
    if (rebalanceType === RebalanceType.COLLATERALIZE) {
      // if minimum amount is larger, override upper bound
      const collateralNeeded: BigNumber = maxBN([
        upperBoundCollateralize,
        minimumRequiredCollateral,
      ]);
      await this.collateralizeIfNecessary(
        channel,
        assetId,
        collateralNeeded,
        lowerBoundCollateralize,
      );
    } else if (rebalanceType === RebalanceType.RECLAIM) {
      await this.reclaimIfNecessary(channel, assetId, upperBoundReclaim, lowerBoundReclaim);
    } else {
      throw new Error(`Invalid rebalancing type: ${rebalanceType}`);
    }
  }

  private async collateralizeIfNecessary(
    channel: Channel,
    assetId: string,
    collateralNeeded: BigNumber,
    lowerBoundCollateral: BigNumber,
  ): Promise<TransactionReceipt> {
    if (channel.collateralizationInFlight) {
      this.log.warn(
        `Collateral request is in flight, try request again for user ${channel.userPublicIdentifier} later`,
      );
      return undefined;
    }

    const {
      [this.cfCoreService.cfCore.freeBalanceAddress]: nodeFreeBalance,
    } = await this.cfCoreService.getFreeBalance(
      channel.userPublicIdentifier,
      channel.multisigAddress,
      assetId,
    );
    if (nodeFreeBalance.gte(lowerBoundCollateral)) {
      this.log.debug(
        `User ${channel.userPublicIdentifier} already has collateral of ${nodeFreeBalance} for asset ${assetId}`,
      );
      return undefined;
    }

    const amountDeposit = collateralNeeded.sub(nodeFreeBalance);
    this.log.warn(
      `Collateralizing ${channel.userPublicIdentifier} with ${amountDeposit}, token: ${assetId}`,
    );

    // set in flight so that it cant be double sent
    await this.channelRepository.setInflightCollateralization(channel, true);
    let receipt;
    try {
      receipt = await this.depositService.deposit(channel, amountDeposit, assetId)
      this.log.info(`Channel ${channel.multisigAddress} successfully collateralized`);
      this.log.debug(`Collateralization result: ${stringify(receipt)}`);
    } catch (e) {
      throw e;
    }
    await this.clearCollateralizationInFlight(channel.multisigAddress);
    return receipt;
  }

  // collateral is reclaimed if it is above the upper bound
  private async reclaimIfNecessary(
    channel: Channel,
    assetId: string,
    upperBoundReclaim: BigNumber,
    lowerBoundReclaim: BigNumber,
  ): Promise<void> {
    if (upperBoundReclaim.isZero() && lowerBoundReclaim.isZero()) {
      this.log.info(
        `Collateral for channel ${channel.multisigAddress} is within bounds, nothing to reclaim.`,
      );
      return undefined;
    }
    const {
      [this.cfCoreService.cfCore.freeBalanceAddress]: nodeFreeBalance,
    } = await this.cfCoreService.getFreeBalance(
      channel.userPublicIdentifier,
      channel.multisigAddress,
      assetId,
    );
    if (nodeFreeBalance.lte(upperBoundReclaim)) {
      this.log.info(
        `Collateral for channel ${channel.multisigAddress} is below upper bound, nothing to reclaim.`,
      );
      this.log.debug(
        `Node has balance of ${nodeFreeBalance} for asset ${assetId} in channel with user ${channel.userPublicIdentifier}`,
      );
      return undefined;
    }

    // example:
    // freeBalance = 10
    // upperBound = 8
    // lowerBound = 6
    // amountWithdrawal = freeBalance - lowerBound = 10 - 6 = 4
    const amountWithdrawal = nodeFreeBalance.sub(lowerBoundReclaim);
    this.log.info(`Reclaiming collateral from channel ${channel.multisigAddress}`);
    this.log.debug(
      `Reclaiming ${channel.multisigAddress}, ${amountWithdrawal.toString()}, token: ${assetId}`,
    );

    await this.withdrawService.withdraw(channel, amountWithdrawal, assetId);
  }

  async clearCollateralizationInFlight(multisigAddress: string): Promise<Channel> {
    const channel = await this.channelRepository.findByMultisigAddress(multisigAddress);
    if (!channel) {
      throw new Error(`No channel exists for multisig ${multisigAddress}`);
    }

    return await this.channelRepository.setInflightCollateralization(channel, false);
  }

  async addRebalanceProfileToChannel(
    userPubId: string,
    profile: RebalanceProfileType,
  ): Promise<RebalanceProfile> {
    const {
      assetId,
      lowerBoundCollateralize,
      upperBoundCollateralize,
      lowerBoundReclaim,
      upperBoundReclaim,
    } = profile;
    if (
      upperBoundCollateralize.lt(lowerBoundCollateralize) ||
      upperBoundReclaim.lt(lowerBoundReclaim)
    ) {
      throw new Error(
        `Rebalancing targets not properly configured: ${JSON.stringify({
          lowerBoundCollateralize,
          upperBoundCollateralize,
          lowerBoundReclaim,
          upperBoundReclaim,
        })}`,
      );
    }

    // reclaim targets cannot be less than collateralize targets, otherwise we get into a loop of
    // collateralize/reclaim
    if (lowerBoundReclaim.lt(upperBoundCollateralize)) {
      throw new Error(
        `Reclaim targets cannot be less than collateralize targets: ${JSON.stringify({
          lowerBoundCollateralize,
          upperBoundCollateralize,
          lowerBoundReclaim,
          upperBoundReclaim,
        })}`,
      );
    }

    const rebalanceProfile = new RebalanceProfile();
    rebalanceProfile.assetId = getAddress(assetId);
    rebalanceProfile.lowerBoundCollateralize = lowerBoundCollateralize;
    rebalanceProfile.upperBoundCollateralize = upperBoundCollateralize;
    rebalanceProfile.lowerBoundReclaim = lowerBoundReclaim;
    rebalanceProfile.upperBoundReclaim = upperBoundReclaim;
    return await this.channelRepository.addRebalanceProfileToChannel(userPubId, rebalanceProfile);
  }

  /**
   * Creates a channel in the database with data from CF core event CREATE_CHANNEL
   * and marks it as available
   * @param creationData event data
   */
  async makeAvailable(creationData: CreateChannelMessage): Promise<void> {
    const existing = await this.channelRepository.findByMultisigAddress(
      creationData.data.multisigAddress,
    );
    if (!existing) {
      throw new Error(
        `Did not find existing channel, meaning "PERSIST_STATE_CHANNEL" failed in setup protocol`,
      );
    }
    if (
      !creationData.data.owners.includes(xkeyKthAddress(existing.nodePublicIdentifier)) ||
      !creationData.data.owners.includes(xkeyKthAddress(existing.userPublicIdentifier))
    ) {
      throw new Error(
        `Channel has already been created with different owners! ${stringify(
          existing,
        )}. Event data: ${stringify(creationData)}`,
      );
    }
    if (existing.available) {
      this.log.debug(`Channel is already available, doing nothing`);
      return;
    }
    this.log.debug(`Channel already exists in database, marking as available`);
    existing.available = true;
    await this.channelRepository.save(existing);
  }

  /**
   * Returns the app sequence number of the node and the user
   *
   * @param userPublicIdentifier users xpub
   * @param userSequenceNumber sequence number provided by user
   */
  async verifyAppSequenceNumber(
    userPublicIdentifier: string,
    userSequenceNumber: number,
  ): Promise<ChannelAppSequences> {
    const channel = await this.channelRepository.findByUserPublicIdentifierOrThrow(
      userPublicIdentifier,
    );
    const sc = (await this.cfCoreService.getStateChannel(channel.multisigAddress)).data;
    const [, appJson] = sc.appInstances.reduce((prev, curr) => {
      const [, prevJson] = prev;
      const [, currJson] = curr;
      return currJson.appSeqNo > prevJson.appSeqNo ? curr : prev;
    });
    const nodeSequenceNumber = appJson.appSeqNo;
    if (nodeSequenceNumber !== userSequenceNumber) {
      this.log.warn(
        `Node app sequence number (${nodeSequenceNumber}) !== user app sequence number (${userSequenceNumber})`,
      );
    }
    return {
      nodeSequenceNumber,
      userSequenceNumber,
    };
  }

  async getDataFromRebalancingService(
    userPublicIdentifier: string,
    assetId: string,
  ): Promise<RebalancingTargetsResponse<BigNumber> | undefined> {
    const rebalancingServiceUrl = this.configService.getRebalancingServiceUrl();
    if (!rebalancingServiceUrl) {
      this.log.debug(`Rebalancing service URL not configured`);
      return undefined;
    }

    const hashedPublicIdentifier = sha256(toUtf8Bytes(userPublicIdentifier));
    const {
      data: rebalancingTargets,
      status,
    }: AxiosResponse<RebalancingTargetsResponse<string>> = await this.httpService
      .get(
        `${rebalancingServiceUrl}/api/v1/recommendations/asset/${assetId}/channel/${hashedPublicIdentifier}`,
      )
      .toPromise();

    if (status !== 200) {
      this.log.warn(`Rebalancing service returned a non-200 response: ${status}`);
      return undefined;
    }
    return {
      assetId: rebalancingTargets.assetId,
      lowerBoundCollateralize: bigNumberify(rebalancingTargets.lowerBoundCollateralize),
      upperBoundCollateralize: bigNumberify(rebalancingTargets.upperBoundCollateralize),
      lowerBoundReclaim: bigNumberify(rebalancingTargets.lowerBoundReclaim),
      upperBoundReclaim: bigNumberify(rebalancingTargets.upperBoundReclaim),
    };
  }

  async getRebalanceProfileForChannelAndAsset(
    userPublicIdentifier: string,
    assetId: string = AddressZero,
  ): Promise<RebalanceProfile | undefined> {
    // try to get rebalance profile configured
    let profile = await this.channelRepository.getRebalanceProfileForChannelAndAsset(
      userPublicIdentifier,
      assetId,
    );
    return profile;
  }

  async getStateChannel(userPublicIdentifier: string): Promise<StateChannelJSON> {
    const channel = await this.channelRepository.findByUserPublicIdentifier(userPublicIdentifier);
    if (!channel) {
      throw new Error(`No channel exists for userPublicIdentifier ${userPublicIdentifier}`);
    }
    const { data: state } = await this.cfCoreService.getStateChannel(channel.multisigAddress);

    return state;
  }

  async getStateChannelByMultisig(multisigAddress: string): Promise<StateChannelJSON> {
    const channel = await this.channelRepository.findByMultisigAddress(multisigAddress);
    if (!channel) {
      throw new Error(`No channel exists for multisigAddress ${multisigAddress}`);
    }
    const { data: state } = await this.cfCoreService.getStateChannel(multisigAddress);

    return state;
  }

  async getAllChannels(): Promise<Channel[]> {
    const channels = await this.channelRepository.findAll();
    if (!channels) {
      throw new Error(`No channels found. This should never happen`);
    }
    return channels;
  }
}
