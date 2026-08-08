/*
  NextAppt.ai shared legal clickwrap helper.
  Load this file on consumer and business login pages before the page-specific JS.
*/
(function () {
  const FALLBACK = {
    termsVersion: "2026-08-08",
    privacyVersion: "2026-08-08",
    termsPath: "/terms",
    privacyPath: "/privacy"
  };

  let current = { ...FALLBACK };

  async function loadCurrentPolicies() {
    try {
      const response = await fetch("/api/legal/current");
      const data = await response.json();

      if (response.ok && data.success) {
        current = {
          termsVersion: data.terms?.version || FALLBACK.termsVersion,
          privacyVersion: data.privacy?.version || FALLBACK.privacyVersion,
          termsPath: data.terms?.path || FALLBACK.termsPath,
          privacyPath: data.privacy?.path || FALLBACK.privacyPath
        };
      }
    } catch {
      // Fall back to the version shipped with this client file.
    }

    return current;
  }

  function getConsumerMarkup() {
    return `
      <div class="legal-acceptance-box" style="margin:16px 0;padding:14px;border:1px solid #dbe3ea;border-radius:10px;background:#f6f9fb;">
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;">
          <input id="legalAgreementAccepted" type="checkbox" style="margin-top:4px;">
          <span style="font-size:13px;line-height:1.45;">
            I am at least 18 and agree to the
            <a href="${current.termsPath}" target="_blank" rel="noopener">Terms of Service</a>,
            including the arbitration and class-action waiver, and acknowledge the
            <a href="${current.privacyPath}" target="_blank" rel="noopener">Privacy Policy</a>.
          </span>
        </label>
      </div>
    `;
  }

  function getBusinessMarkup() {
    return `
      <div class="legal-acceptance-box" style="margin:16px 0;padding:14px;border:1px solid #dbe3ea;border-radius:10px;background:#f6f9fb;">
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-bottom:10px;">
          <input id="legalAgreementAccepted" type="checkbox" style="margin-top:4px;">
          <span style="font-size:13px;line-height:1.45;">
            I am at least 18 and agree to the
            <a href="${current.termsPath}" target="_blank" rel="noopener">Terms of Service</a>,
            including the arbitration and class-action waiver, and acknowledge the
            <a href="${current.privacyPath}" target="_blank" rel="noopener">Privacy Policy</a>.
          </span>
        </label>

        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;">
          <input id="businessAuthorityConfirmed" type="checkbox" style="margin-top:4px;">
          <span style="font-size:13px;line-height:1.45;">
            I confirm that I am authorized to act for and bind this business.
          </span>
        </label>
      </div>
    `;
  }

  function consumerPayload() {
    const checked =
      document.getElementById("legalAgreementAccepted")?.checked === true;

    return {
      termsAccepted: checked,
      privacyAcknowledged: checked,
      age18Confirmed: checked,
      termsVersion: current.termsVersion,
      privacyVersion: current.privacyVersion
    };
  }

  function businessPayload() {
    const base = consumerPayload();

    return {
      ...base,
      businessAuthorityConfirmed:
        document.getElementById("businessAuthorityConfirmed")?.checked === true
    };
  }

  window.NextApptLegal = {
    loadCurrentPolicies,
    getCurrent: () => ({ ...current }),
    getConsumerMarkup,
    getBusinessMarkup,
    consumerPayload,
    businessPayload
  };

  loadCurrentPolicies();
})();