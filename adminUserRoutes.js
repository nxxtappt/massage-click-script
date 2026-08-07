const express = require("express");
const userRepository = require("./database/userRepository");
const userAlertRepository = require("./database/userAlertRepository");
const {
  runUserAlertMatcher
} = require("./userAlertMatcher");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const [
      result,
      stats
    ] =
      await Promise.all([
        userRepository
          .listUsers({
            search:
              req.query
                .search,
            status:
              req.query
                .status,
            verified:
              req.query
                .verified,
            page:
              req.query
                .page,
            limit:
              req.query
                .limit
          }),
        userRepository
          .getUserStats()
      ]);

    res.json({
      success: true,
      ...result,
      stats
    });
  } catch (error) {
    console.error(
      "[ADMIN USERS LIST]",
      error
    );

    res.status(500)
      .json({
        success: false,
        error:
          error.message
      });
  }
});

router.get(
  "/alerts/settings",
  async (
    req,
    res
  ) => {
    try {
      const settings =
        await userAlertRepository
          .getDeliverySettings();

      res.json({
        success: true,
        settings
      });
    } catch (error) {
      console.error(
        "[ADMIN ALERT SETTINGS GET]",
        error
      );

      res.status(500)
        .json({
          success: false,
          error:
            error.message
        });
    }
  }
);

router.patch(
  "/alerts/settings",
  async (
    req,
    res
  ) => {
    try {
      const settings =
        await userAlertRepository
          .updateDeliverySettings(
            req.body || {}
          );

      res.json({
        success: true,
        settings
      });
    } catch (error) {
      console.error(
        "[ADMIN ALERT SETTINGS UPDATE]",
        error
      );

      res.status(400)
        .json({
          success: false,
          error:
            error.message
        });
    }
  }
);

router.get(
  "/alerts/activity",
  async (
    req,
    res
  ) => {
    try {
      const activity =
        await userAlertRepository
          .getNotificationActivity({
            limit:
              req.query
                .limit
          });

      res.json({
        success: true,
        ...activity
      });
    } catch (error) {
      console.error(
        "[ADMIN ALERT ACTIVITY]",
        error
      );

      res.status(500)
        .json({
          success: false,
          error:
            error.message
        });
    }
  }
);

router.post(
  "/alerts/run",
  async (
    req,
    res
  ) => {
    try {
      const summary =
        await runUserAlertMatcher({
          trigger:
            "admin_manual",
          alertId:
            req.body
              ?.alertId ||
            null,
          maxAlerts:
            req.body
              ?.maxAlerts ||
            250
        });

      res.json({
        success: true,
        summary
      });
    } catch (error) {
      console.error(
        "[ADMIN ALERT MATCHER RUN]",
        error
      );

      res.status(500)
        .json({
          success: false,
          error:
            error.message
        });
    }
  }
);

router.get(
  "/:id",
  async (
    req,
    res
  ) => {
    try {
      const detail =
        await userRepository
          .getAdminUserDetail(
            req.params.id
          );

      if (!detail) {
        return res
          .status(404)
          .json({
            success: false,
            error:
              "User not found."
          });
      }

      res.json({
        success: true,
        ...detail
      });
    } catch (error) {
      res.status(500)
        .json({
          success: false,
          error:
            error.message
        });
    }
  }
);

router.patch(
  "/:id/status",
  async (
    req,
    res
  ) => {
    try {
      const status =
        String(
          req.body
            ?.status ||
          ""
        ).trim();

      const user =
        await userRepository
          .setUserStatus(
            req.params.id,
            status
          );

      if (!user) {
        return res
          .status(404)
          .json({
            success: false,
            error:
              "User not found."
          });
      }

      res.json({
        success: true,
        user
      });
    } catch (error) {
      res.status(400)
        .json({
          success: false,
          error:
            error.message
        });
    }
  }
);

module.exports = router;