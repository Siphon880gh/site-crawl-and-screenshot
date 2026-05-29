'use strict';

const fs = require('fs');

/**
 * Verify that Puppeteer is installed and a Chrome/Chromium binary is available
 * and actually launchable. Returns a structured report instead of throwing so
 * callers (server startup + UI) can present it nicely.
 */
async function checkHealth() {
  const report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    puppeteer: { ok: false },
    chrome: { ok: false },
    launch: { ok: false },
  };

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
    let version = null;
    try {
      version = require('puppeteer/package.json').version;
    } catch (_) {
      /* version is best-effort */
    }
    report.puppeteer = { ok: true, version };
  } catch (err) {
    report.puppeteer = {
      ok: false,
      error: `Puppeteer is not installed: ${err.message}. Run "npm install".`,
    };
    return report;
  }

  let executablePath = null;
  try {
    executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
    const exists = executablePath && fs.existsSync(executablePath);
    report.chrome = {
      ok: !!exists,
      executablePath,
      error: exists
        ? undefined
        : `Chrome executable not found at "${executablePath}". Run "npx puppeteer browsers install chrome".`,
    };
  } catch (err) {
    report.chrome = {
      ok: false,
      error: `Could not resolve Chrome executable: ${err.message}`,
    };
  }

  // Try an actual launch — this is the real proof Chrome works.
  let browser;
  try {
    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    if (executablePath && fs.existsSync(executablePath)) {
      launchOpts.executablePath = executablePath;
    }
    browser = await puppeteer.launch(launchOpts);
    const version = await browser.version();
    report.launch = { ok: true, browserVersion: version };
    report.chrome.ok = true; // launch succeeding implies a usable binary
  } catch (err) {
    report.launch = {
      ok: false,
      error: `Failed to launch Chrome: ${err.message}`,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {
        /* ignore */
      }
    }
  }

  report.ok =
    report.puppeteer.ok && report.chrome.ok && report.launch.ok;
  return report;
}

module.exports = { checkHealth };

// Allow running directly: `npm run health`
if (require.main === module) {
  checkHealth()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
