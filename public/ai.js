const queryInput = document.getElementById("query");
const searchBtn = document.getElementById("searchBtn");
const answerBox = document.getElementById("answer");
const debugBox = document.getElementById("debug");

searchBtn.addEventListener("click", async () => {
  const query = queryInput.value.trim();

  if (!query) {
    answerBox.textContent = "Enter a search first.";
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = "Thinking...";
  answerBox.textContent = "Checking NextAppt data and live appointments...";
  debugBox.textContent = "";

  try {
    const response = await fetch("/api/ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "AI search failed");
    }

    answerBox.textContent = data.answer || "No answer returned.";
    debugBox.textContent = JSON.stringify(data.debug || {}, null, 2);
  } catch (error) {
    answerBox.textContent = error.message;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Ask AI";
  }
});