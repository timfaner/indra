import { config } from "dotenv";
import { Wallet } from "ethers";
config();

export const env = {
  contractAddresses: JSON.parse(process.env.INDRA_CONTRACT_ADDRESSES || "{}"),
  chainProviders: JSON.parse(process.env.INDRA_CHAIN_PROVIDERS || "{}"),
  defaultChain: parseInt(process.env.INDRA_DEFAULT_CHAIN || "1337", 10),
  logLevel: parseInt(process.env.INDRA_CLIENT_LOG_LEVEL || "3", 10),
  mnemonic: process.env.INDRA_MNEMONIC || "",
  nodeUrl: process.env.INDRA_NODE_URL || "http://indra:80",
  natsUrl: process.env.INDRA_NATS_URL || "nats://indra:4222",
  storeDir: process.env.STORE_DIR || "",
  adminToken: process.env.INDRA_ADMIN_TOKEN || "cxt1234",
  natsPrivateKey: process.env.INDRA_NATS_JWT_SIGNER_PRIVATE_KEY,
  natsPublicKey: process.env.INDRA_NATS_JWT_SIGNER_PUBLIC_KEY,
  nodePubId: Wallet.fromMnemonic(process.env.INDRA_MNEMONIC!).address,
};
