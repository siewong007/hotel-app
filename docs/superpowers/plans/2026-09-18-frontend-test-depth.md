# Frontend Workflow-Test Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the render-level smoke on the four largest admin pages into workflow-level assertions, split the remaining inline SettingsPage sections into sibling card components, and make "workflow test" a content-checked manifest invariant.

**Architecture:** Tests only for Tasks 1–4 (mock at the hooks/service layer exactly as the existing files do); Task 5 is a mechanical component extraction that keeps behavior identical; Task 6 strengthens `pageCoverage.test.ts` so a workflow file that only renders is a CI failure.

**Tech Stack:** Vitest 4, Testing Library, `userEvent`, `vi.hoisted`/`vi.mock`, `src/test/renderPage.tsx` harness, `src/test/axe.ts`, `src/test/pageManifest.ts` + `pageCoverage.test.ts` meta-test.

## Global Constraints

- `git status --short --branch` before editing — shared tree.
- Every `*Page` keeps its existing smoke + axe coverage; this plan *deepens*, never replaces.
- New test files land next to the component they cover (existing convention), NOT in `src/test/`.
- `bun run test <file>` per touched suite, then `bun run typecheck && bun run lint:strict` at the end. Vitest transpiles without type info — a green test run does not prove typecheck.
- Never run two vitest suites concurrently (they starve each other's timeouts).
- i18n assertions use the real `t()` output, not hardcoded English where a key exists — the harness mounts `I18nProvider`, so assertions target rendered English text from `en` bundles.
- `pageManifest.ts` must be updated whenever a test file is added or moved — `pageCoverage.test.ts` enforces it.
- SettingsPage extraction is behavior-preserving: same state, same save/discard flow, same read-only gating. No prop/API redesign.

---

### Task 1: RBACManagementPage — permission-toggle and role-CRUD workflow tests

The page (`858` lines) currently has three tests: render, error state, axe. Add real fixtures and assert the draft→dirty→save pipeline, category bulk-toggle, role create, and the built-in-role lock.

**Files:**
- Modify: `hotel-web-fe/src/features/admin/components/rbac/RBACManagementPage.test.tsx`
- Read for fixture shapes: `hotel-web-fe/src/features/admin/components/rbac/hooks/useRBACData.ts` (`UseRBACDataReturn`), `src/types/rbac.types.ts` (`Role`, `Permission`), `src/features/admin/components/rbac/types.ts` (`PermissionCategory`, `RoleWithStats`)

**Interfaces:**
- Consumes: `useRBACData()` returns `{ roles, permissions, routePolicies, rolePermissions, users, rolesWithStats, permissionCategories, rolePermissionMap: Record<number, Set<number>>, loading, error, reload, setRoles, setPermissions, setUsers, updateRolePermissions, updateUserRoles }`. `useReplaceRolePermissions()` → `mutateAsync({ roleId: string, input: { permission_ids: number[] } })`. `useCreateRole()` → `mutateAsync({ name, description? })` → `Role`.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Extend the hoisted mocks with real fixtures**

Replace the top of `RBACManagementPage.test.tsx` (keep the existing `vi.mock` blocks and the three current tests) so the `mocks.data` fixture carries two roles, three permissions in one category, and a mutable `rolePermissionMap`. Mutations become individual `vi.fn()`s so calls are assertable:

```tsx
const roleFixture = (id: number, name: string, extra: Partial<Role> = {}): Role => ({
  id,
  name,
  description: `${name} description`,
  created_at: '2026-01-01T00:00:00Z',
  ...extra,
});

const permFixture = (id: number, resource: string, action: string): Permission => ({
  id,
  name: `${resource} ${action}`,
  resource,
  action,
  description: `${resource}:${action} description`,
  created_at: '2026-01-01T00:00:00Z',
});

const BOOKKEEPER = roleFixture(1, 'Bookkeeper');       // custom role — mutable
const ADMIN = roleFixture(2, 'Admin');                  // matches BUILTIN regex → lockable
const PERMS = [
  permFixture(11, 'bookings', 'view'),
  permFixture(12, 'bookings', 'create'),
  permFixture(13, 'ledgers', 'view'),
];

const mocks = vi.hoisted(() => ({
  data: {
    roles: [BOOKKEEPER, ADMIN] as Role[],
    permissions: PERMS as Permission[],
    users: [] as unknown[],
    rolesWithStats: [
      { ...BOOKKEEPER, permissionCount: 1, userCount: 0 },
      { ...ADMIN, permissionCount: 3, userCount: 0 },
    ],
    permissionCategories: [
      { name: 'bookings', displayName: 'Bookings', color: '#3366ff', permissions: [PERMS[0], PERMS[1]] },
      { name: 'ledgers', displayName: 'Ledgers', color: '#22aa66', permissions: [PERMS[2]] },
    ],
    // Bookkeeper has bookings:view on; Admin has everything (locked).
    rolePermissionMap: { 1: new Set([11]), 2: new Set([11, 12, 13]) } as Record<number, Set<number>>,
    loading: false,
    error: null as string | null,
    reload: vi.fn(),
    setRoles: vi.fn((next: unknown) => {
      // The page calls setRoles with a value or updater — apply it so the UI reflects the change.
      mocks.data.roles = typeof next === 'function' ? next(mocks.data.roles) : (next as Role[]);
    }),
    setUsers: vi.fn(),
    updateRolePermissions: vi.fn(),
    updateUserRoles: vi.fn(),
  },
  mutations: {
    replaceRolePermissions: { mutateAsync: vi.fn(async () => ({})), mutate: vi.fn(), isPending: false },
    createRole: { mutateAsync: vi.fn(async (input: { name: string }) => roleFixture(3, input.name)), mutate: vi.fn(), isPending: false },
    updateRole: { mutateAsync: vi.fn(async () => ({})), mutate: vi.fn(), isPending: false },
    deleteRole: { mutateAsync: vi.fn(async () => ({})), mutate: vi.fn(), isPending: false },
  },
}));

vi.mock('./hooks/useRBACQueries', () => ({
  useCreateRole: () => mocks.mutations.createRole,
  useUpdateRole: () => mocks.mutations.updateRole,
  useDeleteRole: () => mocks.mutations.deleteRole,
  useReplaceRolePermissions: () => mocks.mutations.replaceRolePermissions,
}));
```

Note: `Role`, `Permission`, `RoleWithStats` must be imported as types at the top (`import type { Role, Permission } from '../../../../types';` and `RoleWithStats` from `./types`). The new tests also use `within` (add to the existing `@testing-library/react` import) and `userEvent` (`import userEvent from '@testing-library/user-event'`) — add both if the file doesn't already import them. `vi.hoisted` runs before imports — fixture *factory functions* used inside it must also live in the hoisted block or be plain function declarations (hoisted by the JS runtime). Move `roleFixture`/`permFixture` declarations above `mocks` inside the same `vi.hoisted` callback, or declare them as `function` statements — `vi.mock` factories only reference `mocks`, so plain functions at module scope work.

- [ ] **Step 2: Write the failing draft→save test**

The page renders a `role="switch"` toggle per permission row (with `aria-checked`), shows the sticky save bar only when the draft differs, and on Save calls `replaceRolePermissionsMutation.mutateAsync({ roleId, input: { permission_ids } })`.

```tsx
it('toggles a permission, shows the dirty bar, and saves the full id set', async () => {
  const user = userEvent.setup();
  render(<RBACManagementPage />);

  // Bookkeeper auto-selects (first role — no 'admin'-ish name match? Admin matches
  // /admin/i so it wins the default-selection effect; click Bookkeeper explicitly).
  await user.click(screen.getByRole('button', { name: /Bookkeeper/i }));

  const bookingsViewSwitch = screen
    .getAllByRole('switch')
    .find((el) => el.closest('[class]')?.textContent?.includes('bookings:view') || false);
  // Simpler: query the row by its permission code text, then its switch.
  const permRow = screen.getByText('bookings:create').closest('div')!.parentElement!;
  const toggle = within(permRow.parentElement!.parentElement!).getAllByRole('switch')[1];

  await user.click(toggle);
  expect(await screen.findByText(/Unsaved changes/i)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /Save changes/i }));
  await waitFor(() =>
    expect(mocks.mutations.replaceRolePermissions.mutateAsync).toHaveBeenCalledWith({
      roleId: '1',
      input: { permission_ids: [11, 12] },
    }),
  );
  expect(mocks.data.updateRolePermissions).toHaveBeenCalledWith(1, expect.any(Array));
});
```

The exact DOM query needs care — permission rows show `permCode(p)` (`resource:action`) in a monospace span; locate the row via `screen.getByText('bookings:create')`, walk up to the grid row (`closest` on the row container), then `within(row).getByRole('switch')`. Write a small helper `switchForPerm(code: string)` in the test file instead of the exploratory expression above. Run it, watch it fail if the query misses, adjust the traversal once — the structure is `<row grid> <switch role="switch"> …` per `RBACManagementPage.tsx:689-709`.

- [ ] **Step 3: Category enable-all + discard tests**

```tsx
it('enable-all on a category adds every permission in it; discard restores', async () => {
  const user = userEvent.setup();
  render(<RBACManagementPage />);
  await user.click(screen.getByRole('button', { name: /Bookkeeper/i }));

  // 'Ledgers' category has one off permission — its header carries 'Enable all'.
  await user.click(screen.getByRole('button', { name: /Enable all/i }));
  expect(await screen.findByText(/Unsaved changes/i)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /^Discard$/i }));
  await waitFor(() => expect(screen.queryByText(/Unsaved changes/i)).toBeNull());
});
```

Note there may be several `Enable all` buttons (one per category) — `getAllByRole` and pick the Ledgers one via the category block, or enable-all on the only visible category after collapse-all + open one. Keep the assertion on `mutateAsync` args for the save variant.

- [ ] **Step 4: Create-role dialog test**

```tsx
it('creates a role through the dialog and selects it', async () => {
  const user = userEvent.setup();
  render(<RBACManagementPage />);
  await user.click(screen.getByRole('button', { name: /New role/i }));

  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText(/Role name/i), 'Night Porter');
  await user.click(within(dialog).getByRole('button', { name: /^Create$/i }));

  await waitFor(() =>
    expect(mocks.mutations.createRole.mutateAsync).toHaveBeenCalledWith({
      name: 'Night Porter',
      description: undefined,
    }),
  );
});
```

- [ ] **Step 5: Locked-role test**

```tsx
it('locks a builtin role that holds every permission', async () => {
  render(<RBACManagementPage />);
  // 'Admin' matches BUILTIN and its map holds all 3 permissions → locked.
  const switches = screen.getAllByRole('switch');
  expect(switches.every((el) => el.getAttribute('aria-checked') === 'true')).toBe(true);
  expect(screen.queryByText(/Save changes/i)).toBeNull();
});
```

- [ ] **Step 6: Run the suite**

Run: `cd hotel-web-fe && bun run test src/features/admin/components/rbac/RBACManagementPage.test.tsx`
Expected: all tests pass (green), including the pre-existing three.

- [ ] **Step 7: Commit**

```bash
git add hotel-web-fe/src/features/admin/components/rbac/RBACManagementPage.test.tsx
git commit -m "test(rbac): workflow assertions for permission draft/save and role CRUD"
```

---

### Task 2: EkycManagementPage — review-queue workflow tests

`1251` lines, currently render + axe only. Cover: queue row → detail dialog → approve (with self-checkin flag) → assert the action payload shape; reject requiring a reason code; reveal-field flow is optional — cover it if cheap.

**Files:**
- Modify: `hotel-web-fe/src/features/ekyc/components/EkycManagementPage.test.tsx`
- Read for fixture shapes: `src/api/ekyc.service.ts:55-210` (`EkycApplicationSummary`, `EkycApplicationDetail`, `EkycReasonCode`, `EkycActionPayload`), `src/features/ekyc/components/EkycManagementPage.tsx:395-436` (`openAction`/`submitAction`), `:841-934` (detail + action dialogs)

**Interfaces:**
- Consumes: `useAllEkycVerifications()` → `{ data: EkycListResponse }` (`{ data: [], metrics, total, page, page_size, total_pages }`); `useEkycApplication(id)` → `{ data: EkycApplicationDetail }`; `useEkycReasonCodes()` → `{ data: EkycReasonCode[] }`; `useReviewEkycAction()` → `mutateAsync({ applicationId: number, payload: EkycActionPayload })` → `{ summary: EkycApplicationSummary }`.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Extend fixtures**

The existing file already mocks `useEkycQueries` with `mocks.list`, `mocks.detail`, `mocks.reasonCodes`, and one `emptyMutation` for all mutations. Split the review mutation out so its call is assertable:

```tsx
const mocks = vi.hoisted(() => ({
  list: { data: undefined as unknown, isPending: false, isFetching: false, isLoading: false, error: null as unknown, refetch: vi.fn() },
  detail: { data: undefined as unknown, isPending: false, isLoading: false },
  reasonCodes: { data: [] as Array<{ code: string; label: string }> },
  reviewAction: { mutateAsync: vi.fn(async () => ({ summary: { id: 7 } })), mutate: vi.fn(), isPending: false },
}));

vi.mock('../hooks/useEkycQueries', () => ({
  useAllEkycVerifications: () => mocks.list,
  useEkycApplication: () => mocks.detail,
  useEkycReasonCodes: () => mocks.reasonCodes,
  useRevealEkycField: () => emptyMutation,
  useReviewEkycAction: () => mocks.reviewAction,
  useApproveEkyc: () => emptyMutation,
  useRejectEkyc: () => emptyMutation,
}));
```

Fixture factories (top of file, plain functions):

```tsx
const summaryFixture = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 7,
  application_id: 'EKYC-0007',
  user_id: 42,
  guest_id: 9,
  status: 'submitted',
  assigned_reviewer_id: null,
  assigned_reviewer_name: null,
  full_name: 'Amina Yusof',
  email_masked: 'a***@example.com',
  phone_masked: '+60****123',
  id_type: 'passport',
  id_number_masked: 'A****789',
  nationality: 'MY',
  country: 'MY',
  provider_name: 'stub',
  provider_verification_result: 'clear',
  manual_review_required: true,
  risk_level: 'low',
  risk_score: 12,
  triggered_risk_rules: [],
  recommended_action: null,
  potential_duplicate: false,
  fraud_suspected: false,
  self_checkin_enabled: false,
  submitted_at: '2026-09-01T04:00:00Z',
  verified_at: null,
  updated_at: '2026-09-01T04:00:00Z',
  nearing_sla: false,
  overdue_sla: false,
  next_arrival_date: null,
  arrival_imminent: false,
  version: 3,
  ...over,
});

const detailFixture = () => ({
  summary: summaryFixture(),
  date_of_birth_masked: null,
  current_address_masked: null,
  id_issuing_country: null,
  id_issue_date: null,
  id_expiry_date: null,
  document_authenticity_result: 'clear',
  face_match_score: 0.97,
  face_match_passed: true,
  liveness_score: 0.99,
  liveness_passed: true,
  duplicate_check_result: 'clear',
  watchlist_result: 'clear',
  ip_address_masked: null,
  device_fingerprint: null,
  geolocation: null,
  submission_metadata: null,
  ocr_data: null,
  user_entered_data: null,
  provider_raw_response: null,
  provider_raw_response_available: false,
  verification_notes: null,
  customer_message: null,
  decision_reason_code: null,
  decision_reason: null,
  documents: { id_front: true, id_back: true, selfie: true, proof_of_address: false },
  differences: [],
  history: [],
  notes: [],
});
```

Populate in `beforeEach`: `mocks.list.data = { data: [summaryFixture()], total: 1, page: 1, page_size: 10, total_pages: 1, metrics: { total_submitted: 1, pending_review: 1, under_manual_review: 0, approved: 0, rejected: 0, resubmission_required: 0, escalated_high_risk: 0, average_processing_minutes: null, nearing_sla: 0, daily_trend: 0, weekly_trend: 0, monthly_trend: 0 } }` and `mocks.detail.data = detailFixture()`.

- [ ] **Step 2: Row → detail dialog test**

```tsx
it('opens the detail dialog when a queue row is clicked', async () => {
  const user = userEvent.setup();
  render(<EkycManagementPage />);
  await user.click(screen.getByRole('button', { name: /view/i }).closest('tr')!.querySelector('td')!);
  // Fallback if the icon-button selector is fragile: click the row itself —
  // TableRow for application.id 7 calls setSelectedId(application.id).
  await user.click(screen.getByText('Amina Yusof'));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.getByText('EKYC-0007')).toBeTruthy();
});
```

- [ ] **Step 3: Approve-action payload test**

```tsx
it('approves with the self-checkin flag and expected_version', async () => {
  const user = userEvent.setup();
  render(<EkycManagementPage />);
  await user.click(screen.getByText('Amina Yusof'));

  const detailDialog = await screen.findByRole('dialog');
  await user.click(within(detailDialog).getByRole('button', { name: /approve/i }));

  const actionDialog = (await screen.findAllByRole('dialog')).at(-1)!;
  await user.click(within(actionDialog).getByLabelText(/self.check.?in/i));
  await user.click(within(actionDialog).getByRole('button', { name: /submit/i }));

  await waitFor(() =>
    expect(mocks.reviewAction.mutateAsync).toHaveBeenCalledWith({
      applicationId: 7,
      payload: expect.objectContaining({
        action: 'approve',
        expected_version: 3,
        idempotency_key: expect.any(String),
      }),
    }),
  );
});
```

- [ ] **Step 4: Reject requires reason code**

```tsx
it('reject sends the chosen reason_code and reason text', async () => {
  mocks.reasonCodes.data = [{ code: 'DOC_UNREADABLE', label: 'Document unreadable' }];
  const user = userEvent.setup();
  render(<EkycManagementPage />);
  await user.click(screen.getByText('Amina Yusof'));
  const detailDialog = await screen.findByRole('dialog');
  await user.click(within(detailDialog).getByRole('button', { name: /reject/i }));

  const actionDialog = (await screen.findAllByRole('dialog')).at(-1)!;
  await user.click(within(actionDialog).getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: 'Document unreadable' }));
  await user.type(within(actionDialog).getByLabelText(/reason/i), 'Photo too dark');
  await user.click(within(actionDialog).getByRole('button', { name: /submit/i }));

  await waitFor(() =>
    expect(mocks.reviewAction.mutateAsync).toHaveBeenCalledWith({
      applicationId: 7,
      payload: expect.objectContaining({
        action: 'reject',
        reason_code: 'DOC_UNREADABLE',
        reason: 'Photo too dark',
      }),
    }),
  );
});
```

- [ ] **Step 5: Error path test**

```tsx
it('surfaces a failed review action as an alert', async () => {
  mocks.reviewAction.mutateAsync.mockRejectedValueOnce(new Error('version conflict'));
  const user = userEvent.setup();
  render(<EkycManagementPage />);
  await user.click(screen.getByText('Amina Yusof'));
  const detailDialog = await screen.findByRole('dialog');
  await user.click(within(detailDialog).getByRole('button', { name: /approve/i }));
  const actionDialog = (await screen.findAllByRole('dialog')).at(-1)!;
  await user.click(within(actionDialog).getByRole('button', { name: /submit/i }));
  expect(await screen.findByRole('alert')).toBeTruthy();
});
```

- [ ] **Step 6: Run + commit**

Run: `cd hotel-web-fe && bun run test src/features/ekyc/components/EkycManagementPage.test.tsx`
Expected: green, including the existing smoke + axe tests.

```bash
git add hotel-web-fe/src/features/ekyc/components/EkycManagementPage.test.tsx
git commit -m "test(ekyc): review-queue workflow assertions for EkycManagementPage"
```

---

### Task 3: RoomManagementPage — status-change workflow tests

`1090` lines. The existing file already exercises the phone action sheet and desktop anchored menu. Add: quick status actions (`mark dirty`/`mark available`/`maintenance`) asserting `RoomsService.updateRoomStatus` payloads + reload, and the `RoomStatusUpdateDialog` submit path via `handleSaveRoomStatus`.

**Files:**
- Modify: `hotel-web-fe/src/features/rooms/components/RoomManagement/RoomManagementPage.test.tsx`
- Read: `src/features/rooms/components/RoomManagement/RoomManagementPage.tsx:367-422` (`handleSaveRoomStatus`, `handleMakeDirty`, `handleMarkAvailable`, `handleMaintenance`), the file's existing mock block (`vi.mock('../../../../api')`)

**Interfaces:**
- Consumes: `RoomsService.updateRoomStatus(roomId, { status, notes? })` → resolves `{ status }`; `loadData` comes from the mocked `useRoomData().reload`/`reloadRooms` (check which name the page calls — `handleMakeDirty` calls `await loadData()`; the test mocks `useRoomData` and supplies `reload: vi.fn()` — assert that fn).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Inspect existing mock for `RoomsService.updateRoomStatus`**

The file mocks `../../../../api` — confirm `RoomsService.updateRoomStatus` is a `vi.fn()` there; if it isn't mocked yet, add `updateRoomStatus: vi.fn(async () => ({ status: 'dirty' }))` to the `RoomsService` mock object and a `mocks.updateRoomStatus` handle for assertions.

- [ ] **Step 2: Quick-action tests**

The page renders per-room quick actions (menu items or buttons calling `handleMakeDirty`/`handleMarkAvailable`/`handleMaintenance`). Reuse the same open-menu helper the existing tests use (they already open the desktop anchored menu — factor the shared open-room-menu steps into a small local function if duplication exceeds ~10 lines).

```tsx
it('marks a room dirty with the canned note payload', async () => {
  render(<RoomManagementPage />);
  await openRoomMenu('occupied-room');           // same menu the existing tests open
  await userEvent.click(screen.getByText(/mark.*dirty/i));
  await waitFor(() =>
    expect(mocks.updateRoomStatus).toHaveBeenCalledWith(mocks.rooms[0].id, {
      status: 'dirty',
      notes: 'Room marked as dirty - requires cleaning',
    }),
  );
});

it('marks a room available and reloads room data', async () => {
  render(<RoomManagementPage />);
  await openRoomMenu('occupied-room');
  await userEvent.click(screen.getByText(/mark.*available|available/i));
  await waitFor(() =>
    expect(mocks.updateRoomStatus).toHaveBeenCalledWith(mocks.rooms[0].id, {
      status: 'available',
      notes: 'Room marked as available',
    }),
  );
});
```

- [ ] **Step 3: `RoomStatusUpdateDialog` submit test**

Open the shared dialog via the room menu's "Update status" entry, pick a status, submit, and assert `handleSaveRoomStatus` forwards `{ status, notes }` unchanged (the page deliberately does NOT coerce to `reserved` — see `RoomManagementPage.tsx:367-374`):

```tsx
it('sends the requested status verbatim from RoomStatusUpdateDialog', async () => {
  render(<RoomManagementPage />);
  await openRoomMenu('occupied-room');
  await userEvent.click(screen.getByText(/update status/i));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: /available/i }));
  await userEvent.click(within(dialog).getByRole('button', { name: /confirm|save|update/i }));
  await waitFor(() =>
    expect(mocks.updateRoomStatus).toHaveBeenCalledWith(
      mocks.rooms[0].id,
      expect.objectContaining({ status: 'available' }),
    ),
  );
});
```

Check `RoomStatusUpdateDialog`'s actual prop/labels first (`src/features/housekeeping/components/RoomStatusUpdateDialog.tsx`) — the assertions must match its real buttons.

- [ ] **Step 4: Filter interaction test**

Assert the search input drives `setRoomSearch` from the mocked `useRoomManagementFilters` (the page's filter UI calls the hook's setters):

```tsx
it('typing in room search calls setRoomSearch', async () => {
  render(<RoomManagementPage />);
  await userEvent.type(screen.getByPlaceholderText(/search/i), '301');
  await waitFor(() => expect(mocks.filters.setRoomSearch).toHaveBeenCalledWith('3'));
});
```

Adjust to the real placeholder from `rooms` i18n bundle; if `setRoomSearch` is called per keystroke, assert last call or `toHaveBeenCalled()`.

- [ ] **Step 5: Run + commit**

Run: `cd hotel-web-fe && bun run test src/features/rooms/components/RoomManagement/RoomManagementPage.test.tsx`
Expected: green.

```bash
git add hotel-web-fe/src/features/rooms/components/RoomManagement/RoomManagementPage.test.tsx
git commit -m "test(rooms): status-change workflow assertions for RoomManagementPage"
```

---

### Task 4: DataTransferPage — ExportPanel workflow test + page tab flow

`DataTransferPage` itself is a thin permission-gated tab shell (already covered). The untested workflow is `ExportPanel` (`data-transfer/ExportPanel.tsx`): scope cards → preview → step-up → passphrase → download. Add a dedicated `ExportPanel.test.tsx` and register it in the manifest.

**Files:**
- Create: `hotel-web-fe/src/features/admin/components/data-transfer/ExportPanel.test.tsx`
- Modify: `hotel-web-fe/src/test/pageManifest.ts` (add to `data-transfer` `workflowTests`)
- Read: `data-transfer/ExportPanel.tsx` (`SCOPES` table at ~line 68-78, `handlePreview`/`runExport`), `src/features/admin/hooks/useDataTransferQueries.ts` (`useExportDataMutation`, `usePreviewDataMutation`, `useStepUpMutation` or StepUpDialog contract)

**Interfaces:**
- Consumes: `ExportPanel({ notify: (msg, severity?) => void })`; `useExportDataMutation().mutateAsync({ scope, stepUpToken?, passphrase? })` → `{ filename, bytes }`; `usePreviewDataMutation().mutateAsync(scope)` → preview report; `StepUpDialog` collects re-auth and yields a step-up token.
- Produces: manifest entry `workflowTests` gains `'features/admin/components/data-transfer/ExportPanel.test.tsx'`.

- [ ] **Step 1: Write the test file skeleton with mocks**

```tsx
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '../../../../test/renderPage';

const mocks = vi.hoisted(() => ({
  preview: { mutateAsync: vi.fn(async () => ({ entities: [], exclusions: [] })), isPending: false },
  export: { mutateAsync: vi.fn(async () => ({ filename: 'saliminn-backup-x.json', bytes: 128 })), isPending: false },
}));

vi.mock('../../hooks/useDataTransferQueries', () => ({
  usePreviewDataMutation: () => mocks.preview,
  useExportDataMutation: () => mocks.export,
}));

vi.mock('./StepUpDialog', () => ({
  default: ({ open, onToken }: { open: boolean; onToken: (t: string) => void }) =>
    open ? <button data-testid="stepup-grant" onClick={() => onToken('step-token-1')} /> : null,
}));

import ExportPanel from './ExportPanel';
```

Verify the real prop names on `StepUpDialog` and the real hook names in `useDataTransferQueries.ts` before committing to this mock shape — mirror them exactly.

- [ ] **Step 2: Standard-scope export test (no step-up)**

```tsx
it('exports the standard scope directly without step-up', async () => {
  const user = userEvent.setup();
  const notify = vi.fn();
  renderPage(<ExportPanel notify={notify} />);
  await user.click(screen.getByRole('button', { name: /export|download/i }));
  await waitFor(() =>
    expect(mocks.export.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'standard' }),
    ),
  );
});
```

The panel renders one card per scope — target the standard card's button via `within(card)` where `card = screen.getByText(/migration backup/i).closest(...)`. Check the rendered labels in `en/dataTransfer.json` (`export.backup.title`, `export.standard.title` or similar) and use the real strings.

- [ ] **Step 3: Sensitive scope → step-up gate**

```tsx
it('routes the backup scope through step-up before downloading', async () => {
  const user = userEvent.setup();
  renderPage(<ExportPanel notify={vi.fn()} />);
  // click the backup card's export button
  await user.click(/* backup card button */);
  // step-up dialog opens (mocked as a grant button)
  await user.click(await screen.findByTestId('stepup-grant'));
  await waitFor(() =>
    expect(mocks.export.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'backup', stepUpToken: 'step-token-1' }),
    ),
  );
});
```

- [ ] **Step 4: System scope → passphrase collection**

```tsx
it('collects a passphrase before a system export', async () => {
  const user = userEvent.setup();
  renderPage(<ExportPanel notify={vi.fn()} />, {
    auth: { permissions: ['data_transfer:export_sensitive', 'data_transfer:export_system'] },
  });
  // click the system card → passphrase dialog appears before step-up/export
  // fill passphrase + confirm → grant step-up → assert mutateAsync got { scope: 'system', passphrase: '…' }
});
```

Check which permission gates `system` (SCOPES table: `data_transfer:export_sensitive` vs a separate `export_system` — read `ExportPanel.tsx`/`routes.rs` and use the real permission string; super-admin-only may also apply — check `useAuth` usage in the panel).

- [ ] **Step 5: Page-level tab-flow additions to `DataTransferPage.test.tsx`**

Add two tests to the existing file: clicking the Import tab renders `ImportWizard`, and History renders the list. Mock `useTransferHistoryQuery` as the file already does; assert tab `ToggleButton` switching works.

- [ ] **Step 6: Manifest + run + commit**

Add to the `data-transfer` manifest entry:

```ts
workflowTests: [
  'features/admin/components/DataTransferPage.test.tsx',
  'features/admin/components/data-transfer/ImportWizard.test.tsx',
  'features/admin/components/data-transfer/ExportPanel.test.tsx',
],
```

Run: `cd hotel-web-fe && bun run test src/features/admin/components/data-transfer/ExportPanel.test.tsx src/features/admin/components/DataTransferPage.test.tsx src/test/pageCoverage.test.ts`
Expected: green.

```bash
git add hotel-web-fe/src/features/admin/components/data-transfer/ExportPanel.test.tsx \
        hotel-web-fe/src/features/admin/components/DataTransferPage.test.tsx \
        hotel-web-fe/src/test/pageManifest.ts
git commit -m "test(data-transfer): ExportPanel scope/step-up/passphrase workflow tests"
```

---

### Task 5: SettingsPage — extract the five inline sections into `settings/` cards

`SettingsPage.tsx` (1369 lines) already has the pattern: `settings/ReportSettingsCard.tsx` and `settings/SystemConfigurationCard.tsx` are extracted; five sections remain inline — `hotel` (hotel info + times), `finance` (charges), `guest` (support workflow), `security`, `appearance`. Extract each to a sibling component; state and the save/discard orchestration stay in the page.

**Files:**
- Create: `hotel-web-fe/src/features/user/components/settings/HotelInfoCard.tsx`, `ChargesCard.tsx`, `SupportWorkflowCard.tsx`, `SecurityCard.tsx`, `AppearanceCard.tsx`
- Modify: `hotel-web-fe/src/features/user/components/SettingsPage.tsx`
- Modify: `hotel-web-fe/src/features/user/components/SettingsPage.test.tsx` (imports unaffected; assertions keep working — the page renders the same DOM)
- Read: `settings/ReportSettingsCard.tsx` — THE pattern to copy (props interface, card chrome, field wiring)

**Interfaces:**
- Consumes: `ReportSettingsCard`'s established prop shape (read it first — likely `{ values, onChange, disabled }` or per-field props).
- Produces: each new card exports a `React.FC<…CardProps>`; SettingsPage renders `<HotelInfoCard … />` inside `activeTab === 'hotel'` etc. No new exports outside the feature.

- [ ] **Step 1: Read `ReportSettingsCard.tsx` and define the contract**

Copy its exact conventions: props object, `useTranslation('admin')` inside the card, disabled/read-only prop name, MUI `Card`/`CardContent` chrome, and how the parent passes setters. Name the new props identically (e.g. if it takes `{ disabled, values, onFieldChange }`, reuse those names).

- [ ] **Step 2: Extract `HotelInfoCard`**

Move the JSX inside `{activeTab === "hotel" && (…)}` into `settings/HotelInfoCard.tsx`. Pass the relevant state + setters as props: `hotelName`, `hotelAddress`, `hotelPhone`, `hotelEmail`, `hotelBusinessNumber`, `checkInTime`, `checkOutTime`, `nightShiftTime`, `nightAuditAutoEnabled`, `currency`, `timezone` (+ `TIMEZONES`/`TIMEZONE_LABEL_KEYS` constants — move them into the card file if only that section uses them). Keep `disabled={!isAdmin}` wired identically.

- [ ] **Step 3: Extract `ChargesCard`, `SupportWorkflowCard`, `SecurityCard`, `AppearanceCard` — one section per card**

Same move for `{activeTab === "finance"}`, `"guest"`, `"security"`, `"appearance"` blocks. `SUPPORT_PRIORITY_LABEL_KEYS`/`SUPPORT_CATEGORY_LABEL_KEYS`/`SUPPORT_PRIORITIES` constants move with the guest card if it's their only consumer. `useThemeMode`/`themeMode` props for AppearanceCard — pass them in rather than calling the hook inside the card (match whatever ReportSettingsCard does for context-dependent values).

- [ ] **Step 4: Verify the existing suite still passes unchanged**

Run: `cd hotel-web-fe && bun run test src/features/user/components/SettingsPage.test.tsx src/features/user/components/settings/`
Expected: green with ZERO test edits — the split is behavior-preserving; a failure means a prop or conditional was dropped.

- [ ] **Step 5: Add per-card render tests where the card gained logic**

For each card that carries anything beyond pure fields (e.g. AppearanceCard's theme-mode buttons, SecurityCard's reset/2FA controls), add a focused `settings/<Card>.test.tsx` asserting its interactive control calls the right prop — copy `ReportSettingsCard.test.tsx` as the template. Register each in `pageManifest.ts` `settings` `workflowTests` only if they test the page surface; per convention component tests don't need manifest entries (manifest tracks pages) — leave the manifest unchanged unless a card is itself a page.

- [ ] **Step 6: Typecheck + lint the touched files**

Run: `cd hotel-web-fe && bun run typecheck && bun run lint:strict`
Expected: clean. Props interfaces must not use `any`.

- [ ] **Step 7: Commit**

```bash
git add hotel-web-fe/src/features/user/components/settings/ \
        hotel-web-fe/src/features/user/components/SettingsPage.tsx \
        hotel-web-fe/src/features/user/components/SettingsPage.test.tsx
git commit -m "refactor(settings): extract remaining SettingsPage sections into card components"
```

---

### Task 6: Make "workflow test" a content-checked invariant

`pageCoverage.test.ts` verifies smoke files call `render(` and axe files call an axe helper — but `workflowTests` is existence-only. Add the matching content check so a workflow file that never interacts is a CI failure.

**Files:**
- Modify: `hotel-web-fe/src/test/pageCoverage.test.ts`

**Interfaces:**
- Consumes: `SOURCES` glob + `sourceOf()` helper already in the file.
- Produces: new `it(...)` enforcing interaction primitives in every `workflowTests` file.

- [ ] **Step 1: Add the failing assertion**

```ts
it('lists workflow files that actually simulate user interaction', () => {
  const shallow = PAGE_MANIFEST.flatMap((entry) =>
    (entry.workflowTests ?? [])
      .filter(exists)
      .filter((file) => !/userEvent|fireEvent|\bclick\(|keyboard\(/.test(sourceOf(file)))
      .map((file) => `${entry.id}: ${file}`),
  );
  expect(shallow).toEqual([]);
});
```

- [ ] **Step 2: Run it — expect failures only where they genuinely are shallow**

Run: `cd hotel-web-fe && bun run test src/test/pageCoverage.test.ts`
Expected: FAIL listing every workflow file with no interaction primitive (e.g. `EkycManagementPage.test.tsx` before Task 2 lands, `DashboardSurfaces.axe.test.tsx`-style files wrongly listed as workflow). Order of work: implement Tasks 1–4 first so the only remaining hits are manifest mislabels (files listed as workflow that are really smoke — fix by moving them to `smokeTests`/`axeTests` or dropping the field, NOT by padding the test).

- [ ] **Step 3: Clean the manifest mislabels**

For each remaining hit: if the file has no interaction assertions and isn't getting them in this plan, remove it from `workflowTests` (keep it in smoke/axe where it belongs). `workflowTests` should be empty-absent rather than aspirational — the field must describe what exists.

- [ ] **Step 4: Full verification**

Run: `cd hotel-web-fe && bun run test && bun run typecheck && bun run lint:strict`
Expected: all green. This is the plan's exit gate.

- [ ] **Step 5: Update `docs/ongoing-dev.md`**

Rewrite the "FE test deserts" P2 entry: coverage + the named four now have workflow assertions; remaining thin-by-depth pages (EkycRegistrationPage, CommunicationsPage, NightAuditPage, RoomConfigPage, LoyaltyPortal — the next tier by component/test ratio) stay listed as follow-ups; SettingsPage card split is done.

- [ ] **Step 6: Commit**

```bash
git add hotel-web-fe/src/test/pageCoverage.test.ts hotel-web-fe/src/test/pageManifest.ts docs/ongoing-dev.md
git commit -m "test(manifest): enforce interaction primitives in workflow test files"
```
