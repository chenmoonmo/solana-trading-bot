import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createMint,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  LIQUIDITY_STATE_LAYOUT_V4,
  MAINNET_PROGRAM_ID,
  DEVNET_PROGRAM_ID,
  MARKET_STATE_LAYOUT_V3,
  Token,
  publicKey,
} from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { COMMITMENT_LEVEL, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from './helpers';

(async function main() {
  const connection = new Connection(RPC_ENDPOINT, {
    // wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
    commitment: COMMITMENT_LEVEL,
  });

  const fromWallet = Keypair.fromSecretKey(
    Buffer.from([
      118, 115, 173, 31, 167, 164, 242, 27, 166, 207, 55, 178, 53, 100, 176, 148, 151, 19, 221, 81, 62, 234, 180, 69,
      145, 75, 87, 224, 109, 204, 152, 227, 13, 219, 36, 193, 2, 94, 124, 16, 188, 68, 97, 158, 13, 96, 191, 216, 77,
      16, 119, 188, 238, 87, 134, 136, 88, 211, 15, 96, 33, 170, 3, 107,
    ]),
  );

  const toWallet = Keypair.generate();

  const mint = new PublicKey('AmY274sN59rwT6SKk6yeX4cS3w1AKzwHQrinToyyyfP5');

  const fromTokenAccount = await getOrCreateAssociatedTokenAccount(connection, fromWallet, mint, fromWallet.publicKey);

  const toTokenAccount = await getAssociatedTokenAddress(mint, toWallet.publicKey);

  const instruction = createTransferInstruction(fromTokenAccount.address, toTokenAccount, fromWallet.publicKey, 1);

  let transactions = [];

  const latestBlockhash = await connection.getLatestBlockhash(COMMITMENT_LEVEL);

  console.log(latestBlockhash);

  for (let i = 0; i < 10; i++) {
    const messageV0 = new TransactionMessage({
      payerKey: fromWallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          fromWallet.publicKey,
          toTokenAccount,
          toWallet.publicKey,
          mint,
        ),
        instruction,
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    transaction.sign([fromWallet]);

    transactions.push(transaction);
  }

  const results = await Promise.all(
    transactions.map(async (transaction, i) => {
      const signature = await connection.sendRawTransaction(transaction.serialize());

      console.log(`Sent transaction ${i} with signature: ${signature}`);

      return connection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        'confirmed',
      );
    }),
  );

  console.log('done', results);
})();
