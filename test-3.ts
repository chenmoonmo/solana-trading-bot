import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { LIQUIDITY_STATE_LAYOUT_V4, Liquidity, LiquidityPoolKeysV4, TokenAmount, WSOL } from '@raydium-io/raydium-sdk';
import { ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import base58 from 'bs58';
import {
  COMMITMENT_LEVEL,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE,
  createPoolKeys,
  CUSTOM_FEE,
  getMinimalMarketV3,
  getToken,
  getWallet,
  GRPC_ENDPOINT,
  GRPC_TOKEN,
  NETWORK,
  PRIVATE_KEY,
  QUOTE_AMOUNT,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  TRANSACTION_EXECUTOR,
} from './helpers';
import { DefaultTransactionExecutor, TransactionExecutor } from './transactions';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';

const snipeList = ['AUVtwSnuSb4DkUixSKKa92z9BXrkRK3B1DvVQFTqpump'];

(async function main() {
  const connection = new Connection(RPC_ENDPOINT, {
    // wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
    commitment: COMMITMENT_LEVEL,
  });

  const wallet = getWallet(PRIVATE_KEY.trim());
  let quoteToken = getToken('WSOL');
  const ataIn = getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey);

  let txExecutor: TransactionExecutor;

  switch (TRANSACTION_EXECUTOR) {
    case 'warp': {
      txExecutor = new WarpTransactionExecutor(CUSTOM_FEE);
      break;
    }
    case 'jito': {
      txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);
      break;
    }
    default: {
      txExecutor = new DefaultTransactionExecutor(connection);
      break;
    }
  }

  const client = new Client(GRPC_ENDPOINT, GRPC_TOKEN, {});

  const programId = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
  const createPoolFeeAccount = '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5';
  const rpcConnInfo = await client.subscribe();

  rpcConnInfo.on('data', async (data: any) => {
    if (!data.filters.includes('pool')) return undefined;

    const info = data.transaction;
    if (info.transaction.meta.err !== undefined) return undefined;

    const accounts = info.transaction.transaction.message.accountKeys.map((i: Buffer) => base58.encode(i));

    for (const item of [
      ...info.transaction.transaction.message.instructions,
      ...info.transaction.meta.innerInstructions.map((i: any) => i.instructions).flat(),
    ]) {
      if (accounts[item.programIdIndex] !== programId) continue;

      if ([...(item.data as Buffer).values()][0] != 1) continue;

      const keyIndex = [...(item.accounts as Buffer).values()];

      let pairAccount = await connection.getAccountInfo(new PublicKey(accounts[keyIndex[4]]));
      if (pairAccount === null) {
        console.log('get account info error');
        return;
      }

      let poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(pairAccount!.data);

      console.log({
        signature: base58.encode(data.transaction.transaction.signature).toString(),
        baseMint: poolState.baseMint.toString(),
        quoteMint: poolState.quoteMint.toString(),
        time: +new Date(),
      });

      // if (poolState.status.toNumber() !== 6) continue;

      const market = await getMinimalMarketV3(connection, new PublicKey(poolState.marketId), COMMITMENT_LEVEL);
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(accounts[keyIndex[4]]), poolState, market);

      let baseMint = poolState.quoteMint.equals(new PublicKey(WSOL.mint)) ? poolState.baseMint : poolState.quoteMint;

      if (!snipeList.includes(baseMint.toString())) {
        console.log(baseMint.toString(), 'Not in snipe list');
        return;
      }

      const ataOut = getAssociatedTokenAddressSync(baseMint, wallet.publicKey);

      const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: poolKeys,
          userKeys: {
            tokenAccountIn: ataIn,
            tokenAccountOut: ataOut,
            owner: wallet.publicKey,
          },
          amountIn: new TokenAmount(quoteToken, QUOTE_AMOUNT, false).raw,
          minAmountOut: 0,
        },
        poolKeys.version,
      );

      const latestBlockhash = await connection.getLatestBlockhash();

      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
          createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ataOut, wallet.publicKey, baseMint),
          ...innerTransaction.instructions,
        ],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([wallet, ...innerTransaction.signers]);

      console.log('executeAndConfirm', +new Date());

      const result = await txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);

      if (result.confirmed) {
        console.log(
          {
            time: +new Date(),
            mint: baseMint.toString(),
            signature: result.signature,
            url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
          },
          `Confirmed buy tx,${+new Date()}`,
        );
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    if (rpcConnInfo === undefined) throw Error('rpc conn error');
    rpcConnInfo.write(
      {
        slots: {},
        accounts: {},
        transactions: {
          pool: {
            accountInclude: [createPoolFeeAccount],
            accountExclude: [],
            accountRequired: [],
          },
        },
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        entry: {},
        commitment: 1,
      },
      (err: Error) => {
        if (err === null || err === undefined) {
          resolve();
        } else {
          reject(err);
        }
      },
    );
  }).catch((reason) => {
    console.error(reason);
    throw reason;
  });
})();
