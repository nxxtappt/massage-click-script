const DIMENSIONS_MINDBODY_SERVICES = [
  { serviceName: "Swedish (30 Minute)", serviceType: "swedish", durationMinutes: 30, sessionTypeId: 35 },
  { serviceName: "Swedish (45 Minute)", serviceType: "swedish", durationMinutes: 45, sessionTypeId: 2069 },
  { serviceName: "Swedish (60 Minute)", serviceType: "swedish", durationMinutes: 60, sessionTypeId: 36 },
  { serviceName: "Swedish (90 Minute)", serviceType: "swedish", durationMinutes: 90, sessionTypeId: 37 },

  { serviceName: "Deep Tissue (30 Minute)", serviceType: "deep_tissue", durationMinutes: 30, sessionTypeId: 29 },
  { serviceName: "Deep Tissue (45 Minute)", serviceType: "deep_tissue", durationMinutes: 45, sessionTypeId: 2063 },
  { serviceName: "Deep Tissue (60 Minute)", serviceType: "deep_tissue", durationMinutes: 60, sessionTypeId: 30 },
  { serviceName: "Deep Tissue (90 Minute)", serviceType: "deep_tissue", durationMinutes: 90, sessionTypeId: 31 },

  { serviceName: "Lomi Lomi (60 Minute)", serviceType: "lomi_lomi", durationMinutes: 60, sessionTypeId: 50 },
  { serviceName: "Lomi Lomi (90 Minute)", serviceType: "lomi_lomi", durationMinutes: 90, sessionTypeId: 51 },

  { serviceName: "Ashiatsu (60 Minute)", serviceType: "ashiatsu", durationMinutes: 60, sessionTypeId: 33 },
  { serviceName: "Ashiatsu (90 Minute)", serviceType: "ashiatsu", durationMinutes: 90, sessionTypeId: 34 },

  { serviceName: "Prenatal (30 Minute)", serviceType: "prenatal", durationMinutes: 30, sessionTypeId: 46 },
  { serviceName: "Prenatal (45 Minute)", serviceType: "prenatal", durationMinutes: 45, sessionTypeId: 2065 },
  { serviceName: "Prenatal (60 Minute)", serviceType: "prenatal", durationMinutes: 60, sessionTypeId: 47 },
  { serviceName: "Prenatal (90 Minute)", serviceType: "prenatal", durationMinutes: 90, sessionTypeId: 48 },

  { serviceName: "Sports (30 Minute)", serviceType: "sports", durationMinutes: 30, sessionTypeId: 43 },
  { serviceName: "Sports (45 Minute)", serviceType: "sports", durationMinutes: 45, sessionTypeId: 2067 },
  { serviceName: "Sports (60 Minute)", serviceType: "sports", durationMinutes: 60, sessionTypeId: 44 },
  { serviceName: "Sports (90 Minute)", serviceType: "sports", durationMinutes: 90, sessionTypeId: 45 }
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findDimensionsMindbodyService(filters = {}) {
  const serviceType = normalize(filters.serviceType || filters.serviceCategory || "");
  const durationMinutes = filters.durationMinutes ? Number(filters.durationMinutes) : null;
  const serviceName = normalize(filters.serviceName || filters.service || "");

  return (
    DIMENSIONS_MINDBODY_SERVICES.find((service) => {
      if (durationMinutes && Number(service.durationMinutes) !== durationMinutes) {
        return false;
      }

      if (serviceType) {
        return normalize(service.serviceType) === serviceType;
      }

      if (serviceName) {
        return normalize(service.serviceName).includes(serviceName);
      }

      return false;
    }) || null
  );
}

module.exports = {
  DIMENSIONS_MINDBODY_SERVICES,
  findDimensionsMindbodyService
};