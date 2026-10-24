import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    // TanStack Router auto-generated route tree — do not hand-edit, and don't
    // lint it (it ships its own `/* eslint-disable */` + `// @ts-nocheck`,
    // which trips "unused eslint-disable directive" under --max-warnings=0).
    // Same story for build/coverage output: vendored reporter assets (e.g.
    // coverage/block-navigation.js) ship their own eslint-disable directives.
    ignores: ["src/routeTree.gen.ts", "src/gen/**", "coverage/**", "dist/**"]
  },
  {
    files: ["src/**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      // React Compiler diagnostics now ship in eslint-plugin-react-hooks 7
      // (the standalone eslint-plugin-react-compiler pinned a vulnerable zod 3).
      ...reactHooks.configs["recommended-latest"].rules,
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/preserve-manual-memoization": "error",
      // Ban deriving a YYYY-MM-DD string from Date.toISOString(): toISOString()
      // returns UTC, so .split('T')[0] / .slice(0, 10) yields the previous day
      // during early-morning hours in east-of-UTC timezones. Use the local-date
      // helpers in src/utils/date.ts (formatLocalDate / parseLocalDate / addLocalDays).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='split'][callee.object.callee.property.name='toISOString']",
          message:
            "Don't extract a date from toISOString() (it's UTC and shifts a day overnight). Use formatLocalDate() from src/utils/date.ts."
        },
        {
          selector:
            "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
          message:
            "Don't extract a date from toISOString() (it's UTC and shifts a day overnight). Use formatLocalDate() from src/utils/date.ts."
        },
        // ky 2 parses the error body into `error.data` and consumes the response
        // stream doing it, so `error.response.json()` ALWAYS rejects with "Body is
        // unusable". Wrapped in the usual `.catch(() => ({}))` that silently
        // discarded every server-supplied message in favour of a generic fallback.
        // Use readErrorData(error) from src/api/client.ts. See lessons theme 13.
        {
          selector:
            "CallExpression[callee.object.property.name='response'][callee.property.name='json']",
          message:
            "ky 2 already consumed the error body; error.response.json() always rejects. Use readErrorData(error) from src/api/client.ts."
        },
        // Hand-rolled enum humanizers (`status.replace(/_/g, ' ')`) render raw
        // API vocabulary to users and drift in casing per call site. Route all
        // status/enum labels through formatStatusLabel() in src/utils/formatters.ts.
        {
          selector:
            "CallExpression[callee.property.name='replace'][arguments.0.regex.pattern='_'][arguments.1.value=' ']",
          message:
            "Use formatStatusLabel() from src/utils/formatters.ts instead of ad-hoc underscore stripping."
        }
      ]
    }
  },
  {
    // set-state-in-effect cleanup in progress: files below still have
    // violations and are fixed area by area. Remove entries as they're fixed;
    // never add new ones.
    files: [
      "src/components/common/ApiNotificationHost.tsx",
      "src/components/layout/CommandPalette.tsx",
      "src/features/admin/components/AuditLogPage.tsx",
      "src/features/admin/components/CustomerLedger/CustomerLedgerPage.tsx",
      "src/features/admin/components/UrgentTransferAlert.tsx",
      "src/features/admin/components/complimentary/BookingComplimentaryDialogs.tsx",
      "src/features/admin/components/complimentary/CreditDialogs.tsx",
      "src/features/admin/components/data-transfer/DesktopBackupsCard.tsx",
      "src/features/admin/components/data-transfer/StepUpDialog.tsx",
      "src/features/admin/components/rbac/RBACManagementPage.tsx",
      "src/features/auth/components/CompleteProfilePage.tsx",
      "src/features/auth/components/EmailVerificationPage.tsx",
      "src/features/auth/components/twoFactor/TwoFactorChallenge.tsx",
      "src/features/auth/turnstile/useTurnstile.ts",
      "src/features/channels/components/ChannelDialog.tsx",
      "src/features/channels/components/CommissionRuleDialog.tsx",
      "src/features/channels/components/PricingRuleDialog.tsx",
      "src/features/ekyc/components/EkycCreateDialog.tsx",
      "src/features/ekyc/components/EkycManagementPage.tsx",
      "src/features/ekyc/components/EkycStatusCard.tsx",
      "src/features/guestPortal/booking/PortalBookingPage.tsx",
      "src/features/guestPortal/components/GuestPaymentPanel.tsx",
      "src/features/guestPortal/components/GuestPortalNotificationBell.tsx",
      "src/features/guestPortal/components/GuestPortalShell.tsx",
      "src/features/guestPortal/components/PortalSupportTab.tsx",
      "src/features/guestPortal/components/dashboard/IdentitySection.tsx",
      "src/features/guestPortal/components/dashboard/PortalDashboardSections.tsx",
      "src/features/guestPortal/components/dashboard/ProfileSection.tsx",
      "src/features/guestPortal/hooks/usePortalSessionBootstrap.ts",
      "src/features/guestRelations/components/GuestFormDialog.tsx",
      "src/features/guestRelations/components/GuestPortalAccountDialog.tsx",
      "src/features/guestRelations/components/OpenSupportDialog.tsx",
      "src/features/guestRelations/pages/GuestRelationsFollowUpsPage.tsx",
      "src/features/guestRelations/pages/GuestRelationsPage.tsx",
      "src/features/housekeeping/components/HousekeepingPage.tsx",
      "src/features/housekeeping/components/NewTaskDialog.tsx",
      "src/features/housekeeping/components/NewTicketDialog.tsx",
      "src/features/housekeeping/components/RoomStatusUpdateDialog.tsx",
      "src/features/housekeeping/components/TaskEditDialog.tsx",
      "src/features/housekeeping/components/TicketDetailDialog.tsx",
      "src/features/invoices/components/CheckoutInvoiceModal.tsx",
      "src/features/invoices/hooks/useCheckoutInvoiceData.ts",
      "src/features/loyalty/components/LoyaltyPortal.tsx",
      "src/features/onlineInventory/components/GridToolbar.tsx",
      "src/features/onlineInventory/hooks/useCellEditorDraft.ts",
      "src/features/onlineInventory/hooks/useOnlineInventory.ts",
      "src/features/onlineInventory/pages/OnlineInventoryPage.tsx",
      "src/features/promotions/components/CancelCampaignDialog.tsx",
      "src/features/promotions/components/PromotionEditorDialog.tsx",
      "src/features/promotions/components/VoucherDetailsDrawer.tsx",
      "src/features/promotions/components/VoucherIssueDialog.tsx",
      "src/features/rates/components/RatePlanDialog.tsx",
      "src/features/rooms/bulkPrices/BulkPriceDialog.tsx",
      "src/features/rooms/components/RoomEventDialog.tsx",
      "src/features/rooms/components/UnifiedBooking/UnifiedBookingModal.tsx",
      "src/features/rooms/components/UpdateCheckoutDateDialog.tsx",
      "src/features/rooms/hooks/useGuestCreditsWorkflow.ts",
      "src/features/support/components/SupportManagementPage.tsx",
      "src/features/user/components/SettingsPage.tsx",
      "src/features/user/components/UserProfilePage.tsx",
      "src/features/user/components/profile/ProfileTab.tsx",
      "src/hooks/useCurrency.ts",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off"
    }
  },
];
