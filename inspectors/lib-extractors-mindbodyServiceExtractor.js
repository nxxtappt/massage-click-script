function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function guessDurationMinutes(text) {
  const match = String(text || "").match(/(\d{2,3})\s*(min|minute|minutes)/i);

  return match ? Number(match[1]) : null;
}

function guessServiceType(text) {
  const t = String(text || "").toLowerCase();

  if (t.includes("swedish") || t.includes("relaxation")) {
    return "swedish";
  }

  if (t.includes("deep tissue") || t.includes("deep")) {
    return "deep_tissue";
  }

  if (t.includes("sports")) {
    return "sports";
  }

  if (t.includes("prenatal") || t.includes("pregnancy")) {
    return "prenatal";
  }

  if (t.includes("ashiatsu")) {
    return "ashiatsu";
  }

  if (t.includes("lomi")) {
    return "lomi_lomi";
  }

  if (t.includes("thai")) {
    return "thai";
  }

  if (t.includes("hot stone")) {
    return "hot_stone";
  }

  return "unknown";
}

function looksLikeService(text) {
  const t = String(text || "").toLowerCase();

  return /massage|swedish|deep|sports|prenatal|relaxation|ashiatsu|lomi|thai|minute|min/.test(
    t
  );
}

function extractMindbodyServices(buttons = []) {
  const services = [];

  for (const button of buttons) {
    const serviceName = cleanText(
      button.buttonText ||
      button.ariaLabel ||
      button.parentText
    );

    if (!serviceName) {
      continue;
    }

    const lower = serviceName.toLowerCase();

    if (
      [
        "back",
        "continue",
        "next",
        "search",
        "add to cart"
      ].includes(lower)
    ) {
      continue;
    }

    const platformServiceId = button.serviceId
      ? Number(button.serviceId)
      : null;

    if (!platformServiceId && !looksLikeService(serviceName)) {
      continue;
    }

    services.push({
      serviceType: guessServiceType(serviceName),
      durationMinutes: guessDurationMinutes(serviceName),
      serviceName,
      platformServiceId,
      enabled: true,
      priority: "medium"
    });
  }

  const unique = [];

  for (const service of services) {
    const exists = unique.find(
      (s) =>
        s.serviceName === service.serviceName &&
        s.platformServiceId === service.platformServiceId
    );

    if (!exists) {
      unique.push(service);
    }
  }

  return unique;
}

module.exports = {
  extractMindbodyServices
};