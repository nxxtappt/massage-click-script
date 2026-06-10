require("dotenv").config();

const {
  getMindbodyServices
} = require("./mindbodyApiClient");

(async () => {
  const data = await getMindbodyServices("dimensions-mindbody-main", {
    locationId: 1,
    limit: 5
  });

  console.log(JSON.stringify(data, null, 2));
})().catch((error) => {
  console.error(error.message);
});
