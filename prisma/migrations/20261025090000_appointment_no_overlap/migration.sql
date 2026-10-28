-- רשת ביטחון ברמת המסד: אי אפשר ליצור שני תורים חופפים לאותו איש מקצוע.
-- נספרים רק תורים שתופסים זמן (כמו OCCUPYING_STATUSES בקוד); תור מבוטל או "לא הגיע" משחרר את השעה.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("startTime", "endTime") WITH &&
  )
  WHERE ("status" IN ('BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'));
