/**
 * What systemd says about fluxos.service.
 *
 * On Arcane, fluxos is a notify unit ordered after fluxd: its start waits in a
 * queued job until fluxd is ready, then the unit is `activating` until its API
 * listens. Waiting, the unit is `inactive` with that job. Either way a FluxOS
 * that does not answer is starting, not disconnected. Under pm2 there is no
 * unit state to read.
 *
 * @param {{stdout?: string}} result - `systemctl show fluxos.service -p ActiveState -p Job` output.
 * @returns {boolean} Whether systemd is starting the unit.
 */
function fluxosUnitStarting({ stdout = '' } = {}) {
  const property = (name) => {
    const match = stdout.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  };
  const state = property('ActiveState');
  return state === 'activating' || (state === 'inactive' && property('Job') !== '');
}

module.exports = { fluxosUnitStarting };
