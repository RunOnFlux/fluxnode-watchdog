/**
 * What systemd says about fluxos.service.
 *
 * fluxos is a notify unit: it is `activating` from its start until FluxOS
 * reports ready, which waits on fluxd's warm-up or reindex. A FluxOS that
 * does not answer while the unit is activating is starting, not disconnected.
 *
 * @param {{stdout?: string}} result - `systemctl show fluxos.service -p ActiveState --value` output.
 * @returns {boolean} Whether the unit is still activating.
 */
function fluxosUnitStarting({ stdout = '' } = {}) {
  return stdout.trim() === 'activating';
}

module.exports = { fluxosUnitStarting };
