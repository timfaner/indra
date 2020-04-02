import { MinimalTransaction, Contract, stringify } from "@connext/types";
import { Injectable } from "@nestjs/common";
import { TransactionResponse } from "ethers/providers";
import { AddressZero } from "ethers/constants";
import tokenAbi from "human-standard-token-abi";

import { Channel } from "../channel/channel.entity";
import { ConfigService } from "../config/config.service";

import { OnchainTransactionRepository } from "./onchainTransaction.repository";
import { LoggerService } from "../logger/logger.service";

const NO_TX_HASH = "no transaction hash found in tx response";
export const MAX_RETRIES = 3;
export const KNOWN_ERRORS = [
  "the tx doesn't have the correct nonce",
  NO_TX_HASH,
];

@Injectable()
export class OnchainTransactionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly onchainTransactionRepository: OnchainTransactionRepository,
    private readonly log: LoggerService,
  ) {
    this.log.setContext("OnchainTransactionService");
  }

  async sendWithdrawalCommitment(
    channel: Channel,
    transaction: MinimalTransaction,
  ): Promise<TransactionResponse> {
    const tx = await this.sendTransaction(transaction);
    await this.onchainTransactionRepository.addReclaim(tx, channel);
    return tx;
  }

  async sendWithdrawal(
    channel: Channel,
    transaction: MinimalTransaction,
  ): Promise<TransactionResponse> {
    const tx = await this.sendTransaction(transaction);
    await this.onchainTransactionRepository.addWithdrawal(tx, channel);
    return tx;
  }

  async sendDeposit(
    channel: Channel,
    transaction: MinimalTransaction,
    assetId: string,
  ): Promise<TransactionResponse> {
    let tx;
    if (assetId == AddressZero) {
      tx = await this.sendTransaction(transaction);
    } else {
      const token = new Contract(assetId!, tokenAbi, this.configService.getEthProvider());
      tx = await token.functions.transfer(transaction.to, transaction.value);
    }
    await this.onchainTransactionRepository.addCollateralization(tx, channel);
    return tx
  }

  private async sendTransaction(
    transaction: MinimalTransaction,
  ): Promise<TransactionResponse> {
    const wallet = this.configService.getEthWallet();
    let errors: {[k: number]: string} = [];
    for (let attempt = 1; attempt < MAX_RETRIES + 1; attempt += 1) {
      try {
        this.log.debug(`Attempt ${attempt}/${MAX_RETRIES} to send transaction`);
        const tx = await wallet.sendTransaction({ 
          ...transaction,
          nonce: await wallet.getTransactionCount(),
        });
        if (!tx.hash) {
          throw new Error(NO_TX_HASH);
        }
        this.log.debug(`Success! Tx hash: ${tx.hash}`);
        return tx;
      } catch (e) {
        errors[attempt] = e.message;
        const knownErr = KNOWN_ERRORS.filter(err => e.message.includes(err))[0];
        if (!knownErr) {
          this.log.error(`Transaction failed to send with unknown error: ${stringify(e)}`);
          throw new Error(e.stack || e.message);
        }
        // known error, retry
        this.log.warn(`Sending transaction attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}. Retrying.`);
      }
    }
    throw new Error(`Failed to send transaction (errors indexed by attempt): ${stringify(errors, 2)}`);
  }
}
