'use strict';
const path = require('path');
const { fork } = require('child_process');

// Runs within the already-paid scheduler service. No scrape queues or settings are changed.
function createCompanion(options = {}) {
  const launch = options.fork || fork;
  const later = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  const logger = options.logger || console;
  let child = null;
  let restartTimer = null;
  let killTimer = null;
  let stopped = true;
  let failures = 0;
  function log(message) { logger.log('[MARKET ANALYTICS] ' + message); }
  function retry() {
    if (stopped || restartTimer) return;
    failures += 1;
    const delay = Math.min(60000, 5000 * 2 ** Math.min(failures - 1, 4));
    log(`Companion stopped; retrying in ${delay / 1000}s. Scrape scheduling continues.`);
    restartTimer = later(() => { restartTimer = null; spawn(); }, delay);
    restartTimer.unref?.();
  }
  function spawn() {
    if (stopped || child) return;
    let next;
    try {
      next = launch(path.join(__dirname, '../scripts/market-analytics.js'), ['worker'], {
        cwd: path.join(__dirname, '..'),
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, MARKET_ANALYTICS_HOST: 'existing-scheduler' }
      });
    } catch (error) {
      logger.error('[MARKET ANALYTICS] Could not launch:', error.message);
      retry();
      return;
    }
    child = next;
    let finished = false;
    const onFinished = () => {
      if (finished) return;
      finished = true;
      if (child === next) child = null;
      if (killTimer) { cancel(killTimer); killTimer = null; }
      retry();
    };
    next.on('error', error => logger.error('[MARKET ANALYTICS] Process error:', error.message));
    next.once('exit', onFinished);
    next.once('close', onFinished);
    log('Companion started on the existing scheduler. Chicago captures: 1 p.m. and 11 p.m.');
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      failures = 0;
      spawn();
    },
    stop() {
      stopped = true;
      if (restartTimer) { cancel(restartTimer); restartTimer = null; }
      if (!child) return;
      const current = child;
      current.kill('SIGTERM');
      // Bound shutdown so an analytics query cannot hold the scheduler deployment open.
      killTimer = later(() => {
        killTimer = null;
        if (child === current) current.kill('SIGKILL');
      }, 10000);
      killTimer.unref?.();
    }
  };
}
let companion;
function startAnalyticsCompanion() {
  if (String(process.env.MARKET_ANALYTICS_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[MARKET ANALYTICS] Disabled by MARKET_ANALYTICS_ENABLED=false.');
    return;
  }
  try {
    if (!companion) companion = createCompanion();
    companion.start();
  } catch (error) {
    console.error('[MARKET ANALYTICS] Startup failed; scrape scheduler continues:', error.message);
  }
}
function stopAnalyticsCompanion() { companion?.stop(); }
module.exports = { createCompanion, startAnalyticsCompanion, stopAnalyticsCompanion };
