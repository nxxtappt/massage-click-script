const { chromium } = require("playwright");

function formatZenotiDate(date) {
  return date.toISOString().split("T")[0] + " 00:00:00";
}

async function safeClick(page, text, timeout = 15000) {
  console.log(`[ZENOTI] Trying click: ${text}`);

  await page.waitForTimeout(2000);

  const locator = page.getByText(text, {
    exact: false
  }).first();

  const count = await page
    .getByText(text, {
      exact: false
    })
    .count()
    .catch(() => 0);

  console.log(`[ZENOTI] Matches for "${text}": ${count}`);

  if (!count) {
    return false;
  }

  try {
    await locator.scrollIntoViewIfNeeded();

    await locator.click({
      timeout
    });

    await page.waitForTimeout(5000);

    return true;
  } catch (error) {
    try {
      await locator.evaluate((el) => el.click());

      await page.waitForTimeout(5000);

      return true;
    } catch (innerError) {
      console.log(`[ZENOTI] Failed clicking "${text}"`);
      return false;
    }
  }
}

async function scrapeZenoti(business, options = {}) {
  const {
    serviceName = "",
    daysAhead = 7
  } = options;

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1400,
      height: 1200
    }
  });

  let authToken = null;
  let basePayload = null;
  let availableTimesUrl = null;

  try {
    page.on("request", (request) => {
      const url = request.url();

      if (url.includes("/Appointments/Availabletimes")) {
        availableTimesUrl = url;

        const headers = request.headers();

        if (headers.authorization) {
          authToken = headers.authorization;
        }

        try {
          const payload = request.postDataJSON();

          if (payload?.SlotBookings) {
            basePayload = payload;
          }
        } catch (error) {
          // ignore
        }
      }
    });

    console.log(`\n[ZENOTI] Opening ${business.businessName}`);

    await page.goto(business.bookingUrl, {
      waitUntil: "networkidle",
      timeout: 90000
    });

    await page.waitForTimeout(10000);

    /*
      CATEGORY
    */

    if (business.categoryText) {
      const categoryClicked = await safeClick(
        page,
        business.categoryText
      );

      console.log(
        `[ZENOTI] Category clicked: ${categoryClicked}`
      );

      await page.waitForTimeout(8000);
    }

    /*
      PARENT SERVICE
    */

    if (business.parentServiceText) {
      const parentClicked = await safeClick(
        page,
        business.parentServiceText,
        20000
      );

      if (!parentClicked) {
        throw new Error(
          `Could not click parent service: ${business.parentServiceText}`
        );
      }

      console.log(
        `[ZENOTI] Parent service clicked`
      );

      await page.waitForTimeout(8000);
    }

    /*
      VARIANT / SERVICE
    */

    const serviceClicked = await safeClick(
      page,
      serviceName,
      20000
    );

    if (!serviceClicked) {
      throw new Error(
        `Could not click service: ${serviceName}`
      );
    }

    /*
      PROVIDER
    */

    if (business.providerText) {
      console.log(
        `[ZENOTI] Attempting provider selection: ${business.providerText}`
      );

      await page.waitForTimeout(5000);

      const providerClicked = await safeClick(
        page,
        business.providerText,
        15000
      );

      console.log(
        `[ZENOTI] Provider clicked: ${providerClicked}`
      );

      await page.waitForTimeout(12000);
    } else {
      await page.waitForTimeout(12000);
    }

    if (!authToken) {
      throw new Error(
        "Could not capture Zenoti auth token"
      );
    }

    if (!basePayload) {
      throw new Error(
        "Could not capture Zenoti availability payload"
      );
    }

    if (!availableTimesUrl) {
      throw new Error(
        "Could not capture Zenoti availability URL"
      );
    }

    console.log("[ZENOTI] Auth token captured");
    console.log("[ZENOTI] Base payload captured");

    const results = [];

    for (let i = 0; i < daysAhead; i++) {
      const payload = JSON.parse(
        JSON.stringify(basePayload)
      );

      const date = new Date();
      date.setDate(date.getDate() + i);

      payload.CenterDate = formatZenotiDate(date);
      payload.CheckFutureDayAvailability = true;

      console.log(
        `[ZENOTI] Checking ${payload.CenterDate}`
      );

      const response = await page.evaluate(
        async ({
          availableTimesUrl,
          payload,
          authToken
        }) => {
          const res = await fetch(
            availableTimesUrl,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: authToken,
                application_name: "Webstore V2",
                application_version: "1.0.0",
                "x-languagecode": "en-US"
              },
              body: JSON.stringify(payload)
            }
          );

          return await res.json();
        },
        {
          availableTimesUrl,
          payload,
          authToken
        }
      );

      const slots = response.OpenSlots || [];

      console.log(
        `[ZENOTI] Slots found: ${slots.length}`
      );

      for (const slot of slots) {
        results.push({
          businessName: business.businessName,
          platform: "zenoti",
          service: serviceName,
          date: slot.Time,
          time: slot.Time,
          bookingUrl: business.bookingUrl
        });
      }
    }

    await browser.close();

    return {
      success: true,
      businessName: business.businessName,
      platform: "zenoti",
      totalAppointments: results.length,
      appointments: results
    };
  } catch (error) {
    await browser.close();

    return {
      success: false,
      businessName: business.businessName,
      platform: "zenoti",
      error: error.message
    };
  }
}

module.exports = {
  scrapeZenoti
};