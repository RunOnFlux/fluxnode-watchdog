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

module.exports = { fluxdChain, syncCheckApplies };
