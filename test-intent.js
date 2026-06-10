const { buildSearchIntent } = require("./searchIntentEngine");

const tests = [
  "massage may 28",
  "prenatal may 28",
  "prenatal massage may 28 between 2 and 6pm",
  "massage tomorrow between 2 and 6pm",
  "deep tissue tomorrow after 3pm",
  "massage before 6pm",
  "90 minute massage tomorrow",
  "2 hour deep tissue",
  "i need a massage asap",
  "pregnancy massage this weekend",
  "swedish massage friday morning",
  "deep tissue around 4pm friday"
];

for (const search of tests) {
  console.log("\n==============================");
  console.log("SEARCH:", search);
  console.log("==============================");
  console.log(
    JSON.stringify(
      buildSearchIntent({ search }),
      null,
      2
    )
  );
}