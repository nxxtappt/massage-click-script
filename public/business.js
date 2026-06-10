let businesses = [];

const claimBusinessSelect = document.getElementById("claimBusinessSelect");
const credentialBusinessSelect = document.getElementById("credentialBusinessSelect");
const businessList = document.getElementById("businessList");

const claimStatus = document.getElementById("claimStatus");
const credentialStatus = document.getElementById("credentialStatus");

const apiProvider = document.getElementById("apiProvider");
const mindbodyFields = document.getElementById("mindbodyFields");

function getClaimBusinessNameFromUrl() {
  const params = new URLSearchParams(window.location.search);

  return (
    params.get("businessName") ||
    params.get("business") ||
    ""
  );
}

function setStatus(element, message) {
  if (!element) return;
  element.textContent = message;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderBusinessOptions() {
  const options = businesses
    .map((business) => {
      const name = business.businessName || "";
      return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    })
    .join("");

  if (claimBusinessSelect) {
    claimBusinessSelect.innerHTML = options;
  }

  if (credentialBusinessSelect) {
    credentialBusinessSelect.innerHTML = options;
  }
}

function renderBusinessList() {
  if (!businessList) {
    return;
  }

  businessList.innerHTML = "";
}

async function loadBusinesses() {
  const response = await fetch("/api/business/businesses");
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to load businesses.");
  }

  businesses = data.businesses || [];

  renderBusinessOptions();
  renderBusinessList();

  const requestedBusinessName = getClaimBusinessNameFromUrl();

  if (requestedBusinessName && claimBusinessSelect) {
    claimBusinessSelect.value = requestedBusinessName;
  }
}

const submitClaimBtn = document.getElementById("submitClaimBtn");

if (submitClaimBtn) {
  submitClaimBtn.addEventListener("click", async () => {
    try {
      setStatus(claimStatus, "Submitting claim...");

      const payload = {
        businessName: claimBusinessSelect ? claimBusinessSelect.value : "",
        ownerName: document.getElementById("claimOwnerName").value.trim(),
        ownerEmail: document.getElementById("claimOwnerEmail").value.trim(),
        ownerPhone: document.getElementById("claimOwnerPhone").value.trim(),
        note: document.getElementById("claimNote").value.trim()
      };

      const response = await fetch("/api/business/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Claim failed.");
      }

      setStatus(
        claimStatus,
        `Claim submitted.\nStatus: ${data.claim.claimStatus}\nClaim ID: ${data.claim.claimId}`
      );

      await loadBusinesses();
    } catch (error) {
      setStatus(claimStatus, error.message);
    }
  });
}

if (apiProvider && mindbodyFields) {
  apiProvider.addEventListener("change", () => {
    mindbodyFields.style.display =
      apiProvider.value === "mindbody" ? "block" : "none";
  });
}

const saveCredentialBtn = document.getElementById("saveCredentialBtn");

if (saveCredentialBtn) {
  saveCredentialBtn.addEventListener("click", async () => {
    try {
      setStatus(credentialStatus, "Encrypting and saving credential...");

      const payload = {
        businessName: credentialBusinessSelect ? credentialBusinessSelect.value : "",
        ownerEmail: document.getElementById("credentialOwnerEmail").value.trim(),
        apiProvider: apiProvider ? apiProvider.value : "",
        apiKey: document.getElementById("apiKey").value.trim(),
        siteId: document.getElementById("siteId").value.trim(),
        locationId: document.getElementById("locationId").value.trim()
      };

      const response = await fetch("/api/business/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Credential save failed.");
      }

      setStatus(
        credentialStatus,
        [
          "Credential saved encrypted.",
          `Credential ID: ${data.credential.credentialId}`,
          `Connection test: ${data.testResult.tested ? data.testResult.success : "not tested"}`,
          `Message: ${data.testResult.message}`
        ].join("\n")
      );

      document.getElementById("apiKey").value = "";

      await loadBusinesses();
    } catch (error) {
      setStatus(credentialStatus, error.message);
    }
  });
}

loadBusinesses().catch((error) => {
  if (businessList) {
    businessList.innerHTML = `<div class="business-row">${escapeHtml(error.message)}</div>`;
  }

  setStatus(claimStatus, error.message);
});