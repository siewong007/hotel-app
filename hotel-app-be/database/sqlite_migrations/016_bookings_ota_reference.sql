-- Store OTA/platform reference numbers for monthly channel statements.

ALTER TABLE bookings ADD COLUMN ota_reference TEXT;
