Root cause: production entries store `quantity_per_roll` as area per roll (`length × width/1000`), but the admin log currently treats total quantity as length in meters. That makes the log multiply area by width again, so weight can show blank/incorrect. Also, GSM is only stored inside notes, not as a reliable column.

Plan:
1. Update `ProductionLogs.tsx` so it reads `quantity_per_roll` as area per roll and calculates:
   - Area = `rolls_count × quantity_per_roll`
   - Length = `area / (width_mm / 1000)` when width is available
   - Weight = `area × GSM / 1000`
2. Keep CSV export aligned with the same calculations.
3. Update `ProductionEntry.tsx` preview labels so the user clearly sees:
   - area per roll as soon as length + width are entered
   - weight per roll as soon as length + width + GSM are entered
   - total weight once rolls are entered
4. Verify the formula with a sample calculation in the UI logic.