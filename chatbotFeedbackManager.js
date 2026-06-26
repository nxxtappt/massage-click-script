const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.join(__dirname, "storage");
const FEEDBACK_FILE = path.join(STORAGE_DIR, "chatbot-feedback.json");
const MAX_FEEDBACK_ENTRIES = 2000;

function ensureFeedbackFileExists() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  if (!fs.existsSync(FEEDBACK_FILE)) {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify([], null, 2));
  }
}

function loadFeedback() {
  ensureFeedbackFileExists();

  try {
    const raw = fs.readFileSync(FEEDBACK_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[CHATBOT FEEDBACK] Failed to load feedback:", error.message);
    return [];
  }
}

function saveFeedback(entries = []) {
  ensureFeedbackFileExists();
  fs.writeFileSync(
    FEEDBACK_FILE,
    JSON.stringify(entries.slice(0, MAX_FEEDBACK_ENTRIES), null, 2)
  );
}

function createFeedbackEntry(payload = {}) {
  const entries = loadFeedback();

const entry = {
  id: `feedback_${crypto.randomUUID()}`,
  createdAt: new Date().toISOString(),

  aiVersion: String(payload.aiVersion || "v1").trim(),
  source: "nextappt-chat",

  rating: String(payload.rating || "").trim(),
  feedbackText: String(payload.feedbackText || "").trim(),

  prompt: String(payload.prompt || "").trim(),
  normalizedPrompt: String(payload.normalizedPrompt || "").trim(),

  assistantAnswer: String(payload.assistantAnswer || "").trim(),

  intent: payload.intent || payload.inferredIntent || null,

  appointmentsShown: Array.isArray(payload.appointmentsShown)
    ? payload.appointmentsShown.slice(0, 20)
    : Array.isArray(payload.searchResultsSnapshot)
      ? payload.searchResultsSnapshot.slice(0, 20)
      : [],

  appointmentClicked: payload.appointmentClicked || null,

  page: String(payload.page || "").trim(),
  userAgent: String(payload.userAgent || "").trim()
};

  entries.unshift(entry);
  saveFeedback(entries);

  return entry;
}

module.exports = {
  loadFeedback,
  createFeedbackEntry
};