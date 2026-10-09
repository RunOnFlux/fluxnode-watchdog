/**
 * What systemd says about fluxos.service.
 *
 * On Arcane, fluxos is a notify unit: it is `activating` from its start until
 * its API listens, which on a UPnP node includes the router check. A FluxOS
 * that does not answer while the unit is activating is starting, not
 * disconnected. Under pm2 there is no unit state to read.
 *
 * @param {{stdout?: string}} result - `systemctl show fluxos.service -p ActiveState --value` output.
 * @returns {boolean} Whether the unit is still activating.
 */
function fluxosUnitStarting({ stdout = '' } = {}) {
  return stdout.trim() === 'activating';
}

module.exports = { fluxosUnitStarting };
