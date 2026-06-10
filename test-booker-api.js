const axios = require("axios");

async function testBookerAPI() {
  try {
    const url =
      "https://api.booker.com/cf2/v5/availability/availability";

    const response = await axios.get(url, {
      params: {
        IncludeEmployees: true,
        fromDateTime: "2026-05-15T00:00:00-05:00",
        toDateTime: "2026-05-15T23:59:00-05:00",
        "locationIds[]": 44118,
        serviceId: 4375234
      },
      headers: {
        accept: "application/json"
      }
    });

    console.log("\n===== BOOKER API RESPONSE =====");
    console.log(JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error("\n===== BOOKER API ERROR =====");

    if (error.response) {
      console.error(error.response.status);
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

testBookerAPI();