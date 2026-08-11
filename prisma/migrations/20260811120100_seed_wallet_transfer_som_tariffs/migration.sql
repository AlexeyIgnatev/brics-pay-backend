INSERT INTO "tariff_settings" (
  "category",
  "residency",
  "operation",
  "percent_fee",
  "fixed_fee",
  "updatedAt"
)
SELECT
  category,
  residency,
  'WALLET_TRANSFER_SOM'::"TariffOperation",
  0,
  0,
  CURRENT_TIMESTAMP
FROM unnest(enum_range(NULL::"TariffCategory")) AS categories(category)
CROSS JOIN unnest(enum_range(NULL::"CustomerResidency")) AS residencies(residency)
ON CONFLICT ("category", "residency", "operation") DO NOTHING;
