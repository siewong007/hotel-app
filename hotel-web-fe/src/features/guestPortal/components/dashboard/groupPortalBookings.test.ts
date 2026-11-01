import { describe, expect, it } from "vitest";
import type { GuestPortalBookingSummary } from "../../../../types/guestPortal.types";
import { groupPortalBookings } from "./PortalDashboardSections";

const room = (id: number, extra: Partial<GuestPortalBookingSummary> = {}): GuestPortalBookingSummary =>
  ({
    id,
    booking_number: `BK-${id}`,
    status: "confirmed",
    total_amount: "100",
    booking_group_id: 7,
    group_number: "GBK-7",
    can_cancel: true,
    completed_payment_id: null,
    ...extra,
  }) as GuestPortalBookingSummary;

describe("groupPortalBookings cancel-all", () => {
  it("offers cancel-all for an unpaid group only when every room can cancel online", () => {
    expect(groupPortalBookings([room(1), room(2)]).get(7)?.canCancelAll).toBe(true);
    expect(groupPortalBookings([room(1), room(2, { can_cancel: false })]).get(7)?.canCancelAll).toBe(false);
  });

  it("offers a paid group as one review batch, even when instant cancel is off", () => {
    const group = groupPortalBookings([
      room(1, { completed_payment_id: 55, can_cancel: true }),
      room(2, { can_cancel: false }),
    ]).get(7);
    expect(group?.canCancelAll).toBe(true);
    expect(group?.paidPaymentId).toBe(55);
  });

  it("hides cancel-all when a paid group has an arrived room or is already fully under review", () => {
    expect(
      groupPortalBookings([room(1, { completed_payment_id: 55 }), room(2, { status: "checked_in", can_cancel: false })]).get(7)
        ?.canCancelAll,
    ).toBe(false);
    expect(
      groupPortalBookings([
        room(1, { completed_payment_id: 55, cancellation_pending: true, can_cancel: false }),
        room(2, { cancellation_pending: true, can_cancel: false }),
      ]).get(7)?.canCancelAll,
    ).toBe(false);
  });
});
