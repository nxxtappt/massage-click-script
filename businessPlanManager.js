function getBusinessPlan(business = {}) {
  const plan =
    business.plan ||
    business.subscriptionPlan ||
    business.businessPlan ||
    "verified_basic";

  const subscriptionStatus =
    business.subscriptionStatus ||
    "active";

  const isPremium =
    plan === "premium" &&
    subscriptionStatus === "active";

  return {
    plan,
    subscriptionStatus,
    isPremium,

    entitlements: {
      canEditProfile: true,
      canUploadLogo: true,

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
