export const brand = {
  englishName: "Restaurant Operations Management",
  englishShortName: "ROM",
  arabicName: "منصة إدارة عمليات المطاعم",
  arabicShortName: "روم",
} as const;

export const brandTitle = (locale: string) => locale.startsWith("ar")
  ? `${brand.arabicName} — ${brand.arabicShortName}`
  : `${brand.englishName} — ${brand.englishShortName}`;
