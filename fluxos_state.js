/**
 * What systemd says about fluxos.service.
 *
 * On Arcane, fluxos is a notify unit ordered after the units it reads at
 * startup (mongod, syncthing, fluxbenchd): its start waits in a queued job until
 * they are ready, then the unit is `activating` until its API listens. Waiting,
 * the unit is `inactive` with that job. Either way a FluxOS that does not answer
 * is starting, not disconnected. Under pm2 there is no unit state to read.
 *
 * Only the first attempt since the unit was last started counts. systemd's own
 * restarts after a failure are `activating` too, both while it waits to restart
 * (`auto-restart`) and on each new attempt; `NRestarts` counts those attempts
 * and returns to 0 on any start or restart from outside. A FluxOS that crashes
 * or times out at every start is disconnected.
 *
 * @param {{stdout?: string}} result - `systemctl show fluxos.service -p ActiveState -p SubState -p Job -p NRestarts` output.
 * @returns {boolean} Whether systemd is starting the unit.
 */
function fluxosUnitStarting({ stdout = '' } = {}) {
  const property = (name) => {
    const match = stdout.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  };
  const state = property('ActiveState');
  if (state === 'inactive') return property('Job') !== '';
  return state === 'activating'
    && ['start-pre', 'start', 'start-post'].includes(property('SubState'))
    && property('NRestarts') === '0';
}

module.exports = { fluxosUnitStarting };
