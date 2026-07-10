function normalizeSubscriptionStatus(value) {
  return String(value || "active").trim().toLowerCase();
}

function getBusinessPlan(business = {}) {
  const subscription =
    business.subscription &&
    typeof business.subscription === "object" &&
    !Array.isArray(business.subscription)
      ? business.subscription
      : business;

  const plan =
    subscription.plan ||
    business.plan ||
    business.subscriptionPlan ||
    "verified_basic";

  const subscriptionStatus = normalizeSubscriptionStatus(
    subscription.subscriptionStatus ||
      subscription.subscription_status ||
      business.subscriptionStatus
  );

  const isPremium =
    plan === "premium" &&
    ["active", "trialing"].includes(subscriptionStatus);

  const publicProfile =
    subscription.publicProfile ||
    subscription.public_profile ||
    business.publicProfile ||
    {};

  const activeDeal =
    subscription.activeDeal ||
    subscription.active_deal ||
    business.activeDeal ||
    {};

  const bookingIntegration =
    subscription.bookingIntegration ||
    subscription.booking_integration ||
    business.bookingIntegration ||
    {};

  return {
    plan,
    subscriptionStatus,
    isPremium,
    billingProvider:
      subscription.billingProvider ||
      subscription.billing_provider ||
      "manual_admin",
    stripeCustomerId:
      subscription.stripeCustomerId ||
      subscription.stripe_customer_id ||
      "",
    stripeSubscriptionId:
      subscription.stripeSubscriptionId ||
      subscription.stripe_subscription_id ||
      "",
    publicProfile,
    activeDeal,
    bookingIntegration,
    businessProfile: publicProfile,
    cardPromotion: activeDeal,
    bookingWidget: bookingIntegration,
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