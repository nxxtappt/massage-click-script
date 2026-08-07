const express = require("express");
const userRepository = require("./database/userRepository");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const [result, stats] = await Promise.all([
      userRepository.listUsers({
        search: req.query.search,
        status: req.query.status,
        verified: req.query.verified,
        page: req.query.page,
        limit: req.query.limit
      }),
      userRepository.getUserStats()
    ]);

    res.json({ success: true, ...result, stats });
  } catch (error) {
    console.error("[ADMIN USERS LIST]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const detail = await userRepository.getAdminUserDetail(req.params.id);
    if (!detail) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    res.json({ success: true, ...detail });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const status = String(req.body?.status || "").trim();
    const user = await userRepository.setUserStatus(req.params.id, status);

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;