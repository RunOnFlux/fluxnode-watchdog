// An update check asked for now: SIGUSR2 (`pm2 sendSignal SIGUSR2 watchdog`) asks, and the job
// loop runs auto_update at its next pass, so an asked-for check never overlaps a scheduled one
// and is the same check. The schedule's own count goes on as before.

function createUpdateRequest() {
  let asked = false;
  return {
    ask() {
      asked = true;
    },
    // True once for each time it was asked since the last take.
    take() {
      const was = asked;
      asked = false;
      return was;
    },
  };
}

// Whether this pass of the job loop runs auto_update: when asked, or when the schedule comes round.
function updateDue(request, jobCount, every) {
  const askedFor = request.take();
  return askedFor || jobCount % every === 0;
}

module.exports = { createUpdateRequest, updateDue };
