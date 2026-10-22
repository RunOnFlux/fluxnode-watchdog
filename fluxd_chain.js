/**
 * Which chain the node's fluxd is on, and whether the explorer sync check
 * applies to it.
 *
 * The sync check compares fluxd's height with the Flux explorers, which serve
 * mainnet only. On any other chain (testnet, labnet, regtest) the comparison
 * always reads "not synced" and the fix restarts a healthy fluxd, so the
 * check runs on mainnet alone.
 */

/**
 * The chain named by `getblockchaininfo`'s output.
 * @param {{stdout?: string}} [result] - The command's result.
 * @returns {string|null} The chain, or null when the output names none
 *   (fluxd not answering, still loading, or unreadable output).
 */
function fluxdChain(result) {
  try {
    const { chain } = JSON.parse(result.stdout);

    return typeof chain === 'string' && chain !== '' ? chain : null;
  } catch {
    return null;
  }
}

/**
 * Whether the explorer sync check applies to a node on `chain`.
 * @param {string|null|undefined} chain
 * @returns {boolean} True on mainnet only; an unknown chain is not mainnet.
 */
function syncCheckApplies(chain) {
  return chain === 'main';
}

/**
 * One cycle's sync check. The check runs on a random half of cycles; on those,
 * fluxd's chain is read and the check runs on mainnet only. The chain is read
 * every time, so a fluxd restarted on another chain is seen at its next check.
 * @param {object} deps
 * @param {() => number} deps.roll - 1 to 4; the check runs above 2.
 * @param {() => Promise<{stdout?: string}>} deps.readChainInfo - Runs `getblockchaininfo`.
 * @param {() => Promise<void>} deps.checkSync - The explorer sync check.
 * @param {(line: string) => void} deps.log
 */
async function runSyncCheck({ roll, readChainInfo, checkSync, log }) {
  const skip_sync = roll();
  if (skip_sync <= 2) {
    log(`Sync check skipped: ${skip_sync} <= 2`);

    return;
  }
  const chain = fluxdChain(await readChainInfo());
  if (syncCheckApplies(chain)) {
    await checkSync();
  } else if (chain !== null) {
    log(`Sync check off: the explorers it compares with serve mainnet, and fluxd is on ${chain}`);
  }
}

module.exports = { fluxdChain, syncCheckApplies, runSyncCheck };
