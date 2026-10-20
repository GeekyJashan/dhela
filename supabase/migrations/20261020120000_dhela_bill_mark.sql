-- A small "Billed with Dhela" line at the foot of a sales bill.
--
-- A distributor's invoice goes to their retailer, their accountant and
-- sometimes their bank, which makes it the one document of ours that travels.
-- Hence the mark.
--
-- It defaults ON, and that default is the whole feature: almost nobody visits
-- a settings screen to turn something on, and plenty would never discover it.
--
-- It is also genuinely removable, from Account, by anyone with the admin role.
-- This is somebody's commercial document, not our billboard. A mark that
-- cannot be taken off a customer's own invoice stops being marketing and
-- starts being a reason to look for different software.
ALTER TABLE public.organizations
  ADD COLUMN show_dhela_branding BOOLEAN NOT NULL DEFAULT true;
