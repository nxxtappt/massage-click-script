const {
  getBusinessSubscription
} = require("./businessSubscriptionManager");

function getBusinessPlan(business = {}) {
  const subscription = getBusinessSubscription(business);

  const plan =
    subscription.plan || "verified_basic";

  const subscriptionStatus =
    subscription.subscriptionStatus || "active";

  const isPremium =
    plan === "premium" &&
    subscriptionStatus === "active";

  return {
    plan,
    subscriptionStatus,

    billingProvider:
      subscription.billingProvider || "manual",

    isPremium,

    entitlements: {
      // Basic Verified
      canEditProfile: true,
      canUploadLogo: true,

      // Premium Features
      canUseApiIntegration: isPremium,
      canUseBookingWidget: isPremium,
      canCreateDeals: isPremium,
      canViewAnalytics: isPremium,
      canUsePremiumPlacement: isPremium,
      canShowDealsOnSearchCards: isPremium,
      canShowDealsOnBusinessPage: isPremium
    }
  };
}

module.exports = {
  getBusinessPlan
};