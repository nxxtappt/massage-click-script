// Consumer verification request example
async function verifyConsumerLegalExample(email, code) {
  return fetch("/api/user/auth/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      code,
      acceptance: window.NextApptLegal.consumerPayload()
    })
  });
}

// Business verification request example
async function verifyBusinessLegalExample(email, code) {
  return fetch("/api/business-dashboard/auth/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      code,
      acceptance: window.NextApptLegal.businessPayload()
    })
  });
}