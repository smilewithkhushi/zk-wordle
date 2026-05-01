import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { zkVerifySession, ZkVerifyEvents, UltrahonkVariant } from 'zkverifyjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PROOF_PATH         = join(__dirname, '../circuit/target/proof');
const VK_PATH            = join(__dirname, '../circuit/target/vk');
const PUBLIC_INPUTS_PATH = join(__dirname, '../circuit/target/public_inputs');
const OUT_PATH           = join(__dirname, '../circuit/aggregation.json');

// ---------------------------------------------------------------------------
// Read binary files as 0x-prefixed hex strings
// ---------------------------------------------------------------------------
function readHex(filePath) {
  const bytes = readFileSync(filePath);
  return '0x' + bytes.toString('hex');
}

// Read public_inputs binary as array of 0x-prefixed 32-byte field elements
function readPublicInputs(filePath) {
  const bytes = readFileSync(filePath);
  const fields = [];
  for (let i = 0; i < bytes.length; i += 32) {
    fields.push('0x' + bytes.slice(i, i + 32).toString('hex'));
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const seedPhrase = process.env.SEED_PHRASE;
  if (!seedPhrase) throw new Error('SEED_PHRASE not set in .env.local');

  console.log('[1/5] Reading proof artifacts...');
  const proof = readHex(PROOF_PATH);
  const vk    = readHex(VK_PATH);
  console.log('      proof size:', proof.length / 2 - 1, 'bytes');
  console.log('      vk size:   ', vk.length / 2 - 1, 'bytes');
  console.log('      public inputs: none (all private)');

  // -------------------------------------------------------------------------
  // Open ZKVerify session on Volta Testnet
  // -------------------------------------------------------------------------
  console.log('\n[2/5] Connecting to ZKVerify Volta Testnet...');
  const session = await zkVerifySession.start()
    .Volta()
    .withAccount(seedPhrase);
  console.log('      Connected.');

  // -------------------------------------------------------------------------
  // Track statement + aggregationId from IncludedInBlock event
  // Subscribe to NewAggregationReceipt filtered to our aggregationId
  // -------------------------------------------------------------------------
  let statement, aggregationId;

  session.subscribe([
    {
      event: ZkVerifyEvents.NewAggregationReceipt,
      callback: async (eventData) => {
        const receiptAggId = parseInt(eventData.data.aggregationId.replace(/,/g, ''));
        if (aggregationId !== receiptAggId) return; // not our batch

        console.log('\n[4/5] Aggregation receipt received:');
        console.log('      aggregationId:', receiptAggId);
        console.log('      domainId:     ', eventData.data.domainId);

        try {
          const path = await session.getAggregateStatementPath(
            eventData.blockHash,
            parseInt(eventData.data.domainId),
            receiptAggId,
            statement
          );

          const result = {
            ...path,
            domainId:      parseInt(eventData.data.domainId),
            aggregationId: receiptAggId,
          };

          console.log('\n[5/5] Writing aggregation.json...');
          writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
          console.log('      Saved to:', OUT_PATH);
          console.log('\n--- aggregation.json ---');
          console.log(JSON.stringify(result, null, 2));
          console.log('\nDone. Ready for on-chain verification on Sepolia.');
          await session.close();
          process.exit(0);
        } catch (err) {
          console.error('Fatal:', err.message);
          process.exit(1);
        }
      },
      options: { domainId: 0 },
    },
  ]);

  // -------------------------------------------------------------------------
  // Submit proof to ZKVerify
  // -------------------------------------------------------------------------
  console.log('\n[3/5] Submitting UltraHonk proof to ZKVerify...');

  const { events } = await session
    .verify()
    .ultrahonk({ variant: UltrahonkVariant.Plain })
    .execute({
      proofData: {
        vk,
        proof,
        publicSignals: [],
      },
      domainId: 0,
    });

  events.on(ZkVerifyEvents.IncludedInBlock, (eventData) => {
    console.log('\n      Proof included in ZKVerify block:');
    console.log('      txHash:       ', eventData.txHash);
    console.log('      aggregationId:', eventData.aggregationId);
    console.log('      statement:    ', eventData.statement);
    statement     = eventData.statement;
    aggregationId = eventData.aggregationId;
  });

  events.on('error', (err) => {
    console.error('\n      Submission error:', err.message);
  });

  console.log('\n      Waiting for block inclusion then aggregation (2–5 min)...');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
